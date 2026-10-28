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
def _portable() -> bool:
    """Whether this program runs from a stick or a portable folder."""
    try:
        from unseenet.portable import portable_root
        return portable_root() is not None
    except ImportError:
        return False


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
           # a stick or portable folder: no PIN there, the passphrase only (UN-RFC 0050 5)
           "portable": _portable(),
           "update": request.app[UPDATER].info(s),
           "fp": s.identity().fingerprint[:4] if s is not None and s.has_identity() else None,
           # the vault's identities, to choose which to copy to another device (UN-RFC 0050 3.6)
           "identities": [{"name": n, "display": e.get("display", n),
                           "default": n == s.default_identity_name()}
                          for n, e in s.data["identities"].items()]
           if s is not None and s.has_identity() else []}
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


CLOUD_HINTS = ("dropbox", "onedrive", "icloud", "google drive", "googledrive", "mega",
               "nextcloud", "owncloud", "pcloud", "box sync")


async def qr(request):
    """A QR code as SVG, for the code of a copy to another device (UN-RFC 0050 section
    3.2). Made here, on this machine: the text is a one-time secret."""
    import segno
    import io
    data = await _body(request)
    text = str(data.get("text", ""))
    if not text or len(text) > 512:
        return web.json_response({"error": "nothing to show"}, status=400)
    out = io.BytesIO()
    segno.make(text, error="m", boost_error=False).save(out, kind="svg", scale=6, border=4,
                                                      dark="#000", light="#fff", xmldecl=False,
                                                      svgns=True, title="QR code")
    return web.json_response({"svg": out.getvalue().decode()})


def _same_medium(a: Path, b: Path) -> bool:
    try:
        return os.stat(a).st_dev == os.stat(b).st_dev
    except OSError:
        return False


async def save_words(request):
    """Save as file (UN-RFC 0050 section 4.3), a deliberate choice behind the page's
    warning: the words are made here from the passphrase - the page never holds them
    for this - and saved in Downloads, but never on the vault's own disk or stick, never
    in a folder that looks synchronised to a cloud, and not on the bootable image."""
    from unseenet.client.session import SessionError
    from unseenet.core import recovery as rc
    api = _api(request)
    s = api.session
    if s is None or not s.has_identity():
        raise web.HTTPConflict(text="locked")
    if system.enabled() or sys.platform == "emscripten":
        return web.json_response({"error": "Not here: write the words on paper."}, status=400)
    data = await _body(request)
    try:
        words = await asyncio.to_thread(s.recovery_words, str(data.get("passphrase", "")))
    except SessionError as exc:
        return web.json_response({"error": str(exc)}, status=400)
    folder = Path.home() / "Downloads"
    folder = folder if folder.is_dir() else Path.home()
    if api.vault_path is not None and _same_medium(folder, api.vault_path.resolve().parent):
        return web.json_response({"error": "Your Downloads folder is on the same disk as the "
                                  "vault: whoever takes it would have both. Write the words on "
                                  "paper, or copy them to another stick by hand."}, status=400)
    if any(h in str(folder).lower() for h in CLOUD_HINTS):
        return web.json_response({"error": "Your Downloads folder looks synchronised to a cloud "
                                  "service. Write the words on paper instead."}, status=400)
    path = save_name(folder, "unseenet-recovery-words.txt")
    text = rc.text_page(s.display_name(), s.identity().fingerprint, words)

    def write():
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
    await asyncio.to_thread(write)
    return web.json_response({"path": str(path)})


SITE_SUFFIXES = {".md", ".markdown", ".html", ".htm", ".jpg", ".jpeg", ".png", ".gif", ".webp",
                 ".avif", ".siteignore"}
SITE_MAX = 50 * 1024 * 1024
_SITE_FOLDERS: list = []               # the last folder made, removed when a new one comes


async def site_folder(request):
    """The files of a folder the reader chose to publish as a site (#125, the core's
    site import, unseenet#538), into a fresh folder only this user can read: the
    browser gives files, not a path. Only pages, pictures and .siteignore; nothing
    outside the folder (``..``, absolute names); at most 50 MiB. The previous one is
    removed. Not in the browser build, which has no folder here."""
    import shutil
    import tempfile
    if sys.platform == "emscripten":
        return web.json_response({"error": "Not in the browser."}, status=400)
    reader = await request.multipart()
    folder = Path(tempfile.mkdtemp(prefix="unseenet-site-"))
    os.chmod(folder, 0o700)
    total, kept = 0, 0
    try:
        while True:
            part = await reader.next()
            if part is None:
                break
            from urllib.parse import unquote
            # the page sends the path relative to the folder as the field's name
            # (browsers may cut folders off a file name); quoted or not
            rel = Path(unquote(str(part.name or part.filename or "")).replace("\\", "/"))
            parts = [p for p in rel.parts if p not in ("", ".")]
            if not parts or ".." in parts or rel.is_absolute():
                continue
            name = parts[-1]
            if Path(name).suffix.lower() not in SITE_SUFFIXES and name != ".siteignore":
                continue
            target = folder.joinpath(*parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with open(target, "wb") as f:
                while chunk := await part.read_chunk():
                    total += len(chunk)
                    if total > SITE_MAX:
                        raise ValueError("more than 50 MiB")
                    f.write(chunk)
            kept += 1
    except ValueError as exc:
        shutil.rmtree(folder, ignore_errors=True)
        return web.json_response({"error": f"The folder is too large: {exc}."}, status=400)
    for p in _SITE_FOLDERS:
        shutil.rmtree(p, ignore_errors=True)
    _SITE_FOLDERS[:] = [folder]
    return web.json_response({"folder": str(folder), "files": kept})


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
    sub.router.add_post("/qr", qr)                         # UN-RFC 0050: copying
    sub.router.add_post("/save-words", save_words)         # UN-RFC 0050 4.3
    sub.router.add_post("/site-folder", site_folder)       # #125: publish a folder
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
