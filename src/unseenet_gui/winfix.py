"""Windows: an app without a console window.

The portable Windows build is a windowed program ("Unseenet Graphical.exe"), so
there is no console - but a console program it starts (Tor) would get a
console window of its own. ``hide_child_consoles`` makes every program started
from here run without one. (unseenet's core could pass CREATE_NO_WINDOW
itself; see CORE-NEEDS.md.)
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

CREATE_NO_WINDOW = 0x08000000


def hide_child_consoles() -> None:
    if sys.platform != "win32" or getattr(subprocess.Popen, "_unseenet_no_window", False):
        return
    original = subprocess.Popen.__init__

    def __init__(self, *args, **kwargs):
        kwargs["creationflags"] = kwargs.get("creationflags", 0) | CREATE_NO_WINDOW
        original(self, *args, **kwargs)

    subprocess.Popen.__init__ = __init__
    subprocess.Popen._unseenet_no_window = True


def icon_path() -> Path | None:
    """unseenet.ico, made by the build, in the program's own folder."""
    base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    for candidate in (base / "unseenet.ico", Path(sys.executable).parent / "unseenet.ico"):
        if candidate.is_file():
            return candidate
    return None


def set_window_icon(window) -> None:
    """pywebview's Windows window shows a generic icon: give it Unseenet's."""
    ico = icon_path()
    if sys.platform != "win32" or ico is None:
        return
    try:
        from System import Action  # type: ignore  # pythonnet, which pywebview uses on Windows
        from System.Drawing import Icon  # type: ignore
        form = window.native
        form.Invoke(Action(lambda: setattr(form, "Icon", Icon(str(ico)))))
    except Exception:  # noqa: BLE001  (cosmetic: never stop the program for it)
        pass
