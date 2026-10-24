# What this client needs from the unseenet core (for 0.4.0)

unseenet-gui is built on `unseenet.client.session.Session`, which already does
the real work: the vault, Tor, nodes, reading, posting, push, unread marks,
"For you", contacts, private messages and moderation. The client needed no
changes to the core.

But some of what every client needs lives in the TUI today, so this client
copies it. Each copy is marked `CORE:` in the code. Moving these into the core
makes the TUI thinner, keeps all clients showing the same thing, and gives the
coming Android client the same foundation.

## 1. A client runtime: startup, refresh and push

**Status:** done. `ClientRuntime` (unseenet#276) runs startup, refresh, push, maintenance and ripening here (#30); its `Refreshed`, `InboxReady` and `ReleaseOffer` events drive the status bar and the update notice.

**Today:** `UnseenetApp.start()`, `refresh_groups()`, `update_known_nodes()` and
`watch_loop()` in `client/tui.py`. Copied as `Runtime.start()`, `refresh()`,
`_known_nodes()` and `_watch()` in `runtime.py`.

The order matters and is easy to get subtly wrong: unlock, set up identity and
node, subscribe the starter groups, load the offline cache, list groups, make
sure the inbox exists, start one push connection per node, read the known-node
list and names, fetch every subscribed group, and refresh every 60 seconds as a
fallback.

**Proposal:** `Session.run(events)` (or a small `ClientRuntime` next to
`Session`) that does all of this and reports what happens as events.

## 2. Typed events instead of one status callback

**Status:** done. `Session.on()` (unseenet#275) is passed to the page (#29): group and list updates, a real postage bar per job, node and Tor state, and ripening of a new key.

**Today:** `Session(vault, status=print)` - one string callback.

A graphical client needs to know *what* happened, not just a line of text:

| Event | Used for |
|---|---|
| `group-updated(group_id)` | redraw the open group, update counts |
| `groups-changed` | redraw the sidebar |
| `post-state(job, state)` with `pow`, `sent`, `reached`, `failed(error)` | the status under a chat message |
| `pow-progress(job, fraction)` | a real progress bar (postage can take seconds on old laptops) |
| `node-state(address, up/down)` | the dot in the status bar |
| `tor-state(bootstrap %)` | the unlock screen |
| `status(text)` | as today |

`pow-progress` needs `core/pow.py` to call back every N attempts; the rest can
be emitted from `Session` where it already calls `self.status(...)`.

## 3. Threads

**Status:** done. The core has it (`Session.threads`, unseenet#273), and this client uses it (#27).

**Today:** `UnseenetApp._threaded()` in the TUI. Copied as
`serialize.threaded()`.

**Proposal:** `Session.threads(group_id) -> list[Thread]` with root, replies
and depth, so every client threads posts the same way.

## 4. The view of a group

**Status:** done. `Session.view_of` / `set_view` (unseenet#273), used here (#27).

**Today:** `UnseenetApp.view_of()`: your own choice (`data["views"]`), else the
owner's (`manifest["view"]`), else threads. Copied as `serialize.view_of()`.
Setting it is done by writing `data["views"]` directly.

**Proposal:** `Session.view_of(group_id)` and `Session.set_view(group_id, view)`.

## 5. Icons and the group list

**Status:** done. `Session.subscribed_groups()` and `group_info()` (unseenet#274, #299), used here (#28).

**Today:** `group_icons()` and `_groups_from_vault()` in the TUI.

**Proposal:** `Session.subscribed_groups() -> list[GroupInfo]` with type, view,
access, unread and for-you counts filled in, grouped by hierarchy. The icon
characters stay a client decision.

## 6. A stable dict form for Message and GroupInfo

**Status:** done. `Message.to_dict()` / `GroupInfo.to_dict()` (unseenet#274), used here with a version check (#28).

**Today:** dataclasses with `bytes` and `datetime`. Each client has to decide
how to turn them into JSON (`serialize.message()`).

**Proposal:** `Message.to_dict()` / `GroupInfo.to_dict()` with a documented,
versioned shape. This is also what the local API below sends.

## 7. Chat messages

**Status:** done. `Session.send_chat` (unseenet#273) sends chat lines here (#27); a private chat that answers a given post still uses `send_private`.

**Today:** the TUI's `send_chat()` derives the subject from the first line and
adds no signature; a post from the compose window gets the signature. Copied
in `Runtime.post(chat=True)`.

**Proposal:** `Session.send_chat(group_id, text)` next to `Session.post()`.

## 8. The local client API as a UN-RFC

**Status:** done. UN-RFC 0046 (unseenet#301), implemented in the core as `unseenet.client.localapi` (unseenet#302-#305). This client is now the core's API with its page and an extension under `/x/gui/` (#38): `runtime.py` and `serialize.py` are gone.

The HTTP and WebSocket API in `server.py` (`/api/state`, `/api/groups`,
`/api/groups/{id}`, `/post`, `/read`, `/view`, `/api/events`) plus its security
rules (127.0.0.1 only, per-start token, Host and Origin checks, no keys in the
browser, strict CSP) could become a UN-RFC. Then other front ends - a native
app, an Android client, a screen reader client - could talk to the same local
runtime without reimplementing Tor, the vault or postage.

## 10. Write permission, the passphrase and profiles in the local API

**Status:** done. The core's local API has them (unseenet#320): `write` on a
group's head and `reply` on each of its rows, `POST /api/passphrase`, and
`GET`/`POST /api/profile` and `POST /api/profile/hide`, with the warning before
a first profile. This client's copies under `/x/gui/` are gone (#59); this needs
unseenet 0.5.

## 11. Files on posts

**Status:** done. The core fetches a file a post carries, checks it and decodes a
picture in a separate process (unseenet#445), and the local API gives a picture
safe to show, a file to save, and takes files with a post (UN-RFC 0046 section
4.10, unseenet#446). This client shows them (#63). In a portable build the
program is its own decoding process (`decode.run_if_asked()` in `__main__`).

## 12. Pictures of people

**Status:** done. The local API gives every row an `identicon`, and
`GET /api/pictures?keys=` each key's identicon and picture, decoded and saved
again in a separate process and read together with the other authors' so a node
cannot tell whose you look at; `POST /api/profile/picture` previews, publishes
and removes your own, with the warning before the first (UN-RFC 0046 section
4.11, unseenet#447). This client shows them (#64).

## 13. Pinned posts

**Status:** done. A group's head has the pins in force with the pinned posts'
subject and author, `max_pins` and `may_pin`, each row whether it is `pinned`,
and `POST /api/groups/{id}/pin` pins or unpins (UN-RFC 0046 section 4.12,
unseenet#448). This client shows and sets them (#62). The terminal client
gets them in its own PR (unseenet#442).

## 9. Starting Tor without a console window on Windows

**Today:** `TorProcess.start()` uses `asyncio.create_subprocess_exec` without
`creationflags`. From a windowed program (the graphical client's "Unseenet Graphical.exe")
Tor then gets a console window of its own. unseenet-gui works around it in
`winfix.hide_child_consoles()`.

**Proposal:** pass `creationflags=subprocess.CREATE_NO_WINDOW` on Windows when
starting Tor (and in `binary_version`).

## Not needed from the core

Everything security-relevant already happens in the core: signing, encryption,
sealing private messages, postage and the vault. The web page never sees a
private key or the passphrase after unlocking.
