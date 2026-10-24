# Changelog

All notable changes to unseenet-gui, the graphical client, are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [semantic versioning](https://semver.org/) on the same
principles as [unseenet](https://github.com/unseenet/unseenet/blob/main/docs/development.md#versioning).

## [Unreleased]

### Added

- Key ripening is explained where it shows: your key's level under your name,
  and a dialog with the progress, the time left, and what the levels do. With
  a core that can (unseenet#337), it pauses and resumes. On the web, a new key
  getting ready asks you to keep the page open and keeps the screen on where
  the browser allows (#50).
- An emoji picker by the chat bar and the text of posts and chats: categories,
  search by name, recently used. Typing `:ta` suggests matching shortcodes;
  Tab or Enter takes one. Both put the `:shortcode:` in the text. The data and
  the order of suggestions are the core's (`GET /api/emoji`, unseenet#362), so
  this needs unseenet 0.5; with an older core the button stays away (#21).

- Pictures and files on posts (#63, UN-RFC 0027): pictures show in posts and
  chat lines, where the text puts them or below it, with their description;
  they come from the core checked and saved again in a separate process
  (unseenet#446), never as the octets from the network. Other files, a PDF
  for example, get a card with their name, type and size and a Save button;
  saving warns that another program runs outside Unseenet and Tor, and the
  file goes in your Downloads folder (in a browser, the browser saves it).
  Pictures by people you ignore wait until you choose to see them. Writing a
  post in a group that takes files has "Add pictures or files", up to four,
  each with a description; a group whose node carries no files says so.
- Pictures of people (#64, UN-RFC 0022 section 8): beside posts, chat lines
  and in profiles, each author has their picture or else their identicon, a
  pattern made from their key, so two people with the same name look
  different. Pictures come from the core decoded and saved again in a separate
  process (unseenet#447), read in batches so a node cannot tell whose you look
  at. Your own profile has "Picture": choose an image, see exactly what will be
  published (square, at most 128 pixels, without where or when it was taken)
  with its description and the warning before your first picture, then
  publish or remove it. "Identicons only" in the commands (Ctrl P) turns
  pictures off; "Show people's pictures" turns them on again.

- Pinned posts (#62, UN-RFC 0033): a group's pinned posts are in a Pinned
  section above the threads, with their notes, and marked in their place too;
  a chat has a pinned bar with the newest pin - select it to go to the line,
  then the next - and a list of all pins. Both can be folded away, remembered
  per group. The owner and moderators pin and unpin from the post's tools, under
  a chat line or the commands, with an optional note; a full group says which
  pin stops counting, and unpinning a post older than the group keeps posts
  warns that the nodes then delete it. The pins are the core's (unseenet#448).
- `unseenet:` addresses (#66, UN-RFC 0031): an address in a post or a chat line
  (a link, or written out in plain text) opens what it names: a post in a
  group you follow is selected, a group you do not follow is shown first and
  you choose to follow it, a person's opens their profile. The older forms work
  too. Copy address is on posts, chat lines, About this group and profiles,
  and the commands can open an address you paste. What an address names is the
  core's (unseenet#460).
- Feeds (#60, UN-RFC 0034): a group shown as a feed has its entries newest
  first, each whole - a note, or a post with its headline - with the newest
  comments under it and Show all; comment right under an entry, or answer a
  comment (two levels, deeper answers say whom they answer). A Timeline in
  the sidebar brings every feed you follow together, each entry saying which
  feed it is from. Follow and Unfollow on profiles, Feed to open theirs,
  Whom you follow, and Your feed to start your own after the warning, all in
  the commands. V switches a feed between feed, threads and chat. The feeds
  and the timeline are the core's (unseenet#468).
- Sites and pages (#61, UN-RFC 0035): a site is shown as its home page with a
  list of its pages, the home page first; links to other pages of the site and
  to other sites open them, with Back and Forward. The site's writers edit a
  page, or write a new one, in Markdown with a preview rendered by the core as
  readers will see it, pictures as on posts, and can go back to the previous
  version or remove a page. Your site starts from the commands, after the
  warning. V switches a site between its pages and threads. An `unseenet:`
  link no longer shows its address beside its text; a web link still does.
  The pages are the core's (unseenet#480).

### Changed

- Write permission, changing the passphrase and profiles come from the core's
  local API (unseenet#320) instead of this client's own copies under `/x/gui/`,
  so every front end says the same. This needs unseenet 0.5 (#59).

### Fixed

- Emoji suggestions while typing `:` no longer fail to show when the page
  redraws just as the emoji data arrives, for example while a group loads.

## [0.1.2] - 2026-10-23

Fixes, from the new `release/0.1` branch; the builds are made with unseenet
0.4.4, which this version needs.

### Fixed

- The first start offers the known nodes to choose from again: the core
  refused the list until setup was done (unseenet#372, fixed in unseenet
  0.4.4). If the list cannot be loaded, the screen now says so, with "Try
  again", instead of showing only the address field.
- Your own chat line or post shows up at once, clearly greyed out with its
  progress, instead of vanishing until it is back from the node. It turns
  normal when the node has it, without a gap or a duplicate (#48).

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

[Unreleased]: https://github.com/unseenet/unseenet-gui/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/unseenet/unseenet-gui/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/unseenet/unseenet-gui/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/unseenet/unseenet-gui/releases/tag/v0.1.0
