"""The local server's guards: token, Host, Origin, static files and headers."""

import pytest
from aiohttp.test_utils import TestClient, TestServer

from unseenet_gui.runtime import Runtime
from unseenet_gui.server import make_app

TOKEN = "t" * 43


@pytest.fixture
async def client(tmp_path):
    app = make_app(Runtime(tmp_path / "test.vault"), TOKEN)
    server = TestServer(app, host="127.0.0.1")
    c = TestClient(server)
    await c.start_server()
    app["conf"]["port"] = server.port
    yield c
    await c.close()


def host(c):
    return {"Host": f"127.0.0.1:{c.server.port}"}


async def test_api_needs_the_token(client):
    r = await client.get("/api/state", headers=host(client))
    assert r.status == 401
    r = await client.get("/api/state", headers={**host(client), "X-Unseenet-Token": "wrong"})
    assert r.status == 401


async def test_api_with_token(client):
    r = await client.get("/api/state", headers={**host(client), "X-Unseenet-Token": TOKEN})
    assert r.status == 200
    data = await r.json()
    assert data["unlocked"] is False and data["vault_exists"] is False


async def test_about_before_unlocking(client):
    """The plain-words About comes from the core and can be read before the vault is open."""
    r = await client.get("/api/about", headers={**host(client), "X-Unseenet-Token": TOKEN})
    assert r.status == 200
    data = await r.json()
    assert data["sections"] and data["status"]["title"] and data["links"]["source"]
    assert {c["name"] for c in data["comparisons"]["items"]} >= {"Discord", "Matrix", "Nostr"}


async def test_other_hosts_are_refused(client):
    """DNS rebinding: a page on evil.example resolving to 127.0.0.1 sends its own Host."""
    r = await client.get("/", headers={"Host": f"evil.example:{client.server.port}"})
    assert r.status == 421


async def test_other_origins_are_refused(client):
    r = await client.get("/api/state", headers={**host(client), "X-Unseenet-Token": TOKEN,
                                                "Origin": "http://evil.example"})
    assert r.status == 403


async def test_page_has_a_strict_csp(client):
    r = await client.get("/", headers=host(client))
    assert r.status == 200
    csp = r.headers["Content-Security-Policy"]
    assert "default-src 'none'" in csp and "script-src 'self'" in csp
    assert "unsafe" not in csp
    assert r.headers["Referrer-Policy"] == "no-referrer"


@pytest.mark.parametrize("name", ["..%2Fserver.py", ".hidden.js", "app.py", "nope.js"])
async def test_static_serves_only_its_own_files(client, name):
    r = await client.get(f"/static/{name}", headers=host(client))
    assert r.status == 404


async def test_locked_session_refuses_reading(client):
    r = await client.get("/api/groups", headers={**host(client), "X-Unseenet-Token": TOKEN})
    assert r.status == 409


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/moderation"), ("POST", "/api/moderation"),
    ("POST", "/api/groups/x/edit"), ("POST", "/api/groups/x/remove"),
    ("POST", "/api/groups/x/role"), ("POST", "/api/groups/x/ban"),
    ("POST", "/api/groups/x/withdraw"), ("GET", "/api/groups/x/report"),
    ("POST", "/api/groups/x/report"),
    ("GET", "/api/names"), ("POST", "/api/names"), ("GET", "/api/ignore"), ("POST", "/api/ignore"),
    ("POST", "/api/groups/x/block"), ("POST", "/api/show-blocked"),
    ("POST", "/api/groups/x/members/remove"), ("POST", "/api/markdown")])
async def test_owner_tools_need_the_token_and_an_open_vault(client, method, path):
    """The owner's and moderators' tools are behind the same guards as everything else."""
    r = await client.request(method, path, headers=host(client), json={})
    assert r.status == 401
    r = await client.request(method, path, headers={**host(client), "X-Unseenet-Token": TOKEN}, json={})
    assert r.status == 409                                   # the vault is locked


def test_update_offer_only_where_it_can_update(tmp_path, monkeypatch):
    """unseenet#264: a newer signed release is shown; the button only on a stick or folder."""
    from unseenet import __version__
    from unseenet.client.session import Session
    from unseenet.core.vault import Vault
    import unseenet.update
    rt = Runtime(tmp_path / "v.vault")
    rt.session = Session(Vault.open(tmp_path / "v.vault", "pw", ops=1, mem=8192 * 1024),
                         status=lambda *_: None)
    assert rt.update_info() is None
    channel = "dev" if ".dev" in __version__ else "stable"
    rt.session.data["releases"] = {channel: {"version": "99.0"}}
    monkeypatch.setattr(unseenet.update, "find_stick", lambda: None)
    assert rt.update_info() == {"version": "99.0", "channel": channel, "here": False}
    rt._stick = tmp_path
    assert rt.update_info()["here"] is True
