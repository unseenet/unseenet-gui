"""The client runtime: one unlocked Session and what keeps it up to date.

Most of this mirrors the TUI's startup and refresh flow (``client/tui.py``:
``start``, ``refresh_groups``, ``watch_loop``). It is copied here because it
is not in the core yet. Every block marked ``CORE:`` is a candidate for
unseenet 0.4.0, so that all clients share one implementation - see
CORE-NEEDS.md.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
from pathlib import Path

from unseenet.client.session import Message, Session, SessionError
from unseenet.core import crypto
from unseenet.core.groups import personal_inbox_id
from unseenet.core.vault import Vault, VaultError
from unseenet.nntp import NNTPError

from . import serialize

NETWORK_ERRORS = (SessionError, OSError, ConnectionError, NNTPError, asyncio.IncompleteReadError)
REFRESH_SECONDS = 60            # a fallback; new posts normally arrive by push (UN-RFC 0008)


class Runtime:
    def __init__(self, vault_path: Path):
        self.vault_path = Path(vault_path)
        self.session: Session | None = None
        self.status = "Locked"
        self.connected = False
        self._listeners: set[asyncio.Queue] = set()
        self._tasks: set[asyncio.Task] = set()
        self._watching: set[str] = set()
        self._inbox_ready = False
        self._jobs = 0

    # --- events -----------------------------------------------------------
    # CORE: Session only has one ``status`` callback. Clients need typed events
    # (new post, post state, node down, proof-of-work progress).
    def listen(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._listeners.add(q)
        return q

    def unlisten(self, q: asyncio.Queue) -> None:
        self._listeners.discard(q)

    def emit(self, kind: str, **data) -> None:
        event = {"type": kind, **data}
        for q in list(self._listeners):
            with contextlib.suppress(asyncio.QueueFull):
                q.put_nowait(event)

    def set_status(self, text: str) -> None:
        self.status = text
        self.emit("status", text=text)

    def spawn(self, coro) -> asyncio.Task:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    # --- unlocking --------------------------------------------------------
    def vault_exists(self) -> bool:
        return self.vault_path.exists()

    async def unlock(self, passphrase: str) -> None:
        kdf = {"ops": 1, "mem": 8192 * 1024} if os.environ.get("UNSEENET_INSECURE_FAST_KDF") == "1" else {}
        self.set_status("Unlocking vault ...")
        try:
            vault = await asyncio.to_thread(Vault.open, self.vault_path, passphrase, **kdf)
        except VaultError as exc:
            self.set_status("Locked")
            raise SessionError(str(exc) or "wrong passphrase") from exc
        self.session = Session(vault, status=self.set_status)
        if self.needs_setup():
            self.set_status("Choose a name and a node")
            return
        self.spawn(self.start())

    def needs_setup(self) -> bool:
        s = self.session
        return s is not None and (not s.has_identity() or not s.node)

    async def setup(self, display: str, node: str) -> None:
        s = self.session
        if not s.has_identity():
            name = display.strip().lower().replace(" ", "-") or "me"
            s.new_identity(name, display.strip() or name)
        if not s.node:
            s.add_node(node.strip())
        self.spawn(self.start())

    # --- startup and refresh ---------------------------------------------
    # CORE: this is the TUI's start() + refresh_groups(), step for step.
    async def start(self) -> None:
        s = self.session
        s.subscribe_starter_groups()
        loaded = s.load_offline()
        self.set_status(f"{loaded} saved posts available offline - connecting ...")
        self.emit("groups")
        await self.refresh()
        self.spawn(self._known_nodes())
        self.spawn(self._refresh_loop())

    async def _refresh_loop(self) -> None:
        while self.session is not None:
            await asyncio.sleep(REFRESH_SECONDS)
            await self.refresh()

    async def refresh(self) -> None:
        s = self.session
        try:
            await s.list_groups()
        except NETWORK_ERRORS as exc:
            self.connected = False
            self.set_status(f"Offline ({exc}) - showing saved posts")
            self.emit("groups")
            return
        self.connected = True
        if not self._inbox_ready:
            try:
                await s.ensure_inbox()
                self._inbox_ready = True
                self._start_watches()
            except NETWORK_ERRORS as exc:
                self.set_status(f"Could not set up your inbox: {exc}")
        for gid in list(s.data["subscribed"]) + ([s.my_inbox] if self._inbox_ready else []):
            try:
                await s.fetch_group(gid)
            except NETWORK_ERRORS:
                pass
            self.emit("group", id=gid)
        self.set_status(f"Connected to {s.node}")
        self.emit("groups")

    async def _known_nodes(self) -> None:
        with contextlib.suppress(*NETWORK_ERRORS, ValueError):
            await self.session.refresh_known_nodes()
        with contextlib.suppress(*NETWORK_ERRORS, ValueError):
            if await self.session.refresh_naming():
                self.emit("groups")

    # CORE: the TUI's watch_loop (push, UN-RFC 0008 section 2).
    def _start_watches(self) -> None:
        for address in self.session.nodes:
            if address not in self._watching:
                self._watching.add(address)
                self.spawn(self._watch(address))

    async def _watch(self, node: str) -> None:
        s = self.session

        async def on_new(gid: str, message_id: str) -> None:
            if s.node_for(gid) == node and (gid in s.data["subscribed"] or gid == s.my_inbox):
                self.spawn(self._fetch(gid))

        while s is self.session and node in s.nodes:
            try:
                if await s.watch(on_new, node=node) is False:
                    return
            except NETWORK_ERRORS:
                pass
            await asyncio.sleep(15)

    async def _fetch(self, gid: str) -> None:
        with contextlib.suppress(*NETWORK_ERRORS):
            await self.session.fetch_group(gid)
        self.emit("group", id=gid)
        self.emit("groups")

    async def close(self) -> None:
        for task in list(self._tasks):
            task.cancel()
        if self.session is not None:
            with contextlib.suppress(Exception):
                await self.session.close()
        self.session = None

    # --- reading ------------------------------------------------------------
    def state(self) -> dict:
        s = self.session
        out = {"unlocked": s is not None, "vault": str(self.vault_path),
               "vault_exists": self.vault_exists(), "status": self.status,
               "connected": self.connected, "setup": self.needs_setup()}
        if s is not None and s.has_identity():
            ident = s.identity()
            out["me"] = {"display": s.display_name(), "key": ident.key_text,
                         "fp": ident.fingerprint[:4], "label": s.identity_label(ident.key_text, s.display_name())}
            out["node"] = s.node
            out["nodes"] = s.nodes
        return out

    def groups(self) -> dict:
        return serialize.sidebar(self.session, self._inbox_ready)

    def messages(self, gid: str) -> dict:
        return serialize.group_view(self.session, gid)

    def mark_read(self, gid: str, ids: list[str]) -> None:
        s = self.session
        wanted = set(ids)
        if gid == s.my_inbox or gid.startswith(serialize.CONTACT):
            pool = s.private_messages()
        elif gid == "for-you":                       # posts from all your groups
            pool = [m for msgs in s.cache.values() for m in msgs.values()]
        else:
            pool = list(s.cache.get(gid, {}).values())
        for m in pool:
            if m.message_id in wanted:
                s.mark_read(m, save=False)
        s.save()
        self.emit("groups")

    def set_view(self, gid: str, view: str) -> None:
        views = self.session.data.setdefault("views", {})   # the same place the TUI keeps it
        views[gid] = view
        self.session.save()

    # --- writing ------------------------------------------------------------
    def post(self, gid: str, subject: str, body: str, references: list[str], chat: bool = False,
             signature: bool = True) -> str:
        """Start a post in the background; its progress arrives as 'post' events.

        A chat message is sent like the TUI does it: the subject is its first
        line and there is no signature."""
        if chat:
            subject = body.split("\n", 1)[0][:60] + ("…" if len(body) > 60 else "")
        elif signature:
            sig = self.session.signature()
            body = body.rstrip("\n") + ("\n-- \n" + sig if sig else "")
        self._jobs += 1
        job = f"job{self._jobs}"
        self.spawn(self._post(job, gid, subject, body, references))
        return job

    async def _post(self, job: str, gid: str, subject: str, body: str, references: list[str]) -> None:
        s = self.session
        # CORE: no progress callback for proof-of-work yet; the client shows "working".
        self.emit("post", job=job, group=gid, state="pow")
        try:
            msgid = await s.post(gid, subject, body, references=references or None)
        except NETWORK_ERRORS as exc:
            self.emit("post", job=job, group=gid, state="failed", error=str(exc))
            return
        self.emit("post", job=job, group=gid, state="sent", message_id=msgid)
        await self._fetch(gid)
        self.emit("post", job=job, group=gid, state="reached", message_id=msgid)

    # --- private messages, contacts, groups ------------------------------
    def send_private(self, key_text: str, body: str, subject: str = "",
                     reply_to: str | None = None, chat: bool = False) -> str:
        """Seal a message to someone's inbox. Their key is all you need."""
        s = self.session
        owner = crypto.key_from_text(key_text)          # raises on a bad key
        if key_text == s.identity().key_text:
            raise SessionError("that is your own key")
        inbox, refs = personal_inbox_id(owner), []
        if reply_to:
            msg = find_message(s, s.my_inbox, reply_to)
            if msg is not None:
                inbox = s.reply_target(msg) or inbox
                refs = msg.references + [msg.message_id]
        if chat or not subject:
            subject = body.split("\n", 1)[0][:60] + ("…" if len(body) > 60 else "")
        self._jobs += 1
        job = f"job{self._jobs}"
        ui_group = serialize.CONTACT + key_text if chat else s.my_inbox
        self.spawn(self._private(job, ui_group, inbox, owner, subject, body, refs))
        return job

    async def _private(self, job, ui_group, inbox, owner, subject, body, refs) -> None:
        s = self.session
        self.emit("post", job=job, group=ui_group, state="pow")
        try:
            msgid = await s.send_private(inbox, subject, body, owner_key=owner, references=refs or None)
        except (*NETWORK_ERRORS, ValueError) as exc:
            self.emit("post", job=job, group=ui_group, state="failed", error=str(exc))
            return
        self.emit("post", job=job, group=ui_group, state="sent", message_id=msgid)
        self.emit("group", id=ui_group)
        self.emit("group", id=s.my_inbox)
        self.emit("post", job=job, group=ui_group, state="reached", message_id=msgid)

    def add_contact(self, key_text: str, name: str) -> None:
        self.session.add_contact(key_text, name)
        self.emit("groups")

    def remove_contact(self, key_text: str) -> None:
        self.session.remove_contact(key_text)
        self.emit("groups")

    async def create_group(self, name: str, gtype: str, view: str, fast: bool,
                           title: str, description: str) -> str:
        gid = await self.session.create_group(
            name, gtype, title=title, description=description,
            view=view if view in ("threads", "chat") else None, low_latency=fast)
        await self._fetch(gid)
        return gid

    async def invite(self, gid: str, key_text: str) -> None:
        crypto.key_from_text(key_text)
        await self.session.invite(gid, key_text)
        self.emit("group", id=gid)

    def set_signature(self, template: str) -> None:
        self.session.set_signature(template)

    async def browse(self) -> list[dict]:
        groups = await self.session.list_groups()
        return [serialize.browse_entry(self.session, g) for g in groups]

    def subscribe(self, gid: str, on: bool) -> None:
        self.session.subscribe(gid, on)
        if on:
            self.spawn(self._fetch(gid))
        self.emit("groups")


def find_message(s: Session, gid: str, message_id: str) -> Message | None:
    pool = (list(s.cache.get(gid, {}).values()) + s.private_messages() if gid == s.my_inbox
            else s.cache.get(gid, {}).values())
    return next((m for m in pool if m.message_id == message_id), None)
