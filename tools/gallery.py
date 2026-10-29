#!/usr/bin/env python3
"""One page of every screen and dialog, phone beside desktop, to judge consistency (gui#264).

Phone and desktop may be laid out differently, but must stay recognisably the same app:
the same places, names, icons and order. Make the screenshots, then the page:

    SHOTS=dev/shots python -m pytest -q tests/test_layout.py     # or tools/layout_audit.py
    python tools/gallery.py dev/shots dev/gallery.html [dark|light]

The page embeds the pictures, so it can be attached to a pull request as one file.
"""
import base64
import html
import sys
from pathlib import Path

ORDER = ["phone360", "phone390", "laptop", "desktop", "wide"]


def main() -> None:
    shots, out = Path(sys.argv[1]), Path(sys.argv[2])
    theme = sys.argv[3] if len(sys.argv) > 3 else "dark"
    screens = {}
    for f in sorted(shots.glob(f"*__{theme}.png")):
        name, size, _ = f.stem.split("__")
        screens.setdefault(name, {})[size] = f
    rows = []
    for name, by in screens.items():
        cells = []
        for size in ("phone390", "desktop"):
            f = by.get(size)
            img = (f'<img loading="lazy" alt="{html.escape(name)} on {size}" src="data:image/png;base64,'
                   f'{base64.b64encode(f.read_bytes()).decode()}">' if f else '<p class="none">not shot</p>')
            cells.append(f'<figure class="{size}">{img}<figcaption>{size}</figcaption></figure>')
        others = ", ".join(s for s in ORDER if s in by and s not in ("phone390", "desktop"))
        rows.append(f'<section><h2>{html.escape(name)}</h2><div class="pair">{"".join(cells)}</div>'
                    f'<p class="also">Also shot at: {others or "-"}</p></section>')
    out.write_text(f"""<!doctype html><meta charset="utf-8"><title>Screens, phone and desktop</title>
<style>
 body {{ font: 14px/1.5 system-ui, sans-serif; margin: 24px; background: #111; color: #ddd; }}
 section {{ margin: 0 0 40px; }} h2 {{ font-size: 16px; margin: 0 0 8px; }}
 .pair {{ display: flex; gap: 24px; align-items: flex-start; flex-wrap: wrap; }}
 figure {{ margin: 0; }} figcaption, .also, .none {{ color: #888; font-size: 12px; }}
 .phone390 img {{ width: 260px; }} .desktop img {{ width: 820px; max-width: 100%; }}
 img {{ border: 1px solid #333; border-radius: 6px; }}
</style>
<h1>Every screen and dialog, phone beside desktop ({html.escape(theme)})</h1>
<p>gui#264: the same places, names, icons and order on both.</p>
{"".join(rows)}
""")
    print(f"{len(screens)} screens in {out}")


if __name__ == "__main__":
    main()
