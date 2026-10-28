// screen.js - the app screen, and whether you may write in a group (#13).
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- app --------------------------------------------------------------
function allGroups() {
  return (S.sidebar ? S.sidebar.hierarchies : []).flatMap(h => h.groups);
}

// Read the sidebar again from the core: groups, people, For you and your settings.
async function loadSidebar() {
  try {
    const [d, st] = await Promise.all([api("GET", "/api/groups"), api("GET", "/api/settings")]);
    S.sidebar = fromSidebar(d, st);
  }
  catch (err) { S.status = err.message; }
  if (!S.gid) {
    const first = allGroups()[0];
    if (first) await openGroup(first.id, false);
  }
  render();
}

const PHONE = window.matchMedia("(max-width: 760px)");     // the same width as app.css
PHONE.addEventListener?.("change", () => render());

// What the group shown asks of the core, aborted when you leave it (gui#227): a group
// still loading or its emoji must not hold the browser's few connections to the core.
let viewAbort = new AbortController();
const viewSignal = () => viewAbort.signal;
const aborted = (err) => err && (err.name === "AbortError" || err.name === "TimeoutError");

// Show a group (or a chat, For you, the timeline), loading it, and remember where you were.
async function openGroup(gid, rerender = true) {
  if (S.gid !== gid) { S.post = null; S.postAt = null; S.full = false; S.mobileReading = false; S.moreTools = false;
    S.showAll = null;                                 // Show all ends when you leave the view (0051 3)
    viewAbort.abort(); viewAbort = new AbortController(); }
  if (rerender) S.pane = "group";      // the first group opened by itself leaves a phone on the list
  S.gid = gid;
  revealGroup(gid);
  languageList();                                      // the names for choosing a language (once)
  await loadGroup();
  if (rerender) render();
  const g = S.data && S.data.group;
  // a phone would pop up its keyboard over the chat: there you tap the input yourself
  if (g && g.view === "chat" && !PHONE.matches) setTimeout(() => { const i = document.querySelector('[data-k="chat"]'); if (i) i.focus(); });
}

// Read the group shown from the core again: its settings and messages, and what you may do
// there.
async function loadGroup() {
  if (!S.gid) return;
  const gid = S.gid;
  if (gid === CHATS || gid === CONTACTS) {            // lists drawn from the sidebar (gui#172, #209)
    S.data = { group: { id: gid, label: gid === CHATS ? "Private chats" : "Your contacts", view: "list" },
      messages: [], write: {} };
    return;
  }
  try {
    const data = await api("GET", "/api/groups/" + encodeURIComponent(gid) + (S.showAll === gid ? "?all=1" : ""),
      null, { signal: viewSignal() });
    let site = null;
    if (data.group.view === "pages") site = await loadSite(gid);   // a site: its pages (UN-RFC 0035)
    if (S.gid === gid) S.data = { group: fromGroup(data.group), messages: data.rows.map(fromRow), write: writeOf(data), site };
    noteGroupEmoji(data.group);                       // its own emoji (UN-RFC 0056)
  } catch (err) { if (!aborted(err)) S.status = err.message; }    // left it: nothing to say
}

// ---- may you write here? (#13) -------------------------------------------------
// Said before you write, as the terminal client does: the core's write_permission
// (the kinds a group takes, bans, blocks, posters, closed-group members, comments in
// channels and when they close). Buttons you may not use are
// shown greyed out with the reason, rather than hidden, so people learn why.
// The core says it with the group (unseenet#320): ``write`` on its head, ``reply``
// on each row; contacts, For you and your inbox have neither.
function writeOf(data) {
  const w = data.group && data.group.write;
  if (!w) return {};
  const replies = {};
  for (const r of data.rows) if (r.reply && r.message && r.message.id) replies[r.message.id] = r.reply;
  return { post: w.post, chat: w.chat, replies };
}
const NOT_HERE = "Only chosen people can write here.";
// Whether you may post or chat in the group shown, and if not why (#13), from what the core
// said.
function mayWrite(d, what) {                      // what: "post" or "chat"
  const p = d && d.write && d.write[what];
  if (p) return p;
  const ok = !!(d && d.group && d.group.may_post);
  return { allowed: ok, reason: ok ? "" : NOT_HERE, code: ok ? "ok" : "other" };
}
// Whether you may answer this post, and if not why: closed comments, a channel, a ban.
function mayReply(d, m) {
  const g = d.group;
  if (g.id === FOR_YOU || !m.readable || !m.key) return { allowed: false, reason: "", code: "none" };
  if (g.private_reply || g.type === "contact") return { allowed: true, reason: "", code: "ok" };
  const p = d.write && d.write.replies && d.write.replies[m.id];
  if (p) return p;
  const post = mayWrite(d, "post");        // not read by the core yet: what holds for the group
  return post.code === "channel_thread" ? { allowed: true, reason: "", code: "ok" } : post;
}
// In a channel open for comments, a reader's reply is a comment (UN-RFC 0030).
const commenting = (d) => d.group.type === "channel" && mayWrite(d, "post").code === "channel_thread";
// a button that says why it does nothing, instead of not being there
function offProps(p, props) {
  return p.allowed ? props : { ...props, class: (props.class || "btn") + " off", "aria-disabled": "true",
    title: p.reason, onclick: (e) => { e.preventDefault(); if (p.reason) toast(p.reason); } };
}
// Reply to a post, or say why you cannot.
function tryReply(m, g) {
  const p = mayReply(S.data, m);
  if (p.allowed) openReply(m, g);
  else if (p.reason) toast(p.reason);
}

