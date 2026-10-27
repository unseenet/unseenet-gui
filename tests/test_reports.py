"""Spam reports (#70, unseenet#122, UN-RFC 0045, UN-RFC 0046 section 4.21) against a
synthetic local API: a post hidden by a report shown as hidden in its place - in the
list, the reader, a feed and a chat - with Show anyway and Stop following; the issuers
you follow; and, as an issuer, publishing a report from the ⋯ menu and from the reports
sent to you.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_reports.py
"""

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC
from conftest import post_menu  # noqa: E402

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43
GROUP = "dk.snak@abcd"
ISSUER = "ed25519:issuer"
HIT = {"issuer": ISSUER, "label": "Spamjægeren", "reason": "spam", "automatic": False,
       "kind": "post", "report": "<r@x>"}


def row(mid, subject, reported=None, kind="post", minute=0):
    return {"who": "Someone", "who_key": "ed25519:other", "mine": False, "may_edit": False,
            "may_withdraw": False, "read": True, "depth": 0, "address": f"unseenet:{mid}",
            "message": {"id": mid, "group": GROUP, "subject": subject, "text": "køb billige ure",
                        "signature": "", "references": [], "kind": kind, "readable": True,
                        "sender_key": "ed25519:other", "private": False, "reported": reported,
                        "date": f"2026-10-27T09:{minute:02d}:00Z"}}


class ReportsAPI:
    def __init__(self, view="threads", issuer=False):
        self.view, self.issuer = view, issuer
        self.shown, self.following = set(), True
        self.requests = []

    def rows(self):
        hit = HIT if self.following else None
        return [row("<s@x>", "Billige ure", None if "<s@x>" in self.shown else hit,
                    kind="chat" if self.view == "chat" else "post"),
                row("<ok@x>", "Velkommen", kind="chat" if self.view == "chat" else "post", minute=1)]

    def group(self):
        return {"id": GROUP, "label": "dk.snak", "type": "open", "view": self.view, "hierarchy": "dk",
                "may_post": True, "unread": 0, "kinds": ["post", "chat"], "pins": [], "max_pins": 0,
                "write": {"post": {"allowed": True}, "chat": {"allowed": True}}}

    def reports(self):
        return {"reasons": ["spam", "flood", "phishing", "malware", "illegal", "other"],
                "issuers": [{"key": ISSUER, "label": "Spamjægeren", "yours": False, "hierarchies": ["dk"],
                             "on": self.following}],
                "mine": {"group": "reports@me", "policy": "Spam i dk.*", "contact": "", "automatic": False}
                if self.issuer else None}

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
            data = {"signature_preview": "", "notices": {"send": True}, "report_issuer": self.issuer}
        elif path == "/api/groups":
            data = {"groups": [self.group()], "people": [],
                    "hierarchies": [{"name": "dk", "tree": None}], "inbox": {"id": "inbox:test"}}
        elif request.method == "GET" and path == f"/api/groups/{GROUP}":
            data = {"group": self.group(), "rows": self.rows()}
        elif path == f"/api/groups/{GROUP}/show":
            self.shown.add(body["id"])
            data = {"id": body["id"]}
        elif path == f"/api/groups/{GROUP}/report" and request.method == "GET":
            data = {"targets": [{"i": 0, "who": "The group's owner (@unseenet.net)"},
                                {"i": 1, "who": "Report issuer Spamjægeren"}],
                    "reasons": [{"id": "spam", "label": "Spam"}, {"id": "illegal", "label": "Illegal"},
                                {"id": "threats", "label": "Threats or harassment"},
                                {"id": "other", "label": "Something else"}]}
        elif path == f"/api/groups/{GROUP}/report":
            data = {"sent": len(body["targets"])}
        elif path == "/api/reports":
            data = self.reports()
        elif path == "/api/reports/follow":
            self.following = bool(body.get("on", True))
            data = self.reports()
        elif path == "/api/reports/received":
            data = {"received": [{"message": "<m@x>", "subject": "Report: Billige ure",
                                  "date": "2026-10-27T09:05:00Z", "id": "<s@x>", "group": GROUP,
                                  "author_key": "ed25519:other"}]}
        elif path == "/api/reports/mine":
            data = {"reports": []}
        elif path == "/api/reports/publish":
            data = {"id": "<new@x>"}
        elif path == "/api/pictures":
            data = {"pictures": {}}
        else:
            data = {}
        return web.json_response(data)


