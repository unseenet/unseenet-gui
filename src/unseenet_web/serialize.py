"""Session objects as plain JSON for the browser.

CORE: ``Message`` and ``GroupInfo`` have no stable dict form yet, and the
threading and the sidebar layout live in the TUI. These belong in the core
(0.4.0), so every client shows the same threads and the same groups.
"""

from __future__ import annotations

import hashlib

from unseenet.client.session import GroupInfo, Message, Session, split_signature
from unseenet.core.groups import short_group_id

ACCESS_ICONS = {"moderated": "√", "channel": "►", "closed": "∩"}
VIEW_ICONS = {"chat": "»", "data": "¤", "threads": "≡"}


def colour(key_text: str | None) -> int:
    """A stable avatar colour (0-5) for a key, the same on every client."""
    return hashlib.sha256((key_text or "").encode()).digest()[0] % 6


def view_of(s: Session, gid: str) -> str:
    """The TUI's view_of: your own choice, else the owner's, else threads."""
    if gid == s.my_inbox:
        return "threads"
    views = s.data.get("views", {})
    if gid in views:
        return views[gid]
    return s.manifest_data(gid).get("view", "threads")


def group_kind(s: Session, gid: str) -> dict:
    data = s.manifest_data(gid)
    gtype = s.group_entry(gid).get("type") or data.get("type")
    access = ACCESS_ICONS.get(gtype, "⌂" if data.get("local") else "")
    if gtype == "inbox":
        access = "@"
    view = view_of(s, gid)
    return {"type": gtype, "access": access, "icon": VIEW_ICONS.get(view, "≡") if gtype else "·",
            "view": view, "owner_view": data.get("view", "threads"),
            "fast": bool(data.get("low_latency")), "local": bool(data.get("local")),
            "encrypted": gtype == "closed"}


def group_summary(s: Session, gid: str) -> dict:
    label = s.group_label(gid)
    data = s.manifest_data(gid)
    entry = s.group_entry(gid)
    return {"id": gid, "label": label, "hierarchy": label.split("@")[0].split(".")[0],
            "short": short_group_id(gid), "title": data.get("title") or entry.get("title", ""),
            "description": data.get("description", ""), "rules": data.get("rules", ""),
            "owner": entry.get("owner", False), "may_post": s.may_post(gid),
            "unread": s.unread_count(gid), "for_you": s.for_you_count(gid), **group_kind(s, gid)}


def sidebar(s: Session, inbox_ready: bool) -> dict:
    groups = [group_summary(s, gid) for gid in s.data["subscribed"]
              if gid != s.my_inbox and not s.is_data_group(gid)]
    hierarchies: dict[str, list[dict]] = {}
    for g in sorted(groups, key=lambda g: g["label"]):
        hierarchies.setdefault(g["hierarchy"], []).append(g)
    inbox = s.my_inbox if inbox_ready else None
    return {"for_you": len(s.for_you()),
            "inbox": {"id": inbox, "unread": s.unread_count(inbox) if inbox else 0},
            "hierarchies": [{"name": h, "groups": gs} for h, gs in sorted(hierarchies.items())]}


def threaded(msgs: list[Message]) -> list[tuple[Message, int]]:
    """The TUI's _threaded: threads newest first, each in the order it came."""
    pos = {m.message_id: i for i, m in enumerate(msgs)}
    by_id = {m.message_id: m for m in msgs}
    threads: dict[str, list[Message]] = {}
    for m in msgs:
        root = next((r for r in m.references if r in by_id), m.message_id)
        threads.setdefault(root, []).append(m)
    out = []
    for root, items in sorted(threads.items(),
                              key=lambda kv: max(pos[x.message_id] for x in kv[1]), reverse=True):
        for m in sorted(items, key=lambda x: pos[x.message_id]):
            depth = 0 if m.message_id == root else min(len(m.references), 4)
            out.append((m, depth))
    return out


def message(s: Session, m: Message, my_keys: set[str], mine: set[str], patterns: list) -> dict:
    text, sig = split_signature(m.body) if m.readable else ("", None)
    if m.to_key:
        who, who_key = "You → " + s.identity_label(m.to_key), m.to_key
    elif m.private and m.sender_key:
        who, who_key = s.identity_label(m.sender_key, m.from_name), m.sender_key
    else:
        who, who_key = s.identity_label(m.author_key, m.from_name), m.author_key
    me = m.author_key in my_keys or bool(m.to_key)
    return {"id": m.message_id, "number": m.number, "group": m.group, "subject": m.subject,
            "who": who, "key": who_key, "colour": colour(who_key), "mine": me,
            "contact": bool(s.contact_name(who_key)) if who_key else False,
            "date": m.date.isoformat() if m.date else None, "text": text.rstrip("\n"),
            "signature": (sig or "").rstrip("\n") or None, "references": m.references,
            "encrypted": m.encrypted, "private": m.private, "verified": bool(m.sender_key),
            "readable": m.readable, "error": m.error, "read": s.is_read(m),
            "for_me": s.for_me(m, mine, patterns)}


def group_view(s: Session, gid: str) -> dict:
    if gid == s.my_inbox:
        msgs = s.visible(s.private_messages())
        head = {"id": gid, "label": "Private messages", "hierarchy": "", "title":
                "Only you can read these. Nodes see sealed envelopes.", "view": "threads",
                "type": "inbox", "access": "@", "icon": "≡", "encrypted": True, "fast": False,
                "may_post": False, "owner": True, "unread": s.unread_count(gid), "for_you": 0,
                "rules": "", "description": ""}
    elif gid == "for-you":
        msgs = list(reversed(s.for_you(unread_only=False)[:200]))
        head = {"id": gid, "label": "For you", "hierarchy": "", "title":
                "Replies to your posts and posts that name you, from all your groups",
                "view": "threads", "type": None, "access": "", "icon": "◄", "encrypted": False,
                "fast": False, "may_post": False, "owner": False, "unread": 0, "for_you": 0,
                "rules": "", "description": ""}
    else:
        msgs = s.visible(sorted(s.cache.get(gid, {}).values(), key=lambda m: m.number))
        head = group_summary(s, gid)
    my_keys = {s.identity(n).key_text for n in s.data["identities"]}
    mine, patterns = s.my_message_ids(), s._mention_patterns()
    if head["view"] == "chat":
        rows = [(m, 0) for m in msgs]
    elif gid == "for-you":
        rows = [(m, 0) for m in reversed(msgs)]
    else:
        rows = threaded(msgs)
    return {"group": head,
            "messages": [{**message(s, m, my_keys, mine, patterns), "depth": d} for m, d in rows]}


def browse_entry(s: Session, g: GroupInfo) -> dict:
    return {"id": g.group_id, "label": s.group_label(g.group_id), "description": g.description,
            "subscribed": g.subscribed, "nodes": len(g.nodes),
            **group_kind(s, g.group_id)}
