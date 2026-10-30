# Developers: the page's scripts

The graphical client's page is plain JavaScript with no build step: `index.html` loads
the scripts in `src/unseenet_gui/static/` in a fixed order, and they share one scope
(unseenet-gui#152). The same files run in the local GUI, the portable and bootable
builds, and - inlined into one file - the browser build (unseenet-entrance).

- **`core.js` comes first**: the token, the theme, the core's local API (UN-RFC 0046)
  turned into what the page draws, and the helpers everything uses - `h()` to make
  elements, `api()`, `S` (the page's state), `render()`, `toast()`.
- **`start.js` comes last of the split parts**: it starts the page, so every function
  it needs exists by then. `identity.js`, `notify.js`, `publish.js` and `export.js` come
  after, as before the split.
- Every file opens with what belongs in it, and every function has a comment saying what
  it does; `tests/test_scripts.py` fails on a new one without, and checks that every
  script in `static/` is loaded. CI runs `node --check` on each.
- The core serves `static/` flat (no sub-folders), so the scripts sit beside `app.css`.

## The files, in the order they load

| File | What belongs in it |
|------|--------------------|
| `core.js` | the page's base: an address to open, the token, the theme, the core's local API (UN-RFC 0046) into what the page draws, shared helpers, and rendering with focus and scroll kept. Everything else uses these |
| `setup.js` | unlocking the vault and setting up a first identity |
| `bootable.js` | the bootable image: network, keyboard and power |
| `screen.js` | the app screen, and whether you may write in a group (#13) |
| `grouptree.js` | the group tree in the sidebar (unseenet.client.grouptree, as in the TUI) |
| `sites.js` | sites and their pages (UN-RFC 0035, UN-RFC 0046 section 4.15) |
| `feeds.js` | feeds (UN-RFC 0034, UN-RFC 0046 section 4.14) |
| `reactions.js` | reactions under posts, comments and chat lines (UN-RFC 0048, #107) |
| `reader.js` | the newsreader and pinned posts (UN-RFC 0033, UN-RFC 0046 section 4.12) |
| `markdown.js` | Markdown and emoji: the core's safe tree as DOM (UN-RFC 0031) |
| `files.js` | files on posts (UN-RFC 0027, UN-RFC 0046 section 4.10) |
| `cards.js` | link previews: a post's card, and making one while writing (UN-RFC 0059, UN-RFC 0046 section 4.25) |
| `grouprefs.js` | !group references (unseenet#172, #666) |
| `following.js` | following people and feeds (UN-RFC 0034 section 6, UN-RFC 0046 4.14) |
| `ripening.js` | key ripening (UN-RFC 0025, #50) |
| `chat.js` | chat |
| `compose.js` | posting |
| `dialogs.js` | dialogs shared by the page |
| `moderation.js` | the owner's and moderators' tools, names (UN-RFC 0019), ignoring people (#72) and blocking in a hierarchy (UN-RFC 0018 5.4) |
| `nodes.js` | your nodes (#111, unseenet#518) |
| `profiles.js` | your vault's passphrase (#32) and profiles, anyone's and your own (#20, UN-RFC 0022) |
| `emoji.js` | the emoji picker and :shortcode: completion while typing (#21) |
| `keys.js` | keys and the command palette's shortcuts |
| `events.js` | events from the server |
| `start.js` | starting the page: kept last of these, so every function above exists |
| `identity.js` | recovery words and copying an identity to another device (UN-RFC 0050, #142) |
| `notify.js` | notifications when something new lands in For you (#126), from the core's /api/notifications |
| `publish.js` | publishing a folder as a site (#125, on the core's site import, unseenet#538) |
| `export.js` | Export my data (#141, on the core's export, unseenet#577 and UN-RFC 0049 section 7) |
| `rules.js` | your own rules for your feed and groups (UN-RFC 0051, unseenet#615) |
| `reports.js` | spam reports: posts hidden by a report shown as hidden, the issuers you follow, being an issuer (UN-RFC 0045, #70) |
| `teams.js` | team inboxes: accepting an invitation, replying on the inbox's behalf, who reads an inbox you own (UN-RFC 0047, #68) |

## Words

The client says **your** when it speaks to you (titles, navigation, the palette,
messages: *Your feed*, *Your rules*, *Export your data*) and **my** only in your own
words (a checkbox or a choice: *Use my rules*) - never both in one list. The rule for
every client is in the core's *Write a client*, docs/developers/index.md.

## Screenshots for the user guide

The pictures in `docs/img/guide/` are the graphical half of the user guide on
unseenet.org (*Getting started → How do I …*, in unseenet-docs). They are made, not
drawn: the layout test opens every screen and dialog against recorded answers and can
save each one.

```sh
SHOTS=dev/shots python -m pytest -q tests/test_layout.py -k desktop-dark
```

Copy the ones the guide uses from `dev/shots/<name>__desktop__dark.png` to
`docs/img/guide/<name>.png` (reduced to 256 colours keeps each under 60 KB). Do it
again when a screen in the guide changes.
