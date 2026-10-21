"""Startup, refresh and push are the core's ClientRuntime (#30, unseenet #139)."""

from unseenet.client.session import Session
from unseenet.core.vault import Vault

from test_core_threads import KDF, _setup, _until


async def test_the_core_runtime_starts_refreshes_and_pushes(tmp_path, monkeypatch):
    server, s, rt, events = await _setup(tmp_path, monkeypatch)
    s.on(rt._on_core_event)
    gid = await s.create_group("dk.snak", "open", min_pow=8)
    await rt.start()
    assert await _until(lambda: rt.connected and rt._inbox_ready)
    assert rt.status.startswith("Connected to")
    # someone else posts: it arrives by push, without waiting for the minute's refresh
    addr = s.nodes[0]
    other = Session(Vault.open(tmp_path / "other.vault", "pw", **KDF), status=lambda *_: None)
    other.new_identity("other", "Other")
    other.add_node(addr)
    assert await _until(lambda: addr in rt.core._watching)
    events.clear()
    await other.post(gid, "Nyt", "via push\n")
    assert await _until(lambda: ("group", {"id": gid}) in events, 200)
    assert any(m.subject == "Nyt" for m in s.cache[gid].values())
    await rt.close()
    assert rt.core is None and rt.session is None
    await other.close()
    server.close()


async def test_offline_says_so(tmp_path, monkeypatch):
    server, s, rt, events = await _setup(tmp_path, monkeypatch)
    s.on(rt._on_core_event)
    server.close()
    await server.wait_closed()
    s.nodes[:] = ["127.0.0.1:1"]
    await rt.start()
    assert await _until(lambda: rt.status.startswith("Offline"))
    assert not rt.connected
    await rt.close()
