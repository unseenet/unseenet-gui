"""#142: recovery words and copying to another device (UN-RFC 0050) - this client's own
endpoints (identities, the QR code, saving the words) and the screens.

The browser tests run with: pip install -e '.[dev]' playwright; playwright install chromium
"""
import os
import stat

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from unseenet.client.localapi import server as core
from unseenet.client.session import Session
from unseenet.core import recovery as rc
from unseenet.core.vault import Vault

from unseenet_gui.server import qr_svg
from unseenet_gui import server as gs
from unseenet_gui.server import STATIC, build

TOKEN = "t" * 43
KDF = {"ops": 1, "mem": 8192 * 1024}


@pytest.fixture
async def gui(tmp_path, monkeypatch):
    monkeypatch.setattr(gs.Path, "home", classmethod(lambda cls: tmp_path))
    (tmp_path / "Downloads").mkdir()
    path = tmp_path / "me.vault"
    app, api = build(path, TOKEN)
    s = Session(Vault.open(path, "pw", **KDF), status=lambda *_: None)
    s.new_identity("me", "Me")
    s.new_identity("anon", "Anon")
    s.data["nodes"] = ["127.0.0.1:1"]
    api.session = s
    server = TestServer(app, host="127.0.0.1")
    c = TestClient(server)
    await c.start_server()
    app[core.CONF]["port"] = server.port
    c.s, c.tmp = s, tmp_path
    yield c
    await c.close()


def auth(c):
    return {"Host": f"127.0.0.1:{c.server.port}", "X-Unseenet-Token": TOKEN}


async def test_the_identities_to_copy(gui):
    r = await gui.get("/x/gui/state", headers=auth(gui))
    ids = (await r.json())["identities"]
    assert [(i["name"], i["display"], i["default"]) for i in ids] == [("me", "Me", True), ("anon", "Anon", False)]


async def test_a_qr_code_as_svg(gui):
    r = await gui.post("/x/gui/qr", json={"text": "unseenet-copy:1:" + "a" * 56 + ".onion:7-guitar-tunnel"},
                       headers=auth(gui))
    svg = (await r.json())["svg"]
    assert r.status == 200 and svg.startswith("<svg") and "<script" not in svg
    assert (await gui.post("/x/gui/qr", json={"text": ""}, headers=auth(gui))).status == 400


async def test_saving_the_words(gui, monkeypatch):
    r = await gui.post("/x/gui/save-words", json={"passphrase": "wrong"}, headers=auth(gui))
    assert r.status == 400 and "not right" in (await r.json())["error"]
    r = await gui.post("/x/gui/save-words", json={"passphrase": "pw"}, headers=auth(gui))
    assert r.status == 400 and "same disk" in (await r.json())["error"]        # tmp: one disk
    monkeypatch.setattr(gs, "_same_medium", lambda a, b: False)
    r = await gui.post("/x/gui/save-words", json={"passphrase": "pw"}, headers=auth(gui))
    path = (await r.json())["path"]
    assert r.status == 200 and path.startswith(str(gui.tmp / "Downloads"))
    text = open(path, encoding="utf-8").read()
    assert " ".join(rc.words_from_seed(gui.s.identity().seed)[:1]) in text and "do NOT come back" in text
    if os.name == "posix":
        assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    monkeypatch.setattr(gs.system, "enabled", lambda: True)                    # the bootable image
    r = await gui.post("/x/gui/save-words", json={"passphrase": "pw"}, headers=auth(gui))
    assert r.status == 400 and "paper" in (await r.json())["error"]


# --- the screens ---------------------------------------------------------------------------

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect
WORDS = rc.words_from_seed(bytes(range(32)))


