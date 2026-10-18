"""The boot splash of the bootable image: the logo on Unseenet green, drawn on the framebuffer.

    python -m unseenet_gui.splash [PANEL]

PANEL is a raw image made when the image is built (tools/image/make_splash.py):
an 8-byte header (width, height as little-endian uint32) and RGBA pixels. It is
blended onto the ink colour of unseenet.org and drawn in the middle of the
screen, with a small bar moving below it until the client's window takes over.
Without a framebuffer it does nothing; the boot carries on regardless.
"""

from __future__ import annotations

import mmap
import os
import struct
import sys
import time
from pathlib import Path

INK = (0x10, 0x30, 0x2A)
GREEN = (0x34, 0xD3, 0x99)
TRACK = (0x17, 0x3D, 0x35)
PANEL = Path("/usr/share/unseenet/splash.rgba")
DONE = Path(os.environ.get("UNSEENET_SPLASH_DONE", "/run/unseenet/kiosk-up"))
FB = Path(os.environ.get("UNSEENET_FB_SYS", "/sys/class/graphics/fb0"))     # overridable for tests
FB_DEV = os.environ.get("UNSEENET_FB_DEV", "/dev/fb0")


def geometry() -> tuple[int, int, int, int]:
    w, h = (int(x) for x in (FB / "virtual_size").read_text().strip().split(","))
    bpp = int((FB / "bits_per_pixel").read_text())
    stride = int((FB / "stride").read_text()) if (FB / "stride").exists() else w * bpp // 8
    return w, h, bpp, stride


def pixel(rgb: tuple[int, int, int], bpp: int) -> bytes:
    r, g, b = rgb
    if bpp == 32:
        return bytes((b, g, r, 0))                     # XRGB8888, the usual one
    if bpp == 16:
        return struct.pack("<H", ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3))
    if bpp == 24:
        return bytes((b, g, r))
    raise ValueError(bpp)


def main() -> int:
    panel_path = Path(sys.argv[1]) if len(sys.argv) > 1 else PANEL
    try:
        w, h, bpp, stride = geometry()
        fd = os.open(FB_DEV, os.O_RDWR)
    except (OSError, ValueError):
        return 0
    size = stride * h
    fb = mmap.mmap(fd, size)
    bypp = bpp // 8
    try:
        ink = pixel(INK, bpp)
    except ValueError:
        return 0
    row = ink * w + b"\0" * (stride - w * bypp)
    fb[:size] = row * h
    pw = ph = 0
    try:
        data = panel_path.read_bytes()
        pw, ph = struct.unpack("<II", data[:8])
        rgba = memoryview(data)[8:]
        scale = 2 if w >= 2 * pw + 200 and h >= 2 * ph + 200 else 1    # big screens: twice the size
        x0, y0 = (w - pw * scale) // 2, (h - ph * scale) // 2 - 40
        for y in range(ph):
            line = bytearray()
            for x in range(pw):
                r, g, b, a = rgba[(y * pw + x) * 4:(y * pw + x) * 4 + 4]
                mix = tuple((c * a + i * (255 - a)) // 255 for c, i in zip((r, g, b), INK))
                line += pixel(mix, bpp) * scale
            for s in range(scale):
                off = (y0 + y * scale + s) * stride + x0 * bypp
                if 0 <= off and off + len(line) <= size:
                    fb[off:off + len(line)] = bytes(line)
        ph *= scale
    except (OSError, struct.error):
        pass
    # a small bar that moves until the window is up (at most two minutes)
    bw, bh = 220, 4
    bx, by = (w - bw) // 2, min(h - 20, (h + ph) // 2 + 10)
    track, green = pixel(TRACK, bpp), pixel(GREEN, bpp)
    start = time.monotonic()
    pos = 0
    while not DONE.exists() and time.monotonic() - start < 120:
        for yy in range(by, by + bh):
            line = bytearray(track * bw)
            for xx in range(max(0, pos - 60), min(bw, pos)):
                line[xx * bypp:(xx + 1) * bypp] = green
            off = yy * stride + bx * bypp
            fb[off:off + len(line)] = bytes(line)
        pos = (pos + 8) % (bw + 60)
        time.sleep(0.04)
    fb.close()
    os.close(fd)
    return 0


if __name__ == "__main__":
    sys.exit(main())
