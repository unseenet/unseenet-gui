"""Files where they were forgotten (#102, unseenet#496/#497) against a synthetic local
API: the Files choice when creating and editing a group, pictures on a chat line, and
pictures in a private post.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_files_choice.py
"""

import base64
import re

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43
CHAT = "dk.foto.chat@abcd"
INBOX = "inbox:test"
PICTURES = {"max_size": 4194304, "types": ["image/*"]}
SONIA = "ed25519:sonia"
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==")


def group(gid=CHAT):
    return {"id": gid, "label": "dk.foto.chat@abcd", "type": "open", "view": "chat",
            "owner_view": "chat", "hierarchy": "dk", "may_post": True, "owner": True,
            "kinds": ["chat", "post"], "unread": 0, "files": PICTURES, "node_files": True,
            "subscribed": True}


class LocalAPI:
    """Synthetic answers only: no vault, Tor or outgoing messages."""

    def __init__(self):
        self.sent, self.created, self.settings, self.unexpected = [], [], [], []
        self.closed, self.contact_changes = [], []
        self.people = [{"id": "contact:" + SONIA, "key": SONIA, "name": "Sonia", "contact": True, "unread": 0}]

    async def events(self, request):
        ws = web.WebSocketResponse(protocols=["unseenet"])
        await ws.prepare(request)
        async for _ in ws:
            pass
        return ws

    async def handle(self, request):
        assert request.headers["X-Unseenet-Token"] == TOKEN
        path = request.path
        if path == "/api/state":
            data = {"unlocked": True, "connected": True, "status": "Connected",
                    "identity": {"display": "Me", "label": "Me", "key": "ed25519:me"}}
        elif path == "/x/gui/state":
            data = {"bootable": False, "web": False}
        elif path == "/api/settings":
            data = {"signature_preview": "", "notices": {"send": True}}
        elif path == "/api/settings/clients/gui":
            data = {"client": "gui", "settings": {}}
        elif path == "/api/groups" and request.method == "POST":
            self.created.append(await request.json())
            data = {"id": "dk.ny@abcd"}
        elif path == "/api/groups":
            data = {"groups": [group()], "people": self.people, "inbox": {"id": INBOX},
                    "contacts": [{"id": "contact:" + SONIA, "key": SONIA, "name": "Sonia",
                                  "closed": not self.people}],
                    "hierarchies": [{"name": "dk", "tree": None}]}
        elif path == "/api/chats/close":
            self.closed.append(await request.json())
            self.people = []
            data = {"ok": True}
        elif path == "/api/contacts":
            self.contact_changes.append(await request.json())
            data = {"ok": True}
        elif path == "/api/profile":
            data = {"key": SONIA, "label": "Sonia", "mine": False, "hidden": False, "profile": None,
                    "address": "unseenet:" + "s" * 16, "feed": None, "following": False,
                    "theirs": {"feed": None, "site": None}}
        elif path.startswith("/x/gui/write/"):
            data = {"post": {"allowed": True}, "chat": {"allowed": True}}
        elif path.endswith("/settings"):
            self.settings.append(await request.json())
            data = {"ok": True}
        elif path.endswith("/post") or path == "/api/private":
            self.sent.append((path, await request.json()))
            data = {"job": "job-" + str(len(self.sent))}
        elif request.method == "GET" and path.startswith("/api/groups/"):
            gid = path.removeprefix("/api/groups/")
            data = {"group": group(gid), "rows": []}
            if gid.startswith("contact:"):            # a chat with a person
                data["group"] = {"id": gid, "label": "Sonia √", "type": "contact", "key": SONIA,
                                 "contact": True, "view": "chat", "hierarchy": "", "may_post": True,
                                 "kinds": ["chat", "post"], "unread": 0}
        elif path.endswith("/read"):
            data = {}
        elif path == "/api/pictures":
            data = {"pictures": {}}
        elif path.startswith("/api/jobs/"):
            data = {"state": "sending"}
        else:
            self.unexpected.append((request.method, path))
            raise web.HTTPNotFound()
        return web.json_response(data)


