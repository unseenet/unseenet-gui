"""The page against answers recorded from a real core (gui#264), for tests that look at screens.

tests/data/layout_api.json holds what the playground's core answered (tools/layout_audit.py
records it): the page meets the same groups, posts and dialogs as against a node, without one.
"""
import json
from pathlib import Path

from aiohttp import web

from unseenet_gui.server import STATIC

ANSWERS = json.loads((Path(__file__).parent / "data" / "layout_api.json").read_text())
TOKEN = "t" * 43


async def _replay(request):
    """The recorded answer to this request (an error as the error it was), else to its path
    without the query; a GET nobody recorded is not found, anything else just done ({})."""
    # what the page asks for that was not asked when the answers were recorded (preview=,
    # gui#269) does not change which answer it is
    qs = "&".join(p for p in request.query_string.split("&") if p and not p.startswith("preview="))
    raw = request.rel_url.raw_path                      # as recorded: %3A, not ":"
    for key in (f"{request.method} {request.path_qs}", f"{request.method} {raw}?{qs}",
                f"{request.method} {request.path}"):
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


def replay_app() -> web.Application:
    """The page's files and the recorded API, as the local GUI serves them."""
    app = web.Application()

    async def index(_request):
        return web.FileResponse(STATIC / "index.html")

    app.router.add_get("/", index)
    app.router.add_static("/static/", STATIC)
    app.router.add_get("/api/events", _events)
    app.router.add_route("*", "/api/{path:.*}", _replay)
    app.router.add_route("*", "/x/gui/{path:.*}", _replay)
    return app