class FakeAPI:
    def __init__(self, setup=True):
        self.setup, self.calls = setup, []

    async def handle(self, request):
        path = request.path
        body = await request.json() if request.method == "POST" and request.can_read_body else {}
        self.calls.append((path, body))
        if path == "/api/state":
            ident = None if self.setup else {"key": "ed25519:" + "a" * 52, "display": "Andreas", "label": "Andreas",
                                              "words_written": False, "words_reminder": False}
            data = {"api": 1, "unlocked": True, "setup": self.setup, "connected": False, "status": "",
                    "identity": ident, "node": None if self.setup else "127.0.0.1:1", "nodes": []}
        elif path == "/x/gui/state":
            data = {"bootable": False, "web": False, "identities": [{"name": "andreas", "display": "Andreas", "default": True}]}
        elif path == "/api/known-nodes":
            data = {"nodes": [{"address": "aaaa.onion:119", "name": "node3", "description": "", "operator": ""}]}
        elif path == "/api/recovery/check":
            ok = body.get("words", "").split() == WORDS
            data = {"ok": True, "words": WORDS} if ok else {"ok": False, "kind": "checksum",
                                                             "error": "The words do not fit together: one is probably mistyped.",
                                                             "position": None}
        elif path == "/api/recovery/restore":
            data = {"identity": "restored", "new": True, "state": "read", "fingerprint": "abcd", "key": "k", "label": "",
                    "profile": None, "note": "", "closed_groups": [{"group": "familie@x", "label": "familie",
                                                                   "owner": "ed25519:o", "mine": False}]}
        elif path == "/api/recovery/words":
            if body.get("passphrase") != "pw":
                return web.json_response({"error": "The passphrase is not right."}, status=400)
            data = {"identity": "andreas", "fingerprint": "abcdabcdabcdabcd", "words": WORDS, "check": [2, 9, 20],
                    "note": "Closed groups do not come back with recovery words.", "not_a_wallet": "Not a wallet.",
                    "title": "Unseenet recovery words", "page": ""}
        elif path == "/api/copy/offer":
            data = {"role": "old", "state": "waiting", "code": "7-guitar-tunnel",
                    "qr": "unseenet-copy:1:" + "a" * 56 + ".onion:7-guitar-tunnel", "expires": 9999999999,
                    "check_words": [], "error": "", "added": []}
        elif path == "/x/gui/qr":                  # the real drawing (#247)
            data = {"svg": qr_svg((await request.json())["text"])}
        else:
            data = {}
        return web.json_response(data)


async def _page(api):
    app = web.Application()

    async def index(_request):
        return web.FileResponse(STATIC / "index.html")
    app.router.add_get("/", index)
    app.router.add_static("/static/", STATIC)
    app.router.add_route("*", "/api/{path:.*}", api.handle)
    app.router.add_route("*", "/x/gui/{path:.*}", api.handle)
    return app


@pytest.fixture
async def browser():
    async with playwright.async_playwright() as p:
        b = await p.chromium.launch()
        yield b
        await b.close()


