"""Comments on one entry (#237, #238, UN-RFC 0030 sections 3.1-3.3, UN-RFC 0046 4.24): a
close's note where the comment box was, "Comments close in N hours" once less than a day
is left, Close comments in the ⋯ menu, and a new thread's own time for comments.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_comments_close.py
"""

from datetime import datetime, timedelta, timezone

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

import test_feeds as tf

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

OPEN_GROUP = "dk.debat@ownerownerownero"


class CommentsAPI(tf.FeedAPI):
    def __init__(self):
        super().__init__()
        self.closes, self.created, self.settings = [], [], []

    def rows(self, group=tf.FEED):
        out = super().rows(group)
        soon = (datetime.now(timezone.utc) + timedelta(hours=3, minutes=10)).isoformat()
        for r in out:
            if r["message"]["id"] == "<a@x>":
                r.update(may_close_comments=True,
                         comments={"open": True, "reason": None, "until": soon, "note": "",
                                   "by": None, "own_days": 2, "group_days": 7})
            if r["message"]["id"] == "<b@x>":
                r["comments"] = {"open": False, "reason": "closed", "until": None,
                                 "note": "For meget spam", "by": tf.BOB, "own_days": None,
                                 "group_days": 7}
        return out

    def group(self, gid=tf.FEED):
        if gid == OPEN_GROUP:
            ok = {"allowed": True, "reason": "", "code": "ok"}
            return {"id": gid, "label": "dk.debat", "type": "open", "view": "threads",
                    "owner_view": "threads", "hierarchy": "dk", "may_post": True, "unread": 0,
                    "kinds": ["post"], "subscribed": True, "owner": True,
                    "comment_days": 14, "comment_days_possible": True, "comments": None,
                    "write": {"post": ok, "chat": ok}, "files": None}
        return {**super().group(gid), "comment_days": 7, "comment_days_possible": True,
                "comments": "open"}

    async def handle(self, request):
        path = request.path
        if path == f"/api/groups/{tf.FEED}/comments":
            self.closes.append(await request.json())
            return web.json_response({"ok": True, "marker": "<m@x>", "comments": {"open": False}})
        if path == "/api/groups" and request.method == "POST":
            self.created.append(await request.json())
            return web.json_response({"id": OPEN_GROUP})
        if path == "/api/groups" and request.method == "GET":
            resp = await super().handle(request)
            import json
            data = json.loads(resp.body)
            data["groups"].append(self.group(OPEN_GROUP))
            data["hierarchies"].append({"name": "dk", "tree": None})
            return web.json_response(data)
        if path == f"/api/groups/{OPEN_GROUP}" and request.method == "GET":
            return web.json_response({"group": self.group(OPEN_GROUP), "rows": []})
        if path == f"/api/groups/{OPEN_GROUP}/post":
            self.posted.append(await request.json())
            return web.json_response({"job": "jp"})
        return await super().handle(request)


@pytest.fixture
async def page_api():
    api = CommentsAPI()
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
            await page.goto(str(server.make_url("/")) + "#t=" + tf.TOKEN)
            await page.wait_for_load_state("networkidle")
            yield page, api
        finally:
            await browser.close()
        assert errors == []


async def test_a_closes_note_and_the_time_left(page_api):
    page, api = page_api
    await tf.open_feed(page)
    closed = page.locator('article.entry[data-id="<b@x>"]')
    await expect(closed).to_contain_text("Comments were closed: For meget spam")
    first = page.locator('article.entry[data-id="<a@x>"]')
    await expect(first).to_contain_text("Comments close in 3 hours")


async def test_close_comments_from_the_menu(page_api):
    page, api = page_api
    await tf.open_feed(page)
    first = page.locator('article.entry[data-id="<a@x>"]')
    await first.get_by_role("button", name="More").first.click()
    await first.get_by_role("menuitem", name="Close comments").click()
    dialog = page.get_by_role("dialog")
    await dialog.locator("#cnote").fill("Nok nu")
    await dialog.get_by_role("button", name="Close comments").click()
    await expect(page.locator(".toast")).to_contain_text("Comments are closed")
    assert api.closes == [{"id": "<a@x>", "close": True, "note": "Nok nu"}]


async def test_a_new_threads_own_time_for_comments(page_api):
    page, api = page_api
    await page.evaluate(f"openGroup('{OPEN_GROUP}')")
    await page.wait_for_load_state("networkidle")
    await page.evaluate("openCompose()")
    dialog = page.get_by_role("dialog")
    options = await dialog.locator("#cdays option").all_text_contents()
    assert options == ["As the group (14 days)", "No comments", "A day", "A week"]
    await dialog.locator("#subject").fill("Emne")
    await dialog.locator("#body").fill("Hej\n")
    await dialog.locator("#cdays").select_option("1")
    await dialog.get_by_role("button", name="Post").first.click()
    await page.wait_for_timeout(300)
    assert api.posted and api.posted[-1]["comment_days"] == 1


async def test_create_a_group_with_days_for_replies(page_api):
    page, api = page_api
    await page.evaluate("openCreateGroup()")
    dialog = page.get_by_role("dialog")
    await expect(dialog).to_contain_text("Replies close after")
    await dialog.locator("#gname").fill("dk.debat")
    await dialog.locator("#gdays").fill("10")
    await dialog.get_by_role("button", name="Create").click()
    await page.wait_for_timeout(300)
    assert api.created and api.created[-1]["comment_days"] == 10
    await page.evaluate("openCreateGroup()")
    await page.get_by_role("dialog").get_by_role("button", name="» Chat messages in order").click()
    await expect(page.get_by_role("dialog").locator("#gdays")).to_have_count(0)   # not for chat
