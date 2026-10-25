"""Reactions (#107, UN-RFC 0048, UN-RFC 0046 sections 4.3, 4.5) against a synthetic local
API: the counts under feed entries, comments, posts and chat lines, yours marked; a
click reacts or takes yours back, + offers the group's set, right-click says who;
nothing to click where the group takes none; and the choice in the group's settings.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_reactions.py
"""

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43
GROUP = "alt.likes@abcd"
SET = ["👍", "👎", "❤️", "😂", "😮", "😢"]


class ReactAPI:
    """Synthetic answers only: no vault, Tor or outgoing messages."""

    def __init__(self, view, takes=True):
        self.view, self.takes = view, takes
        self.counts = {"<a@x>": [{"emoji": "❤️", "count": 2, "mine": False}], "<b@x>": [],
                       "<c@x>": [{"emoji": "👍", "count": 1, "mine": False}]}
        self.requests = []
        self.settings = []

    def head(self):
        offered = SET if self.takes else []
        return {"id": GROUP, "label": "alt.likes", "type": "open", "view": self.view,
                "owner_view": self.view, "hierarchy": "alt", "may_post": True, "unread": 0,
                "owner": True, "kinds": ["chat", "post"],
                "write": {"post": {"allowed": True}, "chat": {"allowed": True}},
                "pins": [], "max_pins": 5, "may_pin": False,
                "reactions": {"offered": offered, "any": False,
                              "setting": "default" if self.takes else "none"}}

    def row(self, mid, depth, refs, kind, text, mine=False):
        perm = {"allowed": self.takes, "reason": "" if self.takes else "This group takes no reactions",
                "code": "ok" if self.takes else "no_reactions"}
        return {"who": "Me" if mine else "Someone", "who_key": "ed25519:me" if mine else "ed25519:other",
                "mine": mine, "may_edit": False,
                "may_withdraw": False, "read": True, "depth": depth, "pinned": False,
                "reactions": self.counts.get(mid, []), "react": perm,
                "react_offered": {"offered": SET if self.takes else [], "any": False},
                "comment": {"allowed": True}, "reply": {"allowed": True},
                "message": {"id": mid, "group": GROUP, "subject": "" if kind == "chat" else "Hej",
                            "text": text, "signature": "", "references": refs, "kind": kind,
                            "readable": True, "sender_key": "ed25519:other", "private": False,
                            "date": "2026-01-01T12:00:00Z"}}

    def rows(self):
        kind = "chat" if self.view == "chat" else "post"
        return [self.row("<a@x>", 0, [], kind, "Første opslag"),
                self.row("<b@x>", 1, ["<a@x>"], "chat", "En kommentar"),
                # your own, with react still allowed as an older core says (#119)
                self.row("<c@x>", 1, ["<a@x>"], "chat", "Min egen", mine=True)]

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
            data = {"groups": [self.head()], "people": [],
                    "hierarchies": [{"name": "alt", "tree": None}], "inbox": {"id": "inbox:test"}}
        elif path == f"/api/groups/{GROUP}/react":
            body = await request.json()
            if body.get("who"):
                data = {"who": ["Sonia √", "Mikkel~ab12"]}
            else:
                self.requests.append(body)
                data = {"job": "job1"}
        elif path == f"/api/groups/{GROUP}/settings":
            self.settings.append(await request.json())
            data = {"ok": True}
        elif request.method == "GET" and path == f"/api/groups/{GROUP}":
            data = {"group": self.head(), "rows": self.rows()}
        elif path == "/api/pictures":
            data = {"pictures": {}}
        else:
            data = {}
        return web.json_response(data)


@pytest.fixture
async def page_api(request):
    view, takes = request.param
    api = ReactAPI(view, takes)
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
            await page.get_by_role("button", name="alt.likes").first.click()
            await page.wait_for_load_state("networkidle")
            yield page, api
        finally:
            await browser.close()
        assert errors == []


