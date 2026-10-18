"""Session objects as plain JSON for the browser.

CORE: ``Message`` and ``GroupInfo`` have no stable dict form yet, and the
threading and the sidebar layout live in the TUI. These belong in the core
(0.4.0), so every client shows the same threads and the same groups.
"""

from __future__ import annotations

import hashlib

from unseenet.client.session import GroupInfo, Message, Session, split_signature
from unseenet.core import markup
from unseenet.core.groups import KIND_CHAT, group_refs, short_group_id

CONTACT = "contact:"            # a conversation with one key, shown as a chat (as in the TUI)
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


def seen_name(s: Session, key_text: str) -> str:
    """The name someone gave themselves in a post we have, for labelling a bare key."""
    for msgs in s.cache.values():
        for m in msgs.values():
            if m.author_key == key_text and m.from_name:
                return m.from_name
    return ""


def group_summary(s: Session, gid: str) -> dict:
    label = s.group_label(gid)
    data = s.manifest_data(gid)
    entry = s.group_entry(gid)
    members = []
    if entry.get("owner") and (entry.get("type") or data.get("type")) == "closed":
        members = [{"key": k, "label": s.identity_label(k, seen_name(s, k)), "colour": colour(k)}
                   for k in s.members(gid)]
    return {"members": members, "id": gid, "label": label, "hierarchy": label.split("@")[0].split(".")[0],
            "short": short_group_id(gid), "title": data.get("title") or entry.get("title", ""),
            "description": data.get("description", ""), "rules": data.get("rules", ""),
            "owner": entry.get("owner", False), "may_post": s.may_post(gid),
            "unread": s.unread_count(gid), **for_you(s, gid),
            "kinds": list(s.group_kinds(gid)), **roles(s, gid),            # owner and moderator tools
            **group_kind(s, gid)}     # what it takes (UN-RFC 0028)


def for_you(s: Session, gid: str | None = None) -> dict:
    """Unread replies to you and posts naming you, apart (unseenet #170); for_you is the total."""
    c = s.for_you_counts(gid)
    return {"for_you": c.total, "replies": c.replies, "mentions": c.mentions}


def sidebar(s: Session, inbox_ready: bool) -> dict:
    groups = [group_summary(s, gid) for gid in s.data["subscribed"]
              if gid != s.my_inbox and not s.is_data_group(gid)]
    hierarchies: dict[str, list[dict]] = {}
    for g in sorted(groups, key=lambda g: g["label"]):
        hierarchies.setdefault(g["hierarchy"], []).append(g)
    inbox = s.my_inbox if inbox_ready else None
    # one chat per person: contacts, and anyone else you have chatted with (UN-RFC 0028, 6.2)
    people = [{"id": CONTACT + key, "key": key, "contact": bool(s.contact_name(key)),
               "label": s.contact_name(key) or s.identity_label(key, seen_name(s, key)),
               "colour": colour(key), "unread": s.unread_from(key, KIND_CHAT)}
              for key in s.chat_partners()]
    return {**for_you(s), "people": people,
            "moderation": len(s.submissions()),           # posts waiting for you to approve
            "name_requests": _name_requests(s),           # people asking for a name under yours
            "show_blocked": bool(s.data.get("show_blocked")),
            "markdown": markup.is_markdown(s.text_type()),       # what you write (UN-RFC 0031)
            "notices": s.notice_settings(),                      # mention notices (UN-RFC 0032)
            "inbox": {"id": inbox, "unread": s.unread_private_posts() if inbox else 0},
            "hierarchies": [{"name": h, "groups": gs} for h, gs in sorted(hierarchies.items())]}


def threaded(msgs: list[Message]) -> list[tuple[Message, int]]:
    """The TUI's _threaded: threads newest first, each in the order it came."""
    pos = {m.message_id: i for i, m in enumerate(msgs)}
    by_id = {m.message_id: m for m in msgs}
    threads: dict[str, list[Message]] = {}
    run = None             # consecutive chat lines stay together, not a thread each (UN-RFC 0028)
    for m in msgs:
        root = next((r for r in m.references if r in by_id), None)
        if root is None and m.kind == KIND_CHAT and not m.private:
            root = run = run or m.message_id
        else:
            run = None
        root = root or m.message_id
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
        who, who_key = "You → " + s.identity_label(m.to_key, seen_name(s, m.to_key)), m.to_key
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
            "kind": m.kind,                      # a chat line or a post (UN-RFC 0028)
            # the text as a safe tree, Markdown or plain, rendered as the TUI does (UN-RFC 0031)
            "tree": markup.body(text.rstrip("\n"), m.content_type, m.kind) if m.readable else [],
            "markdown": markup.is_markdown(m.content_type),
            "readable": m.readable, "error": m.error, "read": s.is_read(m),
            "for_me": s.for_me(m, mine, patterns), "may_withdraw": s.may_cancel(m),
            # groups it names with # (unseenet #172): # on the post, or a click, goes there
            "groups": [r.text for r in group_refs(f"{m.subject}\n{text}")] if m.readable else [],
            "notice": notice(s, m)}


def notice(s: Session, m: Message) -> dict | None:
    """A mention notice (UN-RFC 0032): where the post that names you is."""
    if not s.is_notice(m):
        return None
    try:
        name, fp = m.mention_group.rsplit("@", 1)
    except ValueError:
        return None
    return {"group": m.mention_group, "id": m.mention_of, "label": s.group_label(m.mention_group),
            "ref": f"#{name}@{fp}", "followed": m.mention_group in s.data["subscribed"]}


