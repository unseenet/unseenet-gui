"""The emoji picker and :shortcode: completion (#21), in the real page.

A local API fixture serves a small GET /api/emoji (the core's, unseenet#362) and a
chat group; nothing is sent anywhere.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_emoji.py
"""

import asyncio

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43
GROUP = "alt.chat@abcd"
EMOJI = {
    "table": {"+1": "👍", "smile": "😄", "taco": "🌮", "tada": "🎉", "thumbsup": "👍"},
    "categories": [{"name": "Smileys & Emotion", "codes": ["smile"]},
                   {"name": "People & Body", "codes": ["+1"]},
                   {"name": "Food & Drink", "codes": ["taco"]},
                   {"name": "Activities", "codes": ["tada"]}],
    "names": {"smile": "grinning face with smiling eyes happy", "+1": "thumbs up approve ok thumbsup",
              "taco": "taco", "tada": "party popper hooray"},
}


class API:
    def __init__(self, emoji=True):
        self.emoji = emoji
        self.posts = []
        self.emoji_gate = None                  # GET /api/emoji waits on this, when set

    async def events(self, request):
        ws = web.WebSocketResponse(protocols=["unseenet"])
        await ws.prepare(request)
        async for _ in ws:
            pass
        return ws

    async def handle(self, request):
        path = request.path
        group = {"id": GROUP, "label": "alt.chat", "type": "open", "view": "chat", "hierarchy": "alt",
                 "may_post": True, "kinds": ["chat"], "unread": 0}
        if path == "/api/state":
            data = {"unlocked": True, "connected": True, "status": "Connected",
                    "identity": {"display": "Me", "label": "Me", "key": "ed25519:me"}}
        elif path == "/x/gui/state":
            data = {"bootable": False, "web": False}
        elif path == "/api/emoji" and self.emoji:
            if self.emoji_gate is not None:
                await self.emoji_gate.wait()
            data = EMOJI
        elif path == "/api/groups":
            data = {"groups": [group], "people": [], "hierarchies": [{"name": "alt", "tree": None}],
                    "inbox": {"id": "inbox:test"}}
        elif path.startswith("/x/gui/write/"):
            data = {"post": {"allowed": True}, "chat": {"allowed": True}}
        elif request.method == "GET" and path.startswith("/api/groups/"):
            data = {"group": group, "rows": []}
        elif path.endswith("/post"):
            self.posts.append(await request.json())
            data = {"job": "job1"}
        elif path == "/api/settings":
            data = {"signature_preview": "", "notices": {"send": True}}
        else:
            raise web.HTTPNotFound()
        return web.json_response(data)


async def page_with(api):
    app = web.Application()

    async def index(_request):
        return web.FileResponse(STATIC / "index.html")

    app.router.add_get("/", index)
    app.router.add_static("/static/", STATIC)
    app.router.add_get("/api/events", api.events)
    app.router.add_route("*", "/api/{path:.*}", api.handle)
    app.router.add_route("*", "/x/gui/{path:.*}", api.handle)
    return app


@pytest.fixture
async def chat(request):
    api = API(emoji=getattr(request, "param", True))
    async with TestServer(await page_with(api), host="127.0.0.1") as server, playwright.async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
            await page.wait_for_load_state("networkidle")
            await page.get_by_role("button", name="alt.chat").first.click()
            await expect(page.locator("#chat")).to_be_visible()
            yield page, api
        finally:
            await browser.close()
        assert errors == []


async def test_picker_search_and_categories(chat):
    page, api = chat
    await page.get_by_role("button", name="Emoji").click()
    picker = page.get_by_role("dialog", name="Choose an emoji")
    await expect(picker).to_be_visible()
    await picker.get_by_role("tab", name="Activities").click()
    await expect(picker.get_by_role("button", name="tada")).to_be_visible()
    await picker.get_by_role("tab", name="Food & Drink").click()
    await picker.get_by_role("button", name="taco").click()
    await expect(picker).to_be_hidden()
    await expect(page.locator("#chat")).to_have_value(":taco: ")
    await expect(page.locator("#chat")).to_be_focused()

    # search by a word of the name; Enter takes the first; now there is "recently used"
    await page.locator("#chat").press_sequentially("yum")
    await page.get_by_role("button", name="Emoji").click()
    await expect(picker.get_by_role("tab", name="Recently used")).to_have_attribute("aria-selected", "true")
    await picker.get_by_role("searchbox", name="Search emoji").fill("party")
    await picker.get_by_role("searchbox", name="Search emoji").press("Enter")
    await expect(page.locator("#chat")).to_have_value(":taco: yum :tada: ")
    assert api.posts == []


async def test_escape_closes_the_picker_and_keeps_the_text(chat):
    page, _ = chat
    await page.locator("#chat").fill("hello")
    await page.get_by_role("button", name="Emoji").click()
    await expect(page.get_by_role("dialog", name="Choose an emoji")).to_be_visible()
    await page.keyboard.press("Escape")
    await expect(page.get_by_role("dialog", name="Choose an emoji")).to_be_hidden()
    await expect(page.locator("#chat")).to_have_value("hello")
    await expect(page.locator("#chat")).to_be_focused()


async def test_completion_takes_enter_instead_of_sending(chat):
    page, api = chat
    field = page.locator("#chat")
    await field.press_sequentially("hi :ta")
    options = page.get_by_role("listbox", name="Emoji").get_by_role("option")
    await expect(options).to_have_count(2)
    await expect(options.first).to_contain_text(":taco:")    # the same length: by name, as the core
    await field.press("ArrowDown")
    await field.press("Enter")
    await expect(field).to_have_value("hi :tada: ")
    await expect(page.get_by_role("listbox", name="Emoji")).to_be_hidden()
    assert api.posts == []
    await field.press("Enter")                                # now it sends
    await page.wait_for_timeout(200)
    assert [p["body"] for p in api.posts] == ["hi :tada:"]


async def test_completion_escape_and_one_per_glyph(chat):
    page, _ = chat
    field = page.locator("#chat")
    await field.press_sequentially(":thu")
    options = page.get_by_role("listbox", name="Emoji").get_by_role("option")
    await expect(options).to_have_count(1)                   # :thumbsup: and :+1: are one emoji
    await field.press("Escape")
    await expect(page.get_by_role("listbox", name="Emoji")).to_be_hidden()
    await expect(field).to_have_value(":thu")
    await field.press_sequentially("x")                       # no match: nothing shows
    await expect(page.get_by_role("listbox", name="Emoji")).to_be_hidden()


@pytest.mark.parametrize("chat", [False], indirect=True)
async def test_no_button_with_a_core_without_api_emoji(chat):
    page, _ = chat
    await page.locator("#chat").press_sequentially("hi :ta")
    await expect(page.get_by_role("button", name="Emoji")).to_have_count(0)


async def test_suggestions_survive_a_redraw_while_the_data_comes(chat):
    """The page redraws (a group reloads, say) while the emoji data is on its way: the
    field is a new element then, found again by its data-k - suggestions still come."""
    page, api = chat
    api.emoji_gate = asyncio.Event()
    await page.locator("#chat").press_sequentially(":thu")
    await page.evaluate("render()")
    api.emoji_gate.set()
    await expect(page.get_by_role("listbox", name="Emoji").get_by_role("option")).to_have_count(1)
