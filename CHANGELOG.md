# Changelog

All notable changes to unseenet-gui, the graphical client, are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [semantic versioning](https://semver.org/) on the same
principles as [unseenet](https://github.com/unseenet/unseenet/blob/main/docs/development.md#versioning).

## [Unreleased]

- **Link previews when writing** (needs unseenet main with #795): in the compose window the
  card is a compact row, a small picture beside the title and description, so it is not
  stretched to the width of the window, large or small. Editing a post shows its picture and
  keeps it when only the title or text is changed; "Without the picture" drops it.

- **Link previews** (#275, UN-RFC 0059; needs unseenet main with #792): a post with a link
  shows a card - the site's icon and the **domain from the link** first, the site's own
  name, the title, the start of the description and the picture, "Preview from the poster"
  and its date, "+N links" beside it in a feed. Without a picture it is compact, with the
  icon big; in a chat it is one small line; an address that may look like another is marked.
  The card's picture is shown in the card only. Clicking opens the link as any link does,
  with the warning before leaving Tor. Writing a post, a reply, an edit or a private post,
  the first link that is not quoted gets a preview, made by the core over Tor when you paste
  it or stop typing, shown as it will be sent: change its title and description, send it
  without the picture, preview another link instead, or send without one. An edit keeps the
  post's card unless you change it. Ctrl+P: "Link previews" on or off.

- Screenshots for the user guide on unseenet.org in `docs/img/guide/`, made by the
  layout test (unseenet-docs#6); *Developers* says how to make them again.
- The manual no longer says updating is missing (it has been there since the
  builds were signed) and drops the "from 0.5" marks.

- **Long entries and comments in a feed, cut by the core's one rule** (#269, unseenet#781):
  the feed and the timeline ask the core for the cut (`?preview=`), the same as the
  terminal client's - the author's read-more line, nothing cut for a line or two, a cut at a
  sentence or word and never inside a link, code block or table. Long **comments** are now
  cut too, at about three lines with "… more", their own words first (what they quote shows
  when opened), and so are long notes. Opened in place, "Show less" cuts again; kept open
  across redraws. **Alt+R** puts a read-more line in a comment as in a post (Ctrl+R in the
  terminal client; a browser keeps it for reloading), and the palette has *Insert a
  read-more line*. With a core without the shared cut, entries are measured as before.
## [0.3.3] - 2026-10-29

**The phone, part three.** One head everywhere with the round + for its action, a chat line
you can see what you write in, Private as on the desktop, one icon for the palette, and a
copied key's ripening shown right.

- **One head on a phone, everywhere** (#260): the back arrow, the name - on two lines
  before it is cut, so `alt.history.onthisday` can be read - and the palette; nothing else.
  The head's one action (New post, Write a private post, Chat with someone, Add a contact)
  is the round + at the bottom right, in every view - in a chat just above the chat line.
  The rest of the desktop's head is in the palette.
- **One icon for the command palette** (#263): `>_` and *Commands and search* wherever it
  opens - the sidebar's top, a phone's head, the You tab - where it was >_, ⋯ and ⌘. ⋯ is
  only the menu of one thing: a post, a person, a chat.
- **The chat line on a phone** (#259): the field takes the whole width with the green Send
  at its right end; the language, emoji and pictures are on a low line under it. The
  lines of a chat stay compact: ☺+ and Pin show under the line you tap, not under every
  line (the 40x40 targets of 0.3.2 had made each bubble twice as high).
- **Private on a phone** (#256): the tab is *Private* (it was *Chats*) and shows the
  desktop's three rows - Your contacts, Private posts, Private chats - in the same order,
  with the same names, icons and counts, where Private posts and Your contacts were small
  links above the chats and were not found.
- **A copied key's ripening shows at once** (#262): right after a copy, a segment the new
  vault's own key was still working on finished, and its event set *0%* beside the copied
  key's *level 2, on its way to 3*. Only your own key's ripening events count now, and
  another key's pace is forgotten when the key in use changes.

## [0.3.2] - 2026-10-29

**Every screen fits a phone, and writing works there.** A test now opens every screen and
dialog at phone, laptop and desktop sizes; what it found is fixed (Your nodes first). New
post is a round + always in reach, and a comment you write keeps still and stays in sight
once sent.

- **Writing keeps still, and what you sent is in sight** (#258): while you typed a comment
  under an entry in a feed or the timeline, posts arriving above it - and on a phone the
  keyboard - moved the field away, since redrawing kept the list's scroll, not your
  place in it. The field you type in now stays where it is on screen. After sending, your
  comment (under its entry, far from the bottom) or chat line (also when you had
  scrolled up) is brought into sight, shown as being sent until it is.
- **New post is always one tap away on a phone** (#257): the desktop's New post was hidden
  on phones in chat groups, and nowhere in the timeline. Now, on a phone, it is a round +
  at the bottom right above the tab bar in threads, channels and feeds - within reach of
  the thumb, gone while you read a post or write - and a + in the head of a chat group,
  whose bottom is the chat line. Greyed where you may not post; a tap says why.
- **New post in the timeline** (#257): writes in your own feed, once you have started one -
  on the desktop and the phone alike.
- **Every screen and dialog fits, on phones and desktops, and a test keeps it so** (#264):
  `tests/test_layout.py` opens 11 screens and 37 dialogs at 360x740, 390x844, 1024x640,
  1280x800 and 1920x1080, light and dark, and fails if anything is wider than the
  screen, a dialog or its ✕ or primary button is off screen (on a phone also with the
  keyboard up), a heading or button is cut off, something you tap on a phone is smaller
  than 40x40 (a link that reads as text: 24 high), or the console shows an error. It
  talks to answers recorded from a real core (`tools/layout_audit.py` records them
  against the playground). CI also makes `gallery.html` - every screen, phone beside
  desktop - to check that both are recognisably the same app (`tools/gallery.py`).
- **Your nodes fits a phone** (#261): a known node's description and its onion address no
  longer stretch the dialog to 700 px, pushing *Add* off screen - each is on a line of
  its own and the address wraps; the name of a node has its own line, how it is doing
  under it.
- **Bigger targets on phones** (#264): ⋯, Chat/Post, reactions, the language button, the
  folds of the group list, Back, small buttons and choice chips are at least 40x40; names
  in a post's head and other text links at least 24 high. Your rules wrap on a phone
  instead of scrolling sideways.
- **You stays one column at any width** (#264): opened in a wider window (a phone turned
  on its side, a window made wider), the You tab laid its parts side by side, at least
  740 px - wider than a 1024 laptop's main pane with some fonts.

## [0.3.1] - 2026-10-29

**Better on a phone.** A tab bar at the bottom gives the groups the screen, Back goes up
one level instead of leaving the app, and the QR code for copying an identity can be
scanned at last.

- **A tab bar on phones** (#248): Groups, For you, Timeline, Chats and You at the bottom,
  within reach of the thumb, so the groups get the screen - at 360x740 thirteen rows
  instead of two or three. Chats has Private posts and Your contacts at its top; You has
  what the desktop keeps in the account box and the status bar (your profile and key,
  node, ripening, your feed and site, things to approve, connection, update, About). A
  dot on You and a thin line at the top say when you are not connected or a node is not
  answering. The bar steps aside while you read a post or write. The desktop is as it was.

- **The QR code of a copy can be scanned** (#247): it was drawn at a fixed 294 px with no
  `viewBox` into a 220 px box, which cut off two of its three corner marks - no phone
  could read it. It now scales to its box, crisp, with its quiet zone; a test reads the
  code on screen back, on a desktop and a phone.
- **Back goes up one level, never to the unlock page** (#249): the app's levels are now the
  browser's history - a group and a post on a phone, full screen, a dialog - so a phone's
  back swipe or button, the browser's Back, Alt+Left and a mouse's back button do what
  Esc and the on-screen back buttons do, on phones and desktops alike. At the top, Back
  says *Back again to leave Unseenet* and stays; a second Back within a few seconds
  leaves. Back never closes a window with text you have not sent, and leaving the page
  asks first when there is some. A sideways swipe in a list no longer turns into Back.
- **A new vault says where the copy comes** (found in the live test 29 Oct): *Get it
  from another device* comes after the vault is made, so someone bringing their identity
  over did not find it. The new-vault screen now says so - wherever a copy can be
  received (in a browser, only where the entrance passes copies on).

## [0.3.0] - 2026-10-29

**On unseenet 0.6 (`unseenet[api]>=0.6.1,<0.7`): update the nodes first.** Facebook mode
that you can live in - feeds, comments with an entry's own time and *Close comments*,
reactions, your own rules for your feed with *Show all* - plus tags and content
warnings, spam reports and labels you choose to follow, team inboxes, copying your
identity to another device (also onto a phone in the browser) and recovery words, a
PIN on a device, notifications, export, and level 4 by choice.

- **Get your identity onto a phone in the browser** (#234, UN-RFC 0050 3.8): in the browser,
  *Get it from another device* at first start and *Get identity from another device* in the
  palette work through the entrance (unseenet-entrance#53, UN-RFC 0043 4.5) - with the code,
  or by scanning the QR code where the browser can. Offered only where the entrance says it
  passes a copy on (`"copy": true`); elsewhere the palette says why. Being the device that
  gives a copy stays for the app.

- **Keep ripening to level 4** (#241, unseenet#740): a switch in Key ripening, off by
  default, that says first what it costs - about two weeks of one core while Unseenet is
  open, at this machine's speed, no more memory - and what it gives: about a quarter of
  the work for each post. With it on, the dialog shows the target and the time left;
  the sidebar says "ripening" again until level 4. In the browser it says that the page
  must stay open, and that it is slower there. This device's choice, kept with the key.
  Needs unseenet 0.6.
- **How long threads take comments, and closing comments on one entry** (#237, #238,
  unseenet#732, UN-RFC 0030): creating a group asks how many days a thread takes
  comments (a feed) or replies (other groups), empty for never; Edit group changes it,
  and a channel's "Readers may comment" too, saying that a change counts for comments
  from now on. Writing a new thread offers its own time - as the group, none, a day, a
  week or a month, never longer than the group's. The ⋯ menu of an entry has *Close
  comments* (with a short note for readers) and *Open comments* for its author, the
  owner and moderators. Where the comment box was, an entry says why it takes no
  comments - with a close's note - and "Comments close in 5 hours" once less than a
  day is left. Needs unseenet 0.6.

- **A group's charter** (#231, unseenet#726): what a group's owner writes about the group
  is now called its *charter* - in About this group, Edit group (with a hint that no
  machine enforces it), the palette and the report texts. *Rules* means only your own
  rules. Uses the core's `charter`, `charter_type` and `charter_tree` (unseenet#727).

- **New screenshots and demo** (#207): the README shows People you follow, the timeline,
  Private chats and the post composer; the playground (`tools/dev.sh`) has feeds, a site,
  contacts, unread chats and a read-more entry, and its node carries sites and pictures.
- **People you follow, by person** (asked for by the maintainer, #210, unseenet#706):
  following someone puts their feed and site together under their name in *People you
  follow*, sorted by name - one row when they have only one - instead of branches called
  `feed` and `site` whose rows all read "feed".
- **Your contacts, Private posts and Private chats alike** (asked for by the maintainer,
  #209): three rows at the top with person, envelope and bubble icons and no buttons on
  them, at most three unread chats under Private chats; each opens its list in the main
  pane with the same head - title, chip, one line, the main action. *Your contacts* is a
  pane now (Chat, Post, ⋯ Rename/Remove, *Add a contact*); `C` opens it. **A person
  picker** replaces the *To* field: Chat | Post (Tab), find a contact or paste a key,
  recent people first - Chat opens the chat itself.
- **Room to write a post** (asked for by the maintainer, #203): the post composer is wider
  and taller, and ⤢ makes it nearly the whole window (remembered on this device); a thin
  toolbar above the text - bold, quote, emoji, the paperclip, read more, and a *Markdown*
  mark with the examples on hover; content warnings behind one *Content warning ▾* button,
  only the chosen ones shown in colour; language, tags and warnings on one row with their
  explanations; a short footer. Chat lines and comments are unchanged.
- **A node that does not answer is said plainly** (#206, unseenet#704): the other nodes'
  groups and posts are shown at once, and the status bar says "unseenet-node4 is not
  answering yet" until it does.
- **Read more where the author chooses** (#188, UN-RFC 0031 3.2.1): an entry with a line of
  only `...` is cut there with *… more* - even when short, and up to twice the normal cut;
  further down the line is ignored. Opened, the line is not shown. *Insert read more* beside
  the text when writing a post.
- **Private chats as a fixed item** (asked for by the maintainer, #172): *Private chats* at
  the top under *Private posts*, with what is unread and only the chats with unread lines
  under it (at most five, then *Show all*); the full list in the main pane - filter,
  *Contacts*, *Chat with someone*, closed chats last. The foldable `chats` heading among
  the groups is gone, and the filter says "groups and people".
- **What comes into the timeline** (asked for by the maintainer, #201, UN-RFC 0034 6.2): a
  ☰ switch in a group's head - *In timeline* / *Add to timeline* - and in its ⋯ menu and the
  palette; a quiet mark on the groups in the timeline in the list. Feeds are in by default,
  groups of threads come in with each new thread, chats never. One word everywhere:
  *Follow* and *Leave*.

- **Choosing a language, nicely** (asked for by the maintainer): one small button - the
  code in a badge and the language's own name, *EN English ▾* - and a list to pick from:
  suggested, the group's, the languages a text can be told in, more, and None, with a
  search that finds "da", "dansk" and "danish". In the compose window and by the chat
  and comment inputs; the core's list (unseenet#694), no flags.

- **The language from your text** (unseenet#686): while you write, at pauses, the core tells
  the language from the text - the *Language* field follows it (*from your text*), until
  you change the field yourself; a reply starts from the post it answers. The chat chip
  follows a longer line in another language; short lines keep the conversation's.

- **Languages where they belong** (unseenet#671): a group's languages (and tags) in its
  *?* window; the *Language* field under the text, by the tags - chosen after writing,
  not before; and a small language chip by the chat and comment inputs - what the core
  suggests, a click to change it, remembered for the group with the next line.

- **Proven from an older key** (unseenet#684, UN-RFC 0049 7.3): a post brought from an
  Unseenet export with a proof that holds says *proven from the key …* by its origin.

- **The language of what you write** (#194, unseenet#671): a *Language* field by the subject,
  filled with what the core suggests and why - what you wrote in here last, the group's,
  or your profile's; change it there, and it is remembered for the group. Chat lines and
  comments get the suggestion by themselves; nothing is sent when nothing is suggested. A
  post shows its language only where it differs from its group's. *Edit group*: the
  languages written there.

- **For you and Show all** (#169, unseenet#629): **Show all** over a view where your rules
  act - the feed, a threaded group, For you - shows it without them, plainly marked
  (*Showing all - your rules are paused here*), with *Back to my rules*; never saved, and
  it ends when you leave the view. In For you, what is on the screen is seen (the count
  drops, nothing disappears), and an entry your `[foryou]` rules quiet says *quiet*.

- **Everything with a tag** (unseenet#672): a click on a tag shows every post with it in
  your groups and feeds, as a feed, each in its own group - not only the view you are in.
- **Who reads on this device** (unseenet#674, UN-RFC 0053 6.1): an age guide - under 13,
  13 to 17, an adult - that sets what is blurred and hidden. Nothing of the answer is kept;
  only the settings, which you can change. It says plainly that it covers only what is
  marked. In the palette, beside *Content warnings*, and named by *Your profile*.

- **Tags and content warnings** (#186, UN-RFC 0052, 0053): warnings as square flags at the
  top left of a post - a fixed colour each, always with the word and who set it - and
  the post's text and pictures blurred behind *Show anyway*, or hidden as a quiet line,
  as you chose, never silently; a rule's `blur` the same. In the threads list a stripe
  in the warning's colour before the subject. Topics as quiet chips by the reactions:
  the author's, the group's (dashed, in the feed and timeline; once in a group's head),
  a labeller's (dotted); a click shows only the posts with that tag. Writing: warnings
  to tick and tags as chips, and `#word` in the text shown as a tag at once. *Content
  warnings and labels* in the palette: show, blur or hide per warning, and the
  labellers. *Edit group*: the group's tags.

- **`!` for groups** (unseenet#666): `!dk.snak` names a group and links to it, and `!`
  goes to a group the selected post names (was `#`); `#word` in what you write is a tag now.

- **Report reasons from the core's one list** (unseenet#659): *Threats or harassment* is
  `harassment`, readers can report *Phishing* and *Malware*; the names come from the core.

- **Report under the post** (asked for by the maintainer): in a threads view the reader's
  bar has a *Report* button beside *Reply*, not only the ⋯ menu at the post's head.

- **Publish as the issuer beside you** (unseenet#654): with an issuer beside your own
  identity in the vault - the project's in its maintainer's - a report sent to you
  says *Publish a spam report… as reports@unseenet*, and the dialog says the report is
  signed by that issuer, not by you.
- **The report window closes at once** (unseenet#653): the report is sent in the
  background - a sealed copy for each receiver takes a minute or two of postage - and
  a note says when it has reached them all, or why not.

- **A report sent to you says what to do** (unseenet#650): *Open the reported post*, and
  for an issuer *Publish a spam report…* with the reporter's reason - in your inbox
  and in a team inbox you read. Becoming an issuer asks *where reports sent to you
  land*: your inbox, or a team inbox you read, so others can handle them with you.

- **Report wherever a post is shown** (asked for by the maintainer): *Report* is in the
  ⋯ menu of feed entries, comments and chat lines too, not only in the reader; from
  the timeline it reports to the post's own group. A group's *?* has *Reporting*:
  how, who acts on it, and the issuers that hide posts for you.

- **PDFs in private posts and reports** (unseenet#637): every inbox takes PDFs now, so
  the compose window for a private post and the report window offer them (*Add
  screenshots or PDFs*). A PDF is never shown in the app; saving one adds a warning
  that it can carry harmful content no node could check (unseenet#638 asks whether a
  safe view can be made).

- **Team inboxes** (#68, unseenet#341, UN-RFC 0047): the post that adds you as a
  reader has *Read this inbox with the team*; a team inbox is a mailbox of its own
  under its name; *Reply* there answers as the team - "Reply as Unseenet
  (operator)" - and never with your signature, which would say who wrote it. A
  message written on an inbox's behalf says so, or that it is not verified. A
  reader the owner removed is told, with *Forget it*. The owner of an inbox has
  *Who reads this inbox* in the palette: readers' team keys, add one by their key
  (a new team key goes to their inbox), remove one, and the name replies go out as.

- **Spam reports** (#70, unseenet#122, UN-RFC 0045): a post hidden by a report keeps
  its place and says so - "Hidden by Spamjægeren: spam", in the list, the reader, a
  feed, a comment and a chat - with *Show anyway* and *Stop following*; never hidden
  silently, and never your own or a contact's. *Spam reports* in the palette shows the
  issuers that hide posts for you (those your hierarchies name, on or off, and your
  own) and follows one by its key. As an issuer: start your reports group, *Publish a
  spam report…* from a post's ⋯ menu (also its author, for up to a year), and the
  reports people sent you, ready to publish, and those you published, to withdraw.
- **A report window that is one** (#70, asked for by the maintainer): the post small
  at the top instead of its whole subject as the title, what is wrong as a choice
  (spam, illegal, threats or harassment, something else), who gets it, a real text
  field in Markdown, and screenshots, sent encrypted to each receiver. Needs the
  core's reports with files (unseenet#631).

- **A ⋯ menu on groups in the sidebar** (#167), on hover, on a right click, and
  always visible on a touch screen: About this group, Mark all read, Copy address,
  Edit group (the owner) and Unsubscribe. A hierarchy's heading has Mark all read
  and Fold too.
- **No heading over a group of the same name** (#167): `unseenet` is one row
  that opens the group, and its arrow folds what is under it (the same for a
  folder like `.snak`). A hierarchy with only one group you follow is that group
  alone, by its full name (`feed`, `site`), and headings lose `.*`.
- **The sidebar's top stays put** (#144): the logo, the filter and For you,
  Timeline, your feed and site, Private posts stay while the groups and chats
  scroll - as the account box at the bottom.
- **Your nodes says what the number is** (#153): *13 groups read here* (or *none
  read here*), with what it means on hover; *Details* says how many the node
  carries - so a node you read none of yours from no longer looks empty.

- **Feeds you can live in** (#143, for 0.6.0):
  - **times say how long ago** - now, 5 min, 2 h, Yesterday 14:20, 3 days, then
    the date - with the exact time on hover, kept fresh every minute; in feeds,
    the timeline, comments, the reader and the thread list (chats keep the time);
  - **long entries are cut** after 6 lines (10 wide) with *… more*, opened in place
    with *Show less*; only where something is really hidden; pictures never cut;
  - **comments folded**: the newest and your own talks, *View 20 of N more* at a
    time, and *Newest*, *Where you wrote*, *Mentions you* - never chosen by how many
    answer or react (UN-RFC 0034 4.4).
- **A ⋯ menu at a post's head** in threaded groups, from the maintainer: the
  thirteen buttons under a post become a menu beside *signed*, grouped - *This
  post* (edit, withdraw, pin, copy its addresses, why is this here, report), *This
  thread* (watch, ignore), *The author* (chat, private post, add contact, profile,
  ban, block, ignore). The bar keeps Reply and moving. The keys and the palette are
  as before. *Why is this here?* says first that your rules put it there; the
  timeline says when your rules order it.

- **The palette says what waits for the network**: while Unseenet is not
  connected yet, what needs it (finding groups, opening an address, following,
  creating or editing groups, names, sharing your profile, copying to another
  device, updating ...) is grey and says *waiting for the network*, with a line on
  how connecting goes; chosen anyway it says so instead of failing. It is ready by
  itself once connected. What works offline (your rules, your nodes, contacts,
  settings, writing - posts wait in the queue) works at once.

- **"Your", as the client speaks to you**: *Your feed*, *Your site*, *Start your
  feed*, *Export your data*, *Show your key*, *Share your profile* - matching *For
  you* beside them; "my" stays only in your own words (*Use my rules*). The rule is
  in the core's *Write a client*.

- **Enter in the palette stays in the palette**: a command that fetches first
  (such as *Your rules*) left the page without a dialog for a moment, and the same
  Enter opened the post shown in full screen. The palette stops it, and the page's
  keys leave alone a key something else has taken.
- **Help beside the rules editor** (unseenet#615): *Help* shows the language in
  short - the core's, the same in every client - beside the rules (under them on
  a narrow screen), without touching what you wrote; Ctrl+Enter saves.

- **The rules editor, better** (unseenet#615): line numbers beside the rules,
  the lines not understood marked in red and listed below - a click goes to the
  line; laid out as the other dialogs (wide, the buttons at the bottom right),
  readable in the light theme too.

- **Your own rules** (unseenet#615, UN-RFC 0051): *Your rules* in the palette - an
  editor checked as you type (each line not understood, and why), the core's
  suggestion when you have none (yours only if you save it), and *Use my rules*
  to turn them off and keep them. With rules a thread list comes as they say:
  hidden posts left out, folded ones with *▸ N folded* to open, dimmed and
  highlighted ones, each with its score; *Why is this here?*, and *Watch*,
  *Ignore* or neither for a thread, under the post. While rules are on, what is
  shown is marked seen. Without rules nothing changes, and nothing is sent.

- **Every function says what it does** (#152, part 2): a comment above each of
  the page's 191 functions that had none, and `tests/test_scripts.py` fails on a
  new one without; a Developers page with the map of the scripts. Comments only.

- **app.js split into scripts by area** (#152, part 1): `core.js`, `setup.js`,
  ... `start.js` in `static/`, each opening with what belongs in it, loaded in
  `index.html`'s order and sharing one scope - no build step. A pure move: the
  same code, line for line, in the same order. CI checks every script.

- **Reactions in private chats and posts** (#140, on unseenet#513): the same
  reaction bar as in groups, any emoji; none on your own lines.

- **Export my data** (#141, on unseenet#577): in the menu - your posts, comments,
  chat lines and pages as signed, their files, your profile and the groups you
  follow, saved in Downloads; never your keys; says that it holds only what the
  nodes still carry. Private posts and chats only when chosen, and then the file
  is encrypted with a passphrase you type twice. Not in the browser build yet.

- **Publish a folder as a site** (#125, on unseenet#538): on a site you write
  in, *Publish a folder…* (and the menu) - pick a folder of Markdown or HTML
  files, see what would be sent (new, changed, unchanged, removed pages, and
  every change made on the way), choose whether pages no longer in the folder
  go, and Publish: only what changed is sent. Not in the browser build.

- **Notifications** (#126): a system notification when something lands in
  For you - private messages, replies, mentions - from the core's
  `/api/notifications`, only while the window is open (no push). Asked once
  (Yes / Not now / Never); it says only "N new in For you" unless you choose to
  show the sender and text (menu); one for a burst; none for what is on screen;
  clicking opens For you. Never on the bootable image. The choice is kept with
  your settings, the same in the terminal client.

- **The bootable image's tools have moved to unseenet-bootable**
  (unseenet-bootable#5), with their history, as `tools/image-graphical/`.

- **Imported posts say where they were first published** (#137, UN-RFC 0049):
  "Imported from Facebook · originally 3 August 2026" on feed entries and in
  the reader, with the time of posting beside it - the origin date is the
  poster's claim; a mark in the threads list and the chat tooltip. The order
  by origin date, and posts old on arrival being neither new nor in For you,
  come from the core.

- **The graphical portable's build script has moved to unseenet-portable**
  (unseenet-portable#6), with its history, as `tools/build_graphical.py`, with
  its launchers. `tools/image/` stays until unseenet-bootable#5.

- **Recovery words and copying to another device** (#142, UN-RFC 0050, on the
  core's local API sections 4.18 and 4.19): at first start *Create a new
  identity*, *Restore from recovery words* or *Get it from another device*;
  the words shown after a new identity and with *Show recovery words* behind
  the passphrase, three asked back, a weekly reminder until written down;
  *Print* and *Save as file* behind a warning, neither on the bootable image,
  saving refused on the vault's own disk or in a cloud-looking folder;
  restoring with the words checked as typed, then the closed groups that did
  not come back and asking their owners. *Copy to another device* with a
  choice of identities and closed groups' keys, the QR code (`/x/gui/qr`) and
  the code with a countdown, then the check words; *Get identity from another
  device* by code, or by camera where the browser has `BarcodeDetector`. A
  browser through an entrance can only receive. `/x/gui/state` lists the
  vault's identities. New dependency: `segno` (QR, pure Python). A PIN backed
  by the device's secure hardware (section 5) comes later (#145).

- **The portable and bootable builds are made in unseenet-portable and
  unseenet-bootable** (#129), nightly, by hand and for releases; this
  repository no longer builds them.

- The bootable image's *text only* takes the terminal client from
  [unseenet-tui](https://github.com/unseenet/unseenet-tui), where it has moved
  (unseenet#548).

- **Development builds** are made each night when this repo's `main` or the
  core's `main` changed, by hand, and on release tags - no longer after every
  merge (#128).

## [0.2.0] - 2026-10-25

**For unseenet 0.5** (`unseenet[api]>=0.5,<0.6`): update the nodes first. Feeds and a Timeline, **My feed** and **My site**, sites and pages, pictures and files (also in chats and private posts), profile pictures, pins, reactions, tables, private profiles, `unseenet:` and web addresses, and *Your nodes* to change node while the client is open.

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

[Unreleased]: https://github.com/unseenet/unseenet-gui/compare/v0.3.3...HEAD
[0.3.3]: https://github.com/unseenet/unseenet-gui/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/unseenet/unseenet-gui/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/unseenet/unseenet-gui/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/unseenet/unseenet-gui/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/unseenet/unseenet-gui/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/unseenet/unseenet-gui/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/unseenet/unseenet-gui/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/unseenet/unseenet-gui/releases/tag/v0.1.0
