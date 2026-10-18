"""``unseenet-gui --self-test``: does this build work? Used by CI on every build.

Checks that everything the client loads is there, finds Tor, serves the page
and its API with the token (and refuses without), and - unless --offline -
starts Tor and, with --node, reaches a node over it.
"""

from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

from . import __version__


def _get(url: str, token: str | None = None) -> tuple[int, bytes]:
    req = urllib.request.Request(url, headers={"X-Unseenet-Token": token} if token else {})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as exc:
        return exc.code, b""


async def _server_check() -> bool:
    from .server import serve
    ready: asyncio.Future = asyncio.get_running_loop().create_future()
    with tempfile.TemporaryDirectory(prefix="unseenet-gui-selftest-") as tmp:
        task = asyncio.create_task(serve(Path(tmp) / "test.vault", 0, ready.set_result))
        url = await asyncio.wait_for(ready, 20)
        base, token = url.split("/#t=")
        page = await asyncio.to_thread(_get, base + "/")
        script = await asyncio.to_thread(_get, base + "/static/app.js")
        refused = await asyncio.to_thread(_get, base + "/api/state")
        state = await asyncio.to_thread(_get, base + "/api/state", token)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    ok = (page[0] == 200 and b"app.js" in page[1] and script[0] == 200 and refused[0] == 401
          and state[0] == 200 and json.loads(state[1]).get("unlocked") is False)
    print(f"Server:    {'serves the page and the API, refuses without the token' if ok else 'BROKEN'}"
          f" (page {page[0]}, script {script[0]}, no token {refused[0]}, with token {state[0]})")
    return ok


def self_test(network: bool = True, node: str | None = None) -> int:
    from unseenet import __version__ as core_version
    from unseenet import portable
    from unseenet.core.tor import TorError, TorProcess

    print(f"Unseenet graphical {__version__} on core {core_version}, Python {sys.version.split()[0]} on {sys.platform}")
    try:
        import aiohttp  # noqa: F401
        import nacl.bindings  # noqa: F401
        from unseenet.client.session import Session  # noqa: F401
        from unseenet.core import crypto
        from . import runtime, serialize, server  # noqa: F401
        crypto.Identity.generate()
    except Exception as exc:  # noqa: BLE001
        print(f"Parts:     BROKEN ({type(exc).__name__}: {exc})")
        return 1
    print("Parts:     server, client core and cryptography load")
    from .opening import find_app_browser, has_webview
    print(f"Window:    {'app window (pywebview)' if has_webview() else 'no app window here'}; "
          f"app-mode browser: {find_app_browser() or 'none found'}")
    if not asyncio.run(_server_check()):
        return 1
    root = portable.portable_root()
    print(f"Portable:  {root if root else 'no (files go in the current directory)'}")
    print(f"Vault:     {portable.default_vault_path().resolve()}")
    try:
        binary = TorProcess.find_binary()
    except TorError as exc:
        print(f"Tor:       NOT FOUND ({exc})")
        return 1
    version = TorProcess.binary_version(binary)
    print(f"Tor:       {binary}\n           {version or 'does not run'}")
    if not version:
        return 1
    if not network:
        print("This build works (offline checks).")
        return 0
    print("Starting Tor and connecting to the Tor network (up to two minutes) ...")

    async def run() -> int:
        with tempfile.TemporaryDirectory(prefix="unseenet-gui-selftest-") as tmp:
            tor = TorProcess(Path(tmp), binary)
            try:
                await tor.start(timeout=120)
                print("Tor connected.")
                if node:
                    from unseenet.nntp import Client
                    print(f"Reaching node {node} over Tor ...")
                    client = await asyncio.wait_for(Client.connect(node, tor.socks_port), 120)
                    caps = await client.fetch_capabilities()
                    await client.quit()
                    print(f"Node answers: {caps[0] if caps else '?'}.")
            except TorError as exc:
                print(f"Tor did not connect: {exc}")
                return 2
            except (OSError, ConnectionError, asyncio.TimeoutError) as exc:
                print(f"Could not reach the node: {exc}")
                return 3
            finally:
                await tor.stop()
        print("This build works.")
        return 0
    return asyncio.run(run())
