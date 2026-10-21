"""Session objects as plain JSON for the browser.

Threads, views and the order of a group's rows come from the core
(``Session.threads``, ``Session.view_of``, unseenet #139, #27), so this
client shows them as the TUI does.

What a message and a group *are* comes from the core too: ``Message.to_dict()``
and ``Session.group_info()`` / ``GroupInfo.to_dict()`` (#28). This module adds
only what is this client's: labels, colours, icons, the Markdown tree, the
owner's tools. The browser API keeps its names (``key``, ``fast``, ``for_you``),
mapped here from the core's, so the page does not change.
"""

from __future__ import annotations

import hashlib

from unseenet.client import threads as core_threads
from unseenet.client.grouptree import group_tree
from unseenet.client.session import DICT_VERSION, GroupInfo, Message, Session, split_signature
from unseenet.core import markup
from unseenet.core.groups import KIND_CHAT, group_refs, short_group_id  # noqa: F401 (runtime uses it)

CONTACT = core_threads.CONTACT  # a conversation with one key, shown as a chat (as in the TUI)
FOR_YOU = "for-you"            # the browser's name for the core's "for-you:" (threads.FOR_YOU)
ACCESS_ICONS = {"moderated": "√", "channel": "►", "closed": "∩"}
VIEW_ICONS = {"chat": "»", "data": "¤", "threads": "≡"}


def colour(key_text: str | None) -> int:
    """A stable avatar colour (0-5) for a key, the same on every client."""
    return hashlib.sha256((key_text or "").encode()).digest()[0] % 6


def core_id(gid: str) -> str:
    """The core's ID for a group the browser names (only "For you" differs)."""
    return core_threads.FOR_YOU if gid == FOR_YOU else gid


def view_of(s: Session, gid: str) -> str:
    """Your own choice, else the owner's, else threads: the core's view_of."""
    return s.view_of(core_id(gid))


def core_dict(obj) -> dict:
    """A message's or a group's dict from the core, in the one shape this client
    knows: a newer core with another shape should fail loudly, not draw wrong."""
    d = obj.to_dict()
    if d.get("v") != DICT_VERSION:
        raise RuntimeError(f"the unseenet core gives version {d.get('v')} dicts; "
                           f"this client knows version {DICT_VERSION}")
    return d


def group_kind(s: Session, gid: str, info: GroupInfo | None = None) -> dict:
    """The core's view of a group, with this client's icons."""
    g = core_dict(info or s.group_info(gid, counts=False))
    gtype = g["type"]
    access = ACCESS_ICONS.get(gtype, "⌂" if g["local"] else "")
    if gtype == "inbox":
        access = "@"
    return {"type": gtype, "access": access, "icon": VIEW_ICONS.get(g["view"], "≡") if gtype else "·",
            "view": g["view"], "owner_view": g["owner_view"],
            "fast": g["low_latency"], "local": g["local"], "encrypted": gtype == "closed"}


def seen_name(s: Session, key_text: str) -> str:
    """The name someone gave themselves in a post we have, for labelling a bare key."""
    for msgs in s.cache.values():
        for m in msgs.values():
            if m.author_key == key_text and m.from_name:
                return m.from_name
    return ""


def group_summary(s: Session, gid: str, info: GroupInfo | None = None) -> dict:
    """A group for the page: the core's group_info(), with labels, the rules as a
    tree and the owner's tools added. ``info`` saves asking the core again."""
    info = info if info is not None and info.unread is not None else s.group_info(gid)
    g = core_dict(info)
    label = s.group_label(gid)                 # names (UN-RFC 0018, 0019), not just the name
    data = s.manifest_data(gid)
    members = []
    if g["owner"] and g["type"] == "closed":
        members = [{"key": k, "label": s.identity_label(k, seen_name(s, k)), "colour": colour(k)}
                   for k in s.members(gid)]
    return {"members": members, "id": gid, "label": label, "hierarchy": label.split("@")[0].split(".")[0],
            "short": g["short"], "title": g["title"],
            "description": g["description"] if g["subscribed"] else data.get("description", ""),
            "rules": data.get("rules", ""),
            # the rules as the TUI shows them: Markdown without images, or plain (UN-RFC 0014 2.1)
            "rules_markdown": markup.is_markdown(data.get("rules_type")),
            "rules_tree": (markup.manifest_text(data.get("rules", ""), data.get("rules_type"))
                           if data.get("rules") else []),
            "owner": g["owner"], "may_post": s.may_post(gid), "listed": g["listed"],
            "unread": g["unread"], "for_you": g["replies"] + g["mentions"],
            "replies": g["replies"], "mentions": g["mentions"],
            "kinds": g["kinds"], **roles(s, gid),            # owner and moderator tools
            **group_kind(s, gid, info)}     # what it takes (UN-RFC 0028)


