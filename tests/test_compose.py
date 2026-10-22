"""Compose drafts survive server events in the real page, with a local API fixture.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_compose.py
"""

import asyncio
import re
from contextlib import nullcontext

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43
GROUP = "alt.test@abcd"
INBOX = "inbox:test"
OTHER = "ed25519:other"


def group(gid=GROUP, unread=0):
    return {"id": gid, "label": "Private posts" if gid == INBOX else "alt.test@abcd",
            "type": "inbox" if gid == INBOX else "open", "view": "threads",
            "hierarchy": "alt", "may_post": True, "kinds": ["post"], "unread": unread}


def row(mid, gid=GROUP, mine=False):
    return {"who": "Me" if mine else "Someone", "who_key": "ed25519:me" if mine else OTHER,
            "mine": mine, "may_edit": mine, "read": True, "depth": 0,
            "message": {"id": mid, "group": gid, "subject": "Original " + mid,
                        "text": "Original text " + mid, "signature": "Old signature" if mine else "",
                        "references": [], "kind": "post", "readable": True,
                        "sender_key": "ed25519:me" if mine else OTHER,
                        "private": gid == INBOX, "date": "2026-01-01T12:00:00Z"}}


class LocalAPI:
    """Synthetic responses only: no vault, Tor, credentials, or outgoing messages."""

    def __init__(self):
        self.socket = None
        self.connected = asyncio.Event()
        self.updated = False
        self.sidebar_waiting = asyncio.Event()
        self.sidebar_release = None
        self.mention_waiting = asyncio.Event()
        self.mention_release = None
        self.gates = []
        self.mentions = []
        self.may_mention = True
        self.mention_error = False
        self.sent = []
        self.unexpected = []

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
        assert request.headers["X-Unseenet-Token"] == TOKEN
        path = request.path
        if path == "/api/state":
            data = {"unlocked": True, "connected": True, "status": "Connected",
                    "identity": {"display": "Me", "label": "Me", "key": "ed25519:me"}}
        elif path == "/x/gui/state":
            data = {"bootable": False, "web": False}
        elif path == "/api/settings":
            data = {"signature_preview": "Test signature", "notices": {"send": True}}
        elif path == "/api/groups":
            if self.sidebar_release is not None:
                self.sidebar_waiting.set()
                await self.sidebar_release.wait()
            data = {"groups": [group(unread=7 if self.updated else 0)], "people": [],
                    "hierarchies": [{"name": "alt", "tree": None}], "inbox": {"id": INBOX}}
        elif path.startswith("/x/gui/write/"):
            data = {"post": {"allowed": True}, "chat": {"allowed": True}}
        elif request.method == "GET" and path.startswith("/api/groups/"):
            gid = path.removeprefix("/api/groups/")
            data = {"group": group(gid), "rows": [row("other", gid), row("mine", gid, True)]}
            if self.updated:
                data["rows"].append(row("incoming", gid))
        elif path.endswith("/mentioned"):
            body = await request.json()
            self.mentions.append(body)
            if self.mention_error:
                return web.json_response({"error": "Temporarily unavailable"}, status=503)
            # Capture the gate for this request: the next dialog can make a new one.
            release = self.mention_release
            if release is not None:
                self.gates.append(release)
                self.mention_waiting.set()
                await release.wait()
            names = ["Someone"] if "@someone" in body["subject"] + body["body"] else []
            data = {"may": self.may_mention, "names": names, "max": 5}
        elif path.endswith(("/post", "/edit")) or path == "/api/private":
            self.sent.append((path, await request.json()))
            data = {"job": "job-" + str(len(self.sent))}
        elif path.endswith("/read"):
            data = {}
        else:
            self.unexpected.append((request.method, path))
            raise web.HTTPNotFound()
        return web.json_response(data)


@pytest.fixture
async def compose_page():
    api = LocalAPI()
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
            await expect(page.locator('.prow[data-id="other"]')).to_be_visible()
            yield page, api
        finally:
            if api.sidebar_release is not None:
                api.sidebar_release.set()
            if api.mention_release is not None:
                api.mention_release.set()
            for gate in api.gates:
                gate.set()
            await browser.close()
        assert errors == []
        assert api.unexpected == []


async def open_compose(page, mode="new"):
    if mode == "private-reply":
        await page.get_by_role("button", name="@ Private posts", exact=True).click()
    if mode == "new":
        await page.get_by_role("button", name=re.compile("New post")).click()
    elif mode == "edit":
        await page.locator('.prow[data-id="mine"]').click()
        await page.get_by_role("button", name="Edit", exact=True).click()
    elif mode == "private":
        await page.get_by_role("button", name="Write a post", exact=True).click()
    else:
        await page.get_by_role("button", name=re.compile("^Reply")).click()
    await expect(page.locator("#body")).to_be_visible()


