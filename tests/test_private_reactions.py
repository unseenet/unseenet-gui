"""#140: reactions in private chats and posts, on the core's private reactions
(unseenet#513, UN-RFC 0048 section 4.3) - the same bar as in groups; any emoji."""
import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect
TOKEN = "t" * 43
SONIA = "ed25519:" + "s" * 52
CONTACT = "contact:" + SONIA
INBOX = "inbox@mememememememe"
OK = {"allowed": True, "reason": "", "code": "ok"}
OWN = {"allowed": False, "reason": "You cannot react to your own post", "code": "own"}


class API:
    def __init__(self):
        self.reacted = []

    def row(self, mid, text, mine):
        return {"who": "You" if mine else "Sonia", "who_key": "ed25519:me" if mine else SONIA,
                "mine": mine, "read": True, "depth": 0, "reply": OK,
                "reactions": [] if mine else [{"emoji": "❤️", "count": 1, "mine": False}],
                "react": OWN if mine else OK,
                "react_offered": {"offered": ["👍", "❤️", "😂"], "any": True},
                "message": {"id": mid, "group": INBOX, "subject": "", "text": text, "signature": "",
                            "references": [], "kind": "chat", "readable": True, "private": True,
                            "encrypted": True, "sender_key": "ed25519:me" if mine else SONIA,
                            "date": "2026-10-26T12:00:00Z", **({"to": SONIA} if mine else {})}}

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
            data = {"groups": [], "hierarchies": [], "inbox": {"id": INBOX},
                    "people": [{"id": CONTACT, "key": SONIA, "name": "Sonia", "contact": True, "unread": 0}]}
        elif request.method == "GET" and path == f"/api/groups/{CONTACT}":
            data = {"group": {"id": CONTACT, "label": "Sonia", "type": "contact", "view": "chat",
                              "kinds": ["chat", "post"], "may_post": True, "hierarchy": "",
                              "key": SONIA},
                    "rows": [self.row("<a@x>", "Hej fra Sonia", False), self.row("<b@x>", "Hej selv", True)]}
        elif path == f"/api/groups/{INBOX}/react":
            body = await request.json()
            if body.get("who"):
                data = {"who": ["Sonia √"]}
            else:
                self.reacted.append(body)
                data = {"job": "j1"}
        elif path == "/api/notifications":
            data = {"settings": {"on": False, "content": False}, "count": 0, "items": []}
        elif path == "/api/pictures":
            data = {"pictures": {}}
        else:
            data = {}
        return web.json_response(data)


@pytest.fixture
async def chat():
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
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
        await page.wait_for_load_state("networkidle")
        await page.get_by_role("button", name="Sonia").first.click()
        await page.wait_for_load_state("networkidle")
        yield page, api
        await browser.close()
        assert errors == []


async def test_reacting_in_a_private_chat(chat):
    page, api = chat
    bars = page.get_by_role("group", name="Reactions")
    await expect(bars).to_have_count(1)                     # Sonia's line only, not your own
    await bars.first.get_by_role("button", name="❤️ 1").click()
    for _ in range(50):
        if api.reacted:
            break
        await page.wait_for_timeout(50)
    assert api.reacted[0]["emoji"] == "❤️" and api.reacted[0]["id"] == "<a@x>"
