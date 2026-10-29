"""After a copy, the copied key's ripening shows - not the vault's first key's (gui#262).

A new vault's own key had begun to ripen; a segment of it finished right after a key at
level 2 was copied in, and its event set *0%* over *level 2, on its way to 3*. Only events
for the key in use count, and the state of another key is not mixed with the new one's.
"""
import pytest
from aiohttp.test_utils import TestServer

from replay import TOKEN, replay_app

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

L2, L3 = 2 ** 31, 2 ** 34        # level 2 and 3 thresholds (core.ripening.LEVELS), as the GUI's RIPE_STEP


@pytest.fixture
async def page():
    async with TestServer(replay_app(), host="127.0.0.1") as server, playwright.async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        try:
            await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
            await page.wait_for_selector(".app")
            await page.wait_for_load_state("networkidle")
            yield page
        finally:
            await browser.close()
        assert errors == []


async def _event(page, **e):
    await page.evaluate("e => S.ws.onmessage({ data: JSON.stringify(e) })", {"event": "ripening", **e})
    await page.wait_for_timeout(100)


async def test_another_keys_ripening_does_not_show(page):
    me = await page.evaluate("() => S.state.me.key")
    half = L2 + (L3 - L2) // 2
    await _event(page, key=me, t=half, level=2, next_at=L3)
    line = page.locator("nav.side .ripe")
    await expect(line).to_have_text("Key level 2 · ripening")
    # the vault's first key, a fresh one, finishes a segment: not yours
    await _event(page, key="ed25519:" + "a" * 52, t=40_000, level=None, next_at=2 ** 25)
    await expect(line).to_have_text("Key level 2 · ripening")
    assert await page.evaluate("() => Math.round(100 * ripeFraction(S.ripening))") == 50
    # your own key goes on as before
    await _event(page, key=me, t=L3, level=3, next_at=2 ** 37)
    await expect(line).to_have_text("Key level 3")


async def test_a_new_key_starts_from_its_own_state(page):
    await page.evaluate("() => { ripeSamples = [[1, 1], [2, 2]]; S.ripening = { level: null, t: 5 }; }")
    # the core now answers for another key (a copy made it the one in use)
    await page.evaluate("""async () => { const st = JSON.parse(JSON.stringify(S.state));
      st.identity = { key: 'ed25519:' + 'b'.repeat(52), display: 'Copied', label: 'Copied' };
      st.ripening = { level: 2, t: 2 ** 31 + 2 ** 32, next_at: 2 ** 34 };
      await loadState(st); }""")
    assert await page.evaluate("() => ripeSamples.length") == 0
    assert await page.evaluate("() => [S.ripening.level, Math.round(100 * ripeFraction(S.ripening))]") == [2, 29]