@pytest.fixture
async def reports_page(request):
    api = ReportsAPI(**request.param)
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
            await page.get_by_role("button", name="dk.snak").first.click()
            await page.wait_for_load_state("networkidle")
            yield page, api
        finally:
            await browser.close()
        assert errors == []


@pytest.mark.parametrize("reports_page", [{}], indirect=True)
async def test_a_hidden_post_says_who_hid_it_and_can_be_shown(reports_page):
    page, api = reports_page
    rows = page.locator(".ptable .prow:not(.head)")
    await expect(rows).to_have_count(2)                                  # kept in its place
    hidden = page.locator(".prow", has_text="Hidden by Spamjægeren: spam")
    await expect(hidden).to_have_count(1)
    await expect(page.locator(".prow", has_text="Billige ure")).to_have_count(0)   # not its subject
    await hidden.click()
    note = page.locator(".reader .reported")
    await expect(note).to_contain_text("Hidden by Spamjægeren: spam")
    await expect(page.locator(".reader")).not_to_contain_text("køb billige ure")
    await note.get_by_role("button", name="Show anyway").click()
    await expect(page.locator(".prow", has_text="Billige ure")).to_have_count(1)
    assert (f"/api/groups/{GROUP}/show", {"id": "<s@x>"}) in api.requests


@pytest.mark.parametrize("reports_page", [{}], indirect=True)
async def test_stop_following_from_the_hidden_post_and_the_issuers(reports_page):
    page, api = reports_page
    await page.locator(".prow", has_text="Hidden by").click()
    await page.locator(".reader .reported").get_by_role("button", name="Stop following Spamjægeren").click()
    await expect(page.locator(".prow", has_text="Billige ure")).to_have_count(1)
    assert ("/api/reports/follow", {"key": ISSUER, "on": False}) in api.requests
    await page.evaluate("openReportIssuers()")
    issuer = page.locator(".issuer", has_text="Spamjægeren")
    await expect(issuer).to_contain_text("named for dk.*")
    await expect(issuer).to_have_class("issuer off")
    await issuer.get_by_role("checkbox").check()                         # on again
    await page.wait_for_timeout(300)
    assert ("/api/reports/follow", {"key": ISSUER, "on": True, "label": "Spamjægeren"}) in api.requests
    await page.locator("#ikey").fill("ed25519:another")
    await page.locator(".dialog .btn.primary").click()
    await page.wait_for_timeout(300)
    assert ("/api/reports/follow", {"key": "ed25519:another", "on": True, "label": ""}) in api.requests


@pytest.mark.parametrize("reports_page", [{"view": "chat"}], indirect=True)
async def test_a_hidden_chat_line(reports_page):
    page, _ = reports_page
    bubble = page.locator(".bubble", has=page.locator(".reported"))
    await expect(bubble).to_contain_text("Hidden by Spamjægeren: spam")
    await expect(page.locator(".bubble", has_text="køb billige ure")).to_have_count(1)   # only the other


@pytest.mark.parametrize("reports_page", [{"view": "feed"}], indirect=True)
async def test_a_hidden_feed_entry(reports_page):
    page, _ = reports_page
    entry = page.locator(".entry", has=page.locator(".reported"))
    await expect(entry).to_have_count(1)
    await expect(entry.locator(".etitle")).to_contain_text("Hidden by Spamjægeren")


@pytest.mark.parametrize("reports_page", [{"issuer": True}], indirect=True)
async def test_an_issuer_publishes_a_report(reports_page):
    page, api = reports_page
    await page.locator(".prow", has_text="Velkommen").click()
    await post_menu(page, "Publish a spam report…")
    await page.locator("select[name=reason]").select_option("flood")
    await page.locator("input[name=key]").check()
    await page.locator("input[name=days]").fill("30")
    await page.locator(".dialog .btn.primary").click()
    await page.wait_for_timeout(300)
    assert ("/api/reports/publish", {"posts": [{"id": "<ok@x>", "group": GROUP, "reason": "flood"}], "note": "",
            "keys": [{"key": "ed25519:other", "reason": "flood", "days": 30}]}) in api.requests
    # the reports people sent you, ready to publish
    await page.evaluate("openIssuing()")
    await expect(page.locator(".rrow", has_text="Report: Billige ure")).to_have_count(1)
    await page.get_by_role("button", name="Publish…").click()
    await page.locator(".dialog .btn.primary").click()
    await page.wait_for_timeout(300)
    assert ("/api/reports/publish", {"posts": [{"id": "<s@x>", "group": GROUP, "reason": "spam"}], "note": ""}) in api.requests


