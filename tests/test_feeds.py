"""Feeds (#60, UN-RFC 0034, UN-RFC 0046 section 4.14) against a synthetic local API: a
group shown as a feed with every entry whole and its comments under it, commenting
and answering a comment, the timeline, following from a profile, whom you follow, and
starting your own feed only after the warning.

Run with: pip install -e '.[dev]' playwright; playwright install chromium;
python -m pytest -q tests/test_feeds.py
"""

import asyncio

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from unseenet_gui.server import STATIC

playwright = pytest.importorskip("playwright.async_api")
expect = playwright.expect

TOKEN = "t" * 43
FEED = "feed@bobbobbobbobbobb"
SITE = "site@bobbobbobbobbobb"
BOB = "ed25519:bob"
OK = {"allowed": True, "reason": "", "code": "ok"}
CLOSED = {"allowed": False, "reason": "Comments are closed on this entry", "code": "comments_closed"}


def row(mid, text, depth=0, kind="chat", subject="", refs=(), who="Bob", key=BOB, comment=OK,
        group=FEED, mine=False):
    return {"who": who, "who_key": key, "mine": mine, "may_edit": False, "may_withdraw": False,
            "read": True, "depth": depth, "comment": comment, "reply": OK,
            "group_label": "Bob's feed", "address": f"unseenet:{group}?m={mid.strip('<>')}",
            "message": {"id": mid, "group": group, "subject": subject, "text": text,
                        "signature": "", "references": list(refs), "kind": kind,
                        "readable": True, "sender_key": key, "private": False,
                        "date": "2026-01-01T12:00:00Z"}}


