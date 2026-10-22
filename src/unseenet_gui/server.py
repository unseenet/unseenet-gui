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


def _session(request):
    s = _api(request).session
    if s is None or not s.has_identity():
        raise web.HTTPConflict(text="locked")
    return s


def _perm(p) -> dict:
    return {"allowed": bool(p.allowed), "reason": p.reason, "code": p.code}


async def write(request):
    """May you write here, and if not, why - before you write (#13, unseenet#181):
    a new post, a chat line, and a reply to each post the client has read. The core's
    ``Session.write_permission``, as the terminal client uses it. CORE: to the local
    API (UN-RFC 0046) for every front end, unseenet#320."""
    s = _session(request)
    gid = request.match_info["gid"]
    if ":" in gid or gid == s.my_inbox:          # contacts, For you, your inbox: not groups
        return web.json_response({})
    from unseenet.core.groups import KIND_CHAT, KIND_POST
    replies = {m.message_id: _perm(s.write_permission(gid, reply_to=m, kind=KIND_POST))
               for m in s.cache.get(gid, {}).values() if m.message_id}
    return web.json_response({"post": _perm(s.write_permission(gid, kind=KIND_POST)),
                              "chat": _perm(s.write_permission(gid, kind=KIND_CHAT)),
                              "replies": replies})


async def passphrase(request):
    """A new passphrase for this vault file (#32, unseenet#281). Slow: off the loop."""
    s = _session(request)
    data = await _body(request)
    old, new = str(data.get("old", "")), str(data.get("new", ""))
    if len(new) < 4:                              # as the terminal client asks
        return web.json_response({"error": "The new passphrase is too short."}, status=400)
    from unseenet.core.vault import VaultError
    try:
        await asyncio.to_thread(s.change_passphrase, old, new)
    except VaultError as exc:
        wrong = "wrong passphrase" in str(exc)
        return web.json_response({"error": "The current passphrase is not right." if wrong
                                  else f"Could not change it: {exc}"}, status=400)
    except OSError as exc:                        # the old one still works: core keeps it
        return web.json_response({"error": f"Could not save the vault: {exc}"}, status=500)
    return web.json_response({"ok": True})


# CORE: the terminal client's PROFILE_WARNING (client/tui.py); to the core, unseenet#320
PROFILE_WARNING = (
    "Anybody who sees this identity's posts can read its profile.\n\n"
    "A link ties this identity - everything it has posted and will post - to that "
    "account.\n\n"
    "A published profile cannot be fully taken back: others may already have kept a "
    "copy.\n\n"
    "If you only want certain people to know, keep a separate identity for that, or "
    "leave the profile out.")


async def profile(request):
    """Someone's profile, or yours (#20, UN-RFC 0022 section 9.2), with what the page
    needs besides /api/profile: whether you hid it, its label, and for your own
    whether one is published yet and the warning before the first."""
    from unseenet.core import profiles as prof
    s = _session(request)
    api = _api(request)
    me = s.identity().key_text
    key = request.query.get("key", "").strip() or me
    mine = key == me
    hidden = not mine and s.profile_hidden(key)
    out = {"key": key, "mine": mine, "hidden": hidden, "label": s.label_of(key),
           "profile": None, "about_tree": [], "link_kinds": list(prof.LINK_KINDS)}
    if mine:
        out.update(api._profile(key, s.my_profile()))
        out.update(published=s.has_published_profile(), warning=PROFILE_WARNING, mine=True,
                   hidden=False, label=s.label_of(key))
        return web.json_response(out)
    if hidden:
        return web.json_response(out)
    authors = [m.author_key for g in s.cache.values() for m in g.values()
               if m.readable and m.author_key][:255]
    try:                     # all the authors shown, so the node cannot tell whose you open
        await s.prefetch_profiles([key, *authors])
    except Exception:  # noqa: BLE001  (profile_of below tries again and says why)
        pass
    try:
        p = await s.profile_of(key)
    except Exception as exc:  # noqa: BLE001
        return web.json_response({"error": f"Could not read the profile: {exc}"}, status=502)
    shown = api._profile(key, None if p is None else (p.raw or {"about": p.about}))
    out.update(profile=shown["profile"], about_tree=shown["about_tree"])
    return web.json_response(out)


async def profile_hide(request):
    """Hide or show someone's profile, for you alone (UN-RFC 0022 section 9.2)."""
    s = _session(request)
    data = await _body(request)
    key = str(data.get("key", "")).strip()
    if not key or key == s.identity().key_text:
        return web.json_response({"error": "Whose profile?"}, status=400)
    s.hide_profile(key, bool(data.get("hidden", True)))
    return web.json_response({"ok": True, "hidden": s.profile_hidden(key)})


async def profile_edit(request):
    """Publish your profile from the dialog's fields, or remove it (``remove``)."""
    from unseenet.core import profiles as prof
    s = _session(request)
    data = await _body(request)
    if data.get("remove"):
        await s.publish_profile(None)
        return web.json_response({"ok": True, "published": s.has_published_profile()})
    links = []
    for link in data.get("links") or []:
        if isinstance(link, dict) and str(link.get("value", "")).strip():
            item = {"kind": str(link.get("kind", "")).strip().lower(),
                    "value": str(link["value"]).strip()}
            if str(link.get("label", "")).strip():
                item["label"] = str(link["label"]).strip()
            links.append(item)
    lang = [t.strip() for t in str(data.get("lang", "")).split(",") if t.strip()]
    current = s.my_profile() or {}
    try:
        obj = prof.make_profile(str(data.get("about", "")), links, lang,
                                bot=current.get("bot") is True, markdown=bool(data.get("markdown")))
        await s.publish_profile(obj)
    except prof.ProfileError as exc:
        return web.json_response({"error": str(exc)}, status=400)
    return web.json_response({"ok": True, "published": s.has_published_profile()})


def gui_routes(sub: web.Application, api: LocalAPI) -> None:
    sub[UPDATER] = Updater()
    sub.router.add_get("/state", state)
    sub.router.add_get("/write/{gid}", write)
    sub.router.add_post("/passphrase", passphrase)
    sub.router.add_get("/profile", profile)
    sub.router.add_post("/profile/hide", profile_hide)
    sub.router.add_post("/profile", profile_edit)
    sub.router.add_post("/update", run_update)
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
