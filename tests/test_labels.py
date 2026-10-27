"""Tags and content warnings (#186, UN-RFC 0052, 0053): warnings as flags, blurred or
hidden as you chose and never silently; topics as chips; tags while writing; the
settings; the group's tags - against a synthetic local API.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_labels.py
"""

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC
from test_reports import GROUP, ReportsAPI, row

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43
SPOILER = {"warnings": [{"warning": "spoiler", "by": ["author", "Filmfolk"], "choice": "blur"}],
           "topics": [], "action": "blur"}
GORE = {"warnings": [{"warning": "gore", "by": ["Filmfolk"], "choice": "hide"}], "topics": [], "action": "hide"}


class LabelsAPI(ReportsAPI):
    def __init__(self, view="threads"):
        super().__init__(view=view)
        self.choices = {"spoiler": "blur"}

    def rows(self):
        kind = "chat" if self.view == "chat" else "post"
        a = row("<a@x>", "Slutningen", kind=kind)
        a["message"].update(tags=["spoiler", "serier"], labels=SPOILER, text="han dør til sidst")
        b = row("<b@x>", "Blodigt", kind=kind, minute=1)
        b["message"].update(labels=GORE, text="meget blod")
        c = row("<c@x>", "Trailer", kind=kind, minute=2)
        c["message"].update(tags=["serier"], labels={"warnings": [], "topics": ["teknik"], "action": "show"})
        return [a, b, c]

    def group(self):
        return {**super().group(), "tags": ["film"], "languages": ["da", "en"],
                "suggested_languages": {"codes": ["da"], "from": "group"}}

    async def handle(self, request):
        if request.path.startswith("/api/groups/tag:"):           # everything with a tag (0052)
            r = row("<t@x>", "Med tag", kind="post")
            r["message"].update(tags=["serier"])
            r.update(group_label="dk.snak")
            return web.json_response({"group": {"id": "tag:serier", "label": "#serier", "view": "feed",
                                                "tag": "serier", "hierarchy": "", "may_post": False,
                                                "kinds": ["post"], "pins": []}, "rows": [r]})
        if request.path.endswith("/language/choose"):            # unseenet#692
            body = await request.json()
            self.requests.append((request.path, body))
            return web.json_response({"codes": body["languages"], "from": "chosen"})
        if request.path.endswith("/language"):
            return web.json_response({"codes": ["da"], "from": "conversation"})
        if request.path == "/api/labels/profile":
            body = await request.json()
            self.requests.append((request.path, body))
            return web.json_response(self.labels())
        if request.path == "/api/labels/warning":
            body = await request.json()
            self.requests.append((request.path, body))
            self.choices[body["warning"]] = body["choice"]
            return web.json_response(self.labels())
        if request.path == "/api/labels":
            return web.json_response(self.labels())
        return await super().handle(request)

    def labels(self):
        words = ["profanity", "sexual", "nudity", "violence", "gore", "spoiler"]
        return {"profiles": [{"id": "under-13", "label": "Under 13", "choices": {w: "hide" for w in words}},
                             {"id": "adult", "label": "An adult", "choices": {w: "blur" for w in words}}],
                "labellers": [{"key": "ed25519:lab", "label": "Filmfolk", "yours": False, "topics": False,
                               "hierarchies": [], "groups": [GROUP], "on": True}],
                "warnings": [{"warning": w, "label": w.title(), "choice": self.choices.get(w, "blur")} for w in words],
                "mine": None}


@pytest.fixture
async def page_with(request):
    api = LabelsAPI(**request.param)
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
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            await page.goto(str(server.make_url("/")) + "#t=" + TOKEN)
            await page.wait_for_load_state("networkidle")
            await page.get_by_role("button", name="dk.snak").first.click()
            await page.wait_for_load_state("networkidle")
            yield page, api
        finally:
            await browser.close()
        assert errors == []


@pytest.mark.parametrize("page_with", [{}], indirect=True)
async def test_threads_stripe_hidden_line_and_reader(page_with):
    page, _ = page_with
    await expect(page.locator(".ghead .tchip.grp")).to_contain_text("film")      # the group's, once
    spoiler = page.locator(".prow", has_text="Slutningen")
    await expect(spoiler.locator(".wstripe.w-spoiler")).to_have_count(1)
    await expect(page.locator(".prow .lhidden")).to_have_text("Hidden: gore, from Filmfolk")  # never silently
    await spoiler.click()
    reader = page.locator(".reader")
    await expect(reader.locator(".wflag.w-spoiler")).to_contain_text("spoiler")
    await expect(reader.locator(".wby")).to_contain_text("the author, Filmfolk")
    await expect(reader.locator(".lveil")).to_contain_text("Text and pictures are hidden: spoiler")
    await expect(reader).not_to_contain_text("han dør til sidst")
    await expect(reader.locator(".tchip").first).to_have_text("serier")           # topics, not the warning
    await reader.get_by_role("button", name="Show anyway").click()
    await expect(reader).to_contain_text("han dør til sidst")


