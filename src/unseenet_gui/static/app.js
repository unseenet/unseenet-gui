/* Unseenet graphical client.
 *
 * Talks only to the local server it was opened from. Everything a person
 * wrote is put on the page with textContent, never as HTML, and links in
 * posts are not made clickable: following one would leave Tor.
 */
"use strict";

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
  if (m) history.replaceState(null, "", location.pathname);
  return t;
})();

// ---- theme: the system's choice, or the one picked in the palette -------------
// Kept with your settings in the core (#84, UN-RFC 0046 section 4.8), so it follows you
// from device to device; the browser's copy only paints the first frame before the core
// answers (the GUI's port, and so its storage, can change every start).
const THEMES = ["light", "dark"];
let THEME = null;
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
    rules_markdown: isMd(g.rules_type), private_reply: g.type === "inbox",
    colour: g.key ? colour(g.key) : undefined,
    members: (roles.members || []).map(person), moderators: (roles.moderators || []).map(person),
    posters: (roles.posters || []).map(person), banned: (roles.banned || []).map(person),
    moderates: !!roles.moderates, maintainer: !!roles.maintainer };
}

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
    depth: r.depth, attachments: m.attachments || [], identicon: r.identicon || null,
    pinned: !!r.pinned, address: r.address || "",
    // reactions (UN-RFC 0048): the counts, may you react, and its own group's set
    reactions: r.reactions || [], react: r.react || null, react_offered: r.react_offered || null,
    comment: r.comment || null, replyPerm: r.reply || null, group_label: r.group_label || "" };
}

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
    state_local: !!st.state_local,
    markdown: st.markdown !== false, notices: st.notices || {},
    hierarchies: d.hierarchies.map(h => ({ name: h.name, tree: h.tree, groups: by[h.name] || [] })) };
}

// The core's state, with this client's own from /x/gui/state (UN-RFC 0046 section 6).
let GUI = {};
async function loadState(st) {
  st = st || await api("GET", "/api/state");
  try { GUI = await api("GET", "/x/gui/state"); } catch (_) { /* the core's state is enough */ }
  const id = st.identity;
  S.state = { ...st, ...GUI, me: id ? { display: id.display, key: id.key, label: id.label, fp: GUI.fp || "" } : null };
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
  plus: "M12 5v14M5 12h14",
  send: "M5 12h14M13 6l6 6-6 6",
  check: "M20 6L9 17l-5-5",
  checks: "M2 13l4 4L16 7M10 15l2 2L22 7",
  lock: "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z",
  back: "M15 18l-6-6 6-6",
  x: "M18 6L6 18M6 6l12 12",
  people: "M16 20v-2a4 4 0 0 0-8 0v2M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  smile: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 14s1.5 2 4 2 4-2 4-2M9 9.5h.01M15 9.5h.01",
};

