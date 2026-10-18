"""Start the graphical client: ``unseenet-gui`` or ``python -m unseenet_gui``.

    unseenet-gui                       open it (your browser; an app window in the portable build)
    unseenet-gui --open window         in an app window (needs pywebview)
    unseenet-gui --open app            in a Chromium-family browser without tabs or address bar
    unseenet-gui --kiosk               full screen, nothing else (the bootable image)
    unseenet-gui --no-browser          only print the address
    unseenet-gui --self-test [--offline] [--node ADDRESS]
"""

from __future__ import annotations

import argparse
import asyncio
import signal
import sys
import threading
from pathlib import Path

from . import __version__
from .opening import MODES, open_client, pick
from .server import serve


def default_vault() -> Path:
    try:
        from unseenet.client.session import default_vault_path
        return default_vault_path()
    except Exception:  # noqa: BLE001  (an older core)
        return Path("unseenet.vault")


def use_bundled_tor() -> None:
    """The Windows build keeps Tor in its contents folder: tell the core where."""
    import os
    if os.environ.get("UNSEENET_TOR") or not getattr(sys, "frozen", False):
        return
    name = "tor.exe" if sys.platform == "win32" else "tor"
    base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    for candidate in (base / "tor" / name, Path(sys.executable).parent / "tor" / name):
        if candidate.is_file():
            os.environ["UNSEENET_TOR"] = str(candidate)
            return


def main(argv=None) -> None:
    frozen = getattr(sys, "frozen", False)          # the portable build
    if sys.platform == "win32":
        from .winfix import hide_child_consoles
        hide_child_consoles()                       # no console window for Tor
    use_bundled_tor()
    p = argparse.ArgumentParser(prog="unseenet-gui", description="Unseenet in a window of its own.")
    p.add_argument("--vault", default=str(default_vault()), help="encrypted vault file (the same as the TUI's)")
    p.add_argument("--port", type=int, default=0, help="local port (default: a random free one)")
    p.add_argument("--open", choices=MODES, default="auto" if frozen else "browser",
                   help="how to show it (default: %(default)s)")
    p.add_argument("--window", action="store_const", const="window", dest="open", help="same as --open window")
    p.add_argument("--kiosk", action="store_const", const="kiosk", dest="open", help="full screen (bootable image)")
    p.add_argument("--no-browser", action="store_const", const="none", dest="open", help="only print the address")
    p.add_argument("--self-test", action="store_true", help="check this build and exit")
    p.add_argument("--offline", action="store_true", help="with --self-test: do not start Tor")
    p.add_argument("--node", help="with --self-test: also reach this node over Tor")
    p.add_argument("--log", help="write messages to this file (the Windows build has no console)")
    p.add_argument("--version", action="version", version=f"unseenet-gui {__version__}")
    args = p.parse_args(argv)

    if args.log:
        sys.stdout = sys.stderr = open(args.log, "w", encoding="utf-8", buffering=1)
    if args.self_test:
        from .selftest import self_test
        sys.exit(self_test(network=not args.offline, node=args.node))

    vault = Path(args.vault)
    way, browser = pick(args.open)
    loop = asyncio.new_event_loop()
    ready = threading.Event()
    box: dict = {}

    def on_ready(url: str) -> None:
        box["url"] = url
        ready.set()

    def run_server() -> None:
        asyncio.set_event_loop(loop)
        box["task"] = loop.create_task(serve(vault, args.port, on_ready))
        try:
            loop.run_until_complete(box["task"])
        except (asyncio.CancelledError, KeyboardInterrupt):
            pass
        except Exception as exc:  # noqa: BLE001
            box["error"] = exc
            ready.set()

    def stop_server() -> None:
        if "task" in box and not box["task"].done():
            loop.call_soon_threadsafe(box["task"].cancel)
        thread.join(30)                 # the runtime closes Tor on the way out

    thread = threading.Thread(target=run_server, name="unseenet-gui-server", daemon=True)
    thread.start()
    ready.wait()
    if "error" in box:
        sys.exit(f"Could not start: {box['error']}")
    url = box["url"]
    if way in ("browser", "none"):
        print("Unseenet is running. Open this address (it contains a one-time key, keep it private):")
        print(f"  {url}")
        print("Stop with Ctrl+C.", flush=True)
    profile_parent = vault.resolve().parent if vault.parent.exists() else None

    def stop(*_):                       # a plain kill shuts down cleanly too, so Tor stops
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    try:
        if open_client(url, way, browser, profile_parent):
            return                      # the window was closed
        while thread.is_alive():
            thread.join(1)
    except KeyboardInterrupt:
        pass
    finally:
        stop_server()


if __name__ == "__main__":
    main()
