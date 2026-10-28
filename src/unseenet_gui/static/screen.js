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

// Show a group (or a chat, For you, the timeline), loading it, and remember where you were.
async function openGroup(gid, rerender = true) {
  if (S.gid !== gid) { S.post = null; S.postAt = null; S.full = false; S.mobileReading = false; S.moreTools = false;
    S.showAll = null; }                               // Show all ends when you leave the view (0051 3)
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
  if (gid === CHATS) {                                // a list drawn from the sidebar's people (gui#172)
    S.data = { group: { id: CHATS, label: "Private chats", view: "list" }, messages: [], write: {} };
    return;
  }
  try {
    const data = await api("GET", "/api/groups/" + encodeURIComponent(gid) + (S.showAll === gid ? "?all=1" : ""));
    let site = null;
    if (data.group.view === "pages") site = await loadSite(gid);   // a site: its pages (UN-RFC 0035)
    if (S.gid === gid) S.data = { group: fromGroup(data.group), messages: data.rows.map(fromRow), write: writeOf(data), site };
  } catch (err) { S.status = err.message; }
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
      sb.inbox.id ? item(sb.inbox.id, "@", "Private posts",
        sb.inbox.unread ? h("span", { class: "count", text: sb.inbox.unread }) : null) : null,
      ...chatsItem(sb),
      // posts waiting for you to approve, in groups you moderate (the TUI's Moderation queue)
      sb.moderation ? h("button", { class: "item", onclick: openModeration },
        h("span", { class: "ic", text: "✓" }), h("span", { class: "nm", text: "To approve" }),
        h("span", { class: "count", text: sb.moderation })) : null,
      sb.name_requests ? h("button", { class: "item", onclick: openNames },
        h("span", { class: "ic", text: "@" }), h("span", { class: "nm", text: "Name requests" }),
        h("span", { class: "count", text: sb.name_requests })) : null) : null),
    h("div", { class: "side-scroll", "data-scroll": "side" },
    filtering() ? sideResults(sb, item) : null,
    filtering() ? null : sb ? sb.hierarchies.map(hier => hierarchyNav(hier, item)) :
      h("p", { class: "muted", text: "Loading your groups …" }),
    sb && !sb.hierarchies.length ? h("div", { class: "nav" },
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

const CHATS_SHOWN = 5;                               // unread chats under Private chats

// Private chats as a fixed item at the top (gui#172), with what is unread: under it only
// the chats with unread lines, at most five, and the one you are in, then Show all - so
// a hundred chats never push the groups down.
function chatsItem(sb) {
  const unread = sb.people.reduce((n, p) => n + (p.unread || 0), 0);
  const under = sb.people.filter(p => p.unread || S.gid === p.id).slice(0, CHATS_SHOWN);
  const all = sb.people.length + (sb.contacts || []).filter(c => c.closed).length;
  return [h("div", { class: "chats-row" },
    h("button", { class: `item chats-item${S.gid === CHATS ? " on" : ""}${unread ? " unread" : ""}`,
      "aria-current": S.gid === CHATS ? "page" : null, onclick: () => openGroup(CHATS),
      title: "One chat per person - only the two of you can read it" },
      h("span", { class: "ic" }, svg(ICON.lock, 13, 2.5)), h("span", { class: "nm", text: "Private chats" }),
      unread ? h("span", { class: "count", text: unread }) : null),
    // your contacts and a new chat stay one click away, as before
    h("button", { class: "mini", "aria-label": "Contacts", title: "Your contacts (C)", onclick: openContacts }, svg(ICON.people, 14, 2.5)),
    h("button", { class: "mini", "aria-label": "Chat with someone", title: "Chat with someone", onclick: () => openWrite("", "chat") }, svg(ICON.plus, 14, 2.5))),
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

// The full list of private chats in the main pane (gui#172): filterable, room for
// hundreds, + to start one; closed chats last, back when either of you writes.
function chatsView() {
  const sb = S.sidebar || { people: [], contacts: [] };
  const q = (S.chatFilter || "").trim().toLowerCase();
  const hit = p => !q || (p.label + " " + p.key).toLowerCase().includes(q);
  const open = sb.people.filter(hit);
  const closed = (sb.contacts || []).filter(c => c.closed && hit(c)).map(c => ({ ...c, id: "contact:" + c.key }));
  const about = "Private chats, one per person - only you and the other person can read them. " +
    "Add people as contacts, or start a chat with +.";
  const head = h("header", { class: "ghead" },
    h("button", { class: "btn icon back-groups", "aria-label": "Back to your groups", onclick: () => { S.pane = "groups"; render(); } }, svg(ICON.back)),
    h("div", { class: "t" }, h("div", { class: "row" }, h("h1", { text: "Private chats" }),
      h("span", { class: "chip" }, svg(ICON.lock, 12, 2.5), "end-to-end encrypted")),
      h("p", { text: about })),
    h("div", { class: "actions" },
      h("button", { class: "btn", title: "Your contacts (C)", onclick: openContacts }, "Contacts", h("kbd", { text: "C" })),
      h("button", { class: "btn primary", title: "Chat with someone", onclick: () => openWrite("", "chat") },
        svg(ICON.plus, 16, 2.5), "Chat with someone")));
  const body = h("div", { class: "content chats-list" },
    h("div", { class: "side-filter chats-filter" }, svg(ICON.search, 16),
      h("label", { for: "chatfilter", class: "sr", text: "Filter chats" }),
      h("input", { id: "chatfilter", type: "search", "data-k": "chatfilter", autocomplete: "off",
        placeholder: "Filter by name or key", value: S.chatFilter || "",
        oninput: (e) => { S.chatFilter = e.target.value; render(); },
        onkeydown: (e) => { if (e.key === "Escape") { e.preventDefault(); S.chatFilter = ""; render(); } } })),
    open.length ? h("div", { class: "nav" }, open.map(p => personRow(p))) : null,
    closed.length ? [h("h3", { class: "row-h", text: "Closed - back when one of you writes" }),
      h("div", { class: "nav" }, closed.map(p => personRow(p)))] : null,
    !open.length && !closed.length ? h("div", { class: "empty" },
      h("h2", { text: q ? "No chat matches" : "No private chats yet" }), h("p", { text: about })) : null);
  return [head, body];
}