let markTimer = null, toMark = new Set();
// Mark the messages shown as read, in the core too.
function markRead(msgs) {
  const ids = msgs.filter(m => !m.read).map(m => m.id);
  if (!ids.length) return;
  ids.forEach(i => toMark.add(i));
  msgs.forEach(m => { m.read = true; });
  clearTimeout(markTimer);
  const gid = S.gid;
  markTimer = setTimeout(() => {
    const list = [...toMark]; toMark.clear();
    api("POST", `/api/groups/${encodeURIComponent(gid)}/read`, { ids: list }).catch(() => {});
  }, 600);
}

// Full-screen reading, as the terminal client's reader (F): the post gets the whole window.
function reading() {
  return !!(S.full && S.data && S.data.group && S.data.group.view !== "chat" && S.data.messages.length);
}

// The app: the sidebar and the group shown (on a phone one of them at a time).
function appScreen() {
  const pane = S.gid && S.pane !== "groups" ? "group" : "groups";   // phones show one (app.css)
  return h("div", { class: "app pane-" + pane + (reading() ? " reading-full" : "") },
    ripeningBanner(),
    h("div", { class: "body" }, sidebar(), h("main", { class: "main" }, mainArea())),
    statusbar());
}

// replies to you (◄) and posts naming you (♦), counted apart (unseenet #170)
function forYouMarks(c) {
  if (!c.for_you) return null;
  const parts = [];
  if (c.replies) parts.push(`◄${c.replies}`);
  if (c.mentions) parts.push(`♦${c.mentions}`);
  const title = [c.replies ? `${c.replies} ${c.replies === 1 ? "reply" : "replies"} to you` : "",
                 c.mentions ? `${c.mentions} ${c.mentions === 1 ? "post names" : "posts name"} you` : ""]
    .filter(Boolean).join(", ");
  return h("span", { class: "foryou", title, text: parts.join(" ") || `◄${c.for_you}` });
}

