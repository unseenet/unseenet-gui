"""Updating a stick or portable folder to a newer signed release (unseenet#264).

The graphical client's builds (``unseenet-gui-<version>-<kind>.zip``) are in
unseenet-portable's releases, signed in the same ``SHA256SUMS.txt`` as the terminal
client's and posted in ``unseenet.releases``. A core that knows two products in a
folder (``unseenet update --product gui``, unseenet 0.8) offers this client's newer
builds by this client's own version, and updates only its files, keeping ``data/``
and the terminal client's files if both are in the folder. With an older core
nothing is offered.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from . import __version__

PRODUCT = "unseenet-gui"
GRAPHICAL = "README-graphical.txt"   # in a folder or stick that has this client


def supported() -> bool:
    """The core can update this client's folders (it knows the product)."""
    try:
        from unseenet import update
    except ImportError:
        return False
    return hasattr(update, "GRAPHICAL_CLIENT")


class Updater:
    def __init__(self):
        self._stick: Path | None | bool = False      # not looked for yet

    def info(self, s) -> dict | None:
        """{"version", "channel", "label", "here"} when a signed build of this client is
        newer than this one; "here": this is a stick or portable folder of it, which can
        update itself."""
        if s is None or sys.platform == "emscripten" or not supported():
            return None                                  # the web client updates by itself
        try:
            offer = s.update_offer(PRODUCT, __version__)
        except TypeError:                                # an older core: no products
            return None
        if not offer:
            return None
        if self._stick is False:
            from unseenet.update import find_stick
            found = find_stick()
            self._stick = found if found is not None and (found / GRAPHICAL).exists() else None
        return {**offer, "label": "Unseenet graphical", "here": self._stick is not None}

    async def run(self, api) -> dict:
        """Run the updater (unseenet.update --product gui) for this stick or folder, over
        its own Tor. Its lines go to the page as ``x-gui-update`` events."""
        info = self.info(api.session)
        if not info or not info["here"]:
            return {"ok": False, "output": "Nothing to update here."}
        api.session.save()
        cmd = ([sys.executable, "update"] if getattr(sys, "frozen", False)
               else [sys.executable, "-m", "unseenet.update"])
        cmd += ["--media", str(self._stick), "--product", "gui", "--channel", info["channel"],
                "--yes"]
        _status(api, f"Updating to Unseenet graphical {info['version']} ...")
        proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE,
                                                    stderr=asyncio.subprocess.STDOUT)
        lines: list[str] = []
        async for raw in proc.stdout:
            for line in raw.decode("utf-8", "replace").replace("\r", "\n").splitlines():
                if line.strip():
                    lines.append(line.strip())
                    api.emit("x-gui-update", text=line.strip()[:200])
        code = await proc.wait()
        _status(api, "Updated - start Unseenet again" if code == 0 else "The update did not finish")
        return {"ok": code == 0, "output": "\n".join(lines[-12:])}


def _status(api, text: str) -> None:
    api.status = text
    api.emit("status", text=text)