@pytest.fixture
async def files_page(tmp_path):
    api = LocalAPI()
    app = web.Application()

    async def index(_request):
        return web.FileResponse(STATIC / "index.html")

    app.router.add_get("/", index)
    app.router.add_static("/static/", STATIC)
    app.router.add_get("/api/events", api.events)
    app.router.add_route("*", "/api/{path:.*}", api.handle)
    app.router.add_route("*", "/x/gui/{path:.*}", api.handle)
    picture = tmp_path / "have.png"
    picture.write_bytes(PNG)
    async with TestServer(app, host="127.0.0.1") as server, playwright.async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
            await page.wait_for_load_state("networkidle")
            yield page, api, picture
        finally:
            await browser.close()
        assert errors == []
        assert api.unexpected == []


async def palette(page, command):
    await page.keyboard.press("Control+k")
    await page.keyboard.type(command)
    await page.keyboard.press("Enter")


async def test_create_a_group_that_takes_pictures(files_page):
    page, api, _ = files_page
    await palette(page, "Create a group")
    dialog = page.locator(".dialog")
    await dialog.locator("#gname").fill("dk.ny")
    await dialog.get_by_role("button", name=re.compile("^Pictures up to")).click()
    await dialog.get_by_role("button", name="Create", exact=True).click()
    await expect(page.locator(".toast")).to_contain_text("created")
    assert api.created and api.created[0]["files"] == "pictures"


async def test_edit_a_group_files(files_page):
    page, api, _ = files_page
    await page.get_by_role("button", name=re.compile("dk.foto.chat")).first.click()
    await page.evaluate("openEditGroup()")
    dialog = page.locator(".dialog")
    await expect(dialog.get_by_role("button", name=re.compile("^Pictures up to"))).to_have_attribute("aria-pressed", "true")
    pdf = dialog.get_by_role("button", name=re.compile("^Pictures and PDFs"))
    await pdf.scroll_into_view_if_needed()
    await pdf.click()
    await expect(pdf).to_have_attribute("aria-pressed", "true")
    await dialog.get_by_role("button", name="Save", exact=True).click()
    await expect(page.locator(".toast")).to_contain_text("updated")
    assert api.settings[-1]["files"] == "pictures+pdf"


async def test_a_picture_on_a_chat_line(files_page):
    page, api, picture = files_page
    await page.get_by_role("button", name=re.compile("dk.foto.chat")).first.click()
    await expect(page.locator('[data-k="chat"]')).to_be_visible()
    await page.set_input_files("#chatfiles", str(picture))
    await expect(page.locator(".chatfiles")).to_contain_text("have.png")
    await page.locator('[data-k="chat"]').fill("Min have")
    await page.keyboard.press("Enter")
    await expect(page.locator(".chatfiles")).to_have_count(0)
    path, body = api.sent[-1]
    assert path.endswith("/post") and body.get("kind", "chat" if body.get("chat") else None) == "chat"
    assert body["body"] == "Min have"
    assert [f["name"] for f in body["files"]] == ["have.png"]
    assert base64.b64decode(body["files"][0]["data"]) == PNG


async def test_a_private_post_takes_pictures(files_page):
    page, api, _ = files_page
    await page.evaluate("openWrite('ed25519:someone', 'post')")
    await expect(page.locator("#body")).to_be_visible()
    await expect(page.locator(".dialog .attach")).to_contain_text("Add pictures or files")


async def test_create_a_site_makes_it_a_channel(files_page):
    """unseenet#515: Site under Shown as - a site is a channel (UN-RFC 0035 section 3)."""
    page, api, _ = files_page
    await palette(page, "Create a group")
    dialog = page.locator(".dialog")
    await dialog.locator("#gname").fill("dk.side")
    await dialog.get_by_role("button", name=re.compile("Site")).click()
    await expect(dialog.get_by_role("button", name=re.compile("^Channel"))).to_have_attribute("aria-pressed", "true")
    await expect(dialog).to_contain_text("A site is a channel")
    await dialog.get_by_role("button", name="Create", exact=True).click()
    await expect(page.locator(".toast")).to_contain_text("created")
    assert api.created[-1]["view"] == "pages" and api.created[-1]["type"] == "channel"


