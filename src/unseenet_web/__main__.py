"""Start the web client: ``unseenet-web`` or ``python -m unseenet_web``."""

from __future__ import annotations

import argparse
import asyncio
import signal
import threading
import webbrowser
from pathlib import Path

from . import __version__
from .server import serve


def default_vault() -> Path:
    try:
        from unseenet.client.session import default_vault_path
        return default_vault_path()
    except Exception:  # noqa: BLE001  (an older core)
        return Path("unseenet.vault")


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="unseenet-web", description="Unseenet in a window of its own.")
    p.add_argument("--vault", default=str(default_vault()), help="encrypted vault file (the same as the TUI's)")
    p.add_argument("--port", type=int, default=0, help="local port (default: a random free one)")
    p.add_argument("--window", action="store_true",
                   help="open in an app window (needs pywebview) instead of your browser")
    p.add_argument("--no-browser", action="store_true", help="only print the address to open")
    p.add_argument("--version", action="version", version=f"unseenet-web {__version__}")
    args = p.parse_args(argv)
    vault = Path(args.vault)

    if args.window:
        try:
            import webview  # type: ignore
        except ImportError:
            print("--window needs pywebview: pip install 'unseenet-web[window]'. Opening your browser instead.")
        else:
            ready = threading.Event()
            box: dict = {}

            def on_ready(url: str) -> None:
                box["url"] = url
                ready.set()

            threading.Thread(target=lambda: asyncio.run(serve(vault, args.port, on_ready)),
                             daemon=True).start()
            ready.wait()
            # private_mode: no cookies, cache or storage kept by the webview
            webview.create_window("Unseenet", box["url"], width=1360, height=860, min_size=(420, 560))
            webview.start(private_mode=True)
            return

    def on_ready(url: str) -> None:
        print("Unseenet is running. Open this address (it contains a one-time key, keep it private):")
        print(f"  {url}")
        print("Stop with Ctrl+C.")
        if not args.no_browser:
            webbrowser.open(url)

    def stop(*_):                    # a plain kill shuts down cleanly too, so Tor stops
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    try:
        asyncio.run(serve(vault, args.port, on_ready))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
