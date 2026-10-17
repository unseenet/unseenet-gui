"""A local web server for one person: the browser talks to it, it talks to Tor.

Security model (see README, "Security"):

- It listens on 127.0.0.1 only, on a random port.
- Every API call carries a random token that only the window we open knows.
  Other programs on the computer, and web pages in your browser, do not.
- The Host header must be our own address (stops DNS rebinding) and an Origin
  header, when sent, must be our own origin (stops other pages calling us).
- The page may load nothing from outside (Content-Security-Policy), so a post
  can never make the browser fetch something past Tor.
- Your keys never reach the browser: signing, encryption and postage happen
  here, in the unseenet core. The page only sees what you would see on screen.
"""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import json
import secrets
from importlib import resources
from pathlib import Path

from aiohttp import WSMsgType, web

from unseenet.client.session import SessionError

from .runtime import NETWORK_ERRORS, Runtime

TOKEN_PROTOCOL = "unseenet-token."
CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
       "connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; "
       "frame-ancestors 'none'")
STATIC = resources.files("unseenet_web") / "static"


def _json(data, status: int = 200) -> web.Response:
    return web.json_response(data, status=status, dumps=lambda o: json.dumps(o, ensure_ascii=False))


def _error(text: str, status: int = 400) -> web.Response:
    return _json({"error": text}, status)


@web.middleware
async def guard(request: web.Request, handler):
    app = request.app
    port = app["conf"]["port"]
    allowed = {f"127.0.0.1:{port}", f"localhost:{port}"}
    if request.host not in allowed:
        return web.Response(status=421, text="wrong host")
    origin = request.headers.get("Origin")
    if origin is not None and origin not in {f"http://{h}" for h in allowed}:
        return web.Response(status=403, text="wrong origin")
    if request.path.startswith("/api/"):
        if request.path == "/api/events":
            offered = request.headers.get("Sec-WebSocket-Protocol", "")
            token = next((p.strip()[len(TOKEN_PROTOCOL):] for p in offered.split(",")
                          if p.strip().startswith(TOKEN_PROTOCOL)), "")
        else:
            token = request.headers.get("X-Unseenet-Token", "")
        if not hmac.compare_digest(token, app["token"]):
            return web.Response(status=401, text="no token")
    try:
        response = await handler(request)
    except web.HTTPException as exc:
        response = web.Response(status=exc.status, text=exc.text)
    except SessionError as exc:
        response = _error(str(exc))
    except NETWORK_ERRORS as exc:
        response = _error(f"network: {exc}", 502)
    response.headers["Content-Security-Policy"] = CSP
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    return response


def _rt(request: web.Request) -> Runtime:
    return request.app["runtime"]


def _unlocked(request: web.Request) -> Runtime:
    rt = _rt(request)
    if rt.session is None:
        raise web.HTTPConflict(text="locked")
    return rt


async def _body(request: web.Request) -> dict:
    try:
        data = await request.json()
    except (ValueError, UnicodeDecodeError):
        raise web.HTTPBadRequest(text="expected JSON")
    if not isinstance(data, dict):
        raise web.HTTPBadRequest(text="expected an object")
    return data


# --- pages ----------------------------------------------------------------

async def index(request: web.Request) -> web.Response:
    return web.Response(body=(STATIC / "index.html").read_bytes(), content_type="text/html",
                        charset="utf-8")


async def static(request: web.Request) -> web.Response:
    name = request.match_info["name"]
    types = {".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml"}
    ext = Path(name).suffix
    if "/" in name or name.startswith(".") or ext not in types:
        raise web.HTTPNotFound()
    f = STATIC / name
    if not f.is_file():
        raise web.HTTPNotFound()
    return web.Response(body=f.read_bytes(), content_type=types[ext], charset="utf-8")


# --- API --------------------------------------------------------------------

async def state(request):
    return _json(_rt(request).state())


async def unlock(request):
    data = await _body(request)
    rt = _rt(request)
    if rt.session is None:
        await rt.unlock(str(data.get("passphrase", "")))
    return _json(rt.state())


async def setup(request):
    rt = _unlocked(request)
    data = await _body(request)
    display, node = str(data.get("display", "")).strip(), str(data.get("node", "")).strip()
    if rt.needs_setup():
        if not rt.session.has_identity() and not display:
            return _error("choose a name")
        if not rt.session.node and not node:
            return _error("choose a node")
        await rt.setup(display, node)
    return _json(rt.state())


