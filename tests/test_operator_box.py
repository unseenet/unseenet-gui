"""Operator boxes in the GUI (gui#299, UN-RFC 0065, unseenet#939) against a synthetic local
API: the box shown as "My servers" with your private things, not in the group tree; a
new message to one server chosen by name ("To: <server>"), sent as `unseenet operator
say` does; N doing the same; a new message as the team in another team inbox; and a
server's Markdown answer drawn as Markdown.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_operator_box.py
"""

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet.core import markup
from unseenet.core import operator as op
from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43
INBOX = "inbox@me"
BOX = "operator@me"
TEAM = "support@proj"
R1, R2, R3 = "ed25519:replica1key", "ed25519:replica2key", "ed25519:replica3keynotheardfromyet"


def help_text() -> str:
    """replica1's own help, as the core writes it (#940)."""
    desk = op.Desk([op.Command("hold", "hold the council's changes", changes=True, usage="on|off",
                               example="hold on")], {}, mode="commands", server="replica1")
    return desk.help()


def row(mid, group, text, who="replica1", key=R1, kind="chat", markdown=False, subject=""):
    ctype = markup.MARKDOWN_TYPE if markdown else None
    msg = {"id": mid, "group": group, "subject": subject, "text": text, "signature": "", "references": [],
           "kind": kind, "readable": True, "sender_key": key, "private": True, "date": "2026-11-04T20:00:00Z",
           **({"content_type": ctype} if ctype else {})}
    return {"who": who, "who_key": key, "mine": False, "may_edit": False, "may_withdraw": False, "read": True,
            "depth": 0, "address": "", "message": msg, "tree": markup.body(text, ctype, kind)}


class BoxAPI:
    def __init__(self):
        self.requests = []

    def groups(self):
        box = {"id": BOX, "label": "operator", "shown": "operator", "type": "inbox", "view": "threads",
               "hierarchy": "operator", "unread": 2, "kinds": ["post"], "owner": True,
               "team": {"name": "My servers", "reader": True}}
        team = {"id": TEAM, "label": "support (team inbox)", "type": "inbox", "view": "threads",
                "hierarchy": "support", "unread": 0, "kinds": ["post"], "owner": False,
                "team": {"name": "Unseenet support", "reader": True}}
        other = {"id": "dk.snak@x", "label": "dk.snak", "type": "open", "view": "threads", "hierarchy": "dk",
                 "unread": 1, "kinds": ["post"], "may_post": True}
        mine = {"id": INBOX, "label": "Private posts", "type": "inbox", "view": "threads", "hierarchy": "inbox",
                "unread": 0, "kinds": ["post"], "owner": True}
        return [box, team, other, mine]

    def rows(self, gid):
        if gid == BOX:
            status = "**replica2** is well.\n\n```\nround    level  members\n1041     full   3 of 3\n```"
            return [row("<h@x>", BOX, help_text(), markdown=True),
                    row("<s@x>", BOX, status, who="replica2", key=R2, markdown=True)]
        if gid == TEAM:
            return [row("<t@x>", TEAM, "min node er nede", who="Sonia", key="ed25519:sonia", kind="post",
                        subject="Hjælp")]
        return []

    async def events(self, request):
        ws = web.WebSocketResponse(protocols=["unseenet"])
        await ws.prepare(request)
        async for _ in ws:
            pass
        return ws

    async def handle(self, request):
        path = request.path
        body = await request.json() if request.method == "POST" and request.can_read_body else {}
        if request.method == "POST":
            self.requests.append((path, body))
        if path == "/api/state":
            data = {"unlocked": True, "connected": True, "status": "Connected",
                    "identity": {"display": "Me", "label": "Me", "key": "ed25519:me"}}
        elif path == "/x/gui/state":
            data = {"bootable": False, "web": False}
        elif path == "/api/settings":
            data = {"signature_preview": "Andreas, Kvistgård", "notices": {"send": True}}
        elif path == "/api/groups":
            data = {"groups": self.groups(), "people": [], "inbox": {"id": INBOX},
                    "hierarchies": [{"name": n, "tree": None} for n in ("dk", "operator", "support", "inbox")]}
        elif path == "/api/teams":
            data = {"teams": [
                {"group": BOX, "name": "My servers", "reader": True,
                 "servers": [{"name": "replica1", "key": R1}, {"name": "replica2", "key": R2},
                             {"name": "", "key": R3}]},
                {"group": TEAM, "name": "Unseenet support", "reader": True}]}
        elif request.method == "GET" and path.startswith("/api/groups/"):
            gid = path[len("/api/groups/"):]
            data = {"group": next(g for g in self.groups() if g["id"] == gid), "rows": self.rows(gid)}
        elif path == "/api/private":
            data = {"job": "j1"}
        elif path == "/api/pictures":
            data = {"pictures": {}}
        else:
            data = {}
        return web.json_response(data)


