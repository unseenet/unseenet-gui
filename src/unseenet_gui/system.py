"""The bootable image's own settings, from inside the client: network, keyboard, power.

Only active when the client runs on the bootable image (``UNSEENET_WEB_BOOTABLE=1``,
set by ``unseenet_gui.boot``). The Wi-Fi and media helpers are unseenet's own
(``unseenet.boot``), so the text image and this one behave the same.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

KEYBOARDS = [("us", "English (US)"), ("dk", "Dansk"), ("de", "Deutsch"), ("gb", "English (UK)"),
             ("fr", "Français"), ("se", "Svenska"), ("no", "Norsk"), ("fi", "Suomi"),
             ("nl", "Nederlands"), ("es", "Español"), ("it", "Italiano"), ("ch", "Schweiz"),
             ("pl", "Polski"), ("pt", "Português"), ("be", "Belgique"), ("cz", "Čeština")]
RESTART = 3                       # exit code: start the session again (a new keyboard layout)
RESTART_FLAG = Path("/run/unseenet/restart-session")   # read by unseenet_gui.boot (cage may not pass the code)


def enabled() -> bool:
    return os.environ.get("UNSEENET_WEB_BOOTABLE") == "1"


def _core():
    from unseenet import boot      # imported late: it needs Textual, which the image has
    return boot


def media() -> Path | None:
    return _core().find_media()


def settings() -> dict:
    return _core().load_settings(media())


def save(changes: dict) -> None:
    current = settings()
    current.update(changes)
    _core().save_settings(media(), current)


def keyboard() -> str:
    return settings().get("web_keyboard") or os.environ.get("XKB_DEFAULT_LAYOUT") or "us"


def status() -> dict:
    core = _core()
    m = media()
    return {"addresses": [{"interface": i, "address": a} for i, a in core.addresses()],
            "wifi": core.wifi_devices(), "keyboard": keyboard(),
            "keyboards": [{"id": k, "name": n} for k, n in KEYBOARDS],
            "media": str(m) if m else None, "writable": bool(m and core.writable(m))}


def wifi_networks(device: str) -> list[dict]:
    if device not in _core().wifi_devices():
        raise ValueError("no such Wi-Fi device")
    return [{"name": n, "security": sec, "signal": sig, "connected": c}
            for n, sec, sig, c in _core().wifi_networks(device)]


def wifi_connect(device: str, name: str, passphrase: str | None) -> tuple[bool, str]:
    if device not in _core().wifi_devices():
        raise ValueError("no such Wi-Fi device")
    return _core().wifi_connect(device, name, passphrase or None)


def set_keyboard(layout: str) -> None:
    if layout not in dict(KEYBOARDS):
        raise ValueError("unknown keyboard layout")
    save({"web_keyboard": layout})


def request_restart() -> None:
    try:
        RESTART_FLAG.parent.mkdir(parents=True, exist_ok=True)
        RESTART_FLAG.write_text("keyboard\n")
    except OSError:
        pass


def power(action: str) -> None:
    if action not in ("poweroff", "reboot"):
        raise ValueError("poweroff or reboot")
    subprocess.Popen([action], stdin=subprocess.DEVNULL, start_new_session=True)
