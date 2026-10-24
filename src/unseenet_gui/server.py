"""The local server for one person: the core's client API, plus this client's own.

Everything a front end does - unlock, groups, posts, people, the groups you
run - is the core's local client API (UN-RFC 0046, ``unseenet.client.localapi``),
with its security rules:

- it listens on 127.0.0.1 only, on a random port;
- every request carries a random token that only the window we open knows;
- the Host header must be our own address (DNS rebinding) and an Origin, when
  sent, our own origin; no CORS;
- the page may load nothing from outside (Content-Security-Policy);
- keys never reach the browser: signing, encryption and postage happen in
  the core, and posts come as the core's safe render tree.

What only this client needs is an extension under ``/x/gui/`` (UN-RFC 0046
section 6): the page's extra state, the bootable image's network, keyboard
and power, and updating a stick or portable folder.
"""

from __future__ import annotations

import asyncio
import os
import sys
from importlib import resources
from pathlib import Path

from aiohttp import web

from unseenet.client.localapi import LocalAPI
from unseenet.client.localapi import server as core

from . import system
from .update import Updater

STATIC = Path(str(resources.files("unseenet_gui") / "static"))
UPDATER = web.AppKey("updater", Updater)


def _api(request: web.Request) -> LocalAPI:
    return request.app[core.API_KEY]


async def _body(request: web.Request) -> dict:
    try:
        data = await request.json()
    except (ValueError, UnicodeDecodeError):
        raise web.HTTPBadRequest(text="expected JSON")
    if not isinstance(data, dict):
        raise web.HTTPBadRequest(text="expected an object")
    return data


def _bootable() -> None:
    if not system.enabled():
        raise web.HTTPNotFound(text="not the bootable image")


# --- /x/gui/ -----------------------------------------------------------------
async def state(request):
    """What the page shows besides the core's state: the vault's path, this
    machine (bootable image, browser), a newer release, your fingerprint."""
    marker = os.environ.get("UNSEENET_WEB_MARKER")
    if marker:                                   # the page is up and its script runs (image self-test)
        try:
            Path(marker).write_text("page loaded\n")
        except OSError:
            pass
    api = _api(request)
    s = api.session
    out = {"vault": str(api.vault_path) if api.vault_path else "",
           # in a browser through a web entrance (unseenet-entrance): the page says
           # what is true there - the entrance, not Tor on this computer, carries it
           "web": sys.platform == "emscripten",
           "bootable": system.enabled(),
           "update": request.app[UPDATER].info(s),
           "fp": s.identity().fingerprint[:4] if s is not None and s.has_identity() else None}
    if out["bootable"]:
        out["keyboard"] = system.keyboard()
    return web.json_response(out)


async def run_update(request):
    """Update this stick or portable folder to the newest signed release (unseenet#264)."""
    api = _api(request)
    if api.session is None:
        raise web.HTTPConflict(text="locked")
    return web.json_response(await request.app[UPDATER].run(api))


async def system_status(request):
    _bootable()
    return web.json_response(await asyncio.to_thread(system.status))


async def system_wifi(request):
    _bootable()
    data = await _body(request)
    device = str(data.get("device", ""))
    if data.get("action") == "scan":
        return web.json_response(await asyncio.to_thread(system.wifi_networks, device))
    ok, msg = await asyncio.to_thread(system.wifi_connect, device, str(data.get("name", "")),
                                      str(data.get("passphrase", "")) or None)
    api = _api(request)
    if ok and api.session is not None:           # Tor may have given up while offline
        api.refresh()
    return web.json_response({"ok": ok, "message": msg}, status=200 if ok else 400)


async def system_keyboard(request):
    _bootable()
    data = await _body(request)
    system.set_keyboard(str(data.get("layout", "")))
    if _api(request).session is None:            # nothing unlocked yet: restart with the layout now
        system.request_restart()
        asyncio.get_running_loop().call_later(0.4, os._exit, system.RESTART)
        return web.json_response({"restart": True})
    return web.json_response({"restart": False})  # unlocked: it applies at the next start


async def system_power(request):
    _bootable()
    data = await _body(request)
    await _api(request).close()                  # stop Tor, save the vault
    system.power(str(data.get("action", "")))
    return web.json_response({"ok": True})


def save_name(folder: Path, name: str) -> Path:
    """A file name in ``folder`` that is not taken, from the name a post gives: only its
    last part, never a path, and nothing hidden."""
    base = (name or "file").replace("\\", "/").rsplit("/", 1)[-1].lstrip(".") or "file"
    stem, dot, ext = base.rpartition(".")
    stem, ext = (stem, "." + ext) if dot and stem else (base, "")
    path, n = folder / base, 1
    while path.exists():
        n += 1
        path = folder / f"{stem} ({n}){ext}"
    return path


async def save_file(request):
    """Save a file a post carries in Downloads (else your home folder), as the node sent
    it and checked against its blob ID (UN-RFC 0027 section 9.2). Never opened: the page
    says that another program runs outside Unseenet and Tor."""
    from unseenet.client.session import SessionError
    s = _api(request).session
    if s is None or not s.has_identity():
        raise web.HTTPConflict(text="locked")
    data = await _body(request)
    gid, blob = str(data.get("group", "")), str(data.get("blob", ""))
    try:
        att, _ = s.attachment(gid, blob)
        octets = await s.fetch_blob(gid, blob)
    except SessionError as exc:
        return web.json_response({"error": str(exc)}, status=400)
    folder = Path.home() / "Downloads"
    folder = folder if folder.is_dir() else Path.home()
    path = save_name(folder, att.get("name") or "")
    await asyncio.to_thread(path.write_bytes, octets)
    return web.json_response({"path": str(path)})


def gui_routes(sub: web.Application, api: LocalAPI) -> None:
    sub[UPDATER] = Updater()
    sub.router.add_get("/state", state)
    sub.router.add_post("/update", run_update)
    sub.router.add_post("/save", save_file)
    sub.router.add_get("/system", system_status)
    sub.router.add_post("/system/wifi", system_wifi)
    sub.router.add_post("/system/keyboard", system_keyboard)
    sub.router.add_post("/system/power", system_power)


def build(vault: Path, token: str, *, page: bool = True) -> tuple[web.Application, LocalAPI]:
    """The app and its runtime. ``page=False`` for the web entrance, whose shim
    serves the page itself (unseenet-entrance, web/py/webbackend.py)."""
    api = LocalAPI(Path(vault))
    app = core.make_app(api, token, page=STATIC if page else None, extensions={"gui": gui_routes})
    return app, api


async def serve(vault: Path, port: int = 0, on_ready=None, stop: asyncio.Event | None = None) -> None:
    """Serve the client until ``stop`` (or forever). ``on_ready(url)`` gets the
    address to open, with the token in its fragment, which browsers do not send."""
    def ready(bound: int, token: str) -> None:
        if on_ready:
            on_ready(f"http://127.0.0.1:{bound}/#t={token}")
    api = LocalAPI(Path(vault))
    await core.serve(api, port=port, page=STATIC, extensions={"gui": gui_routes},
                     on_ready=ready, stop=stop)
