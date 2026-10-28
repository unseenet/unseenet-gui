"""#145 (UN-RFC 0050 section 5): a PIN on this device - a passkey with PRF, set up with
the passphrase, then unlocking with it; never on an address such as 127.0.0.1."""

import base64

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43


class Core:
    def __init__(self):
        self.unlocked, self.devices, self.added, self.unlocks = True, [], [], []

    async def handle(self, request):
        path = request.path
        if path == "/api/state":
            data = {"unlocked": self.unlocked, "vault_exists": True, "connected": False, "status": "Locked",
                    "identity": {"display": "Me", "label": "Me", "key": "ed25519:me"} if self.unlocked else None}
        elif path == "/x/gui/state":
            data = {"bootable": False, "web": False, "portable": False, "vault": "/tmp/me.vault"}
        elif path == "/api/device-unlock" and request.method == "GET":
            data = {"possible": True, "devices": self.devices}
        elif path == "/api/device-unlock":
            body = await request.json()
            self.added.append(body)
            self.devices = [{"id": body["id"], "label": body["label"], "created": 1}]
            data = {"possible": True, "devices": self.devices}
        elif path == "/api/unlock":
            self.unlocks.append(await request.json())
            data = {"unlocked": False, "vault_exists": True, "status": "Locked"}   # the test stops here
        elif path == "/api/groups":
            data = {"groups": [], "people": [], "hierarchies": [], "inbox": {"id": "inbox:x"}, "contacts": []}
        elif path == "/api/settings":
            data = {"signature_preview": "", "notices": {"send": True}}
        elif path == "/api/pictures":
            data = {"pictures": {}}
        else:
            data = {}
        return web.json_response(data)


async def events(request):
    ws = web.WebSocketResponse(protocols=["unseenet"])
    await ws.prepare(request)
    async for _ in ws:
        pass
    return ws


@pytest.fixture
async def pin_page():
    core = Core()
    app = web.Application()

    async def index(_request):
        return web.FileResponse(STATIC / "index.html")

    app.router.add_get("/", index)
    app.router.add_static("/static/", STATIC)
    app.router.add_get("/api/events", events)
    app.router.add_route("*", "/api/{path:.*}", core.handle)
    app.router.add_route("*", "/x/gui/{path:.*}", core.handle)
    async with TestServer(app, host="127.0.0.1") as server, playwright.async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        cdp = await page.context.new_cdp_session(page)
        await cdp.send("WebAuthn.enable")
        await cdp.send("WebAuthn.addVirtualAuthenticator", {"options": {
            "protocol": "ctap2", "ctap2Version": "ctap2_1", "transport": "internal",
            "hasResidentKey": True, "hasUserVerification": True, "isUserVerified": True,
            "hasPrf": True, "automaticPresenceSimulation": True}})
        try:
            yield page, core, server
        finally:
            await browser.close()
        assert errors == []


async def test_set_up_then_unlock_with_the_pin(pin_page):
    page, core, server = pin_page
    # a passkey needs a host name: localhost, not 127.0.0.1
    await page.goto(f"http://localhost:{server.port}/#t={TOKEN}")
    await page.wait_for_load_state("networkidle")
    assert await page.evaluate("devicePinPossible()")
    await page.evaluate("openDevicePin()")
    dialog = page.get_by_role("dialog", name="PIN on this device")
    await dialog.get_by_role("button", name="Set up", exact=True).click()
    await expect(dialog.locator(".error")).to_contain_text("passphrase is needed")   # asked first
    await dialog.locator("#pinpass").fill("pw")
    await dialog.get_by_role("button", name="Set up", exact=True).click()
    await expect(page.locator(".toast")).to_contain_text("Set up")
    [added] = core.added
    assert added["passphrase"] == "pw" and len(base64.b64decode(added["secret"])) == 32
    # locked again: the PIN unlocks, with the same secret
    core.unlocked = False
    await page.reload()
    await page.wait_for_load_state("networkidle")
    await page.locator('[data-k="pin-unlock"]').click()
    for _ in range(50):                                   # the passkey answers, then the core
        if core.unlocks:
            break
        await page.wait_for_timeout(100)
    assert core.unlocks == [{"device": added["id"], "secret": added["secret"]}]


async def test_not_on_an_address(pin_page):
    page, core, server = pin_page
    core.unlocked, core.devices = False, [{"id": "x", "label": "A phone", "created": 1}]
    await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)          # 127.0.0.1
    await page.wait_for_load_state("networkidle")
    assert not await page.evaluate("devicePinPossible()")
    await expect(page.locator('[data-k="pin-unlock"]')).to_have_count(0)
    await expect(page.locator("#pass")).to_be_visible()                 # the passphrase, as always
