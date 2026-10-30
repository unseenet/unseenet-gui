"""Sharing (gui#285, UN-RFC 0060) against a synthetic local API: a plain share drawn as the
original under "Mette shared" once the core has fetched it, a share with a comment with
the original as a card, a share whose original is gone not drawn at all; Share in the ⋯
menu where it can be shared and why not where the author asked; Share with a comment;
Undo share on your own.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_shares.py
"""

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43
GROUP = "alt.shares@abcd"
ORIG_GROUP = "dk.snak@abcd"
OK = {"allowed": True, "reason": "", "code": "ok"}


class ShareAPI:
    """Synthetic answers only: no vault, Tor or outgoing messages."""

    def __init__(self):
        self.shares, self.unshares = [], []
        self.target_asks = 0

    def head(self):
        return {"id": GROUP, "label": "alt.shares", "type": "channel", "view": "feed",
                "owner_view": "feed", "hierarchy": "alt", "may_post": True, "unread": 0,
                "owner": False, "kinds": ["chat", "post"],
                "write": {"post": {"allowed": False}, "chat": {"allowed": False}},
                "pins": [], "max_pins": 5, "may_pin": False,
                "reactions": {"offered": [], "any": False, "setting": "none"}}

    def row(self, mid, kind, subject, text, *, who="Mette", mine=False, share=None,
            perm=OK, sharing=None, date="2026-10-30T12:00:00Z"):
        return {"who": who, "who_key": "ed25519:me" if mine else "ed25519:" + who.lower(),
                "mine": mine, "may_edit": False, "may_withdraw": mine, "read": True, "depth": 0,
                "pinned": False, "reactions": [], "react": {"allowed": False, "reason": "", "code": "x"},
                "comment": {"allowed": False, "reason": "No comments here"}, "reply": {"allowed": False},
                "share": perm,
                "message": {"id": mid, "group": GROUP, "subject": subject, "text": text, "signature": "",
                            "references": [], "kind": kind, "readable": True, "private": False,
                            "date": date, "share": share, "sharing": sharing, "shared_by": []}}

    def rows(self):
        plain = {"of": "<o@x>", "group": ORIG_GROUP, "plain": True}
        gone = {"of": "<gone@x>", "group": ORIG_GROUP, "plain": True}
        return [
            self.row("<s@x>", "share", "", "unseenet:" + ORIG_GROUP + "?m=o@x", share=plain),
            self.row("<c@x>", "post", "Se her", "Det her er præcis det, vi talte om\n", who="Me", mine=True,
                     share={"of": "<o@x>", "group": ORIG_GROUP, "plain": False},
                     date="2026-10-29T12:00:00Z"),
            self.row("<g@x>", "share", "", "unseenet:" + ORIG_GROUP + "?m=gone@x", share=gone),
            self.row("<p@x>", "post", "Et almindeligt opslag", "Tekst\n"),
            self.row("<n@x>", "post", "Kun her", "Del ikke\n", sharing="no",
                     perm={"allowed": False, "reason": "The author asked not to share this", "code": "asked_not"}),
        ]

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
            data = {"signature_preview": "", "notices": {"send": True}, "share_notices": True,
                    "hide_shares": {"all": False, "groups": []}}
        elif path == "/api/groups":
            data = {"groups": [self.head()], "people": [],
                    "hierarchies": [{"name": "alt", "tree": None}], "inbox": {"id": "inbox:test"}}
        elif path == "/api/share-target":
            of = request.query.get("of")
            if of == "<gone@x>":
                data = {"state": "gone", "message": None}
            else:
                self.target_asks += 1
                if self.target_asks == 1:                       # a node is still fetching it
                    return web.json_response({"error": "still fetching", "later": True}, status=503)
                data = {"state": "ok", "who": "Andreas", "label": "dk.snak", "edited": True,
                        "message": {"id": "<o2@x>", "group": ORIG_GROUP, "subject": "Mit marsvin hoster",
                                    "text": "Hvad gør jeg?", "kind": "post", "author_key": "ed25519:andreas",
                                    "readable": True, "date": "2026-10-28T12:00:00Z",
                                    "edited": "2026-10-30T09:00:00Z", "attachments": []}}
        elif path == f"/api/groups/{GROUP}/share":
            if request.method == "GET":
                data = {"share": OK, "target": "<p@x>", "target_group": GROUP, "shared": {},
                        "destinations": [
                            {"group": "feed@me", "label": "Your feed", "own_feed": True, "plain": True,
                             "allowed": True, "reason": "", "shared": False},
                            {"group": "dk.dyr@abcd", "label": "dk.dyr", "own_feed": False, "plain": False,
                             "allowed": True, "reason": "", "shared": False}]}
            else:
                self.shares.append(await request.json())
                data = {"job": "job1"}
        elif path == f"/api/groups/{GROUP}/unshare":
            self.unshares.append(await request.json())
            data = {"groups": [GROUP]}
        elif request.method == "GET" and path == f"/api/groups/{GROUP}":
            data = {"group": self.head(), "rows": self.rows()}
        elif path == "/api/pictures":
            data = {"pictures": {}}
        else:
            data = {}
        return web.json_response(data)


