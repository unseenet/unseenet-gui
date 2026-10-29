"""New post is always one tap away on a phone (gui#257), as it is on the desktop.

On a phone the desktop's New post is a round + above the tab bar in threads, channels and
feeds, a + in the head of a chat group (whose bottom is the chat line), and in the
timeline a New post that writes in your own feed - on the desktop too. It is greyed where
you may not post and steps aside while you read a post.

Against answers recorded from a real core (tests/replay.py).
"""
import pytest
from aiohttp.test_utils import TestServer

from layout_screens import PRELUDE
from replay import TOKEN, replay_app

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect


@pytest.fixture
async def page(request):
    width, height = request.param
    phone = width < 760
    async with TestServer(replay_app(), host="127.0.0.1") as server, playwright.async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": width, "height": height}, is_mobile=phone, has_touch=phone)
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


async def _open(page, js):
    await page.evaluate("async () => { await " + js + "; }")
    await page.wait_for_timeout(300)


async def _in_reach(page, button):
    """The button is on screen, at least 40x40, and tapping it opens the compose window."""
    await expect(button).to_be_visible()
    box = await button.bounding_box()
    vw, vh = page.viewport_size["width"], page.viewport_size["height"]
    assert box["width"] >= 40 and box["height"] >= 40
    assert 0 <= box["x"] and box["x"] + box["width"] <= vw and 0 <= box["y"] and box["y"] + box["height"] <= vh
    await button.click()
    dialog = page.get_by_role("dialog")
    await expect(dialog).to_be_visible()
    return await dialog.get_attribute("aria-label")


@pytest.mark.parametrize("page", [(390, 844), (360, 740)], indirect=True)
@pytest.mark.parametrize("group", ["unseenet", "dev.news"])
async def test_a_round_plus_above_the_tab_bar(page, group):
    await _open(page, f"openGroup(G('{group}'))")
    plus = page.locator("[data-k=newpost]")
    label = await _in_reach(page, plus)
    assert label.startswith("New post in " + group)
    # bottom right, above the tab bar, within reach of the thumb
    box, bar = await plus.bounding_box(), await page.locator(".tabbar").bounding_box()
    assert box["y"] + box["height"] <= bar["y"]
    assert box["x"] > page.viewport_size["width"] / 2


@pytest.mark.parametrize("page", [(390, 844)], indirect=True)
async def test_a_plus_in_the_head_of_a_chat_group(page):
    await _open(page, "openGroup(G('dk.snak.chat'))")
    plus = page.locator(".ghead [data-k=newpost]")
    assert (await _in_reach(page, plus)).startswith("New post in dk.snak.chat")


@pytest.mark.parametrize("page", [(390, 844), (1280, 800)], indirect=True)
async def test_the_timeline_writes_in_your_feed(page):
    # no feed of your own: nothing to write in from the timeline
    await page.evaluate("() => { S.sidebar.my_feed = { started: false }; }")
    await _open(page, "openGroup(TIMELINE)")
    await expect(page.locator("[data-k=newpost]")).to_have_count(0)
    # with one (here the playground's channel stands in for it), New post writes there
    await page.evaluate("() => { S.sidebar.my_feed = { id: G('dev.news'), started: true }; }")
    await _open(page, "openGroup(TIMELINE)")
    assert (await _in_reach(page, page.locator("[data-k=newpost]"))).startswith("New post in dev.news")


@pytest.mark.parametrize("page", [(390, 844)], indirect=True)
async def test_greyed_where_you_may_not_post(page):
    await _open(page, "openGroup(G('unseenet'))")
    await page.evaluate("""() => { S.data.write = { post: { allowed: false, reason: 'Only the owner posts here.',
      code: 'other' } }; render(); }""")
    plus = page.locator("[data-k=newpost]")
    await expect(plus).to_be_visible()
    assert "off" in (await plus.get_attribute("class")).split()
    await plus.click(force=True)                     # greyed (aria-disabled), but a tap says why
    await expect(page.get_by_role("dialog")).to_have_count(0)
    await expect(page.locator(".toast")).to_contain_text("Only the owner posts here.")


@pytest.mark.parametrize("page", [(390, 844)], indirect=True)
async def test_steps_aside_while_you_read(page):
    await _open(page, "openGroup(G('unseenet'))")
    await page.locator(".prow:not(.head)").first.click()
    await page.wait_for_timeout(300)
    await expect(page.locator("[data-k=newpost]")).to_be_hidden()


@pytest.mark.parametrize("page", [(1280, 800)], indirect=True)
async def test_the_desktop_keeps_its_button(page):
    await _open(page, "openGroup(G('unseenet'))")
    plus = page.locator(".ghead [data-k=newpost]")
    await expect(plus).to_contain_text("New post")
    box = await plus.bounding_box()
    assert box["y"] < 100                            # in the head, not floating
