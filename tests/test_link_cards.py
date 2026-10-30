"""Link cards (gui#275, UN-RFC 0059): a post's card shown with the icon and the domain
first, compact without a picture, small in a chat, its picture not drawn twice; and in
the compose window a card made for the first link, its title changed, and sent with
the post - or not.

Against answers recorded from a real core (tests/replay.py), with /api/card answered here.
"""
import base64
import io
import json

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from replay import TOKEN, replay_app

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

BT = "https://www.bt.dk/krimi/ansat-i-politiet-snoed-fleggaard-nu-er-han-doemt"


def _icon() -> str:
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), (220, 30, 40)).save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


CARD = {"url": BT, "domain": "bt.dk", "domain_confusable": False, "site": "B.T.",
        "title": "Ansat i politiet snød Fleggaard: Nu er han dømt",
        "desc": "Retten i Sønderborg har idømt en mellemleder i politiet en bødestraf.",
        "icon": _icon(), "image": None, "made": "2026-10-30T12:31:00+00:00"}


@pytest.fixture
async def page():
    asked = []

    @web.middleware
    async def cards(request, handler):
        if request.path == "/api/card":
            asked.append(await request.json())
            return web.json_response({"card": {**CARD, "picture": None, "note": ""}})
        return await handler(request)
    app = replay_app()
    app.middlewares.append(cards)
    async with TestServer(app, host="127.0.0.1") as server, playwright.async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        try:
            await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
            await page.wait_for_selector(".app")
            await page.wait_for_load_state("networkidle")
            page.asked = asked
            yield page
        finally:
            await browser.close()
        assert errors == []


# an entry of the timeline with a card (and, if asked, the card's picture as a file)
WITH_CARD = """async ([card, picture]) => { await openGroup(TIMELINE);
  const m = S.data.messages.find(x => x.depth === 0 && x.readable);
  m.text = 'Så blev han dømt. ' + card.url + '\\nOg https://example.org/anden';
  m.tree = [{ t: 'p', c: [{ t: 'text', v: m.text }] }];
  m.card = card;
  m.attachments = picture ? [{ blob: 'blob1:' + 'a'.repeat(52), type: 'image/jpeg', size: 9000,
                               dim: [600, 315], name: 'card.jpg', alt: '', card: true }] : [];
  if (picture) m.card = { ...card, image: m.attachments[0].blob };
  render(); return m.id; }"""


async def test_a_card_in_a_feed(page):
    mid = await page.evaluate(WITH_CARD, [CARD, False])
    card = page.locator(f'.entry[data-id="{mid}"] .lcard')
    await expect(card).to_have_count(1)
    await expect(card).to_have_class("lcard compact")           # no picture: the icon big
    await expect(card.locator(".cdom")).to_have_text("bt.dk")   # the domain, from the link
    await expect(card.locator(".csite")).to_have_text(" · B.T.")
    await expect(card.locator(".ctitle")).to_have_text(CARD["title"])
    await expect(card.locator(".cfoot")).to_contain_text("Preview from the poster")
    await expect(card.locator("img.cicon")).to_have_attribute("src", "data:image/png;base64," + CARD["icon"])
    await expect(page.locator(f'.entry[data-id="{mid}"] .cmore')).to_have_text("+1 link in the post")


async def test_the_card_picture_is_not_a_file_too(page):
    mid = await page.evaluate(WITH_CARD, [CARD, True])
    entry = page.locator(f'.entry[data-id="{mid}"]')
    await expect(entry.locator(".lcard .cpic")).to_have_count(1)  # in the card
    await expect(entry.locator(".files")).to_have_count(0)        # and nowhere else


async def test_a_look_alike_domain_is_marked(page):
    mid = await page.evaluate(WITH_CARD, [{**CARD, "domain": "bаnk.dk", "domain_confusable": True}, False])
    await expect(page.locator(f'.entry[data-id="{mid}"] .lcard .cdom.odd')).to_have_count(1)


COMPOSE = """() => { window.SENT = null;
  openComposeWindow({ g: null, title: 'Post', subject: 'Dømt', body: '', cursor: 0, private: true,
    send: (...args) => { window.SENT = args; } }); }"""


async def test_a_card_made_while_writing_and_sent(page):
    await page.evaluate(COMPOSE)
    body = page.locator("#body")
    await body.fill(f"Så blev han dømt. {BT}\n> citat https://quoted.example/x")
    box = page.locator(".cardbox .lcard.edit")
    await expect(box.locator(".cdom")).to_have_text("bt.dk", timeout=5000)
    assert page.asked == [{"url": BT}]                           # the first link, not the quote
    await box.locator(".ctitle-in").fill("Min egen overskrift")
    await page.locator("#body").press("Control+s")
    sent = await page.evaluate("() => window.SENT")
    card = sent[7]
    assert card["url"] == BT and card["title"] == "Min egen overskrift" and card["icon"] == CARD["icon"]


async def test_send_without_a_card(page):
    await page.evaluate(COMPOSE)
    await page.locator("#body").fill(f"Se {BT}")
    await expect(page.locator(".cardbox .lcard.edit")).to_have_count(1, timeout=5000)
    await page.get_by_role("button", name="Send without a preview").click()
    await expect(page.locator(".cardbox .lcard")).to_have_count(0)
    await page.locator("#body").fill(f"Se {BT} igen")           # not made again for that link
    await page.wait_for_timeout(1500)
    assert len(page.asked) == 1
    await page.locator("#body").press("Control+s")
    assert (await page.evaluate("() => window.SENT"))[7] is None


async def test_no_card_when_turned_off(page):
    await page.evaluate("() => { S.sidebar.link_cards = false; }")
    await page.evaluate(COMPOSE)
    await page.locator("#body").fill(f"Se {BT}")
    await page.wait_for_timeout(1500)
    assert page.asked == []
    assert json.dumps(await page.evaluate("() => document.querySelectorAll('.cardbox .lcard').length")) == "0"


EDIT = """(card) => { window.SENT = null;
  openComposeWindow({ g: null, title: 'Edit', subject: 'Dømt', body: 'Se ' + card.url, cursor: 0,
    private: true, startCard: card, send: (...args) => { window.SENT = args; } }); }"""


async def test_an_edit_keeps_the_picture(page):
    await page.evaluate(EDIT, {**CARD, "image": "blob1:" + "a" * 52})
    box = page.locator(".cardbox .lcard.edit")
    await expect(box.locator(".cthumb")).to_have_count(1)        # the picture is still there
    await box.locator(".ctitle-in").fill("Ny titel")
    await page.locator("#body").press("Control+s")
    card = (await page.evaluate("() => window.SENT"))[7]
    assert card["title"] == "Ny titel" and card["keep_picture"] is True and not card.get("picture")


async def test_an_edit_without_the_picture(page):
    await page.evaluate(EDIT, {**CARD, "image": "blob1:" + "a" * 52})
    await page.get_by_role("button", name="Without the picture").click()
    await page.locator("#body").press("Control+s")
    card = (await page.evaluate("() => window.SENT"))[7]
    assert card["title"] == CARD["title"] and "keep_picture" not in card


async def test_an_unchanged_edit_leaves_the_card(page):
    await page.evaluate(EDIT, {**CARD, "image": "blob1:" + "a" * 52})
    await page.locator("#body").press("Control+s")
    assert (await page.evaluate("() => window.SENT"))[7] is None   # undefined: the card is kept
