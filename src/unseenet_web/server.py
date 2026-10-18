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
import os
import json
import secrets
from importlib import resources
from pathlib import Path

from aiohttp import WSMsgType, web

from unseenet.client.session import SessionError

from . import system
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
    except (ValueError, KeyError) as exc:          # a bad key, name or group ID
        response = _error(str(exc) or "not valid")
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
    marker = request.app["conf"].get("marker")
    if marker:                                   # the page is up and its script runs (image self-test)
        try:
            Path(marker).write_text("page loaded\n")
        except OSError:
            pass
    data = _rt(request).state()
    if system.enabled():
        data["bootable"] = True
        data["keyboard"] = system.keyboard()
    return _json(data)


# --- the bootable image: network, keyboard, power -------------------------------
def _bootable():
    if not system.enabled():
        raise web.HTTPNotFound()


async def system_status(request):
    _bootable()
    return _json(await asyncio.to_thread(system.status))


async def system_wifi(request):
    _bootable()
    data = await _body(request)
    device = str(data.get("device", ""))
    if data.get("action") == "scan":
        return _json(await asyncio.to_thread(system.wifi_networks, device))
    ok, msg = await asyncio.to_thread(system.wifi_connect, device, str(data.get("name", "")),
                                      str(data.get("passphrase", "")) or None)
    if ok:                                       # Tor may have given up while offline
        rt = _rt(request)
        if rt.session is not None:
            rt.spawn(rt.refresh())
    return _json({"ok": ok, "message": msg}, 200 if ok else 400)


async def system_keyboard(request):
    _bootable()
    data = await _body(request)
    system.set_keyboard(str(data.get("layout", "")))
    rt = _rt(request)
    if rt.session is None:                       # nothing unlocked yet: restart with the layout now
        system.request_restart()
        asyncio.get_running_loop().call_later(0.4, os._exit, system.RESTART)
        return _json({"restart": True})
    return _json({"restart": False})             # unlocked: it applies at the next start


async def system_power(request):
    _bootable()
    data = await _body(request)
    rt = _rt(request)
    await rt.close()                             # stop Tor, save the vault
    system.power(str(data.get("action", "")))
    return _json({"ok": True})


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
    # the compose window already has the signature in the text, as the TUI's does
    job = rt.post(gid, subject, body, refs, chat=chat, signature=bool(data.get("signature", True)))
    return _json({"job": job})


async def private(request):
    rt = _unlocked(request)
    data = await _body(request)
    body = str(data.get("body", "")).strip("\n")
    if not body.strip():
        return _error("nothing to send")
    job = rt.send_private(str(data.get("key", "")).strip(), body, str(data.get("subject", "")).strip(),
                          reply_to=data.get("reply_to"), chat=bool(data.get("chat")))
    return _json({"job": job})


async def contacts(request):
    rt = _unlocked(request)
    data = await _body(request)
    key = str(data.get("key", "")).strip()
    if data.get("remove"):
        rt.remove_contact(key)
    else:
        rt.add_contact(key, str(data.get("name", "")))
    return _json({"ok": True})


async def create(request):
    rt = _unlocked(request)
    data = await _body(request)
    gtype = data.get("type", "open")
    if gtype not in ("open", "moderated", "channel", "closed"):
        return _error("type is open, moderated, channel or closed")
    name = str(data.get("name", "")).strip().lower()
    if not name:
        return _error("a group needs a name")
    # what the group takes (UN-RFC 0028): "both" (the default), "post" or "chat"
    kinds = {"both": None, "post": ["post"], "chat": ["chat"]}.get(str(data.get("kinds", "both")))
    gid = await rt.create_group(name, gtype, str(data.get("view", "threads")), bool(data.get("fast")),
                                str(data.get("title", "")).strip(), str(data.get("description", "")).strip(),
                                kinds)
    return _json({"id": gid})


# --- owners and moderators: the TUI's Ctrl+P tools -------------------------------
async def moderation(request):
    rt = _unlocked(request)
    if request.method == "POST":
        data = await _body(request)
        await rt.moderate(str(data.get("id", "")), bool(data.get("approve")),
                          str(data.get("reason", "")).strip())
        return _json({"ok": True})
    return _json(await rt.moderation())


async def edit_group(request):
    rt = _unlocked(request)
    data = await _body(request)
    allowed = ("title", "description", "rules", "view", "kinds", "low_latency")
    changes = {k: data[k] for k in allowed if k in data}
    if "kinds" in changes:              # "both", "post" or "chat", as when creating a group
        changes["kinds"] = {"both": ["chat", "post"], "post": ["post"], "chat": ["chat"]}.get(
            str(changes["kinds"]), ["chat", "post"])
    await rt.edit_group(request.match_info["gid"], changes)
    return _json({"ok": True})