async def type_draft(page, subject, body):
    for selector, text in (("#subject", subject), ("#body", body)):
        field = page.locator(selector)
        await field.fill("")
        await field.press_sequentially(text)


async def select_backwards(field):
    await field.focus()
    await field.evaluate("el => el.setSelectionRange(2, 7, 'backward')")


async def assert_draft(page, subject, body, focused):
    await expect(page.locator("#subject")).to_have_value(subject)
    await expect(page.locator("#body")).to_have_value(body)
    field = page.locator(focused)
    await expect(field).to_be_focused()
    assert await field.evaluate("el => [el.selectionStart, el.selectionEnd, el.selectionDirection]") == [2, 7, "backward"]


@pytest.mark.parametrize("mode", ["new", "reply", "edit", "private", "private-reply"])
async def test_draft_survives_events_and_submits_current_text(compose_page, mode):
    page, api = compose_page
    await open_compose(page, mode)
    initial_subject = await page.locator("#subject").input_value()
    initial_body = await page.locator("#body").input_value()
    assert initial_subject == {"new": "", "reply": "Re: Original other", "edit": "Original mine",
                               "private": "", "private-reply": "Re: Original other"}[mode]
    assert ("Original text" in initial_body) == (mode in {"reply", "edit", "private-reply"})
    subject, body = "Changed subject @someone", "My unfinished draft @someone"
    await type_draft(page, subject, body)
    notify = page.get_by_role("checkbox")
    if mode in {"new", "reply"}:
        await notify.uncheck()
    else:
        await expect(notify).to_have_count(0)
    await select_backwards(page.locator("#body"))
    await api.emit(event="status", text="Connected: status while composing")
    await expect(page.locator(".statusbar")).to_contain_text("status while composing")
    await assert_draft(page, subject, body, "#body")
    if mode in {"new", "reply"}:
        await notify.focus()
        await api.emit(event="status", text="Connected: focused mention choice")
        await expect(page.locator(".statusbar")).to_contain_text("focused mention choice")
        await expect(notify).to_be_focused()
        await expect(notify).not_to_be_checked()

    # A newly rendered subject must still record edits and refresh mention notices.
    subject += " again"
    await page.locator("#subject").fill(subject)
    await select_backwards(page.locator("#subject"))
    api.updated = True
    api.sidebar_release = asyncio.Event()
    await api.emit(event="group-updated", group_id=INBOX if mode == "private-reply" else GROUP, new=True)
    await expect(page.locator('.prow[data-id="incoming"]')).to_have_count(1)
    await assert_draft(page, subject, body, "#subject")
    await asyncio.wait_for(api.sidebar_waiting.wait(), 5)
    body += " while the sidebar loads"
    mentioned = page.expect_response(lambda response: response.url.endswith("/mentioned") and
                                    response.request.post_data_json == {"subject": subject, "body": body}) \
        if mode in {"new", "reply"} else nullcontext()
    async with mentioned:
        await page.locator("#body").fill(body)
        await select_backwards(page.locator("#body"))
        api.sidebar_release.set()
        await expect(page.locator(".side .item.group .count")).to_have_text("7")
        await assert_draft(page, subject, body, "#body")
    if mode in {"new", "reply"}:
        await expect(notify).not_to_be_checked()
        await expect(page.locator("#notify-who")).to_contain_text("Nobody is told: Someone")
        assert api.mentions[-1] == {"subject": subject, "body": body}

    async with page.expect_response(lambda response: response.request.method == "POST" and
                                    response.url.endswith(("/post", "/edit", "/private"))):
        await page.locator("#body").press("Control+s")
    await expect(page.get_by_role("dialog")).to_have_count(0)
    path, sent = api.sent[-1]
    expected = {"subject": subject, "body": body, "kind": "post"}
    if mode == "edit":
        assert path == f"/api/groups/{GROUP}/edit"
        expected["id"] = "mine"
    elif mode in {"private", "private-reply"}:
        assert path == "/api/private"
        expected["key"] = OTHER
        if mode == "private-reply":
            expected["reply_to"] = "other"
    else:
        assert path == f"/api/groups/{GROUP}/post"
        expected.update(signature=False, notify=False)
        if mode == "reply":
            expected["references"] = ["other"]
    assert sent == expected
    await open_compose(page, mode)
    await expect(page.locator("#subject")).to_have_value(initial_subject)
    await expect(page.locator("#body")).to_have_value(initial_body)


