/* Unseenet graphical client.
 *
 * Talks only to the local server it was opened from. Everything a person
 * wrote is put on the page with textContent, never as HTML, and links in
 * posts are not made clickable: following one would leave Tor.
 */
// core.js - the page's base: an address to open, the token, the theme, the core's local API (UN-RFC 0046) into what the page draws, shared helpers, and rendering with focus and scroll kept. Everything else uses these.
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- an address to open ------------------------------------------------------
// A web+unseenet: link the browser handed to us (registerProtocolHandler, below):
// #open=<the address>. Opened once the vault is unlocked (#98, UN-RFC 0031 3.4.1).
let OPEN_AT = (() => {
  const m = location.hash.match(/[#&]open=([^&]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch (_) { return null; }
})();

// ---- token --------------------------------------------------------------
// The address we are opened with carries a one-time key (#t=...). Keep it for
// this tab only, and take it out of the address bar and history.
const TOKEN = (() => {
  const m = location.hash.match(/[#&]t=([A-Za-z0-9_-]+)/);
  let t = m ? m[1] : null;
  try {
    if (t) sessionStorage.setItem("unseenet-token", t);
    else t = sessionStorage.getItem("unseenet-token");
  } catch (_) { /* storage may be off; the hash still works this time */ }
  if (m || OPEN_AT) history.replaceState(null, "", location.pathname);
  return t;
})();

// ---- theme: the system's choice, or the one picked in the palette -------------
// Kept with your settings in the core (#84, UN-RFC 0046 section 4.8), so it follows you
// from device to device; the browser's copy only paints the first frame before the core
// answers (the GUI's port, and so its storage, can change every start).
const THEMES = ["light", "dark"];
let THEME = null;
// Set the theme (light, dark, or null for the system's) and draw it; kept in this browser
// and, unless save is false, with your settings in the core so it follows you. Without an
// argument: the theme in use.
function theme(set, save = true) {
  if (set !== undefined) {
    THEME = THEMES.includes(set) ? set : null;
    try { if (THEME) localStorage.setItem("unseenet-theme", THEME); else localStorage.removeItem("unseenet-theme"); } catch (_) { /* no storage */ }
    if (save) api("POST", "/api/settings/clients/gui", { theme: THEME }).catch(() => {});
  } else if (THEME === null) {
    try { THEME = localStorage.getItem("unseenet-theme"); } catch (_) { THEME = null; }
    if (!THEMES.includes(THEME)) THEME = null;
  }
  if (THEME) document.documentElement.dataset.theme = THEME; else delete document.documentElement.dataset.theme;
  return THEME || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
}
theme();
// The theme kept with your settings in the core, after unlocking: it wins over this
// browser's copy.
async function loadTheme() {          // the one kept with your settings counts
  try {
    const t = ((await api("GET", "/api/settings/clients/gui")).settings || {}).theme;
    theme(THEMES.includes(t) ? t : null, false);
  } catch (_) { /* a core without client settings: the browser's copy stays */ }
}

const S = {
  state: null, sidebar: null, gid: null, data: null, thread: null, replyTo: null,
  pending: {}, early: {}, drafts: {}, dialog: null, status: "", error: "", busy: false,
  knownNodes: null, setupNode: null, ws: null, mobileReading: false,
  pane: "groups",          // on a phone: one pane at a time - "groups", or the group
  moreTools: false,        // on a phone: the post's less used tools shown
};


// ---- the core's local API (UN-RFC 0046) into what the page draws ------------------
// The answers are the core's (unseenet.client.localapi). These few functions turn
// them into the objects the rest of this file draws, so the drawing stays as it was.
const FOR_YOU = "for-you:";                          // the core's pseudo group (threads.FOR_YOU)
const TIMELINE = "timeline:";                        // every feed you follow (threads.TIMELINE)
const CHATS = "chats:";                              // the list of private chats, drawn here (gui#172)
const CONTACTS = "contacts:";                        // your contacts, drawn here (gui#209)
const PRIVATE = "private:";                          // Private on a phone: the desktop's three rows (gui#256)
const YOU = "you:";                                  // you and the state of things, on a phone (gui#248)
const TAGGED = "tag:";                               // + a tag: everything with it (threads.TAGGED)
// Posts from many groups, each in its own: the timeline and a tag's view.
const isMixed = (g) => !!g && (g.id === TIMELINE || String(g.id).startsWith(TAGGED));
const ACCESS_ICONS = { moderated: "√", channel: "►", closed: "∩" };
const VIEW_ICONS = { chat: "»", data: "¤", threads: "≡", feed: "☰", pages: "⌂" };
const MARKDOWN = "text/markdown; charset=utf-8; variant=unseenet";   // core.markup.MARKDOWN_TYPE
const isMd = (t) => (t || "").split(";")[0].trim().toLowerCase() === "text/markdown";

// A stable avatar colour (0-5) for a key, the same each time.
function colour(key) {
  let x = 2166136261;
  for (const ch of key || "") { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; }
  return x % 6;
}
const person = (p) => ({ ...p, colour: colour(p.key) });

// A group as the local API gives it (UN-RFC 0046 4.2) -> what the page draws: its label,
// counts, roles and colour.
function fromGroup(g) {
  const roles = g.roles || {}, pseudo = ["inbox", "contact"].includes(g.type) || g.id === FOR_YOU;
  return { ...g,
    label: g.shown || g.label,                       // the name as UN-RFC 0018 says to show it
    title: g.title || (pseudo ? g.description : ""),
    // without a description of its own, a group's description is its title: shown once
    description: pseudo || g.description === g.title ? "" : (g.description || ""),
    access: ["inbox", "contact"].includes(g.type) ? "@" : ACCESS_ICONS[g.type] || (g.local ? "⌂" : ""),
    icon: g.id === FOR_YOU ? "◄" : g.type ? (VIEW_ICONS[g.view] || "≡") : "·",
    fast: !!g.low_latency, encrypted: ["closed", "inbox", "contact"].includes(g.type),
    unread: g.unread || 0, replies: g.replies || 0, mentions: g.mentions || 0,
    for_you: (g.replies || 0) + (g.mentions || 0),
    charter_markdown: isMd(g.charter_type), private_reply: g.type === "inbox",
    colour: g.key ? colour(g.key) : undefined,
    members: (roles.members || []).map(person), moderators: (roles.moderators || []).map(person),
    posters: (roles.posters || []).map(person), banned: (roles.banned || []).map(person),
    moderates: !!roles.moderates, maintainer: !!roles.maintainer };
}

// A row of a group's messages from the local API -> the message the page draws: who, when,
// text, reactions, permissions.
function fromRow(r) {
  const m = r.message;
  return { id: m.id, number: m.number, group: m.group, subject: m.subject, kind: m.kind,
    who: r.who, key: r.who_key, colour: colour(r.who_key), mine: r.mine, contact: r.contact,
    bot: !!r.bot,                                     // its profile says it posts automatically
    date: m.date, text: m.text, signature: m.signature, references: m.references,
    encrypted: m.encrypted, private: m.private, verified: !!m.sender_key,
    readable: m.readable, error: m.error, edited: m.edited,
    tree: r.tree, markdown: isMd(m.content_type), read: r.read, for_me: r.for_me,
    may_withdraw: r.may_withdraw, may_edit: r.may_edit, groups: r.groups, notice: r.notice,
    edit_tags: r.edit_tags || null,                   // what an edit starts with (unseenet#733)
    depth: r.depth, attachments: m.attachments || [], identicon: r.identicon || null,
    card: m.card || null,                             // its link card (UN-RFC 0059)
    pinned: !!r.pinned, address: r.address || "",
    // reactions (UN-RFC 0048): the counts, may you react, and its own group's set
    reactions: r.reactions || [], react: r.react || null, react_offered: r.react_offered || null,
    preview: r.preview || null,                      // a feed's shared cut (unseenet#781, gui#269)
    comment: r.comment || null, replyPerm: r.reply || null, group_label: r.group_label || "",
    // a thread's first post: does it take comments now, until when, a close's note, and
    // may you close or open them (UN-RFC 0030 sections 3.1-3.2)
    comments: r.comments || null, may_close_comments: !!r.may_close_comments,
    // first published elsewhere (UN-RFC 0049): {network, date, id, from}, and old on arrival
    origin: m.origin || null, old_on_arrival: !!m.old_on_arrival,
    // your own rules (UN-RFC 0051), only when you have some: score, actions, hidden, why
    score: r.score, actions: r.actions || [], hidden: !!r.hidden, why: r.why || "",
    thread_mark: r.thread_mark || "",
    // hidden by a spam report from an issuer you follow (UN-RFC 0045): who, why, which report
    reported: m.reported || null,
    // team inboxes (UN-RFC 0047): written on an inbox's behalf, and a team key handed to you
    team: r.team || null, team_invite: m.team_invite || null,
    // a report sent to you (#74): the post it names {id, group, author_key, reason}
    report: r.report || null,
    // the author's tags (UN-RFC 0052), and warnings, topics and what to do (UN-RFC 0053)
    tags: m.tags || [], labels: m.labels || null,
    languages: m.languages || [] };                   // Content-Language (UN-RFC 0052 5a)
}

// UN-RFC 0049 section 5.1: "Imported from Facebook · originally 3 August 2026" - the
// origin date is the author's (or gateway's) claim, never shown as the time of posting.
const NETWORK_NAMES = { facebook: "Facebook", x: "X", twitter: "X", instagram: "Instagram",
  mastodon: "Mastodon", bluesky: "Bluesky", tiktok: "TikTok", nostr: "Nostr", matrix: "Matrix",
  usenet: "Usenet", fidonet: "FidoNet", unseenet: "another Unseenet key" };
// A network's name as people know it (facebook -> Facebook), for imported posts.
function networkName(n) { return NETWORK_NAMES[n] || (n ? n.charAt(0).toUpperCase() + n.slice(1) : ""); }
// "Imported from Facebook · originally 3 August 2026" for a post first published elsewhere
// (UN-RFC 0049 5.1); "" for others.
function originText(m) {
  if (!m.origin) return "";
  return "Imported from " + networkName(m.origin.network) +
    (m.origin.date ? " · originally " + new Date(m.origin.date).toLocaleDateString(undefined,
      { day: "numeric", month: "long", year: "numeric" }) : "") +
    // brought from an older key, and proven to be its (UN-RFC 0049 7.3) - only when it holds
    (m.origin.proven ? " · proven from the key " + m.origin.proven.slice(0, 20) + "…" : "");
}

// The sidebar's data from the local API -> groups by hierarchy, people, For you's counts
// and your feed and site.
function fromSidebar(d, st) {
  const groups = d.groups.map(fromGroup), by = {};
  groups.forEach(g => (by[g.hierarchy] = by[g.hierarchy] || []).push(g));
  const fy = d.for_you || {};
  return { for_you: (fy.replies || 0) + (fy.mentions || 0), replies: fy.replies || 0, mentions: fy.mentions || 0,
    timeline: d.timeline || { id: TIMELINE, feeds: 0 },
    my_feed: d.my_feed || null,          // your own feed at the top (gui#101; core 0.5)
    my_site: d.my_site || null,          // ... and your own site, the same way
    people: d.people.map(p => ({ ...p, label: p.name, colour: colour(p.key) })),
    // every contact, also those whose chat is closed (core 0.5; before: the chats' contacts)
    contacts: (d.contacts || d.people.filter(p => p.contact)).map(p => ({ ...p, contact: true,
      label: p.name, colour: colour(p.key) })),
    moderation: d.moderation, name_requests: d.name_requests, inbox: d.inbox,
    show_blocked: !!st.show_blocked, hide_bots: !!st.hide_bots, pictures: st.pictures !== false,
    link_cards: st.link_cards !== false,   // previews of links (UN-RFC 0059, core 0.6)
    state_local: !!st.state_local,
    report_issuer: !!st.report_issuer,   // you publish spam reports (UN-RFC 0045, core 0.6)
    markdown: st.markdown !== false, notices: st.notices || {},
    // other people's feeds and sites, by person (gui#210, core 0.6 #706): their groups here
    people_followed: (d.people_followed || []).map(p => ({ ...p, colour: p.key ? colour(p.key) : 0,
      items: Object.entries(p.groups).map(([kind, id]) => ({ kind, g: groups.find(g => g.id === id) }))
        .filter(x => x.g) })).filter(p => p.items.length),
    hierarchies: d.hierarchies.map(h => ({ name: h.name, tree: h.tree, groups: by[h.name] || [] })) };
}

// The core's state, with this client's own from /x/gui/state (UN-RFC 0046 section 6).
let GUI = {};
// Read the core's state and the GUI's own (bootable, browser build, the update): who you
// are and whether the vault is open.
async function loadState(st) {
  st = st || await api("GET", "/api/state");
  try { GUI = await api("GET", "/x/gui/state"); } catch (_) { /* the core's state is enough */ }
  const id = st.identity;
  const before = S.state && S.state.me && S.state.me.key;
  S.state = { ...st, ...GUI, me: id ? { display: id.display, key: id.key, label: id.label, fp: GUI.fp || "" } : null };
  // another key now (a copy, restored words): nothing of the last one's ripening or pace (gui#262)
  if (before && id && id.key !== before) { S.ripening = null; ripeSamples = []; }
  if (st.ripening) setRipening(st.ripening, false);   // with "paused" from a core that has it (unseenet#337)
  return S.state;
}

// ---- helpers ------------------------------------------------------------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "value") el.value = el._v0 = v;     // _v0: what render() compares with
    else if (k === "style") el.style.cssText = v;     // via CSSOM: style attributes are blocked by the CSP
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// The chat and comment fields (#122): Enter sends, Shift+Enter starts a new line, as in
// most chat apps; Ctrl/Cmd+Enter sends too. A suggestion that is up takes Enter first.
// The field grows with its text up to a few lines.
function sendOnEnter(e, send) {
  if (e.key !== "Enter" || e.isComposing) return;
  if (suggest && e.target.dataset && suggest.k === e.target.dataset.k) return;
  if (e.shiftKey && !e.ctrlKey && !e.metaKey) return;          // a new line
  e.preventDefault(); send(); growField(e.target);
}

// Let a text area grow with what is typed, up to a limit.
function growField(el) {
  if (!el || el.tagName !== "TEXTAREA") return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight + 2, 160) + "px";
}

// An SVG icon from a path in a 24x24 box, drawn with the current colour.
function svg(path, size = 16, width = 2) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("width", size); s.setAttribute("height", size); s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", width); s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path); s.append(p);
  return s;
}
const ICON = {
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5",
  groups: "M4 5h16v4H4zM4 10.5h16v4H4zM4 16h16v4H4z",    // the Groups tab on a phone (gui#248)
  cmd: "M5 7l5 5-5 5M12 17h7",
  plus: "M12 5v14M5 12h14",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",                 // report a post
  alert: "M12 3l9 16H3zM12 10v4M12 17v.01",           // a content warning (UN-RFC 0052)
  tag: "M3 12V4h8l9 9-8 8zM7.5 7.5v.01",              // a topic
  send: "M5 12h14M13 6l6 6-6 6",
  check: "M20 6L9 17l-5-5",
  checks: "M2 13l4 4L16 7M10 15l2 2L22 7",
  lock: "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z",
  back: "M15 18l-6-6 6-6",
  x: "M18 6L6 18M6 6l12 12",
  people: "M16 20v-2a4 4 0 0 0-8 0v2M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  smile: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 14s1.5 2 4 2 4-2 4-2M9 9.5h.01M15 9.5h.01",
  bubble: "M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 21l2-5.4A8.4 8.4 0 1 1 21 11.5z",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  clip: "M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5",
  grow: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
  shrink: "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7",
};

// A small icon button with a tooltip (#120): Comment, Answer, Reply with a post. The
// label is also its aria-label, so screen readers and the keyboard lose nothing.
function iconAction(icon, label, onclick, extra = {}, count = null) {
  return h("button", { type: "button", class: "iconlink" + (extra.cls ? " " + extra.cls : ""),
    "aria-label": count ? `${label} (${count})` : label, title: label, onclick },
    svg(icon, 16, 2), count ? h("span", { text: String(count) }) : null);
}

// Call the core's local API (UN-RFC 0046) with the page's token; answers the JSON, or
// throws with the API's error.
// ``opts``: ``signal`` to abort it, ``timeout`` (ms) for asking that may take long and that
// the page can do without (pictures, a group's emoji): a browser has six connections to the
// core, and requests left hanging while the node is busy would take them all (gui#227).
async function api(method, path, body, opts = {}) {
  let signal = opts.signal;
  if (opts.timeout) {
    const t = AbortSignal.timeout(opts.timeout);
    signal = signal ? AbortSignal.any([signal, t]) : t;
  }
  const res = await fetch(path, {
    method, headers: { "X-Unseenet-Token": TOKEN || "", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined, cache: "no-store", signal,
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* not JSON */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `${res.status} ${res.statusText}`);
    err.status = res.status; err.why = data && data.why;       // files (UN-RFC 0046 section 4.10)
    throw err;
  }
  return data;
}

// A short message at the bottom of the page for four seconds.
function toast(text) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const t = h("div", { class: "toast", role: "status", text });
  document.body.append(t);
  setTimeout(() => t.remove(), 4000);
}

const sameDay = (a, b) => a.toDateString() === b.toDateString();
// A time for a message: the time today, the day and time before (withDay false: always the
// time).
function when(iso, withDay = true) {
  if (!iso) return "";
  const d = new Date(iso), now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay(d, now) || !withDay) return time;
  const days = Math.round((now - d) / 86400000);
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" }) + " " + time;
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}
// How long ago, as feeds say it: now, 5 min, 2 h, Yesterday 14:20, 3 days, then the date
// (with the year when it is another year).
function ago(iso, now = new Date()) {
  if (!iso) return "";
  const d = new Date(iso), s = (now - d) / 1000;
  if (s < 45) return "now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (sameDay(d, now)) return `${Math.round(s / 3600)} h`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay(d, y)) return "Yesterday " + time;
  const days = Math.floor(s / 86400);
  if (days < 7) return `${Math.max(2, days)} days`;
  return d.toLocaleDateString([], d.getFullYear() === now.getFullYear()
    ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

// The exact date and time, for the tooltip and screen readers.
function exactTime(iso) {
  return iso ? new Date(iso).toLocaleString([], { weekday: "long", day: "numeric", month: "long",
    year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}

// A time as feeds show it: how long ago, the exact time on hover; kept fresh by tickAgo.
function timeEl(iso, cls = "hint") {
  if (!iso) return null;
  return h("time", { class: cls + " ago", datetime: iso, "data-ago": iso, title: exactTime(iso), text: ago(iso) });
}

// Every minute: how long ago, again, in place - nothing else is drawn.
function tickAgo() {
  const now = new Date();
  document.querySelectorAll("[data-ago]").forEach(el => {
    const t = ago(el.dataset.ago, now);
    if (el.textContent !== t) el.textContent = t;
  });
}
setInterval(tickAgo, 60000);

// The heading of a day in a chat: Today, Yesterday, or the weekday and date.
function dayLabel(d) {
  const now = new Date(), y = new Date(now - 86400000);
  if (sameDay(d, now)) return "Today";
  if (sameDay(d, y)) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}
// Up to two letters for an avatar from a name.
function initials(who) {
  const name = (who || "?").replace(/^You → /, "").replace(/^@/, "").replace(/ √$/, "").trim();
  const parts = name.split(/[\s.@_-]+/).filter(Boolean);
  return ((parts[0] || "?")[0] + (parts.length > 1 && name.includes(" ") ? parts[1][0] : "")).toUpperCase();
}
// A person's picture, else their identicon, else initials (UN-RFC 0022 section 8; the
// core's local API section 4.11). Always next to the name with its short fingerprint,
// never instead of it.
function avatar(m, small) {
  const cls = "av" + (small ? " s" : "");
  const p = m.key ? personOf(m.key) : null;
  if (p && p.picture) return h("img", { class: cls + " pic", src: p.picture.data, alt: "", title: p.picture.alt || "" });
  const icon = m.identicon || (p && p.identicon);
  if (icon) return identiconEl(icon, cls);
  return h("span", { class: `${cls} c${m.colour ?? 5}`, "aria-hidden": "true", text: initials(m.who) });
}
// A key's identicon (the core's 5x5 pattern) as SVG, when there is no picture.
function identiconEl(icon, cls) {
  const NS = "http://www.w3.org/2000/svg", el = document.createElementNS(NS, "svg");
  el.setAttribute("viewBox", "-1 -1 7 7"); el.setAttribute("class", cls + " idc"); el.setAttribute("aria-hidden", "true");
  icon.cells.forEach((row, y) => row.forEach((on, x) => {
    if (!on) return;
    const r = document.createElementNS(NS, "rect");
    r.setAttribute("x", x); r.setAttribute("y", y); r.setAttribute("width", 1.02); r.setAttribute("height", 1.02);
    r.setAttribute("fill", icon.colour); el.append(r);
  }));
  return el;
}
// Pictures of people come from the core in batches: asked for as they are drawn, read
// together by the core so a node cannot tell whose you look at.
const PEOPLE = new Map(), WANTED = new Set();
let wantTimer = null;
// What is known of a key (name, picture), asking the core for it with the next batch if it
// is not known yet.
function personOf(key) {
  const p = PEOPLE.get(key);
  if (p) return p;
  if (!WANTED.has(key)) {
    WANTED.add(key);
    clearTimeout(wantTimer);
    wantTimer = setTimeout(loadPeople, 60);
  }
  return null;
}
const PEOPLE_WAIT = 10000, PEOPLE_AGAIN = 30000;      // ms: asking pictures, and again (gui#227)
let peopleBusy = false;
// Ask the core for the names and pictures of the keys asked for since the last time, at
// most 255 at once, then draw again. One asking at a time, never longer than PEOPLE_WAIT
// (gui#227): what did not come in time is asked again later.
async function loadPeople() {
  if (peopleBusy) return;                              // asked again when it is done
  const keys = Array.from(WANTED).filter(k => !PEOPLE.has(k)).slice(0, 255);
  keys.forEach(k => WANTED.delete(k));
  if (!keys.length) return;
  // every key answered is known afterwards, with a picture or not: else each render asks again
  let got = {}, again = false;
  peopleBusy = true;
  try {
    got = (await api("GET", "/api/pictures?keys=" + keys.map(encodeURIComponent).join(","), null,
      { timeout: PEOPLE_WAIT })).pictures || {};
  } catch (err) {
    again = err.name === "TimeoutError" || err.name === "AbortError";   // the node was busy
    /* otherwise an older core, or none: identicons from the rows, initials otherwise */
  } finally { peopleBusy = false; }
  if (again) {
    keys.forEach(k => WANTED.add(k));
    clearTimeout(wantTimer); wantTimer = setTimeout(loadPeople, PEOPLE_AGAIN);
    return;
  }
  keys.forEach(k => PEOPLE.set(k, got[k] || { identicon: null, picture: null }));
  if (WANTED.size) { clearTimeout(wantTimer); wantTimer = setTimeout(loadPeople, 60); }
  if (Object.keys(got).length) render();
}
// "Mikkel~q7f3": the fingerprint part is shown quieter, like the TUI does.
function nameEl(label) {
  const i = label.lastIndexOf("~");
  if (i > 0 && /^~[a-z2-7?]{4}( √)?$/.test(label.slice(i))) {
    return h("span", { class: "name" }, label.slice(0, i), h("span", { class: "muted", text: label.slice(i) }));
  }
  return h("span", { class: "name", text: label });
}
// the author's name opens their profile (#20), as Profile of this author does in the TUI
function whoEl(m) {
  if (!m.key || m.mine) return nameEl(m.who);
  return h("button", { class: "name-btn", title: "Their profile", onclick: (e) => { e.stopPropagation(); openProfile(m.key, m.who, m.private ? "me" : S.gid); } }, nameEl(m.who));
}
const typing = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

// ---- back: the app's levels are the browser's history (#249) ---------------
// The edge swipe, a phone's back button, the browser's Back, Alt+Left and a mouse's back
// button all go up one level - dialog, full screen, a post (phone), the group (phone) -
// the same way Esc and the on-screen back buttons do, on every screen. The unlock page is
// never behind you: after it one "guard" entry; Back at the top shows a note, and only a
// second Back within a few seconds leaves.
const NAV = { depth: 0, guard: false, skip: 0, atBase: false, timer: null, queued: false };

// How deep you are now; -1 outside the app (starting, locked, setting up).
function navDepth() {
  if (!S.state || !S.state.unlocked || S.state.setup) return -1;
  const phone = typeof PHONE !== "undefined" && PHONE.matches;
  let d = 0;
  if (phone && S.gid && S.pane !== "groups") d++;
  if (phone && S.mobileReading) d++;
  if (S.full) d++;
  if (S.dialog) d++;
  return d;
}

// Text typed and not sent in ``scope``: a compose window, a chat line.
function unsentText(scope) {
  if (!scope) return false;
  return [...scope.querySelectorAll("textarea[data-k], input[data-k=chat]")]
    .some(el => el.value.trim() && el.value !== (el._v0 ?? ""));
}

// One level up, as Back means it.
function navUp() {
  if (S.dialog) {
    if (unsentText(S.dialog.node)) { toast("Not sent yet - Cancel closes it."); render(); return; }
    closeDialog(); return;
  }
  if (S.full) { S.full = false; render(); return; }
  const phone = typeof PHONE !== "undefined" && PHONE.matches;
  if (phone && S.mobileReading) { S.mobileReading = false; render(); return; }
  if (phone && S.gid && S.pane !== "groups") { S.pane = "groups"; render(); return; }
  render();
}

// After each render, once the moment has passed: as many history entries as levels. A
// dialog that closes as another opens (the palette, then what you chose) is one step, not
// a Back and a push racing each other (history.go is not at once).
function navSync() {
  if (NAV.queued) return;
  NAV.queued = true;
  setTimeout(() => { NAV.queued = false; navApply(); }, 0);
}

// The history brought in step with how deep you are now.
function navApply() {
  const want = navDepth();
  if (want < 0) return;
  if (!NAV.guard) {                     // just into the app: the unlock page is not behind us
    history.replaceState({ u: "base" }, "");
    history.pushState({ u: "guard" }, "");
    NAV.guard = true; NAV.depth = 0;
  }
  if (NAV.atBase) {                     // Back at the top, then going on in the app
    clearTimeout(NAV.timer); NAV.atBase = false;
    history.pushState({ u: "guard" }, "");
  }
  if (want > NAV.depth) {
    for (let d = NAV.depth + 1; d <= want; d++) history.pushState({ u: "level", d }, "");
    NAV.depth = want;
  } else if (want < NAV.depth) {        // gone up in the app: take the entries back
    NAV.skip++;
    history.go(want - NAV.depth);
    NAV.depth = want;
  }
}

window.addEventListener("popstate", (e) => {
  if (NAV.skip) { NAV.skip--; return; }
  if (!NAV.guard) return;
  const st = e.state || {};
  if (st.u === "base") {                // Back at the top: stay, and say how to leave
    toast("Back again to leave Unseenet.");
    NAV.atBase = true; NAV.depth = 0;
    clearTimeout(NAV.timer);
    NAV.timer = setTimeout(() => {
      if (NAV.atBase) { NAV.atBase = false; history.pushState({ u: "guard" }, ""); }
    }, 3000);
    return;
  }
  const now = st.u === "level" ? st.d : 0;
  if (now > NAV.depth) {                // Forward: there is nothing to go forward to
    NAV.skip++; history.go(NAV.depth - now); return;
  }
  NAV.depth = now;
  navUp();
});

// An unsent post or chat line is not lost by leaving the page by mistake.
window.addEventListener("beforeunload", (e) => {
  if (unsentText(document.getElementById("root"))) { e.preventDefault(); e.returnValue = ""; }
});

// ---- rendering with focus and scroll kept --------------------------------
// Draw the page for the state it is in, and keep the history in step with it.
function render() {
  renderNow();
  navSync();
}

// The page drawn again, keeping focus, selection, scroll and what you typed.
function renderNow() {
  const root = document.getElementById("root");
  const active = document.activeElement;
  const key = active && active.dataset ? active.dataset.k : null;
  const sel = typing(active) && active.selectionStart != null ? [active.selectionStart, active.selectionEnd] : null;
  const scrolls = {};
  root.querySelectorAll("[data-scroll]").forEach(el => {
    scrolls[el.dataset.scroll] = { top: el.scrollTop, bottom: el.scrollHeight - el.scrollTop - el.clientHeight < 40 };
  });
  // the selected row stays where it was on screen when posts come in above it
  const row = root.querySelector(".ptable .prow.on");
  const anchor = row ? { id: row.dataset.id, off: row.offsetTop - row.parentElement.scrollTop } : null;
  // and so does the field you are typing in (gui#258): a comment under an entry in a feed
  // must not jump away while posts arrive or a phone's keyboard has just moved it into sight
  const fieldBox = key && typing(active) ? active.closest("[data-scroll]") : null;
  const field = fieldBox ? { box: fieldBox.dataset.scroll,
    off: active.getBoundingClientRect().top - fieldBox.getBoundingClientRect().top } : null;
  // what you typed survives a redraw (#53): a field you changed gets it back, if the
  // same field (data-k) comes back with the same starting value - not a new window's
  const typed = [];
  root.querySelectorAll("input[data-k], textarea[data-k]").forEach(el => {
    if (["checkbox", "radio", "file"].includes(el.type)) return;
    const start = el._v0 ?? "";
    if (el.value !== start) typed.push([el.dataset.k, start, el.value]);
  });
  const dialogNode = S.dialog && S.dialog.node;
  const keepDialog = dialogNode && dialogNode.parentNode === root;
  // Keep a compose window attached: replacing its fields loses drafts and undo,
  // and even moving the same fields out and back interrupts text composition (#47).
  if (keepDialog) root.firstChild.replaceWith(view());
  else {
    root.replaceChildren(view());
    if (S.dialog) root.append(dialogNode || S.dialog.render());
  }
  for (const [k, start, value] of typed) {
    const el = root.querySelector(`[data-k="${CSS.escape(k)}"]`);
    if (el && (el._v0 ?? "") === start && el.value === start) el.value = value;
  }
  root.querySelectorAll("[data-scroll]").forEach(el => {
    const was = scrolls[el.dataset.scroll];
    if (el.dataset.stick === "bottom" && (!was || was.bottom)) el.scrollTop = el.scrollHeight;
    else if (was) el.scrollTop = was.top;
  });
  const now = root.querySelector(".ptable .prow.on");
  if (anchor && now && now.dataset.id === anchor.id) now.parentElement.scrollTop = now.offsetTop - anchor.off;
  // a phone's round + sits above the chat line where there is one (gui#260)
  const bar = root.querySelector(".main .chatbar:not(.notebar)");
  root.style.setProperty("--chatbar", (bar ? bar.offsetHeight : 0) + "px");
  if (field) {
    const box = root.querySelector(`[data-scroll="${CSS.escape(field.box)}"]`);
    const f = box && box.querySelector(`[data-k="${CSS.escape(key)}"]`);
    if (f) box.scrollTop += f.getBoundingClientRect().top - box.getBoundingClientRect().top - field.off;
  }
  if (keepDialog && dialogNode.contains(active)) return;
  if (active && active.closest && active.closest(".emoji-picker")) return;      // searching for an emoji (#21)
  // A dialog takes the focus from the page behind it; inside a dialog, keep the field you were in.
  const inDialog = active && active.closest && active.closest(".dialog");
  const again = key && (!S.dialog || inDialog) && root.querySelector(`[data-k="${CSS.escape(key)}"]`);
  if (again) {
    again.focus({ preventScroll: true });
    if (sel && again.setSelectionRange) try { again.setSelectionRange(sel[0], sel[1]); } catch (_) { }
  } else if (S.dialog && S.dialog.focus) {
    const f = root.querySelector(S.dialog.focus);
    if (f) f.focus();
  }
}

// The whole page for the state it is in: no token, starting, locked, setting up, or the
// app.
function view() {
  if (!TOKEN) return noToken();
  if (!S.state) return h("div", { class: "unlock" }, h("p", { class: "muted", text: "Starting …" }));
  if (!S.state.unlocked) return unlockScreen();
  if (S.state.setup) return setupScreen();
  return appScreen();
}

// The page opened without its one-time address: say how to open it.
function noToken() {
  return h("div", { class: "unlock" }, h("div", { class: "unlock-box" },
    brandHead("Open Unseenet from its own window."),
    h("p", { class: "muted", text: "This page needs the one-time address that unseenet-gui prints when it starts. " +
      "Start it again, or open the address it printed." })));
}

// The logo has light strokes for dark grounds; the ink version is for light ones.
function logo(size) {
  return [h("img", { class: "logo on-dark", src: "/static/icon.svg", alt: "", width: size, height: size }),
          h("img", { class: "logo on-light", src: "/static/icon-ink.svg", alt: "", width: size, height: size })];
}

// The logo and a heading written like a message's Subject line, for the unlock and setup
// screens.
function brandHead(subject, headers) {
  return h("div", { class: "unlock-head" },
    logo(56),
    headers ? h("div", { class: "headers" }, headers) : null,
    h("h1", { class: "subject" }, h("small", { text: "Subject:" }), subject));
}