// The sidebar: you, For you, your feed, site and timeline, private posts and chats, and the
// group tree - groups only.
function sidebar() {
  const sb = S.sidebar, me = S.state.me || {};
  const item = (gid, ic, label, extra, cls = "", title = null) => h("button", {
    class: `item ${cls}${S.gid === gid ? " on" : ""}`, onclick: () => openGroup(gid),
    "aria-current": S.gid === gid ? "page" : null, title },
    h("span", { class: "ic", text: ic }),
    typeof label === "string" ? h("span", { class: "nm", text: label }) : h("span", { class: "nm" }, label), extra);
  // the groups scroll; you stay at the bottom, however many groups there are
  return h("nav", { class: "side", "aria-label": "Groups" },
    // the top stays put while the groups scroll, as the account box at the bottom (#144)
    h("div", { class: "side-top" },
    h("div", { class: "brand" }, logo(30), h("span", { class: "grow", text: "Unseenet" }),
      h("button", { class: "mini cmd-btn", "aria-label": "Commands", title: "Commands and search (Ctrl P)",
        onclick: () => openPalette() }, svg(ICON.cmd, 16, 2.5))),
    // a filter for what the sidebar lists, as / in the terminal client; Esc clears it
    h("div", { class: "side-filter" }, svg(ICON.search, 16),
      h("label", { for: "sidefilter", class: "sr", text: "Filter groups and people" }),
      h("input", { id: "sidefilter", type: "search", "data-k": "sidefilter", autocomplete: "off",
        placeholder: "Filter groups and people", value: S.sideFilter || "",
        oninput: (e) => { S.sideFilter = e.target.value; render(); },
        onkeydown: (e) => {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); S.sideFilter = ""; render(); }
          else if (e.key === "Enter") {
            const first = document.querySelector("nav.side .side-results .item");
            if (first) { e.preventDefault(); first.click(); }
          }
        } })),
    filtering() ? null : sb ? h("div", { class: "nav" },
      item(FOR_YOU, "◄", "For you", forYouMarks(sb)),
      sb.timeline.feeds ? item(TIMELINE, "☰", "Timeline", null, "", "The feeds you follow and the groups you added, newest first") : null,
      // your own feed and site at the top, or the way to start them, as in the terminal client (gui#101)
      ...[[sb.my_feed, "☰", "feed", openMyFeed, "Your own feed - public, anyone can comment"],
          [sb.my_site, "▤", "site", openMySite, "Your own site of pages - public"]].map(([m, ic, kind, start, title]) =>
        !m ? null : m.started
        ? item(m.id, ic, "Your " + kind, m.unread ? h("span", { class: "count", text: m.unread }) : null, "", title)
        : h("button", { class: "item start", onclick: start, title },
            h("span", { class: "ic", text: ic }), h("span", { class: "nm", text: "Start your " + kind }))),
      ...privateItems(sb),                            // contacts, posts, chats alike (gui#209)
      // posts waiting for you to approve, in groups you moderate (the TUI's Moderation queue)
      sb.moderation ? h("button", { class: "item", onclick: openModeration },
        h("span", { class: "ic", text: "✓" }), h("span", { class: "nm", text: "To approve" }),
        h("span", { class: "count", text: sb.moderation })) : null,
      sb.name_requests ? h("button", { class: "item", onclick: openNames },
        h("span", { class: "ic", text: "@" }), h("span", { class: "nm", text: "Name requests" }),
        h("span", { class: "count", text: sb.name_requests })) : null) : null),
    h("div", { class: "side-scroll", "data-scroll": "side" },
    filtering() ? sideResults(sb, item) : null,
    filtering() ? null : sb ? peopleFollowedNav(sb, item) : null,
    filtering() ? null : sb ? sb.hierarchies.map(hier => hierarchyNav(hier, item)) :
      h("p", { class: "muted", text: "Loading your groups …" }),
    sb && !sb.hierarchies.length && !(sb.people_followed || []).length ? h("div", { class: "nav" },
      h("p", { class: "muted", style: "margin:0 10px", text: "No groups yet." }),
      h("button", { class: "btn", onclick: openBrowse }, "Find groups", h("kbd", { text: "G" }))) : null),
    h("div", { class: "me" },
      // your picture and name open your profile (#83), as in most apps
      h("button", { class: "me-open", title: "Your profile", "aria-label": "Your profile", onclick: openMyProfile },
        avatar({ key: me.key, who: me.display, colour: 4 }, true)),
      h("div", { class: "who" }, h("div", {}, h("button", { class: "me-name", title: "Your profile", onclick: openMyProfile,
          text: me.label || me.display || "" })),
        nodeLink(),
        ripeLine()),
      h("button", { class: "btn icon", "aria-label": "Show your key", title: "Show your key (K)", onclick: openKey, text: "K" })));
}

const CHATS_SHOWN = 3;                               // unread chats under Private chats (gui#209)

// The private part of the sidebar (gui#209): three rows alike - Your contacts, Private
// posts, Private chats - each opening its list in the main pane, no buttons on them;
// under Private chats only the chats with unread lines (at most three, and the one you
// are in), then Show all, so a hundred chats never push the groups down.
function privateItems(sb) {
  const row = (gid, icon, label, count, title) => h("button", {
    class: `item private-item${gid === CHATS ? " chats-item" : ""}${S.gid === gid ? " on" : ""}${count ? " unread" : ""}`,
    "aria-current": S.gid === gid ? "page" : null, onclick: () => openGroup(gid), title },
    h("span", { class: "ic" }, svg(icon, 14, 2.2)), h("span", { class: "nm", text: label }),
    count ? h("span", { class: "count", text: count }) : null);
  const unread = sb.people.reduce((n, p) => n + (p.unread || 0), 0);
  const under = sb.people.filter(p => p.unread || S.gid === p.id).slice(0, CHATS_SHOWN);
  const all = sb.people.length + (sb.contacts || []).filter(c => c.closed).length;
  return [
    row(CONTACTS, ICON.people, "Your contacts", 0, "The people you gave a name - only you see the names (C)"),
    sb.inbox.id ? row(sb.inbox.id, ICON.mail, "Private posts", sb.inbox.unread, "Posts sealed to you") : null,
    h("div", { class: "chats-row" }, row(CHATS, ICON.bubble, "Private chats", unread,
      "One chat per person - only the two of you can read it")),
    under.length ? h("div", { class: "sub chats-sub" }, under.map(p => personRow(p)),
      all > under.length ? h("button", { class: "item more-chats", onclick: () => openGroup(CHATS) },
        h("span", { class: "nm", text: `Show all (${all})` })) : null) : null];
}

