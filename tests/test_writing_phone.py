"""Writing on a phone: the view keeps still, and what you sent is in sight (gui#258).

While you type a comment under an entry in a feed or the timeline, posts that arrive
above it and the phone's keyboard must not move the field away; after sending, your
comment - under its entry, far from the bottom - is scrolled into sight. In a chat you
had scrolled up in, the line you send is brought into sight too.

Against answers recorded from a real core (tests/replay.py), at 390x844.
"""
import pytest
from aiohttp.test_utils import TestServer

from layout_screens import KEYBOARD, PRELUDE
from replay import TOKEN, replay_app

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

W, H = 390, 844


@pytest.fixture
async def page():
    async with TestServer(replay_app(), host="127.0.0.1") as server, playwright.async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": W, "height": H}, is_mobile=True, has_touch=True)
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        try:
            await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
            await page.wait_for_selector(".app")
            await page.wait_for_load_state("networkidle")
            await page.evaluate("() => { " + PRELUDE + " }")
            yield page
        finally:
            await browser.close()
        assert errors == []


async def _top(locator):
    return (await locator.bounding_box())["y"]


# A post arriving at the top of the timeline: a copy of the newest entry, a minute newer.
ARRIVES = """() => { const m = S.data.messages[0], n = { ...m, id: '<new' + Math.random() + '@x>',
  date: m.date, text: 'Something new\\n\\nwith a few lines\\n\\nof text' };
  S.data.messages.unshift(n); render(); }"""


async def _comment_field(page):
    """The timeline open, the cursor in the comment field of its second entry, typing."""
    await page.evaluate("async () => { await openGroup(TIMELINE); }")
    await page.wait_for_timeout(300)
    k = await page.locator("textarea[data-k^='c:']").nth(1).get_attribute("data-k")
    field = page.locator(f'textarea[data-k="{k}"]')       # the same field, whatever comes above it
    await field.scroll_into_view_if_needed()
    await field.focus()
    await field.type("I was just going to say", delay=5)
    return field


async def test_the_field_keeps_still_while_posts_arrive(page):
    field = await _comment_field(page)
    before = await _top(field)
    for _ in range(3):
        await page.evaluate(ARRIVES)
        await page.wait_for_timeout(50)
    assert abs(await _top(field) - before) <= 2
    await expect(field).to_be_focused()
    await expect(field).to_have_value("I was just going to say")


async def test_the_keyboard_does_not_throw_the_field_away(page):
    field = await _comment_field(page)
    # the keyboard comes up: the screen gets lower, the browser keeps the field in sight
    await page.set_viewport_size({"width": W, "height": H - KEYBOARD})
    await field.scroll_into_view_if_needed()
    before = await _top(field)
    await page.evaluate(ARRIVES)
    await page.evaluate("() => render()")
    after = await _top(field)
    assert abs(after - before) <= 2
    assert 0 <= after <= H - KEYBOARD - 20


async def test_your_comment_is_in_sight_after_sending(page):
    field = await _comment_field(page)
    await field.press("Enter")
    sent = page.locator(".comment.pending").filter(has_text="I was just going to say")
    await expect(sent).to_be_in_viewport(ratio=1)      # redrawn as it is sent: retried, not measured once


async def test_a_chat_line_you_send_is_in_sight_when_you_had_scrolled_up(page):
    await page.evaluate("async () => { await openGroup(G('dk.snak.chat')); }")
    await page.wait_for_timeout(300)
    # many lines, and scrolled up to the first
    await page.evaluate("""() => { const m = S.data.messages[0];
      for (let i = 0; i < 40; i++) S.data.messages.push({ ...m, id: '<l' + i + '@x>', text: 'line ' + i });
      render(); document.querySelector('.msgs').scrollTop = 0; }""")
    chat = page.locator("[data-k=chat]")
    await chat.fill("Back to the start")
    await chat.press("Enter")
    sent = page.locator(".mg.mine").filter(has_text="Back to the start")
    await expect(sent).to_be_in_viewport(ratio=1)
