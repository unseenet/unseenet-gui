#!/usr/bin/env python3
"""Every screen and dialog at phone, laptop and desktop sizes, against the playground (gui#264).

tests/test_layout.py runs the same checks in CI against recorded answers; this runs them
against a real node and core, and is how those answers are recorded:

    tools/dev.sh --no-browser --port 8771 > dev/web.log &
    python tools/layout_audit.py dev/web.log                    # print what is off
    SHOTS=dev/shots python tools/layout_audit.py dev/web.log    # and screenshots
    RECORD=tests/data/layout_api.json python tools/layout_audit.py dev/web.log
                                                                # record the API's answers

SIZES=phone390,desktop and THEMES=dark narrow it down.
"""
import json
import os
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))
from layout_screens import CHECK, DIALOGS, FOCUS_FIELD, KEYBOARD, RESET, SIZES, VIEWS, script  # noqa: E402


def main() -> None:
    url = re.search(r"(http://127\.0\.0\.1:\d+/#t=\S+)", Path(sys.argv[1]).read_text()).group(1)
    shots = Path(os.environ["SHOTS"]) if os.environ.get("SHOTS") else None
    record = Path(os.environ["RECORD"]) if os.environ.get("RECORD") else None
    only = os.environ["SIZES"].split(",") if os.environ.get("SIZES") else list(SIZES)
    themes = os.environ.get("THEMES", "dark,light").split(",")
    answers, report = {}, {}

    def keep(response):
        u = response.url.split("#")[0]
        path = u[u.index("/", 8):]
        if not (path.startswith("/api/") or path.startswith("/x/gui/")):
            return
        try:
            body = response.json()
        except Exception:
            return
        # an error is kept with its status, so the page meets it again as it did (no registrar etc.)
        answers[response.request.method + " " + path] = (
            body if response.status == 200 else {"__status": response.status, "body": body})

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for size, (w, hgt, mobile) in SIZES.items():
            if size not in only:
                continue
            for scheme in themes:
                ctx = browser.new_context(viewport={"width": w, "height": hgt}, is_mobile=mobile,
                                          has_touch=mobile, color_scheme=scheme)
                page = ctx.new_page()
                errors = []
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.on("console", lambda m: m.type == "error" and errors.append(m.text))
                if record:
                    page.on("response", keep)
                page.goto(url)
                page.wait_for_timeout(800)
                if page.locator("input[type=password]").count():
                    page.fill("input[type=password]", "test")
                    page.keyboard.press("Enter")
                page.wait_for_selector(".app", timeout=30000)
                page.wait_for_timeout(1500)
                for kind, items in (("view", VIEWS), ("dialog", DIALOGS)):
                    for name, js in items.items():
                        page.evaluate(RESET)
                        errors.clear()
                        page.evaluate(script(js))
                        page.wait_for_timeout(700)
                        found = page.evaluate(CHECK, {"phone": mobile, "dialog": kind == "dialog"})
                        if shots:
                            shots.mkdir(parents=True, exist_ok=True)
                            page.screenshot(path=str(shots / f"{name}__{size}__{scheme}.png"))
                        # the on-screen keyboard: the screen gets lower while a field has the cursor
                        if kind == "dialog" and mobile and page.evaluate(FOCUS_FIELD):
                            page.set_viewport_size({"width": w, "height": hgt - KEYBOARD})
                            page.wait_for_timeout(300)
                            found += ["keyboard up: " + f for f in
                                      page.evaluate(CHECK, {"phone": mobile, "dialog": True})]
                            page.set_viewport_size({"width": w, "height": hgt})
                        if errors:
                            found.append("console: " + " | ".join(errors)[:300])
                        report.setdefault(f"{kind}:{name}", {})[f"{size}-{scheme}"] = found
                ctx.close()
        browser.close()
    for key, by in report.items():
        problems = {}
        for where, found in by.items():
            for f in found:
                problems.setdefault(f, []).append(where.rsplit("-", 1)[0])
        if problems:
            print(f"\n== {key}")
            for f, where in problems.items():
                print(f"  - {f}   [{', '.join(sorted(set(where)))}]")
    if record:
        record.parent.mkdir(parents=True, exist_ok=True)
        record.write_text(json.dumps(answers, indent=1, sort_keys=True, ensure_ascii=False) + "\n")
        print(f"\nrecorded {len(answers)} answers to {record}")


if __name__ == "__main__":
    main()
