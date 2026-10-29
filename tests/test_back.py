"""Back goes up one level, never to the unlock page (#249): the browser's history follows
the app's levels - a group and a post on a phone, full screen, a dialog - so the phone's
back swipe, Android's back button, the browser's Back and Alt+Left all do what Esc and
the on-screen back buttons do. At the top, Back says how to leave instead of leaving.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_back.py
"""

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43
GROUP = "dk.snak@abcd"


class ThreadsAPI:
    """A vault open on one group of threads; synthetic answers only."""

    def head(self):
        return {"id": GROUP, "label": "dk.snak", "type": "open", "view": "threads",
                "owner_view": "threads", "hierarchy": "dk", "may_post": True, "unread": 0,
                "owner": False, "kinds": ["post"], "write": {"post": {"allowed": True}},
                "pins": [], "max_pins": 5, "may_pin": False,
                "reactions": {"offered": [], "any": False, "setting": "none"}}

    def row(self, mid, subject):
        return {"who": "Someone", "who_key": "ed25519:other", "mine": False, "may_edit": False,
                "may_withdraw": False, "read": True, "depth": 0, "pinned": False, "reactions": [],
                "react": {"allowed": False}, "comment": {"allowed": True}, "reply": {"allowed": True},
                "message": {"id": mid, "group": GROUP, "subject": subject, "text": "Hej " + subject,
                            "signature": "", "references": [], "kind": "post", "readable": True,
                            "sender_key": "ed25519:other", "private": False,
                            "date": "2026-01-01T12:00:00Z"}}

    async def events(self, request):
        ws = web.WebSocketResponse(protocols=["unseenet"])
        await ws.prepare(request)
        async for _ in ws:
            pass
        return ws

    async def handle(self, request):
        path = request.path
        if path == "/api/state":
            data = {"unlocked": True, "connected": True, "status": "Connected",
                    "identity": {"display": "Me", "label": "Me", "key": "ed25519:me"}}
        elif path == "/x/gui/state":
            data = {"bootable": False, "web": False}
        elif path == "/api/groups":
            data = {"groups": [self.head()], "people": [],
                    "hierarchies": [{"name": "dk", "tree": None}], "inbox": {"id": "inbox:test"}}
        elif request.method == "GET" and path == f"/api/groups/{GROUP}":
            data = {"group": self.head(), "rows": [self.row("<a@x>", "Første"), self.row("<b@x>", "Anden")]}
        elif path == "/api/pictures":
            data = {"pictures": {}}
        elif path == "/api/about":
            data = {"version": "0.6.2", "tagline": "", "sections": [],
                    "comparisons": {"title": "", "intro": "", "items": []},
                    "status": {"title": "", "paragraphs": []}, "links": {"source": "", "docs": ""}}
        else:
            data = {}
        return web.json_response(data)


@pytest.fixture
async def app_page(request):
    width, height = request.param
    api = ThreadsAPI()
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
        page = await browser.new_page(viewport={"width": width, "height": height})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            # a page before ours in the tab: leaving goes there
            await page.goto(str(server.make_url("/static/app.css")))
            await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
            await page.wait_for_load_state("networkidle")
            yield page
        finally:
            await browser.close()
        assert errors == []


async def _back(page):
    await page.go_back(wait_until="commit")
    await page.wait_for_timeout(250)


@pytest.mark.parametrize("app_page", [(390, 844)], indirect=True)
async def test_a_phone_goes_back_a_level_at_a_time(app_page):
    page = app_page
    groups = page.get_by_role("button", name="dk.snak").first
    await groups.click()                                         # the group
    row = page.locator('.prow[data-id="<a@x>"]')
    await expect(row).to_be_visible()
    await row.click()                                            # a post
    await expect(page.get_by_role("button", name="Back to threads")).to_be_visible()

    await _back(page)                                            # post -> its list
    await expect(page.get_by_role("button", name="Back to threads")).to_have_count(0)
    await expect(row).to_be_visible()
    await _back(page)                                            # list -> your groups
    await expect(page.get_by_role("button", name="Back to your groups")).to_have_count(0)
    await expect(groups).to_be_visible()
    await _back(page)                                            # the top: stays, and says so
    await expect(page.get_by_text("Back again to leave Unseenet.")).to_be_visible()
    assert "#t=" in page.url or page.url.endswith("/")
    await expect(groups).to_be_visible()                         # not the unlock page
    await _back(page)                                            # again at once: leaves
    assert page.url.endswith("/static/app.css")


@pytest.mark.parametrize("app_page", [(390, 844)], indirect=True)
async def test_the_on_screen_back_keeps_the_history_in_step(app_page):
    """Going up with the app's own buttons takes the entries back: Back afterwards does
    not land on a level you already left."""
    page = app_page
    await page.get_by_role("button", name="dk.snak").first.click()
    await page.locator('.prow[data-id="<a@x>"]').click()
    await page.get_by_role("button", name="Back to threads").click()
    await page.get_by_role("button", name="Back to your groups").click()
    await page.wait_for_timeout(250)
    await _back(page)                                            # straight to the top note
    await expect(page.get_by_text("Back again to leave Unseenet.")).to_be_visible()
    await expect(page.get_by_role("button", name="dk.snak").first).to_be_visible()


@pytest.mark.parametrize("app_page", [(1280, 800)], indirect=True)
async def test_on_a_desktop_back_leaves_full_screen_and_dialogs(app_page):
    page = app_page
    await page.get_by_role("button", name="dk.snak").first.click()
    row = page.locator('.prow[data-id="<a@x>"]')
    await row.dblclick()                                         # full screen
    await page.wait_for_timeout(200)
    assert await page.evaluate("S.full") is True
    await _back(page)                     # the browser's Back (Alt+Left is the browser's own)
    assert await page.evaluate("S.full") is False
    await expect(row).to_be_visible()

    await page.evaluate("openAbout()")                           # a dialog
    await expect(page.locator(".dialog")).to_be_visible()
    await _back(page)
    await expect(page.locator(".dialog")).to_have_count(0)
    await _back(page)                                            # the top, as on a phone
    await expect(page.get_by_text("Back again to leave Unseenet.")).to_be_visible()


@pytest.mark.parametrize("app_page", [(1280, 800)], indirect=True)
async def test_back_does_not_lose_what_you_were_writing(app_page):
    page = app_page
    await page.get_by_role("button", name="dk.snak").first.click()
    await page.keyboard.press("n")                               # new post
    box = page.locator(".dialog textarea").first
    await expect(box).to_be_visible()
    await box.fill("Et udkast")
    await _back(page)
    await expect(page.get_by_text("Not sent yet - Cancel closes it.")).to_be_visible()
    await expect(box).to_have_value("Et udkast")                 # still there
    await _back(page)                                            # and Back keeps working
    await expect(box).to_have_value("Et udkast")
