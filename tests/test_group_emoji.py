"""#67 (UN-RFC 0056): a group's own emoji - :name: as its picture in its own group, not
with pictures off; first in the picker; the owner adds and removes them."""

import base64
import io
import re

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC
from test_rules import GROUP, row

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect
PIL = pytest.importorskip("PIL.Image")

TOKEN = "t" * 43


def _png() -> str:
    out = io.BytesIO()
    PIL.new("RGBA", (32, 32), (200, 120, 40, 255)).save(out, "PNG")
    return base64.b64encode(out.getvalue()).decode()


PIC = {"v": 1, "type": "image/png", "px": 32, "data": _png(), "alt": "Et marsvin"}


class EmojiAPI:
    def __init__(self):
        self.set, self.posted, self.pictures = {"marsvin": PIC}, [], True

    def group(self):
        return {"id": GROUP, "label": "dk.snak", "type": "open", "view": "threads", "hierarchy": "dk",
                "may_post": True, "unread": 0, "kinds": ["post"], "pins": [], "max_pins": 0, "owner": True,
                "write": {"post": {"allowed": True}, "chat": {"allowed": True}},
                "emoji": self.set, "emoji_possible": True}

    def rows(self):
        r = row("<m@x>", "Hej")
        r["message"].update(content_type="text/markdown", text=":marsvin: hej :tada:")
        r["tree"] = [{"t": "p", "c": [{"t": "text", "v": ":marsvin: hej "},
                                      {"t": "emoji", "name": "tada", "v": "🎉"}]}]
        return [r]

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
            data = {"groups": [self.group()], "people": [], "pictures": self.pictures,
                    "hierarchies": [{"name": "dk", "tree": None}], "inbox": {"id": "inbox:test"}}
        elif path == f"/api/groups/{GROUP}/emoji":
            if request.method == "POST":
                body = await request.json()
                self.posted.append(body)
                if "preview" in body:
                    return web.json_response({"picture": PIC})
                if "add" in body:
                    self.set = {**self.set, body["add"]["name"]: PIC}
                if "remove" in body:
                    self.set = {k: v for k, v in self.set.items() if k != body["remove"]}
            data = {"emoji": self.set, "possible": True, "max": 16, "warning": "A group's emoji are public."}
        elif path == f"/api/groups/{GROUP}":
            data = {"group": self.group(), "rows": self.rows()}
        elif path == "/api/pictures":
            data = {"pictures": {}}
        elif path == "/api/emoji":                       # the standard table, a little of it
            data = {"table": {"tada": "🎉", "smile": "😄"},
                    "categories": [{"name": "Smileys", "codes": ["smile", "tada"]}]}
        else:
            data = {}
        return web.json_response(data)


@pytest.fixture
async def emoji_page(tmp_path):
    api = EmojiAPI()
    app = web.Application()

    async def index(_request):
        return web.FileResponse(STATIC / "index.html")

    app.router.add_get("/", index)
    app.router.add_static("/static/", STATIC)
    app.router.add_get("/api/events", api.events)
    app.router.add_route("*", "/api/{path:.*}", api.handle)
    app.router.add_route("*", "/x/gui/{path:.*}", api.handle)
    picture = tmp_path / "marsvin.png"
    picture.write_bytes(base64.b64decode(PIC["data"]))
    async with TestServer(app, host="127.0.0.1") as server, playwright.async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
            await page.wait_for_load_state("networkidle")
            await page.evaluate(f"openGroup('{GROUP}')")
            await page.wait_for_load_state("networkidle")
            yield page, api, picture
        finally:
            await browser.close()
        assert errors == []


async def test_shown_in_its_own_group(emoji_page):
    page, api, _ = emoji_page
    await page.locator(".prow").first.click()
    body = page.locator(".md").first
    img = body.locator("img.gemoji")
    await expect(img).to_have_count(1)
    await expect(img).to_have_attribute("alt", "Et marsvin")
    assert (await img.get_attribute("src")).startswith("data:image/png;base64,")
    await expect(body).to_contain_text("🎉")                               # standard ones as before
    # another group: the same :marsvin: stays text
    assert await page.evaluate("""() => { RENDERING = { group: 'dk.andet@abcd' };
        const out = renderInline([{t: 'text', v: ':marsvin:'}]); RENDERING = null;
        return out.flat(Infinity).map(n => typeof n === 'string' ? n : n.outerHTML || n.textContent).join(''); }""") == ":marsvin:"
    # pictures off: text
    await page.evaluate("S.sidebar.pictures = false; render()")
    await expect(body.locator("img.gemoji")).to_have_count(0)
    await expect(body).to_contain_text(":marsvin:")


async def test_first_in_the_picker(emoji_page):
    page, api, _ = emoji_page
    await page.evaluate("openCompose()")
    await expect(page.locator("#body")).to_be_visible()
    await page.locator(".dialog .toolbar").get_by_role("button", name=re.compile("emoji", re.I)).click()
    picker = page.locator(".emoji-picker")
    await expect(picker.locator(".emo-cat")).to_have_text("This group's own")
    await picker.locator(".emo[data-code=marsvin]").click()
    await expect(page.locator("#body")).to_have_value(re.compile(r":marsvin:"))


async def test_the_owner_adds_and_removes(emoji_page):
    page, api, picture = emoji_page
    await page.evaluate("openGroupEmoji()")
    dialog = page.get_by_role("dialog", name="The group's emoji")
    await expect(dialog.locator(".gemoji-row")).to_have_count(1)
    await expect(dialog).to_contain_text("1 of 16 used")
    await page.set_input_files("#gemfile", str(picture))
    await expect(dialog.locator("#gemname")).to_have_value("marsvin")    # from the file's name
    await dialog.locator("#gemname").fill("gris")
    await dialog.get_by_role("button", name="Add and publish").click()
    await expect(dialog.locator(".gemoji-row")).to_have_count(2)
    assert api.posted[-1]["add"]["name"] == "gris" and api.posted[-1]["add"]["data"]
    await dialog.locator(".gemoji-row").filter(has_text=":gris:").get_by_role("button", name="Remove").click()
    await expect(dialog.locator(".gemoji-row")).to_have_count(1)
    assert api.posted[-1] == {"remove": "gris"}