class FeedAPI:
    """Synthetic answers only: no vault, Tor or outgoing messages."""

    def __init__(self):
        self.posted, self.follows, self.started = [], [], []
        self.following = False
        self.subscribed = True               # False: Bob's feed read without following (#506)
        self.subscribes = []
        self.outbox = []                     # events to send to the page
        self.by_person = False               # people_followed (gui#210, unseenet#706)
        self.in_timeline = True              # UN-RFC 0034 6.2: a feed is in it by default
        self.timeline_calls = []
        self.changed = []                    # withdraw and edit, from the ⋯ menu
        self.entry_mine = False
        self.many = 0                     # more entries, for a feed taller than the window
        self.imported = False             # the second entry first published on Facebook (#137)
        self.comments = [row(f"<c{i}@x>", f"Kommentar {i}", 1, refs=["<a@x>"], who=f"Læser {i}",
                             key=f"ed25519:r{i}") for i in range(4)]
        self.comments.append(row("<d@x>", "Svar på svar", 2, refs=["<a@x>", "<c1@x>"], who="Dybt",
                                 key="ed25519:deep"))
        self.comments.append(row("<e@x>", "Dybere", 2, refs=["<a@x>", "<c1@x>", "<d@x>"],
                                 who="Dybest", key="ed25519:deeper"))

    def rows(self, group=FEED):
        first = row("<a@x>", "En kort note", group=group)
        if getattr(self, "read_more", False):     # UN-RFC 0031 3.2.1: the author's cut
            first = row("<a@x>", "Kort indledning\n\n...\n\nResten af historien", kind="post",
                        subject="Med læs mere", group=group)
            first["tree"] = [{"t": "p", "c": [{"t": "text", "v": "Kort indledning"}]}, {"t": "more"},
                             {"t": "p", "c": [{"t": "text", "v": "Resten af historien"}]}]
        if self.entry_mine:
            first.update(mine=True, may_withdraw=True, may_edit=True)
        second = row("<b@x>", getattr(self, "long_text", "Lang tekst her"), kind="post",
                     subject="En overskrift", comment=CLOSED, group=group)
        if self.imported:                 # UN-RFC 0049: an import of the author's own
            second["message"].update(origin={"network": "facebook", "date": "2025-08-03T14:20:00Z",
                                             "id": None, "from": None}, old_on_arrival=True)
        return [first, *self.comments, second,
                *[row(f"<m{i}@x>", f"Note {i}", group=group) for i in range(self.many)]]

    def group(self, gid=FEED):
        return {"id": gid, "label": "Bob's feed", "type": "channel", "view": "feed",
                "owner_view": "feed", "hierarchy": "feed", "may_post": False, "unread": 0,
                "kinds": ["chat", "post"], "subscribed": self.subscribed,
                "in_timeline": self.in_timeline, "timeline_possible": True,
                "timeline": {"on": self.in_timeline, "possible": True, "default": True},
                "write": {"post": {"allowed": False, "reason": "Only Bob writes here", "code": "channel"},
                          "chat": {"allowed": False, "reason": "Only Bob writes here", "code": "channel"}}}

    async def events(self, request):
        ws = web.WebSocketResponse(protocols=["unseenet"])
        await ws.prepare(request)
        while not ws.closed:                 # events a test sends (self.outbox)
            while self.outbox:
                await ws.send_json(self.outbox.pop(0))
            await asyncio.sleep(0.05)
        return ws

    async def handle(self, request):
        path = request.path
        if path == "/api/state":
            data = {"unlocked": True, "connected": True, "status": "Connected",
                    "identity": {"display": "Me", "label": "Me", "key": "ed25519:me"}}
        elif path == "/x/gui/state":
            data = {"bootable": False, "web": False}
        elif path == "/api/settings":
            data = {"signature_preview": "", "notices": {"send": True}}
        elif path == "/api/groups":
            data = {"groups": [self.group()] + ([{**self.group(), "id": SITE, "label": "Bob's site",
                                                  "view": "pages", "hierarchy": "site"}] if self.by_person else []),
                    "people": [],
                    "hierarchies": [{"name": "feed", "tree": None}], "inbox": {"id": "inbox:test"},
                    "timeline": {"id": "timeline:", "feeds": 1},
                    **({"people_followed": [{"fingerprint": "b" * 16, "key": BOB, "label": "Bob",
                                             "groups": {"feed": FEED, "site": SITE}}],
                        "hierarchies": []} if self.by_person else {}),
                    "my_feed": {"id": "feed@memememememememe", "started": False, "unread": 0},
                    "my_site": {"id": "site@memememememememe", "started": True, "unread": 0}}
        elif path in (f"/api/groups/{FEED}/withdraw", f"/api/groups/{FEED}/edit"):
            self.changed.append((path.rsplit("/", 1)[1], await request.json()))
            data = {"ok": True, "job": "jx"}
        elif path == f"/api/groups/{FEED}/post":
            self.posted.append(await request.json())
            data = {"job": f"j{len(self.posted)}"}
        elif request.method == "GET" and path == f"/api/groups/{FEED}":
            data = {"group": self.group(), "rows": self.rows()}
        elif request.method == "GET" and path == "/api/groups/timeline:":
            data = {"group": {"id": "timeline:", "label": "Timeline", "view": "feed", "feeds": 1,
                              "may_post": False, "hierarchy": ""}, "rows": self.rows()}
        elif path == "/api/profile":
            data = {"key": request.query.get("key"), "label": "Bob", "mine": False, "hidden": False,
                    "profile": None, "address": "unseenet:" + "b" * 16, "feed": FEED,
                    "following": self.following, "theirs": {"feed": FEED, "site": None}}
        elif path == f"/api/groups/{FEED}/timeline":
            body = await request.json()
            self.timeline_calls.append(body)
            self.in_timeline = True if body["on"] is None else body["on"]
            data = {"ok": True, "on": self.in_timeline}
        elif path == "/api/subscribe":
            self.subscribes.append(await request.json())
            self.subscribed = True
            data = {"ok": True}
        elif path == "/api/following" and request.method == "POST":
            body = await request.json()
            self.follows.append(body)
            self.following = body.get("on", True)
            data = {"ok": True, "fingerprint": "b" * 16, "key": BOB, "name": None,
                    "feeds": [FEED], "new": [FEED]}
        elif path == "/api/following":
            data = {"people": [{"fingerprint": "b" * 16, "key": BOB, "name": None, "label": "Bob",
                                "feeds": [{"id": FEED, "label": "Bob's feed", "title": "",
                                           "type": "channel", "personal": True}]}],
                    "feeds": [{"id": FEED, "label": "Bob's feed", "title": "", "type": "channel",
                               "personal": True}]}
        elif path == "/api/feed" and request.method == "POST":
            self.started.append(await request.json())
            data = {"ok": True, "id": "feed@memememememememe"}
        elif path == "/api/feed":
            data = {"id": "feed@memememememememe", "started": False, "followed": False,
                    "warning": "A personal feed is public and tied to this identity.\n\nWhat you publish can be kept."}
        elif path == "/api/pictures":
            data = {"pictures": {}}
        else:
            data = {}
        return web.json_response(data)