// One person's chat in a list: their initials, name, unread lines, and its ⋯.
function personRow(p, extra = null) {
  return h("div", { class: "personrow" }, h("button", {
    class: `item person${S.gid === p.id ? " on" : ""}${p.unread ? " unread" : ""}${p.contact ? "" : " stranger"}`,
    onclick: () => openGroup(p.id || "contact:" + p.key),
    title: p.contact ? null : "Not a contact - open the chat to add them" },
    h("span", { class: `av xs c${p.colour}`, "aria-hidden": "true", text: initials(p.label) }),
    h("span", { class: "nm", text: p.label }), extra,
    p.unread ? h("span", { class: "count", text: p.unread }) : null),
    p.closed ? null : chatMenu(p));
}

// The head every private list has (gui#209): title, a chip, one line, the main action.
// Your contacts is one click away in the sidebar (and C), so no Contacts button here (gui#219).
function privateHead(title, chip, about, actions) {
  return h("header", { class: "ghead" },
    h("button", { class: "btn icon back-groups", "aria-label": "Back to your groups", onclick: () => { S.pane = "groups"; render(); } }, svg(ICON.back)),
    h("div", { class: "t" }, h("div", { class: "row" }, h("h1", { text: title }),
      h("span", { class: "chip" }, svg(ICON.lock, 12, 2.5), chip)), h("p", { text: about })),
    h("div", { class: "actions" }, actions));
}

// A filter field for a private list, kept in S[key].
function privateFilter(key, label, placeholder) {
  return h("div", { class: "side-filter chats-filter" }, svg(ICON.search, 16),
    h("label", { for: key.toLowerCase(), class: "sr", text: label }),
    h("input", { id: key.toLowerCase(), type: "search", "data-k": key.toLowerCase(), autocomplete: "off", placeholder, value: S[key] || "",
      oninput: (e) => { S[key] = e.target.value; render(); },
      onkeydown: (e) => { if (e.key === "Escape") { e.preventDefault(); S[key] = ""; render(); } } }));
}

// One row in the private lists of the main pane (gui#217): the person, then the buttons at
// the right - the same height, spacing and place in Private chats and Your contacts.
function listRow(p, cls, buttons, extra = null) {
  const label = p.label.replace(/ √$/, "");
  return h("div", { class: "listrow " + cls },
    h("button", { class: `item person${p.unread ? " unread" : ""}${p.contact ? "" : " stranger"}`,
      onclick: () => p.open ? p.open() : openGroup(p.id || "contact:" + p.key),
      title: p.openTitle || (p.contact ? "Chat with " + label : "Not a contact - open the chat to add them") },
      h("span", { class: `av xs c${p.colour}`, "aria-hidden": "true", text: initials(p.label) }),
      h("span", { class: "nm", text: p.label }), extra,
      p.unread ? h("span", { class: "count", text: p.unread }) : null),
    h("div", { class: "rowbtns" }, buttons));
}

// The buttons on a chat in the list (gui#217): plain buttons, not a ⋯ menu.
function chatButtons(p) {
  const label = p.label.replace(/ √$/, "");
  if (p.closed) return [h("button", { class: "btn", onclick: () => openGroup(p.id) }, "Chat")];
  return [p.contact ? null : h("button", { class: "btn", title: "Give " + label + " a name of your own",
      onclick: () => openAddContact(p.key, label.replace(/~.*$/, "").replace(/^@/, "")) }, "Add contact"),
    h("button", { class: "btn", title: "Write a private post to " + label, onclick: () => openPost(p.key, label) }, "Post"),
    h("button", { class: "btn", title: "Close the chat - it comes back when one of you writes",
      onclick: () => closeChat(p.key, label) }, "Close")];
}

