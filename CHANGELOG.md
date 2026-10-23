# Changelog

All notable changes to unseenet-gui, the graphical client, are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [semantic versioning](https://semver.org/) on the same
principles as [unseenet](https://github.com/unseenet/unseenet/blob/main/docs/development.md#versioning).

## [Unreleased]

## [0.1.1] - 2026-10-23

Fixes; the builds are made with unseenet 0.4.3.

### Fixed

- Compose windows keep their text, selection and ongoing typing when status or
  group updates arrive. Mention lookups stay with the draft that requested them (#47, by @KingEmma7).
- The playground (`tools/dev.sh`) seeds chat lines as chat lines, not as
  posts with the subject "chat".
- The portable build for Windows takes chiavdf 1.2's DLLs from
  `chiavdf.libs` as well, or it could not ripen keys (#51).
- Text you typed in other fields survives a redraw too: the name on first
  start no longer goes blank when you choose a node (#53).

## [0.1.0] - 2026-10-22

The first release of the graphical client. Works with unseenet 0.4
(`unseenet[api]>=0.4.1,<0.5`): it posts on 0.4 nodes, ripening a new key in
the background first. Pre-alpha: not security reviewed.

### Added

- **Groups and discussions** like the terminal client: the group tree
  (foldable), discussions as a newsreader with one post at a time, reply with
  quote, full-screen reading (F), and chat groups as a chat; what a group
  takes, chat lines or posts, as UN-RFC 0028 says.
- **Private chats and posts**, one conversation per person, contacts as an
  address book, invites, signatures.
- **Owner and moderator tools**, names, ignoring and blocking in a
  hierarchy, closed-group members, group rules in Markdown.
- **Markdown and emoji** (UN-RFC 0031), rendered from the core's safe tree:
  no post text ever becomes HTML.
- Replies and mentions shown apart in the sidebar, mention notices
  (UN-RFC 0032), `#group` references that open or offer the group.
- Bots marked next to their posts, and *Hide bots*.
- **Said before you write** (#13): *New post*, *Reply* and the chat bar are
  greyed out with the reason when you may not write there (a channel's
  readers, a ban, a block, a closed group, comments that have closed), and
  N and R say it; in a channel open for comments, *Reply* reads *Comment*.
  From the core's `write_permission`, as in the terminal client.
- **Profiles** (#20, UN-RFC 0022): an author's name opens their profile
  (about in Markdown, languages, links shown as written and never opened),
  which you can hide; *Your profile* writes, changes or removes yours, with
  the warning before the first and before new links.
- **Change passphrase** (#32): for this vault file; copies elsewhere keep
  the old one, and the dialog says so.
- *About Unseenet*, also before unlocking.
- A phone layout, one pane at a time on narrow screens.
- An update notice with an *Update* button on a stick or in a folder.
- **Portable builds** for Linux, Windows and macOS (Apple silicon and Intel)
  with Tor inside and key ripening in every build, and a **bootable graphical
  image**; each is self-tested in CI.
- On a web entrance (the client in a browser, through Pyodide) it says what
  is true there: the entrance carries the connection, not Tor on this
  computer. The browser client reads but cannot post on 0.4 nodes yet
  (#31).

### Changed

- The playground (`tools/dev.sh`) seeds a channel open for comments, and
  uses 12-bit postage, the floor of 0.4 nodes.

- Built entirely on the core: threads, views, messages, events, startup,
  refresh, push and ripening come from `unseenet.client`, and the window
  talks to the core's local client API (UN-RFC 0046) plus `/x/gui/`.
- The first start picks a known node at random instead of the first in the
  list (UN-RFC 0043 section 5.1).
- Renamed from unseenet-web to unseenet-gui.

[Unreleased]: https://github.com/unseenet/unseenet-gui/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/unseenet/unseenet-gui/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/unseenet/unseenet-gui/releases/tag/v0.1.0
