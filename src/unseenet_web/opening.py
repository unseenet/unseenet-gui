"""Ways to show the client: an app window, a browser in app mode, or the browser.

``auto`` tries them in that order:

1. ``window``: pywebview, the system's own web view (WebView2 on Windows,
   WKWebView on macOS, WebKitGTK on Linux) in private mode. Looks and acts
   like an app, and leaves nothing in a browser's history.
2. ``app``: a Chromium-family browser (Chrome, Chromium, Edge, Brave) with
   ``--app``: a window without tabs or address bar, with a throwaway profile
   in data/ that is deleted when the window closes.
3. ``browser``: your default browser, in a new tab.

``kiosk`` is the bootable image's way: a full-screen window and nothing else.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import webbrowser
from pathlib import Path

MODES = ("auto", "window", "app", "browser", "none", "kiosk")

APP_BROWSERS = {
    "linux": ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable",
              "brave-browser", "microsoft-edge", "microsoft-edge-stable"],
    "darwin": ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
               "/Applications/Chromium.app/Contents/MacOS/Chromium",
               "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
               "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
    "win32": [r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
              r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe",
              r"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
              r"%LocalAppData%\Google\Chrome\Application\chrome.exe"],
}


def has_webview() -> bool:
    try:
        import webview  # type: ignore  # noqa: F401
    except Exception:  # noqa: BLE001  (missing, or its GUI toolkit is missing)
        return False
    if sys.platform.startswith("linux"):
        try:                                     # pywebview's GTK backend needs these
            import gi  # type: ignore
            gi.require_version("Gtk", "3.0")
            try:
                gi.require_version("WebKit2", "4.1")
            except ValueError:
                gi.require_version("WebKit2", "4.0")
        except Exception:  # noqa: BLE001
            return False
    return True


def find_app_browser() -> str | None:
    platform = "linux" if sys.platform.startswith("linux") else sys.platform
    for candidate in APP_BROWSERS.get(platform, []):
        path = os.path.expandvars(candidate)
        found = shutil.which(path) if os.sep not in path else (path if Path(path).is_file() else None)
        if found:
            return found
    return None


def show_window(url: str, fullscreen: bool = False) -> None:
    """Block until the window is closed."""
    import webview  # type: ignore
    webview.create_window("Unseenet", url, width=1360, height=860, min_size=(420, 560),
                          fullscreen=fullscreen, background_color="#10302A", text_select=True)
    webview.start(private_mode=True)


def show_app(url: str, browser: str, profile_parent: Path | None) -> None:
    """A browser window without browser chrome; blocks until it is closed."""
    parent = profile_parent if profile_parent and profile_parent.is_dir() else None
    profile = Path(tempfile.mkdtemp(prefix="unseenet-web-profile-", dir=parent))
    try:
        subprocess.run([browser, f"--app={url}", f"--user-data-dir={profile}", "--incognito",
                        "--no-first-run", "--no-default-browser-check", "--disable-sync",
                        "--disable-background-networking", "--window-size=1360,860"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    finally:
        shutil.rmtree(profile, ignore_errors=True)


def pick(mode: str) -> tuple[str, str | None]:
    """The way that ``mode`` comes to here: (way, browser path for 'app')."""
    if mode == "kiosk":
        return ("kiosk", None) if has_webview() else ("browser", None)
    if mode in ("window", "auto") and has_webview():
        return "window", None
    if mode in ("app", "auto", "window"):
        browser = find_app_browser()
        if browser:
            return "app", browser
    if mode == "none":
        return "none", None
    return "browser", None


def open_client(url: str, way: str, browser: str | None, profile_parent: Path | None) -> bool:
    """Show the client. True if it blocked until closed (the server can stop then)."""
    if way == "kiosk":
        show_window(url, fullscreen=True)
        return True
    if way == "window":
        show_window(url)
        return True
    if way == "app" and browser:
        show_app(url, browser, profile_parent)
        return True
    if way == "browser":
        webbrowser.open(url)
    return False