async def known_nodes(request):
    rt = _unlocked(request)
    return _json([{"address": n.address, "name": n.name, "description": n.description,
                   "operator": n.operator} for n in rt.session.known_nodes()])


async def groups(request):
    return _json(_unlocked(request).groups())


async def messages(request):
    return _json(_unlocked(request).messages(request.match_info["gid"]))


async def read(request):
    rt = _unlocked(request)
    data = await _body(request)
    ids = [str(i) for i in data.get("ids", [])][:500]
    rt.mark_read(request.match_info["gid"], ids)
    return _json({"ok": True})


async def view(request):
    rt = _unlocked(request)
    data = await _body(request)
    mode = data.get("view")
    if mode not in ("threads", "chat"):
        return _error("view is threads or chat")
    rt.set_view(request.match_info["gid"], mode)
    return _json({"ok": True})


async def post(request):
    rt = _unlocked(request)
    data = await _body(request)
    gid = request.match_info["gid"]
    body = str(data.get("body", "")).strip("\n")
    subject = str(data.get("subject", "")).strip()
    chat = bool(data.get("chat"))
    if not body.strip():
        return _error("nothing to send")
    if not chat and not subject:
        return _error("a post needs a subject")
    refs = [str(r) for r in data.get("references", [])][:50]
    job = rt.post(gid, subject, body, refs, chat=chat)
    return _json({"job": job})


async def browse(request):
    return _json(await _unlocked(request).browse())


async def subscribe(request):
    rt = _unlocked(request)
    data = await _body(request)
    rt.subscribe(str(data.get("id", "")), bool(data.get("on", True)))
    return _json({"ok": True})


async def refresh(request):
    rt = _unlocked(request)
    rt.spawn(rt.refresh())
    return _json({"ok": True})


async def events(request):
    rt = _rt(request)
    offered = [p.strip() for p in request.headers.get("Sec-WebSocket-Protocol", "").split(",")]
    ws = web.WebSocketResponse(protocols=[p for p in offered if p == "unseenet"], heartbeat=30)
    await ws.prepare(request)
    q = rt.listen()

    async def pump():
        while True:
            await ws.send_str(json.dumps(await q.get(), ensure_ascii=False))

    sender = asyncio.create_task(pump())
    try:
        async for msg in ws:
            if msg.type in (WSMsgType.ERROR, WSMsgType.CLOSE):
                break
    finally:
        sender.cancel()
        rt.unlisten(q)
    return ws


def make_app(runtime: Runtime, token: str) -> web.Application:
    app = web.Application(middlewares=[guard], client_max_size=256 * 1024)
    app["runtime"], app["token"] = runtime, token
    app["conf"] = {"port": 0}          # set once the socket is bound
    r = app.router
    r.add_get("/", index)
    r.add_get("/static/{name}", static)
    r.add_get("/api/state", state)
    r.add_post("/api/unlock", unlock)
    r.add_post("/api/setup", setup)
    r.add_get("/api/known-nodes", known_nodes)
    r.add_get("/api/groups", groups)
    r.add_get("/api/groups/{gid}", messages)
    r.add_post("/api/groups/{gid}/read", read)
    r.add_post("/api/groups/{gid}/view", view)
    r.add_post("/api/groups/{gid}/post", post)
    r.add_get("/api/browse", browse)
    r.add_post("/api/subscribe", subscribe)
    r.add_post("/api/refresh", refresh)
    r.add_get("/api/events", events)

    async def closing(app):
        await runtime.close()
    app.on_shutdown.append(closing)
    return app


async def serve(vault: Path, port: int = 0, on_ready=None) -> None:
    token = secrets.token_urlsafe(32)
    runtime = Runtime(vault)
    app = make_app(runtime, token)
    runner = web.AppRunner(app, access_log=None)      # nothing about what you read is logged
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", port)
    await site.start()
    app["conf"]["port"] = site._server.sockets[0].getsockname()[1]
    url = f"http://127.0.0.1:{app['conf']['port']}/#t={token}"
    if on_ready:
        on_ready(url)
    try:
        await asyncio.Event().wait()
    finally:
        with contextlib.suppress(Exception):
            await runner.cleanup()