@pytest.fixture
async def feed_page():
    api = FeedAPI()
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


async def open_feed(page):
    await page.get_by_role("button", name="Bob's feed").first.click()
    await page.wait_for_load_state("networkidle")


async def test_entries_whole_with_comments_under_them(feed_page):
    page, api = feed_page
    await open_feed(page)
    entries = page.locator(".entry")
    await expect(entries).to_have_count(2)
    note, post = entries.nth(0), entries.nth(1)
    await expect(note).to_contain_text("En kort note")
    await expect(note.locator(".etitle")).to_have_count(0)              # a note has no headline
    await expect(post.locator(".etitle")).to_have_text("En overskrift")
    await expect(note.locator(".comment")).to_have_count(1)             # the newest one (#143)
    await note.get_by_role("button", name="View 5 more comments").click()
    await expect(note.locator(".comment")).to_have_count(6)
    await expect(note.locator(".comment.answer").last).to_contain_text("in answer to Dybt")
    await expect(post).to_contain_text("Comments are closed.")
    await expect(post.locator(".cbar")).to_have_count(0)
    await expect(page.locator(".notebar")).to_have_count(0)            # a channel: only Bob writes

    box = note.locator('[data-k="c:<a@x>"]')
    await box.fill("Godt")
    await box.press("Shift+Enter")                                     # a new line (#122)
    await expect(box).to_have_value("Godt\n")
    assert not api.posted
    await box.fill("Godt sagt")
    await box.press("Enter")
    await expect(note.locator(".comment.pending")).to_contain_text("Godt sagt")
    assert api.posted[-1] == {"body": "Godt sagt", "references": ["<a@x>"], "kind": "chat"}

    await note.locator('.comment[data-id="<c1@x>"]').get_by_role("button", name="Answer").click()
    await expect(note.locator(".answering")).to_contain_text("Answering Læser 1")
    await page.locator('[data-k="c:<a@x>"]').fill("Enig")
    await page.locator('[data-k="c:<a@x>"]').press("Enter")
    await expect(note.locator(".comment.pending")).to_have_count(2)
    assert api.posted[-1]["references"] == ["<a@x>", "<c1@x>"]
    await expect(note.locator(".answering")).to_have_count(0)          # back to the entry


async def test_the_timeline_and_following(feed_page):
    page, api = feed_page
    await page.get_by_title("The feeds you follow and the groups you added, newest first").click()
    await page.wait_for_load_state("networkidle")
    await expect(page.locator(".feed-note")).to_contain_text("1 group in your timeline")
    await expect(page.locator(".entry").first.locator(".efeed")).to_have_text("in Bob's feed")

    await page.locator(".entry").first.get_by_role("button", name="Bob").first.click()   # the profile
    dialog = page.locator(".dialog")
    await dialog.get_by_role("button", name="Follow", exact=True).click()
    await expect(page.locator(".toast")).to_contain_text("Following Bob")
    assert api.follows[-1] == {"person": BOB, "on": True}
    await expect(dialog.get_by_role("button", name="Unfollow")).to_be_visible()
    await page.keyboard.press("Escape")

    await page.keyboard.press("Control+k")
    await page.keyboard.type("Whom you follow")
    await page.keyboard.press("Enter")
    await expect(page.locator(".dialog")).to_contain_text("Bob's feed")


async def test_starting_your_feed_warns_first(feed_page):
    page, api = feed_page
    await page.keyboard.press("Control+k")
    await page.keyboard.type("Your feed")
    await page.keyboard.press("Enter")
    dialog = page.locator(".dialog")
    await expect(dialog.locator(".warnbox")).to_contain_text("public and tied to this identity")
    assert api.started == []
    await dialog.get_by_label("No comments").check()
    await dialog.get_by_role("button", name="Start your feed").click()
    await expect(page.locator(".toast")).to_contain_text("Your feed is started")
    assert api.started == [{"comments": "none"}]


async def test_start_my_feed_at_the_top_of_the_sidebar(feed_page):
    """gui#101: "Start your feed" under For you and Timeline, as in the terminal client."""
    page, api = feed_page
    start = page.locator("nav.side .item.start")
    await expect(start).to_have_text("☰Start your feed")              # the site is started:
    await expect(page.locator("nav.side .item", has_text="Your site")).to_have_count(1)
    await start.click()
    dialog = page.locator(".dialog")
    await expect(dialog.locator(".warnbox")).to_contain_text("public and tied to this identity")
    await dialog.get_by_role("button", name="Start your feed").click()
    await expect(page.locator(".toast")).to_contain_text("Your feed is started")
    assert api.started == [{"comments": "open"}]