@pytest.mark.parametrize("page_with", [{}], indirect=True)
async def test_a_tag_filters_and_a_labellers_topic(page_with):
    page, _ = page_with
    await page.locator(".prow", has_text="Trailer").click()
    reader = page.locator(".reader")
    await expect(reader.locator(".tchip.lab")).to_contain_text("teknik")         # a labeller's topic
    await reader.locator(".tchip", has_text="serier").click()                      # everything with it
    await expect(page.locator(".feed-note")).to_contain_text("Everything tagged serier")
    await expect(page.locator(".entry")).to_have_count(1)


@pytest.mark.parametrize("page_with", [{"view": "feed"}], indirect=True)
async def test_a_feed_entry_has_its_flag_on_top(page_with):
    page, _ = page_with
    entry = page.locator(".entry", has_text="Slutningen")
    await expect(entry.locator(".wflag.w-spoiler")).to_be_visible()
    await expect(entry.locator(".lveil")).to_be_visible()
    await expect(page.locator(".entry", has_text="Blodigt").locator(".lveil.hidden")).to_contain_text("Hidden: gore")


@pytest.mark.parametrize("page_with", [{}], indirect=True)
async def test_writing_with_warnings_and_tags(page_with):
    page, api = page_with
    await page.keyboard.press("n")
    await page.locator("#subject").fill("Finalen")
    await page.locator("#body").fill("Om #Serier og !dk.film\n")
    await expect(page.locator(".tagfield .tchip.lab")).to_have_text("serier")      # from the text, at once
    await page.locator(".wpick.w-spoiler").click()
    tag = page.locator(".tagin")
    await tag.fill("finale")
    await tag.press("Enter")
    await page.locator(".dialog .df .btn.primary").click()
    await page.wait_for_timeout(300)
    [(_, body)] = [r for r in api.requests if r[0].endswith("/post")]
    assert body["tags"] == ["spoiler", "finale"] and "#Serier" in body["body"]   # the core adds #serier


@pytest.mark.parametrize("page_with", [{}], indirect=True)
async def test_the_settings(page_with):
    page, api = page_with
    await page.evaluate("openContentWarnings()")
    dlg = page.locator(".dialog")
    await expect(dlg).to_contain_text("Filmfolk")
    await expect(dlg).to_contain_text("named for dk.snak")
    await dlg.locator("input[name=w-spoiler][type=radio]").nth(2).check()          # hide
    await page.wait_for_timeout(300)
    assert ("/api/labels/warning", {"warning": "spoiler", "choice": "hide"}) in api.requests


@pytest.mark.parametrize("page_with", [{}], indirect=True)
async def test_the_age_guide(page_with):
    """UN-RFC 0053 6.1: choose who reads here; only the settings are sent, and it says
    plainly what it cannot do."""
    page, api = page_with
    await page.evaluate("openAgeGuide()")
    dlg = page.locator(".dialog")
    await expect(dlg).to_contain_text("It can only cover what is marked")
    await dlg.get_by_role("button", name="Use these settings").click()
    await expect(dlg).to_contain_text("Choose who reads here first")            # not without a choice
    await dlg.locator("input[name=age][value=under-13]").check()
    await dlg.get_by_role("button", name="Use these settings").click()
    await page.wait_for_timeout(300)
    assert ("/api/labels/profile", {"profile": "under-13"}) in api.requests


@pytest.mark.parametrize("page_with", [{"view": "chat"}], indirect=True)
async def test_languages_in_the_info_and_by_the_chat(page_with):
    """The group's languages in its info; a chat line's language as a chip by the input,
    changed with a click and sent with the next line (UN-RFC 0052 5a)."""
    page, api = page_with
    await page.evaluate("openInfo()")
    await expect(page.locator(".dialog")).to_contain_text("da, en (da first)")
    await page.keyboard.press("Escape")
    chip = page.locator(".chatbar .langchip")
    await expect(chip).to_have_text("da")
    await chip.click()
    await page.locator("#chlang").fill("en")
    await page.locator(".dialog .btn.primary").click()
    await expect(chip).to_have_text("en")
    assert any(r[0].endswith("/language/choose") and r[1] == {"languages": ["en"]} for r in api.requests)
    await page.locator("#chat").fill("Hello")
    await page.locator("#chat").press("Enter")
    await page.wait_for_timeout(300)
    [(_, body)] = [r for r in api.requests if r[0].endswith("/post")]
    assert body["languages"] == ["en"]
