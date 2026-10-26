"""#152: the page's scripts - every one index.html loads exists, opens with what belongs
in it, and says "use strict"; and every script in static/ is loaded."""
import re
from pathlib import Path

STATIC = Path(__file__).resolve().parent.parent / "src" / "unseenet_gui" / "static"


def scripts():
    return re.findall(r'<script src="/static/([^"]+)"', (STATIC / "index.html").read_text())


def test_every_script_exists_with_its_header():
    names = scripts()
    assert names and names[0] == "core.js" and "start.js" in names
    for name in names:
        text = (STATIC / name).read_text()
        assert "/" not in name, name                 # the core serves static/ flat only
        assert text.lstrip().startswith(("//", "/*")), f"{name} opens without saying what belongs in it"
        assert '"use strict";' in text[:2000], f"{name} is not strict"


def test_start_comes_after_the_split_parts():
    names = scripts()
    assert names.index("start.js") > names.index("events.js") > names.index("core.js")


def test_every_script_is_loaded():
    assert sorted(p.name for p in STATIC.glob("*.js")) == sorted(scripts()), \
        "a script in static/ that index.html does not load, or the other way round"
