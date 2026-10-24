"""What the page reads from the core's local API since #59 (unseenet#320): write
permission (#13), the passphrase (#32) and profiles (#20) - and that this client
no longer serves its own copies under /x/gui/."""

import pytest
from aiohttp.test_utils import TestClient, TestServer
from unseenet.client.localapi import server as core
from unseenet.client.session import Session
from unseenet.core import crypto
from unseenet.core.groups import make_group_id
from unseenet.core.vault import Vault

from unseenet_gui.server import build

TOKEN = "t" * 43
KDF = {"ops": 1, "mem": 8192 * 1024}


@pytest.fixture
async def gui(tmp_path):
    path = tmp_path / "me.vault"
    app, api = build(path, TOKEN)
    s = Session(Vault.open(path, "old-pass", **KDF), status=lambda *_: None)
    s.new_identity("me", "Me")
    s.data["nodes"] = ["127.0.0.1:1"]          # set up: the core serves a set-up vault only
    api.session = s
    server = TestServer(app, host="127.0.0.1")
    c = TestClient(server)
    await c.start_server()
    app[core.CONF]["port"] = server.port
    c.s = s
    yield c
    await c.close()


def auth(c):
    return {"Host": f"127.0.0.1:{c.server.port}", "X-Unseenet-Token": TOKEN}


def channel(s, *, comments="open", posters=()):
    owner = crypto.Identity.generate()
    gid = make_group_id("dk.news", owner.public_key)
    s.data["groups"][gid] = {"type": "channel", "manifest": {
        "type": "channel", "owner": owner.key_text, "posters": list(posters),
        "comments": comments, "kinds": ["post"]}}
    return gid


async def test_a_reader_in_a_channel_may_comment_but_not_start_threads(gui):
    gid = channel(gui.s)
    r = await gui.get(f"/api/groups/{gid}", headers=auth(gui))
    assert r.status == 200
    w = (await r.json())["group"]["write"]
    assert w["post"]["allowed"] is False and w["post"]["code"] == "channel_thread"
    assert "comment" in w["post"]["reason"]
    assert w["chat"]["allowed"] is False and w["chat"]["code"] == "kind"


async def test_banned_is_said_before_writing(gui):
    gid = channel(gui.s, posters=[gui.s.identity().key_text])
    gui.s.data["groups"][gid]["manifest"]["banned"] = [
        {"key": gui.s.identity().key_text, "reason": "spam"}]
    w = (await (await gui.get(f"/api/groups/{gid}", headers=auth(gui))).json())["group"]["write"]
    assert w["post"] == {"allowed": False, "code": "banned",
                         "reason": "You are banned from this group: spam"}


async def test_pseudo_groups_have_no_write_rules(gui):
    for gid in ("for-you:", gui.s.my_inbox):
        r = await gui.get(f"/api/groups/{gid}", headers=auth(gui))
        assert r.status == 200 and "write" not in (await r.json())["group"]


async def test_change_passphrase(gui, tmp_path):
    r = await gui.post("/api/passphrase", json={"old": "wrong", "new": "new-pass"}, headers=auth(gui))
    assert r.status == 400 and "not right" in (await r.json())["error"]
    r = await gui.post("/api/passphrase", json={"old": "old-pass", "new": "ab"}, headers=auth(gui))
    assert r.status == 400 and "short" in (await r.json())["error"]
    r = await gui.post("/api/passphrase", json={"old": "old-pass", "new": "new-pass"}, headers=auth(gui))
    assert r.status == 200
    assert gui.s.vault.check_passphrase("new-pass") and not gui.s.vault.check_passphrase("old-pass")


async def test_my_profile_before_the_first_says_why_to_think(gui):
    r = await gui.get("/api/profile", headers=auth(gui))
    p = await r.json()
    assert r.status == 200 and p["mine"] and p["published"] is False
    assert "cannot be fully taken back" in p["warning"] and "web" in p["link_kinds"]


async def test_hiding_someone_elses_profile(gui):
    other = crypto.Identity.generate().key_text
    r = await gui.post("/api/profile/hide", json={"key": other, "hidden": True}, headers=auth(gui))
    assert r.status == 200 and (await r.json())["hidden"] is True
    p = await (await gui.get("/api/profile", params={"key": other}, headers=auth(gui))).json()
    assert p["hidden"] is True and p["profile"] is None          # not even asked for
    r = await gui.post("/api/profile/hide", json={"key": gui.s.identity().key_text}, headers=auth(gui))
    assert r.status == 400


async def test_a_bad_profile_is_refused_before_publishing(gui):
    r = await gui.post("/api/profile", json={"edit": {"about": "hi", "links": [{"kind": "nope", "value": "x"}]}},
                       headers=auth(gui))
    assert r.status == 400 and "kind" in (await r.json())["error"]


async def test_locked_vault(tmp_path):
    app, _api = build(tmp_path / "x.vault", TOKEN)
    server = TestServer(app, host="127.0.0.1")
    c = TestClient(server)
    await c.start_server()
    app[core.CONF]["port"] = server.port
    for path in ("/api/groups/abc", "/api/profile"):
        assert (await c.get(path, headers=auth(c))).status in (401, 409)
    await c.close()


async def test_the_copies_are_gone(gui):
    """The core serves these now; the page must not find them here (#59)."""
    for method, path in (("GET", "/x/gui/write/abc"), ("POST", "/x/gui/passphrase"),
                         ("GET", "/x/gui/profile"), ("POST", "/x/gui/profile"),
                         ("POST", "/x/gui/profile/hide")):
        r = await gui.request(method, path, json={} if method == "POST" else None, headers=auth(gui))
        assert r.status in (404, 405)