async def test_a_feed_switches_to_threads_and_back(feed_page):
    page, _ = feed_page
    await open_feed(page)
    await expect(page.get_by_role("button", name="Show as threads")).to_be_visible()


async def test_folded_comments_keep_your_conversations(feed_page):
    # a comment naming you is shown with what it answers and the answers under it,
    # besides the newest one; the rest stay folded (unseenet-gui#143)
    page, api = feed_page
    api.comments[0]["for_me"] = "mention"                    # Læser 0 names you
    api.comments.insert(1, row("<f@x>", "Svar til Læser 0", 2, refs=["<a@x>", "<c0@x>"],
                               who="Svarer", key="ed25519:f"))
    await open_feed(page)
    note = page.locator(".entry").first
    shown = note.locator(".comment")
    await expect(shown).to_have_count(3)                     # c0, its answer, and the newest one
    await expect(note.locator('.comment[data-id="<c0@x>"]')).to_be_visible()
    await expect(note.locator('.comment[data-id="<f@x>"]')).to_be_visible()
    await expect(note.locator('.comment[data-id="<c2@x>"]')).to_have_count(0)
    await note.get_by_role("button", name="View 4 more comments").click()
    await expect(shown).to_have_count(7)
    await note.get_by_role("button", name="Show fewer").click()
    await expect(shown).to_have_count(3)


async def test_a_long_feed_scrolls_by_itself_not_the_page(feed_page):
    # the hidden labels of the comment boxes (.sr) sat where they would be in the
    # document, far below the window, and gave the page a second scroll bar
    page, api = feed_page
    api.many = 30
    await open_feed(page)
    await expect(page.locator(".entry")).to_have_count(32)
    size = await page.evaluate("[document.scrollingElement.scrollHeight, innerHeight]")
    assert size[0] <= size[1]
    feed = await page.evaluate("(e => [e.scrollHeight, e.clientHeight])(document.querySelector('.feed'))")
    assert feed[0] > feed[1]                                             # the feed scrolls


async def test_keys_in_a_feed_and_the_hints_for_them(feed_page):
    # unseenet#490: the footer shows the keys of the view you are in, and they work
    page, api = feed_page
    await open_feed(page)
    keys = page.locator(".statusbar .keys")
    await expect(keys).to_contain_text("↑↓ entries")
    await expect(keys).to_contain_text("V show as threads")
    await expect(keys).not_to_contain_text("Enter")              # entries are shown whole
    await expect(keys).not_to_contain_text("comment")            # nothing chosen yet
    await page.keyboard.press("ArrowDown")
    await expect(page.locator(".entry.on")).to_contain_text("En kort note")
    await expect(keys).to_contain_text("R comment")
    await page.keyboard.press("r")
    await expect(page.locator('[data-k="c:<a@x>"]')).to_be_focused()
    await page.keyboard.press("Escape")
    await page.keyboard.press("j")
    await expect(page.locator(".entry.on")).to_contain_text("En overskrift")
    await page.keyboard.press("r")                                # comments are closed there
    await expect(page.locator(".toast")).to_contain_text("Comments are closed")
    await page.locator(".statusbar .khint", has_text="entries").click()   # a hint is a button too
    await expect(page.locator(".entry.on")).to_have_count(1)


async def test_their_feed_from_the_profile_without_following(feed_page):
    """unseenet#506: their feed opens from the profile at once, read without following,
    with a Follow there; no "Their site" button when they have none."""
    page, api = feed_page
    api.subscribed = False
    await page.get_by_title("The feeds you follow and the groups you added, newest first").click()
    await page.locator(".entry").first.get_by_role("button", name="Bob").first.click()   # the profile
    dialog = page.locator(".dialog")
    await expect(dialog.get_by_role("button", name="Their feed")).to_be_visible()
    assert await dialog.get_by_role("button", name="Their site").count() == 0
    await dialog.get_by_role("button", name="Their feed").click()
    looking = page.locator(".ghead .looking")
    await expect(looking).to_contain_text("without following")
    assert api.subscribes == []
    await looking.get_by_role("button", name="Follow").click()
    await expect(page.locator(".toast")).to_contain_text("Following")
    assert api.subscribes == [{"id": FEED, "on": True}]


