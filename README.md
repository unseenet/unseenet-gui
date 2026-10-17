# unseenet-web

Unseenet in a window: groups as threads, chats as chats, with the look of
[unseenet.org](https://unseenet.org). A prototype of a modern client built on
the [unseenet](https://github.com/unseenet/unseenet) core.

> **Pre-alpha prototype.** Neither this client nor the unseenet core has had a
> security review. Play with it, pick it apart - do not rely on it to protect
> anyone yet.

## How it works

```
 browser window ──HTTP/WebSocket──▶ unseenet-web ──▶ unseenet core ──Tor──▶ nodes
 (127.0.0.1 only)                   (local server)   vault, keys, postage
```

`unseenet-web` is a small local server around the core's `Session` - the same
one the TUI uses. It opens the same encrypted vault, starts the same bundled
Tor and talks to the same nodes. The browser only draws what you would see on
screen: **keys, signing, encryption and postage never leave Python**, and the
passphrase is only sent once, to unlock.

The group's type decides the view, as in the TUI: groups marked as chat open as
a chat, the others as threads, and `V` switches either way.

## Try it

You need Python 3.11+.

```sh
pip install "unseenet-web @ git+https://github.com/unseenet/unseenet-web"
unseenet-web                        # opens your browser
unseenet-web --vault /path/to/unseenet.vault
```

It uses the same vault as the TUI (`unseenet.vault` in the current folder, or
the portable build's `data/`), so your identity, groups and read marks are the
same in both. Do not run both on the same vault at the same time.

### In its own window

```sh
pip install "unseenet-web[window] @ git+https://github.com/unseenet/unseenet-web"
unseenet-web --window
```

This uses [pywebview](https://pywebview.flowrl.com/): the system's web view
(WebView2 on Windows, WebKit on macOS and Linux) in private mode, so nothing
ends up in your browser's history or cache. On Linux it needs the GTK WebKit
libraries.

### A playground without Tor

```sh
git clone https://github.com/unseenet/unseenet-web && cd unseenet-web
pip install -e .
tools/dev.sh            # a local node, three people, groups and a closed chat
```

Passphrase `test`. Everything is in `./dev`; `tools/dev.sh clean` deletes it.

## Keys

| Key | |
|---|---|
| `Ctrl K` or `Ctrl P` | Commands and groups |
| `N` | New post |
| `R` | Reply (focus the reply box) |
| `V` | Switch between chat and threads |
| `G` | Find groups on your nodes |
| `K` | Show your key |
| `?` | About this group |
| `↑` `↓` | Next / previous thread |
| `Ctrl S` | Send a post or reply |
| `Enter` | Send in a chat (and jump to the chat box) |
| `Esc` | Leave the text box, close a dialog |

## Security

The local server is reachable from your own computer, so it guards itself:

- It listens on **127.0.0.1 only**, on a random port.
- Every start makes a **random token**. It is in the address the client opens
  (`…/#t=…`, in the fragment, so it is never sent in a request line), kept in
  that tab only and removed from the address bar. Every API call and the
  event socket must carry it. Other programs on the computer and web pages in
  your browser do not know it.
- The **Host** header must be our own address, which stops DNS rebinding, and
  an **Origin** header, when sent, must be our own origin.
- A strict **Content-Security-Policy**: the page loads nothing from anywhere
  but the local server - no fonts, images, scripts or styles from outside. A
  post can never make the browser fetch something past Tor.
- Everything people wrote is put on the page as text, never as HTML, and links
  in posts are not clickable: following one would leave Tor.
- Nothing is logged: the server has no access log.

What it does **not** protect against: someone who can read your screen, run
programs as you or read your memory. When you run it in your normal browser,
the window title and address can end up in its history - `--window` avoids
that.

## What the prototype can and cannot do

It can: unlock or create a vault, choose a name and node, follow and leave
groups, read threads and chats (closed groups decrypted), post, reply, chat,
"For you", read private messages, the command palette, and work on a narrow
screen.

Not yet - use the TUI: writing private messages, creating groups, inviting
members, names, contacts, moderation, reporting, bridges, several identities,
and a light theme.

## Built on the core

The client needs no changes to unseenet. It does copy a few things that live
in the TUI today - startup, threads, the view of a group, events - and those
are listed in [CORE-NEEDS.md](CORE-NEEDS.md) as candidates for unseenet 0.4.0.

## Layout

```
src/unseenet_web/
  __main__.py     command line: browser or --window
  server.py       the local HTTP/WebSocket server and its guards
  runtime.py      one Session, its startup, refresh and push
  serialize.py    Session objects as JSON
  static/         the page: index.html, app.css, app.js (no build step)
tests/            the server's guards
tools/            dev.sh and seed_dev.py: a playground without Tor
```

The front end is plain JavaScript with no dependencies and no build step, so
the client is easy to read and audit.

Code Apache-2.0. Logo CC BY 4.0, from the Unseenet project.
