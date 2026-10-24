# Changelog

All notable changes to unseenet-gui, the graphical client, are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [semantic versioning](https://semver.org/) on the same
principles as [unseenet](https://github.com/unseenet/unseenet/blob/main/docs/development.md#versioning).

## [Unreleased]

### Added

- **Your nodes** (#111, unseenet#518): change node while the client is open.
  The node in the box at the bottom left shows its name (from the list of
  known nodes; a node's own name marked *unlisted*; else the start of its
  address), with the full address on hover; clicking it - or *Your nodes* in
  the palette, also found by *node*, *server* and *switch* - lists your nodes
  by name with their onion addresses (copyable), groups read there, whether
  they answer and what they say about themselves, with *Add* (a known node or
  any address), *Make default* and *Remove*. The first start's list of nodes
  shows the address too. The status bar no longer repeats *Connected to ...*;
  it shows what is happening (Tor starting, offline, sending). The box always
  names the default node and says how that node is - *Connecting*, *Tor* or
  *Not reachable* (why, on hover) - from its own state, so it no longer says
  *Not connected* while the status bar says *Connected to* another of your
  nodes. Needs a core with `/api/nodes` (unseenet 0.5.0).
- A tidier sidebar (#114): the big *Search and commands* box is now a filter of
  the sidebar - what you follow and your chats, as `/` in the terminal client;
  Enter opens the first, Esc clears it - and the palette opens with Ctrl P or a
  small button by the logo. Headings (chats, alt.\*, dk.\* ...) are bigger and
  fold as a whole row with a clear arrow, and the rows sit closer, so more
  groups fit (touch screens keep bigger targets).
- Close a chat (unseenet#519): *Close chat* in the chat, in its info instead of
  the Unsubscribe that did nothing, and with ⋯ on each chat in the list; it
  leaves the list on all your devices and comes back when one of you writes.
  *Add contact* / *Remove contact* on a person's profile and with ⋯; the
  contacts list keeps everyone, also with the chat closed. The chats in the
  sidebar fold away (remembered), showing their unread count when folded.
- A "⋯" menu on posts, feed entries, comments and chat lines (on hover; always
  on touch screens): *Edit* and *Withdraw (delete)* where they are yours, *Pin*
  where you may, *Copy address*. Comments and chat lines can now be withdrawn
  and edited in the graphical client (a one-line edit, no subject). The palette
  finds withdrawing by *delete*, *remove*, *slet* and *fjern* too.
- Create a group as a feed or a site (unseenet#514): *Feed* and *Site* under
  *Shown as*. Site makes the group a channel, as a site must be, and says who
  writes it; a channel shown as a feed asks whether anyone may comment. *Takes*
  is left out for a site and fast delivery offered for chat groups only.
- Reactions (#107, unseenet#510, UN-RFC 0048): under every feed entry, comment,
  post and chat line, each emoji with its count, yours marked; a click gives
  that one or takes yours back, *+* offers the group's set (and the emoji
  picker where the group takes any emoji), right-click says who reacted.
  Shown at once while it is on its way; nothing to click where the group
  takes no reactions; the first time, a note that reactions are public and
  signed. *Reactions* in the group's settings: as the view has them, none,
  any, or your own set. Needs core 0.5.
- Tables in Markdown (unseenet#508, UN-RFC 0031 section 3.6): a real table, in
  posts, chat lines and pages, in a box that scrolls sideways when it is wider
  than the text; each column aligned as written. Needs core 0.5.
- From a person to their feed and site without following them
  (unseenet#506): a profile shows *Their feed* and *Their site* when they have
  them and opens them at once; a group you read without following says so,
  with a *Follow* right there, instead of asking first. Needs core 0.5.
- Pictures and files where they were forgotten (#102, unseenet#496/#497): a
  *Files* choice (none, pictures, pictures and PDFs) when creating and editing
  a group; pictures on a chat line, also in a chat with a person (+ beside the
  input, shown as chips until sent); pictures in private posts, encrypted to
  them. Needs core 0.5 (`files` in the local API).
- **My site** as My feed (unseenet#495): at the top of the sidebar, or a dimmed
  *Start my site*, and on your own profile.
- Your own feed where people look for it (#101, unseenet#495): the sidebar
  lists **My feed** under For you and Timeline, or a dimmed **Start my feed**
  until you have one; your own profile has *Start my feed* / *My feed*. Needs
  `my_feed` from the core's `GET /api/groups` (0.5); without it nothing changes.
- Your state, as in the terminal client (UN-RFC 0044 section 7.4): from the
  palette, keep it on this device only, after a warning, or in the network
  again.
- Private profiles (#65, UN-RFC 0022 section 6): share a profile with one
  person ("Share yours" in their profile) or with a closed group (the
  palette), after saying who can read it, and take it back. A profile shared
  with you or the group is shown where it was shared, with a note saying so,
  and never elsewhere.
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

- A page that begins with its own heading shows that one title, not the page's
  title above it as well; who wrote it and when is below the page, so the text
  starts at the top.
- You stay at the bottom of the sidebar: with many groups only the groups
  scroll, and your picture, name and connection are always in view.
- A site's list of pages has a quiet label ("pages · 5") in the sidebar's style
  instead of a heading.
- The footer shows the keys of the view you are in (unseenet#490), the same as
  the terminal client, and each is a button too. Threads: N, R, ↑↓, Space,
  Enter. Chat: Enter, Esc. A feed: N, ↑↓ from entry to entry, Space to the next
  unread, R to comment. A site: ↑↓ through its pages, ← → back and forward, E
  and N for its writers. Reading: Esc, N/P, R, Space. V says what it shows next.
- A paused key ripening stays paused on this device, also after a restart,
  until you resume it (unseenet#488); the ripening dialog says so.
- The theme is kept with your settings in the core (#84), so it is no longer
  forgotten when the GUI starts on another port, and it follows you to other
  devices. "Follow the system's theme" in the palette goes back to the
  system's choice.
- Folded comments in a feed keep your conversations: besides the newest two,
  a comment that is yours, answers you or names you is shown with what it
  answers and the answers under it. "Show all" and "Show fewer" as before.
- Your picture is set in Your profile (#82): choose, preview exactly as it will be
  published, describe or remove it in the same dialog, published with Publish; the
  separate Your picture dialog is gone (its palette entry opens your profile).
- Your own picture at the bottom of the sidebar, instead of your initials, and it
  and your name open Your profile (#83).
- Write permission, changing the passphrase and profiles come from the core's
  local API (unseenet#320) instead of this client's own copies under `/x/gui/`,
  so every front end says the same. This needs unseenet 0.5 (#59).

### Fixed

- Choices in the Create and Edit group dialogs did not show which one was
  picked (the dialog was not drawn again), and in a tall dialog they were
  squeezed together so a label covered them.
- A long feed no longer gives the window a second scroll bar: the hidden labels
  of its comment boxes made the page itself taller than the window.
- Form dialogs no longer reset while you write (#85): Your profile, Add contact,
  Signature and the other forms are kept on screen while the page redraws, as
  the compose window is, so a text area you made bigger, the text, the cursor
  and undo stay; an error is written into the dialog instead of drawing it anew.
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
