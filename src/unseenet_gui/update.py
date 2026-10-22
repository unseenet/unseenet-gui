"""Updating a stick or portable folder to a newer signed release (unseenet#264).

Off until this client's own builds are signed and announced: the releases the
core announces are unseenet's, without this client, and its updater refuses
this client's folders (unseenet#264, #266).
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

UPDATES = False                      # offer newer releases, with an Update button


class Updater:
    def __init__(self):
        self._stick: Path | None | bool = False      # not looked for yet

    def info(self, s) -> dict | None:
        """{"version", "channel", "here"} when a signed release is newer than this
        program; "here": this is a stick or portable folder that can update itself."""
        if not UPDATES or s is None or sys.platform == "emscripten" or not hasattr(s, "update_offer"):
            return None                                  # the web client updates by itself
        offer = s.update_offer()
        if not offer:
            return None
        if self._stick is False:
            from unseenet.update import find_stick
            self._stick = find_stick()
        return {**offer, "here": self._stick is not None}

    async def run(self, api) -> dict:
        """Run the updater (unseenet.update) for this stick or folder, over its own Tor.
        Its lines go to the page as ``x-gui-update`` events."""
        info = self.info(api.session)
        if not info or not info["here"]:
            return {"ok": False, "output": "Nothing to update here."}
        api.session.save()
        cmd = ([sys.executable, "update"] if getattr(sys, "frozen", False)
               else [sys.executable, "-m", "unseenet.update"])
        cmd += ["--media", str(self._stick), "--channel", info["channel"], "--yes"]
        _status(api, f"Updating to Unseenet {info['version']} ...")
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