@pytest.mark.parametrize("page_api", [("feed", True)], indirect=True)
async def test_feed_counts_react_and_take_back(page_api):
    page, api = page_api
    entry = page.locator(".entry").first
    heart = entry.locator(".reacts").first.get_by_role("button", name="❤️ 2")
    await expect(heart).to_be_visible()
    await heart.click()                                               # give ❤️ too
    await expect(entry.locator(".react.mine")).to_contain_text("3")
    assert api.requests[-1] == {"id": "<a@x>", "emoji": "❤️"}

    await entry.locator(".reacts").first.get_by_role("button", name="Add a reaction").click()
    pop = page.get_by_role("dialog", name="React")
    await expect(pop.locator(".emo")).to_have_count(6)
    await pop.get_by_role("button", name="👍").click()               # change to 👍
    assert api.requests[-1] == {"id": "<a@x>", "emoji": "👍"}
    await expect(entry.locator(".react.mine")).to_contain_text("👍")

    comment = page.locator(".comment").first                          # comments too
    await expect(comment.get_by_role("button", name="Add a reaction")).to_be_visible()


@pytest.mark.parametrize("page_api", [("feed", True)], indirect=True)
async def test_right_click_says_who(page_api):
    page, api = page_api
    await page.locator(".entry .react").first.click(button="right")
    await expect(page.locator(".toast")).to_contain_text("Sonia")


@pytest.mark.parametrize("page_api", [("chat", True)], indirect=True)
async def test_chat_lines_have_reactions(page_api):
    page, api = page_api
    bubble = page.locator(".bubble").first
    await expect(bubble.locator(".reacts")).to_be_visible()
    await bubble.get_by_role("button", name="Add a reaction").click()
    await page.get_by_role("dialog", name="React").get_by_role("button", name="😂").click()
    assert api.requests[-1]["emoji"] == "😂"


@pytest.mark.parametrize("page_api", [("threads", False)], indirect=True)
async def test_nothing_to_click_where_the_group_takes_none(page_api):
    page, api = page_api
    await page.locator(".prow").first.click()
    reader = page.get_by_role("article", name="Post")
    await expect(reader.get_by_role("button", name="❤️ 2")).to_be_disabled()   # shown, not clickable
    await expect(reader.get_by_role("button", name="Add a reaction")).to_have_count(0)


@pytest.mark.parametrize("page_api", [("feed", True)], indirect=True)
async def test_settings_choose_the_set(page_api):
    page, api = page_api
    await page.evaluate("openEditGroup()")
    dialog = page.get_by_role("dialog", name="Edit group")
    await dialog.get_by_role("button", name="Your own").click()
    await dialog.get_by_label("Your own reactions").fill("🎉 ❤️ 🎉")
    await dialog.get_by_role("button", name="Save").click()
    await expect(dialog).to_have_count(0)
    assert api.settings[-1]["reactions"] == ["🎉", "❤️"]


@pytest.mark.parametrize("page_api", [("feed", True)], indirect=True)
async def test_no_reacting_to_your_own(page_api):
    """#119 (unseenet#524): others' reactions on yours are shown, but there is no +."""
    page, api = page_api
    mine = page.locator('.comment[data-id="<c@x>"]')
    await expect(mine.get_by_role("button", name="👍 1")).to_be_visible()
    await expect(mine.get_by_role("button", name="👍 1")).to_be_disabled()
    await expect(mine.get_by_role("button", name="Add a reaction")).to_have_count(0)


@pytest.mark.parametrize("page_api", [("feed", True)], indirect=True)
async def test_calm_feed_actions(page_api):
    """#120: icons with tooltips; on a comment + and Answer show on hover; Copy address
    only in ⋯."""
    page, api = page_api
    entry = page.locator(".entry").first
    act = entry.locator(".eact")
    await expect(act.get_by_role("button", name="Comment (2)")).to_have_attribute("title", "Comment")
    await expect(act.get_by_role("button", name="Reply with a post")).to_be_visible()
    await expect(act.get_by_role("button", name="Copy address")).to_have_count(0)

    comment = page.locator('.comment[data-id="<b@x>"]')
    add = comment.get_by_role("button", name="Add a reaction")
    answer = comment.get_by_role("button", name="Answer")
    await page.mouse.move(1, 1)
    await expect(add).to_have_css("opacity", "0")
    await expect(answer).to_have_css("opacity", "0")
    await comment.locator(".ctext").hover()
    await expect(add).to_have_css("opacity", "1")
    await expect(answer).to_have_css("opacity", "1")
