"""Your contacts as a pane, and the person picker (#118, unseenet#523, gui#209) against a synthetic local API: type to find
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
    elif path == "/api/profile":
        data = {"key": request.query.get("key"), "label": "Sonia √", "mine": False,
                "context": request.query.get("context"),
                "theirs": {"feed": "feed@ssss", "site": None}, "profile": {"about": "Hej"}}
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
            await pg.get_by_role("button", name="Your contacts").first.click()
            yield pg
        finally:
            await browser.close()
        assert errors == []


async def test_find_a_contact(page):
    """gui#209: Your contacts is a pane with the same head as the other private lists."""
    await expect(page.locator(".ghead h1")).to_have_text("Your contacts")
    await expect(page.locator(".ghead")).to_contain_text("names only you see")
    find = page.get_by_role("searchbox", name="Find a contact")
    rows = page.locator(".contactrow")
    await expect(rows).to_have_count(3)
    await expect(rows.locator(".item .nm")).to_have_text(["Mia", "Mikkel", "Sonia"])
    await find.fill("mi")                                                # any part, any case
    await expect(rows).to_have_count(2)
    await find.fill("lorensen")                                          # a name they hold
    await expect(rows).to_have_count(1)
    await expect(rows.first).to_contain_text("Sonia")
    await find.fill("mmmmmmmm")                                          # a key
    await expect(rows).to_have_count(1)
    await expect(rows.first).to_contain_text("Mikkel")
    await find.press("Escape")                                           # clears
    await expect(find).to_have_value("")
    await expect(page.get_by_role("dialog", name="Contacts")).to_have_count(0)   # no dialog left


async def test_no_match_and_a_key(page):
    find = page.get_by_role("searchbox", name="Find a contact")
    await find.fill("nobody")
    await expect(page.locator(".contacts-list")).to_contain_text("No contact matches")
    await expect(page.get_by_role("button", name="Chat with this key")).to_have_count(0)
    await find.fill(STRANGER)
    await expect(page.get_by_role("button", name="Chat with this key")).to_be_visible()
    await expect(page.get_by_role("button", name="Add as contact")).to_be_visible()


async def test_the_person_picker(page):
    """gui#209: M and Chat with someone open a picker, not a To field - Chat | Post (Tab),
    find by name or paste a key, Enter opens the chat itself."""
    await page.evaluate("openWrite('', 'chat')")
    dialog = page.locator(".dialog.picker")
    await expect(dialog).to_have_attribute("aria-label", "New private chat")
    find = dialog.get_by_role("searchbox", name="Find a contact, or paste a key")
    await expect(find).to_be_focused()
    await expect(dialog.locator("#wkey")).to_have_count(0)
    await find.press("Tab")
    await expect(dialog).to_have_attribute("aria-label", "New private post")
    await find.press("Tab")
    await find.fill("son")
    await expect(dialog.locator(".cmd.on")).to_contain_text("Sonia")
    await find.press("Enter")
    await expect(dialog).to_have_count(0)
    await page.wait_for_load_state("networkidle")
    assert any(p.startswith("/api/groups/contact:" + SONIA) for p in SEEN), SEEN


async def test_a_contacts_profile(page):
    """gui#215: the name, or Profile, opens their profile - and from there feed, chat,
    post, rename and remove."""
    row = page.locator(".contactrow").filter(has_text="Sonia")
    await row.locator(".item").click()
    dialog = page.get_by_role("dialog", name="Profile")
    await expect(dialog.get_by_role("heading")).to_have_text("Sonia √")
    assert any(p == "/api/profile" for p in SEEN), SEEN
    for name in ("Their feed", "Follow", "Chat", "Post", "Rename", "Remove contact"):
        await expect(dialog.get_by_role("button", name=name, exact=True)).to_be_visible()
    await dialog.get_by_role("button", name="Close", exact=True).last.click()
    await expect(dialog).to_have_count(0)
    await row.get_by_role("button", name="Profile", exact=True).click()
    await expect(dialog).to_be_visible()
    await dialog.get_by_role("button", name="Chat", exact=True).click()
    await expect(dialog).to_have_count(0)
    await page.wait_for_load_state("networkidle")
    assert any(p.startswith("/api/groups/contact:" + SONIA) for p in SEEN), SEEN


async def test_chat_from_a_contact_row(page):
    await page.locator(".contactrow").filter(has_text="Sonia").get_by_role("button", name="Chat", exact=True).click()
    await page.wait_for_load_state("networkidle")
    assert any(p.startswith("/api/groups/contact:" + SONIA) for p in SEEN), SEEN
