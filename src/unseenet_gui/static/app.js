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
function theme(set) {
  let t = null;
  try { if (set) localStorage.setItem("unseenet-theme", set); t = localStorage.getItem("unseenet-theme"); } catch (_) { t = set || null; }
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  return t || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
}
theme();

const S = {
  state: null, sidebar: null, gid: null, data: null, thread: null, replyTo: null,
  pending: {}, drafts: {}, dialog: null, status: "", error: "", busy: false,
  knownNodes: null, setupNode: null, ws: null, mobileReading: false,
  pane: "groups",          // on a phone: one pane at a time - "groups", or the group
  moreTools: false,        // on a phone: the post's less used tools shown
};


// ---- the core's local API (UN-RFC 0046) into what the page draws ------------------
// The answers are the core's (unseenet.client.localapi). These few functions turn
// them into the objects the rest of this file draws, so the drawing stays as it was.
const FOR_YOU = "for-you:";                          // the core's pseudo group (threads.FOR_YOU)
const ACCESS_ICONS = { moderated: "√", channel: "►", closed: "∩" };
const VIEW_ICONS = { chat: "»", data: "¤", threads: "≡" };
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
    depth: r.depth };
}

function fromSidebar(d, st) {
  const groups = d.groups.map(fromGroup), by = {};
  groups.forEach(g => (by[g.hierarchy] = by[g.hierarchy] || []).push(g));
  const fy = d.for_you || {};
  return { for_you: (fy.replies || 0) + (fy.mentions || 0), replies: fy.replies || 0, mentions: fy.mentions || 0,
    people: d.people.map(p => ({ ...p, label: p.name, colour: colour(p.key) })),
    moderation: d.moderation, name_requests: d.name_requests, inbox: d.inbox,
    show_blocked: !!st.show_blocked, hide_bots: !!st.hide_bots,
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
  if (st.ripening) S.ripening = { level: st.ripening.level, next_at: st.ripening.next_at, t: st.ripening.t };
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
};

async function api(method, path, body) {
  const res = await fetch(path, {
    method, headers: { "X-Unseenet-Token": TOKEN || "", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined, cache: "no-store",
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* not JSON */ }
  if (!res.ok) throw new Error((data && data.error) || `${res.status} ${res.statusText}`);
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
function avatar(m, small) {
  return h("span", { class: `av c${m.colour ?? 5}${small ? " s" : ""}`, "aria-hidden": "true", text: initials(m.who) });
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
  return h("button", { class: "name-btn", title: "Their profile", onclick: (e) => { e.stopPropagation(); openProfile(m.key, m.who); } }, nameEl(m.who));
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
  root.replaceChildren(view());
  if (S.dialog) document.getElementById("root").append(S.dialog.render());
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
    S.knownNodes = [];
    api("GET", "/api/known-nodes").then(r => { const n = r.nodes; S.knownNodes = n;
      // a known node at random, so new users do not all start on the first (UN-RFC 0043 5.1)
      if (!S.setupNode && n.length) S.setupNode = n[Math.floor(Math.random() * n.length)].address;
      render(); })
      .catch(() => {});
  }
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
        h("input", { name: "custom", class: "field mono", "data-k": "custom", placeholder: "or an address: xyz.onion or host:port",
          style: "font-size:14px" })] : null,
      h("div", { class: "error", role: "alert", text: S.error }),
      h("button", { class: "btn primary", type: "submit", disabled: S.busy }, S.busy ? "Starting …" : "Start"))));
}

async function afterUnlock() {
  if (S.state.setup) return;
  connectEvents();
  await loadSidebar();
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
    const [data, write] = await Promise.all([
      api("GET", "/api/groups/" + encodeURIComponent(gid)),
      api("GET", "/x/gui/write/" + encodeURIComponent(gid)).catch(() => ({}))]);
    if (S.gid === gid) S.data = { group: fromGroup(data.group), messages: data.rows.map(fromRow), write: write || {} };
  } catch (err) { S.status = err.message; }
}