async def test_the_more_menu_withdraws_and_edits_your_comment(feed_page):
    """"⋯" on your own comment: Withdraw (delete) and Edit (a chat line: one line, no subject)."""
    page, api = feed_page
    api.comments[0].update(mine=True, may_withdraw=True, may_edit=True)
    await open_feed(page)
    mine = page.locator('.comment[data-id="<c0@x>"]')
    await mine.hover()
    await mine.get_by_role("button", name="More").click()
    await mine.get_by_role("menuitem", name="Withdraw (delete)").click()
    dialog = page.locator(".dialog")
    await expect(dialog).to_contain_text("Your comment")
    await dialog.get_by_role("button", name="Withdraw", exact=True).click()
    await expect(page.locator(".toast")).to_contain_text("Withdrawn")
    assert api.changed[-1] == ("withdraw", {"id": "<c0@x>"})
    await mine.hover()
    await mine.get_by_role("button", name="More").click()
    await mine.get_by_role("menuitem", name="Edit").click()
    await page.locator("#eline").fill("Rettet kommentar")
    await page.locator(".dialog").get_by_role("button", name="Save").click()
    for _ in range(50):
        if any(c[0] == "edit" for c in api.changed):
            break
        await page.wait_for_timeout(100)
    edit = next(c[1] for c in api.changed if c[0] == "edit")
    assert edit["id"] == "<c0@x>" and edit["subject"] == "" and edit["body"] == "Rettet kommentar\n"
    assert edit["kind"] == "chat"
    # someone else's comment has no menu
    other = page.locator('.comment[data-id="<c1@x>"]')
    assert await other.get_by_role("button", name="More").count() == 0


async def test_withdraw_is_found_by_delete_in_the_palette(feed_page):
    page, api = feed_page
    api.entry_mine = True
    await open_feed(page)
    await page.evaluate("S.post = '<a@x>'")                       # the entry, as ↑↓ selects it
    await page.keyboard.press("Control+k")
    await page.keyboard.type("delete")
    names = await page.locator(".dialog .cmd .nm").all_inner_texts()
    assert "Withdraw (delete) the selected post" in names


async def test_an_imported_entry_says_where_it_was_first_published(feed_page):
    """#137, UN-RFC 0049 section 5.1: the origin as a claim, the time of posting beside it."""
    page, api = feed_page
    api.imported = True
    await open_feed(page)
    origin = page.locator(".entry .origin")
    await expect(origin).to_have_count(1)
    await expect(origin).to_contain_text("Imported from Facebook")
    await expect(origin).to_contain_text("2025")
    assert "Posted" in (await origin.get_attribute("title"))



async def test_a_long_entry_is_cut_with_more_and_a_short_one_is_not(feed_page):
    """#143: a long entry shows a few lines and "… more", opened in place; a short one whole."""
    page, api = feed_page
    api.long_text = "\n\n".join(f"Afsnit {i}: " + "ord " * 40 for i in range(12))
    await open_feed(page)
    long = page.locator('.entry[data-id="<b@x>"]')
    short = page.locator('.entry[data-id="<a@x>"]')
    await expect(long.locator(".emore")).to_be_visible()
    await expect(short.locator(".emore")).to_be_hidden()
    box = await long.locator(".etext").bounding_box()
    assert box["height"] < 400
    await long.locator(".emore").click()
    await expect(long.get_by_role("button", name="Show less")).to_be_visible()
    assert (await long.locator(".etext").bounding_box())["height"] > box["height"] * 2
    await long.get_by_role("button", name="Show less").click()
    await expect(long.locator(".emore")).to_be_visible()


async def test_many_comments_twenty_at_a_time_and_which(feed_page):
    """Hundreds of comments: the newest and your own talks, then 20 at a time; or only
    those where you wrote, or that name you."""
    page, api = feed_page
    api.comments = [row(f"<k{i}@x>", f"Kommentar {i}", 1, refs=["<a@x>"], who=f"Læser {i}",
                        key=f"ed25519:k{i}") for i in range(47)]
    api.comments[5].update(mine=True)
    api.comments[9]["for_me"] = "mention"
    await open_feed(page)
    note = page.locator(".entry").first
    shown = note.locator(".comment")
    await expect(shown).to_have_count(3)                     # yours, the one naming you, the newest
    await note.get_by_role("button", name="View 20 of 44 more comments").click()
    await expect(shown).to_have_count(23)
    await note.get_by_role("button", name="Where you wrote").click()
    await expect(shown).to_have_count(1)
    await note.get_by_role("button", name="Mentions you").click()
    await expect(note.locator(".comment")).to_contain_text(["Kommentar 9"])
    await note.get_by_role("button", name="Newest").click()
    await expect(shown).to_have_count(23)


