"""unseenet: addresses (#66, UN-RFC 0031 section 3.4.1, UN-RFC 0046 section 4.13) against a
synthetic local API: an address in a post opens the post, the group first when you do
not follow it (and only when you choose to), a person's opens their profile, and the
addresses of posts, chat lines, groups and profiles can be copied.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_addresses.py
"""

import pytest
from urllib.parse import quote
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC
from conftest import post_menu  # noqa: E402

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43
GROUP = "alt.adr@abcd"
OTHER = "alt.andet@efgh"
FP = "a" * 32
KEY = "ed25519:bo"
MD = "text/markdown; charset=utf-8; variant=unseenet"
POSTS = [("<a@x>", "Velkommen", "Se unseenet:alt.adr@abcd?m=c@x. Den er god."),
         ("<b@x>", "Andet sted", "Prøv unseenet:alt.andet@efgh?n=xyz.onion og <unseenet:" + FP + ">"),
         ("<c@x>", "Husk mødet", "torsdag kl. 19")]
# the core's Markdown tree of the second post (UN-RFC 0046): an autolink to a person
TREE = [{"t": "p", "c": [{"t": "text", "v": "Prøv unseenet:alt.andet@efgh?n=xyz.onion og "},
                         {"t": "link", "href": "unseenet:" + FP,
                          "c": [{"t": "text", "v": "unseenet:" + FP}]}]}]


def row(mid, subject, text, view):
    kind = "chat" if view == "chat" else "post"
    return {"who": "Someone", "who_key": "ed25519:other", "mine": False, "may_edit": False,
            "may_withdraw": False, "read": True, "depth": 0,
            "address": f"unseenet:{GROUP}?m={mid.strip('<>')}",
            "tree": TREE if mid == "<b@x>" else None,
            "message": {"id": mid, "group": GROUP, "subject": "" if kind == "chat" else subject,
                        "text": text, "signature": "", "references": [], "kind": kind,
                        "readable": True, "sender_key": "ed25519:other", "private": False,
                        "content_type": MD if mid == "<b@x>" else "text/plain",
                        "date": "2026-01-01T12:00:00Z"}}


class AddressAPI:
    """Synthetic answers only: no vault, Tor or outgoing messages."""

    def __init__(self, view):
        self.view = view
        self.followed = {GROUP}
        self.asked, self.subscribed = [], []

    def group(self, gid=GROUP):
        return {"id": gid, "label": gid.split("@")[0], "type": "open", "view": self.view,
                "hierarchy": "alt", "may_post": True, "unread": 0, "subscribed": True,
                "kinds": ["chat"] if self.view == "chat" else ["post"],
                "address": "unseenet:" + gid,
                "write": {"post": {"allowed": True}, "chat": {"allowed": True}}}

    def address(self, a):
        self.asked.append(a)
        if a.startswith("web+unseenet:"):                       # the core reads both forms
            a = a[len("web+"):]
        out = self._address(a)
        if out is not None:                                      # its web form (#98)
            out["web"] = "https://unseenet.net/a/" + out["address"][len("unseenet:"):].split("&n=")[0]
        return out

    def _address(self, a):
        if a == "unseenet:" + FP:
            return {"kind": "identity", "address": a, "nodes": [], "fingerprint": FP,
                    "key": KEY, "label": "Bo", "mine": False}
        if a.startswith("unseenet:" + OTHER):
            return {"kind": "group", "address": "unseenet:" + OTHER, "nodes": ["xyz.onion"],
                    "group_id": OTHER, "followed": OTHER in self.followed, "available": True,
                    "group": {"id": OTHER, "label": "alt.andet", "title": "Et andet sted",
                              "type": "open", "view": "threads"}, "message": None, "page": None}
        if a == "unseenet:" + GROUP:
            return {"kind": "group", "address": a, "nodes": [], "group_id": GROUP,
                    "followed": True, "available": True,
                    "group": {"id": GROUP, "label": "alt.adr", "title": "", "type": "open",
                              "view": self.view}, "message": None, "page": None}
        if a.startswith("unseenet:" + GROUP + "?m="):
            return {"kind": "post", "address": a, "nodes": [], "group_id": GROUP,
                    "followed": True, "available": True,
                    "group": {"id": GROUP, "label": "alt.adr", "title": "", "type": "open",
                              "view": self.view},
                    "message": {"id": "<c@x>", "subject": "Husk mødet", "kind": "post",
                                "who": "Someone", "date": "2026-01-01T12:00:00Z"},
                    "page": None}
        return None

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
            data = {"groups": [self.group(g) for g in sorted(self.followed)], "people": [],
                    "hierarchies": [{"name": "alt", "tree": None}], "inbox": {"id": "inbox:test"}}
        elif path == "/api/address":
            data = self.address(request.query.get("a", ""))
            if data is None:
                return web.json_response({"error": "not an address: it does not start with unseenet:"},
                                         status=400)
        elif path == "/api/subscribe":
            body = await request.json()
            self.subscribed.append(body)
            self.followed.add(body["id"])
            data = {"ok": True}
        elif path == "/api/profile":
            data = {"key": request.query.get("key"), "label": "Bo", "mine": False,
                    "hidden": False, "profile": None, "address": "unseenet:" + FP}
        elif request.method == "GET" and path == f"/api/groups/{GROUP}":
            data = {"group": self.group(), "rows": [row(m, s, t, self.view) for m, s, t in POSTS]}
        elif request.method == "GET" and path == f"/api/groups/{OTHER}":
            data = {"group": self.group(OTHER), "rows": []}
        elif path == "/api/pictures":
            data = {"pictures": {}}
        else:
            data = {}
        return web.json_response(data)