// ---- may you write here? (#13) -------------------------------------------------
// Said before you write, as the terminal client does: the core's write_permission
// (the kinds a group takes, bans, blocks, posters, closed-group members, comments in
// channels and when they close), from /x/gui/write. Buttons you may not use are
// shown greyed out with the reason, rather than hidden, so people learn why.
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
  return h("nav", { class: "side", "aria-label": "Groups", "data-scroll": "side" },
    h("div", { class: "brand" }, logo(30), "Unseenet"),
    h("button", { class: "search", onclick: () => openPalette() }, svg(ICON.search),
      h("span", { text: "Search and commands" }), h("kbd", { text: "Ctrl P" })),
    sb ? h("div", { class: "nav" },
      item(FOR_YOU, "◄", "For you", forYouMarks(sb)),
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
      h("h3", { class: "row-h" }, h("span", { text: "chats" }),
        h("button", { class: "mini", "aria-label": "Contacts", title: "Your contacts (C)", onclick: openContacts }, svg(ICON.people, 14, 2.5)),
        h("button", { class: "mini", "aria-label": "Chat with someone", title: "Chat with someone", onclick: () => openWrite("", "chat") }, svg(ICON.plus, 14, 2.5))),
      sb.people.length ? sb.people.map(p => h("button", {
        class: `item person${S.gid === p.id ? " on" : ""}${p.unread ? " unread" : ""}${p.contact ? "" : " stranger"}`, onclick: () => openGroup(p.id),
        title: p.contact ? null : "Not a contact - open the chat to add them" },
        h("span", { class: `av xs c${p.colour}`, "aria-hidden": "true", text: initials(p.label) }),
        h("span", { class: "nm", text: p.label }),
        p.unread ? h("span", { class: "count", text: p.unread }) : null)) :
        h("p", { class: "hint", style: "margin:0 10px", text: "Your chats, one per person. Add people as contacts, or start a chat with +." })) : null,
    sb ? sb.hierarchies.map(hier => hierarchyNav(hier, item)) :
      h("p", { class: "muted", text: "Loading your groups …" }),
    sb && !sb.hierarchies.length ? h("div", { class: "nav" },
      h("p", { class: "muted", style: "margin:0 10px", text: "No groups yet." }),
      h("button", { class: "btn", onclick: openBrowse }, "Find groups", h("kbd", { text: "G" }))) : null,
    h("div", { class: "me" },
      h("span", { class: "av s c4", "aria-hidden": "true", text: initials(me.display) }),
      h("div", { class: "who" }, h("div", { text: me.label || me.display || "" }),
        h("div", { class: "hint" }, h("span", { class: "dot" + (S.state.connected ? " ok" : "") }), " ",
          S.state.connected ? (S.state.web ? "Entrance and Tor · " : "Tor · ") + shortNode(S.state.node) : "Not connected")),
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

function statusbar() {
  const g = S.data && S.data.group, chat = g && g.view === "chat";
  const k = (key, label) => h("span", {}, h("kbd", { text: key }), " " + label);
  return h("footer", { class: "statusbar" },
    h("span", { class: "keys" },
      chat ? [k("Esc", "shortcuts"), k("Enter", "write")] :
        [k("N", "new"), k("R", "reply"), k("↑↓", "posts"), k("Space", "next unread"), k("Enter", "full screen")],
      k("V", "chat/threads"), k("?", "about group"), k("Ctrl P", "commands")),
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
    h("span", { class: "chip mono", text: g.view === "chat" ? "» chat" : "≡ threads" }),
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
      g.title ? h("p", { text: g.title }) : null),
    h("div", { class: "actions" },
      g.type === "contact" ? [
        h("button", { class: "btn", onclick: () => openAddContact(g.key, g.contact ? g.label.replace(/ √$/, "") : "") }, g.contact ? "Rename" : "Add contact"),
        h("button", { class: "btn", onclick: () => copy(g.key, "Their key is copied.") }, "Copy key"),
        h("button", { class: "btn primary", title: "A post with a subject instead of a chat line (N)",
          onclick: () => openPost(g.key, g.label.replace(/ √$/, "")) }, "Write a post", h("kbd", { text: "N" }))] : null,
      g.owner && g.type === "closed" ? h("button", { class: "btn", onclick: () => openInvite() }, "Invite") : null,
      canSwitch ? h("button", { class: "btn", onclick: toggleView },
        g.view === "chat" ? "Show as threads" : "Show as chat", h("kbd", { text: "V" })) : null,
      g.type ? h("button", { class: "btn icon", "aria-label": "About this group", title: "About this group (?)", onclick: openInfo, text: "?" }) : null,
      h("button", { class: "btn icon pal-btn", "aria-label": "More: all commands", onclick: () => openPalette() }, "⋯"),
      g.type && !["contact", "inbox"].includes(g.type) && (g.kinds || ["post"]).includes("post") ?
        h("button", offProps(mayWrite(d, "post"), { class: g.view === "chat" ? "btn" : "btn primary", onclick: () => openCompose(),
          title: "A post with a subject (UN-RFC 0028)" }),
          svg(ICON.plus, 16, 2.5), "New post", h("kbd", { text: "N" })) : null));
  return [head, g.view === "chat" ? chatView(d) : threadsView(d)];
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

function threadsView(d) {
  const g = d.group, msgs = d.messages;
  if (!msgs.length) {
    return h("div", { class: "content" }, h("div", { class: "empty" },
      h("h2", { text: g.id === FOR_YOU ? "Nothing for you yet" : "No posts yet" }),
      h("p", { text: g.id === FOR_YOU ? "Replies to your posts, and posts that name you, show up here." :
        mayWrite(d, "post").allowed ? "Be the first: press N to write a post." : mayWrite(d, "post").reason })));
  }
  const cur = currentPost(msgs);
  S.post = cur.id;
  markRead([cur]);
  const pend = Object.entries(S.pending).filter(([, p]) => p.group === g.id && !p.chat);
  const table = h("section", { class: "ptable", "aria-label": "Posts", "data-scroll": "ptable:" + g.id },
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
        m.private && !m.notice ? h("span", { class: "muted", text: "@ " }) : m.encrypted && !m.notice ? h("span", { class: "muted", text: "∩ " }) : null,
        // a reply with the thread's own subject: quieter, so new subjects stand out
        h("span", { class: m.depth && sameSubject(m, msgs) ? "same" : null, text: subjectOf(m) }),
        g.id === FOR_YOU ? h("span", { class: "muted", text: "  (" + (m.notice ? m.notice.label + ", not followed" : labelOf(m.group)) + ")" }) : null),
      h("span", { class: "from mono" }, m.who, m.bot ? h("span", { class: "muted", text: " · bot" }) : null),
      h("span", { class: "date", text: when(m.date) }))),
    pend.map(([job, p]) => h("div", { class: "prow pending" }, h("span", {}),
      h("span", { class: "sj", text: p.body.subject || "" }),
      h("span", { class: "from mono", text: S.state.me.label }),
      h("span", { class: "date" }, p.state === "failed" ?
        h("button", { class: "link", onclick: () => retry(job), title: p.error || "" }, "Not sent - again") : pendingState(p)))));
  return h("div", { class: "content news" + (S.full ? " full" : "") + (S.mobileReading ? " reading" : "") },
    table, readerPane(g, cur, msgs));
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
  return m.markdown ? h("div", { class: "md" }, renderTree(m.tree || [])) : renderBody(m.text || "");
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
    }
  });
  return out;
}

