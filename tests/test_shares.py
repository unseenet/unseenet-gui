"""Sharing (gui#285, UN-RFC 0060) against a synthetic local API: a plain share drawn as the
original under "Mette shared" once the core has fetched it, a share with a comment with
the original as a card, a share whose original is gone not drawn at all; Share in the ⋯
menu where it can be shared and why not where the author asked; Share with a comment,
into a group and Send to in the ordinary compose window, the group or person chosen
first with a search; Undo share on your own.

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
        self.shares, self.unshares, self.posts, self.privates = [], [], [], []
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
                    "contacts": [{"key": "ed25519:soeren", "name": "Søren"},
                                 {"key": "ed25519:mette", "name": "Mette"}],
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
                             "allowed": True, "reason": "", "shared": False},
                            {"group": "dk.katte@abcd", "label": "dk.katte", "own_feed": False, "plain": True,
                             "allowed": True, "reason": "", "shared": False},
                            {"group": "dk.chat@abcd", "label": "dk.chat", "own_feed": False, "plain": False,
                             "allowed": False, "reason": "takes no shares", "shared": False}]}
            else:
                self.shares.append(await request.json())
                data = {"job": "job1"}
        elif path == f"/api/groups/{GROUP}/unshare":
            self.unshares.append(await request.json())
            data = {"groups": [GROUP]}
        elif request.method == "GET" and path == f"/api/groups/{GROUP}":
            data = {"group": self.head(), "rows": self.rows()}
        elif request.method == "GET" and path in ("/api/groups/feed@me", "/api/groups/dk.dyr@abcd"):
            gid = path.rsplit("/", 1)[1]
            data = {"group": {**self.head(), "id": gid, "label": gid.split("@")[0], "kinds": ["post"]}, "rows": []}
        elif path.endswith("/post"):
            self.posts.append((path.split("/")[3], await request.json()))
            data = {"job": "job2"}
        elif path == "/api/private":
            self.privates.append(await request.json())
            data = {"job": "job3"}
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


async def _write_and_send(page, title, words, button="Post"):
    win = page.get_by_role("dialog", name=title)
    await expect(win.locator(".share-slot .scard")).to_be_visible()     # what you share, as a card
    await win.locator("#body").fill(words)
    await win.locator(".df .btn.primary").click()
    await expect(win).to_have_count(0)


async def test_share_with_a_comment_and_into_a_group(page_api):
    page, api = page_api
    # with a comment: the ordinary compose window for your feed, no subject needed
    await _menu(page, "<p@x>", "Share with a comment…")
    win = page.get_by_role("dialog", name="Share in your feed")
    await expect(win.get_by_label("Subject (if you like)")).to_be_visible()
    await win.locator(".df .btn.primary").click()                        # no words: not sent
    await expect(page.locator(".toast")).to_contain_text("why you share it")
    await _write_and_send(page, "Share in your feed", "Se lige her")
    gid, body = api.posts[-1]
    assert gid == "feed@me" and body["share"] == {"group": GROUP, "id": "<p@x>"}
    assert body["body"].startswith("Se lige her") and body["subject"] == ""

    # into a group: chosen with a search; what cannot take it is last, with why
    await _menu(page, "<p@x>", "Share into a group…")
    pick = page.get_by_role("dialog", name="Share into a group")
    rows = pick.get_by_role("option")
    await expect(rows).to_have_count(3)
    await expect(rows.last).to_contain_text("takes no shares")
    await pick.get_by_role("searchbox").fill("dyr")
    await expect(rows).to_have_count(1)
    await rows.first.click()
    await _write_and_send(page, "Share in dk.dyr", "Til jer med dyr")
    gid, body = api.posts[-1]
    assert gid == "dk.dyr@abcd" and body["share"] == {"group": GROUP, "id": "<p@x>"}
    assert api.shares == []                                              # never the old dialog


async def test_send_to_one_person(page_api):
    page, api = page_api
    await _menu(page, "<p@x>", "Send to…")
    pick = page.get_by_role("dialog", name="Send to…")
    await expect(pick.locator(".seg")).to_have_count(0)                  # a post, no Chat | Post
    await pick.get_by_role("searchbox").fill("sø")
    await pick.get_by_role("option", name="Søren").click()
    await _write_and_send(page, "Send to Søren", "Til dig", button="Send")
    sent = api.privates[-1]
    assert sent["key"] == "ed25519:soeren" and sent["share"] == {"group": GROUP, "id": "<p@x>"}
    assert sent["body"].startswith("Til dig")


async def test_undo_your_own_share(page_api):
    page, api = page_api
    await _menu(page, "<c@x>", "Undo share")
    await expect(page.locator(".toast")).to_contain_text("taken back")
    assert api.unshares[-1] == {"id": "<c@x>", "group": GROUP}