@pytest.mark.parametrize("reports_page", [{}], indirect=True)
async def test_from_the_palette(reports_page):
    page, _ = reports_page
    await page.evaluate("openPalette()")
    await page.keyboard.type("spam")
    await expect(page.locator(".cmd", has_text="the issuers that hide posts for you")).to_have_count(1)
    await expect(page.locator(".cmd", has_text="Become a spam report issuer")).to_have_count(1)


@pytest.mark.parametrize("reports_page", [{}], indirect=True)
async def test_the_report_window(reports_page, tmp_path):
    """Asked for by the maintainer: a report window that looks like one - the post small at
    the top, why, who, a real text field in Markdown, and screenshots."""
    import base64
    page, api = reports_page
    await page.locator(".prow", has_text="Velkommen").click()
    await post_menu(page, "Report")
    dlg = page.locator(".report-dlg")
    await expect(dlg.locator("h2")).to_have_text("Report a post")             # short, the post below
    await expect(dlg.locator(".rpost")).to_contain_text("Velkommen")
    await expect(dlg.locator(".rtarget")).to_have_count(2)
    await dlg.get_by_role("radio", name="Threats or harassment").click()
    await expect(dlg.get_by_role("radio", name="Threats or harassment")).to_have_attribute("aria-checked", "true")
    await dlg.locator(".rtarget", has_text="Spamjægeren").locator("input").uncheck()
    note = dlg.locator("#rnote")
    assert (await note.bounding_box())["height"] >= 130                         # room to write
    await note.fill("Se **skærmbilledet**.\n\n- truslen\n- datoen")
    png = tmp_path / "skaerm.png"
    png.write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="))
    assert "application/pdf" in await dlg.locator("input[type=file]").get_attribute("accept")   # #637
    await dlg.locator("input[type=file]").set_input_files(str(png))
    await dlg.get_by_label("Description of skaerm.png").fill("Truslen")
    await page.screenshot(path=str(tmp_path / "report.png"))
    await dlg.locator(".db").evaluate("e => e.scrollTop = 0")
    await page.screenshot(path=str(tmp_path / "report-top.png"))
    await dlg.get_by_role("button", name="Report").click()
    await expect(page.locator(".report-dlg")).to_have_count(0)
    [(path, body)] = [r for r in api.requests if r[0].endswith("/report")]
    assert body["targets"] == [0] and body["reason"] == "threats" and body["note"].startswith("Se **")
    assert body["files"][0]["name"] == "skaerm.png" and body["files"][0]["alt"] == "Truslen"


@pytest.mark.parametrize("reports_page", [{"view": "feed"}, {"view": "chat"}], indirect=True)
async def test_report_from_a_feed_and_a_chat(reports_page):
    """Asked for by the maintainer: Report is in the ⋯ menu wherever a post is shown, not
    only in the reader of a threads view."""
    page, api = reports_page
    item = page.locator(".entry, .bubble", has_text="køb billige ure").filter(
        has_not=page.locator(".reported")).first
    await item.hover()
    await item.locator(".morebtn").first.click()
    await page.get_by_role("menuitem", name="Report", exact=True).click()
    await expect(page.locator(".report-dlg h2")).to_have_text("Report a post")
    await expect(page.locator(".report-dlg .rtarget")).to_have_count(2)


@pytest.mark.parametrize("reports_page", [{}], indirect=True)
async def test_the_group_info_says_how_to_report(reports_page):
    page, _ = reports_page
    await page.evaluate("openInfo()")
    await expect(page.locator(".dialog")).to_contain_text("Report in its ⋯ menu")
