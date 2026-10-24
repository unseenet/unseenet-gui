"""Your nodes (#111, unseenet#518) against a synthetic local API: the box at the bottom
left shows the node by name with the full address on hover and opens Your nodes; the
status bar no longer repeats "Connected to ..."; nodes are listed by name with their
onion address, a node's own name marked unlisted; add, make default and remove; and
Your nodes is in the palette.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_nodes.py
"""

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43
ONE = "f6vnchi5p7ll4yn6yot6cz4ohzuxy3uhc3kztafuwn3zlyoup6tn64qd.onion"
TWO = "ze4aqpjfyteij4tqaaztyujoj7wsjgbv4cliexljckdfp5eomkshfead.onion"
THREE = "abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefgh.onion"


def entry(address, name, source, label, default=False, groups=0, description=""):
    return {"address": address, "name": name, "source": source, "label": label,
            "description": description, "operator": "", "default": default, "groups": groups}


class NodesAPI:
    """Synthetic answers only: no vault, Tor or nodes."""

    def __init__(self):
        self.nodes = [entry(ONE, "unseenet-node1", "known", "unseenet-node1", True, 4, "Project test node 1"),
                      entry(TWO, "unseenet-node1", "self", "unseenet-node1 (unlisted)", groups=1)]
        self.known = [entry(THREE, "unseenet-node3", "known", "unseenet-node3", description="Project node 3")]
        self.changes = []
        self.connected = True
        self.ws = None

    def state(self):
        return {"unlocked": True, "connected": self.connected, "status": "Connected to unseenet-node1",
                "status_idle": True, "identity": {"display": "Me", "label": "Me", "key": "ed25519:me"},
                "node": self.nodes[0]["address"], "node_label": self.nodes[0]["label"],
                "nodes": [n["address"] for n in self.nodes],
                "node_names": {n["address"]: {k: n[k] for k in ("name", "source", "label")} for n in self.nodes}}

    async def events(self, request):
        ws = web.WebSocketResponse(protocols=["unseenet"])
        await ws.prepare(request)
        self.ws = ws
        async for _ in ws:
            pass
        return ws

    async def handle(self, request):
        path = request.path
        if path == "/api/state":
            data = self.state()
        elif path == "/x/gui/state":
            data = {"bootable": False, "web": False}
        elif path == "/api/settings":
            data = {"signature_preview": "", "notices": {"send": True}}
        elif path == "/api/groups":
            data = {"groups": [], "people": [], "hierarchies": [], "inbox": {"id": "inbox:test"}}
        elif path == "/api/nodes" and request.method == "POST":
            body = await request.json()
            self.changes.append(body)
            moved = []
            if body["action"] == "add":
                k = next(n for n in self.known if n["address"] == body["address"])
                self.known.remove(k)
                self.nodes.append(k)
            elif body["action"] == "default":
                n = next(n for n in self.nodes if n["address"] == body["address"])
                self.nodes.remove(n)
                for x in self.nodes:
                    x["default"] = False
                n["default"] = True
                self.nodes.insert(0, n)
            elif body["action"] == "remove":
                self.nodes = [n for n in self.nodes if n["address"] != body["address"]]
                moved = ["alt.x@ab"]
            data = {"nodes": self.nodes, "known": self.known, "moved": moved}
        elif path == "/api/nodes":
            nodes = [dict(n) for n in self.nodes]
            if request.query.get("info"):
                for n in nodes:
                    up = n["address"] != TWO
                    n["reachable"], n["info"] = up, ({"name": n["name"], "software": "unseenet 0.5.0",
                                                     "policy": {"retention_days": 90}} if up else None)
            data = {"nodes": nodes, "known": self.known}
        else:
            data = {}
        return web.json_response(data)


@pytest.fixture
async def page_api():
    api = NodesAPI()
    app = web.Application()

    async def index(_request):
        return web.FileResponse(STATIC / "index.html")

    app.router.add_get("/", index)
    app.router.add_static("/static/", STATIC)
    app.router.add_get("/api/events", api.events)
    app.router.add_route("*", "/api/{path:.*}", api.handle)
    app.router.add_route("*", "/x/gui/{path:.*}", api.handle)
    async with TestServer(app, host="127.0.0.1") as server, playwright.async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
            await page.wait_for_load_state("networkidle")
            yield page, api
        finally:
            await browser.close()
        assert errors == []


