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

    async def handle(self, request):
        if request.path == "/api/settings" and request.method == "GET":
            return web.json_response({"signature": "-- \n{name}"})
        if request.path == "/api/contacts" and request.method == "POST":
            self.contacts.append(await request.json())
            return web.json_response({"error": "that is not a key"}, status=400)
        return await super().handle(request)


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