async def test_first_start_restores_from_words(browser):
    api = FakeAPI(setup=True)
    async with TestServer(await _page(api), host="127.0.0.1") as server:
        page = await browser.new_page(viewport={"width": 1100, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
        await page.get_by_role("button", name="Restore from recovery words").click()
        words = page.locator("#rwords")
        await words.fill(" ".join(WORDS[:10]))
        await expect(page.get_by_text("10 of 24 words")).to_be_visible()
        await words.fill(" ".join(WORDS[::-1]))
        await expect(page.get_by_text("do not fit together")).to_be_visible()
        await words.fill(" ".join(WORDS))
        await expect(page.get_by_text("The words fit together.")).to_be_visible()
        await page.get_by_role("button", name="Start").click()
        await expect(page.get_by_text("Your identity is back")).to_be_visible()
        restore = [b for p, b in api.calls if p == "/api/recovery/restore"][0]
        assert restore["words"].split() == WORDS and restore["node"] == "aaaa.onion:119"
        await expect(page.get_by_text("familie")).to_be_visible()
        await page.get_by_role("button", name="Ask the owners to invite me").click()
        await expect(page.get_by_text("Asked 1 owner(s)")).to_be_visible()
        assert ("/api/recovery/ask", {"group": "familie@x"}) in api.calls
        assert errors == []


async def test_show_words_behind_the_passphrase_and_check_three(browser):
    api = FakeAPI(setup=False)
    async with TestServer(await _page(api), host="127.0.0.1") as server:
        page = await browser.new_page(viewport={"width": 1100, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
        await page.wait_for_function("typeof openShowWords === 'function' && typeof S !== 'undefined' && S.state && S.state.me")
        await page.evaluate("openShowWords(false)")
        await page.locator("#rwpw").fill("wrong")
        await page.get_by_role("button", name="Show", exact=True).click()
        await expect(page.get_by_role("alert").filter(has_text="not right")).to_be_visible()
        await page.locator("#rwpw").fill("pw")
        await page.get_by_role("button", name="Show", exact=True).click()
        await expect(page.locator("ol.words li")).to_have_count(24)
        await expect(page.get_by_text("Closed groups do not come back")).to_be_visible()
        await page.get_by_role("button", name="I wrote them down").click()
        for p in (2, 9, 20):
            await page.locator(f"#cw{p}").fill("nope")
        await page.get_by_role("button", name="Check", exact=True).click()
        await expect(page.get_by_text("does not match")).to_be_visible()
        for p in (2, 9, 20):
            await page.locator(f"#cw{p}").fill(WORDS[p - 1][:4].upper())
        await page.get_by_role("button", name="Check", exact=True).click()
        await expect(page.get_by_text("Your recovery words are written down.")).to_be_visible()
        assert ("/api/recovery/written", {}) in api.calls
        assert errors == []


async def test_copy_to_shows_the_code_and_the_qr_code(browser):
    api = FakeAPI(setup=False)
    async with TestServer(await _page(api), host="127.0.0.1") as server:
        page = await browser.new_page(viewport={"width": 1100, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
        await page.wait_for_function("typeof openCopyTo === 'function' && typeof S !== 'undefined' && S.state && S.state.me")
        await page.evaluate("openCopyTo()")
        await page.get_by_role("button", name="Show the code").click()
        await expect(page.get_by_text("7-guitar-tunnel")).to_be_visible()
        await expect(page.locator("svg.qr")).to_be_visible()
        offer = [b for p, b in api.calls if p == "/api/copy/offer"][0]
        assert offer == {"identities": ["andreas"], "group_secrets": True}
        await page.evaluate("copyEvent({event: 'copy', role: 'old', state: 'check', check_words: ['ocean', 'zebra']})")
        await expect(page.get_by_text("ocean   zebra")).to_be_visible()
        await expect(page.get_by_role("button", name="The words match")).to_be_visible()
        assert errors == []


class WebAPI(FakeAPI):
    """The GUI in a browser through an entrance (#234): the copy only where it relays it."""
    def __init__(self, copy):
        super().__init__(setup=True)
        self.copy = copy

    async def handle(self, request):
        if request.path == "/x/gui/state":
            return web.json_response({"bootable": False, "web": True, "identities": []})
        return await super().handle(request)


@pytest.mark.parametrize("copy", [True, False])
async def test_in_a_browser_copy_is_offered_only_where_the_entrance_relays_it(browser, copy):
    api = WebAPI(copy)
    app = await _page(api)

    async def info(_request):
        return web.json_response({"operator": "", "copy": copy})
    app.router.add_get("/.well-known/unseenet-entrance", info)
    async with TestServer(app, host="127.0.0.1") as server:
        page = await browser.new_page(viewport={"width": 1100, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
        await expect(page.get_by_role("button", name="Restore from recovery words")).to_be_visible()
        await page.wait_for_timeout(500)                 # the entrance has answered
        assert await page.get_by_role("button", name="Get it from another device").count() == (1 if copy else 0)
        assert errors == []


class LockedAPI(FakeAPI):
    """A vault not opened yet: new (``exists`` False) or one to unlock."""
    def __init__(self, exists, web=False, copy=True):
        super().__init__(setup=True)
        self.exists, self.web, self.copy = exists, web, copy

    async def handle(self, request):
        if request.path == "/api/state":
            return web.json_response({"api": 1, "unlocked": False, "vault_exists": self.exists,
                                      "vault": "unseenet.vault", "setup": True})
        if request.path == "/x/gui/state":
            return web.json_response({"bootable": False, "web": self.web, "identities": []})
        return await super().handle(request)


@pytest.mark.parametrize("exists,in_browser,copy,shown", [
    (False, False, True, True),         # the app, a new vault: say where the copy comes
    (False, True, True, True),          # a browser whose entrance passes copies on
    (False, True, False, False),        # one whose entrance does not: not offered at all
    (True, False, True, False),         # unlocking a vault: nothing to bring over
])
async def test_the_new_vault_says_the_copy_comes_next(browser, exists, in_browser, copy, shown):
    """29 Oct, live: someone bringing an identity from another device did not find
    *Get it from another device*, which comes after the vault is made."""
    app = await _page(LockedAPI(exists, in_browser, copy))

    async def info(_request):
        return web.json_response({"operator": "", "copy": copy})
    app.router.add_get("/.well-known/unseenet-entrance", info)
    async with TestServer(app, host="127.0.0.1") as server:
        page = await browser.new_page(viewport={"width": 1100, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
        await expect(page.locator("#pass")).to_be_visible()
        await page.wait_for_timeout(500)
        assert await page.locator("[data-k=copy-hint]").count() == (1 if shown else 0)
        assert errors == []



@pytest.mark.parametrize("width,height", [(1100, 900), (390, 844)])
async def test_the_qr_code_shown_can_be_read(browser, width, height):
    """#247: the QR code in *Copy to another device* was cut off by its box (two of three
    corner marks gone) and no phone could read it. Read back what is on screen."""
    zxingcpp = pytest.importorskip("zxingcpp")
    from io import BytesIO
    from PIL import Image
    api = FakeAPI(setup=False)
    async with TestServer(await _page(api), host="127.0.0.1") as server:
        page = await browser.new_page(viewport={"width": width, "height": height})
        await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
        await page.wait_for_function("typeof openCopyTo === 'function' && typeof S !== 'undefined' && S.state && S.state.me")
        await page.evaluate("openCopyTo()")
        await page.get_by_role("button", name="Show the code").click()
        qr = page.locator("svg.qr")
        await expect(qr).to_be_visible()
        shot = Image.open(BytesIO(await qr.screenshot()))
        found = zxingcpp.read_barcodes(shot)
        assert [r.text for r in found] == ["unseenet-copy:1:" + "a" * 56 + ".onion:7-guitar-tunnel"]