def group_view(s: Session, gid: str) -> dict:
    if gid == s.my_inbox:
        msgs = s.visible(s.private_posts())        # posts, and chats with non-contacts (UN-RFC 0028)
        head = {"id": gid, "label": "Private posts", "hierarchy": "", "title":
                "Only you can read these. Nodes see sealed envelopes.", "view": "threads",
                "type": "inbox", "access": "@", "icon": "≡", "encrypted": True, "fast": False,
                "may_post": False, "owner": True, "unread": s.unread_count(gid), "for_you": 0,
                "rules": "", "description": "", "members": [], "private_reply": True}
    elif gid.startswith(CONTACT):
        key = gid[len(CONTACT):]
        msgs = s.visible(s.conversation(key, KIND_CHAT))     # the chat; posts are in Private posts
        head = {"id": gid, "label": s.identity_label(key, seen_name(s, key)), "hierarchy": "", "key": key,
                "title": "Private conversation. Only the two of you can read it.",
                "view": "chat", "type": "contact", "access": "@", "icon": "»", "encrypted": True,
                "fast": False, "may_post": True, "owner": False, "unread": s.unread_from(key, KIND_CHAT),
                "for_you": 0, "rules": "", "description": "", "members": [],
                "contact": bool(s.contact_name(key)), "colour": colour(key)}
    elif gid == "for-you":
        msgs = list(reversed(s.for_you(unread_only=False)[:200]))
        head = {"id": gid, "label": "For you", "hierarchy": "", "title":
                "Replies to your posts and posts that name you, from all your groups",
                "view": "threads", "type": None, "access": "", "icon": "◄", "encrypted": False,
                "fast": False, "may_post": False, "owner": False, "unread": 0, "for_you": 0,
                "rules": "", "description": "", "members": []}
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


def submission(s: Session, m: Message, art) -> dict:
    """A post waiting for a moderator's approval (UN-RFC 0009 section 3)."""
    key = art.get("Author-Key", "")
    text = split_signature(art.body)[0].rstrip("\n") if not art.get("Encrypted") else ""
    return {"id": m.message_id, "group": art.group, "group_label": s.group_label(art.group),
            "subject": art.get("Subject", ""), "who": s.identity_label(key, art.get("From", "")),
            "tree": markup.body(text, art.get("Content-Type", ""), markup_kind(art)),
            "markdown": markup.is_markdown(art.get("Content-Type", "")),
            "key": key, "text": text, "date": m.date.isoformat() if m.date else None}


def people(s: Session, keys: list[str]) -> list[dict]:
    return [{"key": k, "label": s.identity_label(k, seen_name(s, k)), "colour": colour(k)} for k in keys]


def roles(s: Session, gid: str) -> dict:
    """Who may do what in a group, for its owner's tools."""
    data = s.manifest_data(gid)
    return {"moderators": people(s, data.get("moderators", [])),
            "posters": people(s, data.get("posters", [])),
            "banned": [{**p, "reason": r} for (k, r), p in
                       zip(s.banned(gid), people(s, [k for k, _ in s.banned(gid)]))],
            "moderates": s.moderates(gid),
            # you maintain a hierarchy this group is in: you may block people in all of it
            "maintainer": _maintains(s, gid)}


def _maintains(s: Session, gid: str) -> bool:
    from unseenet.client import naming
    me = s.identity().key_text
    try:
        return any(h.maintainer == me for h in naming.governing(s, gid))
    except Exception:  # noqa: BLE001 - lists not read yet
        return False


def browse_entry(s: Session, g: GroupInfo) -> dict:
    return {"id": g.group_id, "label": s.group_label(g.group_id), "description": g.description,
            "subscribed": g.subscribed, "nodes": len(g.nodes),
            **group_kind(s, g.group_id)}


def names(s: Session) -> dict:
    """Your names, what is waiting, and the names you give under yours (UN-RFC 0019)."""
    from unseenet import names as nm
    from unseenet.client import naming
    me = s.identity().key_text
    mine = naming.my_names(s)
    primary = naming.preferred(s, me, mine).name if mine else None
    held = {c.name for c in mine}
    return {
        "key": me,
        "dns_value": nm.dns_record_value(me),
        "mine": [{"name": c.name, "text": naming.name_text(c.name), "kind": c.kind,
                  "expires": c.expires.isoformat(), "primary": c.name == primary} for c in mine],
        "pending": [{"name": n, "action": a, "sent": when} for n, a, when in naming.pending(s)
                    if n not in held],
        "parents": naming.parents_i_hold(s),
        "given": [{"name": c.name, "key": c.key, "who": s.identity_label(c.key),
                   "expires": c.expires.isoformat()} for c in naming.names_given(s)],
        "requests": [{"id": m.message_id, "name": d.get("name", ""), "key": d.get("key", ""),
                      "who": s.identity_label(d.get("key", ""), m.from_name)}
                     for m, d in naming.name_requests(s)],
    }


def _name_requests(s: Session) -> int:
    from unseenet.client import naming
    try:
        return len(naming.name_requests(s))
    except Exception:  # noqa: BLE001
        return 0


def markup_kind(art) -> str:
    from unseenet.core.groups import message_kind
    return message_kind(art)