@pytest.fixture
async def addr_page(request):
    api = AddressAPI(request.param)
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
            # what is copied, without asking the browser for the clipboard
            await page.evaluate("() => { window.COPIED = []; navigator.clipboard.writeText = async (t) => { window.COPIED.push(t); }; }")
            await page.get_by_role("button", name="alt.adr").first.click()
            await page.wait_for_load_state("networkidle")
            yield page, api
        finally:
            await browser.close()
        assert errors == []


@pytest.mark.parametrize("addr_page", ["threads"], indirect=True)
async def test_an_address_in_plain_text_opens_the_post(addr_page):
    page, api = addr_page
    await page.locator(".prow", has_text="Velkommen").click()
    link = page.locator(".reader a.aref")
    await expect(link).to_have_text("unseenet:alt.adr@abcd?m=c@x")     # not the full stop
    await link.click()
    await expect(page.locator(".prow.on")).to_contain_text("Husk mødet")
    assert api.asked == ["unseenet:alt.adr@abcd?m=c@x"]


@pytest.mark.parametrize("addr_page", ["threads"], indirect=True)
async def test_a_group_you_do_not_follow_asks_first(addr_page):
    page, api = addr_page
    await page.locator(".prow", has_text="Andet sted").click()
    await page.locator(".reader a.aref", has_text="alt.andet").click()
    dialog = page.locator(".dialog")
    await expect(dialog).to_contain_text("Follow alt.andet?")
    await expect(dialog).to_contain_text("Et andet sted")
    assert api.subscribed == []                                           # never by itself
    await dialog.get_by_role("button", name="Follow").click()
    await expect(page.locator(".dialog")).to_have_count(0)
    await expect(page.locator(".toast")).to_have_count(0)
    assert api.subscribed == [{"id": OTHER, "on": True}]


