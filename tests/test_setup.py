"""The first-start screen offers the known nodes, and says so when it cannot (unseenet#372).

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_setup.py
"""

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43
NODES = [{"address": "aaaa.onion:119", "name": "unseenet-node3", "description": "Project node", "operator": "Unseenet"},
         {"address": "bbbb.onion:119", "name": "unseenet-node4", "description": "Project node", "operator": "Unseenet"}]


class SetupAPI:
    def __init__(self):
        self.refuse = True          # as a core before unseenet#372: 409 "set up first"
        self.setup = []

    async def handle(self, request):
        path = request.path
        if path == "/api/state":
            data = {"api": 1, "unlocked": True, "setup": True, "connected": False, "status": "Set up",
                    "identity": None, "node": None}
        elif path == "/x/gui/state":
            data = {"bootable": False, "web": False}
        elif path == "/api/known-nodes":
            if self.refuse:
                return web.json_response({"error": "set up first"}, status=409)
            data = {"nodes": NODES}
        elif path == "/api/setup":
            self.setup.append(await request.json())
            return web.json_response({"error": "stop here"}, status=400)
        else:
            raise web.HTTPNotFound()
        return web.json_response(data)


@pytest.fixture
async def setup_page():
    api = SetupAPI()
    app = web.Application()

    async def index(_request):
        return web.FileResponse(STATIC / "index.html")

    app.router.add_get("/", index)
    app.router.add_static("/static/", STATIC)
    app.router.add_route("*", "/api/{path:.*}", api.handle)
    app.router.add_route("*", "/x/gui/{path:.*}", api.handle)
    async with TestServer(app, host="127.0.0.1") as server, playwright.async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1100, "height": 800})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
            await expect(page.get_by_text("First start.")).to_be_visible()
            yield page, api
        finally:
            await browser.close()
        assert errors == []


async def test_a_missing_node_list_is_said_and_can_be_tried_again(setup_page):
    page, api = setup_page
    alert = page.get_by_role("alert").filter(has_text="list of nodes could not be loaded")
    await expect(alert).to_contain_text("set up first")
    await expect(page.locator(".choice")).to_have_count(0)

    api.refuse = False
    await alert.get_by_role("button", name="Try again").click()
    await expect(page.locator(".choice")).to_have_count(2)
    await expect(alert).to_have_count(0)
    await expect(page.locator('.choice[aria-pressed="true"]')).to_have_count(1)   # one at random

    await page.locator(".choice", has_text="unseenet-node4").click()
    await page.locator("#display").fill("Andreas")
    await page.get_by_role("button", name="Start").click()
    await expect(page.locator(".error")).to_have_text("stop here")
    assert api.setup == [{"display": "Andreas", "node": "bbbb.onion:119"}]
