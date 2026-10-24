"""Sites and pages (#61, UN-RFC 0035, UN-RFC 0046 section 4.15) against a synthetic local
API: a site shown as its home page and its pages, links within the site followed with
back and forward, and its writers editing a page with the core's preview, going back
to the previous version and removing a page - nobody else offered any of it.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_pages.py
"""

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43
SITE = "site@abcdabcdabcdabcd"
TEXT = {"index": "Velkommen hjem", "about": "Om mig og mit"}
TITLE = {"index": "Velkommen", "about": "Om mig"}


def tree(path):
    nodes = [{"t": "text", "v": TEXT[path] + " "}]
    if path == "index":
        nodes.append({"t": "link", "href": f"unseenet:{SITE}?p=about", "c": [{"t": "text", "v": "om mig"}]})
    return [{"t": "p", "c": nodes}]


class SiteAPI:
    """Synthetic answers only: no vault, Tor or outgoing messages."""

    def __init__(self, may_write):
        self.may_write = may_write
        self.posted = []

    def group(self):
        return {"id": SITE, "label": "Min side", "type": "channel", "view": "pages",
                "owner_view": "pages", "hierarchy": "site", "may_post": self.may_write,
                "unread": 0, "kinds": ["post"], "subscribed": True,
                "write": {"post": {"allowed": self.may_write, "reason": "", "code": "ok"},
                          "chat": {"allowed": False, "reason": "", "code": "kind"}}}

    def row(self, path):
        return {"who": "Andreas", "who_key": "ed25519:a", "mine": self.may_write, "read": True,
                "depth": 0, "tree": tree(path),
                "message": {"id": f"<{path}@x>", "group": SITE, "subject": TITLE[path],
                            "text": TEXT[path], "signature": "", "references": [], "kind": "post",
                            "readable": True, "sender_key": "ed25519:a", "private": False,
                            "content_type": "text/markdown; charset=utf-8; variant=unseenet",
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
        elif path == "/api/settings":
            data = {"signature_preview": "", "notices": {"send": True}}
        elif path == "/api/groups":
            data = {"groups": [self.group()], "people": [],
                    "hierarchies": [{"name": "site", "tree": None}], "inbox": {"id": "inbox:test"}}
        elif request.method == "GET" and path == f"/api/groups/{SITE}":
            data = {"group": self.group(), "rows": []}
        elif path == f"/api/groups/{SITE}/site":
            data = {"id": SITE, "label": "Min side", "title": "Andreas' side", "home": "index",
                    "owner": {"key": "ed25519:a", "label": "Andreas"}, "may_write": self.may_write,
                    "max_pages": 32, "index": "no", "address": f"unseenet:{SITE}?p=index",
                    "pages": [{"path": p, "title": TITLE[p], "home": p == "index", "id": f"<{p}@x>",
                               "who": "Andreas", "who_key": "ed25519:a",
                               "date": "2026-01-01T12:00:00Z", "previous": p == "about"}
                              for p in ("index", "about")]}
        elif request.method == "GET" and path == f"/api/groups/{SITE}/page":
            p = request.query.get("path", "index")
            data = {"path": p, "title": TITLE[p], "home": p == "index",
                    "address": f"unseenet:{SITE}?p={p}", "row": self.row(p),
                    "previous": {"id": "<old@x>", "who": "Andreas", "date": "2025-12-01T12:00:00Z"}
                    if p == "about" else None}
        elif path == f"/api/groups/{SITE}/page":
            body = await request.json()
            if body.get("preview"):
                data = {"tree": [{"t": "h", "n": 1, "c": [{"t": "text", "v": "Forhåndsvist"}]}]}
            else:
                self.posted.append(body)
                data = {"job": f"j{len(self.posted)}"}
        elif path == "/api/address":
            p = request.query.get("a", "").split("p=")[-1]
            data = {"kind": "page", "address": request.query.get("a"), "nodes": [],
                    "group_id": SITE, "followed": True, "available": True,
                    "group": {"id": SITE, "label": "Min side", "title": "", "type": "channel",
                              "view": "pages"}, "message": None,
                    "page": {"path": p, "title": TITLE.get(p, p)}}
        elif path == "/api/pictures":
            data = {"pictures": {}}
        else:
            data = {}
        return web.json_response(data)


@pytest.fixture
async def site_page(request):
    api = SiteAPI(request.param)
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
            await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
            await page.wait_for_load_state("networkidle")
            await page.get_by_role("button", name="Min side").first.click()
            await page.wait_for_load_state("networkidle")
            yield page, api
        finally:
            await browser.close()
        assert errors == []


@pytest.mark.parametrize("site_page", [False], indirect=True)
async def test_a_site_its_pages_and_links(site_page):
    page, _ = site_page
    reader = page.get_by_role("article", name="Page")
    await expect(reader.locator("h2")).to_have_text("Velkommen")
    pages = page.get_by_role("navigation", name="Pages")
    await expect(pages.locator(".item")).to_have_count(2)
    await expect(pages.locator(".item").first).to_contain_text("⌂")       # the home page first
    await expect(page.get_by_role("button", name="Edit")).to_have_count(0)  # not a writer
    await expect(page.get_by_role("button", name="New page")).to_have_count(0)

    await reader.get_by_role("link", name="om mig").click()              # a link within the site
    await expect(reader.locator("h2")).to_have_text("Om mig")
    await expect(pages.locator(".item.on")).to_contain_text("Om mig")
    await page.get_by_role("button", name="Back").click()
    await expect(reader.locator("h2")).to_have_text("Velkommen")
    await page.get_by_role("button", name="Forward").click()
    await expect(reader.locator("h2")).to_have_text("Om mig")
    await page.get_by_role("button", name="Copy address").click()


@pytest.mark.parametrize("site_page", [True], indirect=True)
async def test_writers_edit_with_a_preview(site_page):
    page, api = site_page
    await page.get_by_role("button", name="Edit").click()
    dialog = page.locator(".dialog")
    await expect(dialog.locator("#ptext")).to_have_value("Velkommen hjem")
    await dialog.locator("#ptext").fill("# Nyt\n\nMed [link](about)")
    await dialog.get_by_role("button", name="Preview").click()
    await expect(dialog.locator(".ppreview")).to_contain_text("Forhåndsvist")
    await dialog.get_by_role("button", name="Publish").last.click()
    await expect(page.locator(".dialog")).to_have_count(0)
    await expect(page.locator(".pagepend")).to_contain_text("Writing index")
    sent = api.posted[-1]
    assert {k: sent[k] for k in ("path", "title", "text", "markdown")} == {
        "path": "index", "title": "Velkommen", "text": "# Nyt\n\nMed [link](about)", "markdown": True}


@pytest.mark.parametrize("site_page", [True], indirect=True)
async def test_new_page_previous_version_and_remove(site_page):
    page, api = site_page
    await page.get_by_role("button", name="New page").click()
    dialog = page.locator(".dialog")
    await dialog.locator("#ppath").fill("Bad Path")
    await dialog.locator("#ptext").fill("tekst")
    await dialog.get_by_role("button", name="Publish").last.click()
    await expect(page.locator(".toast")).to_contain_text("A path is 1-8 parts")
    await dialog.locator("#ppath").fill("projects/ovos")
    await dialog.get_by_role("button", name="Publish").last.click()
    await expect(page.locator(".dialog")).to_have_count(0)
    await expect(page.locator(".pagepend")).to_contain_text("Writing projects/ovos")
    assert api.posted[-1]["path"] == "projects/ovos"

    await page.get_by_role("navigation", name="Pages").get_by_role("button", name="Om mig").click()
    await page.get_by_role("button", name="Previous version").click()
    await page.locator(".dialog").get_by_role("button", name="Publish it again").click()
    await expect(page.locator(".pagepend")).to_contain_text("Restoring about")
    assert api.posted[-1] == {"path": "about", "restore": True, "kind": "post"}
    await page.get_by_role("button", name="Remove").click()
    await page.locator(".dialog").get_by_role("button", name="Remove").click()
    await expect(page.locator(".pagepend")).to_contain_text("Removing about")
    assert api.posted[-1] == {"path": "about", "remove": True, "kind": "post"}


@pytest.mark.parametrize("site_page", [False], indirect=True)
async def test_keys_on_a_site(site_page):
    # unseenet#490: up and down go through the pages, left and right back and forward
    page, _ = site_page
    reader = page.get_by_role("article", name="Page")
    keys = page.locator(".statusbar .keys")
    await expect(keys).to_contain_text("↑↓ pages")
    await expect(keys).not_to_contain_text("edit")               # not a writer
    await expect(keys).not_to_contain_text("new")
    await page.keyboard.press("ArrowDown")
    await expect(reader.locator("h2")).to_have_text("Om mig")
    await page.keyboard.press("ArrowLeft")
    await expect(reader.locator("h2")).to_have_text("Velkommen")
    await page.keyboard.press("ArrowRight")
    await expect(reader.locator("h2")).to_have_text("Om mig")
    await page.keyboard.press("n")                                # no compose window on a site
    await expect(page.locator(".dialog")).to_have_count(0)


@pytest.mark.parametrize("site_page", [True], indirect=True)
async def test_writers_keys_on_a_site(site_page):
    page, _ = site_page
    keys = page.locator(".statusbar .keys")
    await expect(keys).to_contain_text("E edit")
    await expect(keys).to_contain_text("N new page")
    await page.keyboard.press("e")
    await expect(page.locator(".dialog #ptext")).to_have_value("Velkommen hjem")
