"""Level 4 as a choice (#241, unseenet#740, UN-RFC 0025 section 7): "Keep ripening to level
4" in the ripening dialog, what it costs and gives before it is turned on, the target and
the time left, and turning it off again.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_ripening_level4.py
"""

import json

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

import test_feeds as tf

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

T3 = 2 ** 35


class RipeAPI(tf.FeedAPI):
    def __init__(self):
        super().__init__()
        self.target, self.calls = 3, []

    def ripening(self):
        left = (2 ** 37 - T3) / 100_000 if self.target == 4 else 0
        return {"level": 3, "t": T3, "next_at": 2 ** 37, "published": 3, "available": True,
                "paused": False, "target": self.target, "chosen": self.target if self.target == 4 else None,
                "seconds_left": round(left), "speed": 100_000.0}

    async def handle(self, request):
        if request.path == "/api/state":
            resp = await super().handle(request)
            data = json.loads(resp.body)
            data["ripening"] = self.ripening()
            return web.json_response(data)
        if request.path == "/api/ripening" and request.method == "POST":
            body = await request.json()
            self.calls.append(body)
            self.target = body.get("to", self.target)
            return web.json_response(self.ripening())
        return await super().handle(request)


@pytest.fixture
async def page_api():
    api = RipeAPI()
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
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            await page.goto(str(server.make_url("/")) + "#t=" + tf.TOKEN)
            await page.wait_for_load_state("networkidle")
            yield page, api
        finally:
            await browser.close()
        assert errors == []


async def test_keep_ripening_to_level_4(page_api):
    page, api = page_api
    await expect(page.locator(".ripe")).to_have_text("Key level 3")   # stopped at 3: no "ripening"
    await page.locator(".ripe").click()
    dialog = page.get_by_role("dialog")
    await expect(dialog).to_contain_text("where it stops here (level 3)")
    box = dialog.get_by_role("checkbox", name="Keep ripening to level 4")
    await expect(box).not_to_be_checked()
    # what it costs and gives, before it is turned on - at this machine's speed
    await expect(dialog).to_contain_text("Level 4 takes about 12 days of one core")
    await expect(dialog).to_contain_text("about a quarter of the work")
    await box.check()
    await expect(page.locator(".toast")).to_contain_text("ripens on to level 4")
    assert api.calls == [{"to": 4}]
    await expect(dialog).to_contain_text("Ripening to level 4 · about 12 days of running time left")
    await expect(page.locator(".ripe")).to_have_text("Key level 3 · ripening")
    await dialog.get_by_role("checkbox", name="Keep ripening to level 4").uncheck()
    assert api.calls[-1] == {"to": 3}
    await expect(page.locator(".toast")).to_contain_text("stops at level 3")
