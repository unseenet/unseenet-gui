# The graphical client

The graphical client is Unseenet in a window: your groups on the left,
threads you click through, chat that looks like chat, your private posts and
contacts, and the groups you run. It uses the same groups, keys and vault as
the [terminal client](https://unseenet.org/client/), and lives in its own repository,
[unseenet/unseenet-gui](https://github.com/unseenet/unseenet-gui).

!!! warning "Pre-alpha"
    Neither the graphical client nor the Unseenet core has had a security review.
    Play with it and pick it apart; do not rely on it to protect anyone yet.

![The graphical client: a discussion group as a thread tree, and the selected post below it](img/web-threads.png)

A discussion is not a chat, and the graphical client keeps them apart.
Discussion groups work like a newsreader: the posts as a tree, one post at a
time below it, ++up++ ++down++ through the thread, ++space++ to the next
unread, and ++r++ to answer in a compose window with the post quoted and your
signature below. Chat groups are chats. The group's owner decides which a
group is, and ++v++ shows it the other way. Everything else is in the command
palette, ++ctrl+p++.

## Three ways to run it

Get the newest release from
[GitHub](https://github.com/unseenet/unseenet-gui/releases/latest). Every
build is self-tested before it is published.

### Portable (Linux, macOS, Windows) { #portable }

Unzip and start, from a USB stick or a folder: nothing is installed. Tor is
included, and everything stays in `data/` beside the programs.
`unseenet-gui-…-usb.zip` has every platform; or take only yours:

- **Windows:** `Unseenet Graphical.exe` opens an app window (no console).
- **macOS:** `Start Unseenet Graphical.command` opens an app window.
- **Linux:** `sh start-graphical-linux.sh` opens Chromium, Chrome, Edge or
  Brave without tabs if you have one, else your browser.

### Bootable (USB, SSD etc.) { #bootable }

Write `unseenet-gui-…-x86_64.img.xz` to a USB stick (for example with
Raspberry Pi Imager or balenaEtcher), boot from it, and the client starts
full screen and runs from memory, touching nothing on the computer's disks,
as with the terminal client's [bootable image](https://unseenet.org/bootable/). The first screen
sets up Wi-Fi and the keyboard. It needs 4 GB of memory. In the boot menu,
*safe graphics* helps if the screen stays black, and *text only* starts the
terminal client instead. The same stick also starts the portable client on a
running computer, with the same `data/`.

### In your browser

On a phone, a tablet or any computer, with nothing to install: open a web
entrance, for example [entrance.unseenet.net](https://entrance.unseenet.net/).
It is the same client, running in the browser, and the less hidden way in.
Read [In your browser](web.md) first.

The graphical client uses the same `Unseenet/` folder and `data/` as the
terminal client's [portable build](https://unseenet.org/portable/), so the two can share a stick
and a vault. Do not run both on the same vault at the same time.

## First start

1. **Choose a passphrase.** It encrypts your vault. There is no way to
   recover it if you forget it.
2. **Choose a display name.** This is just a label. Your real identity is a
   key pair that is created for you. Right after, the client shows your 24
   **recovery words** to write down (or *Later*). Already have an identity?
   Choose *Restore from recovery words* or *Get it from another device*
   instead.
3. **Choose a node.** The client suggests one of the project's nodes at
   random, so not everyone starts on the same one, and keeps the others as
   backups. Choose *Another node* for an address you were given.

You start in the project's groups - `unseenet`, `unseenet.announce`,
`unseenet.help`, `unseenet.chat` and `unseenet.test`, and the demo site and
feed `unseenet.demo.site` and `unseenet.demo.feed` - so there is something to
read. The
first connection takes 10-30 seconds while Tor builds its circuits. Your
first post waits a few minutes more, once, while your new key
[ripens](https://unseenet.org/spec/un-rfc-0025/); the client shows how far it is. Stuck? Ask in
`unseenet.help` - see [Getting help](https://unseenet.org/help/).

## What it can do

![A chat group in the graphical client](img/web-chat.png)

- Read and write: threads and chats (closed groups decrypted), posts, replies
  and chat lines in Markdown with emoji, *For you* (replies and mentions),
  `#group` links, editing your own posts, your signature.
- Feeds and sites (from 0.5): *Timeline* with the feeds you follow, **My
  feed** and **My site**, creating a group as a feed or a site, pages with an
  index, and a person's feed and site from their profile.
- Pictures and files (from 0.5): in posts, chat lines and private posts, as
  the group allows; profile pictures.
- Pins, reactions and tables in Markdown (from 0.5); a ⋯ menu on every post
  and chat line to edit, withdraw, pin or copy its `unseenet:` address.
- Private chats and posts with anyone, by key; contacts as an address book;
  private profiles shared with one person or a closed group.
- People: names (`@you`), profiles (an author's name opens theirs; *Your
  profile* writes yours), ignoring people, hiding bots.
- Groups you run: create open, moderated, channel or closed groups, invite
  to closed ones, moderators and posters, bans, approving posts, the spam
  report issuers your readers follow there.
- Spam and reports: report any post with notes and screenshots, see why a
  post is hidden, choose the issuers you follow, handle reports sent to you,
  team inboxes (see below).
- What you may not write, it says before you write: in a channel's comments,
  under a ban, in a closed group you are not in.
- Your vault: change its passphrase (copies elsewhere keep the old one).
- Recovery words and copying (from 0.3, see below).
- A light and a dark theme, and phones and other narrow screens. On the
  bootable image also the network, Wi-Fi, the keyboard, restart and shut down.

## Spam and reports

How it works, and why nobody gets power over anyone by it, is in the guide:
[Spam and reports](https://unseenet.org/guide/spam/). In the graphical client:

**A post hidden by a report** keeps its place and says who hid it and why -
*⊘ Hidden by reports@unseenet: spam* - with **Show anyway** and **Stop
following …** right there. It is never your own post or a contact's. The
group's title says how many posts reports hide there.

**Reporting a post.** In the post's ⋯ menu - in a discussion, a feed, a
comment or a chat line - choose **Report**. The window shows the post; choose
what is wrong, tick who gets it (the group's owner and moderators, the
hierarchy's maintainer, your node's operator, the spam report issuers that
apply here), write what you want them to know in Markdown, and add
screenshots or PDFs with **Add screenshots or PDFs**. **Anonymous** hides who
you are, and then nobody can answer you. **Report** closes the window at once;
each receiver gets a sealed copy, which takes a minute or two of postage, and
a note tells you when they all have it.

**The issuers that hide posts for you.** **Spam reports** in the command
palette (++ctrl+k++) lists them, each with where it is named - *named for
unseenet.\**, *named for alt.space.nasa*, or *followed by you* - and a box to
turn it off or on. Paste a key under **Follow an issuer** to follow one for
every group.

**A report sent to you** is a private post, in **Private posts** or in a team
inbox you read. It has **Open the reported post**, and if you are an issuer -
or an issuer is beside you in your vault - **Publish a spam report… as …**,
with the reporter's reason filled in. Tick **Also its author** to report their
key for up to a year. What you publish is public and signed by the issuer; the
person who told you is never named in it.

**Becoming an issuer.** **Become a spam report issuer** in the command palette.
Choose **as whom**:

- **You** - reports are signed with your own identity. Simplest for one person.
- **A separate issuer identity in this vault** - for an organisation, a
  hierarchy or a group of volunteers. The client makes a new identity beside
  yours, with the name you give it; you stay you for everything else, and the
  issuer's reports never look like yours.

Then say what you report and how, and choose **where reports sent to you
land** - your own inbox, or a team inbox you read, so that others handle them
with you. **Your spam reports** then lists the reports sent to you, to publish,
and those you published, to withdraw.

**Sharing an issuer with a colleague.** Choose **Copy to another device** (your
profile menu), tick **only the issuer's identity**, and do the copy with them
on their device (UN-RFC 0050: a code, a QR and check words, end to end over Tor).
Their client finds by itself that the identity is an issuer, keeps their own
identity the one in use, and from then on offers *Publish a spam report… as …*
on the reports they read. To stop sharing it, make a new issuer and have the
groups and hierarchies name that one instead.

**For a group you own.** **Edit group** has **Spam reports here**: the issuers
the group's readers follow by default - *Remove*, a key to *Add*, or one of the
issuers you follow with a click. Each reader can still turn them off.

**Team inboxes.** The post that adds you as a reader has **Read this inbox
with the team**. The inbox is then a mailbox of its own under its name;
**Reply** there answers as the team - *Reply as Unseenet (operator)* - and
never with your signature. If the owner removes you, the inbox says so, with
**Forget it**. As the owner of an inbox, **Who reads this inbox** in the
palette adds readers by their key, removes them, and sets the name replies go
out as.

In an emergency, contact the police. Nobody on Unseenet can see who anyone is.

## Recovery words and other devices

- **Recovery words.** 24 words that bring your identity back on any device;
  your groups, contacts and settings come back from the network. *Show
  recovery words* in the menu shows them after your passphrase; type three
  back to note they are written down, or the client reminds you at most once
  a week. *Print* and *Save as file* (to Downloads, refused when that is on
  the vault's own disk or looks like a cloud folder) are there behind a
  warning - paper is safer. On the bootable image they are only shown.
  **Closed groups do not come back** with the words: after *Restore from
  recovery words* the client lists them and can ask their owners to invite
  you again.
- **Copy to another device.** Choose which identities, and whether the keys
  of closed groups go too. The client shows a QR code and a code such as
  `7-guitar-tunnel`; on the other device choose *Get identity from another
  device* and scan it (where the browser can use a camera) or type it. Both
  show the same two check words, and only when you confirm here is anything
  sent - straight to the other device over Tor. In a browser through an
  entrance you can only receive a copy.

Not yet - use the [terminal client](https://unseenet.org/client/): Tor bridges and several
identities. **Updating** a stick or portable folder of the graphical client
is not there yet either, because its builds are not signed yet: download the
new release for now.

## How it works

The graphical client draws its window with web technology, but the portable
and the bootable one are not a website. They run on your own computer,
nothing is hosted anywhere, and on Linux the window it opens in your browser
only talks to the program on your own machine. (In a browser the same program
runs inside the browser instead; see [In your browser](web.md).)

```
 window ──HTTP/WebSocket──▶ unseenet core's local API ──▶ Session ──Tor──▶ nodes
 (127.0.0.1 only)           (UN-RFC 0046)                 vault, keys, postage
```

The window talks to the core's [local client API](https://unseenet.org/spec/un-rfc-0046/), the
same `Session` the terminal client uses: the same encrypted vault, the same
Tor and the same nodes. The window only draws what you see: **keys, signing,
encryption and postage never leave the core**, and the passphrase is sent
once, to unlock.

The local server guards itself against other programs and web pages on the
same computer: it listens on 127.0.0.1 only, every start makes a random token
that every request must carry, and a strict Content-Security-Policy keeps the
page from loading anything from outside. What people wrote reaches the window
as the core's safe render tree, never as HTML, and links in posts are not
opened by themselves, because following one would leave Tor. The
[README](https://github.com/unseenet/unseenet-gui#security) has the details.

## With pip

You need Python 3.11 or newer and Tor installed (the portable and bootable
builds bring their own), as for the [terminal client](https://unseenet.org/client/):

```sh
pip install unseenet-gui
unseenet-gui            # opens your browser
unseenet-gui --window   # in its own window: pip install "unseenet-gui[window]"
```

`--window` uses the system's web view in private mode, so nothing ends up in
your browser's history. The graphical client is released on its own, with
the minor version of the core it works with; see its
[changelog](https://github.com/unseenet/unseenet-gui/blob/main/CHANGELOG.md).
