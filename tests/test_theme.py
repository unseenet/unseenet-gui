"""The theme kept with your settings in the core (#84, UN-RFC 0046 section 4.8), and where
your state is kept (UN-RFC 0044 section 7.4), against a synthetic local API: the core's
theme wins over the browser's copy, a change is saved to the core, the system's theme
can be followed again, and your state moves to this device only after a warning.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_theme.py
"""

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43


class ThemeAPI:
    """Synthetic answers only: no vault, Tor or outgoing messages."""

    def __init__(self):
        self.gui = {"theme": "dark"}
        self.settings = {"signature_preview": "", "notices": {"send": True}, "state_local": False}
        self.posted = []

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
        elif path == "/api/settings":
            if request.method == "POST":
                body = await request.json()
                self.posted.append(("settings", body))
                self.settings.update(body)
            data = self.settings
        elif path == "/api/settings/clients/gui":
            if request.method == "POST":
                body = await request.json()
                self.posted.append(("gui", body))
                for k, v in body.items():
                    if v is None:
                        self.gui.pop(k, None)
                    else:
                        self.gui[k] = v
            data = {"client": "gui", "settings": self.gui}
        elif path == "/api/groups":
            groups = [{"id": f"dk.g{i}@abcdabcdabcdabcd", "label": f"dk.g{i}", "type": "open",
                       "view": "threads", "hierarchy": "dk", "may_post": True, "unread": 0,
                       "subscribed": True, "kinds": ["post"]} for i in range(60)]
            data = {"groups": groups, "people": [], "inbox": {"id": "inbox:test"},
                    "hierarchies": [{"name": "dk", "tree": None}]}
        elif path == "/api/pictures":
            data = {"pictures": {}}
        else:
            data = {}
        return web.json_response(data)


@pytest.fixture
async def theme_page():
    api = ThemeAPI()
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
        page = await browser.new_page(viewport={"width": 1280, "height": 900}, color_scheme="light")
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
            await page.evaluate("localStorage.setItem('unseenet-theme', 'light')")  # an old copy
            await page.reload()
            await page.wait_for_load_state("networkidle")
            yield page, api
        finally:
            await browser.close()
        assert errors == []


async def run(page, name):
    await page.keyboard.press("Control+k")
    await page.keyboard.type(name)
    await page.keyboard.press("Enter")


async def test_the_theme_kept_in_the_core_wins_and_follows_changes(theme_page):
    page, api = theme_page
    html = page.locator("html")
    await expect(html).to_have_attribute("data-theme", "dark")            # the core's, not the copy
    assert await page.evaluate("localStorage.getItem('unseenet-theme')") == "dark"
    assert not [p for p in api.posted if p[0] == "gui"]                    # read, not written back
    await run(page, "Use the light theme")
    await expect(html).to_have_attribute("data-theme", "light")
    await page.wait_for_load_state("networkidle")
    assert ("gui", {"theme": "light"}) in api.posted
    await run(page, "Follow the system's theme")
    await page.wait_for_load_state("networkidle")
    assert await html.get_attribute("data-theme") is None
    assert api.posted[-1] == ("gui", {"theme": None})


async def test_your_state_on_this_device_only_after_a_warning(theme_page):
    page, api = theme_page
    await run(page, "Your state: keep it on this device only")
    dialog = page.locator(".dialog")
    await expect(dialog).to_contain_text("What is in the network now is removed.")
    await dialog.get_by_role("button", name="Keep on this device only").click()
    await expect(page.locator(".toast")).to_have_text("Your state is kept on this device only.")
    assert api.posted[-1] == ("settings", {"state_local": True})
    await run(page, "Your state: keep it in the network again")
    await page.locator(".dialog").get_by_role("button", name="Keep in the network").click()
    await expect(page.locator(".toast")).to_contain_text("in the network again")
    assert api.posted[-1] == ("settings", {"state_local": False})


async def test_you_stay_at_the_bottom_however_many_groups(theme_page):
    # many groups scroll by themselves; your name, picture and connection stay in view
    page, _ = theme_page
    await expect(page.locator(".side .item").nth(40)).to_be_attached()
    me = await page.locator(".side .me").bounding_box()
    assert me and me["y"] + me["height"] <= 900 - 20               # above the footer
    sc = await page.evaluate("(e => [e.scrollHeight, e.clientHeight])(document.querySelector('.side-scroll'))")
    assert sc[0] > sc[1]                                           # the groups scroll
    await page.locator(".side-scroll").evaluate("e => e.scrollTop = e.scrollHeight")
    assert await page.locator(".side .me").bounding_box() == me    # and you do not move