async def test_times_say_how_long_ago(feed_page):
    page, _ = feed_page
    await open_feed(page)
    got = await page.evaluate("""() => {
      const now = new Date("2026-10-26T20:00:00");
      const at = (s) => ago(new Date(now - s * 1000).toISOString(), now);
      return [at(10), at(300), at(2 * 3600), at(22 * 3600), at(3 * 86400), at(40 * 86400),
              ago(new Date("2024-03-05T10:00:00").toISOString(), now)];
    }""")
    assert got[:4] == ["now", "5 min", "2 h", got[3]] and got[3].startswith("Yesterday")
    assert got[4] == "3 days" and "2024" in got[6] and "2026" not in got[5]
    t = page.locator(".entry time.ago").first
    assert await t.get_attribute("datetime") and await t.get_attribute("title")


async def test_in_the_timeline_or_not(feed_page):
    """UN-RFC 0034 6.2: one switch in the group's head and in its ⋯, a mark in the list -
    not a second kind of follow; the view you read in is a separate button."""
    page, api = feed_page
    side = page.locator("nav.side .item").filter(has_text="Bob's feed")
    await expect(side.locator(".tl-mark")).to_have_count(1)
    await open_feed(page)
    switch = page.locator('[data-k="tl-switch"]')
    await expect(switch).to_have_text("☰ In timeline")
    await expect(switch).to_have_attribute("aria-pressed", "true")
    await switch.click()
    await expect(page.locator(".toast")).to_contain_text("no longer in your timeline")
    assert api.timeline_calls == [{"on": False}]
    await expect(switch).to_have_text("☰ Add to timeline")
    await expect(side.locator(".tl-mark")).to_have_count(0)
    await expect(page.get_by_role("button", name="Show as threads")).to_be_visible()
    await page.get_by_role("button", name="About this group").click()
    await expect(page.locator(".dialog").get_by_role("button", name="Leave")).to_be_visible()


async def test_an_entry_cut_at_the_authors_read_more_line(feed_page):
    """gui#188: cut at the "..." line even when short, "… more" shown; opened, the whole
    text without the line."""
    page, api = feed_page
    api.read_more = True
    await open_feed(page)
    entry = page.locator(".entry").first
    await expect(entry.locator(".etext")).to_contain_text("Kort indledning")
    await expect(entry.locator(".etext")).not_to_contain_text("Resten")
    more = entry.get_by_role("button", name="… more")
    await expect(more).to_be_visible()
    await more.click()
    await expect(entry.locator(".etext")).to_contain_text("Resten af historien")
    assert "..." not in await entry.locator(".etext").inner_text()


async def test_a_node_not_answering_yet_is_said_plainly(feed_page):
    """gui#206 (unseenet#704): the groups the others have are shown; the slow node is
    named in the status bar until it answers."""
    page, api = feed_page
    api.outbox.append({"event": "refreshed", "available": 1, "subscribed": 1,
                       "unreachable": [], "slow": ["abcdefghijklmnop.onion:119"]})
    slow = page.locator(".statusbar .slow-node")
    await expect(slow).to_contain_text("not answering yet")
    api.outbox.append({"event": "node-state", "address": "abcdefghijklmnop.onion:119", "up": True})
    await expect(slow).to_have_count(0)


async def test_a_persons_feed_and_site_under_them(feed_page):
    """gui#210: following a person puts their feed and site under their name, in People
    you follow - not on two branches called feed and site."""
    page, api = feed_page
    api.by_person = True
    await page.evaluate("loadSidebar()")
    people = page.locator("nav.side .people-followed")
    await expect(people.locator(".row-h")).to_contain_text("People you follow")
    person = people.locator(".item.folder")
    await expect(person).to_contain_text("Bob")
    if await person.get_attribute("aria-expanded") != "true":   # open when you are in one of them
        await person.click()
    await expect(people.locator(".sub .item")).to_have_count(2)
    await expect(people.locator(".sub .item").nth(0)).to_contain_text("feed")
    await expect(people.locator(".sub .item").nth(1)).to_contain_text("site")
    await expect(page.locator("nav.side h3", has_text="site")).to_have_count(0)