async def remove_group(request):
    rt = _unlocked(request)
    data = await _body(request)
    if data.get("confirm") != "remove":
        return _error('type "remove" to confirm')
    await rt.remove_group(request.match_info["gid"], str(data.get("reason", "")).strip())
    return _json({"ok": True})


async def role(request):
    rt = _unlocked(request)
    data = await _body(request)
    await rt.set_role(request.match_info["gid"], str(data.get("role", "")),
                      str(data.get("key", "")).strip(), bool(data.get("on", True)))
    return _json({"ok": True})


async def ban(request):
    rt = _unlocked(request)
    data = await _body(request)
    await rt.ban(request.match_info["gid"], str(data.get("key", "")).strip(),
                 bool(data.get("on", True)), str(data.get("reason", "")).strip())
    return _json({"ok": True})


async def withdraw(request):
    rt = _unlocked(request)
    data = await _body(request)
    await rt.withdraw(request.match_info["gid"], str(data.get("id", "")))
    return _json({"ok": True})


async def report(request):
    rt = _unlocked(request)
    gid = request.match_info["gid"]
    if request.method == "GET":
        return _json(await rt.report_targets(gid, request.query.get("id", "")))
    data = await _body(request)
    sent = await rt.report(gid, str(data.get("id", "")), [int(i) for i in data.get("targets", [])],
                           str(data.get("note", "")).strip(), bool(data.get("anonymous")))
    return _json({"sent": sent})


# --- names, ignoring, blocking, members --------------------------------------------
async def names(request):
    rt = _unlocked(request)
    if request.method == "POST":
        return _json({"text": await rt.name_action(await _body(request))})
    return _json(await rt.names())


async def ignore(request):
    rt = _unlocked(request)
    if request.method == "POST":
        data = await _body(request)
        rt.ignore(str(data.get("key", "")).strip(), str(data.get("label", "")), bool(data.get("on", True)))
        return _json({"ok": True})
    return _json(rt.ignored())


async def block(request):
    rt = _unlocked(request)
    data = await _body(request)
    where = await rt.block(request.match_info["gid"], str(data.get("key", "")).strip(),
                           str(data.get("reason", "")).strip())
    return _json({"hierarchy": where})


async def markdown(request):
    rt = _unlocked(request)
    data = await _body(request)
    rt.session.set_markdown(bool(data.get("on", True)))
    rt.emit("groups")
    return _json({"ok": True})


async def show_blocked(request):
    rt = _unlocked(request)
    data = await _body(request)
    rt.show_blocked(bool(data.get("on")))
    return _json({"ok": True})


async def remove_member(request):
    rt = _unlocked(request)
    data = await _body(request)
    epoch = await rt.remove_member(request.match_info["gid"], str(data.get("key", "")).strip())
    return _json({"epoch": epoch})


async def invite(request):
    rt = _unlocked(request)
    data = await _body(request)
    await rt.invite(request.match_info["gid"], str(data.get("key", "")).strip())
    return _json({"ok": True})


async def signature(request):
    rt = _unlocked(request)
    if request.method == "POST":
        data = await _body(request)
        rt.set_signature(str(data.get("template", "")))
    return _json({"template": rt.session.signature_template(), "preview": rt.session.signature()})


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
    app["conf"] = {"port": 0, "marker": os.environ.get("UNSEENET_WEB_MARKER")}   # port: once bound
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
    r.add_post("/api/groups", create)
    r.add_post("/api/groups/{gid}/invite", invite)
    r.add_get("/api/moderation", moderation)
    r.add_post("/api/moderation", moderation)
    r.add_post("/api/groups/{gid}/edit", edit_group)
    r.add_post("/api/groups/{gid}/remove", remove_group)
    r.add_post("/api/groups/{gid}/role", role)
    r.add_post("/api/groups/{gid}/ban", ban)
    r.add_post("/api/groups/{gid}/withdraw", withdraw)
    r.add_get("/api/groups/{gid}/report", report)
    r.add_post("/api/groups/{gid}/report", report)
    r.add_get("/api/names", names)
    r.add_post("/api/names", names)
    r.add_get("/api/ignore", ignore)
    r.add_post("/api/ignore", ignore)
    r.add_post("/api/groups/{gid}/block", block)
    r.add_post("/api/show-blocked", show_blocked)
    r.add_post("/api/markdown", markdown)
    r.add_post("/api/groups/{gid}/members/remove", remove_member)
    r.add_post("/api/private", private)
    r.add_post("/api/contacts", contacts)
    r.add_get("/api/signature", signature)
    r.add_post("/api/signature", signature)
    r.add_get("/api/browse", browse)
    r.add_post("/api/subscribe", subscribe)
    r.add_post("/api/refresh", refresh)
    r.add_get("/api/events", events)
    r.add_get("/api/system", system_status)
    r.add_post("/api/system/wifi", system_wifi)
    r.add_post("/api/system/keyboard", system_keyboard)
    r.add_post("/api/system/power", system_power)

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