// A chat line: its paragraphs inline, as one bubble (the chat subset has no blocks but code).
function renderChatLine(m) {
  const blocks = m.tree || [];
  return blocks.map((b, i) => [i ? h("br") : null,
    b.t === "code" ? h("pre", { class: "mdcode" }, h("code", { text: b.v })) :
    b.t === "p" ? h("span", {}, renderInline(b.c)) : h("div", { class: "md" }, renderTree([b]))]);
}

function renderInline(nodes) {
  return nodes.map(n => {
    switch (n.t) {
      case "text": return linkGroups(n.v);
      case "br": return h("br");
      case "code": return h("code", { text: n.v });
      case "em": return h("em", {}, renderInline(n.c));
      case "strong": return h("strong", {}, renderInline(n.c));
      case "del": return h("del", {}, renderInline(n.c));
      case "emoji": return h("span", { class: "emoji", title: ":" + n.name + ":", text: n.v });
      case "image": return h("span", { class: "mdimg", title: "An attachment - attachments come with UN-RFC 0027", text: "[image: " + (n.alt || "no description") + "]" });
      case "link": {
        const shown = inlineText(n.c);
        return h("a", { class: "mdlink", href: n.href, title: n.href, rel: "noopener noreferrer",
          onclick: (e) => { e.preventDefault(); openLink(n.href); } },
          renderInline(n.c), shown.trim() !== n.href ? h("span", { class: "addr", text: " " + n.href }) : null);
      }
      default: return null;
    }
  });
}

// ---- #group references (unseenet #172) ----------------------------------
// The same rule as the core's group_refs(): '#' and a group name (a-z, digits, + _ -
// and dots), maybe '@' and the start of the owner's fingerprint. Not '# heading',
// not '#170', not inside a word or a URL.
const GROUP_REF = /(?<![\p{L}\p{N}_@#\/&.+-])#(?=[a-z0-9+_.-]*[a-z])([a-z0-9][a-z0-9+_-]*(?:\.[a-z0-9][a-z0-9+_-]*)*)(?:@([a-z2-7]{4,16}))?(?![\p{L}\p{N}_+@-]|\.[\p{L}\p{N}_])/gu;

function linkGroups(text) {
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
  if (url.protocol === "unseenet:" || url.protocol === "news:") {
    copy(href, "The link is copied.");
    return;
  }
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
        m.signature ? h("p", { class: "sig", text: "-- \n" + m.signature }) : null)),
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
    send: (subject, text, notify) => g.private_reply ?
      doSend("/api/private", g.id, { key: m.key, subject, body: text, reply_to: m.id }, { text }) :
      doPost(g.id, { subject, body: text, references: [...m.references, m.id], signature: false, notify }, { text }) });
}