@pytest.mark.parametrize("addr_page", ["threads"], indirect=True)
async def test_a_persons_address_opens_their_profile(addr_page):
    page, api = addr_page
    await page.locator(".prow", has_text="Andet sted").click()
    link = page.locator(".reader a.mdlink", has_text=FP)                 # a Markdown autolink
    await expect(link.locator("a")).to_have_count(0)                      # no link inside a link
    await link.click()
    dialog = page.locator(".dialog")
    await expect(dialog.locator("h2")).to_have_text("Bo")
    await dialog.get_by_role("button", name="Copy address").click()
    await expect(page.locator(".toast")).to_have_text("The address is copied.")
    assert await page.evaluate("window.COPIED") == ["unseenet:" + FP]


@pytest.mark.parametrize("addr_page", ["threads"], indirect=True)
async def test_copy_the_address_of_a_post_and_a_group(addr_page):
    page, _ = addr_page
    await page.locator(".prow", has_text="Husk mødet").click()
    more = page.locator(".more-btn")
    if await more.is_visible():
        await more.click()
    await post_menu(page, "Copy address")
    await page.get_by_role("button", name="About this group").click()
    await expect(page.locator(".dialog")).to_contain_text("unseenet:alt.adr@abcd")
    await page.locator(".dialog").get_by_role("button", name="Copy address").click()
    await expect(page.locator(".toast")).to_have_text("The group's address is copied.")
    assert await page.evaluate("window.COPIED") == ["unseenet:alt.adr@abcd?m=c@x", "unseenet:alt.adr@abcd"]


@pytest.mark.parametrize("addr_page", ["chat"], indirect=True)
async def test_open_an_address_from_the_palette_and_copy_a_line(addr_page):
    page, api = addr_page
    line = page.locator(".bubble", has_text="torsdag kl. 19")
    await line.hover()
    await line.get_by_role("button", name="More").click()             # in ⋯ (#120)
    await line.get_by_role("menuitem", name="Copy address").click()
    await expect(page.locator(".toast")).to_have_text("The address is copied.")
    assert await page.evaluate("window.COPIED") == ["unseenet:alt.adr@abcd?m=c@x"]

    async def open_address(text):
        await page.keyboard.press("Control+k")
        await page.keyboard.type("Open an unseenet")
        await page.keyboard.press("Enter")
        await page.fill("#addr", text)
        await page.keyboard.press("Enter")

    await open_address("nonsense")
    await expect(page.locator(".toast")).to_contain_text("not an address")
    await expect(page.locator(".dialog")).to_have_count(0)
    await open_address("unseenet:alt.adr@abcd?m=c@x")
    await expect(page.locator(".bubble.flash")).to_have_count(1)


@pytest.mark.parametrize("addr_page", ["chat"], indirect=True)
async def test_copy_the_web_address(addr_page):
    """#98: the same address on a web entrance, from ⋯ and from the group's info."""
    page, api = addr_page
    line = page.locator(".bubble", has_text="torsdag kl. 19")
    await line.hover()
    await line.get_by_role("button", name="More").click()
    await line.get_by_role("menuitem", name="Copy web address").click()
    await expect(page.locator(".toast")).to_contain_text("web address is copied")
    await page.get_by_role("button", name="About this group").click()
    await page.locator(".dialog").get_by_role("button", name="Copy web address").click()
    await expect(page.locator(".toast")).to_contain_text("group's web address is copied")
    assert await page.evaluate("window.COPIED") == ["https://unseenet.net/a/alt.adr@abcd?m=c@x",
                                                     "https://unseenet.net/a/alt.adr@abcd"]


@pytest.mark.parametrize("addr_page", ["threads"], indirect=True)
async def test_a_web_unseenet_link_opens_the_post(addr_page):
    """#98: a web+unseenet: link the browser hands over as #open=... opens after unlock."""
    page, api = addr_page
    link = "web+unseenet:alt.adr@abcd?m=c@x"
    await page.goto(page.url.split("#")[0] + "#t=" + TOKEN + "&open=" + quote(link, safe=""))
    await page.reload()                                           # as when the browser opens it
    await expect(page.locator(".prow.on")).to_contain_text("Husk mødet")
    assert link in api.asked
    assert "open=" not in page.url                                # taken out of the address bar
