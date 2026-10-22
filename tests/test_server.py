"""The GUI's server: the core's API with its guards, the page, and /x/gui/."""

import pytest
from aiohttp.test_utils import TestClient, TestServer
from unseenet.client.localapi import server as core

from unseenet_gui import update
from unseenet_gui.server import build

TOKEN = "t" * 43


@pytest.fixture
async def client(tmp_path):
    app, _api = build(tmp_path / "test.vault", TOKEN)
    server = TestServer(app, host="127.0.0.1")
    c = TestClient(server)
    await c.start_server()
    app[core.CONF]["port"] = server.port
    yield c
    await c.close()


def host(c):
    return {"Host": f"127.0.0.1:{c.server.port}"}


def auth(c):
    return {**host(c), "X-Unseenet-Token": TOKEN}


async def test_api_and_extension_need_the_token(client):
    for path in ("/api/state", "/x/gui/state"):
        assert (await client.get(path, headers=host(client))).status == 401
        assert (await client.get(path, headers={**host(client), "X-Unseenet-Token": "w" * 43})).status == 401


async def test_state_from_the_core_and_the_gui(client):
    r = await client.get("/api/state", headers=auth(client))
    data = await r.json()
    assert r.status == 200 and data["api"] == 1 and data["unlocked"] is False
    assert data["vault_exists"] is False
    r = await client.get("/x/gui/state", headers=auth(client))
    gui = await r.json()
    assert gui["vault"].endswith("test.vault") and gui["bootable"] is False
    assert gui["update"] is None and gui["fp"] is None


async def test_about_before_unlocking(client):
    """The plain-words About comes from the core and can be read before the vault is open."""
    r = await client.get("/api/about", headers=auth(client))
    data = await r.json()
    assert r.status == 200 and data["sections"] and data["links"]["source"]
    assert {c["name"] for c in data["comparisons"]["items"]} >= {"Discord", "Matrix", "Nostr"}


async def test_other_hosts_and_origins_are_refused(client):
    """DNS rebinding: a page on evil.example resolving to 127.0.0.1 sends its own Host."""
    r = await client.get("/", headers={"Host": f"evil.example:{client.server.port}"})
    assert r.status == 403
    r = await client.get("/api/state", headers={**auth(client), "Origin": "http://evil.example"})
    assert r.status == 403


async def test_page_and_its_files_have_a_strict_csp(client):
    r = await client.get("/", headers=host(client))
    assert r.status == 200 and b"app.js" in await r.read()
    csp = r.headers["Content-Security-Policy"]
    assert "default-src 'none'" in csp and "script-src 'self'" in csp and "unsafe" not in csp
    assert r.headers["Referrer-Policy"] == "no-referrer"
    r = await client.get("/static/app.js", headers=host(client))
    assert r.status == 200 and r.content_type == "text/javascript"


@pytest.mark.parametrize("name", ["..%2Fserver.py", ".hidden.js", "app.py", "nope.js"])
async def test_static_serves_only_its_own_files(client, name):
    assert (await client.get(f"/static/{name}", headers=host(client))).status == 404


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/groups"), ("GET", "/api/moderation"), ("POST", "/api/groups/x/settings"),
    ("POST", "/api/groups/x/remove"), ("POST", "/api/groups/x/role"), ("POST", "/api/groups/x/ban"),
    ("POST", "/api/groups/x/withdraw"), ("GET", "/api/names"), ("GET", "/api/ignore"),
    ("POST", "/api/settings"), ("POST", "/x/gui/update")])
async def test_everything_needs_the_token_and_an_open_vault(client, method, path):
    assert (await client.request(method, path, headers=host(client), json={})).status == 401
    assert (await client.request(method, path, headers=auth(client), json={})).status == 409


async def test_system_routes_only_on_the_bootable_image(client):
    assert (await client.get("/x/gui/system", headers=auth(client))).status == 404


def test_update_offer_only_where_it_can_update(tmp_path, monkeypatch):
    """unseenet#264: a newer signed release is shown; the button only on a stick or folder."""
    from unseenet import __version__
    import unseenet.update
    from unseenet.client.session import Session
    from unseenet.core.vault import Vault
    monkeypatch.setattr(update, "UPDATES", True)                  # off for now (unseenet#264)
    s = Session(Vault.open(tmp_path / "v.vault", "pw", ops=1, mem=8192 * 1024),
                status=lambda *_: None)
    u = update.Updater()
    assert u.info(s) is None
    channel = "dev" if ".dev" in __version__ else "stable"
    s.data["releases"] = {channel: {"version": "99.0"}}
    monkeypatch.setattr(unseenet.update, "find_stick", lambda: None)
    assert u.info(s) == {"version": "99.0", "channel": channel, "here": False}
    u._stick = tmp_path
    assert u.info(s)["here"] is True
