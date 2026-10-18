"""The owner's and moderators' tools against a real node (the same core calls as the TUI)."""

import pytest

import unseenet.client.session as sess
from unseenet.client.session import Session
from unseenet.core.store import Store
from unseenet.core.vault import Vault
from unseenet.node.server import Node, NodeConfig

from unseenet_web import serialize
from unseenet_web.runtime import Runtime

KDF = {"ops": 1, "mem": 8192 * 1024}


async def test_edit_ban_roles_withdraw_and_moderate(tmp_path, monkeypatch):
    monkeypatch.setattr(sess, "DEFAULT_POW", 8)
    node = Node(Store(), NodeConfig(min_pow=8, forward_delay=(0, 0)))
    server = await node.serve("127.0.0.1", 0)
    addr = f"127.0.0.1:{server.sockets[0].getsockname()[1]}"

    def session(name):
        s = Session(Vault.open(tmp_path / f"{name}.vault", "pw", **KDF), status=lambda *_: None)
        s.new_identity(name, name.title()); s.add_node(addr)
        return s

    owner, other = session("owner"), session("other")
    await owner.ensure_inbox(); await other.ensure_inbox()
    rt = Runtime(tmp_path / "owner.vault")
    rt.session = owner
    rt.emit = lambda *a, **k: None                      # no browser listening in a test

    gid = await owner.create_group("dk.test", "open", min_pow=8)
    await rt.edit_group(gid, {"title": "Om test", "kinds": ["post"]})
    head = serialize.group_summary(owner, gid)
    assert head["title"] == "Om test" and head["kinds"] == ["post"]

    key = other.identity().key_text
    await rt.ban(gid, key, True, "spam")
    assert [(b["key"], b["reason"]) for b in serialize.roles(owner, gid)["banned"]] == [(key, "spam")]
    await rt.ban(gid, key, False)
    await rt.set_role(gid, "moderators", key, True)
    assert [p["key"] for p in serialize.roles(owner, gid)["moderators"]] == [key]

    msgid = await owner.post(gid, "Et indlæg", "tekst\n")
    await owner.fetch_group(gid)
    await rt.withdraw(gid, msgid)
    with pytest.raises(sess.SessionError):
        await rt.withdraw(gid, "<nope@unseenet>")

    # a moderated group: a submission waits for the owner, who approves it
    mod = await owner.create_group("dk.moderated", "moderated", min_pow=8)
    other.subscribe(mod); await other.fetch_group(mod)
    await other.post(mod, "Må jeg?", "Et forslag\n")
    waiting = await rt.moderation()
    assert [w["subject"] for w in waiting] == ["Må jeg?"]
    await rt.moderate(waiting[0]["id"], True)
    assert await rt.moderation() == []
    assert "Må jeg?" in [m.subject for m in owner.cache[mod].values()]

    await rt.remove_group(gid)
    assert gid not in owner.data["groups"]
    await owner.close(); await other.close()
    server.close()


async def test_ignore_names_and_members(tmp_path, monkeypatch):
    monkeypatch.setattr(sess, "DEFAULT_POW", 8)
    node = Node(Store(), NodeConfig(min_pow=8, forward_delay=(0, 0)))
    server = await node.serve("127.0.0.1", 0)
    addr = f"127.0.0.1:{server.sockets[0].getsockname()[1]}"

    def session(name):
        s = Session(Vault.open(tmp_path / f"{name}.vault", "pw", **KDF), status=lambda *_: None)
        s.new_identity(name, name.title()); s.add_node(addr)
        return s

    owner, other = session("owner"), session("other")
    await owner.ensure_inbox(); await other.ensure_inbox()
    rt = Runtime(tmp_path / "owner.vault")
    rt.session = owner
    rt.emit = lambda *a, **k: None
    key = other.identity().key_text

    rt.ignore(key, "Other", True)
    assert [p["key"] for p in rt.ignored()] == [key]
    rt.ignore(key, "", False)
    assert rt.ignored() == []

    data = serialize.names(owner)                      # no registrar here: nothing, but no error
    assert data["mine"] == [] and data["parents"] == [] and data["key"] == owner.identity().key_text
    with pytest.raises(ValueError):
        await rt.name_action({"action": "claim", "name": "NOT A NAME"})

    gid = await owner.create_group("dk.lukket", "closed", min_pow=8)
    await owner.invite(gid, key)
    assert key in owner.members(gid)
    epoch = await rt.remove_member(gid, key)
    assert epoch >= 2 and key not in owner.members(gid)
    assert serialize.roles(owner, gid)["maintainer"] is False
    await owner.close(); await other.close()
    server.close()
