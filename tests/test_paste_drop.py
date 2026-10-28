"""gui#187: pictures and files pasted or dropped where "Add pictures or files" is - the
button's way, under neutral names, and never a picture fetched from a web page."""

import base64
import re

import pytest

from test_files_choice import PNG, files_page  # noqa: F401  - the fixture

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

B64 = base64.b64encode(PNG).decode()

# A paste, a dragover and a drop with a file, as the browser sends them.
SEND = """([selector, kind, name, type, b64]) => {
  const el = document.querySelector(selector);
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], name, { type }));
  if (kind === "paste")
    return el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  return el.dispatchEvent(new DragEvent(kind, { dataTransfer: dt, bubbles: true, cancelable: true }));
}"""

LINK = """([selector]) => {
  const dt = new DataTransfer();
  dt.setData("text/uri-list", "https://example.com/a.png");
  dt.setData("text/html", '<img src="https://example.com/a.png">');
  return document.querySelector(selector).dispatchEvent(
    new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
}"""


async def test_paste_a_screenshot_on_a_chat_line(files_page):  # noqa: F811
    page, api, _ = files_page
    await page.get_by_role("button", name=re.compile("dk.foto.chat")).first.click()
    await expect(page.locator('[data-k="chat"]')).to_be_visible()
    await page.evaluate(SEND, ['[data-k="chat"]', "paste", "IMG_20261027_1234.png", "image/png", B64])
    chip = page.locator(".chatfiles")
    await expect(chip).to_contain_text(re.compile(r"image-\d+\.png"))
    await expect(chip).not_to_contain_text("IMG_")                    # the name is not sent
    await page.locator('[data-k="chat"]').fill("Se her")
    await page.keyboard.press("Enter")
    _, body = api.sent[-1]
    assert re.fullmatch(r"image-\d+\.png", body["files"][0]["name"])
    assert base64.b64decode(body["files"][0]["data"]) == PNG


async def test_only_what_the_button_takes(files_page):  # noqa: F811
    page, _, _ = files_page
    await page.get_by_role("button", name=re.compile("dk.foto.chat")).first.click()
    await expect(page.locator('[data-k="chat"]')).to_be_visible()
    await page.evaluate(SEND, ['[data-k="chat"]', "drop", "notes.pdf", "application/pdf", B64])
    await expect(page.locator(".toast")).to_contain_text("cannot be added here")    # pictures only
    await expect(page.locator(".chatfiles")).to_have_count(0)
    await page.evaluate(LINK, ['[data-k="chat"]'])                    # a picture on a web page
    await expect(page.locator(".toast")).to_contain_text("save the picture first")
    await expect(page.locator('[data-k="chat"]')).to_have_value("")   # not typed in as a link


async def test_drop_on_the_composer(files_page):  # noqa: F811
    page, _, _ = files_page
    await page.evaluate("openWrite('ed25519:someone', 'post')")
    await expect(page.locator("#body")).to_be_visible()
    await page.evaluate(SEND, ["#body", "dragover", "passport.png", "image/png", B64])
    win = page.locator(".dialog.compose-win")
    await expect(win).to_have_class(re.compile(r"\bdropping\b"))     # the drop zone
    await expect(win).to_have_attribute("data-droptext", "Drop to add")
    await page.evaluate(SEND, ["#body", "drop", "passport.png", "image/png", B64])
    await expect(win).not_to_have_class(re.compile(r"\bdropping\b"))
    await expect(page.locator(".picklist .fname")).to_have_text(re.compile(r"image-\d+\.png"))
    await page.evaluate(SEND, ["#body", "paste", "x.png", "image/png", B64])   # several
    await expect(page.locator(".picklist .fname")).to_have_count(2)
