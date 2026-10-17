#!/usr/bin/env python3
"""Record the README's demo and screenshots against the playground (tools/dev.sh).

    tools/dev.sh --no-browser --port 8770 > dev/web.log &
    python tools/record_demo.py dev/web.log docs/img

Needs Playwright (pip install playwright; playwright install chromium) and ffmpeg.
Writes demo.gif, threads.png, reply.png, chat.png, light.png and palette.png.
"""
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

W, H = 1280, 800


def main() -> None:
    log, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    url = re.search(r"(http://127\.0\.0\.1:\d+/#t=\S+)", log.read_text()).group(1)
    with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": W, "height": H}, color_scheme="dark",
                            record_video_dir=tmp, record_video_size={"width": W, "height": H})
        page = ctx.new_page()
        pause = lambda s=1.2: time.sleep(s)  # noqa: E731
        page.goto(url)
        page.wait_for_selector("#pass")
        pause(1)
        page.type("#pass", "test", delay=140)
        pause(0.4)
        page.keyboard.press("Enter")
        page.wait_for_selector(".side .item.group", timeout=60000)
        pause(3)
        page.click(".item:has-text(\"unseenet@\")")
        page.wait_for_selector(".prow")
        pause(1.2)
        page.click(".prow:has-text(\"Forwarding delay\") >> nth=0")
        pause(1.8)
        for _ in range(3):                         # read down the thread, as in a newsreader
            page.keyboard.press("ArrowDown")
            pause(1.6)
        page.screenshot(path=out / "threads.png")
        page.keyboard.press("r")                   # reply: the post quoted, the signature below
        page.wait_for_selector("#body")
        pause(1.2)
        page.keyboard.type("Agreed. I will write it up as a draft UN-RFC.", delay=40)
        pause(0.8)
        page.screenshot(path=out / "reply.png")
        page.keyboard.press("Control+s")
        page.wait_for_selector(".prow.pending", timeout=10000)
        pause(1)
        page.wait_for_selector(".prow.pending", state="detached", timeout=90000)
        pause(2.5)
        page.click(".item:has-text(\"dk.snak.chat\")")
        page.wait_for_selector('[data-k="chat"]')
        pause(1.5)
        page.type('[data-k="chat"]', "Hej fra webklienten!", delay=60)
        page.keyboard.press("Enter")
        page.wait_for_selector(".bubble.pending", timeout=10000)
        pause(1)
        page.wait_for_selector("text=reached the node", timeout=90000)
        pause(2)
        page.screenshot(path=out / "chat.png")
        page.keyboard.press("Escape")
        page.keyboard.press("Control+k")
        pause(0.6)
        page.keyboard.type("dk", delay=150)
        pause(1.5)
        page.screenshot(path=out / "palette.png")
        page.keyboard.press("Escape")
        pause(0.6)
        page.click(".item:has-text(\"operators\")")
        pause(2.5)
        page.keyboard.press("Escape")
        page.keyboard.press("Control+k")
        page.keyboard.type("light", delay=90)
        page.keyboard.press("Enter")
        pause(0.6)
        page.click(".item:has-text(\"dk.snak\") >> nth=0")
        page.wait_for_selector(".prow")
        page.click(".prow:has-text(\"Bornhack\") >> nth=2")
        pause(2.5)
        page.screenshot(path=out / "light.png")
        page.keyboard.press("Control+k")
        page.keyboard.type("dark", delay=90)
        page.keyboard.press("Enter")
        pause(1.5)
        video = page.video.path()
        ctx.close()
        b.close()
        gif = out / "demo.gif"
        ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
        filters = "fps=10,scale=960:-1:flags=lanczos"
        subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", video, "-vf",
                        f"{filters},split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
                        str(gif)], check=True)
        shutil.copy(video, out / "demo.webm")
    print("wrote", ", ".join(sorted(f.name for f in out.iterdir())))


if __name__ == "__main__":
    main()