def for_you(s: Session, gid: str | None = None) -> dict:
    """Unread replies to you and posts naming you, apart (unseenet #170); for_you is the total."""
    c = s.for_you_counts(gid)
    return {"for_you": c.total, "replies": c.replies, "mentions": c.mentions}


def sidebar(s: Session, inbox_ready: bool) -> dict:
    groups = [group_summary(s, g.group_id, g) for g in s.subscribed_groups(counts=True)
              if g.group_id != s.my_inbox and not s.is_data_group(g.group_id)]
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
            "hierarchies": [{"name": h, "groups": gs, "tree": group_tree_dict(h, gs)}
                            for h, gs in sorted(hierarchies.items())]}


def group_tree_dict(top: str, groups: list[dict]) -> dict:
    """The TUI's group tree (unseenet.client.grouptree) for the browser: under ``alt.*``
    names without ``alt.``, and a shared part of a name as a folder. Groups are given by
    ID; the full dicts are in the hierarchy's ``groups``."""
    def walk(node) -> dict:
        return {"label": node.label, "path": node.path, "own": node.own_label,
                "groups": [g["id"] for g in node.items],
                "children": [walk(c) for c in node.children]}
    return walk(group_tree(top, [(g["label"].split("@")[0], g) for g in groups]))


def message(s: Session, m: Message, my_keys: set[str], mine: set[str], patterns: list) -> dict:
    """A message for the page: the core's to_dict(), with who wrote it as this
    client shows it, a colour, the Markdown tree and what the reader may do."""
    d = core_dict(m)
    text, sig = d["text"], d["signature"]
    if m.to_key:
        who, who_key = "You → " + s.identity_label(m.to_key, seen_name(s, m.to_key)), m.to_key
    elif m.private and m.sender_key:
        who, who_key = s.identity_label(m.sender_key, m.from_name), m.sender_key
    else:
        who, who_key = s.identity_label(m.author_key, m.from_name), m.author_key
    me = m.author_key in my_keys or bool(m.to_key)
    return {"id": d["id"], "number": d["number"], "group": d["group"], "subject": d["subject"],
            "who": who, "key": who_key, "colour": colour(who_key), "mine": me,
            "contact": bool(s.contact_name(who_key)) if who_key else False,
            "date": d["date"], "text": text, "signature": sig, "references": d["references"],
            "encrypted": d["encrypted"], "private": d["private"], "verified": bool(d["sender_key"]),
            "kind": d["kind"],                   # a chat line or a post (UN-RFC 0028)
            # the text as a safe tree, Markdown or plain, rendered as the TUI does (UN-RFC 0031)
            "tree": markup.body(text, d["content_type"], d["kind"]) if d["readable"] else [],
            "markdown": markup.is_markdown(d["content_type"]),
            "readable": d["readable"], "error": d["error"], "read": s.is_read(m),
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
        head = {"id": gid, "label": "Private posts", "hierarchy": "", "title":
                "Only you can read these. Nodes see sealed envelopes.", "view": "threads",
                "type": "inbox", "access": "@", "icon": "≡", "encrypted": True, "fast": False,
                "may_post": False, "owner": True, "unread": s.unread_count(gid), "for_you": 0,
                "rules": "", "description": "", "members": [], "private_reply": True}
    elif gid.startswith(CONTACT):
        key = gid[len(CONTACT):]
        head = {"id": gid, "label": s.identity_label(key, seen_name(s, key)), "hierarchy": "", "key": key,
                "title": "Private conversation. Only the two of you can read it.",
                "view": "chat", "type": "contact", "access": "@", "icon": "»", "encrypted": True,
                "fast": False, "may_post": True, "owner": False, "unread": s.unread_from(key, KIND_CHAT),
                "for_you": 0, "rules": "", "description": "", "members": [],
                "contact": bool(s.contact_name(key)), "colour": colour(key)}
    elif gid == FOR_YOU:
        head = {"id": gid, "label": "For you", "hierarchy": "", "title":
                "Replies to your posts and posts that name you, from all your groups",
                "view": "threads", "type": None, "access": "", "icon": "◄", "encrypted": False,
                "fast": False, "may_post": False, "owner": False, "unread": 0, "for_you": 0,
                "rules": "", "description": "", "members": []}
    else:
        head = group_summary(s, gid)
    my_keys = {s.identity(n).key_text for n in s.data["identities"]}
    mine, patterns = s.my_message_ids(), s._mention_patterns()
    if head["view"] == "chat" and not gid.startswith(CONTACT):
        # a group read as a chat: every line in the order it came, not threaded
        rows = [(m, 0) for m in s.visible(sorted(s.cache.get(gid, {}).values(),
                                                  key=lambda m: m.number))]
    else:
        rows = s.threads(core_id(gid))     # the same rows as in every client (#139)
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
