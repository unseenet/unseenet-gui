"""Every screen and dialog fits, at every size (gui#264).

Phones (360x740, 390x844, touch), a small laptop (1024x640), a desktop (1280x800) and a
wide screen (1920x1080), light and dark. On each, every screen and every dialog in
tests/layout_screens.py is opened, and tests/layout_check.js asserts:

- nothing is wider than the screen, and the page never scrolls sideways;
- a dialog is fully on screen, with its ✕ and its own primary button in sight - also on a
  phone with the keyboard up (the screen 300 px lower while a field has the cursor);
- headings and buttons are not cut off (unless they are meant to end in …);
- on phones, what you tap is at least 40x40 - a link that reads as text (a name in a post's
  head, "… more") at least 24 high, as WCAG 2.5.8 asks;
- nothing goes to the console as an error.

The page talks to recorded answers of a real core (tests/data/layout_api.json), recorded
from the playground with tools/layout_audit.py - record them again when screens ask for
something new. SHOTS=dir saves a screenshot of every screen, size and theme, for
tools/gallery.py to lay side by side.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_layout.py
"""
import json
import os
from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from layout_screens import CHECK, DIALOGS, FOCUS_FIELD, KEYBOARD, RESET, SIZES, VIEWS, script
from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")

ANSWERS = json.loads((Path(__file__).parent / "data" / "layout_api.json").read_text())


async def _replay(request):
    """The recorded answer to this request (an error as the error it was), else to its path
    without the query; a GET nobody recorded is not found, anything else just done ({})."""
    for key in (f"{request.method} {request.path_qs}", f"{request.method} {request.path}"):
        if key in ANSWERS:
            a = ANSWERS[key]
            if isinstance(a, dict) and "__status" in a:
                return web.json_response(a["body"], status=a["__status"])
            return web.json_response(a)
    if request.method == "GET":
        return web.json_response({"error": "not recorded: " + request.path_qs}, status=404)
    return web.json_response({})


async def _events(request):
    ws = web.WebSocketResponse(protocols=["unseenet"])
    await ws.prepare(request)
    async for _ in ws:
        pass
    return ws


def _app():
    app = web.Application()

    async def index(_request):
        return web.FileResponse(STATIC / "index.html")

    app.router.add_get("/", index)
    app.router.add_static("/static/", STATIC)
    app.router.add_get("/api/events", _events)
    app.router.add_route("*", "/api/{path:.*}", _replay)
    app.router.add_route("*", "/x/gui/{path:.*}", _replay)
    return app


CASES = [(size, scheme) for size in SIZES for scheme in ("dark", "light")]


@pytest.mark.parametrize("size,scheme", CASES, ids=[f"{s}-{t}" for s, t in CASES])
async def test_every_screen_and_dialog_fits(size, scheme):
    width, height, mobile = SIZES[size]
    shots = Path(os.environ["SHOTS"]) if os.environ.get("SHOTS") else None
    problems = []
    async with TestServer(_app(), host="127.0.0.1") as server, playwright.async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": width, "height": height}, is_mobile=mobile,
                                        has_touch=mobile, color_scheme=scheme)
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        try:
            await page.goto(str(server.make_url("/")) + "#t=" + "t" * 43)
            await page.wait_for_selector(".app", timeout=15000)
            await page.wait_for_load_state("networkidle")
            for kind, items in (("view", VIEWS), ("dialog", DIALOGS)):
                for name, js in items.items():
                    await page.evaluate(RESET)
                    errors.clear()
                    await page.evaluate(script(js))
                    await page.wait_for_timeout(250)
                    found = await page.evaluate(CHECK, {"phone": mobile, "dialog": kind == "dialog"})
                    if shots:
                        shots.mkdir(parents=True, exist_ok=True)
                        await page.screenshot(path=str(shots / f"{name}__{size}__{scheme}.png"))
                    if kind == "dialog" and mobile and await page.evaluate(FOCUS_FIELD):
                        await page.set_viewport_size({"width": width, "height": height - KEYBOARD})
                        await page.wait_for_timeout(150)
                        found += ["keyboard up: " + f for f in
                                  await page.evaluate(CHECK, {"phone": True, "dialog": True})]
                        await page.set_viewport_size({"width": width, "height": height})
                    found += ["console: " + e for e in errors]
                    problems += [f"{kind} {name}: {f}" for f in found]
        finally:
            await browser.close()
    assert problems == [], f"{len(problems)} problems at {size} {scheme}:\n  " + "\n  ".join(problems)
