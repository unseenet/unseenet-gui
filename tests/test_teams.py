"""Team inboxes (#68, unseenet#341, UN-RFC 0047, UN-RFC 0046 section 4.22) against a
synthetic local API: accepting the post that adds you as a reader, a team inbox shown
by its name, replying as the team without your signature, a removed reader told so,
and the owner's readers dialog.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_teams.py
"""

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43
INBOX = "inbox@me"
TEAM = "operator@proj"


def row(mid, subject, group, **extra):
    msg = {"id": mid, "group": group, "subject": subject, "text": "min node er nede", "signature": "",
           "references": [], "kind": "post", "readable": True, "sender_key": "ed25519:sonia",
           "private": True, "date": "2026-10-27T10:00:00Z", **extra.pop("message", {})}
    return {"who": "Sonia", "who_key": "ed25519:sonia", "mine": False, "may_edit": False,
            "may_withdraw": False, "read": True, "depth": 0, "address": "", "message": msg, **extra}


class TeamAPI:
    def __init__(self, reader=True, owner=False):
        self.reader, self.owner = reader, owner
        self.requests, self.readers = [], ["ed25519:team1"]

    def groups(self):
        team = {"id": TEAM, "label": "Unseenet (operator) (team inbox)", "type": "inbox", "view": "threads",
                "hierarchy": "operator", "unread": 0, "kinds": ["post"], "owner": self.owner,
                "team": None if self.owner else {"name": "Unseenet (operator)", "reader": self.reader}}
        mine = {"id": INBOX, "label": "Private posts", "type": "inbox", "view": "threads", "hierarchy": "inbox",
                "unread": 0, "kinds": ["post"], "owner": True}
        return [team, mine]

    def rows(self, gid):
        if gid == INBOX:
            return [row("<inv@x>", "You can read Unseenet (operator)", INBOX,
                        message={"team_invite": {"group": TEAM}, "sender_key": "ed25519:proj"})]
        return [row("<s@x>", "Hjælp", TEAM)]

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
            data = {"groups": self.groups(), "people": [], "hierarchies": [{"name": "operator", "tree": None},
                    {"name": "inbox", "tree": None}], "inbox": {"id": INBOX}}
        elif request.method == "GET" and path.startswith("/api/groups/"):
            gid = path[len("/api/groups/"):]
            data = {"group": next(g for g in self.groups() if g["id"] == gid), "rows": self.rows(gid)}
        elif path == "/api/teams/accept":
            data = {"group": TEAM}
        elif path == "/api/teams/readers" and request.method == "GET":
            data = {"group": TEAM, "readers": self.readers, "team_name": "Unseenet (operator)"}
        elif path == "/api/teams/readers":
            if body.get("add"):
                self.readers.append("ed25519:team2")
            if body.get("remove"):
                self.readers.remove(body["remove"])
            data = {"group": TEAM, "readers": self.readers, "team_name": body.get("team_name", "")}
        elif path == "/api/private":
            data = {"job": "j1"}
        elif path == "/api/pictures":
            data = {"pictures": {}}
        else:
            data = {}
        return web.json_response(data)


@pytest.fixture
async def team_page(request):
    api = TeamAPI(**request.param)
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


@pytest.mark.parametrize("team_page", [{}], indirect=True)
async def test_accept_and_reply_as_the_team(team_page):
    page, api = team_page
    await page.get_by_role("button", name="Private posts").first.click()
    await page.wait_for_load_state("networkidle")
    await page.get_by_role("button", name="Read this inbox with the team").click()
    await page.wait_for_timeout(300)
    assert ("/api/teams/accept", {"id": "<inv@x>"}) in api.requests
    await page.get_by_role("button", name="Unseenet (operator) (team inbox)").first.click()
    await page.wait_for_load_state("networkidle")
    await page.locator(".reader .pbar .btn.primary", has_text="Reply").click()
    dlg = page.locator(".dialog")
    await expect(dlg.locator("h2")).to_have_text("Reply as Unseenet (operator)")
    assert "Kvistgård" not in await page.locator("#body").input_value()     # never your signature
    await page.locator("#body").fill("> min node er nede\n\nVi ser på det.")
    await dlg.get_by_role("button", name="Send").last.click()
    await page.wait_for_timeout(300)
    [(_, body)] = [r for r in api.requests if r[0] == "/api/private"]
    assert body["as_team"] == TEAM and body["reply_to"] == "<s@x>" and body["key"] == "ed25519:sonia"


@pytest.mark.parametrize("team_page", [{"reader": False}], indirect=True)
async def test_a_removed_reader_is_told(team_page):
    page, api = team_page
    await page.get_by_role("button", name="Unseenet (operator) (team inbox)").first.click()
    await page.wait_for_load_state("networkidle")
    await expect(page.locator(".team-removed")).to_contain_text("removed you as a reader")
    await page.locator(".team-removed").get_by_role("button", name="Forget it").click()
    await page.wait_for_timeout(300)
    assert ("/api/teams/forget", {"group": TEAM}) in api.requests


@pytest.mark.parametrize("team_page", [{"owner": True}], indirect=True)
async def test_the_owner_chooses_who_reads(team_page):
    page, api = team_page
    await page.get_by_role("button", name="Unseenet (operator) (team inbox)").first.click()
    await page.wait_for_load_state("networkidle")
    await page.evaluate("openPalette()")
    await page.keyboard.type("who reads")
    await page.keyboard.press("Enter")
    await expect(page.locator(".dialog h2")).to_have_text("Who reads this inbox")
    await page.locator("#tkey").fill("ed25519:helper")
    await page.locator(".dialog .btn.primary").click()
    await expect(page.locator(".dialog .rrow")).to_have_count(2)
    await page.locator(".dialog .rrow").first.get_by_role("button", name="Remove").click()
    await expect(page.locator(".dialog .rrow")).to_have_count(1)
    assert ("/api/teams/readers", {"group": TEAM, "add": "ed25519:helper", "team_name": "Unseenet (operator)"}) in api.requests
    assert ("/api/teams/readers", {"group": TEAM, "remove": "ed25519:team1"}) in api.requests
