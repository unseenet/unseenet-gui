"""Your own rules (unseenet#615, UN-RFC 0051, UN-RFC 0046 section 4.20) against a synthetic
local API: a thread list as the rules have it (hidden, folded and opened, dimmed,
highlighted, the score), Why? and watching a thread from the ⋯ menu, seen sent, and the
editor - the suggestion when there are none, checked as you type, saved.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_rules.py
"""

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43
GROUP = "dk.snak@abcd"
SUGGESTION = "# a suggestion\n[feed]\n+10 if author in following\n"


def row(mid, subject, depth=0, refs=(), score=None, actions=(), hidden=False, minute=0):
    r = {"who": "Someone", "who_key": "ed25519:other", "mine": False, "may_edit": False,
         "may_withdraw": False, "read": True, "depth": depth, "address": f"unseenet:{mid}",
         "message": {"id": mid, "group": GROUP, "subject": subject, "text": subject,
                     "signature": "", "references": list(refs), "kind": "post", "readable": True,
                     "sender_key": "ed25519:other", "private": False,
                     "date": f"2026-10-26T12:{minute:02d}:00Z"}}
    if score is not None:
        r.update(score=score, actions=list(actions), hidden=hidden,
                 why=f"line 1: rule  → {score:+d}\nscore {score}", thread_mark="" if depth == 0 else None)
    return r


class RulesAPI:
    def __init__(self, rules: bool):
        self.rules, self.text, self.on = rules, "", True
        self.requests = []

    def rows(self):
        if not self.rules:
            return [row("<k@x>", "kage"), row("<p@x>", "politik", minute=1)]
        return [row("<k@x>", "kage", score=20, actions=["highlight"]),
                row("<k2@x>", "re: kage", 1, ["<k@x>"], score=0, minute=2),
                row("<p@x>", "politik", score=-50, hidden=True, minute=1),
                row("<f@x>", "langt", score=-5, actions=["fold", "dim"], minute=3),
                row("<f2@x>", "re: langt", 1, ["<f@x>"], score=-5, actions=["dim"], minute=4)]

    def group(self):
        return {"id": GROUP, "label": "dk.snak", "type": "open", "view": "threads", "hierarchy": "dk",
                "may_post": True, "unread": 0, "kinds": ["post"], "pins": [], "max_pins": 0,
                "write": {"post": {"allowed": True}, "chat": {"allowed": True}}}

    async def events(self, request):
        ws = web.WebSocketResponse(protocols=["unseenet"])
        await ws.prepare(request)
        async for _ in ws:
            pass
        return ws

    async def handle(self, request):
        path = request.path
        body = await request.json() if request.method == "POST" and request.can_read_body else {}
        if request.method == "POST":
            self.requests.append((path, body))
        if path == "/api/state":
            data = {"unlocked": True, "connected": True, "status": "Connected",
                    "identity": {"display": "Me", "label": "Me", "key": "ed25519:me"}}
        elif path == "/x/gui/state":
            data = {"bootable": False, "web": False}
        elif path == "/api/settings":
            data = {"signature_preview": "", "notices": {"send": True}}
        elif path == "/api/groups":
            data = {"groups": [self.group()], "people": [],
                    "hierarchies": [{"name": "dk", "tree": None}], "inbox": {"id": "inbox:test"}}
        elif request.method == "GET" and path == f"/api/groups/{GROUP}":
            data = {"group": self.group(), "rows": self.rows()}
        elif path == "/api/rules" and request.method == "GET":
            data = {"text": self.text, "on": self.on, "rules": 0, "problems": [], "suggestion": SUGGESTION}
        elif path == "/api/rules/check":
            bad = "autor" in body.get("text", "")
            data = {"rules": 0 if bad else 1, "problems": [{"line": 1, "message": "'autor' is not a condition - did you mean 'author'?"}] if bad else []}
        elif path == "/api/rules":
            self.text, self.on = body.get("text", self.text), body.get("on", self.on)
            data = {"text": self.text, "on": self.on, "rules": 1, "problems": []}
        elif path == "/api/threads":
            data = {"id": body["id"], "mark": body["mark"]}
        elif path == "/api/pictures":
            data = {"pictures": {}}
        else:
            data = {}
        return web.json_response(data)


@pytest.fixture
async def rules_page(request):
    api = RulesAPI(request.param)
    app = web.Application()

    async def index(_request):
        return web.FileResponse(STATIC / "index.html")

    app.router.add_get("/", index)
    app.router.add_static("/static/", STATIC)
    app.router.add_get("/api/events", api.events)
    app.router.add_route("*", "/api/{path:.*}", api.handle)
    app.router.add_route("*", "/x/gui/{path:.*}", api.handle)
    async with TestServer(app, host="127.0.0.1") as server, playwright.async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
            await page.wait_for_load_state("networkidle")
            await page.get_by_role("button", name="dk.snak").first.click()
            await page.wait_for_load_state("networkidle")
            yield page, api
        finally:
            await browser.close()
        assert errors == []


@pytest.mark.parametrize("rules_page", [False], indirect=True)
async def test_without_rules_the_list_is_as_before(rules_page):
    page, _ = rules_page
    await expect(page.locator(".ptable .prow:not(.head)")).to_have_count(2)
    await expect(page.locator(".prow .score")).to_have_count(0)


@pytest.mark.parametrize("rules_page", [True], indirect=True)
async def test_a_list_as_the_rules_have_it(rules_page):
    page, api = rules_page
    rows = page.locator(".ptable .prow:not(.head)")
    await expect(rows).to_have_count(3)                              # politik hidden, re: langt folded
    await expect(page.locator(".prow", has_text="politik")).to_have_count(0)
    await expect(page.locator(".prow.hl", has_text="kage").first).to_contain_text("+20")
    folded = page.locator(".prow", has_text="langt").locator(".folded")
    await expect(folded).to_contain_text("1 folded")
    await expect(page.locator(".prow.dimmed", has_text="langt")).to_have_count(1)
    await folded.click()
    await expect(rows).to_have_count(4)                              # opened
    assert any(p == f"/api/groups/{GROUP}/seen" and b["until"] == "2026-10-26T12:04:00Z"
               for p, b in api.requests)
    await page.locator(".prow", has_text="re: kage").click()
    await page.get_by_role("button", name="Why is this here?").click()
    await expect(page.locator("pre.why")).to_contain_text("score 0")
    await page.locator(".dialog .btn.primary").click()
    await page.get_by_role("button", name="Watch this thread").click()
    await page.wait_for_timeout(300)
    assert ("/api/threads", {"id": "<k@x>", "mark": "watched"}) in api.requests


@pytest.mark.parametrize("rules_page", [False], indirect=True)
async def test_the_editor(rules_page):
    page, api = rules_page
    await page.evaluate("openRules()")
    box = page.locator("#rules-text")
    await expect(box).to_have_value(SUGGESTION)                      # offered, not taken
    await expect(page.locator(".dialog")).to_contain_text("suggestion")
    await box.fill("+10 if autor in following")
    await expect(page.locator("#rules-check")).to_contain_text("did you mean 'author'")
    await box.fill("+10 if author in following  # friends")
    await expect(page.locator("#rules-check")).to_contain_text("all understood")
    await page.locator(".dialog .btn.primary").click()
    await page.wait_for_timeout(300)
    assert ("/api/rules", {"text": "+10 if author in following  # friends", "on": True}) in api.requests
