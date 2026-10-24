"""Feeds (#60, UN-RFC 0034, UN-RFC 0046 section 4.14) against a synthetic local API: a
group shown as a feed with every entry whole and its comments under it, commenting
and answering a comment, the timeline, following from a profile, whom you follow, and
starting your own feed only after the warning.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_feeds.py
"""

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43
FEED = "feed@bobbobbobbobbobb"
BOB = "ed25519:bob"
OK = {"allowed": True, "reason": "", "code": "ok"}
CLOSED = {"allowed": False, "reason": "Comments are closed on this entry", "code": "comments_closed"}


def row(mid, text, depth=0, kind="chat", subject="", refs=(), who="Bob", key=BOB, comment=OK,
        group=FEED, mine=False):
    return {"who": who, "who_key": key, "mine": mine, "may_edit": False, "may_withdraw": False,
            "read": True, "depth": depth, "comment": comment, "reply": OK,
            "group_label": "Bob's feed", "address": f"unseenet:{group}?m={mid.strip('<>')}",
            "message": {"id": mid, "group": group, "subject": subject, "text": text,
                        "signature": "", "references": list(refs), "kind": kind,
                        "readable": True, "sender_key": key, "private": False,
                        "date": "2026-01-01T12:00:00Z"}}


class FeedAPI:
    """Synthetic answers only: no vault, Tor or outgoing messages."""

    def __init__(self):
        self.posted, self.follows, self.started = [], [], []
        self.following = False
        self.comments = [row(f"<c{i}@x>", f"Kommentar {i}", 1, refs=["<a@x>"], who=f"Læser {i}",
                             key=f"ed25519:r{i}") for i in range(4)]
        self.comments.append(row("<d@x>", "Svar på svar", 2, refs=["<a@x>", "<c1@x>"], who="Dybt",
                                 key="ed25519:deep"))
        self.comments.append(row("<e@x>", "Dybere", 3, refs=["<a@x>", "<c1@x>", "<d@x>"],
                                 who="Dybest", key="ed25519:deeper"))

    def rows(self, group=FEED):
        return [row("<a@x>", "En kort note", group=group), *self.comments,
                row("<b@x>", "Lang tekst her", kind="post", subject="En overskrift", comment=CLOSED,
                    group=group)]

    def group(self, gid=FEED):
        return {"id": gid, "label": "Bob's feed", "type": "channel", "view": "feed",
                "owner_view": "feed", "hierarchy": "feed", "may_post": False, "unread": 0,
                "kinds": ["chat", "post"], "subscribed": True,
                "write": {"post": {"allowed": False, "reason": "Only Bob writes here", "code": "channel"},
                          "chat": {"allowed": False, "reason": "Only Bob writes here", "code": "channel"}}}

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
                    "hierarchies": [{"name": "feed", "tree": None}], "inbox": {"id": "inbox:test"},
                    "timeline": {"id": "timeline:", "feeds": 1}}
        elif path == f"/api/groups/{FEED}/post":
            self.posted.append(await request.json())
            data = {"job": f"j{len(self.posted)}"}
        elif request.method == "GET" and path == f"/api/groups/{FEED}":
            data = {"group": self.group(), "rows": self.rows()}
        elif request.method == "GET" and path == "/api/groups/timeline:":
            data = {"group": {"id": "timeline:", "label": "Timeline", "view": "feed", "feeds": 1,
                              "may_post": False, "hierarchy": ""}, "rows": self.rows()}
        elif path == "/api/profile":
            data = {"key": request.query.get("key"), "label": "Bob", "mine": False, "hidden": False,
                    "profile": None, "address": "unseenet:" + "b" * 16, "feed": FEED,
                    "following": self.following}
        elif path == "/api/following" and request.method == "POST":
            body = await request.json()
            self.follows.append(body)
            self.following = body.get("on", True)
            data = {"ok": True, "fingerprint": "b" * 16, "key": BOB, "name": None,
                    "feeds": [FEED], "new": [FEED]}
        elif path == "/api/following":
            data = {"people": [{"fingerprint": "b" * 16, "key": BOB, "name": None, "label": "Bob",
                                "feeds": [{"id": FEED, "label": "Bob's feed", "title": "",
                                           "type": "channel", "personal": True}]}],
                    "feeds": [{"id": FEED, "label": "Bob's feed", "title": "", "type": "channel",
                               "personal": True}]}
        elif path == "/api/feed" and request.method == "POST":
            self.started.append(await request.json())
            data = {"ok": True, "id": "feed@memememememememe"}
        elif path == "/api/feed":
            data = {"id": "feed@memememememememe", "started": False, "followed": False,
                    "warning": "A personal feed is public and tied to this identity.\n\nWhat you publish can be kept."}
        elif path == "/api/pictures":
            data = {"pictures": {}}
        else:
            data = {}
        return web.json_response(data)