@pytest.mark.parametrize("new_dialog", [False, True])
async def test_stale_mention_response_cannot_change_current_draft(compose_page, new_dialog):
    page, api = compose_page
    await open_compose(page)
    api.mention_release = asyncio.Event()
    await type_draft(page, "Old draft", "Hello @someone")
    await asyncio.wait_for(api.mention_waiting.wait(), 5)
    old_response = api.mention_release
    api.mention_release = None
    if new_dialog:
        await page.get_by_role("button", name="Cancel", exact=True).click()
        await open_compose(page)
        await expect(page.locator("#subject")).to_have_value("")
    await type_draft(page, "Fresh draft", "No mentions here")
    # Wait for the new draft's own request before releasing the old result.
    async with page.expect_response(lambda response: response.url.endswith("/mentioned") and
                                    response.request.post_data_json["subject"] == "Fresh draft, revised"):
        await page.locator("#subject").fill("Fresh draft, revised")
    async with page.expect_event("requestfinished", predicate=lambda request: request.url.endswith("/mentioned") and
                                request.post_data_json == {"subject": "Old draft", "body": "Hello @someone"}):
        old_response.set()
    await page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    await expect(page.locator("#notify-who")).to_have_text("")
    await expect(page.locator("#subject")).to_have_value("Fresh draft, revised")
    await page.get_by_role("button", name="Close", exact=True).click()
    assert api.sent == []


async def test_discard_cancels_pending_mention_lookup(compose_page):
    page, api = compose_page
    await open_compose(page)
    await page.locator("#body").fill("Hello @someone")
    # The 400 ms debounce must not inspect the next (private) compose window.
    lookup = asyncio.create_task(page.wait_for_event("request", predicate=lambda request:
                                                    request.url.endswith("/mentioned"), timeout=700))
    try:
        await page.get_by_role("button", name="Cancel", exact=True).click()
        await open_compose(page, "private")
        await expect(page.get_by_role("dialog", name="Post to Someone", exact=True)).to_be_visible()
        with pytest.raises(playwright.TimeoutError):
            await lookup
    finally:
        lookup.cancel()
        await asyncio.gather(lookup, return_exceptions=True)
    assert api.mentions == []
    await expect(page.get_by_role("checkbox")).to_have_count(0)


async def test_subject_edits_refresh_mentions_after_render(compose_page):
    page, api = compose_page
    await open_compose(page)
    async with page.expect_response(lambda response: response.url.endswith("/mentioned")):
        await page.locator("#body").fill("Text without a mention")
    await api.emit(event="status", text="Connected: before subject edit")
    await expect(page.locator(".statusbar")).to_contain_text("before subject edit")
    async with page.expect_response(lambda response: response.url.endswith("/mentioned"), timeout=1500):
        await page.locator("#subject").fill("Hello @someone")
    await expect(page.locator("#notify-who")).to_have_text("Told: Someone")
    assert api.mentions[-1]["subject"] == "Hello @someone"
    api.mention_error = True
    async with page.expect_response(lambda response: response.url.endswith("/mentioned")) as failed:
        await page.locator("#body").fill("Text retained during lookup failure")
    assert (await failed.value).status == 503
    await expect(page.locator("#subject")).to_have_value("Hello @someone")
    await expect(page.locator("#body")).to_have_value("Text retained during lookup failure")
    await expect(page.get_by_role("checkbox")).to_be_checked()
    api.mention_error = False
    api.may_mention = False
    async with page.expect_response(lambda response: response.url.endswith("/mentioned")):
        await page.locator("#subject").fill("Hello again @someone")
    await expect(page.get_by_role("checkbox")).to_have_count(0)
    async with page.expect_response(lambda response: response.url.endswith("/post")):
        await page.locator("#body").press("Control+s")
    assert "notify" not in api.sent[-1][1]


async def test_textarea_scroll_and_undo_survive_status_event(compose_page):
    page, api = compose_page
    await open_compose(page)
    field = page.locator("#body")
    body = "A line of this long draft.\n" * 80
    await field.fill(body)
    await field.press_sequentially("Keep typing")
    before = await field.evaluate("el => el.scrollTop")
    assert before > 0
    await api.emit(event="status", text="Connected: scroll and undo")
    await expect(page.locator(".statusbar")).to_contain_text("scroll and undo")
    assert await field.evaluate("el => el.scrollTop") == before
    await field.press("ControlOrMeta+z")
    await expect(field).to_have_value(body)


async def test_composition_continues_across_status_event(compose_page):
    page, api = compose_page
    await open_compose(page)
    await page.locator("#body").fill("Before ")
    session = await page.context.new_cdp_session(page)
    await session.send("Input.imeSetComposition", {"text": "に", "selectionStart": 1, "selectionEnd": 1})
    await expect(page.locator("#body")).to_have_value("Before に")
    await api.emit(event="status", text="Connected: composing Japanese")
    await expect(page.locator(".statusbar")).to_contain_text("composing Japanese")
    await session.send("Input.imeSetComposition", {"text": "日本", "selectionStart": 2, "selectionEnd": 2})
    await session.send("Input.insertText", {"text": "日本"})
    await expect(page.locator("#body")).to_have_value("Before 日本")
