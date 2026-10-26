"""#126: a system notification when something lands in For you - from the core's
GET /api/notifications, asked once, content hidden by default, never on the bootable."""
import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect
TOKEN = "t" * 43

STUB = """
window.__notes = [];
window.Notification = class { constructor(title, opts) { window.__notes.push({title, ...opts}); } close() {} };
window.Notification.permission = "granted";
window.Notification.requestPermission = async () => "granted";
"""


class API:
    def __init__(self, on=None, content=False, bootable=False):
        self.settings = {"on": on, "content": content}
        self.bootable, self.posted = bootable, []
        self.pending = [{"id": "<a@x>", "group": "inbox@x", "why": "private", "chat": True,
                         **({"who": "Sonia", "text": "Hej"} if content else {})}]

    async def handle(self, request):
        path = request.path
        if path == "/api/state":
            data = {"api": 1, "unlocked": True, "setup": False, "connected": True, "status": "",
                    "identity": {"key": "ed25519:" + "a" * 52, "display": "Me", "label": "Me",
                                 "words_written": True, "words_reminder": False},
                    "node": "127.0.0.1:1", "nodes": []}
        elif path == "/x/gui/state":
            data = {"bootable": self.bootable, "web": False, "identities": []}
        elif path == "/api/settings" and request.method == "POST":
            body = await request.json()
            self.posted.append(body)
            self.settings.update(body.get("notifications", {}))
            data = {"notifications": self.settings}
        elif path == "/api/settings":
            data = {"notifications": self.settings, "notices": {"send": True}}
        elif path == "/api/notifications":
            items, self.pending = self.pending, []
            data = {"settings": self.settings, "count": len(items), "items": items}
        elif path == "/api/groups":
            data = {"groups": [], "people": [], "hierarchies": [], "inbox": {"id": "inbox@x"},
                    "timeline": {"id": "timeline:", "feeds": 0}}
        else:
            data = {}
        return web.json_response(data)


async def _open(browser, api):
    app = web.Application()

    async def index(_request):
        return web.FileResponse(STATIC / "index.html")
    app.router.add_get("/", index)
    app.router.add_static("/static/", STATIC)
    app.router.add_route("*", "/api/{path:.*}", api.handle)
    app.router.add_route("*", "/x/gui/{path:.*}", api.handle)
    server = TestServer(app, host="127.0.0.1")
    await server.start_server()
    page = await browser.new_page()
    await page.add_init_script(STUB)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
    return server, page, errors


@pytest.fixture
async def browser():
    async with playwright.async_playwright() as p:
        b = await p.chromium.launch()
        yield b
        await b.close()


async def test_asked_once_then_told_without_content(browser):
    api = API(on=None)
    server, page, errors = await _open(browser, api)
    await expect(page.get_by_text("Tell you about new messages?")).to_be_visible(timeout=10000)
    await page.get_by_role("button", name="Yes").click()
    await page.wait_for_function("window.__notes.length === 1")
    note = (await page.evaluate("window.__notes"))[0]
    assert note["title"] == "Unseenet" and note["body"] == "1 new in For you"
    assert note["tag"] == "unseenet-for-you"
    assert {"notifications": {"on": True}} in api.posted
    assert errors == []
    await server.close()


async def test_with_content_when_chosen(browser):
    api = API(on=True, content=True)
    server, page, errors = await _open(browser, api)
    await page.wait_for_function("window.__notes.length === 1", timeout=10000)
    assert (await page.evaluate("window.__notes"))[0]["body"] == "Sonia: Hej"
    assert errors == []
    await server.close()


async def test_never_on_the_bootable_image(browser):
    api = API(on=True, bootable=True)
    server, page, errors = await _open(browser, api)
    await page.wait_for_timeout(2500)
    assert await page.evaluate("window.__notes.length") == 0
    assert api.pending                                     # not even asked
    assert errors == []
    await server.close()