@pytest.fixture
async def box_page():
    api = BoxAPI()
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
        page.on("dialog", lambda d: d.accept())
        try:
            await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
            await page.wait_for_load_state("networkidle")
            yield page, api
        finally:
            await browser.close()
        assert errors == []


async def open_box(page):
    await page.locator(".side .private-item", has_text="My servers").click()
    await page.wait_for_load_state("networkidle")
    await expect(page.locator(".ghead h1")).to_have_text("My servers")    # shown, not only asked for


def sent(api):
    return [b for p, b in api.requests if p == "/api/private"]


async def test_the_box_is_my_servers_not_a_group(box_page):
    page, _ = box_page
    item = page.locator(".side .private-item", has_text="My servers")
    await expect(item).to_have_count(1)
    await expect(item.locator(".count")).to_have_text("2")
    # not in the group tree, and no empty "operator" heading left behind
    await expect(page.locator(".side-scroll .item.group", has_text="operator")).to_have_count(0)
    await expect(page.locator(".side-scroll h3", has_text="operator")).to_have_count(0)
    await expect(page.locator(".side-scroll .item.group", has_text="dk.snak")).to_have_count(1)
    await open_box(page)
    await expect(page.locator(".ghead h1")).to_have_text("My servers")
    line = page.locator(".ghead .box-servers")
    await expect(line).to_contain_text("replica1, replica2")
    await expect(line).to_contain_text("1 not heard from yet")


async def test_a_new_message_to_one_server(box_page):
    page, api = box_page
    await open_box(page)
    await page.locator('[data-k="team-new"]').click()
    dlg = page.locator(".dialog")
    await expect(dlg.locator("h2")).to_have_text("New message to a server")
    to = dlg.locator('[data-k="op-to"]')
    await expect(to.locator("option")).to_have_count(3)
    await expect(to.locator("option[disabled]")).to_have_count(1)        # not heard from: no name
    await to.select_option(R2)
    await page.locator('[data-k="op-text"]').fill("status")
    await page.keyboard.press("Enter")
    await page.wait_for_timeout(300)
    assert sent(api) == [{"key": R2, "body": "status", "kind": "chat", "as_team": BOX}]
    await expect(dlg).to_have_count(0)


async def test_n_opens_it_and_an_empty_message_is_not_sent(box_page):
    page, api = box_page
    await open_box(page)
    await page.keyboard.press("n")
    dlg = page.locator(".dialog")
    await expect(dlg.locator("h2")).to_have_text("New message to a server")
    await dlg.get_by_role("button", name="Send").click()
    await expect(dlg.locator(".error")).to_contain_text("Write a command")
    assert sent(api) == []
    await page.locator('[data-k="op-text"]').fill("help")
    await dlg.get_by_role("button", name="Send").click()
    await page.wait_for_timeout(300)
    assert sent(api) == [{"key": R1, "body": "help", "kind": "chat", "as_team": BOX}]   # the first, by default


async def test_a_servers_markdown_is_drawn(box_page):
    """A server's message is a Markdown chat line (#940): bold and code drawn, the status
    columns in a code block - no lists, as UN-RFC 0031 section 3.3 keeps chat lines - and
    the row's title by its words, not its marks."""
    page, _ = box_page
    await open_box(page)
    titles = page.locator(".ptable .prow:not(.head) .sj")
    await expect(titles.first).to_contain_text("replica1 - answer one of its messages")
    assert "**" not in await page.locator(".ptable").inner_text()
    md = page.locator(".reader .md")
    await expect(md.locator("strong").first).to_have_text("replica1")
    await expect(md.locator("code").first).to_have_text("replica1: status")
    assert "**" not in await md.inner_text()
    await page.locator(".ptable .prow", has_text="replica2 is well").click()
    await expect(page.locator(".reader pre")).to_contain_text("1041     full   3 of 3")


async def test_a_new_message_as_the_team(box_page):
    page, api = box_page
    await page.locator(".side-scroll .item.group", has_text="support").first.click()
    await page.wait_for_load_state("networkidle")
    await expect(page.locator(".ghead h1")).to_have_text("support (team inbox)")
    await page.locator('[data-k="team-new"]').click()
    await expect(page.locator(".dialog h2")).to_have_text("New message as Unseenet support")
    await page.locator("#pfind").fill("ed25519:abcdefghijklmnopqrstuvwxyz")
    await page.keyboard.press("Enter")
    dlg = page.locator(".dialog")
    await expect(dlg.locator("h2")).to_contain_text("as Unseenet support")
    assert "Kvistgård" not in await page.locator("#body").input_value()     # never your signature
    await page.locator("#subject").fill("Din node")
    await page.locator("#body").fill("Den kører igen.")
    await dlg.get_by_role("button", name="Send").last.click()
    await page.wait_for_timeout(300)
    [body] = sent(api)
    assert body["as_team"] == TEAM and body["key"] == "ed25519:abcdefghijklmnopqrstuvwxyz"
    assert body["subject"] == "Din node" and body["kind"] == "post"