// The full list of private chats in the main pane (gui#172): filterable, room for
// hundreds, + to start one; closed chats last, back when either of you writes.
function chatsView() {
  const sb = S.sidebar || { people: [], contacts: [] };
  const q = (S.chatFilter || "").trim().toLowerCase();
  const hit = p => !q || (p.label + " " + p.key).toLowerCase().includes(q);
  const open = sb.people.filter(hit);
  const closed = (sb.contacts || []).filter(c => c.closed && hit(c))
    .map(c => ({ ...c, id: "contact:" + c.key, contact: true, unread: 0 }));
  const about = "One chat per person - only the two of you can read it.";
  const head = privateHead("Private chats", "end-to-end encrypted", about, [   // one action, as the other lists (gui#219)
    h("button", { class: "btn primary", title: "Chat with someone", onclick: () => openWrite("", "chat") },
      svg(ICON.plus, 16, 2.5), "Chat with someone")]);
  const body = h("div", { class: "content chats-list" },
    privateFilter("chatFilter", "Filter chats", "Filter by name or key"),
    open.length ? h("div", { class: "nav" }, open.map(p => listRow(p, "chatrow", chatButtons(p)))) : null,
    closed.length ? [h("h3", { class: "list-h", text: "Closed - back when one of you writes" }),
      h("div", { class: "nav" }, closed.map(p => listRow(p, "chatrow closed", chatButtons(p))))] : null,
    !open.length && !closed.length ? h("div", { class: "empty" },
      h("h2", { text: q ? "No chat matches" : "No private chats yet" }), h("p", { text: about })) : null);
  return [head, body];
}

// Your contacts in the main pane (gui#209, instead of the old dialog): find one, chat,
// write a post, rename or remove - and add someone by their key.
function contactsView() {
  const q = (S.contactFilter || "").trim().toLowerCase();
  const list = contactList().filter(c => contactMatches(c, q))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  const looksLikeKey = /^ed25519:[a-z2-7]{20,}$/i.test((S.contactFilter || "").trim());
  const about = "The people you gave a name. The names are yours: only you see them, and nobody is told.";
  const head = privateHead("Your contacts", "names only you see", about, [
    h("button", { class: "btn primary", onclick: () => openAddContact("", "") }, svg(ICON.plus, 16, 2.5), "Add a contact")]);
  const body = h("div", { class: "content chats-list contacts-list" },
    privateFilter("contactFilter", "Find a contact", "Find: a name, a key or sonia@lorensen"),
    // the name opens their profile (gui#215) - feed, site, follow, chat, post from there
    list.length ? h("div", { class: "nav" }, list.map(c => listRow({ ...c, contact: true, unread: 0,
        open: () => openProfile(c.key, c.label, "me"), openTitle: "Profile of " + c.label }, "contactrow", [
      h("button", { class: "btn", title: "Their profile, feed and site", onclick: () => openProfile(c.key, c.label, "me") }, "Profile"),
      h("button", { class: "btn", onclick: () => openGroup("contact:" + c.key) }, "Chat"),
      h("button", { class: "btn", onclick: () => openPost(c.key, c.label) }, "Post"),
      contactMenu(c)],
      c.names && c.names.length ? h("span", { class: "hint", text: c.names.join(", ") }) : null))) :
    h("div", { class: "empty" }, h("h2", { text: q ? "No contact matches" : "No contacts yet" }),
      looksLikeKey ? h("div", { class: "row" },
        h("button", { class: "btn primary", onclick: () => openGroup("contact:" + S.contactFilter.trim()) }, "Chat with this key"),
        h("button", { class: "btn", onclick: () => openAddContact(S.contactFilter.trim(), "") }, "Add as contact")) :
        h("p", { text: q ? "Paste a key to chat with it or add it." :
          "Open a post or a profile and choose Add contact to give its author a name of your own." })));
  return [head, body];
}

// "⋯" on a contact: rename or remove (asked once more).
function contactMenu(c) {
  const id = "contact:" + c.key, open = S.menuFor === id;
  const items = [["Rename", () => openAddContact(c.key, c.label)],
    ["Remove", async () => {
      if (!window.confirm(`Remove ${c.label}? The contact is forgotten; your chat and posts stay.`)) return;
      try { await api("POST", "/api/contacts", { key: c.key, remove: true }); } catch (x) { toast(x.message); return; }
      toast(c.label + " is no longer a contact."); await loadSidebar(); render(); }]];
  return h("div", { class: "more" + (open ? " open" : "") },
    h("button", { class: "morebtn", type: "button", "aria-label": "More about " + c.label, "aria-haspopup": "menu",
      "aria-expanded": String(open), onclick: (e) => { e.stopPropagation(); S.menuFor = open ? null : id; render(); } }, "⋯"),
    open ? h("div", { class: "menu", role: "menu" }, items.map(([label, run]) => h("button", { class: "mi", type: "button",
      role: "menuitem", onclick: (e) => { e.stopPropagation(); S.menuFor = null; render(); run(); } }, label))) : null);
}
