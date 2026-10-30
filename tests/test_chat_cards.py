"""A link card on a chat line (UN-RFC 0059): made while the line is written, shown above
the input as the small line it will be in the chat, sent with the line without a
picture - or left out with its ✕, or not made when link previews are off.

The chat group fixture of test_emoji.py, with /api/card answered here.
"""
import pytest
from aiohttp.test_utils import TestServer
from aiohttp import web

from test_emoji import API, TOKEN, page_with

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

BT = "https://www.bt.dk/krimi/ansat-i-politiet-snoed-fleggaard-nu-er-han-doemt"
CARD = {"url": BT, "domain": "bt.dk", "domain_confusable": False, "site": "B.T.",
        "title": "Ansat i politiet snød Fleggaard: Nu er han dømt", "desc": "Retten i Sønderborg ...",
        "icon": None, "made": "2026-10-30T12:31:00+00:00", "note": "",
        "picture": {"type": "image/jpeg", "data": "AAAA", "size": 3, "dim": [600, 315]}}


class CardAPI(API):
    def __init__(self, cards=True):
        super().__init__()
        self.asked = []
        self.cards = cards

    async def handle(self, request):
        if request.path == "/api/card":
            self.asked.append(await request.json())
            return web.json_response({"card": CARD})
        if request.path == "/api/settings":
            return web.json_response({"signature_preview": "", "notices": {"send": True},
                                      "link_cards": self.cards})
        return await super().handle(request)


@pytest.fixture
async def chat(request):
    api = CardAPI(cards=getattr(request, "param", True))
    async with TestServer(await page_with(api), host="127.0.0.1") as server, playwright.async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
            await page.wait_for_load_state("networkidle")
            await page.get_by_role("button", name="alt.chat").first.click()
            await expect(page.locator("#chat")).to_be_visible()
            if not api.cards:
                await page.evaluate("() => { S.sidebar.link_cards = false; }")
            yield page, api
        finally:
            await browser.close()
        assert errors == []


async def test_a_chat_line_with_a_card(chat):
    page, api = chat
    await page.locator("#chat").press_sequentially(f"Se lige {BT} ")
    card = page.locator(".chatbar .chatcard .lcard.in-chat")
    await expect(card.locator(".cdom")).to_have_text("bt.dk", timeout=5000)
    await expect(card.locator(".ctitle")).to_have_text(CARD["title"])
    await expect(page.locator("#chat")).to_be_focused()          # writing goes on
    await page.locator("#chat").press("Enter")
    await expect(page.locator(".chatbar .chatcard")).to_have_count(0)
    sent = api.posts[-1]
    assert sent["card"]["url"] == BT and sent["card"]["title"] == CARD["title"]
    assert "picture" not in sent["card"]                         # small in a chat: no picture
    assert api.asked == [{"url": BT}]


async def test_a_chat_line_without_the_card(chat):
    page, api = chat
    await page.locator("#chat").fill(f"Se lige {BT}")
    await expect(page.locator(".chatbar .chatcard .lcard")).to_have_count(1, timeout=5000)
    await page.get_by_role("button", name="Send without a preview").click()
    await expect(page.locator(".chatbar .chatcard")).to_have_count(0)
    await page.locator("#chat").press("Enter")
    assert "card" not in api.posts[-1]


@pytest.mark.parametrize("chat", [False], indirect=True)
async def test_no_chat_card_when_turned_off(chat):
    page, api = chat
    await page.locator("#chat").fill(f"Se lige {BT}")
    await page.wait_for_timeout(1500)
    assert api.asked == []
    await page.locator("#chat").press("Enter")
    assert "card" not in api.posts[-1]