async def test_the_box_names_the_node_and_the_status_bar_does_not_repeat_it(page_api):
    page, api = page_api
    link = page.locator("[data-k='node-link']")
    await expect(link).to_contain_text("Tor · unseenet-node1")
    assert ONE in await link.get_attribute("title")
    bar = page.locator(".statusbar .st")
    await expect(bar).to_have_text("pre-alpha")
    assert "Connected" not in await bar.inner_text()


async def test_your_nodes_by_name_with_their_addresses(page_api):
    page, api = page_api
    await page.locator("[data-k='node-link']").click()
    dialog = page.get_by_role("dialog", name="Your nodes")
    first, second = dialog.locator(f"[data-k='node:{ONE}']"), dialog.locator(f"[data-k='node:{TWO}']")
    await expect(first).to_contain_text("unseenet-node1")
    await expect(first).to_contain_text("listed")
    await expect(first).to_contain_text(ONE)
    await expect(first).to_contain_text("Project test node 1")
    await expect(first).to_contain_text("4 groups")
    await expect(second).to_contain_text("unlisted")                 # the same name, but its own
    await expect(second).to_contain_text(TWO)
    await expect(second).to_contain_text("does not answer")
    await expect(first).to_contain_text("answers")
    await first.get_by_role("button", name="Details").click()
    await expect(first).to_contain_text("unseenet 0.5.0")
    await expect(first).to_contain_text("90 days")


async def test_add_make_default_and_remove(page_api):
    page, api = page_api
    await page.locator("[data-k='node-link']").click()
    dialog = page.get_by_role("dialog", name="Your nodes")
    await dialog.locator(f"[data-k='add:{THREE}']").click()
    await expect(dialog.locator(f"[data-k='node:{THREE}']")).to_contain_text("unseenet-node3")
    assert api.changes[-1] == {"action": "add", "address": THREE}

    await dialog.locator(f"[data-k='node:{THREE}']").get_by_role("button", name="Make default").click()
    assert api.changes[-1] == {"action": "default", "address": THREE}
    await expect(page.locator("[data-k='node-link']")).to_contain_text("unseenet-node3")

    await dialog.locator(f"[data-k='node:{TWO}']").get_by_role("button", name="Remove").click()
    await page.get_by_role("dialog", name="Stop using this node?").get_by_role("button", name="Remove").click()
    assert api.changes[-1] == {"action": "remove", "address": TWO}
    await expect(page.locator(".toast")).to_contain_text("1 group now read from unseenet-node3")
    await expect(page.get_by_role("dialog", name="Your nodes").locator(f"[data-k='node:{TWO}']")).to_have_count(0)


async def test_in_the_palette(page_api):
    page, api = page_api
    await page.keyboard.press("Control+p")
    await page.keyboard.type("switch")
    await page.keyboard.press("Enter")
    await expect(page.get_by_role("dialog", name="Your nodes")).to_be_visible()


async def test_the_box_says_how_the_default_node_is_not_what_the_status_line_said(page_api):
    page, api = page_api
    api.connected = False                                         # the first round is not done
    await page.reload()
    await page.wait_for_load_state("networkidle")
    link = page.locator("[data-k='node-link']")
    await expect(link).to_have_text("Connecting · unseenet-node1")     # named, always
    for _ in range(50):
        if api.ws is not None:
            break
        await page.wait_for_timeout(100)
    await api.ws.send_json({"event": "status", "text": "Connected to unseenet-node3", "idle": True})
    await api.ws.send_json({"event": "node-state", "address": TWO, "up": True, "error": None})
    await page.wait_for_timeout(300)
    await expect(link).to_have_text("Connecting · unseenet-node1")     # another node: not this
    await expect(page.locator(".statusbar .st")).to_have_text("pre-alpha")
    await api.ws.send_json({"event": "node-state", "address": ONE, "up": False, "error": "timed out"})
    await expect(link).to_have_text("Not reachable · unseenet-node1")
    assert "timed out" in await link.get_attribute("title")
    await api.ws.send_json({"event": "node-state", "address": ONE, "up": True, "error": None})
    await expect(link).to_have_text("Tor · unseenet-node1")
