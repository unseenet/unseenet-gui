"""Private profiles (#65, UN-RFC 0022 section 6, UN-RFC 0046 section 4.16) against a
synthetic local API: a profile shared in a closed group shown there with a note, the
profile asked for with where it is opened, sharing yours with that group or one person
after saying who can read it, and taking it back.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_private_profiles.py
"""

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43
FAM = "familie@abcdabcdabcdabcd"
ALICE = "ed25519:alice"


def row():
    return {"who": "Alice", "who_key": ALICE, "mine": False, "may_edit": False,
            "may_withdraw": False, "read": True, "depth": 0, "tree": None,
            "message": {"id": "<a@x>", "group": FAM, "subject": "Søndag", "text": "Middag kl. 18",
                        "signature": "", "references": [], "kind": "post", "readable": True,
                        "sender_key": ALICE, "private": False, "content_type": "text/plain",
                        "date": "2026-01-01T12:00:00Z"}}


class ProfileAPI:
    """Synthetic answers only: no vault, Tor or outgoing messages."""

    def __init__(self):
        self.asked, self.shared = [], []

    def group(self):
        return {"id": FAM, "label": "Familie", "type": "closed", "view": "threads",
                "hierarchy": "familie", "may_post": True, "unread": 0, "subscribed": True,
                "kinds": ["post"], "write": {"post": {"allowed": True}, "chat": {"allowed": True}}}

    def profile(self, key, context):
        if not key:
            return {"key": "ed25519:me", "profile": {"v": 1, "about": "Offentlig om mig"},
                    "about_tree": None, "label": "Me", "mine": True, "hidden": False,
                    "published": True, "link_kinds": ["web"], "warning": "", "picture": None}
        shared = {"key": key, "profile": {"v": 1, "about": "Mor i familien"}, "about_tree": None,
                  "context": FAM, "context_label": "Familie"} if context == FAM else None
        return {"key": key, "profile": {"v": 1, "about": "Alices offentlige"}, "about_tree": None,
                "label": "Alice", "mine": False, "hidden": False, "link_kinds": ["web"],
                "feed": "feed@alice", "following": False, "shared": shared}

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
                    "hierarchies": [{"name": "familie", "tree": None}], "inbox": {"id": "inbox:test"}}
        elif request.method == "GET" and path == f"/api/groups/{FAM}":
            data = {"group": self.group(), "rows": [row()]}
        elif path == "/api/profile" and request.method == "GET":
            key, context = request.query.get("key", ""), request.query.get("context", "")
            if key:
                self.asked.append(context)
            data = self.profile(key, context)
        elif path == "/api/profile/share":
            self.shared.append(await request.json())
            data = {"ok": True, "id": "<p@x>"}
        elif path == "/api/pictures":
            data = {"pictures": {}}
        else:
            data = {}
        return web.json_response(data)


@pytest.fixture
async def fam_page():
    api = ProfileAPI()
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
            await page.get_by_role("button", name="Familie").first.click()
            await page.wait_for_load_state("networkidle")
            yield page, api
        finally:
            await browser.close()
        assert errors == []


async def test_a_profile_shared_in_the_group_is_shown_there(fam_page):
    page, api = fam_page
    await page.locator(".name-btn", has_text="Alice").first.click()
    dialog = page.locator(".dialog")
    await expect(dialog.locator(".shared-note")).to_have_text(
        "Shared with Familie only - shown only there.")
    await expect(dialog).to_contain_text("Mor i familien")
    await expect(dialog).not_to_contain_text("Alices offentlige")   # the one shared here
    assert api.asked[-1] == FAM                                      # asked with where


async def test_share_yours_with_a_person_after_saying_who_reads_it(fam_page):
    page, api = fam_page
    await page.locator(".name-btn", has_text="Alice").first.click()
    await page.locator(".dialog").get_by_role("button", name="Share yours").click()
    dialog = page.locator(".dialog")
    await expect(dialog.locator("h2")).to_have_text("A profile for Alice only")
    await expect(dialog.locator("#pabout")).to_have_value("Offentlig om mig")
    await expect(dialog.get_by_role("button", name="Remove your profile")).to_have_count(0)
    await dialog.locator("#pabout").fill("Kun til Alice")
    await dialog.get_by_role("button", name="Share …").click()
    await expect(page.locator(".dialog")).to_contain_text("Only Alice can read it")
    await page.locator(".dialog").get_by_role("button", name="Share", exact=True).click()
    await expect(page.locator(".toast")).to_have_text("Profile shared with Alice.")
    sent = api.shared[-1]
    assert sent["to"] == ALICE and sent["profile"]["edit"]["about"] == "Kun til Alice"


async def test_share_with_the_group_and_take_it_back(fam_page):
    page, api = fam_page

    async def run(name):
        await page.keyboard.press("Control+k")
        await page.keyboard.type(name)
        await page.keyboard.press("Enter")

    await run("Share your profile with this group only")
    dialog = page.locator(".dialog")
    await expect(dialog.locator("h2")).to_have_text("A profile for the members of Familie only")
    await dialog.get_by_role("button", name="Share …").click()
    await page.locator(".dialog").get_by_role("button", name="Share", exact=True).click()
    await expect(page.locator(".toast")).to_have_text("Profile shared with the members of Familie.")
    assert api.shared[-1]["to"] == FAM
    await run("Take back the profile you shared here")
    await page.locator(".dialog").get_by_role("button", name="Take back").click()
    await expect(page.locator(".toast")).to_contain_text("taken back from the members of Familie")
    assert api.shared[-1] == {"to": FAM, "withdraw": True}