async function api(method, path, body) {
  const res = await fetch(path, {
    method, headers: { "X-Unseenet-Token": TOKEN || "", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined, cache: "no-store",
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

function toast(text) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const t = h("div", { class: "toast", role: "status", text });
  document.body.append(t);
  setTimeout(() => t.remove(), 4000);
}

const sameDay = (a, b) => a.toDateString() === b.toDateString();
function when(iso, withDay = true) {
  if (!iso) return "";
  const d = new Date(iso), now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay(d, now) || !withDay) return time;
  const days = Math.round((now - d) / 86400000);
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" }) + " " + time;
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}
function dayLabel(d) {
  const now = new Date(), y = new Date(now - 86400000);
  if (sameDay(d, now)) return "Today";
  if (sameDay(d, y)) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}
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
async function loadPeople() {
  const keys = Array.from(WANTED).filter(k => !PEOPLE.has(k)).slice(0, 255);
  WANTED.clear();
  if (!keys.length) return;
  // every key asked for is known afterwards, answered or not: else each render asks again
  let got = {};
  try { got = (await api("GET", "/api/pictures?keys=" + keys.map(encodeURIComponent).join(","))).pictures || {}; }
  catch (_) { /* an older core, or none: identicons from the rows, initials otherwise */ }
  keys.forEach(k => PEOPLE.set(k, got[k] || { identicon: null, picture: null }));
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

// ---- rendering with focus and scroll kept --------------------------------
function render() {
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

function view() {
  if (!TOKEN) return noToken();
  if (!S.state) return h("div", { class: "unlock" }, h("p", { class: "muted", text: "Starting …" }));
  if (!S.state.unlocked) return unlockScreen();
  if (S.state.setup) return setupScreen();
  return appScreen();
}

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

function brandHead(subject, headers) {
  return h("div", { class: "unlock-head" },
    logo(56),
    headers ? h("div", { class: "headers" }, headers) : null,
    h("h1", { class: "subject" }, h("small", { text: "Subject:" }), subject));
}

// ---- unlock and setup -----------------------------------------------------
function unlockScreen() {
  const st = S.state, isNew = !st.vault_exists;
  const submit = async (e) => {
    e.preventDefault();
    const f = e.target, pass = f.pass.value;
    if (isNew && pass !== f.again.value) { S.error = "The two passphrases are not the same."; render(); return; }
    if (isNew && pass.length < 8) { S.error = "Use at least 8 characters - a few words is best."; render(); return; }
    S.busy = true; S.error = ""; render();
    try { await loadState(await api("POST", "/api/unlock", { passphrase: pass })); await afterUnlock(); }
    catch (err) { S.error = /wrong|decrypt|passphrase|invalid/i.test(err.message) ? "Wrong passphrase." : err.message; }
    S.busy = false; render();
  };
  return h("div", { class: "unlock" }, h("div", { class: "unlock-box" },
    st.bootable ? systemBar() : null,
    brandHead(isNew ? "A new vault." : "Welcome back.",
      ["Vault: ", h("b", { text: st.vault })]),
    h("form", { class: "form", onsubmit: submit },
      h("label", { for: "pass", text: isNew ? "Choose a passphrase" : "Passphrase" }),
      h("input", { id: "pass", name: "pass", type: "password", class: "field", autocomplete: "current-password",
        autofocus: true, "data-k": "pass", required: true }),
      isNew ? [h("label", { for: "again", text: "The same again" }),
        h("input", { id: "again", name: "again", type: "password", class: "field", "data-k": "again", required: true })] : null,
      h("div", { class: "error", role: "alert", text: S.error }),
      h("button", { class: "btn primary", type: "submit", disabled: S.busy },
        S.busy ? "Unlocking …" : isNew ? "Create vault" : "Unlock")),
    isNew ? h("p", { class: "hint", text: "Your keys, groups and saved posts are kept in this one file, " +
      "encrypted with the passphrase. Lose both, and they are gone - nobody can reset it." }) : null,
    S.state.web ? h("div", { class: "statuscard" },
      h("div", { text: "Your keys stay in this browser: it signs, encrypts and checks signatures here." }),
      h("div", { class: "muted", text: "A web entrance carries the connection to a node over Tor. The entrance sees your IP address " +
        "(unless this is Tor Browser); the nodes do not. The vault is only kept here if you choose so in the bar at the top." }))
    : h("div", { class: "statuscard" },
      h("div", { text: "Tor starts when the vault is open." }),
      h("div", { class: "muted", text: "Nothing leaves this computer except through Tor. The window loads nothing from the internet." })),
    h("p", { class: "note" }, h("strong", { text: "Pre-alpha. " }),
      "The code has not had a security review. Do not rely on it to protect anyone yet. ",
      h("button", { class: "link", type: "button", onclick: openAbout }, "What is Unseenet?"))));
}

// ---- the bootable image: network, keyboard, power ------------------------------
let SYS = null;
async function loadSystem() {
  try { SYS = await api("GET", "/x/gui/system"); } catch (_) { SYS = null; }
  render();
}

function systemBar() {
  if (SYS === null) { SYS = false; loadSystem(); }
  const s = SYS || {};
  const online = (s.addresses || []).length > 0;
  return h("div", { class: "sysbar" },
    h("button", { class: "btn", onclick: openNetwork },
      h("span", { class: "dot" + (online ? " ok" : "") }),
      online ? s.addresses.map(a => a.interface).join(", ") + " connected" : "No network - set it up"),
    h("label", { class: "sr", for: "kbd", text: "Keyboard" }),
    h("select", { id: "kbd", class: "btn", onchange: async (e) => {
        const r = await api("POST", "/x/gui/system/keyboard", { layout: e.target.value });
        toast(r.restart ? "Changing the keyboard …" : "The keyboard changes at the next start.");
      } }, (s.keyboards || []).map(k => h("option", { value: k.id, selected: k.id === s.keyboard ? "" : null, text: "⌨ " + k.name }))),
    h("button", { class: "btn", onclick: () => power("reboot") }, "Restart"),
    h("button", { class: "btn", onclick: () => power("poweroff") }, "Shut down"));
}

async function power(action) {
  if (!confirm(action === "poweroff" ? "Shut down the computer?" : "Restart the computer?")) return;
  try { await api("POST", "/x/gui/system/power", { action }); } catch (_) { }
  document.getElementById("root").replaceChildren(h("div", { class: "unlock" },
    h("p", { class: "muted", text: action === "poweroff" ? "Shutting down …" : "Restarting …" })));
}

// A newer signed release (unseenet#264): the updater replaces this stick's or
// folder's program files over Tor and keeps data/; then Unseenet is started again.
function openUpdate() {
  const u = S.state.update;
  if (!u) return;
  let msg = "", busy = false, done = false;
  const go = async () => {
    busy = true; msg = "Fetching and checking the release over Tor - this takes a few minutes …"; render();
    try {
      const r = await api("POST", "/x/gui/update");
      done = r.ok;
      msg = r.ok ? "Done. Close Unseenet and start it again to use the new version. Your data is as it was."
        : "The update did not finish:\n" + (r.output || "");
    } catch (e) { msg = e.message; }
    busy = false; render();
  };
  updateProgress = (text) => { if (busy) { msg = text; render(); } };
  S.dialog = { focus: ".dialog .btn.primary", render: () => dialogShell({ label: "Update Unseenet" },
    h("div", { class: "dh" }, h("h2", { text: `Unseenet ${u.version}` }),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db" },
      h("p", { style: "margin:0" }, u.here
        ? `A newer ${u.channel === "dev" ? "development build" : "release"} is ready, signed by the Unseenet project. ` +
          "Updating replaces the program on this stick or folder and keeps your data/. Every file is checked against the signature."
        : "A newer release is ready. This Unseenet was not installed from a stick or a portable folder: update it the way you installed it (see unseenet.org)."),
      msg ? h("p", { class: "hint", style: "margin:0;white-space:pre-wrap", role: "status", text: msg }) : null),
    h("div", { class: "df" },
      u.here && !done ? h("button", { class: "btn primary", onclick: go, disabled: busy }, busy ? "Updating …" : "Update now") : null,
      h("button", { class: "btn", onclick: closeDialog }, done ? "Close" : "Later"))) };
  render();
}
let updateProgress = () => {};

function openNetwork() {
  const nets = {}, busy = {};
  let msg = "", pick = null;
  loadSystem();
  const scan = async (dev) => {
    busy[dev] = true; render();
    try { nets[dev] = await api("POST", "/x/gui/system/wifi", { action: "scan", device: dev }); }
    catch (e) { msg = e.message; }
    busy[dev] = false; render();
  };
  const connect = async (dev, name, pass) => {
    msg = "Connecting to " + name + " …"; render();
    try {
      const r = await api("POST", "/x/gui/system/wifi", { action: "connect", device: dev, name, passphrase: pass });
      msg = r.ok ? "Connected to " + name + "." : r.message; pick = null;
      await loadSystem(); scan(dev);
    } catch (e) { msg = e.message; render(); }
  };
  S.dialog = { render: () => {
    const s = SYS || {};
    return dialogShell({ label: "Network", wide: true },
      h("div", { class: "dh" }, h("h2", { text: "Network" }), h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
      h("div", { class: "db" },
        h("p", { style: "margin:0" }, (s.addresses || []).length ? ["Connected: ",
          s.addresses.map(a => h("span", { class: "mono", text: `${a.interface} ${a.address}  ` }))] :
          "Not connected. A network cable works by itself; for Wi-Fi, pick a network below."),
        h("p", { class: "hint", style: "margin:0", text: "Only Tor uses the network. The computer gets a new random hardware address for each Wi-Fi network." }),
        (s.wifi || []).map(dev => [
          h("div", { class: "row-between" }, h("h3", { style: "margin:6px 0 0;font-size:14px", text: "Wi-Fi (" + dev + ")" }),
            h("button", { class: "btn", onclick: () => scan(dev), disabled: busy[dev] }, busy[dev] ? "Looking …" : "Look for networks")),
          (nets[dev] || []).map(n => h("div", { class: "cmd" + (pick === n.name ? " on" : "") },
            h("span", { class: "nm", text: (n.connected ? "● " : "") + n.name }),
            h("small", { text: `${n.security} · ${n.signal}` }),
            n.connected ? h("small", { text: "connected" }) : pick === n.name && n.security !== "open" ?
              h("form", { class: "inline", onsubmit: (e) => { e.preventDefault(); connect(dev, n.name, e.target.pw.value); } },
                h("label", { class: "sr", for: "pw", text: "Passphrase" }),
                h("input", { id: "pw", name: "pw", type: "password", class: "in", placeholder: "Passphrase", "data-k": "pw", autofocus: true }),
                h("button", { class: "btn primary", type: "submit" }, "Connect")) :
              h("button", { class: "btn", onclick: () => { if (n.security === "open") connect(dev, n.name, ""); else { pick = n.name; render(); } } }, "Connect")))]),
        !(s.wifi || []).length ? h("p", { class: "muted", style: "margin:0", text: "No Wi-Fi on this computer (or its firmware is not on the stick)." }) : null,
        msg ? h("p", { class: "hint", style: "margin:0", role: "status", text: msg }) : null));
  } };
  render();
}

function setupScreen() {
  const st = S.state, needName = !st.me, needNode = !st.node;
  if (needNode && S.knownNodes === null) {
    S.knownNodes = []; S.nodesState = "loading";
    api("GET", "/api/known-nodes").then(r => { const n = r.nodes; S.knownNodes = n; S.nodesState = "";
      // a known node at random, so new users do not all start on the first (UN-RFC 0043 5.1)
      if (!S.setupNode && n.length) S.setupNode = n[Math.floor(Math.random() * n.length)].address;
      render(); })
      // say so: without the list a new user only sees an address field they cannot fill in
      .catch(err => { S.nodesState = err.message || "unknown error"; render(); });
  }
  const nodesNote = S.nodesState === "loading" ? h("p", { class: "hint", text: "Getting the list of nodes …" }) :
    S.nodesState ? h("div", { class: "hint", role: "alert" },
      "The list of nodes could not be loaded (" + S.nodesState + "). ",
      h("button", { type: "button", class: "link", onclick: () => { S.knownNodes = null; S.nodesState = ""; render(); } }, "Try again"),
      " - or type a node's address below.") : null;
  const submit = async (e) => {
    e.preventDefault();
    const f = e.target;
    S.busy = true; S.error = ""; render();
    try {
      await loadState(await api("POST", "/api/setup", {
        display: needName ? f.display.value : "", node: needNode ? (f.custom.value.trim() || S.setupNode || "") : "" }));
      await afterUnlock();
    } catch (err) { S.error = err.message; }
    S.busy = false; render();
  };
  return h("div", { class: "unlock" }, h("div", { class: "unlock-box" },
    brandHead("First start."),
    h("form", { class: "form", onsubmit: submit },
      needName ? [h("label", { for: "display", text: "Your name" }),
        h("input", { id: "display", name: "display", class: "field", "data-k": "display", required: true,
          placeholder: "What others see next to your posts" }),
        h("p", { class: "hint", text: "Anyone can choose any name, so others also see the start of your key. " +
          "You can claim a name like @you later." })] : null,
      needNode ? [h("label", { text: "Your node" }),
        h("div", { class: "choices" }, (S.knownNodes || []).map(n => h("button", {
          type: "button", class: "choice", "aria-pressed": String(S.setupNode === n.address),
          onclick: () => { S.setupNode = n.address; render(); } },
          h("span", {}, h("span", { class: "mono", text: n.name || n.address }),
            h("small", { text: n.description || n.operator || n.address }))))),
        nodesNote,
        h("input", { name: "custom", class: "field mono", "data-k": "custom", placeholder: "or an address: xyz.onion or host:port",
          style: "font-size:14px" })] : null,
      h("div", { class: "error", role: "alert", text: S.error }),
      h("button", { class: "btn primary", type: "submit", disabled: S.busy }, S.busy ? "Starting …" : "Start"))));
}

async function afterUnlock() {
  if (S.state.setup) return;
  connectEvents();
  await Promise.all([loadSidebar(), loadTheme()]);
}

// ---- app --------------------------------------------------------------
function allGroups() {
  return (S.sidebar ? S.sidebar.hierarchies : []).flatMap(h => h.groups);
}

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

async function openGroup(gid, rerender = true) {
  if (S.gid !== gid) { S.post = null; S.postAt = null; S.full = false; S.mobileReading = false; S.moreTools = false; }
  if (rerender) S.pane = "group";      // the first group opened by itself leaves a phone on the list
  S.gid = gid;
  revealGroup(gid);
  await loadGroup();
  if (rerender) render();
  const g = S.data && S.data.group;
  // a phone would pop up its keyboard over the chat: there you tap the input yourself
  if (g && g.view === "chat" && !PHONE.matches) setTimeout(() => { const i = document.querySelector('[data-k="chat"]'); if (i) i.focus(); });
}

async function loadGroup() {
  if (!S.gid) return;
  const gid = S.gid;
  try {
    const data = await api("GET", "/api/groups/" + encodeURIComponent(gid));
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
function mayWrite(d, what) {                      // what: "post" or "chat"
  const p = d && d.write && d.write[what];
  if (p) return p;
  const ok = !!(d && d.group && d.group.may_post);
  return { allowed: ok, reason: ok ? "" : NOT_HERE, code: ok ? "ok" : "other" };
}
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
function tryReply(m, g) {
  const p = mayReply(S.data, m);
  if (p.allowed) openReply(m, g);
  else if (p.reason) toast(p.reason);
}

let markTimer = null, toMark = new Set();
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

function sidebar() {
  const sb = S.sidebar, me = S.state.me || {};
  const item = (gid, ic, label, extra, cls = "", title = null) => h("button", {
    class: `item ${cls}${S.gid === gid ? " on" : ""}`, onclick: () => openGroup(gid),
    "aria-current": S.gid === gid ? "page" : null, title },
    h("span", { class: "ic", text: ic }),
    typeof label === "string" ? h("span", { class: "nm", text: label }) : h("span", { class: "nm" }, label), extra);
  // the groups scroll; you stay at the bottom, however many groups there are
  return h("nav", { class: "side", "aria-label": "Groups" },
    h("div", { class: "side-scroll", "data-scroll": "side" },
    h("div", { class: "brand" }, logo(30), "Unseenet"),
    h("button", { class: "search", onclick: () => openPalette() }, svg(ICON.search),
      h("span", { text: "Search and commands" }), h("kbd", { text: "Ctrl P" })),
    sb ? h("div", { class: "nav" },
      item(FOR_YOU, "◄", "For you", forYouMarks(sb)),
      sb.timeline.feeds ? item(TIMELINE, "☰", "Timeline", null, "", "Every feed you follow, newest first") : null,
      // your own feed and site at the top, or the way to start them, as in the terminal client (gui#101)
      ...[[sb.my_feed, "☰", "feed", openMyFeed, "Your own feed - public, anyone can comment"],
          [sb.my_site, "▤", "site", openMySite, "Your own site of pages - public"]].map(([m, ic, kind, start, title]) =>
        !m ? null : m.started
        ? item(m.id, ic, "My " + kind, m.unread ? h("span", { class: "count", text: m.unread }) : null, "", title)
        : h("button", { class: "item start", onclick: start, title },
            h("span", { class: "ic", text: ic }), h("span", { class: "nm", text: "Start my " + kind }))),
      sb.inbox.id ? item(sb.inbox.id, "@", "Private posts",
        sb.inbox.unread ? h("span", { class: "count", text: sb.inbox.unread }) : null) : null,
      // posts waiting for you to approve, in groups you moderate (the TUI's Moderation queue)
      sb.moderation ? h("button", { class: "item", onclick: openModeration },
        h("span", { class: "ic", text: "✓" }), h("span", { class: "nm", text: "To approve" }),
        h("span", { class: "count", text: sb.moderation })) : null,
      sb.name_requests ? h("button", { class: "item", onclick: openNames },
        h("span", { class: "ic", text: "@" }), h("span", { class: "nm", text: "Name requests" }),
        h("span", { class: "count", text: sb.name_requests })) : null) : null,
    sb ? h("div", { class: "nav" },
      h("h3", { class: "row-h" },
        h("button", { class: "fold-chats", "aria-expanded": String(foldState().chats !== false),
          title: foldState().chats !== false ? "Fold the chats away" : "Show the chats",
          onclick: () => { setFold("chats", foldState().chats === false); render(); } },
          (foldState().chats !== false ? "▾ " : "▸ ") + "chats",
          foldState().chats === false && sb.people.some(p => p.unread) ?
            h("span", { class: "count", text: sb.people.reduce((n, p) => n + (p.unread || 0), 0) }) : null),
        h("button", { class: "mini", "aria-label": "Contacts", title: "Your contacts (C)", onclick: openContacts }, svg(ICON.people, 14, 2.5)),
        h("button", { class: "mini", "aria-label": "Chat with someone", title: "Chat with someone", onclick: () => openWrite("", "chat") }, svg(ICON.plus, 14, 2.5))),
      foldState().chats === false ? null :
      sb.people.length ? sb.people.map(p => h("div", { class: "personrow" }, h("button", {
        class: `item person${S.gid === p.id ? " on" : ""}${p.unread ? " unread" : ""}${p.contact ? "" : " stranger"}`, onclick: () => openGroup(p.id),
        title: p.contact ? null : "Not a contact - open the chat to add them" },
        h("span", { class: `av xs c${p.colour}`, "aria-hidden": "true", text: initials(p.label) }),
        h("span", { class: "nm", text: p.label }),
        p.unread ? h("span", { class: "count", text: p.unread }) : null),
        chatMenu(p))) :
        h("p", { class: "hint", style: "margin:0 10px", text: "Your chats, one per person. Add people as contacts, or start a chat with +." })) : null,
    sb ? sb.hierarchies.map(hier => hierarchyNav(hier, item)) :
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
        h("div", { class: "hint" }, h("span", { class: "dot" + (S.state.connected ? " ok" : "") }), " ",
          S.state.connected ? (S.state.web ? "Entrance and Tor · " : "Tor · ") + shortNode(S.state.node) : "Not connected"),
        ripeLine()),
      h("button", { class: "btn icon", "aria-label": "Show my key", title: "Show my key (K)", onclick: openKey, text: "K" })));
}

// ---- the group tree (unseenet.client.grouptree, as in the TUI) ------------------------
// Under alt.* names lose "alt."; a part two groups share is a folder that folds
// (.history with .egypt and .denmark). Folding is kept per browser; a hierarchy starts
// open, a folder closed unless the open group is in it.
const FOLDS_KEY = "unseenet-folds";
let folds = null;
function foldState() {
  if (folds) return folds;
  try { folds = JSON.parse(localStorage.getItem(FOLDS_KEY) || "{}") || {}; } catch (_) { folds = {}; }
  return folds;
}
function setFold(path, open) {
  foldState()[path] = open;
  try { localStorage.setItem(FOLDS_KEY, JSON.stringify(folds)); } catch (_) { /* not kept */ }
}
function treeHas(node, gid) {
  return node.groups.includes(gid) || node.children.some(c => treeHas(c, gid));
}
function treeGroups(node) {
  return node.groups.concat(...node.children.map(treeGroups));
}
function isOpen(node, root) {
  const f = foldState();
  return node.path in f ? f[node.path] : (root || treeHas(node, S.gid));
}
// a group opened from search or a link shows in its folder even if that was folded
function revealGroup(gid) {
  for (const hier of (S.sidebar ? S.sidebar.hierarchies : [])) {
    const walk = node => {
      if (!treeHas(node, gid)) return;
      if (node.children.length && foldState()[node.path] === false) setFold(node.path, true);
      node.children.forEach(walk);
    };
    if (hier.tree) walk(hier.tree);
  }
}

function dotted(name) {           // ".history.egypt" with a quiet leading dot
  return name.startsWith(".") ? [h("span", { class: "dot-pre", text: "." }), name.slice(1)] : name;
}

function hierarchyNav(hier, item) {
  const byId = Object.fromEntries(hier.groups.map(g => [g.id, g]));
  const unreadIn = node => treeGroups(node).reduce((n, id) => n + ((byId[id] || {}).unread || 0), 0);
  const leaf = (id, shown) => {
    const g = byId[id];
    if (!g) return null;
    const at = g.label.indexOf("@");
    return item(g.id, (g.access || "") + g.icon, dotted(shown + (at >= 0 ? g.label.slice(at) : "")), [
      forYouMarks(g),
      g.unread ? h("span", { class: "count", text: g.unread }) : null], "group" + (g.unread ? " unread" : ""), g.label);
  };
  const contents = node => [
    node.groups.map(id => leaf(id, node.own)),                   // alt.history inside .history
    node.children.map(c => c.children.length ? folder(c) : c.groups.map(id => leaf(id, "." + c.label)))];
  const folder = node => {
    const open = isOpen(node, false), unread = unreadIn(node);
    return h("div", { class: "fold" },
      h("button", { class: "item group folder" + (unread ? " unread" : ""), "aria-expanded": open ? "true" : "false",
        title: node.path + ".*", onclick: () => { setFold(node.path, !open); render(); } },
        h("span", { class: "ic", text: open ? "▾" : "▸" }), h("span", { class: "nm" }, dotted("." + node.label)),
        !open && unread ? h("span", { class: "count", text: unread }) : null),
      open ? h("div", { class: "sub" }, contents(node)) : null);
  };
  if (!hier.tree) return h("div", { class: "nav" }, h("h3", { text: hier.name + ".*" }),
    hier.groups.map(g => leaf(g.id, g.label)));
  const root = hier.tree, open = isOpen(root, true), unread = unreadIn(root);
  return h("div", { class: "nav" },
    h("h3", { class: "row-h fold-h" },
      h("button", { class: "fold-t", "aria-expanded": open ? "true" : "false",
        title: open ? "Fold " + hier.name + ".*" : "Unfold " + hier.name + ".*",
        onclick: () => { setFold(root.path, !open); render(); } },
        h("span", { class: "car", text: open ? "▾" : "▸" }), hier.name + ".*"),
      !open && unread ? h("span", { class: "count", text: unread }) : null),
    open ? contents(root) : null);
}

function shortNode(address) {
  if (!address) return "";
  return address.endsWith(".onion") ? address.slice(0, 6) + "….onion" : address;
}

// The shortcuts that work where you are, the same as the terminal client's footer
// (unseenet#490): one set a view, and each a button too, for a mouse or a touch screen.
function keyHints() {
  const d = S.data, g = d && d.group;
  if (!g) return [["Ctrl P", "commands", openPalette]];
  const cur = d.messages.find(x => x.id === S.post) || null;
  const out = [];
  const may = (kind) => g.type && mayWrite(d, kind).allowed;
  if (reading()) {
    out.push(["Esc", "back", () => { S.full = false; render(); }], ["N P", "next/previous", () => step(1)]);
    if (cur) out.push(["R", "reply", () => tryReply(cur, g)]);
    out.push(["Space", "page down", null]);
    return out;
  }
  if (g.view === "chat") out.push(["Enter", "write", () => { const el = document.querySelector('[data-k="chat"]'); if (el) el.focus(); }], ["Esc", "shortcuts", null]);
  else if (g.view === "feed") {
    if (may("post")) out.push(["N", "new post", openCompose]);
    out.push(["↑↓", "entries", () => feedStep(1)], ["Space", "next unread", feedNextUnread]);
    if (feedCurrent()) out.push(["R", "comment", feedComment]);
  } else if (g.view === "pages") {
    const site = d.site || {};
    out.push(["↑↓", "pages", () => pageStep(1)], ["← →", "back/forward", () => siteStep(-1)]);
    if (site.may_write && site.page) out.push(["E", "edit", () => openPageEditor(g, site, site.page)]);
    if (site.may_write) out.push(["N", "new page", () => openPageEditor(g, site, null)]);
  } else {
    if (may("post")) out.push(["N", "new post", openCompose]);
    if (cur && !cur.notice) out.push(["R", "reply", () => tryReply(cur, g)]);
    out.push(["↑↓", "posts", () => step(1)], ["Space", "next unread", nextUnread]);
    if (cur) out.push(["Enter", "read", () => { S.full = true; render(); }]);
  }
  if (g.type && g.type !== "inbox") out.push(["V", "show as " + nextView(g), toggleView]);
  if (g.type) out.push(["?", "about group", openInfo]);
  out.push(["Ctrl P", "commands", openPalette]);
  return out;
}

function statusbar() {
  const k = ([key, label, run]) => run ? h("button", { class: "khint", type: "button", tabindex: "-1", onclick: run }, h("kbd", { text: key }), " " + label)
    : h("span", { class: "khint" }, h("kbd", { text: key }), " " + label);
  return h("footer", { class: "statusbar" },
    // the same as the keys and the buttons on the screen: hidden from screen readers, which
    // have those, and out of the Tab order
    h("span", { class: "keys", "aria-hidden": "true" }, keyHints().map(k)),
    h("span", { class: "grow" }),
    S.state.update ? h("button", { class: "link update", onclick: openUpdate }, `Unseenet ${S.state.update.version} is ready`) : null,
    S.state.bootable ? h("button", { class: "link", onclick: openNetwork }, "Network") : null,
    h("span", { class: "st", title: S.state.status },
      h("span", { class: "dot" + (S.state.connected ? " ok" : "") }), S.state.status || "", " · pre-alpha"));
}

function mainArea() {
  const d = S.data;
  if (!S.gid || !d) {
    return h("div", { class: "empty" }, h("h2", { text: "Pick a group" }),
      h("p", { text: "Your groups are on the left. Press G to find more on your node." }));
  }
  const g = d.group;
  const chips = [
    h("span", { class: "chip mono", text: g.view === "chat" ? "» chat" : g.view === "feed" ? "☰ feed" : g.view === "pages" ? "⌂ site" : "≡ threads" }),
    g.encrypted ? h("span", { class: "chip" }, svg(ICON.lock, 12, 2.5),
      g.type === "inbox" ? "sealed to you" : g.type === "contact" ? "private · sealed to each of you" : "closed · end-to-end encrypted") :
      g.type ? h("span", { class: "chip", text: g.type }) : null,
    g.fast ? h("span", { class: "chip warn", text: "fast delivery" }) : null,
  ];
  const canSwitch = g.type && g.type !== "inbox" && g.type !== "contact";
  const head = h("header", { class: "ghead" },
    S.mobileReading ? h("button", { class: "btn icon back", "aria-label": "Back to threads", onclick: () => { S.mobileReading = false; render(); } }, svg(ICON.back)) :
      h("button", { class: "btn icon back-groups", "aria-label": "Back to your groups", onclick: () => { S.pane = "groups"; render(); } }, svg(ICON.back)),
    h("div", { class: "t" },
      h("div", { class: "row" }, h("h1", { text: g.label }), chips),
      g.title ? h("p", { text: g.title }) : null,
      g.files && g.node_files === false ? h("p", { class: "hint warn-line",
        text: "This group takes pictures and files, but your node does not carry them - they will not show here. Another node may." }) : null,
      // read without following (unseenet#506): say so, and offer to follow here
      canSwitch && g.subscribed === false ? h("p", { class: "hint looking" },
        "You are reading this without following it. ",
        h("button", { class: "link", "data-k": "follow-here", onclick: async () => {
          try { await api("POST", "/api/subscribe", { id: g.id, on: true }); } catch (x) { toast(x.message); return; }
          g.subscribed = true; toast("Following " + g.label + "."); await loadSidebar(); await loadGroup(); } }, "Follow")) : null),
    h("div", { class: "actions" },
      g.type === "contact" ? [
        h("button", { class: "btn", onclick: () => openAddContact(g.key, g.contact ? g.label.replace(/ √$/, "") : "") }, g.contact ? "Rename" : "Add contact"),
        h("button", { class: "btn", title: "Off the list of chats; it comes back when one of you writes",
          onclick: () => closeChat(g.key, g.label.replace(/ √$/, "")) }, "Close chat"),
        h("button", { class: "btn", onclick: () => copy(g.key, "Their key is copied.") }, "Copy key"),
        h("button", { class: "btn primary", title: "A post with a subject instead of a chat line (N)",
          onclick: () => openPost(g.key, g.label.replace(/ √$/, "")) }, "Write a post", h("kbd", { text: "N" }))] : null,
      g.owner && g.type === "closed" ? h("button", { class: "btn", onclick: () => openInvite() }, "Invite") : null,
      canSwitch ? h("button", { class: "btn", onclick: toggleView },
        "Show as " + nextView(g), h("kbd", { text: "V" })) : null,
      g.type ? h("button", { class: "btn icon", "aria-label": "About this group", title: "About this group (?)", onclick: openInfo, text: "?" }) : null,
      h("button", { class: "btn icon pal-btn", "aria-label": "More: all commands", onclick: () => openPalette() }, "⋯"),
      g.type && !["contact", "inbox"].includes(g.type) && g.view !== "pages" && (g.kinds || ["post"]).includes("post") ?
        h("button", offProps(mayWrite(d, "post"), { class: g.view === "chat" ? "btn" : "btn primary", onclick: () => openCompose(),
          title: "A post with a subject (UN-RFC 0028)" }),
          svg(ICON.plus, 16, 2.5), "New post", h("kbd", { text: "N" })) : null));
  return [head, g.view === "chat" ? chatView(d) : g.view === "feed" ? feedView(d) : g.view === "pages" ? siteView(d) : threadsView(d)];
}

// ---- sites and pages (UN-RFC 0035, UN-RFC 0046 section 4.15) -------------------
// A site is shown as its home page with a list of its pages in force; links within
// the site come from the core as unseenet: addresses, and following them keeps a
// history to go back and forward in (section 9.1). Its writers edit pages with a
// preview rendered by the core, as readers will see them (section 9.2).
const SITE = { path: {}, back: [], forward: [] };       // per site: the page shown; one history
async function loadSite(gid) {
  let site, page = null, err = "";
  try { site = await api("GET", `/api/groups/${encodeURIComponent(gid)}/site`); }
  catch (x) { return { error: x.message, pages: [] }; }
  const path = SITE.path[gid] || site.home;
  try { page = await api("GET", `/api/groups/${encodeURIComponent(gid)}/page?path=${encodeURIComponent(path)}`); }
  catch (x) { err = path === site.home ? "The home page is not here yet - the site may have no pages, or they are still being read." :
    `The page ${path} is not on this site any more.`; }
  return { ...site, path, page, err };
}

// open a page of a site, from a link or an address; the place left goes on the history
async function openPage(gid, path, how = "go") {
  const here = S.gid && S.data && S.data.site ? { gid: S.gid, path: S.data.site.path } : null;
  if (how === "go" && here && (here.gid !== gid || here.path !== path)) { SITE.back.push(here); SITE.forward = []; }
  SITE.path[gid] = path;
  S.full = false;
  if (S.gid === gid) { await loadGroup(); render(); } else await openGroup(gid);
  const sc = document.querySelector('[data-scroll^="page:"]');
  if (sc) sc.scrollTop = 0;
}
function siteStep(dir) {
  const from = dir < 0 ? SITE.back : SITE.forward, to = dir < 0 ? SITE.forward : SITE.back;
  const at = from.pop();
  if (!at) return;
  if (S.gid && S.data && S.data.site) to.push({ gid: S.gid, path: S.data.site.path });
  openPage(at.gid, at.path, "step");
}

function siteView(d) {
  const g = d.group, site = d.site || { pages: [] };
  if (site.error) return h("div", { class: "content" }, h("div", { class: "empty" }, h("h2", { text: "This site cannot be shown" }), h("p", { text: site.error })));
  const page = site.page, row = page ? fromRow(page.row) : null;
  if (row) markRead([row]);
  const list = h("nav", { class: "pagelist", "aria-label": "Pages" },
    h("h3", { class: "list-h", text: `pages · ${site.pages.length}` }),     // a quiet label, as in the sidebar
    site.pages.map(p => h("button", { class: "item" + (p.path === site.path ? " on" : ""), "aria-current": p.path === site.path ? "page" : null,
      onclick: () => openPage(g.id, p.path) },
      h("span", { class: "ic", text: p.home ? "⌂" : "·" }),
      h("span", { class: "nm" }, p.title, h("small", { class: "mono muted", text: " /" + p.path })))),
    site.may_write ? h("button", { class: "btn", onclick: () => openPageEditor(g, site, null) }, svg(ICON.plus, 16, 2.5), "New page") : null);
  return h("div", { class: "content site" }, list,
    h("article", { class: "page", "aria-label": "Page" },
      h("div", { class: "pagebar" },
        h("button", { class: "btn icon", "aria-label": "Back", title: "Back", disabled: !SITE.back.length, onclick: () => siteStep(-1) }, "←"),
        h("button", { class: "btn icon", "aria-label": "Forward", title: "Forward", disabled: !SITE.forward.length, onclick: () => siteStep(1) }, "→"),
        h("span", { class: "mono muted crumb", text: (site.title || site.label || "") + "  /" + (site.path || "") }),
        h("span", { class: "grow" }),
        page ? h("button", { class: "btn", onclick: () => copy(page.address, "The page's address is copied.") }, "Copy address") : null,
        page && site.may_write ? h("button", { class: "btn", onclick: () => openPageEditor(g, site, page) }, "Edit") : null,
        page && site.may_write && page.previous ? h("button", { class: "btn", title: "Publish the version before this one again (UN-RFC 0035 section 10.4)",
          onclick: () => pageAction(g, page, "restore") }, "Previous version") : null,
        page && site.may_write && !page.home ? h("button", { class: "btn", onclick: () => pageAction(g, page, "remove") }, "Remove") : null),
      h("div", { class: "scroll", "data-scroll": "page:" + g.id + ":" + (site.path || "") },
        page ? [
          // a page that begins with its own heading is not given a second one (its title
          // is in the list and the bar above); who wrote it and when goes below the page
          pageOwnTitle(row) ? null : h("h2", { text: page.title }),
          h("div", { class: "pbody" + (pageOwnTitle(row) ? " titled" : "") }, messageBody(row)),
          h("p", { class: "hint pmeta", text: [row.who, when(row.date), page.previous ? "edited" : ""].filter(Boolean).join(" · ") })] :
          h("div", { class: "empty" }, h("h2", { text: site.pages.length ? "Not here" : "No pages yet" }),
            h("p", { text: site.err || "" }),
            site.may_write && !site.pages.length ? h("button", { class: "btn primary", onclick: () => openPageEditor(g, site, null, site.home) }, "Write the home page") : null),
        pendingPages(g))));
}

function pageOwnTitle(row) {
  const first = row && row.markdown && (row.tree || [])[0];
  return !!(first && first.t === "h" && first.n === 1);
}

function pendingPages(g) {
  const pend = Object.entries(S.pending).filter(([, p]) => p.group === g.id && p.page);
  return pend.length ? h("div", { class: "pagepend" }, pend.map(([job, p]) => h("div", { class: "hint" },
    p.text + " ", p.state === "failed" ? [h("span", { class: "state bad", text: "Not done: " + (p.error || "") }), " ",
      h("button", { class: "link", onclick: () => retry(job) }, "Try again")] : pendingState(p)))) : null;
}

function pageAction(g, page, what) {
  const ask = what === "remove" ? `Remove the page "${page.title}"? Readers no longer see it; nodes keep the removal for a while.` :
    `Publish the version of "${page.title}" from ${when(page.previous.date)} by ${page.previous.who} again? It becomes the current one.`;
  S.dialog = { focus: ".dialog .btn", render: () => dialogShell({ label: what === "remove" ? "Remove page" : "Previous version" },
    h("div", { class: "dh" }, h("h2", { text: what === "remove" ? "Remove the page?" : "Go back to the previous version?" }),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db" }, h("p", { style: "margin:0", text: ask })),
    h("div", { class: "df btns" }, h("button", { class: "btn", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn " + (what === "remove" ? "danger" : "primary"), onclick: () => {
        closeDialog();
        if (what === "remove") SITE.path[g.id] = (S.data.site && S.data.site.home) || "index";
        doSend(`/api/groups/${encodeURIComponent(g.id)}/page`, g.id, { path: page.path, [what]: true },
          { text: (what === "remove" ? "Removing " : "Restoring ") + page.path, page: true });
        toast("Sending - postage takes a few seconds."); } }, what === "remove" ? "Remove" : "Publish it again"))) };
  render();
}

// Writing a page (section 9.2): Markdown kept as written, a preview from the core as
// readers will see it, pictures as on posts; a new version names the current one.
function openPageEditor(g, site, page, path = "") {
  const row = page ? page.row.message : null;
  const dialog = { focus: page ? "#ptext" : "#ppath", node: null, files: [] };
  const st = { preview: null, busy: false, err: "" };
  const field = (n) => dialog.node.querySelector(`[name="${n}"]`);
  const values = () => ({ path: (page ? page.path : field("path").value).trim().replace(/^\/+|\/+$/g, ""),
    title: field("title").value.trim(), text: field("text").value, markdown: field("markdown").checked });
  const showPreview = async () => {
    const v = values();
    try { st.preview = (await api("POST", `/api/groups/${encodeURIComponent(g.id)}/page`, { ...v, preview: true })).tree; st.err = ""; }
    catch (x) { st.err = x.message; }
    const box = dialog.node.querySelector(".ppreview");
    box.replaceChildren(st.err ? h("p", { class: "error", text: st.err }) : h("div", { class: "md" }, renderTree(st.preview || [])));
    box.hidden = false;
  };
  const go = async (e) => {
    e && e.preventDefault();
    const v = values();
    if (!/^[a-z0-9_.-]{1,64}(\/[a-z0-9_.-]{1,64}){0,7}$/.test(v.path)) { toast("A path is 1-8 parts of a-z, 0-9 and - _ . separated by /, such as about or projects/ovos."); return; }
    if (!v.text.trim()) { toast("Write the page first."); return; }
    if (!page && site.pages.some(p => p.path === v.path) &&
        !window.confirm(`There is a page ${v.path} already. Write a new version of it?`)) return;
    if (!page && site.pages.length >= site.max_pages && !site.pages.some(p => p.path === v.path) &&
        !window.confirm(`The site keeps at most ${site.max_pages} pages; a new one pushes the last out (UN-RFC 0035 section 9.2). Write it anyway?`)) return;
    const files = dialog.files.map(f => ({ name: f.name, data: f.data, alt: f.alt.trim() }));
    closeDialog();
    SITE.path[g.id] = v.path;
    await doSend(`/api/groups/${encodeURIComponent(g.id)}/page`, g.id, { ...v, ...(files.length ? { files } : {}) },
      { text: "Writing " + v.path, page: true });
    toast("Writing the page - postage takes a few seconds.");
  };
  dialog.node = dialogShell({ label: page ? "Edit page" : "New page", wide: true },
    h("div", { class: "dh" }, h("h2", { text: page ? `Edit /${page.path}` : "New page" }),
      h("button", { class: "btn primary dh-send", onclick: go }, "Publish"),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("form", { class: "db", onsubmit: go, onkeydown: (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") go(e); } },
      page ? null : [h("label", { for: "ppath", text: "Path" }),
        h("input", { id: "ppath", name: "path", class: "in mono", "data-k": "ppath", value: path, placeholder: "about, or projects/ovos", autocomplete: "off", spellcheck: "false" })],
      h("label", { for: "ptitle", text: "Title" }),
      h("input", { id: "ptitle", name: "title", class: "in", "data-k": "ptitle", value: page ? page.title : "", autocomplete: "off", maxlength: 128 }),
      h("div", { class: "label-row" }, h("label", { for: "ptext", text: "Text" }), emojiButton("ptext")),
      h("textarea", { id: "ptext", name: "text", class: "in compose-body mono", "data-k": "ptext", value: row ? row.text : "", spellcheck: "true" }),
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "markdown", checked: !row || isMd(row.content_type) }),
        " Markdown: # headings, *emphasis*, [links](about) to other pages of the site"),
      g.files ? filePicker(dialog, g, g.node_files !== false) : null,
      h("div", { class: "ppreview", hidden: true }),
      h("p", { class: "hint", style: "margin:0", text: "A page is public to everyone who reads the site. A new version replaces this one; the one before is kept a while." })),
    h("div", { class: "df btns" },
      h("button", { class: "btn", onclick: (e) => { e.preventDefault(); showPreview(); } }, "Preview"),
      h("span", { class: "grow" }),
      h("button", { class: "btn", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn primary", onclick: go }, "Publish", h("kbd", { text: "Ctrl S" }))));
  S.dialog = dialog;
  dialog.render = () => dialog.node;
  render();
}

// Your own site (UN-RFC 0035 section 7): only when you ask, after the warning.
async function openMySite() {
  let f;
  try { f = await api("GET", "/api/site"); } catch (x) { toast(x.message); return; }
  if (f.started && f.followed) { S.full = false; openGroup(f.id); return; }
  const st = { busy: false, err: "" };
  const draw = () => dialogShell({ label: "Start your site" },
    h("div", { class: "dh" }, h("h2", { text: "Start your site?" }),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db" },
      h("div", { class: "warnbox" }, f.warning.split("\n\n").map(t => h("p", { text: t }))),
      st.err ? h("p", { class: "error", text: st.err }) : null),
    h("div", { class: "df btns" }, h("span", { class: "mono muted", text: f.id }),
      h("button", { class: "btn", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn primary", disabled: st.busy, onclick: async () => {
        st.busy = true; st.err = ""; render();
        try { await api("POST", "/api/site", {}); }
        catch (x) { st.busy = false; st.err = x.message; render(); return; }
        closeDialog(); toast("Your site is started: write its home page.");
        await loadSidebar(); S.full = false; openGroup(f.id); } }, st.busy ? "Starting …" : "Start my site")));
  S.dialog = { focus: ".dialog .btn", render: draw };
  render();
}

// ---- feeds (UN-RFC 0034, UN-RFC 0046 section 4.14) ---------------------------
// Entries newest first, each whole, comments under each, oldest first; the core lays
// the group out (Session.feed: every note its own entry) and says who may comment.
// The timeline is the pseudo-group timeline:, every followed feed's entries.
const FEED_SHOWN = 2;                              // comments shown before "Show all"
function feedEntries(d) {
  const out = [];
  for (const m of d.messages) {
    if (m.depth === 0 || !out.length) out.push({ m, comments: [] });
    else out[out.length - 1].comments.push(m);
  }
  const pinned = out.filter(e => e.m.pinned);       // pinned entries first (section 4.1)
  return pinned.concat(out.filter(e => !e.m.pinned));
}

// Keys in a feed (unseenet#490): up and down go from entry to entry, Space to the next
// unread one, R comments on the one you are on - the same keys as the terminal client.
function feedCurrent() {
  const entries = S.data && S.data.group && S.data.group.view === "feed" ? feedEntries(S.data) : [];
  return entries.find(e => e.m.id === S.post) || null;
}
function feedGo(e) {
  if (!e) return;
  S.post = e.m.id; render();
  const el = document.querySelector(`.entry[data-id="${CSS.escape(e.m.id)}"]`);
  if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
}
function feedStep(delta) {
  const entries = feedEntries(S.data);
  if (!entries.length) return;
  const i = entries.findIndex(e => e.m.id === S.post);
  feedGo(entries[i < 0 ? 0 : Math.max(0, Math.min(entries.length - 1, i + delta))]);
}
async function feedNextUnread() {
  const entries = feedEntries(S.data);
  const i = entries.findIndex(e => e.m.id === S.post);
  const unread = e => !e.m.read || e.comments.some(c => !c.read);
  const next = entries.slice(i + 1).find(unread) || entries.slice(0, Math.max(0, i)).find(unread);
  if (next) { feedGo(next); return; }
  S.post = null; await nextUnread();
}
function feedComment() {
  const e = feedCurrent();
  const el = e && document.querySelector(`[data-k="c:${CSS.escape(e.m.id)}"]`);
  if (el) { el.focus(); el.scrollIntoView({ block: "nearest" }); }
  else if (e) toast((e.m.comment && e.m.comment.reason) || "Comments are closed here.");
}

// Keys on a site: up and down go through its pages, left and right back and forward.
function pageStep(delta) {
  const site = S.data && S.data.site;
  if (!site || !site.pages || !site.pages.length) return;
  const i = site.pages.findIndex(p => p.path === site.path);
  const next = site.pages[Math.max(0, Math.min(site.pages.length - 1, (i < 0 ? 0 : i) + delta))];
  if (next && next.path !== site.path) openPage(S.data.group.id, next.path);
}

function feedView(d) {
  const g = d.group, timeline = g.id === TIMELINE, entries = feedEntries(d);
  S.feedOpen = S.feedOpen || {};
  const shownMsgs = entries.flatMap(e => [e.m, ...visibleComments(e)]);
  markRead(shownMsgs);
  const note = !timeline && mayWrite(d, "chat").allowed && (g.kinds || ["chat"]).includes("chat");
  const send = () => {
    const input = document.querySelector('[data-k="note"]');
    const text = input.value.trim();
    if (!text) return;
    input.value = ""; S.drafts["note:" + g.id] = "";
    doPost(g.id, { body: text, chat: true }, { text, chat: true, thread: "new:" + g.id });
  };
  const pendNew = Object.entries(S.pending).filter(([, p]) => p.thread === "new:" + g.id);
  return h("div", { class: "content" }, h("section", { class: "feed", "aria-label": timeline ? "Timeline" : "Feed",
    "data-scroll": "feed:" + g.id },
    timeline ? h("p", { class: "hint feed-note", text: `The newest entries of the ${g.feeds || 0} feed${g.feeds === 1 ? "" : "s"} you follow, in the order they were written. Nobody is told whom you follow.` }) : null,
    note ? h("form", { class: "chatbar notebar", onsubmit: (e) => { e.preventDefault(); send(); } },
      h("div", { class: "row" },
        h("label", { for: "note", class: "sr", text: "A note in " + g.label }),
        h("input", { id: "note", type: "text", "data-k": "note", autocomplete: "off", placeholder: "Write a note in " + g.label,
          value: S.drafts["note:" + g.id] || "", oninput: (e) => { S.drafts["note:" + g.id] = e.target.value; } }),
        emojiButton("note"),
        h("button", { class: "send", type: "submit", "aria-label": "Post the note" }, svg(ICON.send, 18, 2.5))),
      h("div", { class: "hint" }, "A short note; New post gives one a headline.")) : null,
    pendNew.map(([job, p]) => h("article", { class: "entry pending", "data-job": job },
      h("div", { class: "etext", text: p.text }), p.state === "failed" ?
        h("div", { class: "state bad" }, "Not sent: " + (p.error || ""), " ", h("button", { class: "link", onclick: () => retry(job) }, "Try again")) :
        pendingState(p))),
    entries.length ? entries.map(e => entryCard(d, e)) :
      h("div", { class: "empty" }, h("h2", { text: timeline ? "Nothing yet" : "No entries yet" }),
        h("p", { text: timeline ? "Follow someone or a feed (Ctrl P), and their entries come here." :
          note ? "Write the first note above." : "" }))));
}

// what shows under an entry: all when opened; else the newest few, and always your own
// (section 4.4 - never chosen by how many answers or reactions)
// Many comments are folded to the newest few - and every conversation you are in: the
// comments that are yours, answer you or name you, with what they answer and the answers
// under them, so you can follow your own threads without opening them all.
function visibleComments(e) {
  if (S.feedOpen && S.feedOpen[e.m.id]) return e.comments;
  const shown = new Set(e.comments.slice(-FEED_SHOWN).map(c => c.id));
  const yours = e.comments.filter(c => c.mine || c.for_me);
  const ids = new Set(e.comments.map(c => c.id));
  yours.forEach(c => {
    shown.add(c.id);
    (c.references || []).forEach(r => { if (ids.has(r)) shown.add(r); });          // what it answers
    e.comments.forEach(o => { if ((o.references || []).includes(c.id)) shown.add(o.id); });  // answers to it
  });
  return e.comments.filter(c => shown.has(c.id));
}

function entryCard(d, e) {
  const m = e.m, g = d.group, timeline = g.id === TIMELINE;
  const shown = visibleComments(e), hidden = e.comments.length - shown.length;
  const byId = Object.fromEntries(e.comments.map(c => [c.id, c]));
  const cp = m.comment || { allowed: false, reason: NOT_HERE };
  const target = (S.answering && S.answering[m.id] && byId[S.answering[m.id]]) || null;
  const send = () => {
    const input = document.querySelector(`[data-k="c:${m.id}"]`);
    const text = input.value.trim();
    if (!text) return;
    input.value = ""; S.drafts["c:" + m.id] = "";
    const to = target || m;
    if (S.answering) delete S.answering[m.id];
    doPost(m.group, { body: text, chat: true, references: [...to.references, to.id] }, { text, chat: true, thread: m.id });
  };
  const pend = Object.entries(S.pending).filter(([, p]) => p.thread === m.id);
  const own = groupOf(m.group) || g;
  return h("article", { class: "entry" + (m.pinned ? " pinned" : "") + (m.read ? "" : " unread") + (S.post === m.id ? " on" : ""), "data-id": m.id },
    h("div", { class: "ehd" }, avatar(m), h("div", { class: "who" }, whoEl(m),
      m.bot ? h("span", { class: "sm", text: "bot" }) : null,
      h("span", { class: "hint", text: when(m.date) }),
      timeline ? h("button", { class: "link efeed", onclick: () => openGroup(m.group) }, "in " + (m.group_label || labelOf(m.group))) : null,
      m.pinned ? h("span", { class: "pinmark", "aria-label": "Pinned", text: PIN }) : null),
      moreMenu(m)),
    m.kind !== "chat" ? h("h3", { class: "etitle", text: subjectOf(m) }) : null,
    h("div", { class: "ebody" }, m.kind === "chat" && m.readable ? [m.markdown ? renderChatLine(m) : linkGroups(m.text), filesOf(m, false)] : messageBody(m)),
    reactionBar(m),
    h("div", { class: "eact" },
      cp.allowed ? h("button", { class: "link", onclick: () => focusLater(`[data-k="c:${m.id}"]`) }, "Comment") : null,
      m.replyPerm && m.replyPerm.allowed && (own.kinds || ["post"]).includes("post") ?
        h("button", { class: "link", onclick: () => openReply(m, own) }, "Reply with a post") : null,
      m.address ? h("button", { class: "link", onclick: () => copy(m.address, "The entry's address is copied.") }, "Copy address") : null,
      g.may_pin && m.readable ? h("button", { class: "link", onclick: () => openPin(m) }, m.pinned ? "Unpin" : "Pin") : null,
      h("span", { class: "grow" }),
      e.comments.length ? h("span", { class: "hint", text: `${e.comments.length} comment${e.comments.length === 1 ? "" : "s"}` }) : null),
    h("div", { class: "comments" },
      hidden > 0 ? h("button", { class: "link more", onclick: () => { S.feedOpen[m.id] = true; render(); } },
        `Show all ${e.comments.length} comments`) :
      S.feedOpen[m.id] && e.comments.length > FEED_SHOWN ? h("button", { class: "link more", onclick: () => { delete S.feedOpen[m.id]; render(); } },
        "Show fewer") : null,
      shown.map(c => commentEl(c, m, byId)),
      pend.map(([job, p]) => h("div", { class: "comment mine pending", "data-job": job },
        h("div", { class: "ctext", text: p.text }), p.state === "failed" ?
          h("div", { class: "state bad" }, "Not sent: " + (p.error || ""), " ", h("button", { class: "link", onclick: () => retry(job) }, "Try again")) :
          pendingState(p))),
      cp.allowed ? h("form", { class: "cbar", onsubmit: (ev) => { ev.preventDefault(); send(); } },
        target ? h("div", { class: "hint answering" }, "Answering " + target.who + " ",
          h("button", { class: "link", type: "button", "aria-label": "Answer the entry instead", onclick: () => { delete S.answering[m.id]; render(); } }, "×")) : null,
        h("label", { for: "c-" + m.id, class: "sr", text: "Comment" }),
        h("input", { id: "c-" + m.id, type: "text", "data-k": "c:" + m.id, autocomplete: "off",
          placeholder: target ? "Your answer" : "Write a comment", value: S.drafts["c:" + m.id] || "",
          oninput: (ev) => { S.drafts["c:" + m.id] = ev.target.value; } }),
        h("button", { class: "send", type: "submit", "aria-label": "Send the comment" }, svg(ICON.send, 16, 2.5))) :
      cp.reason ? h("p", { class: "hint", text: cp.code === "comments_closed" ? "Comments are closed." : cp.reason }) : null));
}

// two levels (section 4.2; the core caps the depth at 2): a deeper answer sits at the
// second level and says whom it answers
function commentEl(c, entry, byId) {
  const parent = c.references.length ? byId[c.references[c.references.length - 1]] : null;
  return h("div", { class: "comment" + (c.depth > 1 ? " answer" : "") + (c.mine ? " mine" : ""), "data-id": c.id },
    avatar(c, true),
    h("div", { class: "cb" },
      h("div", { class: "chd" }, whoEl(c), h("span", { class: "hint", text: when(c.date) }),
        parent && parent.depth > 1 ? h("span", { class: "hint", text: "in answer to " + parent.who }) : null,
        moreMenu(c)),
      h("div", { class: "ctext" }, c.readable ? (c.kind === "chat" ? (c.markdown ? renderChatLine(c) : linkGroups(c.text)) :
        [h("strong", { text: subjectOf(c) }), messageBody(c)]) : h("i", { text: c.error || "Could not be read." })),
      reactionBar(c),
      entry.comment && entry.comment.allowed ? h("button", { class: "link", onclick: () => {
        S.answering = S.answering || {}; S.answering[entry.id] = c.id; render(); focusLater(`[data-k="c:${entry.id}"]`); } }, "Answer") : null));
}

// --- reactions (UN-RFC 0048, unseenet-gui#107) -----------------------------------
// Under every post, comment and chat line: each emoji with its count, yours marked; a
// click gives that one (or takes yours back), right-click says who, and + offers the
// group's set. Never shown as comments, never used to order anything (section 7.2).
function reactionBar(m) {
  const may = !!(m.react && m.react.allowed);
  const list = m.reactions || [];
  if (!m.readable || (!list.length && !may)) return null;
  return h("div", { class: "reacts", role: "group", "aria-label": "Reactions" },
    list.map(r => h("button", { type: "button", class: "react" + (r.mine ? " mine" : "") + (r.pending ? " pending" : ""),
      disabled: !may, "aria-pressed": String(!!r.mine),
      "aria-label": `${r.emoji} ${r.count}` + (r.mine ? ", yours" : ""),
      title: (r.mine ? "Yours - click to take it back" : "React with " + r.emoji) + " · right-click: who",
      onclick: () => reactTo(m, r.emoji),
      oncontextmenu: (ev) => { ev.preventDefault(); whoReacted(m, r.emoji); } },
      h("span", { class: "re", text: r.emoji }), h("span", { class: "rn", text: String(r.count) }))),
    may ? h("button", { type: "button", class: "react add", "aria-label": "Add a reaction", "aria-haspopup": "dialog",
      title: "React", onclick: (ev) => openReactions(m, ev.currentTarget) }, svg(ICON.smile, 15), "+") : null);
}

let reactPop = null;
function closeReactions() { if (reactPop) { reactPop.remove(); reactPop = null; } }

function openReactions(m, button) {
  if (reactPop) { closeReactions(); return; }
  const set = m.react_offered || (S.data && S.data.group && S.data.group.reactions) || { offered: [], any: false };
  const mine = (m.reactions || []).find(r => r.mine);
  reactPop = h("div", { class: "react-pop", role: "dialog", "aria-label": "React" },
    set.offered.map(e => h("button", { type: "button", class: "emo" + (mine && mine.emoji === e ? " mine" : ""), "aria-label": e,
      title: mine && mine.emoji === e ? "Yours - takes it back" : e, text: e,
      onclick: () => { closeReactions(); reactTo(m, e); } })),
    set.any && emojiOn() ? h("button", { type: "button", class: "btn icon", "aria-label": "More emoji", title: "More emoji",
      onclick: (ev) => { closeReactions(); openEmojiPicker("react:" + m.id, ev.currentTarget, (e) => reactTo(m, e)); } }, "…") : null);
  document.body.append(reactPop);
  placePopover(reactPop, button.getBoundingClientRect(), 40 * set.offered.length + (set.any ? 48 : 10), true);
  const first = reactPop.querySelector("button");
  if (first) first.focus();
}

async function reactTo(m, emoji) {
  const list = m.reactions || [];
  const mine = list.find(r => r.mine);
  try { if (!localStorage.getItem("unseenet.reacted")) {
    toast("Reactions are public and signed: anybody can see which key reacted to what.");
    localStorage.setItem("unseenet.reacted", "1"); } } catch (_) { /* no storage here */ }
  // shown at once, marked as on its way, until the group comes back (section 7.3)
  let next = list.map(r => ({ ...r }));
  if (mine) next = next.map(r => r.mine ? { ...r, count: r.count - 1, mine: false } : r);
  if (!mine || mine.emoji !== emoji) {
    const at = next.find(r => r.emoji === emoji);
    if (at) { at.count += 1; at.mine = true; at.pending = true; }
    else next.push({ emoji, count: 1, mine: true, pending: true });
  }
  m.reactions = next.filter(r => r.count > 0);
  render();
  try {
    await api("POST", `/api/groups/${encodeURIComponent(m.group)}/react`, { id: m.id, emoji });
  } catch (x) {
    toast("Not sent: " + x.message);
    await loadGroup();
  }
}

async function whoReacted(m, emoji) {
  try {
    const d = await api("POST", `/api/groups/${encodeURIComponent(m.group)}/react`, { id: m.id, emoji, who: true });
    toast(emoji + "  " + ((d.who || []).join(", ") || "nobody yet"));
  } catch (x) { toast(x.message); }
}

function focusLater(sel) {
  setTimeout(() => { const el = document.querySelector(sel); if (el) el.focus(); });
}

function groupOf(gid) {
  return allGroups().find(x => x.id === gid) || null;
}

// V: threads and chat; a feed also as a feed (UN-RFC 0034 section 3.1)
function nextView(g) {
  if (g.view === "pages" || g.owner_view === "pages") return g.view === "pages" ? "threads" : "pages";
  if (g.view === "feed" || g.owner_view === "feed") return { feed: "threads", threads: "chat" }[g.view] || "feed";
  return g.view === "chat" ? "threads" : "chat";
}

// ---- discussion: the newsreader (as in the terminal client) ------------------
// The posts as a tree, one row each; the selected one below, to read; R answers
// in a compose window with the post quoted. Chat groups are chats (chatView).
function threadsOf(msgs) {
  const out = [];
  for (const m of msgs) {
    if (m.depth === 0 || !out.length) out.push({ root: m, items: [m] });
    else out[out.length - 1].items.push(m);
  }
  return out;
}

// The selected post; if it is (briefly) not in the list, stay where you were
// instead of jumping to the first unread.
function currentPost(msgs) {
  const m = msgs.find(m => m.id === S.post);
  if (m) { S.postAt = msgs.indexOf(m); return m; }
  if (S.post && S.postAt != null) return msgs[Math.min(S.postAt, msgs.length - 1)];
  return msgs.find(m => !m.read) || msgs[0];
}

// ---- pinned posts (UN-RFC 0033, UN-RFC 0046 section 4.12) --------------------
// The core works out which pins are in force, with the rules every node uses; this
// shows them: a Pinned section above the threads, a bar above a chat (sections 7.2,
// 7.3), and pin and unpin for the owner and moderators only (section 7.1).
const PIN = "📌";
const pinsOf = (d) => (d && d.group && d.group.pins) || [];
function pinsHidden(gid, where) {
  try { return localStorage.getItem(`pins-hidden:${where}:${gid}`) === "1"; } catch (_) { return false; }
}
function hidePins(gid, where, on) {
  try { if (on) localStorage.setItem(`pins-hidden:${where}:${gid}`, "1"); else localStorage.removeItem(`pins-hidden:${where}:${gid}`); }
  catch (_) { /* remembered for this page only */ }
  render();
}
// a pin's first line: the subject of a post, the text of a chat line
function pinLine(p, m) {
  if (m && m.kind === "chat") return ((m.text || "").split("\n").find(l => l.trim()) || "").slice(0, 140);
  return p.subject || (m ? subjectOf(m) : "") || "A post this client has not fetched yet";
}

function pinnedSection(d, msgs) {
  const g = d.group, pins = pinsOf(d);
  if (!pins.length) return null;
  const hidden = pinsHidden(g.id, "threads");
  return h("section", { class: "pins", "aria-label": "Pinned posts" },
    h("button", { class: "pins-hd", "aria-expanded": hidden ? "false" : "true", onclick: () => hidePins(g.id, "threads", !hidden) },
      h("span", { "aria-hidden": "true", text: hidden ? "▸" : "▾" }), " " + PIN + " Pinned ",
      h("span", { class: "muted", text: String(pins.length) })),
    hidden ? null : pins.map(p => {
      const m = msgs.find(x => x.id === p.id);
      return h("button", { class: "pin" + (m && m.id === S.post ? " on" : ""), disabled: !m,
        title: m ? "Show the post" : "This client has not fetched the post yet",
        onclick: () => { S.post = m.id; S.mobileReading = true; render(); } },
        h("span", { class: "sj", text: PIN + " " + pinLine(p, m) }),
        h("span", { class: "from mono", text: p.who || (m && m.who) || "" }),
        p.note ? h("span", { class: "pnote", text: p.note }) : null);
    }));
}

// Scroll a chat to a line and show it briefly; say so when it is not here (section 7.3).
function jumpToLine(id) {
  setTimeout(() => {
    const el = [...document.querySelectorAll(".msgs [data-id]")].find(x => x.dataset.id === id);
    if (!el) { toast("That message is no longer here: earlier messages have expired."); return; }
    el.scrollIntoView({ block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1600);
  });
}

function pinBar(d, msgs) {
  const g = d.group, pins = pinsOf(d);
  if (!pins.length) return null;
  if (pinsHidden(g.id, "chat")) {
    return h("div", { class: "pinbar off" }, h("button", { class: "link", onclick: () => hidePins(g.id, "chat", false) },
      `${PIN} Show the pins (${pins.length})`));
  }
  S.pinAt = S.pinAt || {};
  const i = (S.pinAt[g.id] || 0) % pins.length, p = pins[i], m = msgs.find(x => x.id === p.id);
  return h("div", { class: "pinbar", role: "region", "aria-label": "Pinned" },
    h("button", { class: "pb-main", title: pins.length > 1 ? "Go to it; then the next pin" : "Go to it",
      onclick: () => { S.pinAt[g.id] = i + 1; jumpToLine(p.id); render(); } },
      h("span", { "aria-hidden": "true", text: PIN }),
      h("span", { class: "pb-text" }, h("b", { text: (p.who || (m && m.who) || "") + " " }), pinLine(p, m),
        p.note ? h("span", { class: "muted", text: " - " + p.note }) : null),
      pins.length > 1 ? h("span", { class: "hint", text: `${i + 1}/${pins.length}` }) : null),
    pins.length > 1 || g.may_pin ? h("button", { class: "link", onclick: () => openPinList() }, "All pins") : null,
    h("button", { class: "btn icon", "aria-label": "Hide the pins", title: "Hide the pins", onclick: () => hidePins(g.id, "chat", true) }, svg(ICON.x)));
}

async function pinRequest(g, body, done) {
  toast(body.unpin ? "Unpinning … the marker needs its proof of work first." : "Pinning … the marker needs its proof of work first.");
  await api("POST", `/api/groups/${encodeURIComponent(g.id)}/pin`, body);
  if (S.pinAt) S.pinAt[g.id] = 0;                 // the bar starts again at the newest pin
  closeDialog(); await loadGroup(); render(); toast(done);
}

function openPinList() {
  const d = S.data, g = d && d.group;
  if (!g) return;
  const chat = g.view === "chat";
  S.dialog = { focus: ".dialog .btn.primary", render: () => {
    const pins = pinsOf(S.data);
    return dialogShell({ label: "Pinned" },
      h("div", { class: "dh" }, h("h2", { text: PIN + " Pinned in " + g.label }), h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
      h("div", { class: "db" }, pins.length ? h("ul", { class: "pinlist" }, pins.map(p => {
        const m = S.data.messages.find(x => x.id === p.id);
        return h("li", {},
          h("button", { class: "link", disabled: !m, onclick: () => { closeDialog(); S.post = p.id; if (chat) jumpToLine(p.id); render(); } }, pinLine(p, m)),
          h("span", { class: "muted", text: " " + (p.who || (m && m.who) || "") + " · pinned by " + p.by_label + ", " + when(p.pinned) }),
          p.note ? h("div", { class: "pnote", text: p.note }) : null,
          g.may_pin ? h("button", { class: "btn", onclick: () => openUnpin(p, m) }, "Unpin") : null);
      })) : h("p", { class: "muted", text: "Nothing is pinned here." })),
      h("div", { class: "df btns" }, h("button", { class: "btn primary", onclick: closeDialog }, "Close")));
  } };
  render();
}

function openUnpin(p, m) {
  const g = S.data && S.data.group;
  if (!g || !g.may_pin) return;
  confirmDialog({ title: "Unpin “" + pinLine(p, m) + "”?", button: "Unpin", danger: !!p.beyond_window,
    text: p.beyond_window ? "It is older than this group keeps posts, so the nodes delete it as soon as it is unpinned." :
      "It stays where it is, and goes when it is older than this group keeps posts.",
    ok: async () => { try { await pinRequest(g, { id: p.id, unpin: true }, "Unpinned."); } catch (x) { toast(x.message); } } });
}

// Pin (or unpin) a post: the owner and moderators only (UN-RFC 0033 section 7.1).
function openPin(m) {
  const d = S.data, g = d && d.group;
  if (!g || !m || !g.may_pin) return;
  const pins = pinsOf(d), now = pins.find(p => p.id === m.id);
  if (now) { openUnpin(now, m); return; }
  const out = pins.length >= g.max_pins ? pins[pins.length - 1] : null;   // the oldest pin stops counting
  formDialog({ label: "Pin", title: "Pin “" + (m.kind === "chat" ? pinLine({}, m) : subjectOf(m)) + "”", focus: "#pnote", button: "Pin",
    note: "Everyone sees it at the top of " + g.label + ", and the nodes keep it until it is unpinned.",
    fields: (vals) => [
      out ? h("div", { class: "warnbox" },
        h("p", { style: "margin:0", text: `This group shows at most ${g.max_pins} pins, so “${pinLine(out, S.data.messages.find(x => x.id === out.id))}” stops counting.` }),
        h("button", { type: "button", class: "link", onclick: () => openPinList() }, "Unpin another one instead")) : null,
      h("label", { for: "pnote", text: "A note shown with it (optional)" }),
      h("input", { id: "pnote", name: "note", class: "in", "data-k": "pnote", maxlength: 256, value: vals.note || "" })],
    submit: async (v) => pinRequest(g, { id: m.id, note: (v.note || "").trim() }, "Pinned.") });
}

function threadsView(d) {
  const g = d.group, msgs = d.messages;
  if (!msgs.length) {
    const pend = pendingIn(g, msgs, false);              // your first post on its way (#48)
    return h("div", { class: "content" }, pend.length ?
      h("section", { class: "ptable", "aria-label": "Posts" }, pend.map(([job, p]) => pendingRow(job, p))) :
      h("div", { class: "empty" },
        h("h2", { text: g.id === FOR_YOU ? "Nothing for you yet" : "No posts yet" }),
        h("p", { text: g.id === FOR_YOU ? "Replies to your posts, and posts that name you, show up here." :
          mayWrite(d, "post").allowed ? "Be the first: press N to write a post." : mayWrite(d, "post").reason })));
  }
  const cur = currentPost(msgs);
  S.post = cur.id;
  markRead([cur]);
  const pend = pendingIn(g, msgs, false);
  const table = h("section", { class: "ptable", "aria-label": "Posts", "data-scroll": "ptable:" + g.id },
    pinnedSection(d, msgs),
    h("div", { class: "prow head", "aria-hidden": "true" }, h("span", {}), h("span", { text: "Subject" }),
      h("span", { text: "From" }), h("span", { text: "Date" })),
    msgs.map(m => h("button", {
      class: `prow${m === cur ? " on" : ""}${m.read ? "" : " unread"}${m.depth === 0 ? " root" : ""}`,
      "data-id": m.id, "aria-current": m === cur ? "true" : null,
      onclick: () => { S.post = m.id; S.mobileReading = true; render(); },
      ondblclick: () => { S.post = m.id; S.full = true; render(); } },
      h("span", { class: "flag", "aria-label": m.read ? null : "Unread", text: m.read ? "" : "●" }),
      h("span", { class: "sj" },
        m.depth ? h("span", { class: "tree", "aria-hidden": "true", text: "  ".repeat(m.depth - 1) + "└ " }) : null,
        m.for_me === "reply" ? h("span", { class: "you", text: "◄ " }) : m.for_me === "mention" ? h("span", { class: "you", text: "♦ " }) : null,
        m.pinned ? h("span", { class: "pinmark", title: "Pinned", text: PIN + " " }) : null,
        m.private && !m.notice ? h("span", { class: "muted", text: "@ " }) : m.encrypted && !m.notice ? h("span", { class: "muted", text: "∩ " }) : null,
        // a reply with the thread's own subject: quieter, so new subjects stand out
        h("span", { class: m.depth && sameSubject(m, msgs) ? "same" : null, text: subjectOf(m) }),
        g.id === FOR_YOU ? h("span", { class: "muted", text: "  (" + (m.notice ? m.notice.label + ", not followed" : labelOf(m.group)) + ")" }) : null),
      h("span", { class: "from mono" }, m.who, m.bot ? h("span", { class: "muted", text: " · bot" }) : null),
      h("span", { class: "date", text: when(m.date) }))),
    pend.map(([job, p]) => pendingRow(job, p)));
  return h("div", { class: "content news" + (S.full ? " full" : "") + (S.mobileReading ? " reading" : "") },
    table, readerPane(g, cur, msgs));
}

function pendingRow(job, p) {
  return h("div", { class: "prow pending" + (p.state === "failed" ? " failed" : ""), "data-job": job }, h("span", {}),
    h("span", { class: "sj", text: p.body.subject || "" }),
    h("span", { class: "from mono", text: S.state.me.label }),
    h("span", { class: "date" }, p.state === "failed" ?
      h("button", { class: "link", onclick: () => retry(job), title: p.error || "" }, "Not sent - again") : pendingState(p)));
}

function sameSubject(m, msgs) {
  const bare = (s) => (s || "").replace(/^(re:\s*)+/i, "").trim().toLowerCase();
  const i = msgs.indexOf(m);
  for (let j = i - 1; j >= 0; j--) if (msgs[j].depth === 0) return bare(msgs[j].subject) === bare(m.subject);
  return false;
}

function labelOf(gid) {
  const g = allGroups().find(x => x.id === gid);
  return g ? g.label : gid.split("@")[0];
}

// Quoted lines ("> ...", "> > ...") as quotes, one colour per level; long ones folded.
function renderBody(text) {
  const lines = text.split("\n"), out = [];
  let i = 0;
  const level = (ln) => { const m = ln.match(/^((?:>\s?)+)/); return m ? (m[1].match(/>/g) || []).length : 0; };
  while (i < lines.length) {
    if (level(lines[i]) === 0) {
      const para = [];
      while (i < lines.length && level(lines[i]) === 0) para.push(lines[i++]);
      const t = para.join("\n");
      const wrote = /^(.{1,80}) (wrote|skrev):$/.test(para[para.length - 1] || "") && i < lines.length;
      if (wrote) {
        const before = para.slice(0, -1).join("\n");
        if (before.trim()) out.push(h("p", { class: "text", text: before }));
        out.push(h("p", { class: "attrib", text: para[para.length - 1] }));
      } else if (t.trim() || out.length) out.push(h("p", { class: "text" }, linkGroups(t)));
      continue;
    }
    const q = [];
    while (i < lines.length && level(lines[i]) > 0) q.push(lines[i++]);
    const rows = q.map(ln => h("div", { class: "ql q" + Math.min(level(ln), 3) }, ln.replace(/^((?:>\s?)+)/, "") || " "));
    out.push(q.length > 6 ?
      h("details", { class: "quote-block" }, h("summary", { text: `Quoted text (${q.length} lines)` }), rows) :
      h("div", { class: "quote-block" }, rows));
  }
  return out;
}

// ---- Markdown and emoji (UN-RFC 0031): the core's safe tree as DOM, as the TUI shows it ----
// Nothing here loads anything: images come only from attachments (and until those
// exist, show their description), and links open only on a click, with a warning
// before leaving Tor.
function messageBody(m) {
  if (!m.readable) return h("p", { class: "text bad", text: m.error || "Could not be read." });
  RENDERING = m;
  const body = m.markdown ? h("div", { class: "md" }, renderTree(m.tree || [])) : renderBody(m.text || "");
  RENDERING = null;
  return [body, filesOf(m, false)];
}

function renderTree(blocks) {
  const out = [];
  blocks.forEach((b, i) => {
    const next = blocks[i + 1];
    if (b.t === "p") {
      const txt = inlineText(b.c);
      // "Sonia wrote:" before a quote: the attribution, as in plain text
      out.push(h("p", { class: next && next.t === "quote" && /(wrote|skrev):$/.test(txt) ? "attrib" : "text" }, renderInline(b.c)));
    } else if (b.t === "h") out.push(h("h" + Math.min(b.n + 2, 5), { class: "mdh" }, renderInline(b.c)));
    else if (b.t === "code") out.push(h("pre", { class: "mdcode", "data-lang": b.lang || null }, h("code", { text: b.v })));
    else if (b.t === "hr") out.push(h("hr", { class: "mdhr" }));
    else if (b.t === "quote") {
      const inner = renderTree(b.c), lines = (inlineTextDeep(b.c).match(/\n/g) || []).length + b.c.length;
      out.push(lines > 8 ? h("details", { class: "quote-block md" }, h("summary", { text: `Quoted text (${lines} lines)` }), inner)
        : h("blockquote", { class: "quote-block md" }, inner));
    } else if (b.t === "ul" || b.t === "ol") {
      out.push(h(b.t, b.t === "ol" && b.start !== 1 ? { start: b.start } : {}, b.items.map(item => h("li", {}, renderTree(item)))));
    } else if (b.t === "table") out.push(renderTable(b));
  });
  return out;
}

// A table (UN-RFC 0031 section 3.6): a real table in a box of its own that scrolls
// sideways when it is wider than the text, so it never pushes the page or a chat
// bubble out of shape.
function renderTable(b) {
  const al = (j) => (b.align || [])[j] ? { class: "al-" + b.align[j] } : {};
  return h("div", { class: "mdtable", tabindex: "0", role: "region", "aria-label": "Table" },
    h("table", {},
      (b.head || []).length ? h("thead", {}, h("tr", {}, b.head.map((c, j) => h("th", al(j), renderInline(c))))) : null,
      h("tbody", {}, (b.rows || []).map(r => h("tr", {}, r.map((c, j) => h("td", al(j), renderInline(c))))))));
}

// A chat line: its paragraphs inline, as one bubble (the chat subset has no blocks but code).
function renderChatLine(m) {
  const blocks = m.tree || [];
  RENDERING = m;
  const out = blocks.map((b, i) => [i ? h("br") : null,
    b.t === "code" ? h("pre", { class: "mdcode" }, h("code", { text: b.v })) :
    b.t === "p" ? h("span", {}, renderInline(b.c)) : h("div", { class: "md" }, renderTree([b]))]);
  RENDERING = null;
  return out;
}

function renderInline(nodes, inLink = false) {
  return nodes.map(n => {
    switch (n.t) {
      case "text": return inLink ? n.v : linkGroups(n.v);      // never a link inside a link
      case "br": return h("br");
      case "code": return h("code", { text: n.v });
      case "em": return h("em", {}, renderInline(n.c, inLink));
      case "strong": return h("strong", {}, renderInline(n.c, inLink));
      case "del": return h("del", {}, renderInline(n.c, inLink));
      case "emoji": return h("span", { class: "emoji", title: ":" + n.name + ":", text: n.v });
      case "image": {                         // a picture the post carries, where its text puts it
        const a = RENDERING && n.blob && RENDERING.attachments.find(x => x.blob === n.blob);
        return a ? fileView(RENDERING, { ...a, alt: n.alt || a.alt }, true) :
          h("span", { class: "mdimg", title: "A picture this post does not carry", text: "[image: " + (n.alt || "no description") + "]" });
      }
      case "link": {
        const shown = inlineText(n.c);
        return h("a", { class: "mdlink", href: n.href, title: n.href, rel: "noopener noreferrer",
          onclick: (e) => { e.preventDefault(); openLink(n.href); } },
          renderInline(n.c, true),
          // where a link leaves Tor shows plainly; an unseenet: address stays inside the network
          shown.trim() !== n.href && !/^unseenet:/i.test(n.href) ? h("span", { class: "addr", text: " " + n.href }) : null);
      }
      default: return null;
    }
  });
}

// ---- files on posts (UN-RFC 0027, UN-RFC 0046 section 4.10) -------------------
// The page never gets anything from the network the core has not checked: a picture
// comes as the core's own copy, decoded and saved again in a separate process, and a
// file to save comes checked against its blob ID - and is never opened from here.
let RENDERING = null;                          // the post whose text is being drawn
const PICS = new Map();                        // "group blob" -> {state, pic, error, why}
const ASKED = new Set();                       // pictures by ignored people you chose to see
const SHOWN = /^image\/(png|jpeg|gif|webp)$/;

function picture(gid, blob) {
  const k = gid + " " + blob, asked = ASKED.has(k);
  let p = PICS.get(k);
  if (!p || (asked && p.why === "ignored")) {
    p = { state: "loading" };
    PICS.set(k, p);
    api("GET", `/api/groups/${encodeURIComponent(gid)}/files/${encodeURIComponent(blob)}` + (asked ? "?asked=1" : ""))
      .then(pic => { PICS.set(k, { state: "ok", pic }); render(); })
      .catch(err => {
        PICS.set(k, { state: "err", error: err.message, why: err.why });
        if (err.why === "later") setTimeout(() => { PICS.delete(k); render(); }, 8000);   // the node is fetching it
        render();
      });
  }
  return p;
}

function size(octets) {
  return octets >= 1048576 ? (octets / 1048576).toFixed(1) + " MB" : octets >= 1024 ? Math.round(octets / 1024) + " KB" : octets + " bytes";
}

// The files of a post not already drawn in its text.
function filesOf(m, chat) {
  const inline = new Set();
  (function walk(nodes) { (nodes || []).forEach(n => { if (n.t === "image" && n.blob) inline.add(n.blob); walk(n.c); (n.items || []).forEach(walk); }); })(m.markdown ? m.tree : []);
  const rest = (m.attachments || []).filter(a => !inline.has(a.blob));
  return rest.length ? h("div", { class: "files" + (chat ? " in-chat" : "") }, rest.map(a => fileView(m, a, false))) : null;
}

function fileView(m, a, inline) {
  const what = a.alt || a.name || "a picture";
  if (SHOWN.test(a.type)) {
    const p = picture(m.group, a.blob);
    const box = (cls, ...kids) => h("span", { class: "pic " + cls + (inline ? " inline" : ""),
      style: a.dim ? `aspect-ratio:${a.dim[0]}/${a.dim[1]};max-width:min(100%,${a.dim[0]}px)` : null }, ...kids);
    if (p.state === "ok") {
      return h("figure", { class: "pic" + (inline ? " inline" : "") },
        h("img", { src: p.pic.data, alt: what, width: p.pic.width, height: p.pic.height, title: a.name || "" }),
        a.alt && !inline ? h("figcaption", { text: a.alt }) : null);
    }
    if (p.state === "loading") return box("wait", h("span", { class: "hint", text: "Fetching " + what + " …" }));
    if (p.why === "ignored") {
      return box("off", h("span", { class: "hint", text: "A picture by someone you ignore." }),
        h("button", { class: "link", onclick: () => { ASKED.add(m.group + " " + a.blob); render(); } }, "Show it"));
    }
    return box("off", h("span", { class: "hint", text: (a.alt ? `[${a.alt}] ` : "") + (p.error || "Not shown.") }),
      p.why === "not_shown" ? h("button", { class: "link", onclick: () => saveFile(m, a) }, "Save it") : null);
  }
  return h("span", { class: "file" + (inline ? " inline" : "") },
    h("span", { class: "fname mono", text: a.name || "file" }),
    h("span", { class: "hint", text: " " + a.type + " · " + size(a.size) }),
    a.alt ? h("span", { class: "falt", text: a.alt }) : null,
    h("button", { class: "btn", onclick: () => saveFile(m, a) }, "Save"));
}

// Save a file as it came, checked. The core writes it in Downloads; in a browser the
// browser saves it. Never opened: another program runs outside Unseenet and Tor.
function saveFile(m, a) {
  confirmDialog({ title: "Save " + (a.name || "the file") + "?", button: "Save",
    text: `${a.name || "The file"} (${a.type}, ${size(a.size)}) is saved as it came, checked against what the post names.\n\n` +
      "Unseenet does not open it. If you open it in another program, that program runs outside Unseenet and may go to the internet without Tor.",
    ok: async () => {
      closeDialog();
      try {
        if (GUI && GUI.web) {
          const f = await api("GET", `/api/groups/${encodeURIComponent(m.group)}/files/${encodeURIComponent(a.blob)}?save=1`);
          const link = h("a", { href: `data:application/octet-stream;base64,${f.data}`, download: f.name });
          document.body.append(link); link.click(); link.remove();
          toast("Saved: " + f.name);
        } else {
          const r = await api("POST", "/x/gui/save", { group: m.group, blob: a.blob });
          toast("Saved in " + r.path);
        }
      } catch (err) { toast(err.message); }
    } });
}

// Read chosen files as base64 for the local API, at most four and within ``max`` each.
async function readFiles(fileList, into, max) {
  for (const file of Array.from(fileList)) {
    if (into.length >= 4) { toast("At most four files on a post."); break; }
    if (max && file.size > max) { toast(`${file.name} is ${size(file.size)}; this group takes files up to ${size(max)}.`); continue; }
    const data = await new Promise((ok, bad) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(",", 2)[1] || ""); r.onerror = bad;
      r.readAsDataURL(file);
    });
    into.push({ name: file.name, size: file.size, type: file.type, data, alt: "" });
  }
}

// What files a group takes, as the core's FILE_CHOICES names them (#102, unseenet#496).
function fileChoice(files) {
  if (!files) return "none";
  const types = [...(files.types || [])].sort().join(",");
  if (files.max_size !== 4194304) return "custom";
  return types === "image/*" ? "pictures" : types === "application/pdf,image/*" ? "pictures+pdf" : "custom";
}
const FILE_PICKS = [["none", "No files", "text only"], ["pictures", "Pictures", "up to 4 MiB each"],
  ["pictures+pdf", "Pictures and PDFs", "up to 4 MiB each"]];

// Choosing files for a post: at most four, with a description each. The core saves
// pictures again without their metadata (GPS, time, camera) before they are sent.
function filePicker(dialog, g, carries) {
  if (!carries) return h("p", { class: "hint", style: "margin:0",
    text: "This group takes pictures and files, but your node does not carry them." });
  const max = g.files.max_size || 0, list = h("div", { class: "picklist" });
  const draw = () => list.replaceChildren(...dialog.files.map((f, i) => h("div", { class: "pick" },
    h("span", { class: "fname mono", text: f.name }), h("span", { class: "hint", text: size(f.size) }),
    h("input", { class: "in", placeholder: "Describe it for people who cannot see it", value: f.alt, maxlength: 400,
      "aria-label": "Description of " + f.name, oninput: (e) => { f.alt = e.target.value; } }),
    h("button", { type: "button", class: "btn icon", "aria-label": "Remove " + f.name,
      onclick: () => { dialog.files.splice(i, 1); draw(); } }, svg(ICON.x)))));
  const input = h("input", { type: "file", multiple: true, class: "sr", id: "cfiles",
    accept: (g.files.types || []).length ? g.files.types.join(",") : "image/*,application/pdf",
    onchange: async (e) => {
      await readFiles(e.target.files, dialog.files, max);
      e.target.value = "";
      draw();
    } });
  draw();
  return h("div", { class: "attach" },
    h("label", { for: "cfiles", class: "btn" }, "Add pictures or files"), input,
    h("span", { class: "hint", text: " Pictures are saved again without where and when they were taken." + (max ? ` Up to ${size(max)} each.` : "") }),
    list);
}

// ---- #group references (unseenet #172) ----------------------------------
// The same rule as the core's group_refs(): '#' and a group name (a-z, digits, + _ -
// and dots), maybe '@' and the start of the owner's fingerprint. Not '# heading',
// not '#170', not inside a word or a URL.
const GROUP_REF = /(?<![\p{L}\p{N}_@#\/&.+-])#(?=[a-z0-9+_.-]*[a-z])([a-z0-9][a-z0-9+_-]*(?:\.[a-z0-9][a-z0-9+_-]*)*)(?:@([a-z2-7]{4,16}))?(?![\p{L}\p{N}_+@-]|\.[\p{L}\p{N}_])/gu;

// A bare unseenet: address in plain text is a link too (UN-RFC 0031 section 3.4.1);
// a full stop or a bracket after it is the sentence's, not the address's.
const ADDRESS_REF = /(?<![\p{L}\p{N}_])unseenet:[^\s<>"']*[^\s<>"'.,;:!?)\]]/gu;

function linkGroups(text) {
  const t = text || "", out = [];
  let last = 0;
  for (const m of t.matchAll(ADDRESS_REF)) {
    if (m.index > last) out.push(...linkGroupRefs(t.slice(last, m.index)));
    const ref = m[0];
    out.push(h("a", { class: "mdlink aref", href: "#", title: "Open " + ref,
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); openAddress(ref); } }, ref));
    last = m.index + ref.length;
  }
  if (last < t.length) out.push(...linkGroupRefs(t.slice(last)));
  return out;
}

function linkGroupRefs(text) {
  const out = [];
  let last = 0;
  for (const m of (text || "").matchAll(GROUP_REF)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const ref = m[0];
    out.push(h("a", { class: "mdlink gref", href: "#", title: "Go to " + ref.slice(1),
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); goToGroup(ref); } }, ref));
    last = m.index + ref.length;
  }
  if (last < (text || "").length) out.push(text.slice(last));
  return out;
}

// Open a group a post names: one you follow opens; one you do not is shown first,
// and you choose to follow it - never without asking (as the TUI's #).
async function goToGroup(ref) {
  let found;
  try { found = (await api("GET", "/api/group-ref?ref=" + encodeURIComponent(ref))).groups.map(fromGroup); }
  catch (x) { toast(x.message); return; }
  if (!found.length) { toast(`No group called ${ref.slice(1).split("@")[0]} on your nodes.`); return; }
  if (found[0].subscribed) { S.full = false; openGroup(found[0].id); return; }
  const several = found.length > 1;
  S.dialog = { focus: "[data-k='follow:0']", render: () => dialogShell({ label: ref },
    h("div", { class: "dh" }, h("h2", {}, several ? `Groups called ${ref.slice(1)}` : `Follow ${found[0].label}?`),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db list" },
      several ? h("p", { class: "hint", style: "margin:0 0 8px", text: "Groups with the same name have different owners: check the fingerprint." }) : null,
      found.map((g, i) => h("div", { class: "cmd" },
        h("span", { class: "mono muted", style: "width:28px", text: (g.access || "") + (g.icon || "") }),
        h("span", { class: "nm" }, h("span", { class: "mono", text: several ? g.short : g.label }), " ",
          h("small", { text: g.description || "" }),
          g.warning && !(several && g.warning.startsWith("There is more than one")) ?   // said once, above
            h("small", { class: "muted", style: "display:block", text: g.warning }) : null,
          g.type === "closed" ? h("small", { class: "muted", style: "display:block", text: "Closed: you can read it only if its owner invites you." }) : null),
        h("button", { class: "btn primary", "data-k": "follow:" + i, onclick: async () => {
          try { await api("POST", "/api/subscribe", { id: g.id, on: true }); }
          catch (x) { toast(x.message); return; }
          closeDialog(); S.full = false; await loadSidebar(); openGroup(g.id); } }, "Follow")))),
    h("div", { class: "df btns" }, h("span", { class: "mono muted", text: several ? "" : found[0].id }),
      h("button", { class: "btn", onclick: closeDialog }, "Cancel"))) };
  render();
}

// ---- following (UN-RFC 0034 section 6, UN-RFC 0046 section 4.14) ----------------
// Kept in your vault and sent nowhere: following someone does not tell them.
async function setFollowing(body, who) {
  let r;
  try { r = await api("POST", "/api/following", body); } catch (x) { toast(x.message); return null; }
  if (body.refresh) toast(r.new && r.new.length ? `Following ${r.new.length} new feed${r.new.length === 1 ? "" : "s"}.` : "Nothing new.");
  else if (body.person && body.on !== false) toast(`Following ${who || r.name || "them"}` +
    (r.feeds && r.feeds.length ? `: ${r.feeds.map(labelOf).join(", ")}.` : " - their feeds come into your timeline when they start one."));
  else if (body.person) toast(`No longer following ${who || "them"}.`);
  else toast(body.on === false ? "No longer following the feed." : "Following the feed.");
  await loadSidebar();
  return r;
}

function openFollow() {
  const m = selectedPost();
  formDialog({ label: "Follow", title: "Follow someone", focus: "#ftarget", button: "Follow",
    values: { target: m && m.key && !m.mine && !m.private ? m.key : "" },
    note: "Their key, their name (such as andreas@lorensen) or their unseenet: address. This follows their personal feed and the feeds their profile lists. Nobody is told, and the list stays in your vault.",
    fields: (vals) => [h("input", { id: "ftarget", name: "target", class: "in mono", value: vals.target || "", "data-k": "ftarget",
      placeholder: "ed25519:… or name@hierarchy", autocomplete: "off", spellcheck: "false" })],
    submit: async (v) => {
      if (!(v.target || "").trim()) throw new Error("Whom? Their key, name or address.");
      await api("POST", "/api/following", { person: v.target.trim() }).then(async (r) => {
        closeDialog();
        toast(`Following ${r.name || "them"}` + (r.feeds.length ? `: ${r.feeds.map(labelOf).join(", ")}.` : " - no feeds yet."));
        await loadSidebar(); render();
      });
    } });
}

async function openFollowing() {
  let f;
  try { f = await api("GET", "/api/following"); } catch (x) { toast(x.message); return; }
  const own = f.feeds.filter(x => !f.people.some(p => p.feeds.some(y => y.id === x.id)));
  const draw = () => dialogShell({ label: "Whom you follow", wide: true },
    h("div", { class: "dh" }, h("h2", { text: "Whom you follow" }),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db list" },
      h("p", { class: "hint", style: "margin:0 0 8px", text: "Only you know: the list stays in your vault and is never sent to anyone." }),
      f.people.length ? h("h3", { class: "row-h", text: "People" }) : null,
      f.people.map(p => h("div", { class: "cmd" },
        h("span", { class: "nm" }, h("span", { text: p.label }), " ",
          h("small", { class: "mono", text: p.feeds.length ? p.feeds.map(x => x.label).join(", ") : "no feeds yet" })),
        h("button", { class: "btn", onclick: async () => { await setFollowing({ person: p.fingerprint, on: false }, p.label); openFollowing(); } }, "Unfollow"))),
      own.length ? h("h3", { class: "row-h", text: "Feeds" }) : null,
      own.map(x => h("div", { class: "cmd" },
        h("button", { class: "nm link", onclick: () => { closeDialog(); openGroup(x.id); } }, x.label + (x.title ? " - " + x.title : "")),
        h("button", { class: "btn", onclick: async () => { await setFollowing({ feed: x.id, on: false }); openFollowing(); } }, "Unfollow"))),
      !f.people.length && !own.length ? h("p", { class: "muted", text: "You follow nobody yet." }) : null),
    h("div", { class: "df btns" },
      h("button", { class: "btn", title: "Read their profiles again and follow their new feeds",
        onclick: async () => { await setFollowing({ refresh: true }); openFollowing(); } }, "Look for new feeds"),
      h("button", { class: "btn", onclick: () => openFollow() }, "Follow someone"),
      h("button", { class: "btn primary", onclick: closeDialog }, "Close")));
  S.dialog = { focus: ".dialog .btn.primary", render: draw };
  render();
}

// Your own feed (UN-RFC 0034 section 5): only when you ask, after the warning
// (UN-RFC 0029 section 2.1), with whether readers may comment.
async function openMyFeed() {
  let f;
  try { f = await api("GET", "/api/feed"); } catch (x) { toast(x.message); return; }
  if (f.started && f.followed) { S.full = false; openGroup(f.id); return; }
  const st = { comments: "open", busy: false, err: "" };
  const draw = () => dialogShell({ label: "Start your feed" },
    h("div", { class: "dh" }, h("h2", { text: "Start your feed?" }),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db" },
      h("div", { class: "warnbox" }, f.warning.split("\n\n").map(t => h("p", { text: t }))),
      h("p", { style: "margin:0", text: "May readers comment on what you post?" }),
      ["open", "none"].map(c => h("label", { class: "radio" },
        h("input", { type: "radio", name: "comments", value: c, checked: st.comments === c, onchange: () => { st.comments = c; } }),
        c === "open" ? " Yes, anybody may comment" : " No comments")),
      st.err ? h("p", { class: "error", text: st.err }) : null),
    h("div", { class: "df btns" }, h("span", { class: "mono muted", text: f.id }),
      h("button", { class: "btn", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn primary", disabled: st.busy, onclick: async () => {
        st.busy = true; st.err = ""; render();
        try { await api("POST", "/api/feed", { comments: st.comments }); }
        catch (x) { st.busy = false; st.err = x.message; render(); return; }
        closeDialog(); toast("Your feed is started: what you post there is public.");
        await loadSidebar(); S.full = false; openGroup(f.id); } }, st.busy ? "Starting …" : "Start my feed")));
  S.dialog = { focus: ".dialog .btn", render: draw };
  render();
}

// An unseenet: address (UN-RFC 0031 section 3.4.1, the older forms too): the core says
// what it names (UN-RFC 0046 section 4.13). A group you follow opens, at the post or the
// page it names; one you do not is shown first and you choose to follow it - never without
// asking. Its n= hints are only said: this client reads from your own nodes.
async function openAddress(text) {
  let a;
  try { a = await api("GET", "/api/address?a=" + encodeURIComponent(String(text || "").trim())); }
  catch (x) { toast(x.message); return; }
  if (a.kind === "identity") {
    if (a.key) { openProfile(a.key, a.label || ""); return; }
    toast(`Someone this client has not met yet: fingerprint ${a.fingerprint}.`);
    return;
  }
  if (!a.available) {
    toast("Your nodes do not have that group" + (a.nodes && a.nodes.length ?
      `. The address says it is on ${a.nodes.join(", ")}: add that node to read it.` : "."));
    return;
  }
  const go = async () => {
    S.full = false;
    await openGroup(a.group_id);
    if (a.kind === "post") {
      const here = S.data && S.data.messages.find(x => x.id === (a.message && a.message.id));
      if (!here) { toast("That post is not here - it may have been withdrawn or have expired."); return; }
      if (S.data.group.view === "chat") jumpToLine(here.id);
      else { S.post = here.id; render(); }
    } else if (a.kind === "page") {
      if (!a.page) toast("That page is not on the site - here is its home page.");
      else openPage(a.group_id, a.page.path);
    }
  };
  if (a.followed) { go(); return; }
  const g = a.group, what = a.kind === "post" ? (a.message ? ` - the post "${a.message.subject || "(no subject)"}"` : "") :
    a.kind === "page" && a.page ? ` - the page "${a.page.title}"` : "";
  S.dialog = { focus: "[data-k='follow-address']", render: () => dialogShell({ label: "Address" },
    h("div", { class: "dh" }, h("h2", {}, `Follow ${g.label}?`),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db" },
      g.title ? h("p", { style: "margin:0", text: g.title + what }) : what ? h("p", { style: "margin:0", text: what.slice(3) }) : null,
      g.type === "closed" ? h("p", { class: "muted", style: "margin:0", text: "Closed: you can read it only if its owner invites you." }) : null,
      h("p", { class: "hint", style: "margin:0", text: "The address took you here; you are not following it yet." })),
    h("div", { class: "df btns" }, h("span", { class: "mono muted", text: g.id }),
      h("button", { class: "btn", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn primary", "data-k": "follow-address", onclick: async () => {
        try { await api("POST", "/api/subscribe", { id: g.id, on: true }); }
        catch (x) { toast(x.message); return; }
        closeDialog(); await loadSidebar(); go(); } }, "Follow"))) };
  render();
}

function openAddressDialog() {
  formDialog({ label: "Address", title: "Open an address", focus: "#addr", button: "Open",
    note: "An unseenet: address of a group, a post, a page or a person - copied from a post, a chat or a profile.",
    fields: (vals) => [h("input", { id: "addr", name: "a", class: "in mono", value: vals.a || "", "data-k": "addr",
      placeholder: "unseenet:…", autocomplete: "off", spellcheck: "false" })],
    submit: async (v) => {
      if (!(v.a || "").trim()) throw new Error("Paste an unseenet: address.");
      closeDialog(); await openAddress(v.a);
    } });
}

// A mention notice (UN-RFC 0032): the post, or its group first (asking before following)
async function openMentioned(m) {
  const n = m.notice;
  if (!n) return;
  markRead([m]);
  if (!n.followed) { goToGroup(n.ref); return; }
  S.full = false;
  await openGroup(n.group);
  if (S.data && S.data.messages.some(x => x.id === n.id)) { S.post = n.id; render(); }
  else toast("The post is not there any more - perhaps it was withdrawn.");
}

// # on a post: its group, or a choice when it names several
function groupsInPost(m) {
  const refs = (m && m.groups) || [];
  if (!refs.length) { toast("This post names no group. Write e.g. #dk.snak to name one."); return; }
  if (refs.length === 1) { goToGroup(refs[0]); return; }
  S.dialog = { focus: "[data-k='ref:0']", render: () => dialogShell({ label: "Groups in this post" },
    h("div", { class: "dh" }, h("h2", {}, "Groups in this post"),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db list" }, refs.map((r, i) => h("button", { class: "cmd", "data-k": "ref:" + i,
      onclick: () => { closeDialog(); goToGroup(r); } }, h("span", { class: "nm mono", text: r }))))) };
  render();
}

function inlineText(nodes) {
  return (nodes || []).map(n => n.v !== undefined ? n.v : n.c ? inlineText(n.c) : n.t === "br" ? "\n" : "").join("");
}
function inlineTextDeep(blocks) {
  return blocks.map(b => b.c && b.t !== "quote" ? inlineText(b.c) : b.c ? inlineTextDeep(b.c) : b.v || "").join("\n");
}

// A link opens only on a click; leaving Tor is said first (section 3.4).
function openLink(href) {
  let url;
  try { url = new URL(href); } catch (_) { return; }
  if (url.protocol === "unseenet:") { openAddress(href); return; }
  if (url.protocol === "news:") { copy(href, "The link is copied."); return; }
  if (!url.hostname.endsWith(".onion") &&
      !window.confirm(`Open ${href}?\n\nThis is on the ordinary web, not a .onion address. Unless this browser is Tor Browser, the site sees your real address.`)) return;
  window.open(href, "_blank", "noopener,noreferrer");
}

function readerPane(g, m, msgs) {
  const marks = [];
  if (m.mine) marks.push(h("span", { class: "sm", text: "you" }));
  if (m.bot) marks.push(h("span", { class: "sm", title: "Its profile says it posts automatically (UN-RFC 0030)", text: "bot" }));
  else if (m.contact) marks.push(h("span", { class: "sm", text: "contact" }));
  marks.push(h("span", { class: "sm", text: when(m.date) }));
  if (m.for_me === "reply") marks.push(h("span", { class: "sm you", text: "◄ reply to you" }));
  if (m.for_me === "mention") marks.push(h("span", { class: "sm you", text: "♦ names you" }));
  if (m.encrypted) marks.push(h("span", { class: "sm lock" }, svg(ICON.lock, 12, 2.5), " encrypted"));
  else if (m.private && m.verified) marks.push(h("span", { class: "sm ok" }, svg(ICON.check, 13, 2.5), " verified sender"));
  else if (!m.private) marks.push(h("span", { class: "sm ok" }, svg(ICON.check, 13, 2.5), " signed"));
  const parent = m.references.length ? msgs.find(x => x.id === m.references[m.references.length - 1]) : null;
  const rp = mayReply(S.data, m), canReply = rp.code !== "none";
  const pos = msgs.indexOf(m);
  return h("article", { class: "reader", "aria-label": "Post" },
    S.full ? h("div", { class: "fullbar" },
      h("span", { class: "mono", text: g.label }), h("span", { class: "grow" }),
      h("span", { class: "hint", text: "N next · P previous · Space page, then next unread · R reply · Esc back" })) : null,
    h("div", { class: "scroll", "data-scroll": "post:" + m.id },
      h("h2", { text: subjectOf(m) }),
      h("div", { class: "post" }, avatar(m),
        h("div", { class: "pb" }, h("div", { class: "ph" }, whoEl(m), marks),
          parent ? h("button", { class: "inreply", onclick: () => { S.post = parent.id; render(); } },
            "In reply to ", h("span", { class: "mono", text: parent.who })) : null)),
      h("div", { class: "pbody" },
        messageBody(m),
        m.signature ? h("p", { class: "sig", text: "-- \n" + m.signature }) : null,
        reactionBar(m))),
    h("div", { class: "pbar" },
      canReply ? h("button", offProps(rp, { class: "btn primary", onclick: () => openReply(m, g) }),
        commenting(S.data) && !g.private_reply ? "Comment" : "Reply", h("kbd", { text: "R" })) : null,
      g.id === FOR_YOU && m.notice ? h("button", { class: "btn primary", onclick: () => openMentioned(m) },
        m.notice.followed ? "Open the post" : "Go to " + m.notice.label) :
      g.id === FOR_YOU ? h("button", { class: "btn", onclick: async () => {
        await openGroup(m.group); S.post = m.id; render(); } }, "Open in " + labelOf(m.group)) : null,
      h("button", { class: "btn icon more-btn", "aria-label": "More", "aria-expanded": S.moreTools ? "true" : "false",
        onclick: () => { S.moreTools = !S.moreTools; render(); } }, "⋯"),
      h("span", { class: "sec-tools" + (S.moreTools ? " open" : "") },
      !m.mine && m.key && !(m.private && m.kind === "chat") ? h("button", { class: "btn", title: "A private chat with them",
        onclick: () => openGroup("contact:" + m.key) }, "Chat") : null,
      !m.mine && m.key && !g.private_reply ? h("button", { class: "btn", title: "A private post with a subject",
        onclick: () => openPost(m.key, m.who.replace(/ √$/, "")) }, "Write a post") : null,
      !m.mine && m.key && !m.contact ? h("button", { class: "btn", onclick: () => openAddContact(m.key, m.who.replace(/~.*$/, "").replace(/^@/, "")) }, "Add contact") : null,
      // the post's tools, as in the TUI: withdraw (D), report, ban its author (owner)
      m.may_edit && m.kind !== "chat" ? h("button", { class: "btn", title: "Post a new version: everyone sees the newest (UN-RFC 0042)",
        onclick: () => openEdit(m, g) }, "Edit") : null,
      m.may_withdraw ? h("button", { class: "btn", title: "Withdraw the post from the network (D)", onclick: () => openWithdraw(m) }, "Withdraw", h("kbd", { text: "D" })) : null,
      g.may_pin && m.readable ? h("button", { class: "btn", title: m.pinned ? "Stop keeping it at the top" : "Keep it at the top of the group, for everyone",
        onclick: () => openPin(m) }, m.pinned ? "Unpin" : "Pin") : null,
      m.address && !m.private ? h("button", { class: "btn", title: "An unseenet: address others can open (UN-RFC 0031)",
        onclick: () => copy(m.address, "The post's address is copied.") }, "Copy address") : null,
      !m.mine && !m.private && g.id !== FOR_YOU ? h("button", { class: "btn", title: "Tell the people who can act on it", onclick: () => openReport(m) }, "Report") : null,
      g.owner && !m.mine && m.key && !m.private ? h("button", { class: "btn", title: "Ban the author from this group", onclick: () => openBanned(m.key) }, "Ban") : null,
      g.maintainer && !m.mine && m.key && !m.private ? h("button", { class: "btn", title: "Block the author in your whole hierarchy", onclick: () => openBlock(m) }, "Block") : null,
      !m.mine && m.key ? h("button", { class: "btn", title: "Stop seeing their posts (only you know)", onclick: () => ignorePerson(m.key, m.who) }, "Ignore") : null),
      h("span", { class: "grow" }),
      h("span", { class: "hint", text: `${pos + 1} of ${msgs.length}` }),
      h("button", { class: "btn icon", "aria-label": "Previous post", title: "Previous (↑)", onclick: () => step(-1) }, "↑"),
      h("button", { class: "btn icon", "aria-label": "Next post", title: "Next (↓)", onclick: () => step(1) }, "↓"),
      h("button", { class: "btn", title: "Space", onclick: nextUnread }, "Next unread", h("kbd", { text: "Space" })),
      h("button", { class: "btn full-btn", title: S.full ? "Back to the list (Esc)" : "Read full screen (F or Enter)",
        onclick: () => { S.full = !S.full; render(); } }, S.full ? "Back" : "Full screen", h("kbd", { text: S.full ? "Esc" : "F" }))));
}

function step(delta) {
  const msgs = S.data && S.data.messages;
  if (!msgs || !msgs.length) return;
  const i = msgs.findIndex(m => m.id === S.post);
  const next = msgs[Math.max(0, Math.min(msgs.length - 1, i + delta))];
  S.post = next.id; render();
  const row = document.querySelector(`.prow[data-id="${CSS.escape(next.id)}"]`);
  if (row) row.scrollIntoView({ block: "nearest" });
}

async function nextUnread() {
  const msgs = (S.data && S.data.messages) || [];
  const i = msgs.findIndex(m => m.id === S.post);
  const next = msgs.slice(i + 1).find(m => !m.read) || msgs.slice(0, Math.max(0, i)).find(m => !m.read);
  if (next) { S.post = next.id; render(); return; }
  // nothing more here: the next group with something unread, as a newsreader does
  const groups = allGroups(), at = groups.findIndex(x => x.id === S.gid);
  const other = groups.slice(at + 1).concat(groups.slice(0, Math.max(0, at))).find(x => x.unread && x.view !== "chat");
  if (other) { await openGroup(other.id); toast("Next unread: " + other.label); }
  else toast("Nothing unread.");
}

async function signatureText() {
  try { const s = await api("GET", "/api/settings"); return s.signature_preview || ""; } catch (_) { return ""; }
}

// A post's title in the list; a chat line among posts shows its first line (UN-RFC 0028).
function subjectOf(m) {
  if (m.kind === "chat") {
    const first = ((m.text || "").trim().split("\n")[0] || "…");
    return "» " + (first.length > 60 ? first.slice(0, 60) + "…" : first);
  }
  return m.subject || "(no subject)";
}

// The terminal client's compose window: subject, the post quoted, your signature below "-- ".
async function openReply(m, g) {
  if (m.private && m.kind === "chat" && m.key) { await openGroup("contact:" + m.key); return; }   // answer a chat in the chat
  const subject = /^re:/i.test(m.subject) ? m.subject : "Re: " + m.subject;
  const quoted = m.text.trimEnd().split("\n").map(ln => "> " + ln).join("\n");
  const top = `${m.who} wrote:\n${quoted}\n\n`;
  const sig = await signatureText();
  const body = top + "\n" + (sig ? "-- \n" + sig + "\n" : "");
  openComposeWindow({ g, title: g.private_reply ? "Private reply to " + m.who : "Reply in " + g.label,
    subject, body, cursor: top.length, private: !!g.private_reply,
    send: (subject, text, notify, files) => g.private_reply ?
      doSend("/api/private", g.id, { key: m.key, subject, body: text, reply_to: m.id,
        ...(files && files.length ? { files } : {}) }, { text }) :
      doPost(g.id, { subject, body: text, references: [...m.references, m.id], signature: false, notify,
        ...(files && files.length ? { files } : {}) }, { text }) });
}

// Edit your own post (UN-RFC 0042): a new version, in the same place in its thread.
function openEdit(m, g) {
  openComposeWindow({ g, title: "Edit your post in " + g.label, subject: m.subject, edit: true, cursor: 0,
    body: (m.text || "").trimEnd() + "\n" + (m.signature ? "\n-- \n" + m.signature + "\n" : ""),
    send: (subject, text) => doSend(`/api/groups/${encodeURIComponent(g.id)}/edit`, g.id,
      { id: m.id, subject, body: text }, { text }) });
}

// Edit a chat line or a comment (UN-RFC 0042): one line, no subject, no signature.
function openEditLine(m) {
  const gid = m.group || (S.data && S.data.group && S.data.group.id);
  formDialog({ label: "Edit", title: m.depth ? "Edit your comment" : "Edit your chat line", focus: "#eline", button: "Save",
    values: { line: (m.text || "").trimEnd() },
    note: "A new version: people may already have read the earlier one, and may keep it.",
    fields: (vals) => [h("label", { for: "eline", class: "sr", text: "Text" }),
      h("textarea", { id: "eline", name: "line", class: "in", "data-k": "eline", style: "min-height:80px", value: vals.line })],
    submit: async (v) => {
      const text = (v.line || "").trim();
      if (!text) throw new Error("Write something, or withdraw it instead.");
      closeDialog();
      await doSend(`/api/groups/${encodeURIComponent(gid)}/edit`, gid, { id: m.id, subject: "", body: text + "\n", chat: true }, { text, chat: true });
    } });
}

// "⋯" on a post, an entry, a comment or a chat line: what you may do with it - edit and
// withdraw your own, pin where you may, copy its address. Shown on hover (always where
// there is no hover, on a touch screen).
// "⋯" on a chat in the list: close it, or add or remove the person as a contact.
function chatMenu(p) {
  const id = "chat:" + p.key, open = S.menuFor === id;
  const items = [["Close chat", () => closeChat(p.key, p.label)],
    p.contact ? ["Remove contact", () => removeContact(p.key, p.label)]
      : ["Add contact", () => openAddContact(p.key, p.label.replace(/~.*$/, "").replace(/^@/, ""))]];
  return h("div", { class: "more" + (open ? " open" : "") },
    h("button", { class: "morebtn", type: "button", "aria-label": "More about the chat with " + p.label,
      "aria-haspopup": "menu", "aria-expanded": String(open),
      onclick: (e) => { e.stopPropagation(); S.menuFor = open ? null : id; render(); } }, "⋯"),
    open ? h("div", { class: "menu", role: "menu" }, items.map(([label, run]) => h("button", { class: "mi", type: "button", role: "menuitem",
      onclick: (e) => { e.stopPropagation(); S.menuFor = null; render(); run(); } }, label))) : null);
}

function moreMenu(m) {
  if (!m || !m.readable) return null;
  const here = S.data && S.data.group;
  const pinHere = here && here.may_pin && (!m.group || m.group === here.id);
  const items = [
    m.may_edit ? ["Edit", () => (m.kind === "chat" ? openEditLine(m) : openEdit(m, groupOf(m.group) || here))] : null,
    m.may_withdraw ? ["Withdraw (delete)", () => openWithdraw(m)] : null,
    pinHere ? [m.pinned ? "Unpin" : "Pin", () => openPin(m)] : null,
    m.address && !m.private ? ["Copy address", () => copy(m.address, "The address is copied.")] : null,
  ].filter(Boolean);
  if (!items.length) return null;
  const open = S.menuFor === m.id;
  return h("div", { class: "more" + (open ? " open" : "") },
    h("button", { class: "morebtn", type: "button", "aria-label": "More", "aria-haspopup": "menu", "aria-expanded": String(open),
      onclick: (e) => { e.stopPropagation(); S.menuFor = open ? null : m.id; render(); } }, "⋯"),
    open ? h("div", { class: "menu", role: "menu" }, items.map(([label, run]) => h("button", { class: "mi", type: "button", role: "menuitem",
      onclick: (e) => { e.stopPropagation(); S.menuFor = null; render(); run(); } }, label))) : null);
}

function openComposeWindow({ g, title, subject, body, cursor, send, private: priv, edit }) {
  const dialog = { focus: "#body", node: null, files: [] };
  // files (UN-RFC 0027): where the group takes them; said plainly where its node does not.
  // A private post: pictures, encrypted to them (#102, unseenet#497) - if their inbox
  // takes none, the runtime says so when it sends.
  const fg = priv ? { files: { max_size: 4194304 - 40, types: ["image/*"] }, node_files: true } : g;
  const takes = !edit && fg && fg.files, carries = takes && fg.node_files !== false;
  // mention notices (UN-RFC 0032): who would be told, and a box to say no
  const N = { may: !priv && !edit && g && g.type !== "closed", names: [], max: 5,
    on: !(S.sidebar && S.sidebar.notices && S.sidebar.notices.send === false), timer: null };
  let lookup = 0;
  const askWho = () => {
    clearTimeout(N.timer);
    const version = ++lookup;
    if (!N.may) return;
    N.timer = setTimeout(async () => {
      if (S.dialog !== dialog || version !== lookup) return;
      const f = dialog.node.querySelector("form");
      try {
        const r = await api("POST", `/api/groups/${encodeURIComponent(g.id)}/mentioned`, { subject: f.subject.value, body: f.body.value });
        if (S.dialog !== dialog || version !== lookup) return;
        N.may = r.may; N.names = r.names; N.max = r.max || 5;
      } catch (_) { return; }
      const el = dialog.node.querySelector("#notify-who");
      if (el) {
        if (N.may) el.textContent = whoText();
        else { dialog.node.querySelector(".check").remove(); el.remove(); }
      }
    }, 400);
  };
  const whoText = () => !N.names.length ? "" : !N.on ?
    `Nobody is told: ${N.names.join(", ")} see it only if they follow the group.` :
    "Told: " + N.names.slice(0, N.max).join(", ") +
      (N.names.length > N.max ? `  (at most ${N.max}; not told: ${N.names.slice(N.max).join(", ")})` : "");
  const go = async (e) => {
    e && e.preventDefault();
    if (S.dialog !== dialog) return;
    const f = dialog.node.querySelector("form");
    const s = f.subject.value.trim(), b = f.body.value.replace(/\s+$/, "");
    const own = b.split(/\n-- \n/)[0].split("\n").filter(ln => !/^>/.test(ln) && !/ wrote:$/.test(ln)).join("").trim();
    if (!s || (!own && !dialog.files.length)) { toast("Write something of your own above the signature."); return; }
    const files = dialog.files.map(f => ({ name: f.name, data: f.data, alt: f.alt.trim() }));
    if (files.some(f => /^image\//.test(dialog.files.find(x => x.name === f.name).type) && !f.alt) &&
        !window.confirm("A picture without a description: people who cannot see it - a terminal, a screen reader - get only its name. Post anyway?")) return;
    closeDialog();
    await send(s, b, N.may ? N.on : undefined, files);
    toast(edit ? "Saving the new version - postage takes a few seconds." :
      priv ? "Sending - sealed to them." : "Sending - postage takes a few seconds." +
      (N.may && N.on && N.names.length ? ` ${Math.min(N.names.length, N.max)} told in a few minutes.` : ""));
  };
  dialog.node = dialogShell({ label: title, wide: true },
    h("div", { class: "dh" }, h("h2", { text: title }),
      h("button", { class: "btn primary dh-send", onclick: go }, priv ? "Send" : "Post"),   // phones: above the keyboard
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("form", { class: "db", onsubmit: go, onkeydown: (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") go(e); } },
      h("label", { for: "subject", text: "Subject" }),
      h("input", { id: "subject", name: "subject", class: "in", "data-k": "csubject", autocomplete: "off", value: subject, oninput: askWho }),
      h("div", { class: "label-row" }, h("label", { for: "body", text: "Text" }), emojiButton("cbody")),
      h("textarea", { id: "body", name: "body", class: "in compose-body mono", "data-k": "cbody", value: body, spellcheck: "true", oninput: askWho }),
      N.may ? h("label", { class: "check" }, h("input", { type: "checkbox", checked: N.on,
        onchange: (e) => { N.on = e.target.checked; const el = dialog.node.querySelector("#notify-who"); if (el) el.textContent = whoText(); } }),
        " Tell the people you mention (a notice in their inbox)") : null,
      N.may ? h("p", { id: "notify-who", class: "hint", style: "margin:0", text: whoText() }) : null,
      takes ? filePicker(dialog, fg, carries) : null,
      h("p", { class: "hint", style: "margin:0", text: (priv ? "Sealed to them: only they can read it. " :
        "Cut the quote down to what you answer. Signed with your key; a little proof-of-work is added. ") +
        (S.sidebar && S.sidebar.markdown === false ? "Plain text." : "Markdown: *emphasis*, **strong**, `code`, - lists, > quotes, :tada:") })),
    h("div", { class: "df btns" }, h("button", { class: "btn", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn primary", onclick: go }, priv ? "Send" : "Post", h("kbd", { text: "Ctrl S" }))));
  S.dialog = dialog;
  render();
  const ta = dialog.node.querySelector("#body");
  if (ta && cursor != null) { ta.focus(); ta.setSelectionRange(cursor, cursor); ta.scrollTop = 0; }
  askWho();
}

function pendingState(p) {
  if (p.state === "failed") return h("span", { class: "state bad", text: "Not sent: " + (p.error || "") });
  if (p.state === "sent") return h("span", { class: "state" }, svg(ICON.check, 14, 2.5), "sent");
  if (p.state === "reached") return h("span", { class: "state ok" }, svg(ICON.checks, 14, 2.5), "reached the node");
  if (p.state === "queued") return h("span", { class: "sending" }, "Sending …");
  // a brand-new key ripens first, once (UN-RFC 0025): sequential, so t/next_at is exact
  if (p.state === "ripening" && typeof p.fraction === "number") {
    const pct = Math.min(99, Math.round(100 * p.fraction));
    return h("span", { class: "sending", title: "A new key works a few minutes, once, before it can post. " +
                       "That is what keeps throwaway keys from spamming." },
      `Your new key is getting ready · ${pct}%`,
      h("span", { class: "bar determinate" }, h("span", { style: `width:${pct}%` })));
  }
  if (typeof p.fraction !== "number" && S.ripening && S.ripening.level === null && S.ripening.next_at) {
    const pct = Math.min(99, Math.round(100 * S.ripening.t / S.ripening.next_at));
    return h("span", { class: "sending", title: "A new key works a few minutes, once, before it can post. " +
                       "That is what keeps throwaway keys from spamming." },
      `Your new key is getting ready · ${pct}%`,
      h("span", { class: "bar determinate" }, h("span", { style: `width:${pct}%` })));
  }
  // postage progress from the core (#29): the chance it is done by now, never 100% early
  if (typeof p.fraction === "number") {
    const pct = Math.round(p.fraction * 100);
    return h("span", { class: "sending", title: "Postage (proof-of-work) for this message" },
      `Sending · postage ${pct}%`,
      h("span", { class: "bar determinate" }, h("span", { style: `width:${pct}%` })));
  }
  return h("span", { class: "sending" }, "Sending · proof-of-work", h("span", { class: "bar" }, h("span", {})));
}

// ---- key ripening (UN-RFC 0025, #50) ------------------------------------------
// The core ripens the key in the background, segment by segment, and says so with a
// `ripening` event after each one. Here: the level where you are, what it means,
// pause and resume (unseenet#337: only when the core's state has "paused"), and on
// the web "keep this page open" plus a screen wake lock while a new key gets to 0.
const RIPE_TOP = 4;                       // the core ripens up to level 4 (runtime.RIPEN_TO)
const RIPE_STEP = [8, 8, 8, 4];           // next level / this level's threshold (core.ripening.LEVELS)
let ripeSamples = [];                     // [t, ms] at the end of each segment, for a pace

function setRipening(r, fromSegment) {
  const was = S.ripening;
  S.ripening = { ...(was || {}), ...r };
  if (fromSegment) {
    ripeSamples = ripeSamples.filter(([t]) => t < r.t).concat([[r.t, Date.now()]]).slice(-6);
    if (was && r.level !== null && r.level !== was.level) {
      toast(was.level === null ? "Your key is ready: you can post now." : `Your key reached level ${r.level}.`);
    }
  }
  syncWakeLock();
}

function ripeFraction(r) {               // within the level you are at, 0 to 1
  if (!r || !r.next_at) return 1;
  const from = r.level === null ? 0 : r.next_at / RIPE_STEP[r.level];
  return Math.max(0, Math.min(1, (r.t - from) / (r.next_at - from)));
}

function ripeSecondsLeft(r) {            // from this run's own pace; null until two segments are done
  if (!r || !r.next_at || r.paused || ripeSamples.length < 2) return null;
  const [[t0, m0], [t1, m1]] = [ripeSamples[0], ripeSamples[ripeSamples.length - 1]];
  if (t1 <= t0 || m1 <= m0) return null;
  return Math.max(0, (r.next_at - r.t) / ((t1 - t0) / ((m1 - m0) / 1000)));
}

function roughly(sec) {
  if (sec < 90) return "about a minute";
  if (sec < 5400) return `about ${Math.round(sec / 60)} minutes`;
  if (sec < 48 * 3600) return `about ${Math.round(sec / 3600)} hours`;
  return `about ${Math.round(sec / 86400)} days`;
}

function ripeLine() {                     // under your name in the sidebar
  const r = S.ripening;
  if (!r) return null;
  let text;
  if (r.level === null) text = r.available === false ? "Key not ripened" :
    `New key getting ready · ${Math.min(99, Math.round(100 * ripeFraction(r)))}%`;
  else text = `Key level ${r.level}` + (r.level >= RIPE_TOP || !r.next_at ? "" : r.paused ? " · paused" : " · ripening");
  return h("button", { class: "link ripe", title: "What is key ripening?", onclick: openRipening }, text);
}

async function setRipeningPaused(paused) {
  try {
    const r = await api("POST", "/api/ripening", { paused });
    ripeSamples = [];
    setRipening(r, false);
  } catch (err) { toast("Could not change it: " + err.message); }
  render();
}

function openRipening() {
  const para = (t) => h("p", { style: "margin:0", text: t });
  S.dialog = { focus: ".dialog .btn.primary", render: () => {
    const r = S.ripening || {}, web = !!S.state.web;
    const canPause = typeof r.paused === "boolean" && r.available !== false && r.next_at;
    const pct = Math.round(100 * ripeFraction(r)), left = ripeSecondsLeft(r);
    const where = r.level === null ? "Getting ready for level 0" : `Level ${r.level}` +
      (r.next_at ? `, on the way to ${r.level + 1}` : " - fully ripened");
    return dialogShell({ label: "Key ripening" },
      h("div", { class: "dh" }, h("h2", { text: "Key ripening" }), h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
      h("div", { class: "db" },
        h("div", { class: "statuscard" },
          h("div", {}, h("b", { text: where }), r.paused ? h("span", { class: "chip warn", style: "margin-left:8px", text: "paused" }) : null),
          r.next_at ? h("span", { class: "bar determinate" }, h("span", { style: `width:${pct}%` })) : null,
          r.next_at ? h("div", { class: "muted", text: `${pct}%` + (left !== null ? ` · ${roughly(left)} of running time left` : "") }) : null),
        para("Ripening is work your device does to show that your key has been around for a while. " +
          "It costs a throwaway key the same time, which is what keeps spam out without anyone in charge. " +
          "It never signs anything, and only the result is shared."),
        para("Your key can post from level 0. A brand-new key needs about a quarter of an hour to get there. " +
          "Each level after that makes postage - the small proof-of-work on every post - cheaper, and opens groups that ask for a riper key. " +
          `Each level takes about eight times as long as the one before; it goes on up to level ${RIPE_TOP} while Unseenet is open, ` +
          "and carries on next time from where it stopped."),
        web ? para("In the browser it runs only while this page is open. Closing the page loses only the step in progress - " +
          "as long as your vault is saved as a file or kept on this device.") : null,
        canPause ? para("Pause it on a warm phone or when on battery. It stays paused on this device, also after a restart, until you resume it here. " +
          "A post that needs a riper key still waits for what it needs.") : null,
        r.available === false ? h("p", { class: "hint", style: "margin:0",
          text: "This copy of Unseenet cannot ripen keys (chiavdf is missing). Your key can still read, and post where groups ask for no ripening." }) : null),
      h("div", { class: "df btns" },
        canPause ? h("button", { class: "btn", onclick: () => setRipeningPaused(!r.paused) }, r.paused ? "Resume" : "Pause") : null,
        h("button", { class: "btn primary", onclick: closeDialog }, "Close")));
  } };
  render();
}

// On the web the page is the client: closing it, or a phone putting it to sleep, stops
// the ripening of a new key. Ask once, plainly, and keep the screen on where we may.
function ripeningBanner() {
  const r = S.ripening;
  if (!S.state.web || !r || r.level !== null || r.available === false) return null;
  const pct = Math.min(99, Math.round(100 * ripeFraction(r))), left = ripeSecondsLeft(r);
  return h("div", { class: "ripebar", role: "status" },
    r.paused ? h("span", { text: "Getting your new key ready is paused. Your first post will wait for it." }) :
      h("span", {}, h("b", { text: "Keep this page open" }),
        ` while your new key gets ready (${pct}%${left !== null ? ", " + roughly(left) + " left" : ""}). You can read meanwhile.`),
    h("span", { class: "bar determinate" }, h("span", { style: `width:${pct}%` })),
    typeof r.paused === "boolean" && r.paused ? h("button", { class: "btn", onclick: () => setRipeningPaused(false) }, "Resume") : null,
    h("button", { class: "link", onclick: openRipening }, "Why?"));
}

let wakeLock = null, wakeAsking = false;
async function syncWakeLock() {
  const r = S.ripening;
  const want = !!(S.state && S.state.web && r && r.level === null && !r.paused && r.available !== false &&
    document.visibilityState === "visible");
  if (want && !wakeLock && !wakeAsking && navigator.wakeLock) {
    wakeAsking = true;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } catch (_) { wakeLock = null; }         // not allowed here (battery saver, no permission)
    wakeAsking = false;
    if (wakeLock) syncWakeLock();            // ready or paused meanwhile: let it go again
  } else if (!want && wakeLock) {
    const w = wakeLock;
    wakeLock = null;
    w.release().catch(() => {});
  }
}
document.addEventListener("visibilitychange", syncWakeLock);   // the browser drops it when hidden

// ---- chat ---------------------------------------------------------------
function chatView(d) {
  const g = d.group;
  const msgs = d.messages.slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  markRead(msgs);
  const byId = Object.fromEntries(msgs.map(m => [m.id, m]));
  const out = [h("div", { class: "spacer" })];
  let lastDay = null, grp = null;
  const flush = () => { if (grp) out.push(grp.el); grp = null; };
  for (const m of msgs) {
    const d0 = m.date ? new Date(m.date) : null;
    if (d0 && (!lastDay || !sameDay(d0, lastDay))) { flush(); out.push(h("div", { class: "day", text: dayLabel(d0) })); lastDay = d0; }
    const close = grp && grp.key === m.key && d0 && grp.at && d0 - grp.at < 5 * 60000;
    if (!close) {
      flush();
      const col = h("div", { class: "col" });
      if (!m.mine) col.append(h("div", { class: "hd" }, whoEl(m),
        m.bot ? h("span", { class: "hint", text: "bot" }) : null, h("span", { class: "hint", text: when(m.date, false) })));
      else col.append(h("div", { class: "hint", text: when(m.date, false) }));
      grp = { key: m.key, at: d0, col, el: h("div", { class: "mg" + (m.mine ? " mine" : "") }, m.mine ? null : avatar(m, true), col) };
    }
    grp.at = d0 || grp.at;
    const quoted = m.references.length && byId[m.references[m.references.length - 1]];
    const isPost = m.readable && m.kind !== "chat";     // a post among chat lines stands out (UN-RFC 0028)
    grp.col.append(h("div", { class: "bubble" + (isPost ? " is-post" : "") + (m.pinned ? " pinned" : ""), "data-id": m.id,
      title: when(m.date) + (m.encrypted ? " · encrypted" : "") + (m.pinned ? " · pinned" : "") },
      moreMenu(m),
      m.pinned ? h("span", { class: "pinmark", "aria-label": "Pinned", text: PIN + " " }) : null,
      quoted ? h("span", { class: "quote" }, h("span", { class: "mono", text: quoted.who }), " · " + (subjectOf(quoted) || quoted.text.slice(0, 80))) : null,
      isPost ? h("div", { class: "lsub", text: "≡ " + (m.subject || "(no subject)") }) : null,
      m.readable ? (m.markdown ? renderChatLine(m) : linkGroups(m.text)) : h("i", { text: m.error || "Could not be read." }),
      m.readable ? filesOf(m, true) : null,
      reactionBar(m),
      isPost && g.type !== "contact" && mayReply(d, m).allowed && (g.kinds || []).includes("post") ?
        h("div", { class: "lact" }, h("button", { class: "link", onclick: () => openReply(m, g) },
          commenting(d) ? "Comment with a quote" : "Reply with a quote")) : null,
      (g.may_pin && m.readable) || (m.address && !m.private) ? h("div", { class: "lact pinact" },
        g.may_pin && m.readable ? h("button", { class: "link", onclick: () => openPin(m) }, m.pinned ? "Unpin" : "Pin") : null,
        m.address && !m.private ? h("button", { class: "link", onclick: () => copy(m.address, "The line's address is copied.") }, "Copy address") : null) : null));
    if (m.mine) grp.lastMine = m;
  }
  flush();
  const last = out[out.length - 1];
  if (msgs.length && msgs[msgs.length - 1].mine && last.classList && last.classList.contains("mg")) {
    last.querySelector(".col").append(h("div", { class: "state ok" }, svg(ICON.checks, 14, 2.5), "reached the node"));
  }
  const pend = pendingIn(g, msgs, true);
  for (const [job, p] of pend) {
    out.push(h("div", { class: "mg mine", "data-job": job }, h("div", { class: "col" },
      h("div", { class: "bubble " + (p.state === "failed" ? "failed" : "pending"), text: p.text }),
      p.state === "failed" ? h("div", { class: "state bad" }, "Not sent: " + (p.error || ""), " ",
        h("button", { class: "link", onclick: () => { retry(job); } }, "Try again")) : pendingState(p))));
  }
  if (msgs.length === 0 && !pend.length) {
    out.push(h("div", { class: "empty" }, h("h2", { text: "Quiet here" }), h("p", { text: g.type === "contact" || mayWrite(d, "chat").allowed ? "Say hello below." : "" })));
  }
  const cp = g.type === "contact" ? { allowed: true } : mayWrite(d, "chat");
  // files on a chat line (#102, UN-RFC 0028 section 6.1): where the group takes them,
  // and in a chat with a person, whose inbox may (the runtime says so when it does not)
  const takesFiles = g.type === "contact" || (g.files && g.node_files !== false);
  S.chatFiles = S.chatFiles || {};
  const pending = S.chatFiles[g.id] || (S.chatFiles[g.id] = []);
  const send = () => {
    const input = document.querySelector('[data-k="chat"]');
    const text = input.value.trim();
    if (!text && !pending.length) return;
    const files = pending.splice(0).map(f => ({ name: f.name, data: f.data, alt: "" }));
    const shown = text + (files.length ? ` (+ ${files.length} file${files.length > 1 ? "s" : ""})` : "");
    input.value = ""; S.drafts["chat:" + g.id] = "";        // before doSend draws the grey line (#48)
    const more = files.length ? { files } : {};
    if (g.type === "contact") doSend("/api/private", g.id, { key: g.key, body: text, chat: true, ...more }, { text: shown, chat: true });
    else doPost(g.id, { body: text, chat: true, ...more }, { text: shown, chat: true });
  };
  const attach = takesFiles ? [
    h("input", { type: "file", multiple: true, class: "sr", id: "chatfiles",
      accept: g.files && (g.files.types || []).length ? g.files.types.join(",") : "image/*",
      onchange: async (e) => { await readFiles(e.target.files, pending, g.files ? g.files.max_size : 0);
        e.target.value = ""; render(); } }),
    h("label", { for: "chatfiles", class: "btn icon attachbtn", title: "Add pictures to your next line",
      "aria-label": "Add pictures" }, svg(ICON.plus, 18, 2.5))] : [];
  const chips = pending.length ? h("div", { class: "chatfiles" }, pending.map((f, i) => h("span", { class: "chip" },
    h("span", { class: "mono", text: f.name }),
    h("button", { type: "button", class: "link", "aria-label": "Remove " + f.name,
      onclick: () => { pending.splice(i, 1); render(); } }, "×")))) : null;
  return h("div", { class: "content" }, h("section", { class: "chat", "aria-label": "Messages" },
    pinBar(d, msgs),
    h("div", { class: "msgs", "data-scroll": "chat:" + g.id, "data-stick": "bottom" }, out),
    g.type !== "contact" && g.kinds && !g.kinds.includes("chat") ?
      h("div", { class: "chatbar hint", text: mayWrite(d, "post").allowed ?
        "A discussion group: it takes posts with a subject only. N writes one." : mayWrite(d, "post").reason }) :
    cp.allowed ? h("form", { class: "chatbar", onsubmit: (e) => { e.preventDefault(); send(); } },
      h("div", { class: "row" },
        h("label", { for: "chat", class: "sr", text: "Message " + g.label }),
        h("input", { id: "chat", type: "text", "data-k": "chat", autocomplete: "off",
          placeholder: "Message " + (g.access || "") + (g.access ? " " : "") + g.label, value: S.drafts["chat:" + g.id] || "",
          oninput: (e) => { S.drafts["chat:" + g.id] = e.target.value; } }),
        ...attach,
        emojiButton("chat"),
        h("button", { class: "send", type: "submit", "aria-label": "Send" }, svg(ICON.send, 18, 2.5))),
      chips,
      h("div", { class: "hint" }, h("kbd", { text: "Enter" }), " sends · ", h("kbd", { text: "Esc" }), " for shortcuts",
        g.type === "contact" ? " · sealed to them" : g.encrypted ? " · encrypted for the members" : " · signed with your key")) :
      h("div", { class: "chatbar off" }, h("div", { class: "row" },
        h("label", { for: "chat", class: "sr", text: "You cannot write here" }),
        h("input", { id: "chat", type: "text", disabled: true, "aria-describedby": "chat-why", placeholder: cp.reason || NOT_HERE }),
        h("button", { class: "send", type: "button", disabled: true, "aria-label": "Send" }, svg(ICON.send, 18, 2.5))),
        h("div", { class: "hint", id: "chat-why", text: cp.reason || NOT_HERE }))));
}

// ---- posting ------------------------------------------------------------
function doPost(gid, body, local) {
  return doSend(`/api/groups/${encodeURIComponent(gid)}/post`, gid, body, local);
}

// Your own message shows up greyed out at once (#48): it goes into S.pending under a
// local id *before* the request, and moves to the core's job id when the answer comes.
// Job events that beat the HTTP answer over the WebSocket wait in S.early meanwhile.
let localSeq = 0;
async function doSend(path, gid, body, local) {
  const sent = { ...body, kind: body.chat ? "chat" : "post" };     // UN-RFC 0028
  delete sent.chat;
  const id = "local" + (++localSeq);
  const p = S.pending[id] = { group: gid, state: "queued", body, path, ...local };
  render();
  try {
    let r;
    try { r = await api("POST", path, sent); }
    catch (err) {           // a group whose posts are also published outside Tor: ask first
      if (!/portal|outside Tor/i.test(err.message) || !window.confirm(err.message + "\n\nPost anyway?")) throw err;
      r = await api("POST", path, { ...sent, publish_outside_tor: true });
    }
    delete S.pending[id];
    if (p.state === "queued") p.state = "pow";
    S.pending[r.job] = p;
    const early = S.early[r.job] || [];
    delete S.early[r.job];
    for (const e of early) await jobEvent(e, false);
  } catch (err) {
    p.state = "failed"; p.error = err.message;
  }
  render();
}

function retry(job) {
  const p = S.pending[job];
  delete S.pending[job];
  doSend(p.path || `/api/groups/${encodeURIComponent(p.group)}/post`, p.group, p.body, { text: p.text, chat: p.chat, thread: p.thread });
}

// Pending messages to draw in group g: not yet among the group's messages. Once the
// core has said which message it became (`sent`), the real one replaces it - drawn
// once, whichever of `group-updated` and `reached` comes first.
function pendingIn(g, msgs, chat) {
  const have = new Set(msgs.map(m => m.id));
  return Object.entries(S.pending).filter(([, p]) =>
    p.group === g.id && !!p.chat === !!chat && !(p.message_id && have.has(p.message_id)));
}

async function jobEvent(e, draw = true) {                   // a post on its way (section 5)
  const p = S.pending[e.job];
  if (!p) {
    // the answer to our POST may not be here yet: keep it for doSend (only while one is out)
    if (Object.values(S.pending).some(q => q.state === "queued")) (S.early[e.job] = S.early[e.job] || []).push(e);
    return;
  }
  if (e.state === "pow" || e.state === "ripening") {
    const before = p.state + Math.round((p.fraction || 0) * 100);
    p.state = e.state; p.fraction = e.fraction;
    if (draw && p.state + Math.round((e.fraction || 0) * 100) !== before) render();   // at most a hundred redraws
    return;
  }
  p.state = e.state; p.error = e.error;
  if (e.message_id) p.message_id = e.message_id;
  if (e.state === "reached") {
    // keep the grey line until the group has the real one: no gap, no jump
    if (S.gid === p.group) await loadGroup();
    delete S.pending[e.job];
  }
  if (e.state === "failed") toast("Not sent: " + (e.error || "unknown error"));
  if (draw) render();
}

async function toggleView() {
  const g = S.data && S.data.group;
  if (!g || !g.type || g.type === "inbox") return;
  await api("POST", `/api/groups/${encodeURIComponent(g.id)}/view`, { view: nextView(g) });
  await loadGroup(); await loadSidebar();
}

async function copy(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done); }
  catch (_) { toast("Could not copy - select it and press Ctrl C."); }
}

// ---- dialogs ------------------------------------------------------------
function closeDialog() { S.dialog = null; render(); }

// A click outside a dialog closes it only when the click also began outside it,
// so a click that starts on a button, or text you select, never closes it.
let downOnScrim = false;
function dialogShell(props, ...kids) {
  return h("div", { class: "scrim", onmousedown: (e) => { downOnScrim = e.target === e.currentTarget; },
    onclick: (e) => { if (downOnScrim && e.target === e.currentTarget) closeDialog(); downOnScrim = false; } },
    h("div", { class: "dialog" + (props.wide ? " wide" : ""), role: "dialog", "aria-modal": "true", "aria-label": props.label }, kids));
}

function openKey() {
  const me = S.state.me;
  S.dialog = { focus: ".dialog .btn.primary", render: () => dialogShell({ label: "Your key" },
    h("div", { class: "dh" }, h("h2", { text: "Your key" }), h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db" },
      h("p", { style: "margin:0", text: "Share it to get private messages and invitations to closed groups. It is safe to share: it is the public half." }),
      h("div", { class: "keybox", text: me.key }),
      h("p", { class: "hint", style: "margin:0", text: "Fingerprint " + me.fp + " - others see it after your name until they add you as a contact." })),
    h("div", { class: "df btns" }, h("button", { class: "btn primary", onclick: () => copy(me.key, "Your key is copied.") }, "Copy key"))) };
  render();
}

// What Unseenet is, in plain words. The text is the core's (unseenet.core.about),
// the same as the TUI's F1, so every client says the same. Works before unlocking too.
let ABOUT = null;
async function openAbout() {
  if (!ABOUT) {
    try { ABOUT = await api("GET", "/api/about"); }
    catch (err) { toast("Could not load the about text: " + err.message); return; }
  }
  const a = ABOUT;
  const para = (t) => h("p", { style: "margin:0", text: t });
  const head = (t) => h("h3", { class: "about-h", text: t });
  S.dialog = { focus: ".dialog .btn.primary", render: () => dialogShell({ label: "About Unseenet", wide: true },
    h("div", { class: "dh" }, logo(26), h("h2", { text: "About Unseenet" }),
      h("span", { class: "muted mono", style: "font-size:12px", text: a.version }),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db about" },
      h("p", { class: "about-tag", text: a.tagline }),
      a.sections.map(s => [head(s.title), s.paragraphs.map(para)]),
      head(a.comparisons.title),
      h("p", { class: "muted", style: "margin:0", text: a.comparisons.intro }),
      h("dl", { class: "about-cmp" }, a.comparisons.items.map(c => [h("dt", { text: c.name }), h("dd", { text: c.text })])),
      h("div", { class: "about-status" }, head(a.status.title), a.status.paragraphs.map(para))),
    h("div", { class: "df btns" },
      h("button", { class: "btn", onclick: () => openLink(a.links.source) }, "GitHub"),
      h("button", { class: "btn primary", onclick: () => openLink(a.links.docs) }, "Documentation"))) };
  render();
}

function openInfo() {
  const g = S.data && S.data.group;
  if (!g || !g.type) return;
  S.dialog = { render: () => dialogShell({ label: "About this group" },
    h("div", { class: "dh" }, h("h2", { class: "mono", text: g.label }), h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db" },
      g.title ? h("p", { style: "margin:0", text: g.title }) : null,
      g.description ? h("p", { class: "muted", style: "margin:0", text: g.description }) : null,
      h("dl", { class: "kv" },
        h("dt", { text: "Type" }), h("dd", { text: g.type + (g.local ? ", local (one node)" : "") }),
        h("dt", { text: "Shown as" }), h("dd", { text: g.view + (g.owner_view !== g.view ? ` (the owner chose ${g.owner_view})` : "") }),
        h("dt", { text: "Takes" }), h("dd", { text: (g.kinds || []).length === 1 ?
          (g.kinds[0] === "post" ? "posts with a subject only (a discussion group)" : "chat lines only (a chat group)") :
          "posts and chat lines" }),
        h("dt", { text: "Delivery" }), h("dd", { text: g.fast ? "fast: nodes pass it on at once" : "normal: nodes wait a random time" }),
        h("dt", { text: "Owner" }), h("dd", { text: g.owner ? "you" : "the key after @ in the ID" }),
        h("dt", { text: "ID" }), h("dd", { class: "mono", text: g.id }),
        g.address ? [h("dt", { text: "Address" }), h("dd", { class: "mono", text: g.address })] : null),
      g.rules ? [h("h3", { style: "margin:4px 0 0;font-size:14px", text: "Rules" }),
        g.rules_markdown ? h("div", { class: "md rules" }, renderTree(g.rules_tree || []))
          : h("p", { class: "text", style: "margin:0", text: g.rules })] : null,
      g.members && g.members.length ? [h("h3", { style: "margin:4px 0 0;font-size:14px", text: `Members (${g.members.length})` }),
        g.members.map(m => h("div", { class: "member" }, h("span", { class: `av xs c${m.colour}`, text: initials(m.label) }),
          h("span", { class: "mono", text: m.label }),
          g.owner && m.key !== (S.state.me || {}).key ? h("button", { class: "link", style: "margin-left:auto",
            onclick: () => removeMember(g, m) }, "Remove") : null))] : null,
      (g.moderators || []).length ? [h("h3", { style: "margin:4px 0 0;font-size:14px", text: "Moderators" }),
        h("p", { class: "muted", style: "margin:0", text: g.moderators.map(p => p.label).join(", ") })] : null,
      (g.posters || []).length ? [h("h3", { style: "margin:4px 0 0;font-size:14px", text: "Posters" }),
        h("p", { class: "muted", style: "margin:0", text: g.posters.map(p => p.label).join(", ") })] : null),
    // what you can do here: everyone may leave; the owner has the group's tools (as the TUI's Ctrl+P)
    h("div", { class: "df btns wrap" },
      g.owner && g.type === "closed" ? h("button", { class: "btn", onclick: openInvite }, "Invite someone") : null,
      g.owner ? h("button", { class: "btn", onclick: openEditGroup }, "Edit group") : null,
      g.owner && g.type !== "closed" ? h("button", { class: "btn", onclick: openRoles }, "Moderators and posters") : null,
      g.owner ? h("button", { class: "btn", onclick: () => openBanned() }, `Banned (${(g.banned || []).length})`) : null,
      g.owner ? h("button", { class: "btn danger", onclick: openRemoveGroup }, "Remove group") : null,
      h("span", { class: "grow" }),
      g.address ? h("button", { class: "btn", onclick: () => copy(g.address, "The group's address is copied.") }, "Copy address") : null,
      g.type === "contact" ? [
        g.contact ? h("button", { class: "btn", onclick: () => { closeDialog(); removeContact(g.key, g.label.replace(/ √$/, "")); } }, "Remove contact") : null,
        h("button", { class: "btn", onclick: () => closeChat(g.key, g.label.replace(/ √$/, "")) }, "Close chat")] :
      g.id !== FOR_YOU ? h("button", { class: "btn", onclick: () => leaveGroup(g) }, "Unsubscribe") : null)) };
  render();
}

// ---- the owner's and moderators' tools (the TUI's Ctrl+P) ----------------------
async function leaveGroup(g) {
  await api("POST", "/api/subscribe", { id: g.id, on: false });
  closeDialog(); S.gid = null; S.data = null; await loadSidebar();
  toast("You no longer follow " + g.label + ". G finds it again.");
}

function openEditGroup() {
  const g = S.data && S.data.group;
  if (!g || !g.owner) return;
  let view = g.owner_view || g.view, kinds = (g.kinds || []).length === 1 ? g.kinds[0] : "both";
  let files = fileChoice(g.files);
  // reactions (UN-RFC 0048 section 4): the view's default, none, any, or your own set
  const rset = (g.reactions && g.reactions.setting) || "default";
  let reacts = Array.isArray(rset) ? "own" : rset;
  const pick = (name, value, current, label, small) => h("button", { type: "button", class: "choice", "aria-pressed": String(current === value),
    onclick: () => { if (name === "kinds") kinds = value; else if (name === "files") files = value;
      else if (name === "reactions") reacts = value; else view = value; redrawDialog(); } },
    h("span", {}, h("span", { text: label }), h("small", { text: small })));
  formDialog({ label: "Edit group", title: "Edit " + g.label, focus: "#etitle", button: "Save",
    values: { title: g.title || "", description: g.description || "", rules: g.rules || "",
      reaction_set: Array.isArray(rset) ? rset.join(" ") : "",
      // Markdown if the rules already are, or - for new rules - if you write posts in Markdown
      markdown: g.rules ? !!g.rules_markdown : !(S.sidebar && S.sidebar.markdown === false) },
    note: "Saved as a new version of the group's manifest, signed with your key and sent to your node. The type, owner and ID cannot change.",
    fields: (vals) => [
      h("label", { for: "etitle", text: "Title" }),
      h("input", { id: "etitle", name: "title", class: "in", "data-k": "etitle", value: vals.title }),
      h("label", { for: "edesc", text: "Description" }),
      h("input", { id: "edesc", name: "description", class: "in", "data-k": "edesc", value: vals.description }),
      h("label", { text: "Shown as" }),
      h("div", { class: "choices row" }, pick("view", "threads", view, "≡ Threads", "posts and replies"), pick("view", "chat", view, "» Chat", "messages in order")),
      h("label", { text: "Takes" }),
      h("div", { class: "choices row" },
        pick("kinds", "both", kinds, "Both", "posts and chat lines"),
        pick("kinds", "post", kinds, "≡ Posts only", "a discussion group"),
        pick("kinds", "chat", kinds, "» Chat lines only", "a chat group")),
      h("label", { text: "Files" }),
      h("div", { class: "choices row" }, FILE_PICKS.map(([v, l, s]) => pick("files", v, files, l, s)),
        files === "custom" ? pick("files", "custom", files, "As it is now", "limits set elsewhere") : null),
      h("label", { text: "Reactions" }),
      h("div", { class: "choices row" },
        pick("reactions", "default", reacts, "As the view has them", "feeds, chat: 👍 👎 ❤️ 😂 😮 😢; discussion: none"),
        pick("reactions", "none", reacts, "None", "no likes here"),
        pick("reactions", "any", reacts, "Any emoji", "the six first"),
        pick("reactions", "own", reacts, "Your own", "up to 12, below")),
      reacts === "own" ? h("input", { id: "ereacts", name: "reaction_set", class: "in", "data-k": "ereacts",
        "aria-label": "Your own reactions", placeholder: "e.g. 🎉 ❤️ 👏", value: vals.reaction_set }) : null,
      h("label", { for: "erules", text: "Rules - shown to people before they post" }),
      h("textarea", { id: "erules", name: "rules", class: "in", "data-k": "erules", style: "min-height:110px", value: vals.rules }),
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "markdown", checked: !!vals.markdown }),
        " Markdown: # headings, - lists, **strong**, [links](https://…), :tada: (no pictures)")],
    submit: async (v) => {
      const rules = v.rules.trim();
      await api("POST", `/api/groups/${encodeURIComponent(g.id)}/settings`,
        { title: v.title.trim(), description: v.description.trim(), rules,
          rules_type: v.markdown && rules ? MARKDOWN : null, view, kinds,
          reactions: reacts === "own" ? [...new Set((v.reaction_set || "").split(/[\s,]+/).filter(Boolean))] : reacts,
          ...(files !== "custom" ? { files } : {}) });
      closeDialog(); toast("The group is updated."); await loadGroup(); await loadSidebar();
    } });
}

function openRemoveGroup() {
  const g = S.data && S.data.group;
  if (!g || !g.owner) return;
  formDialog({ label: "Remove group", title: "Remove " + g.label + " from the network", focus: "#rconfirm", button: "Remove for good",
    note: "Every node is asked to delete the group and all its posts. This cannot be undone, and nodes that ignore it may keep a copy.",
    fields: (vals) => [
      h("label", { for: "rreason", text: "Why (optional, shown to the nodes)" }),
      h("input", { id: "rreason", name: "reason", class: "in", "data-k": "rreason", value: vals.reason || "" }),
      h("label", { for: "rconfirm", text: 'Type "remove" to confirm' }),
      h("input", { id: "rconfirm", name: "confirm", class: "in mono", "data-k": "rconfirm", value: vals.confirm || "", autocomplete: "off" })],
    submit: async (v) => {
      if ((v.confirm || "").trim().toLowerCase() !== "remove") throw new Error('Type "remove" to confirm.');
      toast("Removing - proof-of-work takes a moment …");
      await api("POST", `/api/groups/${encodeURIComponent(g.id)}/remove`, { confirm: "remove", reason: (v.reason || "").trim() });
      closeDialog(); S.gid = null; S.data = null; await loadSidebar(); toast(g.label + " is removed.");
    } });
}

// A list of people with a role (moderators, posters) or a ban, and a way to add one.
function peopleDialog({ title, note, list, add, remove, addLabel, removeLabel, reason }) {
  let err = "", key = "", why = "";
  S.dialog = { focus: "#pkey", render: () => dialogShell({ label: title, wide: true },
    h("div", { class: "dh" }, h("h2", { text: title }), h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db list" },
      note ? h("p", { class: "hint", style: "margin:0 0 6px", text: note }) : null,
      list().length ? list().map(p => h("div", { class: "cmd" },
        h("span", { class: `av xs c${p.colour}`, "aria-hidden": "true", text: initials(p.label) }),
        h("span", { class: "nm" }, h("span", { text: p.label }), p.reason ? h("small", { text: " - " + p.reason }) : null),
        h("button", { class: "btn", onclick: async () => {
          try { await remove(p.key); await loadGroup(); render(); } catch (x) { err = x.message; render(); } } }, removeLabel))) :
        h("p", { class: "muted", style: "padding:8px 0", text: "Nobody yet." }),
      err ? h("p", { class: "error", text: err }) : null,
      h("form", { class: "row", style: "gap:8px;margin-top:8px", onsubmit: async (e) => {
          e.preventDefault();
          try { await add(recipient(key), why); key = ""; why = ""; err = ""; await loadGroup(); render(); }
          catch (x) { err = x.message; render(); } } },
        h("input", { id: "pkey", class: "in", "data-k": "pkey", list: "pcontacts", value: key, placeholder: "a contact's name, or a key",
          oninput: (e) => { key = e.target.value; }, autocomplete: "off" }),
        h("datalist", { id: "pcontacts" }, contactList().map(c => h("option", { value: c.label }))),
        reason ? h("input", { class: "in", "data-k": "pwhy", value: why, placeholder: "why (optional)", oninput: (e) => { why = e.target.value; } }) : null,
        h("button", { class: "btn primary", type: "submit" }, addLabel))),
    h("div", { class: "df" }, h("span", { text: "Changes are a new version of the manifest, signed by you" }), h("span", { text: "Esc close" }))) };
  render();
}

function openRoles() {
  const g = S.data && S.data.group;
  if (!g || !g.owner) return;
  const path = `/api/groups/${encodeURIComponent(g.id)}/role`;
  let role = g.type === "channel" ? "posters" : "moderators";
  peopleDialog({ title: (g.type === "channel" ? "Posters" : "Moderators") + " in " + g.label,
    note: g.type === "channel" ? "Posters may write in your channel." :
      g.type === "moderated" ? "Moderators approve posts (To approve in the sidebar) and may withdraw any post." :
      "Moderators may withdraw any post in the group.",
    list: () => (S.data.group[role] || []),
    add: (key) => api("POST", path, { role, key, on: true }),
    remove: (key) => api("POST", path, { role, key, on: false }),
    addLabel: g.type === "channel" ? "Make poster" : "Make moderator", removeLabel: "Remove" });
}

function openBanned(prefill = "") {
  const g = S.data && S.data.group;
  if (!g || !g.owner) return;
  const path = `/api/groups/${encodeURIComponent(g.id)}/ban`;
  peopleDialog({ title: "Banned from " + g.label, reason: true,
    note: "Banned keys cannot post here. Nodes refuse their posts; the ban and the reason are public in the manifest.",
    list: () => (S.data.group.banned || []),
    add: (key, reason) => api("POST", path, { key, on: true, reason }),
    remove: (key) => api("POST", path, { key, on: false }),
    addLabel: "Ban", removeLabel: "Lift ban" });
  if (prefill) setTimeout(() => { const i = document.getElementById("pkey"); if (i) { i.value = prefill; i.dispatchEvent(new Event("input")); } });
}

// The moderation queue: posts sent to groups you moderate, waiting for you.
function openModeration() {
  let list = null, err = "", at = 0, reason = "";
  const load = () => api("GET", "/api/moderation").then(r => { const l = r.waiting.map(s => ({ ...s, text: s.body, markdown: isMd(s.content_type) })); list = l; at = Math.min(at, Math.max(0, l.length - 1)); if (S.dialog) render(); })
    .catch(e => { err = e.message; if (S.dialog) render(); });
  load();
  const act = async (approve) => {
    const s = list[at];
    try {
      await api("POST", "/api/moderation", { id: s.id, approve, reason });
      toast(approve ? "Approved and posted." : "Rejected."); reason = "";
      await load(); await loadSidebar();
    } catch (x) { err = x.message; render(); }
  };
  S.dialog = { render: () => {
    const s = list && list[at];
    return dialogShell({ label: "To approve", wide: true },
      h("div", { class: "dh" }, h("h2", { text: "To approve" + (list ? ` (${list.length})` : "") }), h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
      h("div", { class: "db" },
        err ? h("p", { class: "error", text: err }) : null,
        list === null ? h("p", { class: "muted", text: "Fetching your inbox …" }) :
        !s ? h("p", { class: "muted", text: "Nothing waiting. Posts sent to groups you moderate show up here." }) : [
          h("p", { class: "hint", style: "margin:0", text: `${at + 1} of ${list.length} · in ${s.group_label} · from ${s.who}` }),
          h("h3", { style: "margin:4px 0", text: s.subject || "(no subject)" }),
          h("div", { class: "pbody", style: "margin:0;max-height:40vh;overflow:auto" }, messageBody({ ...s, readable: true })),
          h("input", { class: "in", "data-k": "mreason", value: reason, placeholder: "Why not (optional, sent to them if you reject)",
            oninput: (e) => { reason = e.target.value; } })]),
      s ? h("div", { class: "df btns" },
        list.length > 1 ? h("button", { class: "btn", onclick: () => { at = (at + 1) % list.length; reason = ""; render(); } }, "Next") : null,
        h("span", { class: "grow" }),
        h("button", { class: "btn", onclick: () => act(false) }, "Reject"),
        h("button", { class: "btn primary", onclick: () => act(true) }, "Approve")) : null);
  } };
  render();
}

// ---- names (UN-RFC 0019): the TUI's @ and its Ctrl+P name tools, in one dialog -------
function openNames() {
  let data = null, err = "", msg = "", claim = "", ask = "", give = "", giveTo = "", years = 1, busy = false;
  const load = () => api("GET", "/api/names").then(d => { data = d; if (S.dialog) render(); })
    .catch(e => { err = e.message; if (S.dialog) render(); });
  load();
  const act = async (body, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    busy = true; err = ""; render();
    try { const r = await api("POST", "/api/names", body); msg = r.text; await load(); await loadSidebar(); }
    catch (x) { err = x.message; }
    busy = false; render();
  };
  const when = (iso) => { try { return new Date(iso).toLocaleDateString(); } catch (_) { return iso; } };
  const sect = (t) => h("h3", { style: "margin:12px 0 4px;font-size:14px", text: t });
  S.dialog = { focus: "#nclaim", render: () => dialogShell({ label: "Names", wide: true },
    h("div", { class: "dh" }, h("h2", { text: "Names" }), h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db" },
      err ? h("p", { class: "error", text: err }) : null,
      msg ? h("p", { class: "hint", style: "margin:0", text: msg }) : null,
      data === null ? h("p", { class: "muted", text: "Reading the registrar over Tor …" }) : [
        sect("Your names"),
        data.mine.length ? data.mine.map(n => h("div", { class: "cmd" },
          h("span", { class: "nm" }, h("span", { class: "mono", text: n.text }),
            h("small", { text: ` ${n.kind}, until ${when(n.expires)}${n.primary && data.mine.length > 1 ? " · your posts show this one" : ""}` })),
          !n.primary ? h("button", { class: "btn", onclick: () => act({ action: "primary", name: n.name }) }, "Show on my posts") : null,
          n.kind !== "sub" ? h("button", { class: "btn", onclick: () => act({ action: "renew", name: n.name }) }, "Renew") : null,
          n.kind !== "sub" ? h("button", { class: "btn", onclick: () => {
            const to = window.prompt(`Transfer @${n.name} to which key? (ed25519:…) Your own key loses it.`);
            if (to) act({ action: "transfer", name: n.name, to: to.trim() }); } }, "Transfer") : null,
          n.kind !== "sub" ? h("button", { class: "btn danger", onclick: () => act({ action: "release", name: n.name },
            `Release @${n.name}? You give it up at once; others can then claim it.`) }, "Release") : null)) :
          h("p", { class: "muted", style: "margin:0", text: "No names yet. A name like @you shows on your posts instead of your key." }),
        data.pending.length ? data.pending.map(p => h("p", { class: "hint", style: "margin:2px 0",
          text: `${p.action} ${p.name}: sent ${when(p.sent)}, waiting for ${p.action === "ask" ? "its holder" : "the registrar (about an hour)"}` })) : null,
        h("form", { class: "row", style: "gap:8px;margin-top:6px", onsubmit: (e) => { e.preventDefault();
            const name = claim.trim().replace(/^@/, "");
            if (!name) return;
            const domain = name.includes(".");
            act({ action: "claim", name }, domain ? `Claim ${name}? The registrar looks for a DNS TXT record first:\n\n_unseenet.${name}  TXT  "${data.dns_value}"\n\nAdd it at your DNS provider, then claim. Keep it there.` : null); } },
          h("input", { id: "nclaim", class: "in", "data-k": "nclaim", value: claim, placeholder: "claim a name: lorensen, or a domain you own",
            oninput: (e) => { claim = e.target.value; }, autocomplete: "off" }),
          h("button", { class: "btn primary", type: "submit", disabled: busy }, "Claim")),
        sect("A name under someone else's"),
        h("form", { class: "row", style: "gap:8px", onsubmit: (e) => { e.preventDefault(); if (ask.trim()) act({ action: "ask", name: ask.trim() }); } },
          h("input", { class: "in", "data-k": "nask", value: ask, placeholder: "e.g. sonia@lorensen - its holder decides",
            oninput: (e) => { ask = e.target.value; }, autocomplete: "off" }),
          h("button", { class: "btn", type: "submit", disabled: busy }, "Ask")),
        h("p", { class: "hint", style: "margin:2px 0 0", text: "Every name on one identity links it to the others: use another identity for a part of your life you keep apart." }),
        data.parents.length ? [
          sect("Names under yours (" + data.parents.map(p => "@" + p).join(", ") + ")"),
          data.requests.map(r => h("div", { class: "cmd" },
            h("span", { class: "nm" }, h("span", { class: "mono", text: r.name }), h("small", { text: " asked for by " + r.who })),
            h("button", { class: "btn primary", onclick: () => act({ action: "approve", id: r.id }) }, "Give"),
            h("button", { class: "btn", onclick: () => act({ action: "refuse", id: r.id }) }, "Say no"))),
          data.given.map(g => h("div", { class: "cmd" },
            h("span", { class: "nm" }, h("span", { class: "mono", text: g.name }), h("small", { text: ` ${g.who}, until ${when(g.expires)}` })),
            h("button", { class: "btn", onclick: () => act({ action: "revoke", name: g.name }, `Take ${g.name} back?`) }, "Take back"))),
          h("form", { class: "row", style: "gap:8px;margin-top:6px", onsubmit: (e) => { e.preventDefault();
              try { const key = recipient(giveTo); if (give.trim()) act({ action: "give", name: give.trim(), key, years }); }
              catch (x) { err = x.message; render(); } } },
            h("input", { class: "in", "data-k": "ngive", value: give, placeholder: `sonia@${data.parents[0]}`,
              oninput: (e) => { give = e.target.value; }, autocomplete: "off" }),
            h("input", { class: "in", "data-k": "ngiveto", value: giveTo, list: "ncontacts", placeholder: "to: a contact or a key",
              oninput: (e) => { giveTo = e.target.value; }, autocomplete: "off" }),
            h("datalist", { id: "ncontacts" }, contactList().map(c => h("option", { value: c.label }))),
            h("select", { class: "in", style: "width:auto", onchange: (e) => { years = +e.target.value; } },
              [1, 2, 5].map(y => h("option", { value: y, selected: y === years ? "" : null, text: y + (y === 1 ? " year" : " years") }))),
            h("button", { class: "btn", type: "submit", disabled: busy }, "Give"))] : null]),
    h("div", { class: "df" }, h("span", { class: "mono", text: data ? data.key.slice(0, 28) + "…" : "" }), h("span", { text: "Esc close" }))) };
  render();
}

// ---- ignoring people: your own killfile, never sent anywhere (#72) ----------------
async function ignorePerson(key, label, on = true) {
  await api("POST", "/api/ignore", { key, label, on });
  toast(on ? `${label} is ignored: you no longer see their posts.` : `You see ${label} again.`);
  await loadGroup(); await loadSidebar();
}

function openIgnored() {
  let list = null;
  const load = () => api("GET", "/api/ignore").then(r => { list = r.ignored; if (S.dialog) render(); });
  load();
  S.dialog = { render: () => dialogShell({ label: "People you ignore", wide: true },
    h("div", { class: "dh" }, h("h2", { text: "People you ignore" }), h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db list" },
      list === null ? h("p", { class: "muted", text: "…" }) :
      list.length ? list.map(p => h("div", { class: "cmd" }, h("span", { class: "nm", text: p.label }),
        h("button", { class: "btn", onclick: async () => { await ignorePerson(p.key, p.label, false); await load(); } }, "Stop ignoring"))) :
        h("p", { class: "muted", style: "padding:8px 0", text: "Nobody. Ignore someone from one of their posts; only you know." })),
    h("div", { class: "df" }, h("span", { text: "Kept in your vault, never sent anywhere" }), h("span", { text: "Esc close" }))) };
  render();
}

// ---- blocking in a hierarchy you maintain (UN-RFC 0018, 5.4) ------------------------
function openBlock(m) {
  const g = S.data && S.data.group;
  if (!g || !g.maintainer || !m) return;
  formDialog({ label: "Block in hierarchy", title: "Block " + m.who, focus: "#breason", button: "Block",
    note: "As a maintainer you block them in your whole hierarchy, also in groups you do not own. The block and its reason are public in your hierarchy list. For illegal content, threats and the like.",
    fields: (vals) => [h("label", { for: "breason", text: "Why (required, public)" }),
      h("input", { id: "breason", name: "reason", class: "in", "data-k": "breason", value: vals.reason || "" })],
    submit: async (v) => {
      if (!(v.reason || "").trim()) throw new Error("Give a reason: it is public, so others can see why.");
      const { hierarchy } = await api("POST", `/api/groups/${encodeURIComponent(g.id)}/block`, { key: m.key, reason: v.reason.trim() });
      closeDialog(); await loadGroup(); render(); toast(`${m.who} is blocked in ${hierarchy}.*`);
    } });
}

// Your state (UN-RFC 0044 section 7.4, as the TUI's Your state): kept in the network,
// encrypted for your key alone (the default), or on this device only.
function openStateWhere() {
  const local = !!(S.sidebar && S.sidebar.state_local);
  confirmDialog({ title: "Your state", danger: !local, button: local ? "Keep in the network" : "Keep on this device only",
    text: "Your groups, the people you follow, contacts, settings and what you have read are kept in the network, " +
      "encrypted so only your key can read them - so a new stick or phone with your key looks the same after one fetch. " +
      "Nodes see only a block of fixed size.\n\n" +
      (local ? "Now they are kept on this device only. Keep them in the network again?"
        : "Keep them on this device only instead, for an identity that should leave no trace of activity at all - " +
          "not even an encrypted one? What is in the network now is removed."),
    ok: async () => {
      try { await api("POST", "/api/settings", { state_local: !local }); }
      catch (x) { toast("Not changed: " + x.message); return; }
      closeDialog(); await loadSidebar(); render();
      toast(local ? "Your state is kept in the network again, from the next sync." : "Your state is kept on this device only.");
    } });
}

async function toggleBots() {
  const on = !(S.sidebar && S.sidebar.hide_bots);
  await api("POST", "/api/settings", { hide_bots: on });
  await loadSidebar(); await loadGroup(); render();
  toast(on ? "Posts by bots are hidden." : "You see bots again, marked bot.");
}

async function togglePictures() {
  const on = !(S.sidebar && S.sidebar.pictures !== false);
  await api("POST", "/api/settings", { pictures: on });
  PEOPLE.clear();
  await loadSidebar(); render();
  toast(on ? "People's pictures are shown." : "Identicons only: pictures are not fetched or shown.");
}

async function toggleShowBlocked() {
  const on = !(S.sidebar && S.sidebar.show_blocked);
  await api("POST", "/api/settings", { show_blocked: on });
  await loadSidebar(); await loadGroup(); render();
  toast(on ? "You see posts blocked by maintainers, marked." : "Posts blocked by maintainers are hidden.");
}

async function removeMember(g, m) {
  if (!window.confirm(`Remove ${m.label} from ${g.label}? The others get a new key; ${m.label} keeps what they already read.`)) return;
  await api("POST", `/api/groups/${encodeURIComponent(g.id)}/members/remove`, { key: m.key });
  await loadGroup(); render(); toast(m.label + " is removed.");
}

// Withdraw a post (D): yours, or any in a group you own or moderate (UN-RFC 0004, 7).
function openWithdraw(m) {
  const gid = m && (m.group || (S.data && S.data.group && S.data.group.id));
  if (!gid || !m || !m.may_withdraw) return;
  const what = m.kind === "chat" ? (m.depth ? "comment" : "chat line") : "post";
  formDialog({ label: "Withdraw " + what, title: "Withdraw “" + subjectOf(m) + "”", focus: ".dialog .btn.primary", button: "Withdraw",
    note: "Every node is asked to delete it. People who read it already keep their copy, and nodes or programs that ignore withdrawals can keep it.",
    fields: () => [h("p", { style: "margin:0", text: m.mine ? `Your ${what}.` : `A ${what} by ${m.who}.` })],
    submit: async () => {
      await api("POST", `/api/groups/${encodeURIComponent(gid)}/withdraw`, { id: m.id });
      closeDialog(); S.post = null; await loadGroup(); render(); toast("Withdrawn.");
    } });
}

// Report a post to the people who can act on it (#74).
function openReport(m) {
  const g = S.data && S.data.group;
  if (!g || !m) return;
  let targets = null, err = "", dialog = null;
  const chosen = new Set();
  // the form is kept on screen (#85): it is built again when the list arrives
  api("GET", `/api/groups/${encodeURIComponent(g.id)}/report?id=${encodeURIComponent(m.id)}`)
    .then(r => { const t = r.targets; targets = t; t.forEach(x => chosen.add(x.i)); })
    .catch(e => { err = e.message; })
    .then(() => { if (dialog) dialog.refresh(); });
  dialog = formDialog({ label: "Report post", title: "Report “" + subjectOf(m) + "”", focus: "#rnote", button: "Report",
    note: "For posts that break the group's rules or the law. In an emergency, contact the police: nobody on Unseenet can see who anyone is.",
    fields: (vals) => [
      targets === null ? h("p", { class: "muted", text: err || "Finding who can act on it …" }) :
        targets.map(t => h("label", { class: "check" }, h("input", { type: "checkbox", checked: chosen.has(t.i),
          onchange: (e) => { if (e.target.checked) chosen.add(t.i); else chosen.delete(t.i); } }), " " + t.who)),
      h("label", { for: "rnote", text: "What is wrong with it? (optional)" }),
      h("input", { id: "rnote", name: "note", class: "in", "data-k": "rnote", value: vals.note || "" }),
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "anonymous", checked: !!vals.anonymous }),
        " Anonymous - they cannot see who reported it or answer you")],
    submit: async (v) => {
      if (!chosen.size) throw new Error("Choose at least one.");
      const { sent } = await api("POST", `/api/groups/${encodeURIComponent(g.id)}/report`,
        { id: m.id, targets: [...chosen], note: (v.note || "").trim(), anonymous: !!v.anonymous });
      closeDialog(); toast(`Reported to ${sent}.`);
    } });
}

async function openCompose() {
  const g = S.data && S.data.group;
  if (g && g.type === "contact") { openPost(g.key, g.label.replace(/ √$/, "")); return; }   // N in a chat: a post
  if (!g || !g.type || g.type === "inbox") return;
  if (g.kinds && !g.kinds.includes("post")) { toast("A chat group: it takes chat lines only."); return; }
  const may = mayWrite(S.data, "post");
  if (!may.allowed) { if (may.reason) toast(may.reason); return; }    // N says why, as the button does
  const sig = await signatureText();
  openComposeWindow({ g, title: "New post in " + g.label, subject: "", cursor: 0,
    body: "\n\n" + (sig ? "-- \n" + sig + "\n" : ""),
    send: (subject, text, notify, files) => doPost(g.id, { subject, body: text, signature: false, notify,
      ...(files && files.length ? { files } : {}) }, { text }) });
  setTimeout(() => { const s = document.getElementById("subject"); if (s) s.focus(); });
}

function openBrowse() {
  let list = null, filter = "", err = "";
  api("GET", "/api/browse").then(r => { list = r.groups.map(fromGroup); if (S.dialog) render(); }).catch(e => { err = e.message; if (S.dialog) render(); });
  S.dialog = { focus: "#browse", render: () => {
    const shown = (list || []).filter(g => !filter || (g.label + " " + g.description).toLowerCase().includes(filter));
    return dialogShell({ label: "Groups on your node", wide: true },
      h("div", { class: "dh" }, svg(ICON.search, 18),
        h("label", { for: "browse", class: "sr", text: "Filter groups" }),
        h("input", { id: "browse", "data-k": "browse", placeholder: "Groups on your nodes …", value: filter,
          oninput: (e) => { filter = e.target.value.toLowerCase(); render(); } }),
        h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
      h("div", { class: "db list", "data-scroll": "browse" },
        err ? h("p", { class: "error", text: err }) : null,
        list === null && !err ? h("p", { class: "muted", style: "padding:12px", text: "Asking your nodes over Tor …" }) : null,
        shown.map(g => h("div", { class: "cmd" },
          h("span", { class: "mono muted", style: "width:28px", text: (g.access || "") + g.icon }),
          h("span", { class: "nm" }, h("span", { class: "mono", text: g.label }), " ", h("small", { text: g.description })),
          h("button", { class: g.subscribed ? "btn" : "btn primary", "data-k": "sub:" + g.id, onclick: async (e) => {
            e.stopPropagation();          // Follow and Leave stay in the list, as in the terminal client
            try { await api("POST", "/api/subscribe", { id: g.id, on: !g.subscribed }); }
            catch (x) { toast(x.message); return; }
            g.subscribed = !g.subscribed; await loadSidebar(); } }, g.subscribed ? "Leave" : "Follow")))),
      h("div", { class: "df" }, h("span", { text: (list ? list.length : 0) + " groups" }), h("span", { text: "Esc close" })));
  } };
  render();
}

// A form in a dialog. Built once and kept on screen while the page behind it redraws
// (#85), as the compose window is (#47): rebuilding it on every redraw lost a resized
// text area, the scroll and undo in a field, and text typed in between. The dialog is
// built again only when it says so - ``refresh()`` on what this returns, for fields that
// change (a list that arrives, a choice that shows more) - and an error is written into
// it, not drawn anew.
// A choice in a form dialog shows as chosen: the dialog is built again with what was
// typed kept (render() alone keeps the node it has, so the choices did not change).
function redrawDialog() {
  if (S.dialog && S.dialog.refresh) S.dialog.refresh(); else render();
}

function formDialog({ label, title, focus, fields, submit, button, note, values }) {
  let err = "";
  const vals = { ...(values || {}) };       // what you entered, also across a refresh()
  const keep = (e) => { if (e.target.name) vals[e.target.name] = e.target.type === "checkbox" ? e.target.checked : e.target.value; };
  const dialog = { focus };
  const showError = (msg) => {
    err = msg || "";
    const el = dialog.node && dialog.node.querySelector(".error");
    if (el) el.textContent = err;
  };
  const go = async (e) => {
    e && e.preventDefault();
    const f = dialog.node.querySelector("form");
    f.querySelectorAll("[name]").forEach(el => keep({ target: el }));
    showError("");
    try { await submit(vals, f); }
    catch (x) { showError(x.message); }
  };
  const build = () => dialogShell({ label },
    h("div", { class: "dh" }, h("h2", {}, title), h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("form", { class: "db", onsubmit: go, oninput: keep, onchange: keep }, fields(vals), note ? h("p", { class: "hint", style: "margin:0", text: note }) : null,
      h("div", { class: "error", role: "alert", text: err })),
    h("div", { class: "df btns" }, h("button", { class: "btn", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn primary", onclick: go }, button)));
  dialog.refresh = () => {
    if (S.dialog !== dialog) return;          // closed, or another dialog came instead
    const old = dialog.node;
    old.querySelectorAll("form [name]").forEach(el => keep({ target: el }));
    dialog.node = build();
    if (old.parentNode) old.replaceWith(dialog.node);
  };
  dialog.node = build();
  dialog.render = () => dialog.node;
  S.dialog = dialog;
  render();
  return dialog;
}

function openAddContact(key, name) {
  formDialog({ values: { key, name }, label: "Contact", title: key ? "Add contact" : "Add a contact", focus: key ? "#cname" : "#ckey", button: "Save",
    note: "The name is yours alone: others never see it, and nobody can fake it - it is tied to their key.",
    fields: (vals) => [
      h("label", { for: "ckey", text: "Their key" }),
      h("input", { id: "ckey", name: "key", class: "in mono", value: vals.key, "data-k": "ckey", placeholder: "ed25519:…", autocomplete: "off" }),
      h("label", { for: "cname", text: "Your name for them" }),
      h("input", { id: "cname", name: "name", class: "in", value: vals.name, "data-k": "cname", autocomplete: "off" })],
    submit: async (v) => {
      await api("POST", "/api/contacts", { key: v.key.trim(), name: v.name });
      closeDialog(); toast("Contact saved."); await loadSidebar(); if (S.gid && S.gid.startsWith("contact:")) { await loadGroup(); render(); }
    } });
}

// Your contacts, from the sidebar's chats (contacts are always among them).
function contactList() {
  return (S.sidebar && S.sidebar.contacts) || [];
}

// Close a chat (UN-RFC 0044 section 4.2): off the list on all your devices; the messages
// stay, and it comes back when one of you writes.
async function closeChat(key, label) {
  try { await api("POST", "/api/chats/close", { key, on: true }); } catch (x) { toast(x.message); return; }
  if (S.gid === "contact:" + key) { S.gid = null; S.data = null; }
  closeDialog(); await loadSidebar(); render();
  toast(`Closed the chat with ${label}. It comes back when one of you writes.`);
}

async function removeContact(key, label) {
  try { await api("POST", "/api/contacts", { key, remove: true }); } catch (x) { toast(x.message); return; }
  await loadSidebar(); render();
  toast(label + " is no longer a contact. The chat stays while you have one - close it with ⋯.");
}

// Who "To" means: a key, or a contact by name or the start of one (as the TUI's m).
function recipient(typed) {
  const t = (typed || "").trim();
  if (!t) throw new Error("Who to? A contact's name, or their key.");
  if (t.startsWith("ed25519:")) return t;
  const low = t.toLowerCase(), all = contactList();
  const exact = all.filter(c => c.label.toLowerCase() === low);
  const found = exact.length ? exact : all.filter(c => c.label.toLowerCase().startsWith(low));
  if (found.length === 1) return found[0].key;
  throw new Error(found.length ? "Several contacts start like that: " + found.map(c => c.label).join(", ") :
    "No contact by that name. Paste their key instead.");
}

// The address book (C), as the TUI's c: chat, write a post, rename, remove.
function openContacts() {
  let removing = null;                         // Remove asks once more, on the button itself
  S.dialog = { focus: ".dialog .btn.primary", render: () => {
    const list = contactList();
    return dialogShell({ label: "Contacts", wide: true },
      h("div", { class: "dh" }, h("h2", { text: "Contacts" }), h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
      h("div", { class: "db list" },
        list.length ? list.map(c => h("div", { class: "cmd" },
          h("span", { class: `av xs c${c.colour}`, "aria-hidden": "true", text: initials(c.label) }),
          h("span", { class: "nm", text: c.label }),
          h("button", { class: "btn primary", onclick: () => { closeDialog(); openGroup(c.id); } }, "Chat"),
          h("button", { class: "btn", onclick: () => { closeDialog(); openPost(c.key, c.label); } }, "Write a post"),
          h("button", { class: "btn", onclick: () => openAddContact(c.key, c.label) }, "Rename"),
          h("button", { class: removing === c.key ? "btn danger" : "btn",
            title: removing === c.key ? "The contact is forgotten; your chat and posts stay" : null,
            onclick: async () => {
              if (removing !== c.key) { removing = c.key; render(); return; }
              removing = null;
              await api("POST", "/api/contacts", { key: c.key, remove: true });
              toast(c.label + " is no longer a contact."); await loadSidebar(); } },
            removing === c.key ? "Really remove?" : "Remove"))) :
        h("p", { class: "muted", style: "padding:12px", text: "No contacts yet. Open a post and choose Add contact to give its author a name of your own." })),
      h("div", { class: "df" }, h("span", { text: list.length + " contacts" }), h("span", { text: "Esc close" })));
  } };
  render();
}

// Write to someone by their key: a post (a subject, read on its own) or a chat
// (a line in a running conversation). UN-RFC 0028; the same choice as in the TUI.
function openWrite(key = "", kind = "post") {
  if (kind === "post" && key) { openPost(key); return; }
  formDialog({ values: { key, body: "", subject: "" },
    label: kind === "chat" ? "Chat with someone" : "Write a post",
    title: kind === "chat" ? "Chat with someone" : "Write a post",
    focus: key ? (kind === "chat" ? "#wtext" : "#wsubject") : "#wkey", button: kind === "chat" ? "Send" : "Write …",
    note: kind === "chat" ? "Sealed to their key: the node cannot read it, nor see who sent it. To write a post instead: M." :
      "Next you write the post in the compose window. To chat instead: Ctrl P, Chat with someone.",
    fields: (vals) => [
      h("label", { for: "wkey", text: "To" }),
      h("input", { id: "wkey", name: "key", class: "in", value: vals.key, "data-k": "wkey", list: "wcontacts",
        placeholder: "a contact's name, or a key (ed25519:… - they find it with K)", autocomplete: "off" }),
      h("datalist", { id: "wcontacts" }, contactList().map(c => h("option", { value: c.label }))),
      kind === "chat" ? [
        h("div", { class: "label-row" }, h("label", { for: "wtext", text: "Message" }), emojiButton("wtext")),
        h("textarea", { id: "wtext", name: "body", class: "in", "data-k": "wtext", style: "min-height:120px", value: vals.body })] :
      [h("label", { for: "wsubject", text: "Subject" }),
        h("input", { id: "wsubject", name: "subject", class: "in", "data-k": "wsubject", value: vals.subject, autocomplete: "off" })]],
    submit: async (v) => {
      const k = recipient(v.key);                 // a contact's name (or its start), or a key
      if (kind === "chat") {
        const body = (v.body || "").trim();
        if (!body) throw new Error("Write a message, please.");
        const gid = "contact:" + k;
        closeDialog();
        await openGroup(gid);
        await doSend("/api/private", gid, { key: k, body, chat: true }, { text: body, chat: true });
      } else {
        closeDialog();
        openPost(k, "", (v.subject || "").trim());
      }
    } });
}

// The compose window for a post: subject, text, your signature; sent to their inbox.
async function openPost(key, who = "", subject = "", replyTo = null, quote = "") {
  const sig = await signatureText();
  const top = quote;
  const inbox = S.sidebar && S.sidebar.inbox.id;
  openComposeWindow({ g: null, title: "Post to " + (who || key.slice(0, 20) + "…"), subject, private: true,
    body: top + "\n" + (sig ? "-- \n" + sig + "\n" : ""), cursor: top.length,
    send: (subject, text, _notify, files) => doSend("/api/private", inbox,
      { key, subject, body: text, ...(replyTo ? { reply_to: replyTo } : {}),
        ...(files && files.length ? { files } : {}) }, { text }) });
  if (!subject) setTimeout(() => { const s = document.getElementById("subject"); if (s) s.focus(); });
}

function openCreateGroup() {
  let gtype = "open", view = "threads", kinds = "both", files = "none", comments = "open";
  // a site is a channel (UN-RFC 0035 section 3): choosing Site makes it one, and
  // another type takes the group back to threads
  const choose = (name, value) => {
    if (name === "type") { gtype = value; if (value !== "channel" && view === "pages") view = "threads"; }
    else if (name === "kinds") kinds = value;
    else if (name === "files") files = value;
    else if (name === "comments") comments = value;
    else { view = value; if (value === "pages") gtype = "channel"; }
    redrawDialog();
  };
  const pick = (name, value, current, label, small) => h("button", { type: "button", class: "choice", "aria-pressed": String(current === value),
    onclick: () => choose(name, value) },
    h("span", {}, h("span", { text: label }), h("small", { text: small })));
  const about = () => view === "pages" ? "A site is a channel: you, and the people you add as posters, write its pages. The first page you write, index, is its home page."
    : view === "feed" ? (gtype === "channel" ? "A feed: entries newest first, comments under each. Only you (and your posters) post entries."
      : "A feed: entries newest first, comments under each. As an open group anyone posts entries; a channel is for one voice.")
    : null;
  formDialog({ label: "Create a group", title: "Create a group", focus: "#gname", button: "Create",
    note: "The group belongs to your key. Creating it costs some proof-of-work, and it is sent to your node now.",
    fields: (vals) => [
      h("label", { for: "gname", text: "Name" }),
      h("input", { id: "gname", name: "name", class: "in mono", "data-k": "gname", value: vals.name || "", placeholder: "e.g. dk.snak.marsvin or alt.test", autocomplete: "off" }),
      h("label", { text: "Who may write" }),
      h("div", { class: "choices row" },
        pick("type", "open", gtype, "Open", "anyone"),
        pick("type", "moderated", gtype, "Moderated", "posts need approval"),
        pick("type", "channel", gtype, "Channel", "only chosen people"),
        pick("type", "closed", gtype, "Closed", "members only, encrypted")),
      h("label", { text: "Shown as" }),
      h("div", { class: "choices row" },
        pick("view", "threads", view, "≡ Threads", "posts and replies"),
        pick("view", "chat", view, "» Chat", "messages in order"),
        pick("view", "feed", view, "☰ Feed", "entries with comments"),
        gtype !== "closed" ? pick("view", "pages", view, "⌂ Site", "pages that stay") : null),
      about() ? h("p", { class: "hint", style: "margin:0", text: about() }) : null,
      view === "feed" && gtype === "channel" ? [h("label", { text: "Comments" }),
        h("div", { class: "choices row" },
          pick("comments", "open", comments, "Anyone may comment", "under each entry"),
          pick("comments", "none", comments, "No comments", "announcements"))] : null,
      view !== "pages" ? [h("label", { text: "Takes" }),
        h("div", { class: "choices row" },
          pick("kinds", "both", kinds, "Both", "posts and chat lines"),
          pick("kinds", "post", kinds, "≡ Posts only", "a discussion group"),
          pick("kinds", "chat", kinds, "» Chat lines only", "a chat group"))] : null,
      h("label", { text: "Files" }),
      h("div", { class: "choices row" }, FILE_PICKS.map(([v, l, s]) => pick("files", v, files, l, s))),
      view === "chat" ? h("label", { class: "check" }, h("input", { type: "checkbox", name: "fast", checked: !!vals.fast }), " Fast delivery: nodes pass messages on at once (less hiding of where they came from)") : null,
      h("label", { for: "gtitle", text: "Title" }),
      h("input", { id: "gtitle", name: "title", class: "in", "data-k": "gtitle", value: vals.title || "", placeholder: "One line about the group" })],
    submit: async (v) => {
      toast("Creating the group - proof-of-work takes a moment …");
      const { id } = await api("POST", "/api/groups", { name: v.name, type: gtype, view,
        kinds, fast: view === "chat" && !!v.fast, title: v.title,
        ...(gtype === "channel" && view === "feed" ? { comments } : {}),
        ...(files !== "none" ? { files } : {}) });
      closeDialog(); await loadSidebar(); await openGroup(id); toast("The group is created.");
    } });
}

function openInvite() {
  const g = S.data && S.data.group;
  if (!g || !g.owner || g.type !== "closed") return;
  formDialog({ label: "Invite", title: "Invite to " + g.label, focus: "#ikey", button: "Invite",
    note: "They get the group's key, sealed to them. They find their own key with K.",
    fields: (vals) => [h("label", { for: "ikey", text: "Their key" }),
      h("input", { id: "ikey", name: "key", class: "in mono", "data-k": "ikey", value: vals.key || "", placeholder: "ed25519:…", autocomplete: "off" })],
    submit: async (v) => {
      await api("POST", `/api/groups/${encodeURIComponent(g.id)}/invite`, { key: v.key.trim() });
      closeDialog(); toast("Invited."); await loadGroup(); render();
    } });
}

async function openSignature() {
  const cur = await api("GET", "/api/settings");
  formDialog({ values: { template: cur.signature }, label: "Signature", title: "Your signature", focus: "#sig", button: "Save",
    note: "Added below your posts (not chat). {name}, {key} and {fp} are filled in. Empty: no signature. At most 4 lines.",
    fields: (vals) => [h("label", { for: "sig", class: "sr", text: "Signature" }),
      h("textarea", { id: "sig", name: "template", class: "in mono", value: vals.template, "data-k": "sig", style: "min-height:100px" })],
    submit: async (v) => { await api("POST", "/api/settings", { signature: v.template }); closeDialog(); toast("Signature saved."); } });
}

// ---- your vault's passphrase (#32, as the TUI's Change passphrase) ------------
const COPIES_NOTE = "Only this vault file changes. Copies of it on other devices, sticks or backups still open with the old passphrase: replace or delete them.";
function openPassphrase() {
  formDialog({ label: "Change passphrase", title: "Change passphrase", focus: "#pold", button: "Change", note: COPIES_NOTE,
    fields: (vals) => [
      GUI && GUI.vault ? h("p", { class: "hint mono", style: "margin:0", text: GUI.vault }) : null,
      h("label", { for: "pold", text: "Current passphrase" }),
      h("input", { id: "pold", name: "old", type: "password", class: "in", "data-k": "pold", autocomplete: "current-password", value: vals.old || "" }),
      h("label", { for: "pnew", text: "New passphrase" }),
      h("input", { id: "pnew", name: "pw", type: "password", class: "in", "data-k": "pnew", autocomplete: "new-password", value: vals.pw || "" }),
      h("label", { for: "pnew2", text: "The new passphrase again" }),
      h("input", { id: "pnew2", name: "pw2", type: "password", class: "in", "data-k": "pnew2", autocomplete: "new-password", value: vals.pw2 || "" })],
    submit: async (v) => {
      if ((v.pw || "") !== (v.pw2 || "")) throw new Error("The new passphrases do not match.");
      if ((v.pw || "").length < 4) throw new Error("The new passphrase is too short.");
      if (v.pw === v.old) throw new Error("The new passphrase is the same as the current one.");
      toast("Encrypting the vault with the new passphrase …");
      await api("POST", "/api/passphrase", { old: v.old || "", new: v.pw });
      closeDialog();
      toast("Passphrase changed. Copies of the vault elsewhere still open with the old one - replace or delete them.");
    } });
}

// ---- profiles (#20, UN-RFC 0022): anyone's, and your own ----------------------
// Links are shown as written and never opened by themselves (section 9.2).
function profileBody(p) {
  const obj = p.profile;
  if (p.hidden) return h("p", { style: "margin:0", text: "You have hidden this profile." });
  if (!obj || (!obj.about && !(obj.lang || []).length && !(obj.links || []).length))
    return h("p", { class: "muted", style: "margin:0", text: p.mine ? "You have no public profile yet." : "No public profile." });
  return [
    obj.about ? (p.about_tree && p.about_tree.length ? h("div", { class: "md profile-about" }, renderTree(p.about_tree)) :
      renderBody(obj.about)) : null,
    (obj.lang || []).length ? h("p", { style: "margin:0", text: "Writes: " + obj.lang.join(", ") }) : null,
    (obj.links || []).length ? [h("p", { class: "hint", style: "margin:0", text: "Links, as stated by this identity (not checked):" }),
      h("ul", { class: "profile-links" }, obj.links.map(l => h("li", { class: "mono", text: `${l.kind}: ${l.value}${l.label ? "  (" + l.label + ")" : ""}` })))] : null];
}

// where it is opened decides whether a profile shared with you or this closed group is
// shown (UN-RFC 0022 section 6): the core answers one shared there, never from elsewhere
async function openProfile(key, who = "", context = S.gid) {
  let p = null, err = "";
  const again = () => openProfile(key, who, context);
  const draw = () => dialogShell({ label: "Profile" },
    h("div", { class: "dh" }, h("h2", { text: (p && p.label) || who || "Profile" }),
      p && p.profile && p.profile.bot ? h("span", { class: "chip", text: "bot" }) : null,
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db" },
      h("div", { class: "prof-head" }, bigAvatar(key), h("div", { class: "keybox", text: key })),
      err ? h("p", { class: "error", text: err }) :
      !p ? h("p", { class: "muted", style: "margin:0", text: "Reading the profile over Tor …" }) :
      p.shared && !p.hidden ? [h("p", { class: "hint shared-note", style: "margin:0",
        text: p.shared.context === "me" ? "Shared with you only - shown only in your private posts and chats with them."
          : `Shared with ${p.shared.context_label} only - shown only there.` }), profileBody({ ...p, ...p.shared })] :
      profileBody(p)),
    h("div", { class: "df btns wrap" },
      // their feed and site, when they have them: opened to read, not followed (unseenet#506)
      p && !p.mine && p.theirs && p.theirs.feed ? h("button", { class: "btn", title: "Their personal feed (UN-RFC 0034) - read it without following",
        onclick: () => { closeDialog(); S.full = false; openGroup(p.theirs.feed); } }, "Their feed") :
      p && !p.mine && !p.theirs && p.feed ? h("button", { class: "btn", title: "Their personal feed, if they have one (UN-RFC 0034)",
        onclick: () => { closeDialog(); openAddress("unseenet:" + p.feed); } }, "Feed") : null,
      p && !p.mine && p.theirs && p.theirs.site ? h("button", { class: "btn", title: "Their personal site (UN-RFC 0035) - read it without following",
        onclick: () => { closeDialog(); S.full = false; openGroup(p.theirs.site); } }, "Their site") : null,
      p && !p.mine && !p.hidden ? h("button", { class: "btn", title: "Follow their feeds - nobody is told (UN-RFC 0034 section 6.1)",
        onclick: async () => { await setFollowing({ person: key, on: !p.following }, p.label || who); again(); } },
        p.following ? "Unfollow" : "Follow") : null,
      p && p.address ? h("button", { class: "btn", title: "An unseenet: address for this person (UN-RFC 0031)",
        onclick: () => copy(p.address, "The address is copied.") }, "Copy address") : null,
      p && !p.mine ? h("button", { class: "btn", title: "A profile only they can read, shown only to them (UN-RFC 0022 section 6)",
        onclick: () => openShareProfile(key, p.label || who) }, "Share yours") : null,
      p && !p.mine ? (contactList().some(c => c.key === key)
        ? h("button", { class: "btn", onclick: () => { closeDialog(); removeContact(key, p.label || who); } }, "Remove contact")
        : h("button", { class: "btn", onclick: () => { closeDialog(); openAddContact(key, (p.label || who || "").replace(/~.*$/, "").replace(/^@/, "")); } }, "Add contact")) : null,
      p && p.mine ? h("button", { class: "btn", onclick: () => openMyProfile() }, "Edit") : null,
      p && p.mine ? h("button", { class: "btn", title: "Your own feed (UN-RFC 0034) - public",
        onclick: () => { closeDialog(); openMyFeed(); } },
        S.sidebar && S.sidebar.my_feed && S.sidebar.my_feed.started ? "My feed" : "Start my feed") : null,
      p && p.mine ? h("button", { class: "btn", title: "Your own site of pages (UN-RFC 0035) - public",
        onclick: () => { closeDialog(); openMySite(); } },
        S.sidebar && S.sidebar.my_site && S.sidebar.my_site.started ? "My site" : "Start my site") : null,
      p && !p.mine ? h("button", { class: "btn", title: "Only you stop seeing it (UN-RFC 0022 section 9.2)", onclick: async () => {
        try { await api("POST", "/api/profile/hide", { key, hidden: !p.hidden }); }
        catch (x) { toast(x.message); return; }
        toast(p.hidden ? "Profile shown." : "Profile hidden."); again(); } }, p.hidden ? "Show" : "Hide") : null,
      h("button", { class: "btn primary", onclick: closeDialog }, "Close")));
  S.dialog = { focus: ".dialog .btn.primary", render: draw };
  render();
  try { p = await api("GET", "/api/profile?key=" + encodeURIComponent(key) + (context ? "&context=" + encodeURIComponent(context) : "")); }
  catch (x) { err = x.message; }
  if (S.dialog && S.dialog.render === draw) render();
}

function bigAvatar(key) {
  const p = personOf(key);
  if (p && p.picture) return h("img", { class: "av big pic", src: p.picture.data, alt: p.picture.alt || "", title: p.picture.alt || "" });
  if (p && p.identicon) return identiconEl(p.identicon, "av big");
  return null;
}

function confirmDialog({ title, text, button, danger, ok }) {
  S.dialog = { focus: ".dialog .btn.primary", render: () => dialogShell({ label: title },
    h("div", { class: "dh" }, h("h2", { text: title }), h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db" }, text.split("\n\n").map(t => h("p", { style: "margin:0;white-space:pre-line", text: t }))),
    h("div", { class: "df btns" }, h("button", { class: "btn", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn primary" + (danger ? " danger" : ""), onclick: ok }, button))) };
  render();
}

function linksText(links) {
  return (links || []).map(l => `${l.kind} ${l.value}` + (l.label ? `  # ${l.label}` : "")).join("\n");
}
function parseLinks(text) {
  const out = [];
  text.split("\n").forEach((line, i) => {
    const [main, ...rest] = line.split("#");
    const parts = main.trim().split(/\s+/);
    if (!parts[0]) return;
    if (parts.length < 2) throw new Error(`Line ${i + 1}: the kind, a space, then the address.`);
    const link = { kind: parts[0].toLowerCase(), value: parts.slice(1).join(" ") };
    if (rest.join("#").trim()) link.label = rest.join("#").trim();
    out.push(link);
  });
  return out;
}

async function openMyProfile() {
  let p;
  try { p = await api("GET", "/api/profile"); } catch (x) { toast(x.message); return; }
  if (!p.published) {               // the warning before the first, as in the TUI
    confirmDialog({ title: "Before you publish a profile", text: p.warning, button: "I understand", ok: () => editProfile(p) });
    return;
  }
  editProfile(p);
}

// A profile for one person or a closed group only (UN-RFC 0022 section 6, as the TUI's
// Share your profile): for those who want no public profile, or another one for friends.
// `to` is their key (or their chat) or the closed group; nothing is published.
async function openShareProfile(to, who) {
  let p;
  try { p = await api("GET", "/api/profile"); } catch (x) { toast(x.message); return; }
  editProfile(p, { to, who });
}
function shareTarget() {
  const g = S.data && S.data.group;
  if (!g) return null;
  if (g.type === "closed") return { to: g.id, who: "the members of " + g.label };
  if (String(g.id || "").startsWith("contact:")) return { to: g.id, who: g.label };
  return null;
}
function withdrawShared({ to, who }) {
  confirmDialog({ title: "Take back your shared profile?", button: "Take back",
    text: `An empty profile goes to ${who}, and the one you shared is no longer shown. Copies they already kept cannot be taken back.`,
    ok: async () => { try { await api("POST", "/api/profile/share", { to, withdraw: true }); closeDialog(); toast(`Shared profile taken back from ${who}.`); }
      catch (x) { toast(x.message); } } });
}

function editProfile(p, share = null) {
  const cur = p.profile || {};
  const md = cur.about ? /markdown/i.test(cur.about_type || "") : !(S.sidebar && S.sidebar.markdown === false);
  // Your picture is set here too (#82, UN-RFC 0022 section 8.5): shown exactly as it will
  // be published before it is, with the warning before the first.
  const pic = { file: null, preview: null, alt: (p.picture && p.picture.alt) || "", remove: false, err: "", busy: false };
  let dialog = null;
  const choose = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    Object.assign(pic, { err: "", busy: true, remove: false }); dialog.refresh();
    try {
      pic.file = await new Promise((ok, bad) => { const r = new FileReader();
        r.onload = () => ok(String(r.result).split(",", 2)[1] || ""); r.onerror = bad; r.readAsDataURL(file); });
      pic.preview = (await api("POST", "/api/profile/picture", { data: pic.file, alt: pic.alt, preview: true })).picture;
    } catch (x) { pic.err = x.message; pic.file = pic.preview = null; }
    pic.busy = false; dialog.refresh();
  };
  const shown = () => pic.remove ? null : (pic.preview || p.picture);
  const picturePart = () => [
    h("div", { class: "prof-head" },
      shown() ? h("img", { class: "av big pic", src: shown().data, alt: pic.alt || "" }) : bigAvatar(p.key),
      h("div", { class: "pic-side" },
        h("p", { class: "hint", style: "margin:0", text: pic.preview ? "Your new picture, exactly as it will be published: a square, at most 128 pixels, without where or when it was taken." :
          pic.remove ? "Your picture will be removed: your identicon is shown instead." :
          p.picture ? "Your picture - anybody can see it." : "No picture: your identicon is shown, made from your key." }),
        h("div", { class: "pic-btns" },
          h("label", { for: "picfile", class: "btn" }, pic.busy ? "Making it …" : p.picture || pic.preview ? "Choose another" : "Choose a picture"),
          h("input", { id: "picfile", type: "file", accept: "image/*", class: "sr", onchange: choose }),
          (p.picture || pic.preview) && !pic.remove ? h("button", { type: "button", class: "link", onclick: () => {
            Object.assign(pic, { file: null, preview: null, remove: !!p.picture }); dialog.refresh(); } }, "Remove picture") : null))),
    shown() || pic.file ? [h("label", { for: "picalt", text: "Picture description, for people who cannot see it" }),
      h("input", { id: "picalt", class: "in", maxlength: 128, "data-k": "picalt", value: pic.alt, oninput: (e) => { pic.alt = e.target.value; } })] : null,
    !p.picture && pic.preview ? h("p", { class: "hint warn-line", style: "margin:0;white-space:pre-line", text: p.picture_warning || "" }) : null,
    pic.err ? h("p", { class: "error", text: pic.err }) : null];
  const publishPicture = async () => {
    if (pic.file) await api("POST", "/api/profile/picture", { data: pic.file, alt: pic.alt });
    else if (pic.remove) await api("POST", "/api/profile/picture", { remove: true });
    else return false;
    PEOPLE.delete(p.key);
    return true;
  };
  const publish = async (body) => {
    await api("POST", "/api/profile", body.remove ? null : { edit: body });
    const picture = body.remove ? false : await publishPicture();
    closeDialog(); render();
    toast(body.remove ? "Your profile is removed." : picture ? "Your profile and picture are published." : "Your profile is published.");
  };
  const shareIt = (body) => confirmDialog({ title: "Share your profile", button: "Share",
    text: `Only ${share.who} can read it, and it is shown only there - your public profile, if you have one, stays as it is. You can take it back later.`,
    ok: async () => { try { await api("POST", "/api/profile/share", { to: share.to, profile: { edit: body } }); closeDialog(); toast(`Profile shared with ${share.who}.`); }
      catch (x) { toast(x.message); } } });
  dialog = formDialog({ label: share ? "Share your profile" : "Your profile", focus: "#pabout", button: share ? "Share …" : "Publish",
    title: share ? `A profile for ${share.who} only` : "Your public profile - anybody can read it",
    values: { about: cur.about || "", markdown: md, lang: (cur.lang || []).join(", "), links: linksText(cur.links) },
    note: "Kinds of links: " + (p.link_kinds || []).join(", ") + ", or x-something. Links are shown as written; nobody checks them.",
    fields: (vals) => [
      ...(share ? [] : picturePart()),      // your picture is public: not in a shared profile
      h("label", { for: "pabout", text: "About you - a few lines, or a small home page" }),
      h("textarea", { id: "pabout", name: "about", class: "in", "data-k": "pabout", value: vals.about, style: "min-height:120px" }),
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "markdown", checked: !!vals.markdown }),
        " Markdown - # headings, - lists, **strong**, [links](https://...), :tada: (no pictures)"),
      h("label", { for: "plang", text: "Languages you write, e.g. da, en" }),
      h("input", { id: "plang", name: "lang", class: "in", "data-k": "plang", value: vals.lang }),
      h("label", { for: "plinks", text: "Links, one per line: kind address  (# a label)" }),
      h("textarea", { id: "plinks", name: "links", class: "in mono", "data-k": "plinks", value: vals.links, style: "min-height:80px" }),
      p.published && !share ? h("button", { type: "button", class: "link", onclick: () => confirmDialog({ title: "Remove your profile?",
        text: "Nodes stop showing it. Copies others already kept cannot be taken back.", button: "Remove", danger: true,
        ok: () => publish({ remove: true }).catch(x => toast(x.message)) }) }, "Remove your profile") : null],
    submit: async (v) => {
      const links = parseLinks(v.links || "");
      const body = { about: v.about || "", markdown: !!v.markdown, lang: v.lang || "", links };
      if (share) { shareIt(body); return; }
      const old = new Set((cur.links || []).map(l => l.kind + " " + l.value));
      const added = links.filter(l => !old.has(l.kind + " " + l.value) && l.kind !== "onion");
      if (added.length && p.published) {     // each new link ties this identity to that account
        confirmDialog({ title: "New links", button: "Publish",
          text: "Each link ties this identity, and everything it posts, to that account:\n\n" + added.map(l => `${l.kind}: ${l.value}`).join("\n"),
          ok: () => publish(body).catch(x => toast(x.message)) });
        return;
      }
      await publish(body);
    } });
}

function selectedPost() {
  return (S.data && S.data.group && S.data.group.view !== "chat" && S.data.messages.find(x => x.id === S.post)) || null;
}

function commands() {
  const g = S.data && S.data.group;
  const cmds = [
    { name: "New post", key: "N", when: g && g.type && mayWrite(S.data, "post").allowed && g.view !== "chat", run: openCompose },
    { name: "Switch between chat and threads", key: "V", when: g && g.type && g.type !== "inbox", run: toggleView },
    { name: "About this group: rules, type, owner", key: "?", when: g && g.type, run: openInfo },
    { name: "Find groups on your nodes", key: "G", run: openBrowse },
    { name: "Create a group", key: "", run: openCreateGroup },
    { name: "Write a private post", key: "M", run: () => openWrite("", "post") },
    { name: "Contacts", key: "C", run: openContacts },
    { name: "Names: claim yours, ask for one, give names under yours", key: "@", run: openNames },
    { name: "People you ignore", key: "", run: openIgnored },
    { name: S.sidebar && S.sidebar.notices && S.sidebar.notices.send === false ? "Tell people you mention" : "Stop telling people you mention", key: "",
      run: async () => { const on = !!(S.sidebar && S.sidebar.notices && S.sidebar.notices.send === false);
        await api("POST", "/api/settings", { notices: { send: on } }); await loadSidebar();
        toast(on ? "People you mention by name are told in their inbox (you can say no per post)." : "People you mention are no longer told; they see it if they follow the group."); } },
    { name: S.sidebar && S.sidebar.notices && S.sidebar.notices.receive === false ? "Show mention notices" : "Stop showing mention notices", key: "",
      run: async () => { const on = !!(S.sidebar && S.sidebar.notices && S.sidebar.notices.receive === false);
        await api("POST", "/api/settings", { notices: { receive: on } }); await loadSidebar();
        toast(on ? "Mentions of you in groups you do not follow show in For you." : "Mention notices from others are no longer shown."); } },
    { name: S.sidebar && S.sidebar.markdown === false ? "Write Markdown (*emphasis*, `code`, :tada:)" : "Write plain text instead of Markdown", key: "",
      run: async () => { const on = !(S.sidebar && S.sidebar.markdown !== false); await api("POST", "/api/settings", { markdown: on }); await loadSidebar();
        toast(on ? "You write Markdown: *emphasis*, **strong**, `code`, lists, :tada:" : "You write plain text: sent and shown exactly as typed."); } },
    { name: S.sidebar && S.sidebar.show_blocked ? "Hide posts blocked by maintainers" : "Show posts blocked by maintainers", key: "", run: toggleShowBlocked },
    { name: S.sidebar && S.sidebar.hide_bots ? "Show bots" : "Hide bots: posts by keys that say they post automatically", key: "", run: toggleBots },
    { name: S.sidebar && S.sidebar.pictures === false ? "Show people's pictures" : "Identicons only: do not show people's pictures", key: "", run: togglePictures },
    { name: "Your picture: in your profile", key: "", run: openMyProfile },
    // the owner's and moderators' tools, as in the TUI's Ctrl+P
    { name: "To approve: posts waiting in groups you moderate", key: "", run: openModeration },
    { name: "Edit this group", key: "", when: g && g.owner, run: openEditGroup },
    { name: "Moderators and posters", key: "", when: g && g.owner && g.type !== "closed", run: openRoles },
    { name: "Banned from this group", key: "", when: g && g.owner, run: () => openBanned() },
    { name: "Remove this group from the network", key: "", when: g && g.owner, run: openRemoveGroup },
    { name: "Unsubscribe from this group", key: "", when: g && g.type && !["inbox", "contact"].includes(g.type), run: () => leaveGroup(g) },
    { name: "Withdraw (delete) the selected post", key: "D", also: "delete remove slet fjern tilbagetræk",
      when: selectedPost() && selectedPost().may_withdraw, run: () => openWithdraw(selectedPost()) },
    { name: "Pin the selected post", key: "", when: S.data && S.data.group.may_pin && selectedPost() && !selectedPost().pinned, run: () => openPin(selectedPost()) },
    { name: "Unpin the selected post", key: "", when: S.data && S.data.group.may_pin && selectedPost() && selectedPost().pinned, run: () => openPin(selectedPost()) },
    { name: "Pinned posts in this group", key: "", when: pinsOf(S.data).length > 0, run: () => openPinList() },
    { name: "Open an unseenet: address", key: "", run: openAddressDialog },
    { name: "Timeline: every feed you follow", key: "", when: S.sidebar && S.sidebar.timeline.feeds > 0, run: () => openGroup(TIMELINE) },
    { name: "Follow someone: their feeds, by key, name or address", key: "", run: openFollow },
    { name: "Whom you follow", key: "", run: openFollowing },
    { name: "Your feed: start it, or go to it", key: "", run: openMyFeed },
    { name: "Your site: start it, or go to it", key: "", run: openMySite },
    { name: "New page on this site", key: "", when: S.data && S.data.site && S.data.site.may_write,
      run: () => openPageEditor(S.data.group, S.data.site, null) },
    { name: "Show this group as a feed", key: "", when: g && g.type && !["inbox", "contact"].includes(g.type) && g.view !== "feed",
      run: async () => { await api("POST", `/api/groups/${encodeURIComponent(g.id)}/view`, { view: "feed" }); await loadGroup(); await loadSidebar(); render(); } },
    { name: "Copy the address of this group", key: "", when: g && g.address, run: () => copy(g.address, "The group's address is copied.") },
    { name: "Copy the address of the selected post", key: "", when: selectedPost() && selectedPost().address && !selectedPost().private,
      run: () => copy(selectedPost().address, "The post's address is copied.") },
    { name: "Go to a #group in the selected post", key: "#", when: selectedPost() && (selectedPost().groups || []).length, run: () => groupsInPost(selectedPost()) },
    { name: "Report the selected post", key: "", when: selectedPost() && !selectedPost().mine && !selectedPost().private, run: () => openReport(selectedPost()) },
    { name: "Add a contact", key: "", run: () => openAddContact("", "") },
    { name: "Close this chat", key: "", also: "hide archive remove luk skjul", when: g && g.type === "contact",
      run: () => closeChat(g.key, g.label.replace(/ √$/, "")) },
    { name: "Invite to this closed group", key: "", when: g && g.owner && g.type === "closed", run: openInvite },
    { name: "Edit your signature", key: "", run: openSignature },
    { name: "Profile of this author: about, languages, links (UN-RFC 0022)", key: "", when: selectedPost() && selectedPost().key,
      run: () => openProfile(selectedPost().key, selectedPost().who) },
    { name: "Your profile: write, change or remove it", key: "", run: openMyProfile },
    { name: g && g.type === "closed" ? "Share your profile with this group only" : "Share your profile with this person only", key: "",
      when: !!shareTarget(), run: () => openShareProfile(shareTarget().to, shareTarget().who) },
    { name: "Take back the profile you shared here", key: "", when: !!shareTarget(), run: () => withdrawShared(shareTarget()) },
    { name: "Change passphrase (copies of the vault elsewhere keep the old one)", key: "", run: openPassphrase },
    { name: "Update Unseenet", key: "", when: !!S.state.update, run: openUpdate },
    { name: "Network and Wi-Fi", key: "", when: S.state.bootable, run: openNetwork },
    { name: "Restart the computer", key: "", when: S.state.bootable, run: () => power("reboot") },
    { name: "Shut down the computer", key: "", when: S.state.bootable, run: () => power("poweroff") },
    { name: theme() === "light" ? "Use the dark theme" : "Use the light theme", key: "", run: () => { theme(theme() === "light" ? "dark" : "light"); render(); } },
    { name: "Follow the system's theme", key: "", when: !!THEME, run: () => { theme(null); render(); } },
    { name: S.sidebar && S.sidebar.state_local ? "Your state: keep it in the network again" : "Your state: keep it on this device only",
      key: "", when: !!S.sidebar, run: openStateWhere },
    { name: "Show my key", key: "K", run: openKey },
    { name: "Key ripening: your level, what it means" + (S.ripening && typeof S.ripening.paused === "boolean" ? ", pause or resume" : ""),
      key: "", when: !!S.ripening, run: openRipening },
    { name: "About Unseenet: what it is, why, and how it protects you", key: "F1", run: openAbout },
    { name: "Refresh now", key: "", run: () => api("POST", "/api/refresh").then(() => toast("Refreshing …")) },
    { name: "Private posts", key: "", when: S.sidebar && S.sidebar.inbox.id, run: () => openGroup(S.sidebar.inbox.id) },
    { name: "Chat with someone", key: "", run: () => openWrite("", "chat") },
    { name: "For you: replies and mentions", key: "", run: () => openGroup(FOR_YOU) },
  ].filter(c => c.when === undefined || c.when);
  return cmds.concat(allGroups().map(x => ({ name: x.label, group: x, key: "", run: () => openGroup(x.id) })));
}

function openPalette() {
  let q = "", sel = 0;
  const shown = () => commands().filter(c => !q || c.name.toLowerCase().includes(q) ||
    (c.also && c.also.includes(q)) ||
    (c.group && (c.group.title || "").toLowerCase().includes(q)));
  const run = (c) => { S.dialog = null; render(); c.run(); };
  S.dialog = { focus: "#palette", render: () => {
    const list = shown();
    sel = Math.max(0, Math.min(sel, list.length - 1));
    const acts = list.filter(c => !c.group), grps = list.filter(c => c.group);
    const row = (c) => h("button", { class: "cmd" + (list.indexOf(c) === sel ? " on" : ""), onclick: () => run(c),
      onmousemove: () => { if (list.indexOf(c) !== sel) { sel = list.indexOf(c); render(); } } },
      c.group ? h("span", { class: "mono muted", style: "width:28px", text: (c.group.access || "") + c.group.icon }) : null,
      h("span", { class: "nm" + (c.group ? " mono" : ""), text: c.name }),
      c.group && c.group.unread ? h("span", { class: "count", text: c.group.unread }) : null,
      c.key ? h("kbd", { text: c.key }) : null);
    return dialogShell({ label: "Command palette" },
      h("div", { class: "dh" }, svg(ICON.search, 18),
        h("label", { for: "palette", class: "sr", text: "Search commands and groups" }),
        h("input", { id: "palette", "data-k": "palette", placeholder: "Commands and groups …", value: q, autocomplete: "off",
          oninput: (e) => { q = e.target.value.toLowerCase(); sel = 0; render(); },
          onkeydown: (e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); sel++; render(); }
            else if (e.key === "ArrowUp") { e.preventDefault(); sel--; render(); }
            else if (e.key === "Enter") { e.preventDefault(); const c = shown()[sel]; if (c) run(c); }
          } }),
        h("kbd", { text: "Esc" }),
        h("button", { class: "btn icon pal-close", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),   // phones: no Esc key
      h("div", { class: "db list", "data-scroll": "palette" },
        acts.length ? [h("div", { class: "sect", text: "Commands" }), acts.map(row)] : null,
        grps.length ? [h("div", { class: "sect", text: "Your groups" }), grps.map(row)] : null,
        !list.length ? h("p", { class: "muted", style: "padding:12px", text: "Nothing matches." }) : null),
      h("div", { class: "df keys-only" }, h("span", { text: "↑↓ move" }), h("span", { text: "Enter run" }), h("span", { text: "Esc close" })));
  } };
  render();
}

// ---- emoji: a picker, and :shortcode: completion while typing (#21) -----------
// Both put the :shortcode: in the text (UN-RFC 0031 section 5.2), so it stays
// readable everywhere and the core turns it into the glyph. The data comes once from
// the core's GET /api/emoji (unseenet 0.5, UN-RFC 0046 section 4.4); the order of
// suggestions is the core's find_emoji(), so all clients agree.
// Both live outside #root, so a redraw does not close them; the field is found
// again by its data-k each time.
const EMOJI_FIELDS = new Set(["chat", "cbody", "wtext"]);
const EMOJI_RECENT = "unseenet-emoji-recent";
let emojiData = null, emojiLoading = null, picker = null, suggest = null, emojiMissing = false;
// plain text: no glyphs, no picker; a core before 0.5 has no /api/emoji: none either
const emojiOn = () => !emojiMissing && !(S.sidebar && S.sidebar.markdown === false);

function loadEmoji() {
  if (emojiData) return Promise.resolve(emojiData);
  emojiLoading = emojiLoading || api("GET", "/api/emoji").then(d => {
    d.codes = Object.keys(d.table);
    return (emojiData = d);
  }, err => {
    emojiLoading = null;
    if (/^404\b/.test(err.message)) { emojiMissing = true; closeEmojiPicker(); render(); }
    throw err;
  });
  return emojiLoading;
}

function recentEmoji() {
  try { const r = JSON.parse(localStorage.getItem(EMOJI_RECENT) || "[]"); return Array.isArray(r) ? r : []; }
  catch (_) { return []; }
}

function rememberEmoji(code) {
  const r = [code, ...recentEmoji().filter(c => c !== code)].slice(0, 24);
  try { localStorage.setItem(EMOJI_RECENT, JSON.stringify(r)); } catch (_) { }
}

// Shortcodes that start with q first (shortest first), then ones that contain it,
// then ones whose name or tags have a word starting with it. One per glyph.
function findEmoji(d, q, max) {
  q = q.toLowerCase().replace(/^:+|:+$/g, "");
  if (!q) return [];
  const starts = [], inside = [], named = [];
  for (const c of d.codes) {
    if (c.startsWith(q)) starts.push(c);
    else if (c.includes(q)) inside.push(c);
    else if ((d.names[c] || "").split(" ").some(w => w.startsWith(q))) named.push(c);
  }
  starts.sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
  const seen = new Set(), out = [];
  for (const c of [...starts, ...inside, ...named]) {
    if (seen.has(d.table[c])) continue;
    seen.add(d.table[c]); out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

const emojiField = (k) => document.querySelector(`#root [data-k="${CSS.escape(k)}"]`);

// Put :code: into field k: in place of [from, cursor) when completing, else at the cursor.
// insertText keeps the browser's undo and fires `input`, so drafts follow.
function insertEmoji(k, code, from) {
  const el = emojiField(k);
  if (!el) return;
  const end = el.selectionEnd ?? el.value.length;
  const start = from ?? el.selectionStart ?? end;
  const before = el.value.slice(0, start), after = el.value.slice(end);
  const text = (from == null && before && !/\s$/.test(before) ? " " : "") + ":" + code + ":" + (/^\s/.test(after) ? "" : " ");
  el.focus();
  el.setSelectionRange(start, end);
  if (!document.execCommand || !document.execCommand("insertText", false, text)) {
    el.setRangeText(text, start, end, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  rememberEmoji(code);
}

// A popover next to `anchor` (a DOMRect): above it when there is room, else below.
function placePopover(node, r, width, left = false) {
  const w = Math.min(width, innerWidth - 16);
  node.style.width = w + "px";
  node.style.left = Math.max(8, Math.min(left ? r.left : r.right - w, innerWidth - w - 8)) + "px";
  const hgt = node.offsetHeight;
  node.style.top = (r.top - hgt - 8 >= 8 ? r.top - hgt - 8 : Math.min(r.bottom + 8, innerHeight - hgt - 8)) + "px";
}

function emojiButton(k) {
  if (!emojiOn()) return null;
  return h("button", { type: "button", class: "btn icon emoji-btn", "aria-label": "Emoji", "aria-haspopup": "dialog",
    title: "Emoji - or type : and a name", onclick: (e) => openEmojiPicker(k, e.currentTarget) }, svg(ICON.smile, 18));
}

function openEmojiPicker(k, button, onPick = null) {
  if (picker && picker.k === k) { closeEmojiPicker(); return; }
  closeEmojiPicker(); closeSuggest();
  const node = h("div", { class: "emoji-picker", role: "dialog", "aria-label": "Choose an emoji" },
    h("p", { class: "hint", text: "Loading emoji …" }));
  // onPick: the emoji itself goes there (a reaction) instead of into a field
  picker = { k, node, onPick, rect: button.getBoundingClientRect(), tab: recentEmoji().length ? "recent" : 0, q: "" };
  document.body.append(node);
  placePopover(node, picker.rect, 344);
  loadEmoji().then(() => { if (picker && picker.node === node) drawPicker(); },
    err => { node.replaceChildren(h("p", { class: "hint", text: "Emoji could not be loaded: " + err.message })); });
}

function closeEmojiPicker(refocus) {
  if (!picker) return;
  const k = picker.k;
  picker.node.remove(); picker = null;
  if (refocus) { const el = emojiField(k); if (el) el.focus(); }
}

function drawPicker() {
  const d = emojiData, P = picker;
  const recent = recentEmoji().filter(c => d.table[c]);
  const tabs = [...(recent.length ? [{ id: "recent", name: "Recently used", icon: "🕘", codes: recent }] : []),
    ...d.categories.map((c, i) => ({ id: i, name: c.name, icon: d.table[c.codes[0]], codes: c.codes }))];
  const pick = (code) => {
    closeEmojiPicker();
    if (P.onPick) { rememberEmoji(code); P.onPick(d.table[code]); } else insertEmoji(P.k, code);
  };
  const cell = (c) => h("button", { type: "button", class: "emo", title: ":" + c + ":", "aria-label": c,
    "data-code": c, onclick: () => pick(c), text: d.table[c] });
  const grid = h("div", { class: "emo-grid", role: "group" });
  const tabRow = h("div", { class: "emo-tabs", role: "tablist", "aria-label": "Categories" });
  const fill = () => {
    const found = P.q ? findEmoji(d, P.q, 160) : null;
    const tab = tabs.find(t => t.id === P.tab) || tabs[0];
    grid.setAttribute("aria-label", found ? "Search results" : tab.name);
    grid.replaceChildren(...(found ? (found.length ? found.map(cell) : [h("p", { class: "hint", text: "No emoji called that." })]) :
      [h("div", { class: "emo-cat", text: tab.name }), ...tab.codes.map(cell)]));
    grid.scrollTop = 0;
    tabRow.replaceChildren(...tabs.map(t => h("button", { type: "button", role: "tab", class: "emo-tab", title: t.name,
      "aria-label": t.name, "aria-selected": !found && t === tab ? "true" : "false", text: t.icon,
      onclick: () => { P.q = ""; search.value = ""; P.tab = t.id; fill(); } })));
  };
  const search = h("input", { type: "search", class: "in emo-search", placeholder: "Search emoji", "aria-label": "Search emoji",
    autocomplete: "off", oninput: (e) => { P.q = e.target.value.trim(); fill(); },
    onkeydown: (e) => {
      if (e.key === "Enter") { e.preventDefault(); const first = grid.querySelector(".emo"); if (first) pick(first.dataset.code); }
    } });
  P.node.replaceChildren(search, tabRow, grid);
  fill();
  placePopover(P.node, P.rect, 344);
  search.focus();
}

// --- completion: ":ta" suggests :tada: and friends; Tab or Enter takes one
function emojiQuery(el) {
  if (!el || !el.dataset || !EMOJI_FIELDS.has(el.dataset.k) || el.selectionStart !== el.selectionEnd || !emojiOn()) return null;
  const before = el.value.slice(0, el.selectionStart);
  const m = /(^|[\s(])(:([a-z0-9_+-]{2,}))$/i.exec(before);
  return m ? { from: before.length - m[2].length, q: m[3] } : null;
}

async function updateSuggest(el) {
  const q = emojiQuery(el);
  if (!q) { closeSuggest(); return; }
  let d;
  try { d = await loadEmoji(); } catch (_) { return; }
  // a redraw while the data came makes a new field: find it again by its data-k
  el = document.querySelector(`[data-k="${el.dataset.k}"]`) || el;
  const now = emojiQuery(el);                       // typing went on while the data came
  if (!now || now.q !== q.q || document.activeElement !== el) return;
  const items = findEmoji(d, q.q, 8);
  if (!items.length) { closeSuggest(); return; }
  const node = suggest ? suggest.node : h("div", { class: "emoji-suggest", role: "listbox", "aria-label": "Emoji" });
  suggest = { k: el.dataset.k, from: q.from, items, i: 0, node };
  if (!node.isConnected) document.body.append(node);
  drawSuggest();
  placePopover(node, el.getBoundingClientRect(), 280, true);    // by the text, not the far edge
}

function drawSuggest() {
  const s = suggest;
  s.node.replaceChildren(...s.items.map((c, i) => h("div", { role: "option", class: "emo-opt" + (i === s.i ? " on" : ""),
    "aria-selected": i === s.i ? "true" : "false", "data-code": c,
    onmousedown: (e) => { e.preventDefault(); s.i = i; takeSuggest(); } },
    h("span", { class: "emo-glyph", text: emojiData.table[c] }), h("span", { class: "mono", text: ":" + c + ":" }))));
}

function takeSuggest() {
  const s = suggest;
  closeSuggest();
  insertEmoji(s.k, s.items[s.i], s.from);
}

function closeSuggest() {
  if (!suggest) return;
  suggest.node.remove(); suggest = null;
}

document.addEventListener("input", (e) => { if (EMOJI_FIELDS.has(e.target.dataset && e.target.dataset.k)) updateSuggest(e.target); }, true);
document.addEventListener("focusout", (e) => { if (suggest && e.target.dataset && e.target.dataset.k === suggest.k) closeSuggest(); }, true);
document.addEventListener("click", (e) => {
  if (EMOJI_FIELDS.has(e.target.dataset && e.target.dataset.k)) updateSuggest(e.target);
}, true);
document.addEventListener("mousedown", (e) => {                       // a click outside closes the picker
  if (picker && !picker.node.contains(e.target) && !(e.target.closest && e.target.closest(".emoji-btn"))) closeEmojiPicker();
  if (reactPop && !reactPop.contains(e.target) && !(e.target.closest && e.target.closest(".react.add"))) closeReactions();
}, true);
window.addEventListener("resize", () => { closeEmojiPicker(); closeSuggest(); closeReactions(); });
// before the page's own keys: Enter must not send while a suggestion is up, Esc
// closes the picker before it closes a dialog
window.addEventListener("keydown", (e) => {
  const el = document.activeElement;
  if (suggest && el && el.dataset && el.dataset.k === suggest.k && !e.isComposing) {
    const move = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (move) { suggest.i = (suggest.i + move + suggest.items.length) % suggest.items.length; drawSuggest(); }
    else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && !e.ctrlKey && !e.metaKey) takeSuggest();
    else if (e.key === "Escape") closeSuggest();
    else return;
    e.preventDefault(); e.stopImmediatePropagation();
  } else if (reactPop && e.key === "Escape") {
    e.preventDefault(); e.stopImmediatePropagation();
    closeReactions();
  } else if (picker && e.key === "Escape") {
    e.preventDefault(); e.stopImmediatePropagation();
    closeEmojiPicker(true);
  } else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) && EMOJI_FIELDS.has(el && el.dataset && el.dataset.k)) {
    setTimeout(() => updateSuggest(el));
  }
}, true);

// ---- keys -----------------------------------------------------------------
document.addEventListener("click", () => { if (S.menuFor) { S.menuFor = null; render(); } });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && S.menuFor) { S.menuFor = null; render(); e.preventDefault(); return; }
  if (e.key === "F1" && TOKEN && S.state) { e.preventDefault(); if (!S.dialog) openAbout(); return; }   // as the TUI
  if (!S.state || !S.state.unlocked || S.state.setup) return;
  const ctrl = e.ctrlKey || e.metaKey;
  // letters work with Shift or Caps Lock too (the hints show capitals); only D is Shift+D, as in the TUI
  const key = e.key.length === 1 && e.key !== "D" ? e.key.toLowerCase() : e.key;
  if (ctrl && (key === "p" || key === "k")) { e.preventDefault(); if (S.dialog) closeDialog(); else openPalette(); return; }
  if (e.key === "Escape") {
    if (S.dialog) { e.preventDefault(); closeDialog(); return; }
    if (typing(document.activeElement)) { document.activeElement.blur(); return; }
    if (S.full) { S.full = false; render(); }
    return;
  }
  if (S.dialog || typing(document.activeElement) || ctrl || e.altKey) return;
  const g = S.data && S.data.group;
  if (reading()) {                     // the terminal client's reader keys
    const cur = S.data.messages.find(x => x.id === S.post);
    const sc = document.querySelector(".reader .scroll");
    const back = () => { S.full = false; render(); };
    const k = {
      n: () => step(1), p: () => step(-1), j: () => step(1), ArrowDown: () => step(1), ArrowUp: () => step(-1),
      q: back, f: back, Enter: back,
      " ": () => { if (sc && sc.scrollTop + sc.clientHeight < sc.scrollHeight - 4) sc.scrollBy({ top: sc.clientHeight * 0.9 }); else nextUnread(); },
      r: () => { if (cur) tryReply(cur, g); },
      m: () => { if (cur && !cur.mine && cur.key) { S.full = false; openGroup("contact:" + cur.key); } },
      "#": () => groupsInPost(cur),
    }[key];
    if (k) { e.preventDefault(); k(); }
    return;
  }
  if (g && g.view === "feed") {                // a feed: entries, not rows (unseenet#490)
    const fk = { ArrowDown: () => feedStep(1), j: () => feedStep(1), ArrowUp: () => feedStep(-1), k: () => feedStep(-1),
      " ": feedNextUnread, r: feedComment }[key];
    if (fk) { e.preventDefault(); fk(); return; }
  }
  if (g && g.view === "pages") {               // a site: its pages, back and forward
    const site = S.data.site || {};
    const pk = { ArrowDown: () => pageStep(1), j: () => pageStep(1), ArrowUp: () => pageStep(-1), k: () => pageStep(-1),
      ArrowLeft: () => siteStep(-1), ArrowRight: () => siteStep(1),
      e: site.may_write && site.page ? () => openPageEditor(g, site, site.page) : null,
      n: site.may_write ? () => openPageEditor(g, site, null) : () => {} }[key];
    if (pk) { e.preventDefault(); pk(); return; }
  }
  const keys = {
    n: () => openCompose(), v: () => toggleView(), m: () => openWrite(), c: () => openContacts(), "@": () => openNames(), g: () => openBrowse(), k: () => openKey(), "?": () => openInfo(),
  };
  if (keys[key]) { e.preventDefault(); keys[key](); return; }
  if (g && (g.view === "feed" || g.view === "pages")) return;     // their own keys, above
  if (g && g.view === "chat") {
    if (e.key === "Enter") { const el = document.querySelector('[data-k="chat"]'); if (el) { e.preventDefault(); el.focus(); } }
    return;
  }
  if (!S.data || !S.data.messages.length) return;
  const cur = S.data.messages.find(x => x.id === S.post);
  if (key === "ArrowDown" || key === "j") { e.preventDefault(); step(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
  else if (e.key === " ") { e.preventDefault(); nextUnread(); }
  else if ((key === "Enter" || key === "f") && cur && cur.notice) { e.preventDefault(); openMentioned(cur); }
  else if (key === "Enter" || key === "f") { e.preventDefault(); S.full = true; render(); }
  else if (key === "r" && cur) { e.preventDefault(); tryReply(cur, g); }
  else if (e.key === "D" && cur && cur.may_withdraw) { e.preventDefault(); openWithdraw(cur); }   // as the TUI's shift+d
  else if (e.key === "#" && cur) { e.preventDefault(); groupsInPost(cur); }
});

// ---- events from the server --------------------------------------------
let sidebarTimer = null;
function connectEvents() {
  if (S.ws) return;
  const ws = new WebSocket(`ws://${location.host}/api/events`, ["unseenet", "unseenet-token." + TOKEN]);
  S.ws = ws;
  ws.onopen = async () => {          // catch up on what happened before we were listening
    try { await loadState(); } catch (_) { }
    await loadGroup(); await loadSidebar();
  };
  ws.onmessage = async (ev) => {
    let e;
    try { e = JSON.parse(ev.data); } catch (_) { return; }
    const type = e.event;
    const sidebarSoon = () => {
      clearTimeout(sidebarTimer);
      sidebarTimer = setTimeout(async () => {
        try { await loadState(); } catch (_) { }
        await loadSidebar();
      }, 250);
    };
    if (type === "status") {
      S.state.status = e.text;
      S.state.connected = /^Connected/.test(e.text) ? true : /^Offline/.test(e.text) ? false : S.state.connected;
      const st = document.querySelector(".statusbar");
      if (st && !S.dialog) st.replaceWith(statusbar()); else render();
    } else if (type === "release-offer") {
      try { await loadState(); } catch (_) { }
      const st = document.querySelector(".statusbar");
      if (st && !S.dialog) st.replaceWith(statusbar());
    } else if (type === "x-gui-update") {
      updateProgress(e.text);
    } else if (type === "groups-changed" || type === "refreshed" || type === "inbox-ready") {
      sidebarSoon();
    } else if (type === "group-updated") {
      if (e.new) sidebarSoon();                                // counts in the sidebar
      if (e.group_id === S.gid || S.gid === FOR_YOU ||
          (S.gid && S.gid.startsWith("contact:") && S.sidebar && e.group_id === S.sidebar.inbox.id)) {
        await loadGroup(); render();
      }
    } else if (type === "node-state") {
      S.nodes = S.nodes || {};
      S.nodes[e.address] = { up: e.up, error: e.error };
    } else if (type === "tor-state") {
      S.tor = { progress: e.progress, summary: e.summary };
      if (e.progress < 100 && !S.dialog) {
        S.state.status = `Tor: ${e.progress}% ${e.summary || ""}`.trim();
        const st = document.querySelector(".statusbar");
        if (st) st.replaceWith(statusbar());
      }
    } else if (type === "ripening") {
      setRipening({ level: e.level, next_at: e.next_at, t: e.t }, true);
      render();                                                 // the sidebar's level, a waiting message, the web's banner
    } else if (type === "ripening-paused") {                    // from this window or another (unseenet#337)
      ripeSamples = [];
      setRipening({ paused: e.paused }, false);
      render();
    } else if (type === "job") {
      await jobEvent(e);
    }
  };
  ws.onclose = () => { S.ws = null; setTimeout(() => { if (S.state && S.state.unlocked) connectEvents(); }, 3000); };
}

// ---- start --------------------------------------------------------------
(async () => {
  render();
  if (!TOKEN) return;
  try {
    await loadState();
    if (S.state.unlocked) await afterUnlock();
  } catch (err) {
    S.state = { unlocked: false, vault: "", vault_exists: true };
    S.error = "The client is not running any more: " + err.message;
  }
  render();
})();
