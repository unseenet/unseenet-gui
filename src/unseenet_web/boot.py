"""The graphical session of the bootable image (tools/image).

    python -m unseenet_web.boot              the session on tty1: cage (a kiosk
                                             Wayland compositor) showing the client full screen
    python -m unseenet_web.boot --self-test  check the running system (CI, and the
                                             "Self-test" entry of the boot loader)

Like unseenet's text image, it is one FAT partition labelled UNSEENET with a data/
folder: booted, that data/ is used (``UNSEENET_HOME``), so the vault is the same as
when the stick is used on a running computer. If the graphics cannot start, the
text menu of unseenet (``unseenet.boot``) is started instead.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from . import system

PY = sys.executable
KIOSK_UP = Path("/run/unseenet/kiosk-up")        # the splash stops when this appears


def session_env(media: Path | None, layout: str) -> dict:
    runtime = Path("/run/user/0")
    runtime.mkdir(parents=True, exist_ok=True)
    runtime.chmod(0o700)
    env = dict(os.environ,
               UNSEENET_WEB_BOOTABLE="1",
               XDG_RUNTIME_DIR=str(runtime),
               XKB_DEFAULT_LAYOUT=layout,
               LIBSEAT_BACKEND="seatd",
               WLR_RENDERER="pixman",                  # works on any screen, GPU or not
               WLR_NO_HARDWARE_CURSORS="1",
               GDK_BACKEND="wayland",
               GTK_THEME="Adwaita:dark",               # the page follows it: Unseenet's dark look
               WEBKIT_DISABLE_COMPOSITING_MODE="1",    # software rendering, no GPU needed
               WEBKIT_DISABLE_DMABUF_RENDERER="1",
               NO_AT_BRIDGE="1",
               HOME="/root")
    if media is not None:
        env["UNSEENET_HOME"] = str(media)
    return env


def kiosk_command() -> list[str]:
    return ["cage", "-d", "-s", "--", PY, "-m", "unseenet_web", "--kiosk"]


def text_menu() -> None:
    """The graphics did not start: unseenet's own text menu, on this console."""
    print("\nThe graphical client could not start on this screen. Starting the text menu ...\n", flush=True)
    time.sleep(2)
    os.execv(PY, [PY, "-m", "unseenet.boot"])


def session() -> None:
    core = system._core()
    media = core.find_media()
    if media is not None:
        core.writable(media)
    failures = 0
    while True:
        layout = system.keyboard()
        system.RESTART_FLAG.unlink(missing_ok=True)
        started = time.monotonic()
        KIOSK_UP.parent.mkdir(parents=True, exist_ok=True)
        KIOSK_UP.write_text("starting\n")              # the splash gives way to the window
        res = subprocess.run(kiosk_command(), env=session_env(media, layout))
        if system.RESTART_FLAG.exists() or res.returncode == system.RESTART:
            continue                                   # a new keyboard layout
        if time.monotonic() - started < 20:
            failures += 1
            if failures >= 2:
                text_menu()
        else:
            failures = 0


# --- the self-test ------------------------------------------------------------
def self_test() -> int:
    ok = True

    def check(name: str, good: bool, detail: str = "") -> None:
        nonlocal ok
        ok = ok and good
        print(f"[{'OK' if good else 'FAIL'}] {name}{': ' + detail if detail else ''}", flush=True)

    core = system._core()
    media = core.find_media()
    check("medium found", media is not None, str(media))
    if media is not None:
        check("data/ can be written", core.writable(media))
    try:
        import gi
        gi.require_version("Gtk", "3.0")
        gi.require_version("WebKit2", "4.1")
        from gi.repository import Gtk, WebKit2  # noqa: F401
        import webview  # noqa: F401
        check("window parts (GTK, WebKitGTK, pywebview)", True)
    except Exception as exc:  # noqa: BLE001
        check("window parts (GTK, WebKitGTK, pywebview)", False, f"{type(exc).__name__}: {exc}")
    check("kiosk compositor (cage)", shutil.which("cage") is not None)
    cards = sorted(str(p) for p in Path("/dev/dri").glob("card*")) if Path("/dev/dri").exists() else []
    check("a screen to draw on", bool(cards), ", ".join(cards) or "no /dev/dri/card*")
    addrs = core.addresses()
    for _ in range(90):                        # the network may still be coming up (DHCP)
        if addrs:
            break
        time.sleep(1)
        addrs = core.addresses()
    check("network", bool(addrs), ", ".join(f"{i} {a}" for i, a in addrs) or "no address")

    # The real thing: the client in the kiosk, its page loaded and its script running.
    with tempfile.TemporaryDirectory(prefix="unseenet-web-selftest-") as tmp:
        marker = Path(tmp) / "page-loaded"
        env = session_env(None, "us")
        env.update(UNSEENET_HOME=tmp, UNSEENET_WEB_MARKER=str(marker))
        log = Path(tmp) / "kiosk.log"
        with open(log, "wb") as out:
            proc = subprocess.Popen(kiosk_command(), env=env, stdout=out, stderr=subprocess.STDOUT)
            for _ in range(180):
                if marker.exists() or proc.poll() is not None:
                    break
                time.sleep(1)
            loaded = marker.exists()
            if proc.poll() is None:
                shot = shutil.which("grim")
                if shot and loaded and media is not None:      # a picture of it, for the docs
                    time.sleep(3)
                    subprocess.run([shot, str(media / "data" / "selftest-screen.png")], env=env, timeout=20)
                proc.terminate()
                try:
                    proc.wait(10)
                except subprocess.TimeoutExpired:
                    proc.kill()
        check("the client starts full screen and its page runs", loaded,
              "" if loaded else log.read_text(errors="replace")[-1500:])

    try:
        from unseenet.core.tor import TorProcess
        binary = TorProcess.find_binary()
        version = TorProcess.binary_version(binary)
        check("Tor", bool(version), version or str(binary))
    except Exception as exc:  # noqa: BLE001
        check("Tor", False, str(exc))
    if ok and addrs:
        import asyncio
        from unseenet.core.tor import TorError

        async def connect() -> bool:
            with tempfile.TemporaryDirectory() as tdir:
                tor = TorProcess(Path(tdir), TorProcess.find_binary())
                try:
                    await tor.start(timeout=180)
                    return True
                except TorError as exc:
                    print(f"       {exc}")
                    return False
                finally:
                    await tor.stop()
        check("Tor connects to the Tor network", asyncio.run(connect()))
    print("UNSEENET-SELFTEST-OK" if ok else "UNSEENET-SELFTEST-FAILED", flush=True)
    return 0 if ok else 1


def main() -> None:
    if "--self-test" in sys.argv[1:]:
        sys.exit(self_test())
    session()


if __name__ == "__main__":
    main()
