"""Pinned posts (#62, UN-RFC 0033, UN-RFC 0046 section 4.12) against a synthetic local API:
the Pinned section above the threads, the pinned bar above a chat, pinning and
unpinning offered to the owner and moderators only, and the warnings before it.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_pins.py
"""

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43
GROUP = "alt.pins@abcd"
POSTS = [("<a@x>", "Velkommen", "Læs denne først"), ("<b@x>", "Regler", "Vær søde"),
         ("<c@x>", "Husk mødet", "torsdag kl. 19")]


def row(mid, subject, text, view, pinned):
    kind = "chat" if view == "chat" else "post"
    return {"who": "Someone", "who_key": "ed25519:other", "mine": False, "may_edit": False,
            "may_withdraw": False, "read": True, "depth": 0, "pinned": mid in pinned,
            "message": {"id": mid, "group": GROUP, "subject": "" if kind == "chat" else subject,
                        "text": text if kind == "chat" else subject + ": " + text,
                        "signature": "", "references": [], "kind": kind, "readable": True,
                        "sender_key": "ed25519:other", "private": False,
                        "date": "2026-01-01T12:00:00Z"}}


class PinAPI:
    """Synthetic answers only: no vault, Tor or outgoing messages."""

    def __init__(self, view, may_pin, max_pins=5):
        self.view, self.may_pin, self.max_pins = view, may_pin, max_pins
        self.pinned = ["<a@x>"]                 # newest first
        self.beyond = set()
        self.requests = []

    def group(self):
        subjects = {m: (s, t) for m, s, t in POSTS}
        pins = [{"id": m, "note": "Til nye" if m == "<a@x>" else "", "by": "ed25519:owner",
                 "by_label": "Owner", "pinned": "2026-01-02T12:00:00Z",
                 "subject": subjects[m][0] if self.view != "chat" else None, "who": "Someone",
                 "date": "2026-01-01T12:00:00Z", "beyond_window": m in self.beyond}
                for m in self.pinned]
        return {"id": GROUP, "label": "alt.pins", "type": "open", "view": self.view,
                "hierarchy": "alt", "may_post": True, "unread": 0,
                "kinds": ["chat"] if self.view == "chat" else ["post"],
                "write": {"post": {"allowed": True}, "chat": {"allowed": True}},
                "pins": pins, "max_pins": self.max_pins, "may_pin": self.may_pin}

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
                    "hierarchies": [{"name": "alt", "tree": None}], "inbox": {"id": "inbox:test"}}
        elif path == f"/api/groups/{GROUP}/pin":
            body = await request.json()
            self.requests.append(body)
            if body.get("unpin"):
                self.pinned.remove(body["id"])
            else:
                self.pinned.insert(0, body["id"])
            data = {"ok": True, "marker": "<m@x>", "pins": self.group()["pins"]}
        elif request.method == "GET" and path == f"/api/groups/{GROUP}":
            data = {"group": self.group(),
                    "rows": [row(m, s, t, self.view, self.pinned) for m, s, t in POSTS]}
        elif path == "/api/pictures":
            data = {"pictures": {}}
        else:
            data = {}
        return web.json_response(data)


@pytest.fixture
async def pins_page(request):
    view, may_pin = request.param
    api = PinAPI(view, may_pin)
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
            await page.get_by_role("button", name="alt.pins").first.click()
            await page.wait_for_load_state("networkidle")
            yield page, api
        finally:
            await browser.close()
        assert errors == []


@pytest.mark.parametrize("pins_page", [("threads", True)], indirect=True)
async def test_pinned_section_above_the_threads(pins_page):
    page, api = pins_page
    section = page.get_by_role("region", name="Pinned posts")
    await expect(section).to_contain_text("Velkommen")
    await expect(section).to_contain_text("Til nye")                 # the pin's note
    await expect(page.locator(".prow .pinmark")).to_have_count(1)     # marked in its place too
    await section.get_by_role("button", name="Pinned").click()        # folded away
    await expect(section.locator(".pin")).to_have_count(0)
    await section.get_by_role("button", name="Pinned").click()
    await section.locator(".pin").first.click()                       # opens the post
    await expect(page.locator(".prow.on")).to_contain_text("Velkommen")


@pytest.mark.parametrize("pins_page", [("threads", True)], indirect=True)
async def test_pin_and_unpin_from_the_post(pins_page):
    page, api = pins_page
    await page.locator(".prow", has_text="Regler").click()
    await page.get_by_role("button", name="Pin", exact=True).click()
    await page.fill("#pnote", "Husk dem")
    await page.locator(".dialog .btn.primary").click()
    await expect(page.locator(".pins .pin")).to_have_count(2)
    assert api.requests[-1] == {"id": "<b@x>", "note": "Husk dem"}

    api.beyond.add("<b@x>")                                           # older than the window
    await page.evaluate("loadGroup().then(render)")
    await page.locator(".prow", has_text="Regler").click()
    await page.get_by_role("button", name="Unpin", exact=True).click()
    await expect(page.locator(".dialog")).to_contain_text("delete it as soon as it is unpinned")
    await page.locator(".dialog .btn.primary").click()
    await expect(page.locator(".pins .pin")).to_have_count(1)
    assert api.requests[-1] == {"id": "<b@x>", "unpin": True}


@pytest.mark.parametrize("pins_page", [("threads", True)], indirect=True)
async def test_a_full_group_says_which_pin_stops_counting(pins_page):
    page, api = pins_page
    api.max_pins = 1
    await page.evaluate("loadGroup().then(render)")
    await page.locator(".prow", has_text="Regler").click()
    await page.get_by_role("button", name="Pin", exact=True).click()
    await expect(page.locator(".dialog .warnbox")).to_contain_text("“Velkommen” stops counting")


@pytest.mark.parametrize("pins_page", [("threads", False)], indirect=True)
async def test_no_pinning_for_others(pins_page):
    page, _ = pins_page
    await expect(page.get_by_role("region", name="Pinned posts")).to_be_visible()   # but you see them
    await page.locator(".prow", has_text="Regler").click()
    await expect(page.get_by_role("button", name="Pin", exact=True)).to_have_count(0)


@pytest.mark.parametrize("pins_page", [("chat", True)], indirect=True)
async def test_pinned_bar_above_a_chat(pins_page):
    page, api = pins_page
    bar = page.get_by_role("region", name="Pinned")
    await expect(bar).to_contain_text("Læs denne først")
    await page.locator(".pb-main").click()
    await expect(page.locator(".bubble.flash")).to_have_count(1)
    await bar.get_by_role("button", name="Hide the pins").click()
    await expect(page.locator(".pinbar.off")).to_contain_text("Show the pins (1)")
    await page.locator(".pinbar.off button").click()
    line = page.locator(".bubble", has_text="torsdag kl. 19")
    await line.hover()
    await line.get_by_role("button", name="Pin").click()
    await page.locator(".dialog .btn.primary").click()
    await expect(page.locator(".pinbar .hint")).to_have_text("1/2")
    assert api.requests[-1] == {"id": "<c@x>", "note": ""}
