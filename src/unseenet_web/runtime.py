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

from datetime import timedelta

from unseenet import names as nm
from unseenet.client import naming
from unseenet.client.session import Message, Session, SessionError
from unseenet.core import crypto
from unseenet.core.groups import KIND_CHAT, KIND_POST, personal_inbox_id
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

        A chat line (UN-RFC 0028) has an empty subject and no signature."""
        kinds = self.session.group_kinds(gid)
        if (KIND_CHAT if chat else KIND_POST) not in kinds:
            raise SessionError("this group takes " + ("posts with a subject only" if chat
                                                       else "chat lines only"))
        if chat:
            subject = ""
        elif signature:
            sig = self.session.signature()
            body = body.rstrip("\n") + ("\n-- \n" + sig if sig else "")
        self._jobs += 1
        job = f"job{self._jobs}"
        self.spawn(self._post(job, gid, subject, body, references, KIND_CHAT if chat else KIND_POST))
        return job

    async def _post(self, job: str, gid: str, subject: str, body: str, references: list[str],
                    kind: str = KIND_POST) -> None:
        s = self.session
        # CORE: no progress callback for proof-of-work yet; the client shows "working".
        self.emit("post", job=job, group=gid, state="pow")
        try:
            msgid = await s.post(gid, subject, body, references=references or None, kind=kind)
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
        # UN-RFC 0028: a chat has no subject; a post must have one
        if chat:
            subject = ""
        elif not subject:
            raise SessionError("a post needs a subject")
        self._jobs += 1
        job = f"job{self._jobs}"
        ui_group = serialize.CONTACT + key_text if chat else s.my_inbox
        self.spawn(self._private(job, ui_group, inbox, owner, subject, body, refs,
                                 KIND_CHAT if chat else KIND_POST))
        return job

    async def _private(self, job, ui_group, inbox, owner, subject, body, refs, kind) -> None:
        s = self.session
        self.emit("post", job=job, group=ui_group, state="pow")
        try:
            msgid = await s.send_private(inbox, subject, body, owner_key=owner, references=refs or None,
                                         kind=kind)
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
                           title: str, description: str, kinds: list[str] | None = None) -> str:
        gid = await self.session.create_group(
            name, gtype, title=title, description=description,
            view=view if view in ("threads", "chat") else None, low_latency=fast, kinds=kinds)
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

    # --- owners and moderators (as the TUI's Ctrl+P) -------------------------
    async def moderation(self) -> list[dict]:
        """Submissions waiting for groups you moderate (UN-RFC 0009 section 3)."""
        s = self.session
        await s.fetch_group(s.my_inbox)
        return [serialize.submission(s, m, art) for m, art in s.submissions()]

    async def moderate(self, inbox_id: str, approve: bool, reason: str = "") -> None:
        s = self.session
        found = next(((m, a) for m, a in s.submissions() if m.message_id == inbox_id), None)
        if found is None:
            raise SessionError("that submission is not waiting any more")
        m, art = found
        if approve:
            await s.approve_submission(m, art)
            await self._fetch(art.group)
        else:
            await s.reject_submission(m, reason)
        self.emit("groups")

    async def edit_group(self, gid: str, changes: dict) -> None:
        await self.session.update_group(gid, **changes)
        self.emit("group", id=gid)
        self.emit("groups")

    async def remove_group(self, gid: str, reason: str = "") -> None:
        await self.session.remove_group(gid, reason)
        self.emit("groups")

    async def set_role(self, gid: str, role: str, key_text: str, on: bool) -> None:
        await self.session.set_role(gid, role, key_text, on)
        self.emit("group", id=gid)

    async def ban(self, gid: str, key_text: str, on: bool, reason: str = "") -> None:
        if on:
            await self.session.ban(gid, key_text, reason)
        else:
            await self.session.unban(gid, key_text)
        self.emit("group", id=gid)

    async def withdraw(self, gid: str, message_id: str) -> None:
        s = self.session
        m = find_message(s, gid, message_id)
        if m is None:
            raise SessionError("that post is not here any more")
        await s.cancel(m)
        await self._fetch(gid)
        self.emit("group", id=gid)

    async def report_targets(self, gid: str, message_id: str) -> list[dict]:
        s = self.session
        m = find_message(s, gid, message_id)
        if m is None:
            raise SessionError("that post is not here any more")
        return [{"i": i, "who": who} for i, (who, _, _) in enumerate(await s.report_targets(m))]

    async def report(self, gid: str, message_id: str, chosen: list[int], note: str,
                     anonymous: bool) -> int:
        s = self.session
        m = find_message(s, gid, message_id)
        if m is None:
            raise SessionError("that post is not here any more")
        targets = await s.report_targets(m)
        picked = [t for i, t in enumerate(targets) if i in set(chosen)]
        return await s.report(m, picked, note, anonymous=anonymous)


    # --- names (UN-RFC 0019), as the TUI's @ and Ctrl+P -----------------------
    async def names(self) -> dict:
        s = self.session
        try:
            await asyncio.wait_for(s.refresh_naming(), 60)
        except (*NETWORK_ERRORS, ValueError, asyncio.TimeoutError):
            pass                                  # show what we have
        return serialize.names(s)

    async def name_action(self, data: dict) -> str:
        """claim, renew, release, transfer, primary, ask, give, revoke, answer."""
        s, action = self.session, str(data.get("action", ""))
        name = str(data.get("name", "")).strip().lower().lstrip("@")
        if action in ("claim", "renew", "release", "transfer"):
            nm.check_name(name)
            to = str(data.get("to", "")).strip() or None
            if action == "transfer":
                if not to:
                    raise SessionError("transfer to which key?")
                crypto.key_from_text(to)
                if to == s.identity().key_text:
                    raise SessionError("that is your own key")
            await naming.claim(s, name, action, to)
            return f"Sent your {action} of @{name} to the registrar. It decides after about an hour."
        if action == "primary":
            naming.set_primary(s, name)
            return f"Your posts show {naming.name_text(name)}"
        if action == "ask":
            await naming.request_subname(s, name)
            return f"Asked for {name}. The answer comes to your private posts."
        if action == "give":
            key = str(data.get("key", "")).strip()
            crypto.key_from_text(key)
            years = max(1, min(int(data.get("years", 1) or 1), 10))
            await naming.give_subname(s, name, key, timedelta(days=365 * years))
            return f"{name} given to {s.identity_label(key)}"
        if action == "revoke":
            await naming.revoke_subname(s, name)
            return f"{name} taken back"
        if action == "answer":
            await s.fetch_group(s.my_inbox)
            found = next(((m, d) for m, d in naming.name_requests(s)
                          if m.message_id == data.get("id")), None)
            if found is None:
                raise SessionError("that request is not waiting any more")
            await naming.answer_request(s, found[0], found[1], approve=bool(data.get("approve")))
            return "Given." if data.get("approve") else "Said no."
        raise SessionError(f"unknown action {action}")

    # --- ignoring people, blocking in a hierarchy, members ---------------------
    def ignore(self, key_text: str, label: str, on: bool) -> None:
        crypto.key_from_text(key_text)
        if on:
            self.session.ignore(key_text, label)
        else:
            self.session.unignore(key_text)
        self.emit("groups")
        if self.session is not None:
            for gid in list(self.session.data["subscribed"]):
                self.emit("group", id=gid)

    def ignored(self) -> list[dict]:
        return [{"key": k, "label": label or self.session.identity_label(k)}
                for k, label in self.session.ignored()]

    async def block(self, gid: str, key_text: str, reason: str) -> str:
        crypto.key_from_text(key_text)
        where = await naming.block(self.session, gid, key_text, reason)
        self.emit("group", id=gid)
        return str(where)

    def show_blocked(self, on: bool) -> None:
        self.session.set_show_blocked(on)
        for gid in list(self.session.data["subscribed"]):
            self.emit("group", id=gid)

    async def remove_member(self, gid: str, key_text: str) -> int:
        n = await self.session.remove_member(gid, key_text)
        self.emit("group", id=gid)
        return n


def find_message(s: Session, gid: str, message_id: str) -> Message | None:
    pool = (list(s.cache.get(gid, {}).values()) + s.private_messages() if gid == s.my_inbox
            else s.cache.get(gid, {}).values())
    return next((m for m in pool if m.message_id == message_id), None)
