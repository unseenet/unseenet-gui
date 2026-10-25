"""The Contacts dialog (#118, unseenet#523) against a synthetic local API: type to find
someone by the name you gave them, their key or a name they hold; Up/Down choose,
Enter chats, Esc clears the filter first and closes on the second press; a key that
matches nobody offers a chat with it.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_contacts.py
"""

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43
SONIA = "ed25519:" + "s" * 52
MIKKEL = "ed25519:" + "m" * 52
MIA = "ed25519:" + "a" * 52
STRANGER = "ed25519:" + "q" * 52


def contact(key, name, names=()):
    return {"id": "contact:" + key, "key": key, "name": name, "closed": True, "names": list(names)}


SEEN = []


async def handle(request):
    path = request.path
    SEEN.append(path)
    if path == "/api/state":
        data = {"unlocked": True, "connected": True, "status": "Connected",
                "identity": {"display": "Me", "label": "Me", "key": "ed25519:me"}}
    elif path == "/x/gui/state":
        data = {"bootable": False, "web": False}
    elif path == "/api/settings":
        data = {"signature_preview": "", "notices": {"send": True}}
    elif path == "/api/groups":
        data = {"groups": [], "people": [], "hierarchies": [], "inbox": {"id": "inbox:test"},
                "contacts": [contact(SONIA, "Sonia", ["sonia@lorensen"]),
                             contact(MIKKEL, "Mikkel"), contact(MIA, "Mia")]}
    elif path == "/api/pictures":
        data = {"pictures": {}}
    else:
        data = {}
    return web.json_response(data)


async def events(request):
    ws = web.WebSocketResponse(protocols=["unseenet"])
    await ws.prepare(request)
    async for _ in ws:
        pass
    return ws


@pytest.fixture
async def page():
    app = web.Application()

    async def index(_request):
        return web.FileResponse(STATIC / "index.html")

    app.router.add_get("/", index)
    app.router.add_static("/static/", STATIC)
    app.router.add_get("/api/events", events)
    app.router.add_route("*", "/api/{path:.*}", handle)
    app.router.add_route("*", "/x/gui/{path:.*}", handle)
    async with TestServer(app, host="127.0.0.1") as server, playwright.async_playwright() as p:
        browser = await p.chromium.launch()
        pg = await browser.new_page(viewport={"width": 1280, "height": 800})
        errors = []
        pg.on("pageerror", lambda error: errors.append(str(error)))
        try:
            await pg.goto(str(server.make_url("/")) + "#t=" + TOKEN)
            await pg.wait_for_load_state("networkidle")
            await pg.get_by_role("button", name="Contacts").first.click()
            yield pg
        finally:
            await browser.close()
        assert errors == []


async def test_find_a_contact(page):
    dialog = page.get_by_role("dialog", name="Contacts")
    find = dialog.get_by_role("searchbox", name="Find a contact")
    await expect(find).to_be_focused()
    rows = dialog.get_by_role("option")
    await expect(rows).to_have_count(3)
    await expect(rows.locator(".nm")).to_have_text(["Mia", "Mikkel", "Sonia sonia@lorensen"])
    await expect(dialog.locator(".df")).to_contain_text("3 contacts")

    await find.fill("mi")                                                # any part, any case
    await expect(rows).to_have_count(2)
    await expect(dialog.locator(".df")).to_contain_text("2 of 3 contacts")
    await find.fill("lorensen")                                          # a name they hold
    await expect(rows).to_have_count(1)
    await expect(rows.first).to_contain_text("Sonia")
    await find.fill("mmmmmmmm")                                          # a key
    await expect(rows).to_have_count(1)
    await expect(rows.first).to_contain_text("Mikkel")

    await find.press("Escape")                                           # clears first
    await expect(find).to_have_value("")
    await expect(dialog).to_be_visible()
    await find.press("ArrowDown")                                        # Mia -> Mikkel
    await expect(dialog.locator(".cmd.on")).to_contain_text("Mikkel")
    await find.press("Escape")                                           # then closes
    await expect(dialog).to_have_count(0)


async def test_no_match_and_a_key(page):
    dialog = page.get_by_role("dialog", name="Contacts")
    find = dialog.get_by_role("searchbox", name="Find a contact")
    await find.fill("nobody")
    await expect(dialog).to_contain_text("No contacts match")
    await expect(dialog.get_by_role("button", name="Chat with this key")).to_have_count(0)
    await find.fill(STRANGER)
    await expect(dialog.get_by_role("button", name="Chat with this key")).to_be_visible()
    await expect(dialog.get_by_role("button", name="Add as contact")).to_be_visible()


async def test_enter_chats(page):
    dialog = page.get_by_role("dialog", name="Contacts")
    find = dialog.get_by_role("searchbox", name="Find a contact")
    await find.fill("son")
    await find.press("Enter")
    await expect(dialog).to_have_count(0)
    await page.wait_for_load_state("networkidle")
    assert any(p.startswith("/api/groups/contact:" + SONIA) for p in SEEN), SEEN
