"""Long entries and comments in a feed are cut by the core's one rule (gui#269,
unseenet#781): the page asks for it (?preview=ENTRY,COMMENT,WIDTH), shows the start the
core gives with "… more", opens it in place and keeps it open, and Alt+R puts a read-more
line in a comment as in a post.

Against answers recorded from a real core (tests/replay.py), with a preview put on rows.
"""
import pytest
from aiohttp.test_utils import TestServer

from replay import TOKEN, replay_app

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect


@pytest.fixture
async def page():
    asked = []
    app = replay_app()
    app.middlewares.append(_remember(asked))
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


def _remember(asked):
    from aiohttp import web

    @web.middleware
    async def mw(request, handler):
        asked.append(request.path_qs)
        return await handler(request)
    return mw


# the timeline, with a long entry and a long comment cut as the core would cut them
CUT = """async () => { await openGroup(TIMELINE);
  const entry = S.data.messages.find(m => m.depth === 0 && m.readable);
  const comment = S.data.messages.find(m => m.depth > 0 && m.readable);
  entry.text = 'First sentence of a long entry. ' + 'More words follow here. '.repeat(40);
  entry.tree = [{ t: 'p', c: [{ t: 'text', v: entry.text }] }];
  entry.preview = { text: 'First sentence of a long entry.', cut: true, read_more: false,
                    tree: [{ t: 'p', c: [{ t: 'text', v: 'First sentence of a long entry.' }] }] };
  comment.text = 'Someone wrote:\\n> an old quote\\n\\nMy own words, ' + 'and on and on. '.repeat(30);
  comment.tree = [{ t: 'p', c: [{ t: 'text', v: comment.text }] }];
  comment.preview = { text: 'My own words, and on and on.', cut: true, read_more: false,
                      tree: [{ t: 'p', c: [{ t: 'text', v: 'My own words, and on and on.' }] }] };
  render(); return [entry.id, comment.id]; }"""


async def test_the_feed_asks_for_the_core_cut(page):
    await page.evaluate("async () => { await openGroup(TIMELINE); }")
    asked = [q for q in page.asked if q.startswith("/api/groups/timeline")]
    assert asked and "preview=10,3," in asked[-1]           # 1280 wide: ten lines, a comment three


async def test_an_entry_and_a_comment_cut_and_opened_in_place(page):
    entry, comment = await page.evaluate(CUT)
    e = page.locator(f'.entry[data-id="{entry}"] .ebody')
    await expect(e.locator(".etext")).to_have_text("First sentence of a long entry.")
    await e.get_by_role("button", name="… more").click()
    await expect(e.locator(".etext")).to_contain_text("More words follow here.")
    await expect(e.get_by_role("button", name="Show less")).to_be_visible()
    await page.evaluate("() => render()")                   # kept open across redraws
    await expect(e.get_by_role("button", name="Show less")).to_be_visible()

    c = page.locator(f'.comment[data-id="{comment}"] .ctext')
    await expect(c).to_contain_text("My own words, and on and on.")
    await expect(c).not_to_contain_text("an old quote")      # its own words first
    await c.get_by_role("button", name="… more").click()
    await expect(c).to_contain_text("an old quote")          # opened: the whole, quote included
    await c.get_by_role("button", name="Show less").click()
    await expect(c).not_to_contain_text("an old quote")


async def test_not_cut_means_no_more(page):
    entry, _ = await page.evaluate(CUT)
    await page.evaluate("id => { const m = S.data.messages.find(x => x.id === id); m.preview.cut = false; render(); }", entry)
    await expect(page.locator(f'.entry[data-id="{entry}"] .ebody > .emore')).to_have_count(0)


async def test_alt_r_puts_a_read_more_line_in_a_comment(page):
    await page.evaluate("async () => { await openGroup(TIMELINE); }")
    field = page.locator("textarea[data-k^='c:']").first
    await field.fill("A first part")
    await field.press("Alt+r")
    await field.type("the rest")
    assert await field.input_value() == "A first part\n\n...\n\nthe rest"


async def test_a_long_note_is_cut_too(page):
    entry, _ = await page.evaluate(CUT)
    await page.evaluate("id => { const m = S.data.messages.find(x => x.id === id); m.kind = 'chat'; render(); }", entry)
    e = page.locator(f'.entry[data-id="{entry}"] .ebody')
    await expect(e.locator(".etext")).to_have_text("First sentence of a long entry.")
    await e.get_by_role("button", name="… more").click()
    await expect(e.locator(".etext")).to_contain_text("More words follow here.")
