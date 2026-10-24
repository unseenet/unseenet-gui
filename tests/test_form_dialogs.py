"""Form dialogs are kept on screen while the page redraws (#85), like the compose window
(#47): a resized text area, what you typed, the focus and undo survive server events.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_form_dialogs.py
"""

import pytest
from aiohttp import web

import test_compose
from test_compose import GROUP, LocalAPI, compose_page, expect  # noqa: F401 (fixture)


class FormAPI(LocalAPI):
    """The compose fixture's API, plus what the signature and contact dialogs ask."""

    def __init__(self):
        super().__init__()
        self.contacts = []
        self.profile_posts = []          # (path, body) in the order they came

    async def handle(self, request):
        path = request.path
        if path == "/api/settings" and request.method == "GET":
            return web.json_response({"signature": "-- \n{name}"})
        if path == "/api/contacts" and request.method == "POST":
            self.contacts.append(await request.json())
            return web.json_response({"error": "that is not a key"}, status=400)
        if path == "/api/profile" and request.method == "GET":
            return web.json_response({
                "key": "ed25519:me", "published": True, "picture": None,
                "picture_warning": "A picture can make you easier to find.",
                "profile": {"about": "Hello", "about_type": "text/markdown", "lang": ["da"], "links": []},
                "link_kinds": ["web", "github"]})
        if path == "/api/profile" and request.method == "POST":
            self.profile_posts.append((path, await request.json()))
            return web.json_response({})
        if path == "/api/profile/picture":
            body = await request.json()
            if body.get("preview"):
                return web.json_response({"picture": {"data": PIXEL, "alt": body.get("alt", "")}})
            self.profile_posts.append((path, body))
            return web.json_response({})
        return await super().handle(request)


PIXEL = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4"
         "nGNgYPj/HwADAgH/Pk9b2QAAAABJRU5ErkJggg==")


@pytest.fixture
def form_api(monkeypatch):
    """Before compose_page starts: its local API also answers these dialogs."""
    monkeypatch.setattr(test_compose, "LocalAPI", FormAPI)


@pytest.fixture
async def form_page(form_api, compose_page):
    return compose_page


async def run_command(page, name):
    await page.keyboard.press("ControlOrMeta+p")
    await page.locator("#palette").fill(name)
    await page.keyboard.press("Enter")


async def test_a_resized_text_area_and_its_text_survive_redraws(form_page):
    page, api = form_page
    await run_command(page, "Edit your signature")
    field = page.locator("#sig")
    await expect(field).to_be_visible()
    await expect(field).to_have_value("-- \n{name}")
    await field.evaluate("el => { el.style.height = '300px'; }")     # the user drags it bigger
    await field.press("End")
    await field.press_sequentially(" - written here")
    kept = await field.element_handle()

    await api.emit(event="status", text="Connected: while signing")
    await expect(page.locator(".statusbar")).to_contain_text("while signing")
    await api.emit(event="group-updated", group_id=GROUP, new=True)

    assert await kept.evaluate("el => el.isConnected")              # the same element, not a copy
    assert await field.evaluate("el => el.style.height") == "300px"
    await expect(field).to_have_value("-- \n{name} - written here")
    await expect(field).to_be_focused()
    await field.press("ControlOrMeta+z")                            # undo still knows the typing
    assert "written here" not in await field.input_value()


async def test_an_error_is_shown_in_the_same_dialog(form_page):
    page, api = form_page
    await run_command(page, "Add a contact")
    key = page.locator("#ckey")
    await expect(key).to_be_visible()
    await key.fill("ed25519:nope")
    await page.locator("#cname").fill("Somebody")
    kept = await key.element_handle()
    await page.get_by_role("button", name="Save", exact=True).click()
    await expect(page.locator(".dialog .error")).to_have_text("that is not a key")
    assert await kept.evaluate("el => el.isConnected")
    await expect(key).to_have_value("ed25519:nope")
    await expect(page.locator("#cname")).to_have_value("Somebody")
    assert api.contacts == [{"key": "ed25519:nope", "name": "Somebody"}]
    await api.emit(event="status", text="Connected: after the error")
    await expect(page.locator(".statusbar")).to_contain_text("after the error")
    await expect(page.locator(".dialog .error")).to_have_text("that is not a key")


# --- your picture in your profile (#82), and your own picture opens it (#83) -------------

async def test_your_own_picture_opens_your_profile(form_page):
    page, _api = form_page
    await page.locator(".me").get_by_role("button", name="Your profile").first.click()
    await expect(page.locator("#pabout")).to_have_value("Hello")
    await page.get_by_role("button", name="Cancel").click()
    await page.locator(".me .me-name").click()
    await expect(page.locator("#pabout")).to_be_visible()


async def test_a_picture_is_chosen_and_published_with_the_profile(form_page, tmp_path):
    page, api = form_page
    await run_command(page, "Your profile")
    about = page.locator("#pabout")
    await expect(about).to_have_value("Hello")
    await about.fill("Hello, written before the picture")
    png = tmp_path / "me.png"
    png.write_bytes(bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
                                  "890000000d4944415478da6360f8ffbf1e00050201fe4f2b4d850000000049454e44ae426082"))
    await page.locator("#picfile").set_input_files(str(png))
    await expect(page.locator(".dialog img.av.big")).to_have_attribute("src", PIXEL)
    await expect(page.locator(".dialog")).to_contain_text("exactly as it will be published")
    await expect(page.locator(".dialog")).to_contain_text("easier to find")     # the first picture's warning
    await expect(about).to_have_value("Hello, written before the picture")      # kept across refresh()
    await page.locator("#picalt").fill("Me at the sea")
    await page.get_by_role("button", name="Publish", exact=True).click()
    await expect(page.locator(".toast")).to_contain_text("profile and picture are published")
    assert [p for p, _ in api.profile_posts] == ["/api/profile", "/api/profile/picture"]
    assert api.profile_posts[0][1]["edit"]["about"] == "Hello, written before the picture"
    picture = api.profile_posts[1][1]
    assert picture["alt"] == "Me at the sea" and picture["data"]
