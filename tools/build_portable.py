#!/usr/bin/env python3
"""Build a portable Unseenet graphical client: one folder per platform, with Tor inside.

    python tools/build_portable.py --core ../unseenet                       # this platform
    python tools/build_portable.py --core ../unseenet --platform windows-x86_64 --tor-archive tor.tar.gz
    python tools/build_portable.py --core ../unseenet --fetch-tor linux-x86_64 --out tor/
    python tools/build_portable.py --core ../unseenet --combine dist/*.zip --out dist/

The Tor handling (download, OpenPGP check against the pinned Tor key, the
pinned version) is unseenet's own: ``--core`` points at a checkout of
github.com/unseenet/unseenet and its ``tools/build_portable.py`` is used, so
both projects ship the same, verified Tor.

A build is ``unseenet-gui-<version>-<platform>.zip``::

    Unseenet/
      UNSEENET-PORTABLE, README-graphical.txt, LICENSES/, the launcher for that platform
      gui-<platform>/unseenet-gui, _internal/          (PyInstaller, one folder)
      gui-<platform>/tor/                              (Tor Expert Bundle)

On Windows the program itself is the launcher, with the Unseenet icon and no
console window: ``Unseenet Graphical.exe`` at the top, its files and Tor in
``gui-windows-x86_64/``.

It uses the same top folder, marker and data/ as unseenet's portable build,
so both can be unpacked onto one stick and share the vault.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
TOP = "Unseenet"
MARKER = "UNSEENET-PORTABLE"
PLATFORMS = ("linux-x86_64", "windows-x86_64", "macos-aarch64", "macos-x86_64")
LAUNCHERS = {
    "linux": ["start-graphical-linux.sh"],
    "windows": [],                       # "Unseenet Graphical.exe" is its own launcher
    "macos": ["Start Unseenet Graphical.command"],
}
WINDOWS_EXE = "Unseenet Graphical"


def log(msg: str) -> None:
    print(f"[build-gui] {msg}", flush=True)


def version() -> str:
    text = (ROOT / "src" / "unseenet_gui" / "__init__.py").read_text()
    return re.search(r'__version__ = "([^"]+)"', text).group(1)


def core_tools(core: Path):
    """unseenet's tools/build_portable.py, as a module."""
    path = core / "tools" / "build_portable.py"
    if not path.is_file():
        sys.exit(f"{path} not found: --core must be a checkout of github.com/unseenet/unseenet")
    spec = importlib.util.spec_from_file_location("core_build_portable", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def make_ico(core: Path, target: Path) -> bool:
    try:
        from PIL import Image
        Image.open(core / "assets" / "icon-512.png").save(
            target, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
        return True
    except Exception as exc:  # noqa: BLE001
        log(f"no icon ({exc})")
        return False


def pyinstaller(plat: str, work: Path, core: Path) -> Path:
    entry = work / "unseenet_gui_entry.py"
    entry.write_text("from unseenet_gui.__main__ import main\nmain()\n")
    windows = plat.startswith("windows")
    cmd = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir",
           "--windowed" if windows else "--console",
           "--name", WINDOWS_EXE if windows else "unseenet-gui",
           "--distpath", str(work / "dist"), "--workpath", str(work / "build"), "--specpath", str(work),
           "--collect-submodules", "unseenet", "--collect-data", "unseenet",
           "--collect-submodules", "unseenet_gui", "--collect-data", "unseenet_gui",
           "--collect-submodules", "aiohttp",
           "--collect-all", "nacl", "--hidden-import", "_cffi_backend",
           "--collect-data", "certifi",
           # not used by the graphical client; unseenet.boot and the TUI import them
           "--exclude-module", "textual", "--exclude-module", "rich",
           "--exclude-module", "tkinter", "--exclude-module", "unittest", "--exclude-module", "PIL"]
    if not plat.startswith("linux"):
        cmd += ["--collect-all", "webview"]          # the app window (WebView2 / WKWebView)
    if not plat.startswith("windows"):
        cmd.append("--strip")
    ico = work / "unseenet.ico"
    if not plat.startswith("linux") and make_ico(core, ico):
        cmd += ["--icon", str(ico)]
        if windows:                              # for the window, too (winfix.set_window_icon)
            cmd += ["--add-data", f"{ico}{os.pathsep}."]
    if windows:
        cmd += ["--contents-directory", f"gui-{plat}"]
    cmd.append(str(entry))
    log("running PyInstaller")
    subprocess.run(cmd, check=True, cwd=work)
    return work / "dist" / (WINDOWS_EXE if windows else "unseenet-gui")


def add_launchers(top: Path, system: str) -> None:
    for name in LAUNCHERS[system]:
        data = (TOOLS / "portable" / name).read_bytes().replace(b"\r\n", b"\n")
        if system == "windows":
            data = data.replace(b"\n", b"\r\n")
        (top / name).write_bytes(data)
        (top / name).chmod(0o644 if system == "windows" else 0o755)


def common_files(top: Path) -> None:
    (top / MARKER).write_text(
        "This folder is a portable Unseenet. Its programs keep everything in data/\n"
        "beside them. Delete this file to make them use the current directory.\n")
    shutil.copy2(TOOLS / "portable" / "README-graphical.txt", top / "README-graphical.txt")
    licenses = top / "LICENSES"
    licenses.mkdir(exist_ok=True)
    shutil.copy2(ROOT / "LICENSE", licenses / "unseenet-gui-LICENSE.txt")


def write_zip(stage: Path, zip_path: Path) -> None:
    """Zip keeping Unix modes and symlinks. No UNSEENET-VERSION/FILES: those belong
    to the terminal client's updater, which must not mistake this zip for its own."""
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for path in sorted(stage.rglob("*")):
            arc = (Path(TOP) / path.relative_to(stage)).as_posix()
            info = zipfile.ZipInfo(arc + ("/" if path.is_dir() and not path.is_symlink() else ""),
                                   (2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            if path.is_symlink():
                info.external_attr = 0o120777 << 16
                z.writestr(info, os.readlink(path))
            elif path.is_dir():
                info.external_attr = (0o40755 << 16) | 0x10
                z.writestr(info, b"")
            else:
                mode = 0o755 if (path.stat().st_mode & 0o111) else 0o644
                info.external_attr = (0o100000 | mode) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, path.read_bytes())


def build(plat: str, tor_archive: Path, out: Path, core: Path) -> Path:
    up = core_tools(core)
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        stage = work / "stage" / TOP
        prog = stage / f"gui-{plat}"
        stage.mkdir(parents=True)
        common_files(stage)
        add_launchers(stage, plat.split("-")[0])
        built = pyinstaller(plat, work, core)
        if plat.startswith("windows"):           # the exe at the top, its files (and Tor) below
            shutil.copytree(built, stage, symlinks=True, dirs_exist_ok=True)
        else:
            shutil.copytree(built, prog, symlinks=True)
        up.check_archive_digest(tor_archive)
        up.unpack_tor(tor_archive, prog / "tor", stage / "LICENSES")
        (prog / "tor" / "VERSION").write_text(tor_archive.name + "\n")
        out.mkdir(parents=True, exist_ok=True)
        zip_path = out / f"unseenet-gui-{version()}-{plat}.zip"
        write_zip(stage, zip_path)
    log(f"built {zip_path} ({zip_path.stat().st_size // (1024 * 1024)} MB)")
    return zip_path


def combine(zips: list[Path], out: Path, core: Path) -> Path:
    up = core_tools(core)
    with tempfile.TemporaryDirectory() as tmp:
        for z in zips:
            log(f"adding {z.name}")
            up.extract_zip(z, Path(tmp))
        stage = Path(tmp) / TOP
        for system in LAUNCHERS:
            add_launchers(stage, system)
        out.mkdir(parents=True, exist_ok=True)
        zip_path = out / f"unseenet-gui-{version()}-usb.zip"
        write_zip(stage, zip_path)
    log(f"built {zip_path} ({zip_path.stat().st_size // (1024 * 1024)} MB)")
    return zip_path


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--core", type=Path, default=Path(os.environ.get("UNSEENET_CORE", ROOT.parent / "unseenet")),
                   help="checkout of github.com/unseenet/unseenet (default: ../unseenet or $UNSEENET_CORE)")
    p.add_argument("--platform", choices=PLATFORMS)
    p.add_argument("--tor-archive", type=Path, help="an expert bundle fetched with --fetch-tor")
    p.add_argument("--fetch-tor", nargs="+", metavar="PLATFORM", help="download and verify bundles, then stop")
    p.add_argument("--combine", nargs="+", type=Path, metavar="ZIP", help="merge platform zips into one USB zip")
    p.add_argument("--checksums", nargs="+", type=Path, metavar="FILE", help="write SHA256SUMS.txt")
    p.add_argument("--out", type=Path, default=ROOT / "dist-portable")
    args = p.parse_args()
    core = args.core.resolve()
    up = core_tools(core)
    if args.fetch_tor:
        for plat in args.fetch_tor:
            up.fetch_tor(plat, up.pinned_tor_version(), args.out)
        return
    if args.combine:
        combine(args.combine, args.out, core)
        return
    if args.checksums:
        print(up.checksums(args.checksums, args.out).read_text(), end="")
        return
    plat = args.platform or up.this_platform()
    archive = args.tor_archive or up.fetch_tor(plat, up.pinned_tor_version(), args.out / "tor-download")
    build(plat, archive, args.out, core)


if __name__ == "__main__":
    main()