// Edit your own post (UN-RFC 0042): a new version, in the same place in its thread.
function openEdit(m, g) {
  openComposeWindow({ g, title: "Edit your post in " + g.label, subject: m.subject, edit: true, cursor: 0,
    body: (m.text || "").trimEnd() + "\n" + (m.signature ? "\n-- \n" + m.signature + "\n" : ""),
    send: (subject, text) => doSend(`/api/groups/${encodeURIComponent(g.id)}/edit`, g.id,
      { id: m.id, subject, body: text }, { text }) });
}

function openComposeWindow({ g, title, subject, body, cursor, send, private: priv, edit }) {
  // mention notices (UN-RFC 0032): who would be told, and a box to say no
  const N = { may: !priv && !edit && g && g.type !== "closed", names: [], max: 5,
    on: !(S.sidebar && S.sidebar.notices && S.sidebar.notices.send === false), timer: null };
  const askWho = () => {
    clearTimeout(N.timer);
    N.timer = setTimeout(async () => {
      const f = document.querySelector(".dialog form");
      if (!f || !N.may) return;
      try {
        const r = await api("POST", `/api/groups/${encodeURIComponent(g.id)}/mentioned`, { subject: f.subject.value, body: f.body.value });
        N.may = r.may; N.names = r.names; N.max = r.max || 5;
      } catch (_) { return; }
      const el = document.getElementById("notify-who");
      if (el) el.textContent = whoText();
    }, 400);
  };
  const whoText = () => !N.names.length ? "" : !N.on ?
    `Nobody is told: ${N.names.join(", ")} see it only if they follow the group.` :
    "Told: " + N.names.slice(0, N.max).join(", ") +
      (N.names.length > N.max ? `  (at most ${N.max}; not told: ${N.names.slice(N.max).join(", ")})` : "");
  const go = async (e) => {
    e && e.preventDefault();
    const f = document.querySelector(".dialog form");
    const s = f.subject.value.trim(), b = f.body.value.replace(/\s+$/, "");
    const own = b.split(/\n-- \n/)[0].split("\n").filter(ln => !/^>/.test(ln) && !/ wrote:$/.test(ln)).join("").trim();
    if (!s || !own) { toast("Write something of your own above the signature."); return; }
    closeDialog();
    await send(s, b, N.may ? N.on : undefined);
    toast(edit ? "Saving the new version - postage takes a few seconds." :
      priv ? "Sending - sealed to them." : "Sending - postage takes a few seconds." +
      (N.may && N.on && N.names.length ? ` ${Math.min(N.names.length, N.max)} told in a few minutes.` : ""));
  };
  S.dialog = { focus: "#body", render: () => dialogShell({ label: title, wide: true },
    h("div", { class: "dh" }, h("h2", { text: title }),
      h("button", { class: "btn primary dh-send", onclick: go }, priv ? "Send" : "Post"),   // phones: above the keyboard
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("form", { class: "db", onsubmit: go, onkeydown: (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") go(e); } },
      h("label", { for: "subject", text: "Subject" }),
      h("input", { id: "subject", name: "subject", class: "in", "data-k": "csubject", autocomplete: "off", value: subject }),
      h("label", { for: "body", text: "Text" }),
      h("textarea", { id: "body", name: "body", class: "in compose-body mono", "data-k": "cbody", value: body, spellcheck: "true", oninput: askWho }),
      N.may ? h("label", { class: "check" }, h("input", { type: "checkbox", checked: N.on,
        onchange: (e) => { N.on = e.target.checked; const el = document.getElementById("notify-who"); if (el) el.textContent = whoText(); } }),
        " Tell the people you mention (a notice in their inbox)") : null,
      N.may ? h("p", { id: "notify-who", class: "hint", style: "margin:0", text: whoText() }) : null,
      h("p", { class: "hint", style: "margin:0", text: (priv ? "Sealed to them: only they can read it. " :
        "Cut the quote down to what you answer. Signed with your key; a little proof-of-work is added. ") +
        (S.sidebar && S.sidebar.markdown === false ? "Plain text." : "Markdown: *emphasis*, **strong**, `code`, - lists, > quotes, :tada:") })),
    h("div", { class: "df btns" }, h("button", { class: "btn", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn primary", onclick: go }, priv ? "Send" : "Post", h("kbd", { text: "Ctrl S" })))) };
  render();
  const ta = document.getElementById("body");
  if (ta && cursor != null) { ta.focus(); ta.setSelectionRange(cursor, cursor); ta.scrollTop = 0; }
  const sj = document.getElementById("subject");
  if (sj) sj.addEventListener("input", askWho);
  askWho();
}

function pendingState(p) {
  if (p.state === "failed") return h("span", { class: "state bad", text: "Not sent: " + (p.error || "") });
  if (p.state === "sent") return h("span", { class: "state" }, svg(ICON.check, 14, 2.5), "sent");
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
    grp.col.append(h("div", { class: "bubble" + (isPost ? " is-post" : ""), title: when(m.date) + (m.encrypted ? " · encrypted" : "") },
      quoted ? h("span", { class: "quote" }, h("span", { class: "mono", text: quoted.who }), " · " + (subjectOf(quoted) || quoted.text.slice(0, 80))) : null,
      isPost ? h("div", { class: "lsub", text: "≡ " + (m.subject || "(no subject)") }) : null,
      m.readable ? (m.markdown ? renderChatLine(m) : linkGroups(m.text)) : h("i", { text: m.error || "Could not be read." }),
      isPost && g.type !== "contact" && mayReply(d, m).allowed && (g.kinds || []).includes("post") ?
        h("div", { class: "lact" }, h("button", { class: "link", onclick: () => openReply(m, g) },
          commenting(d) ? "Comment with a quote" : "Reply with a quote")) : null));
    if (m.mine) grp.lastMine = m;
  }
  flush();
  const last = out[out.length - 1];
  if (msgs.length && msgs[msgs.length - 1].mine && last.classList && last.classList.contains("mg")) {
    last.querySelector(".col").append(h("div", { class: "state ok" }, svg(ICON.checks, 14, 2.5), "reached the node"));
  }
  for (const [job, p] of Object.entries(S.pending)) {
    if (p.group !== g.id || !p.chat || p.state === "reached") continue;
    out.push(h("div", { class: "mg mine" }, h("div", { class: "col" },
      h("div", { class: "bubble " + (p.state === "failed" ? "failed" : "pending"), text: p.text }),
      p.state === "failed" ? h("div", { class: "state bad" }, "Not sent: " + (p.error || ""), " ",
        h("button", { class: "link", onclick: () => { retry(job); } }, "Try again")) : pendingState(p))));
  }
  if (msgs.length === 0 && !Object.keys(S.pending).length) {
    out.push(h("div", { class: "empty" }, h("h2", { text: "Quiet here" }), h("p", { text: g.type === "contact" || mayWrite(d, "chat").allowed ? "Say hello below." : "" })));
  }
  const cp = g.type === "contact" ? { allowed: true } : mayWrite(d, "chat");
  const send = () => {
    const input = document.querySelector('[data-k="chat"]');
    const text = input.value.trim();
    if (!text) return;
    if (g.type === "contact") doSend("/api/private", g.id, { key: g.key, body: text, chat: true }, { text, chat: true });
    else doPost(g.id, { body: text, chat: true }, { text, chat: true });
    input.value = ""; S.drafts["chat:" + g.id] = "";
  };
  return h("div", { class: "content" }, h("section", { class: "chat", "aria-label": "Messages" },
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
        h("button", { class: "send", type: "submit", "aria-label": "Send" }, svg(ICON.send, 18, 2.5))),
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

async function doSend(path, gid, body, local) {
  const sent = { ...body, kind: body.chat ? "chat" : "post" };     // UN-RFC 0028
  delete sent.chat;
  try {
    let r;
    try { r = await api("POST", path, sent); }
    catch (err) {           // a group whose posts are also published outside Tor: ask first
      if (!/portal|outside Tor/i.test(err.message) || !window.confirm(err.message + "\n\nPost anyway?")) throw err;
      r = await api("POST", path, { ...sent, publish_outside_tor: true });
    }
    S.pending[r.job] = { group: gid, state: "pow", body, path, ...local };
  } catch (err) {
    S.pending["local" + Date.now()] = { group: gid, state: "failed", error: err.message, body, path, ...local };
  }
  render();
}

function retry(job) {
  const p = S.pending[job];
  delete S.pending[job];
  doSend(p.path || `/api/groups/${encodeURIComponent(p.group)}/post`, p.group, p.body, { text: p.text, chat: p.chat, thread: p.thread });
}

async function toggleView() {
  const g = S.data && S.data.group;
  if (!g || !g.type || g.type === "inbox") return;
  const next = g.view === "chat" ? "threads" : "chat";
  await api("POST", `/api/groups/${encodeURIComponent(g.id)}/view`, { view: next });
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
        h("dt", { text: "ID" }), h("dd", { class: "mono", text: g.id })),
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
  const pick = (name, value, current, label, small) => h("button", { type: "button", class: "choice", "aria-pressed": String(current === value),
    onclick: () => { if (name === "kinds") kinds = value; else view = value; render(); } },
    h("span", {}, h("span", { text: label }), h("small", { text: small })));
  formDialog({ label: "Edit group", title: "Edit " + g.label, focus: "#etitle", button: "Save",
    values: { title: g.title || "", description: g.description || "", rules: g.rules || "",
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
      h("label", { for: "erules", text: "Rules - shown to people before they post" }),
      h("textarea", { id: "erules", name: "rules", class: "in", "data-k": "erules", style: "min-height:110px", value: vals.rules }),
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "markdown", checked: !!vals.markdown }),
        " Markdown: # headings, - lists, **strong**, [links](https://…), :tada: (no pictures)")],
    submit: async (v) => {
      const rules = v.rules.trim();
      await api("POST", `/api/groups/${encodeURIComponent(g.id)}/settings`,
        { title: v.title.trim(), description: v.description.trim(), rules,
          rules_type: v.markdown && rules ? MARKDOWN : null, view, kinds });
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

async function toggleBots() {
  const on = !(S.sidebar && S.sidebar.hide_bots);
  await api("POST", "/api/settings", { hide_bots: on });
  await loadSidebar(); await loadGroup(); render();
  toast(on ? "Posts by bots are hidden." : "You see bots again, marked bot.");
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
  const g = S.data && S.data.group;
  if (!g || !m || !m.may_withdraw) return;
  formDialog({ label: "Withdraw post", title: "Withdraw “" + subjectOf(m) + "”", focus: ".dialog .btn.primary", button: "Withdraw",
    note: "Every node is asked to delete it. People who read it already keep their copy, and nodes or programs that ignore withdrawals can keep it.",
    fields: () => [h("p", { style: "margin:0", text: m.mine ? "Your post." : "A post by " + m.who + "." })],
    submit: async () => {
      await api("POST", `/api/groups/${encodeURIComponent(g.id)}/withdraw`, { id: m.id });
      closeDialog(); S.post = null; await loadGroup(); render(); toast("Withdrawn.");
    } });
}

// Report a post to the people who can act on it (#74).
function openReport(m) {
  const g = S.data && S.data.group;
  if (!g || !m) return;
  let targets = null, err = "";
  const chosen = new Set();
  api("GET", `/api/groups/${encodeURIComponent(g.id)}/report?id=${encodeURIComponent(m.id)}`)
    .then(r => { const t = r.targets; targets = t; t.forEach(x => chosen.add(x.i)); if (S.dialog) render(); })
    .catch(e => { err = e.message; if (S.dialog) render(); });
  formDialog({ label: "Report post", title: "Report “" + subjectOf(m) + "”", focus: "#rnote", button: "Report",
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
    send: (subject, text, notify) => doPost(g.id, { subject, body: text, signature: false, notify }, { text }) });
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

function formDialog({ label, title, focus, fields, submit, button, note, values }) {
  let err = "";
  const vals = { ...(values || {}) };       // kept across re-renders (choices re-render the dialog)
  const keep = (e) => { if (e.target.name) vals[e.target.name] = e.target.type === "checkbox" ? e.target.checked : e.target.value; };
  const go = async (e) => {
    e && e.preventDefault();
    const f = document.querySelector(".dialog form");
    f.querySelectorAll("[name]").forEach(el => keep({ target: el }));
    try { await submit(vals, f); }
    catch (x) { err = x.message; render(); }
  };
  S.dialog = { focus, render: () => dialogShell({ label },
    h("div", { class: "dh" }, h("h2", {}, title), h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("form", { class: "db", onsubmit: go, oninput: keep, onchange: keep }, fields(vals), note ? h("p", { class: "hint", style: "margin:0", text: note }) : null,
      h("div", { class: "error", role: "alert", text: err })),
    h("div", { class: "df btns" }, h("button", { class: "btn", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn primary", onclick: go }, button))) };
  render();
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
  return ((S.sidebar && S.sidebar.people) || []).filter(p => p.contact);
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
        h("label", { for: "wtext", text: "Message" }),
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
    send: (subject, text) => doSend("/api/private", inbox,
      { key, subject, body: text, ...(replyTo ? { reply_to: replyTo } : {}) }, { text }) });
  if (!subject) setTimeout(() => { const s = document.getElementById("subject"); if (s) s.focus(); });
}

function openCreateGroup() {
  let gtype = "open", view = "threads", kinds = "both";
  const pick = (name, value, current, label, small) => h("button", { type: "button", class: "choice", "aria-pressed": String(current === value),
    onclick: () => { if (name === "type") gtype = value; else if (name === "kinds") kinds = value; else view = value; render(); } },
    h("span", {}, h("span", { text: label }), h("small", { text: small })));
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
      h("div", { class: "choices row" }, pick("view", "threads", view, "≡ Threads", "posts and replies"), pick("view", "chat", view, "» Chat", "messages in order")),
      h("label", { text: "Takes" }),
      h("div", { class: "choices row" },
        pick("kinds", "both", kinds, "Both", "posts and chat lines"),
        pick("kinds", "post", kinds, "≡ Posts only", "a discussion group"),
        pick("kinds", "chat", kinds, "» Chat lines only", "a chat group")),
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "fast", checked: !!vals.fast }), " Fast delivery: nodes pass messages on at once (less hiding of where they came from)"),
      h("label", { for: "gtitle", text: "Title" }),
      h("input", { id: "gtitle", name: "title", class: "in", "data-k": "gtitle", value: vals.title || "", placeholder: "One line about the group" })],
    submit: async (v) => {
      toast("Creating the group - proof-of-work takes a moment …");
      const { id } = await api("POST", "/api/groups", { name: v.name, type: gtype, view, kinds, fast: !!v.fast, title: v.title });
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
      await api("POST", "/x/gui/passphrase", { old: v.old || "", new: v.pw });
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

async function openProfile(key, who = "") {
  let p = null, err = "";
  const draw = () => dialogShell({ label: "Profile" },
    h("div", { class: "dh" }, h("h2", { text: (p && p.label) || who || "Profile" }),
      p && p.profile && p.profile.bot ? h("span", { class: "chip", text: "bot" }) : null,
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db" },
      h("div", { class: "keybox", text: key }),
      err ? h("p", { class: "error", text: err }) :
      !p ? h("p", { class: "muted", style: "margin:0", text: "Reading the profile over Tor …" }) : profileBody(p)),
    h("div", { class: "df btns" },
      p && p.mine ? h("button", { class: "btn", onclick: () => openMyProfile() }, "Edit") : null,
      p && !p.mine ? h("button", { class: "btn", title: "Only you stop seeing it (UN-RFC 0022 section 9.2)", onclick: async () => {
        try { await api("POST", "/x/gui/profile/hide", { key, hidden: !p.hidden }); }
        catch (x) { toast(x.message); return; }
        toast(p.hidden ? "Profile shown." : "Profile hidden."); openProfile(key, who); } }, p.hidden ? "Show" : "Hide") : null,
      h("button", { class: "btn primary", onclick: closeDialog }, "Close")));
  S.dialog = { focus: ".dialog .btn.primary", render: draw };
  render();
  try { p = await api("GET", "/x/gui/profile?key=" + encodeURIComponent(key)); }
  catch (x) { err = x.message; }
  if (S.dialog && S.dialog.render === draw) render();
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
  try { p = await api("GET", "/x/gui/profile"); } catch (x) { toast(x.message); return; }
  if (!p.published) {               // the warning before the first, as in the TUI
    confirmDialog({ title: "Before you publish a profile", text: p.warning, button: "I understand", ok: () => editProfile(p) });
    return;
  }
  editProfile(p);
}

function editProfile(p) {
  const cur = p.profile || {};
  const md = cur.about ? /markdown/i.test(cur.about_type || "") : !(S.sidebar && S.sidebar.markdown === false);
  const publish = async (body) => {
    await api("POST", "/x/gui/profile", body);
    closeDialog(); toast(body.remove ? "Your profile is removed." : "Your profile is published.");
  };
  formDialog({ label: "Your profile", title: "Your public profile - anybody can read it", focus: "#pabout", button: "Publish",
    values: { about: cur.about || "", markdown: md, lang: (cur.lang || []).join(", "), links: linksText(cur.links) },
    note: "Kinds of links: " + (p.link_kinds || []).join(", ") + ", or x-something. Links are shown as written; nobody checks them.",
    fields: (vals) => [
      h("label", { for: "pabout", text: "About you - a few lines, or a small home page" }),
      h("textarea", { id: "pabout", name: "about", class: "in", "data-k": "pabout", value: vals.about, style: "min-height:120px" }),
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "markdown", checked: !!vals.markdown }),
        " Markdown - # headings, - lists, **strong**, [links](https://...), :tada: (no pictures)"),
      h("label", { for: "plang", text: "Languages you write, e.g. da, en" }),
      h("input", { id: "plang", name: "lang", class: "in", "data-k": "plang", value: vals.lang }),
      h("label", { for: "plinks", text: "Links, one per line: kind address  (# a label)" }),
      h("textarea", { id: "plinks", name: "links", class: "in mono", "data-k": "plinks", value: vals.links, style: "min-height:80px" }),
      p.published ? h("button", { type: "button", class: "link", onclick: () => confirmDialog({ title: "Remove your profile?",
        text: "Nodes stop showing it. Copies others already kept cannot be taken back.", button: "Remove", danger: true,
        ok: () => publish({ remove: true }).catch(x => toast(x.message)) }) }, "Remove your profile") : null],
    submit: async (v) => {
      const links = parseLinks(v.links || "");
      const body = { about: v.about || "", markdown: !!v.markdown, lang: v.lang || "", links };
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
    // the owner's and moderators' tools, as in the TUI's Ctrl+P
    { name: "To approve: posts waiting in groups you moderate", key: "", run: openModeration },
    { name: "Edit this group", key: "", when: g && g.owner, run: openEditGroup },
    { name: "Moderators and posters", key: "", when: g && g.owner && g.type !== "closed", run: openRoles },
    { name: "Banned from this group", key: "", when: g && g.owner, run: () => openBanned() },
    { name: "Remove this group from the network", key: "", when: g && g.owner, run: openRemoveGroup },
    { name: "Unsubscribe from this group", key: "", when: g && g.type && !["inbox", "contact"].includes(g.type), run: () => leaveGroup(g) },
    { name: "Withdraw the selected post", key: "D", when: selectedPost() && selectedPost().may_withdraw, run: () => openWithdraw(selectedPost()) },
    { name: "Go to a #group in the selected post", key: "#", when: selectedPost() && (selectedPost().groups || []).length, run: () => groupsInPost(selectedPost()) },
    { name: "Report the selected post", key: "", when: selectedPost() && !selectedPost().mine && !selectedPost().private, run: () => openReport(selectedPost()) },
    { name: "Add a contact", key: "", run: () => openAddContact("", "") },
    { name: "Invite to this closed group", key: "", when: g && g.owner && g.type === "closed", run: openInvite },
    { name: "Edit your signature", key: "", run: openSignature },
    { name: "Profile of this author: about, languages, links (UN-RFC 0022)", key: "", when: selectedPost() && selectedPost().key,
      run: () => openProfile(selectedPost().key, selectedPost().who) },
    { name: "Your profile: write, change or remove it", key: "", run: openMyProfile },
    { name: "Change passphrase (copies of the vault elsewhere keep the old one)", key: "", run: openPassphrase },
    { name: "Update Unseenet", key: "", when: !!S.state.update, run: openUpdate },
    { name: "Network and Wi-Fi", key: "", when: S.state.bootable, run: openNetwork },
    { name: "Restart the computer", key: "", when: S.state.bootable, run: () => power("reboot") },
    { name: "Shut down the computer", key: "", when: S.state.bootable, run: () => power("poweroff") },
    { name: theme() === "light" ? "Use the dark theme" : "Use the light theme", key: "", run: () => { theme(theme() === "light" ? "dark" : "light"); render(); } },
    { name: "Show my key", key: "K", run: openKey },
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

// ---- keys -----------------------------------------------------------------
document.addEventListener("keydown", (e) => {
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
  const keys = {
    n: () => openCompose(), v: () => toggleView(), m: () => openWrite(), c: () => openContacts(), "@": () => openNames(), g: () => openBrowse(), k: () => openKey(), "?": () => openInfo(),
  };
  if (keys[key]) { e.preventDefault(); keys[key](); return; }
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
      S.ripening = { level: e.level, next_at: e.next_at, t: e.t };
      sidebarSoon();
      if (Object.keys(S.pending).length) render();             // a waiting message shows it
    } else if (type === "job") {                                // a post on its way (section 5)
      const p = S.pending[e.job];
      if (!p) return;
      if (e.state === "pow" || e.state === "ripening") {
        const before = p.state + Math.round((p.fraction || 0) * 100);
        p.state = e.state; p.fraction = e.fraction;
        if (p.state + Math.round((e.fraction || 0) * 100) !== before) render();   // at most a hundred redraws
        return;
      }
      p.state = e.state; p.error = e.error;
      if (e.state === "reached") {
        delete S.pending[e.job];
        if (S.gid === p.group) await loadGroup();   // your own post shows up; the selection stays put
      }
      if (e.state === "failed") toast("Not sent: " + (e.error || "unknown error"));
      render();
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