@pytest.fixture
async def feed_page():
    api = FeedAPI()
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
            yield page, api
        finally:
            await browser.close()
        assert errors == []


async def open_feed(page):
    await page.get_by_role("button", name="Bob's feed").first.click()
    await page.wait_for_load_state("networkidle")


async def test_entries_whole_with_comments_under_them(feed_page):
    page, api = feed_page
    await open_feed(page)
    entries = page.locator(".entry")
    await expect(entries).to_have_count(2)
    note, post = entries.nth(0), entries.nth(1)
    await expect(note).to_contain_text("En kort note")
    await expect(note.locator(".etitle")).to_have_count(0)              # a note has no headline
    await expect(post.locator(".etitle")).to_have_text("En overskrift")
    await expect(note.locator(".comment")).to_have_count(2)             # the newest two
    await note.get_by_role("button", name="Show all 6 comments").click()
    await expect(note.locator(".comment")).to_have_count(6)
    await expect(note.locator(".comment.answer").last).to_contain_text("in answer to Dybt")
    await expect(post).to_contain_text("Comments are closed.")
    await expect(post.locator(".cbar")).to_have_count(0)
    await expect(page.locator(".notebar")).to_have_count(0)            # a channel: only Bob writes

    box = note.locator('[data-k="c:<a@x>"]')
    await box.fill("Godt sagt")
    await box.press("Enter")
    await expect(note.locator(".comment.pending")).to_contain_text("Godt sagt")
    assert api.posted[-1] == {"body": "Godt sagt", "references": ["<a@x>"], "kind": "chat"}

    await note.locator('.comment[data-id="<c1@x>"]').get_by_role("button", name="Answer").click()
    await expect(note.locator(".answering")).to_contain_text("Answering Læser 1")
    await page.locator('[data-k="c:<a@x>"]').fill("Enig")
    await page.locator('[data-k="c:<a@x>"]').press("Enter")
    await expect(note.locator(".comment.pending")).to_have_count(2)
    assert api.posted[-1]["references"] == ["<a@x>", "<c1@x>"]
    await expect(note.locator(".answering")).to_have_count(0)          # back to the entry


async def test_the_timeline_and_following(feed_page):
    page, api = feed_page
    await page.get_by_role("button", name="Timeline").click()
    await page.wait_for_load_state("networkidle")
    await expect(page.locator(".feed-note")).to_contain_text("1 feed you follow")
    await expect(page.locator(".entry").first.locator(".efeed")).to_have_text("in Bob's feed")

    await page.locator(".entry").first.get_by_role("button", name="Bob").first.click()   # the profile
    dialog = page.locator(".dialog")
    await dialog.get_by_role("button", name="Follow", exact=True).click()
    await expect(page.locator(".toast")).to_contain_text("Following Bob")
    assert api.follows[-1] == {"person": BOB, "on": True}
    await expect(dialog.get_by_role("button", name="Unfollow")).to_be_visible()
    await page.keyboard.press("Escape")

    await page.keyboard.press("Control+k")
    await page.keyboard.type("Whom you follow")
    await page.keyboard.press("Enter")
    await expect(page.locator(".dialog")).to_contain_text("Bob's feed")


async def test_starting_your_feed_warns_first(feed_page):
    page, api = feed_page
    await page.keyboard.press("Control+k")
    await page.keyboard.type("Your feed")
    await page.keyboard.press("Enter")
    dialog = page.locator(".dialog")
    await expect(dialog.locator(".warnbox")).to_contain_text("public and tied to this identity")
    assert api.started == []
    await dialog.get_by_label("No comments").check()
    await dialog.get_by_role("button", name="Start my feed").click()
    await expect(page.locator(".toast")).to_contain_text("Your feed is started")
    assert api.started == [{"comments": "none"}]


async def test_a_feed_switches_to_threads_and_back(feed_page):
    page, _ = feed_page
    await open_feed(page)
    await expect(page.get_by_role("button", name="Show as threads")).to_be_visible()
