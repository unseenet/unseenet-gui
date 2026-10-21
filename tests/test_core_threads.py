"""Threads, views and chat lines come from the core, as in the TUI (#27, unseenet #139)."""

import asyncio

import unseenet.client.session as sess
from unseenet.client import threads as core_threads
from unseenet.client.session import Session
from unseenet.core.store import Store
from unseenet.core.vault import Vault
from unseenet.node.server import Node, NodeConfig

from unseenet_gui import serialize
from unseenet_gui.runtime import Runtime

KDF = {"ops": 1, "mem": 8192 * 1024}


async def _setup(tmp_path, monkeypatch):
    monkeypatch.setattr(sess, "DEFAULT_POW", 8)
    node = Node(Store(), NodeConfig(min_pow=8, forward_delay=(0, 0)))
    server = await node.serve("127.0.0.1", 0)
    addr = f"127.0.0.1:{server.sockets[0].getsockname()[1]}"
    s = Session(Vault.open(tmp_path / "me.vault", "pw", **KDF), status=lambda *_: None)
    s.new_identity("me", "Me")
    s.add_node(addr)
    rt = Runtime(tmp_path / "me.vault")
    rt.session = s
    events = []
    rt.emit = lambda kind, **kw: events.append((kind, kw))
    return server, s, rt, events


async def _until(cond, tries=100):
    for _ in range(tries):
        if cond():
            return True
        await asyncio.sleep(0.05)
    return False


async def test_group_rows_are_the_cores(tmp_path, monkeypatch):
    server, s, rt, _ = await _setup(tmp_path, monkeypatch)
    gid = await s.create_group("dk.snak", "open", min_pow=8)
    root = await s.post(gid, "Først", "en\n")
    await s.post(gid, "Andet", "to\n")
    await s.post(gid, "Re: Først", "svar\n", references=[root])
    await s.fetch_group(gid)
    page = serialize.group_view(s, gid)
    assert [(m["id"], m["depth"]) for m in page["messages"]] == \
        [(m.message_id, d) for m, d in s.threads(gid)]
    # the thread with the newest post first: the reply made "Først" the newest
    assert [m["subject"] for m in page["messages"]] == ["Først", "Re: Først", "Andet"]
    await s.close()
    server.close()


async def test_views_are_kept_by_the_core(tmp_path, monkeypatch):
    server, s, rt, _ = await _setup(tmp_path, monkeypatch)
    gid = await s.create_group("dk.chat", "open", min_pow=8, view="chat")
    assert serialize.view_of(s, gid) == s.view_of(gid) == "chat"
    rt.set_view(gid, "threads")
    assert s.view_of(gid) == "threads" and s.data["views"][gid] == "threads"
    assert serialize.view_of(s, serialize.FOR_YOU) == "threads"        # "for-you" -> "for-you:"
    assert serialize.core_id(serialize.FOR_YOU) == core_threads.FOR_YOU
    await s.close()
    server.close()


async def test_a_chat_line_goes_through_send_chat(tmp_path, monkeypatch):
    server, s, rt, events = await _setup(tmp_path, monkeypatch)
    gid = await s.create_group("dk.chat", "open", min_pow=8, view="chat")
    sent = []
    original = s.send_chat

    async def spy(group, text):
        sent.append((group, text))
        return await original(group, text)
    s.send_chat = spy
    rt.post(gid, "", "hej alle", [], chat=True)
    assert await _until(lambda: any(k == "post" and kw.get("state") == "reached" for k, kw in events))
    assert sent == [(gid, "hej alle")]
    await s.fetch_group(gid)
    page = serialize.group_view(s, gid)
    assert [m["text"] for m in page["messages"]] == ["hej alle"]          # chat: in order
    await s.close()
    server.close()