@pytest.fixture
async def page_api():
    api = ShareAPI()
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
            await page.get_by_role("button", name="alt.shares").first.click()
            await page.wait_for_load_state("networkidle")
            yield page, api
        finally:
            await browser.close()
        assert errors == []


async def _menu(page, mid, item):
    entry = page.locator(f'.entry[data-id="{mid}"]')
    await entry.locator(".morebtn").first.click()
    await page.get_by_role("menuitem", name=item, exact=True).click()


async def test_plain_share_shows_the_original_once_fetched(page_api):
    page, api = page_api
    shared = page.locator('.entry.shared[data-id="<s@x>"]')
    await expect(shared.locator(".shline")).to_contain_text("Mette shared")
    # first "fetching" (the core said 503 later), then the original, made from what was fetched
    await expect(shared.locator(".etitle")).to_have_text("Mit marsvin hoster", timeout=10000)
    await expect(shared).to_contain_text("in dk.snak")
    await expect(shared).not_to_contain_text("unseenet:")          # never the share's own body
    await expect(page.locator('.entry[data-id="<g@x>"]')).to_have_count(0)   # gone: not drawn


async def test_share_with_a_comment_has_the_original_as_a_card(page_api):
    page, api = page_api
    card = page.locator('.entry[data-id="<c@x>"] .scard')
    await expect(card.locator(".stitle")).to_have_text("Mit marsvin hoster", timeout=10000)
    await expect(card).to_contain_text("Andreas")
    await expect(card.locator(".sedited")).to_have_text("Edited after it was shared")


async def test_share_from_the_menu_and_why_not(page_api):
    page, api = page_api
    await _menu(page, "<p@x>", "Share")
    await expect(page.locator(".toast")).to_be_visible()
    assert api.shares[-1] == {"id": "<p@x>"}
    await page.locator('.entry[data-id="<n@x>"] .morebtn').first.click()
    menu = page.get_by_role("menu")
    await expect(menu.get_by_role("menuitem", name="Share", exact=True)).to_have_count(0)
    await menu.get_by_role("menuitem", name="Why can't I share this?").click()
    await expect(page.locator(".toast")).to_contain_text("asked not to share")


async def test_share_with_a_comment_and_into_a_group(page_api):
    page, api = page_api
    await _menu(page, "<p@x>", "Share with a comment…")
    dialog = page.get_by_role("dialog", name="Share with a comment")
    await dialog.get_by_label("Your words").fill("Se lige her")
    await dialog.get_by_role("button", name="Share").click()
    await expect(dialog).to_have_count(0)
    assert api.shares[-1] == {"id": "<p@x>", "comment": "Se lige her"}

    await _menu(page, "<p@x>", "Share into a group…")
    dialog = page.get_by_role("dialog", name="Share into a group")
    await expect(dialog).to_contain_text("needs a comment")         # a discussion group
    await dialog.get_by_role("button", name="Share").click()
    await expect(dialog.locator(".error")).to_contain_text("Write a few words")
    await dialog.get_by_label("Your words").fill("Til jer med dyr")
    await dialog.get_by_role("button", name="Share").click()
    await expect(dialog).to_have_count(0)
    assert api.shares[-1] == {"id": "<p@x>", "comment": "Til jer med dyr", "into": "dk.dyr@abcd"}


async def test_undo_your_own_share(page_api):
    page, api = page_api
    await _menu(page, "<c@x>", "Undo share")
    await expect(page.locator(".toast")).to_contain_text("taken back")
    assert api.unshares[-1] == {"id": "<c@x>", "group": GROUP}
