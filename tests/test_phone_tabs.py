"""A phone's tab bar (#248): Groups, For you, Timeline, Chats, You at the bottom, so the
groups get the screen; what the desktop keeps in the sidebar top, the account box and the
status bar is at most two taps away; the desktop is unchanged.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_phone_tabs.py   (SHOTS=dir also saves screenshots)
"""

import os
from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43
NAMES = ["snak", "politik", "sport", "musik", "film", "boeger", "mad", "rejser", "teknik",
         "linux", "foto", "have", "cykler", "historie", "spil"]
GROUPS = [f"dk.{n}@abcd" for n in NAMES]


class PhoneAPI:
    """A vault open on fifteen groups, a feed you follow, chats and a key still ripening."""

    def __init__(self, connected=True):
        self.connected = connected

    def head(self, gid):
        return {"id": gid, "label": gid.split("@")[0], "type": "open", "view": "threads",
                "owner_view": "threads", "hierarchy": "dk", "may_post": True,
                "unread": 2 if gid == GROUPS[0] else 0, "owner": False, "kinds": ["post"],
                "write": {"post": {"allowed": True}}, "pins": [], "max_pins": 5, "may_pin": False,
                "reactions": {"offered": [], "any": False, "setting": "none"}}

    async def events(self, request):
        ws = web.WebSocketResponse(protocols=["unseenet"])
        await ws.prepare(request)
        async for _ in ws:
            pass
        return ws

    async def handle(self, request):
        path = request.path
        if path == "/api/state":
            data = {"unlocked": True, "connected": self.connected,
                    "status": "Connected" if self.connected else "Looking for a node …",
                    "identity": {"display": "Andreas", "label": "Andreas", "key": "ed25519:me"},
                    "ripening": {"level": 0, "next": 1, "percent": 40, "running": True}}
        elif path == "/x/gui/state":
            data = {"bootable": False, "web": False}
        elif path == "/api/groups":
            data = {"groups": [self.head(g) for g in GROUPS],
                    "people": [{"id": "contact:ed25519:sonia", "key": "ed25519:sonia", "name": "Sonia",
                                "unread": 1}],
                    "hierarchies": [{"name": "dk", "tree": None}], "inbox": {"id": "inbox:test", "unread": 1},
                    "for_you": {"replies": 2, "mentions": 1}, "timeline": {"feeds": 2},
                    "my_feed": {"id": "feed:me", "started": True}, "my_site": {"started": False},
                    "moderation": 0, "name_requests": 0}
        elif request.method == "GET" and path.startswith("/api/groups/"):
            gid = path.split("/api/groups/", 1)[1]
            data = {"group": self.head(gid), "rows": []}
        elif path == "/api/pictures":
            data = {"pictures": {}}
        else:
            data = {}
        return web.json_response(data)


@pytest.fixture
async def phone(request):
    width, height, scheme, connected = request.param
    api = PhoneAPI(connected)
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
        page = await browser.new_page(viewport={"width": width, "height": height}, color_scheme=scheme)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
            await page.wait_for_load_state("networkidle")
            yield page
        finally:
            await browser.close()
        assert errors == []


async def _shot(page, name):
    out = os.environ.get("SHOTS")
    if out:
        Path(out).mkdir(parents=True, exist_ok=True)
        await page.screenshot(path=str(Path(out) / f"{name}.png"))


def _visible_groups(page):
    return page.evaluate("""() => {
        const s = document.querySelector('.side-scroll').getBoundingClientRect();
        return [...document.querySelectorAll('.side-scroll .item')]
          .filter(e => { const r = e.getBoundingClientRect(); return r.top >= s.top && r.bottom <= s.bottom; }).length;
    }""")


@pytest.mark.parametrize("phone", [(360, 740, "dark", True), (390, 844, "light", True)], indirect=True)
async def test_the_groups_get_the_screen(phone):
    page = phone
    bar = page.get_by_role("navigation", name="Sections")
    await expect(bar).to_be_visible()
    for key in ("groups", "foryou", "timeline", "chats", "you"):
        await expect(bar.locator(f'.tab[data-tab="{key}"]')).to_be_visible()
    await expect(page.locator(".statusbar")).to_be_hidden()
    await expect(page.locator("nav.side > .me")).to_be_hidden()
    await expect(page.locator(".side-top .nav")).to_be_hidden()
    await expect(page.locator(".side-filter")).to_be_visible()      # the filter stays
    assert await _visible_groups(page) >= 10
    w, h = page.viewport_size["width"], page.viewport_size["height"]
    await _shot(page, f"phone-groups-{w}x{h}")


@pytest.mark.parametrize("phone", [(390, 844, "dark", True)], indirect=True)
async def test_every_place_is_at_most_two_taps_away(phone):
    page = phone
    bar = page.get_by_role("navigation", name="Sections")
    await bar.locator('.tab[data-tab="foryou"]').click()          # one tap
    await expect(bar.locator(".tab.on")).to_have_text("◄For you3")
    await bar.locator('.tab[data-tab="chats"]').click()
    await expect(page.locator(".phone-only").get_by_role("button", name="Private posts")).to_be_visible()
    await expect(page.locator(".phone-only").get_by_role("button", name="Your contacts")).to_be_visible()
    await _shot(page, "phone-chats")
    await bar.locator('.tab[data-tab="you"]').click()
    you = page.locator(".content.you")
    for label in ("Your feed", "Start your site", "Commands and search", "About Unseenet"):
        await expect(you.get_by_role("button", name=label)).to_be_visible()
    await expect(you.get_by_role("button", name="Show your key")).to_be_visible()
    await expect(you.locator(".you-status")).to_contain_text("Connected")
    await _shot(page, "phone-you")
    await bar.locator('.tab[data-tab="groups"]').click()
    await expect(page.locator(".side-scroll")).to_be_visible()


@pytest.mark.parametrize("phone", [(390, 844, "dark", False)], indirect=True)
async def test_not_connected_is_said_and_the_you_tab_has_a_dot(phone):
    page = phone
    await expect(page.locator(".netbanner")).to_contain_text("Looking for a node")
    await expect(page.locator('.tab[data-tab="you"] .tab-dot')).to_be_visible()


@pytest.mark.parametrize("phone", [(1280, 800, "dark", True)], indirect=True)
async def test_the_desktop_is_as_it_was(phone):
    page = phone
    await expect(page.get_by_role("navigation", name="Sections")).to_be_hidden()
    await expect(page.locator(".statusbar")).to_be_visible()
    await expect(page.locator("nav.side > .me")).to_be_visible()
    await expect(page.locator(".side-top .nav")).to_be_visible()
