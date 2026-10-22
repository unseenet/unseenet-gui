"""/x/gui/: write permission (#13), passphrase (#32) and profiles (#20)."""

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
    r = await gui.get(f"/x/gui/write/{gid}", headers=auth(gui))
    w = await r.json()
    assert r.status == 200
    assert w["post"]["allowed"] is False and w["post"]["code"] == "channel_thread"
    assert "comment" in w["post"]["reason"]
    assert w["chat"]["allowed"] is False and w["chat"]["code"] == "kind"


async def test_banned_is_said_before_writing(gui):
    gid = channel(gui.s, posters=[gui.s.identity().key_text])
    gui.s.data["groups"][gid]["manifest"]["banned"] = [
        {"key": gui.s.identity().key_text, "reason": "spam"}]
    w = await (await gui.get(f"/x/gui/write/{gid}", headers=auth(gui))).json()
    assert w["post"] == {"allowed": False, "code": "banned",
                         "reason": "You are banned from this group: spam"}


async def test_pseudo_groups_have_no_write_rules(gui):
    for gid in ("for-you:", "contact:ed25519:abc", gui.s.my_inbox):
        r = await gui.get(f"/x/gui/write/{gid}", headers=auth(gui))
        assert r.status == 200 and await r.json() == {}


async def test_change_passphrase(gui, tmp_path):
    r = await gui.post("/x/gui/passphrase", json={"old": "wrong", "new": "new-pass"}, headers=auth(gui))
    assert r.status == 400 and "not right" in (await r.json())["error"]
    r = await gui.post("/x/gui/passphrase", json={"old": "old-pass", "new": "ab"}, headers=auth(gui))
    assert r.status == 400 and "short" in (await r.json())["error"]
    r = await gui.post("/x/gui/passphrase", json={"old": "old-pass", "new": "new-pass"}, headers=auth(gui))
    assert r.status == 200
    assert gui.s.vault.check_passphrase("new-pass") and not gui.s.vault.check_passphrase("old-pass")


async def test_my_profile_before_the_first_says_why_to_think(gui):
    r = await gui.get("/x/gui/profile", headers=auth(gui))
    p = await r.json()
    assert r.status == 200 and p["mine"] and p["published"] is False
    assert "cannot be fully taken back" in p["warning"] and "web" in p["link_kinds"]


async def test_hiding_someone_elses_profile(gui):
    other = crypto.Identity.generate().key_text
    r = await gui.post("/x/gui/profile/hide", json={"key": other, "hidden": True}, headers=auth(gui))
    assert r.status == 200 and (await r.json())["hidden"] is True
    p = await (await gui.get("/x/gui/profile", params={"key": other}, headers=auth(gui))).json()
    assert p["hidden"] is True and p["profile"] is None          # not even asked for
    r = await gui.post("/x/gui/profile/hide", json={"key": gui.s.identity().key_text}, headers=auth(gui))
    assert r.status == 400


async def test_a_bad_profile_is_refused_before_publishing(gui):
    r = await gui.post("/x/gui/profile", json={"about": "hi", "links": [{"kind": "nope", "value": "x"}]},
                       headers=auth(gui))
    assert r.status == 400 and "kind" in (await r.json())["error"]


async def test_locked_vault(tmp_path):
    app, _api = build(tmp_path / "x.vault", TOKEN)
    server = TestServer(app, host="127.0.0.1")
    c = TestClient(server)
    await c.start_server()
    app[core.CONF]["port"] = server.port
    for path in ("/x/gui/write/abc", "/x/gui/profile"):
        assert (await c.get(path, headers=auth(c))).status in (401, 409)
    await c.close()
