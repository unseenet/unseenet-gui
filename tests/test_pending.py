"""Your own chat line is visible, greyed out, the whole way to the node (#48).

A local API fixture with a slow POST and job events sent by hand: the line must show
in the same frame as the input is cleared, survive job events that beat the HTTP
answer, stay through `reached` while the group reloads, and be drawn once at the end.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_pending.py
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
NEW_ID = "<new@unseenet>"


def group():
    return {"id": GROUP, "label": "alt.chat", "type": "open", "view": "chat",
            "hierarchy": "alt", "may_post": True, "kinds": ["chat"], "unread": 0}


def row(mid, text, mine=False):
    key = "ed25519:me" if mine else "ed25519:other"
    return {"who": "Me" if mine else "Someone", "who_key": key, "mine": mine, "may_edit": False,
            "read": True, "depth": 0,
            "message": {"id": mid, "group": GROUP, "subject": "", "text": text, "signature": "",
                        "references": [], "kind": "chat", "readable": True, "sender_key": key,
                        "private": False, "date": "2026-01-01T12:00:00Z"}}


class ChatAPI:
    """Synthetic answers only: no vault, Tor or outgoing messages."""

    def __init__(self):
        self.socket = None
        self.connected = asyncio.Event()
        self.post_gate = asyncio.Event()          # the POST answers when this is set
        self.post_waiting = asyncio.Event()
        self.load_gate = None                     # a group reload waits on this, when set
        self.load_waiting = asyncio.Event()
        self.has_new = False
        self.posts = []

    async def events(self, request):
        self.socket = web.WebSocketResponse(protocols=["unseenet"])
        await self.socket.prepare(request)
        self.connected.set()
        async for _ in self.socket:
            pass
        return self.socket

    async def emit(self, **event):
        await asyncio.wait_for(self.connected.wait(), 5)
        await self.socket.send_json(event)

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
            data = {"groups": [group()], "people": [], "hierarchies": [{"name": "alt", "tree": None}],
                    "inbox": {"id": "inbox:test"}}
        elif path.startswith("/x/gui/write/"):
            data = {"post": {"allowed": True}, "chat": {"allowed": True}}
        elif request.method == "GET" and path.startswith("/api/groups/"):
            if self.load_gate is not None:
                self.load_waiting.set()
                await self.load_gate.wait()
            rows = [row("<old@x>", "hello there")]
            if self.has_new:
                rows.append(row(NEW_ID, "my new line", mine=True))
            data = {"group": group(), "rows": rows}
        elif path.endswith("/post"):
            self.posts.append(await request.json())
            self.post_waiting.set()
            await self.post_gate.wait()
            data = {"job": "job1"}
        else:
            data = {}
        return web.json_response(data)


@pytest.fixture
async def chat_page():
    api = ChatAPI()
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
            await page.get_by_role("button", name="alt.chat").first.click()
            await expect(page.locator(".bubble", has_text="hello there")).to_be_visible()
            yield page, api
        finally:
            api.post_gate.set()
            if api.load_gate is not None:
                api.load_gate.set()
            await browser.close()
        assert errors == []


async def send_line(page, api):
    chat = page.locator("#chat")
    await chat.fill("my new line")
    await chat.press("Enter")
    await asyncio.wait_for(api.post_waiting.wait(), 5)


async def test_line_is_grey_from_enter_to_the_node(chat_page):
    page, api = chat_page
    await send_line(page, api)
    # the POST has not answered yet: the line is there, grey, and the input empty
    pending = page.locator(".bubble.pending", has_text="my new line")
    await expect(pending).to_be_visible()
    await expect(page.locator("#chat")).to_have_value("")
    await expect(page.locator(".msgs .sending")).to_contain_text("Sending")

    api.post_gate.set()
    await api.emit(event="job", job="job1", group=GROUP, state="pow", fraction=0.5)
    await expect(page.locator(".msgs .sending")).to_contain_text("postage 50%")
    await api.emit(event="job", job="job1", group=GROUP, state="sent", message_id=NEW_ID)
    await expect(pending).to_be_visible()

    # the node's copy arrives before `reached`: drawn once, not twice
    api.has_new = True
    await api.emit(event="group-updated", group_id=GROUP, new=True)
    await expect(page.locator(".bubble", has_text="my new line")).to_have_count(1)
    await expect(page.locator(".bubble.pending")).to_have_count(0)

    await api.emit(event="job", job="job1", group=GROUP, state="reached", message_id=NEW_ID)
    await expect(page.locator(".state.ok", has_text="reached the node")).to_be_visible()
    await expect(page.locator(".bubble", has_text="my new line")).to_have_count(1)


async def test_job_event_before_the_http_answer_is_kept(chat_page):
    page, api = chat_page
    await send_line(page, api)
    await api.emit(event="job", job="job1", group=GROUP, state="pow", fraction=0.25)
    api.post_gate.set()
    await expect(page.locator(".msgs .sending")).to_contain_text("postage 25%")


async def test_no_gap_while_the_group_reloads_after_reached(chat_page):
    page, api = chat_page
    await send_line(page, api)
    api.post_gate.set()
    await api.emit(event="job", job="job1", group=GROUP, state="sent", message_id=NEW_ID)
    await expect(page.locator(".bubble.pending")).to_be_visible()

    api.load_gate = asyncio.Event()
    api.has_new = True
    await api.emit(event="job", job="job1", group=GROUP, state="reached", message_id=NEW_ID)
    await asyncio.wait_for(api.load_waiting.wait(), 5)
    # something else redraws meanwhile (any event that calls render())
    await api.emit(event="ripening", level=4, next_at=None, t=0)       # redraws while a post is pending
    await page.wait_for_timeout(200)
    # reloading: the grey line is still there, now saying it reached the node
    await expect(page.locator(".bubble.pending", has_text="my new line")).to_be_visible()
    api.load_gate.set()
    await expect(page.locator(".bubble.pending")).to_have_count(0)
    await expect(page.locator(".bubble", has_text="my new line")).to_have_count(1)