async def test_create_a_feed_with_comments(files_page):
    page, api, _ = files_page
    await palette(page, "Create a group")
    dialog = page.locator(".dialog")
    await dialog.locator("#gname").fill("dk.nyt")
    await dialog.get_by_role("button", name=re.compile("^Channel")).click()
    await dialog.get_by_role("button", name=re.compile("Feed")).click()
    await dialog.get_by_role("button", name=re.compile("^No comments")).click()
    await dialog.get_by_role("button", name="Create", exact=True).click()
    await expect(page.locator(".toast")).to_contain_text("created")
    body = api.created[-1]
    assert body["view"] == "feed" and body["type"] == "channel" and body["comments"] == "none"


async def test_close_a_chat_from_the_list(files_page):
    """A chat leaves the list with ⋯ Close chat (UN-RFC 0044 4.2); the contact stays."""
    page, api, _ = files_page
    row = page.locator(".personrow").filter(has_text="Sonia")
    await row.hover()
    await row.get_by_role("button", name=re.compile("More about the chat")).click()
    await row.get_by_role("menuitem", name="Close chat").click()
    await expect(page.locator(".toast")).to_contain_text("Closed the chat with Sonia")
    assert api.closed == [{"key": SONIA, "on": True}]
    await expect(page.locator(".personrow")).to_have_count(0)
    await page.keyboard.press("Control+k")                # still a contact
    await page.keyboard.type("Contacts")
    await page.keyboard.press("Enter")
    await expect(page.locator(".dialog")).to_contain_text("Sonia")


async def test_a_chat_has_close_chat_not_unsubscribe(files_page):
    page, api, _ = files_page
    await page.locator(".personrow .item").filter(has_text="Sonia").click()
    await expect(page.get_by_role("button", name="Close chat")).to_be_visible()
    await page.get_by_role("button", name="About this group").click()
    dialog = page.locator(".dialog")
    await expect(dialog.get_by_role("button", name="Close chat")).to_be_visible()
    assert await dialog.get_by_role("button", name="Unsubscribe").count() == 0


async def test_contacts_from_the_profile_and_chats_fold_away(files_page):
    page, api, _ = files_page
    await page.evaluate("openProfile('ed25519:sonia', 'Sonia')")
    await page.locator(".dialog").get_by_role("button", name="Remove contact").click()
    await expect(page.locator(".toast")).to_contain_text("no longer a contact")
    assert api.contact_changes == [{"key": SONIA, "remove": True}]
    fold = page.locator(".fold-chats")
    await fold.click()
    await expect(page.locator(".personrow")).to_have_count(0)
    await fold.click()
    await expect(page.locator(".personrow")).to_have_count(1)


async def test_the_sidebar_filter_and_the_palette_button(files_page):
    """gui#114: the box filters the sidebar; the palette opens from the small button."""
    page, api, _ = files_page
    await page.locator("nav.side .cmd-btn").click()
    await expect(page.locator("#palette")).to_be_visible()
    await page.keyboard.press("Escape")
    box = page.locator("#sidefilter")
    await box.fill("foto")
    results = page.locator("nav.side .side-results")
    await expect(results.locator(".item")).to_have_count(1)
    await expect(results).to_contain_text("dk.foto.chat")
    await expect(page.locator(".personrow")).to_have_count(0)      # the rest is hidden
    await box.fill("sonia")
    await expect(results).to_contain_text("Sonia")
    await box.press("Escape")
    await expect(page.locator("nav.side .side-results")).to_have_count(0)
    await expect(page.locator(".personrow")).to_have_count(1)
    await box.fill("foto")
    await box.press("Enter")                                        # opens the first
    await expect(page.locator(".ghead h1")).to_contain_text("dk.foto.chat")
