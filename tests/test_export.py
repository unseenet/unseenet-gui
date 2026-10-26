"""#141: Export your data - what it holds, private messages only with a passphrase."""
import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect
TOKEN = "t" * 43


class API:
    def __init__(self, web_build=False):
        self.web_build, self.exports = web_build, []

    async def handle(self, request):
        path = request.path
        if path == "/api/state":
            data = {"api": 1, "unlocked": True, "setup": False, "connected": True, "status": "",
                    "identity": {"key": "ed25519:" + "a" * 52, "display": "Me", "label": "Me",
                                 "words_written": True, "words_reminder": False},
                    "node": "127.0.0.1:1", "nodes": []}
        elif path == "/x/gui/state":
            data = {"bootable": False, "web": self.web_build, "identities": []}
        elif path == "/api/export":
            body = await request.json()
            self.exports.append(body)
            data = {"path": "/home/me/Downloads/unseenet-export-abcd.zip" + (".sealed" if body["private"] else ""),
                    "articles": 12, "files": 3, "sites": 1, "private": 5 if body["private"] else 0,
                    "encrypted": body["private"], "missing": 0,
                    "note": "This export holds what the nodes still carry (retention)."}
        elif path == "/api/groups":
            data = {"groups": [], "people": [], "hierarchies": [], "inbox": {"id": "inbox@x"},
                    "timeline": {"id": "timeline:", "feeds": 0}}
        elif path == "/api/notifications":
            data = {"settings": {"on": False, "content": False}, "count": 0, "items": []}
        else:
            data = {}
        return web.json_response(data)


@pytest.fixture
async def page_api():
    api = API()
    app = web.Application()

    async def index(_request):
        return web.FileResponse(STATIC / "index.html")
    app.router.add_get("/", index)
    app.router.add_static("/static/", STATIC)
    app.router.add_route("*", "/api/{path:.*}", api.handle)
    app.router.add_route("*", "/x/gui/{path:.*}", api.handle)
    async with TestServer(app, host="127.0.0.1") as server, playwright.async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
        await page.wait_for_load_state("networkidle")
        yield page, api
        await browser.close()
        assert errors == []


async def test_export_without_private_messages(page_api):
    page, api = page_api
    await page.evaluate("openExport()")
    dialog = page.get_by_role("dialog", name="Export your data")
    await expect(dialog).to_contain_text("Never your keys")
    await expect(dialog).to_contain_text("not everything you ever wrote")
    await dialog.get_by_role("button", name="Export").click()
    await expect(dialog).to_contain_text("unseenet-export-abcd.zip")
    await expect(dialog).to_contain_text("12 articles, 3 files, 1 sites.")
    assert api.exports == [{"private": False, "passphrase": None}]


async def test_private_messages_need_a_passphrase_twice(page_api):
    page, api = page_api
    await page.evaluate("openExport()")
    dialog = page.get_by_role("dialog", name="Export your data")
    await dialog.get_by_label("Include private posts and chats").check()
    await dialog.get_by_label("Passphrase for the export").fill("lang sætning")
    await dialog.get_by_label("The passphrase again").fill("en anden")
    await dialog.get_by_role("button", name="Export").click()
    await expect(dialog).to_contain_text("The passphrases differ.")
    assert api.exports == []
    await dialog.get_by_label("Passphrase for the export").fill("lang sætning")
    await dialog.get_by_label("The passphrase again").fill("lang sætning")
    await dialog.get_by_role("button", name="Export").click()
    await expect(dialog).to_contain_text("encrypted with your passphrase")
    assert api.exports == [{"private": True, "passphrase": "lang sætning"}]
