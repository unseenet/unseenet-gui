"""A large group comes in part (unseenet#724): the GUI asks for its newest threads with
``limit``, shows "Show older threads" when the core says there are more, and asks for
twice as many when you click it.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_older.py
"""

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC
from test_rules import GROUP, TOKEN, RulesAPI, row

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

THREADS = 300                      # in the group; the GUI asks for 200 first


class OlderAPI(RulesAPI):
    async def handle(self, request):
        if request.method == "GET" and request.path == f"/api/groups/{GROUP}":
            limit = int(request.query.get("limit", THREADS))
            self.limits = getattr(self, "limits", []) + [limit]
            n = min(limit, THREADS)
            return web.json_response({"group": {**self.group(), "more": n < THREADS},
                                      "rows": [row(f"<t{i}@x>", f"tråd {i}", minute=i % 60) for i in range(n)]})
        return await super().handle(request)


@pytest.fixture
async def older_page():
    api = OlderAPI(False)
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


async def test_the_newest_first_then_older_when_asked(older_page):
    page, api = older_page
    rows = page.locator(".ptable .prow:not(.head)")
    await expect(rows).to_have_count(200)
    assert api.limits[-1] == 200
    older = page.locator('[data-k="older"]')
    await expect(older).to_have_text("Show older threads")
    await older.click()
    await expect(rows).to_have_count(THREADS)
    assert api.limits[-1] == 400
    await expect(older).to_have_count(0)               # all here: no button
