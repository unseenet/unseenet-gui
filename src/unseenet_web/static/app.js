/* Unseenet web client.
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
};

// ---- helpers ------------------------------------------------------------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "value") el.value = v;
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
  root.replaceChildren(view());
  if (S.dialog) document.getElementById("root").append(S.dialog.render());
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
    h("p", { class: "muted", text: "This page needs the one-time address that unseenet-web prints when it starts. " +
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
    try { S.state = await api("POST", "/api/unlock", { passphrase: pass }); await afterUnlock(); }
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
    h("div", { class: "statuscard" },
      h("div", { text: "Tor starts when the vault is open." }),
      h("div", { class: "muted", text: "Nothing leaves this computer except through Tor. The window loads nothing from the internet." })),
    h("p", { class: "note" }, h("strong", { text: "Pre-alpha. " }),
      "The code has not had a security review. Do not rely on it to protect anyone yet.")));
}

// ---- the bootable image: network, keyboard, power ------------------------------
let SYS = null;
async function loadSystem() {
  try { SYS = await api("GET", "/api/system"); } catch (_) { SYS = null; }
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
        const r = await api("POST", "/api/system/keyboard", { layout: e.target.value });
        toast(r.restart ? "Changing the keyboard …" : "The keyboard changes at the next start.");
      } }, (s.keyboards || []).map(k => h("option", { value: k.id, selected: k.id === s.keyboard ? "" : null, text: "⌨ " + k.name }))),
    h("button", { class: "btn", onclick: () => power("reboot") }, "Restart"),
    h("button", { class: "btn", onclick: () => power("poweroff") }, "Shut down"));
}

async function power(action) {
  if (!confirm(action === "poweroff" ? "Shut down the computer?" : "Restart the computer?")) return;
  try { await api("POST", "/api/system/power", { action }); } catch (_) { }
  document.getElementById("root").replaceChildren(h("div", { class: "unlock" },
    h("p", { class: "muted", text: action === "poweroff" ? "Shutting down …" : "Restarting …" })));
}

function openNetwork() {
  const nets = {}, busy = {};
  let msg = "", pick = null;
  loadSystem();
  const scan = async (dev) => {
    busy[dev] = true; render();
    try { nets[dev] = await api("POST", "/api/system/wifi", { action: "scan", device: dev }); }
    catch (e) { msg = e.message; }
    busy[dev] = false; render();
  };
  const connect = async (dev, name, pass) => {
    msg = "Connecting to " + name + " …"; render();
    try {
      const r = await api("POST", "/api/system/wifi", { action: "connect", device: dev, name, passphrase: pass });
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
    api("GET", "/api/known-nodes").then(n => { S.knownNodes = n; if (!S.setupNode && n[0]) S.setupNode = n[0].address; render(); })
      .catch(() => {});
  }
  const submit = async (e) => {
    e.preventDefault();
    const f = e.target;
    S.busy = true; S.error = ""; render();
    try {
      S.state = await api("POST", "/api/setup", {
        display: needName ? f.display.value : "", node: needNode ? (f.custom.value.trim() || S.setupNode || "") : "" });
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
  try { S.sidebar = await api("GET", "/api/groups"); }
  catch (err) { S.status = err.message; }
  if (!S.gid) {
    const first = allGroups()[0];
    if (first) await openGroup(first.id, false);
  }
  render();
}

async function openGroup(gid, rerender = true) {
  if (S.gid !== gid) { S.post = null; S.postAt = null; S.full = false; S.mobileReading = false; }
  S.gid = gid;
  await loadGroup();
  if (rerender) render();
  const g = S.data && S.data.group;
  if (g && g.view === "chat") setTimeout(() => { const i = document.querySelector('[data-k="chat"]'); if (i) i.focus(); });
}

async function loadGroup() {
  if (!S.gid) return;
  const gid = S.gid;
  try {
    const data = await api("GET", "/api/groups/" + encodeURIComponent(gid));
    if (S.gid === gid) S.data = data;
  } catch (err) { S.status = err.message; }
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
  return h("div", { class: "app" + (reading() ? " reading-full" : "") },
    h("div", { class: "body" }, sidebar(), h("main", { class: "main" }, mainArea())),
    statusbar());
}

function sidebar() {
  const sb = S.sidebar, me = S.state.me || {};
  const item = (gid, ic, label, extra, cls = "") => h("button", {
    class: `item ${cls}${S.gid === gid ? " on" : ""}`, onclick: () => openGroup(gid),
    "aria-current": S.gid === gid ? "page" : null },
    h("span", { class: "ic", text: ic }), h("span", { class: "nm", text: label }), extra);
  return h("nav", { class: "side", "aria-label": "Groups", "data-scroll": "side" },
    h("div", { class: "brand" }, logo(30), "Unseenet"),
    h("button", { class: "search", onclick: () => openPalette() }, svg(ICON.search),
      h("span", { text: "Search and commands" }), h("kbd", { text: "Ctrl K" })),
    sb ? h("div", { class: "nav" },
      item("for-you", "◄", "For you", sb.for_you ? h("span", { class: "foryou", text: `◄${sb.for_you}` }) : null),
      sb.inbox.id ? item(sb.inbox.id, "@", "Letters",
        sb.inbox.unread ? h("span", { class: "count", text: sb.inbox.unread }) : null) : null) : null,
    sb ? h("div", { class: "nav" },
      h("h3", { class: "row-h" }, h("span", { text: "people" }),
        h("button", { class: "mini", "aria-label": "Chat with someone", title: "Chat with someone", onclick: () => openWrite("", "chat") }, svg(ICON.plus, 14, 2.5))),
      sb.people.length ? sb.people.map(p => h("button", {
        class: `item person${S.gid === p.id ? " on" : ""}${p.unread ? " unread" : ""}`, onclick: () => openGroup(p.id) },
        h("span", { class: `av xs c${p.colour}`, "aria-hidden": "true", text: initials(p.label) }),
        h("span", { class: "nm", text: p.label }),
        p.unread ? h("span", { class: "count", text: p.unread }) : null)) :
        h("p", { class: "hint", style: "margin:0 10px", text: "Add people as contacts, then write to them here." })) : null,
    sb ? sb.hierarchies.map(hier => h("div", { class: "nav" },
      h("h3", { text: hier.name + ".*" }),
      hier.groups.map(g => item(g.id, (g.access || "") + g.icon, g.label, [
        g.for_you ? h("span", { class: "foryou", text: `◄${g.for_you}` }) : null,
        g.unread ? h("span", { class: "count", text: g.unread }) : null], "group" + (g.unread ? " unread" : ""))))) :
      h("p", { class: "muted", text: "Loading your groups …" }),
    sb && !sb.hierarchies.length ? h("div", { class: "nav" },
      h("p", { class: "muted", style: "margin:0 10px", text: "No groups yet." }),
      h("button", { class: "btn", onclick: openBrowse }, "Find groups", h("kbd", { text: "G" }))) : null,
    h("div", { class: "me" },
      h("span", { class: "av s c4", "aria-hidden": "true", text: initials(me.display) }),
      h("div", { class: "who" }, h("div", { text: me.label || me.display || "" }),
        h("div", { class: "hint" }, h("span", { class: "dot" + (S.state.connected ? " ok" : "") }), " ",
          S.state.connected ? "Tor · " + shortNode(S.state.node) : "Not connected")),
      h("button", { class: "btn icon", "aria-label": "Show my key", title: "Show my key (K)", onclick: openKey, text: "K" })));
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
      k("V", "chat/threads"), k("?", "about group"), k("Ctrl K", "commands")),
    h("span", { class: "grow" }),
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
    S.mobileReading ? h("button", { class: "btn icon back", "aria-label": "Back to threads", onclick: () => { S.mobileReading = false; render(); } }, svg(ICON.back)) : null,
    h("div", { class: "t" },
      h("div", { class: "row" }, h("h1", { text: g.label }), chips),
      g.title ? h("p", { text: g.title }) : null),
    h("div", { class: "actions" },
      g.type === "contact" ? [
        h("button", { class: "btn", onclick: () => openAddContact(g.key, g.contact ? g.label.replace(/ √$/, "") : "") }, g.contact ? "Rename" : "Add contact"),
        h("button", { class: "btn", onclick: () => copy(g.key, "Their key is copied.") }, "Copy key"),
        h("button", { class: "btn primary", title: "A letter with a subject instead of a chat line (N)",
          onclick: () => openLetter(g.key, g.label.replace(/ √$/, "")) }, "Write a letter", h("kbd", { text: "N" }))] : null,
      g.owner && g.type === "closed" ? h("button", { class: "btn", onclick: () => openInvite() }, "Invite") : null,
      canSwitch ? h("button", { class: "btn", onclick: toggleView },
        g.view === "chat" ? "Show as threads" : "Show as chat", h("kbd", { text: "V" })) : null,
      g.type ? h("button", { class: "btn icon", "aria-label": "About this group", title: "About this group (?)", onclick: openInfo, text: "?" }) : null,
      g.view !== "chat" && g.may_post ? h("button", { class: "btn primary", onclick: () => openCompose() },
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
      h("h2", { text: g.id === "for-you" ? "Nothing for you yet" : "No posts yet" }),
      h("p", { text: g.id === "for-you" ? "Replies to your posts, and posts that name you, show up here." :
        g.may_post ? "Be the first: press N to write a post." : "" })));
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
        m.private ? h("span", { class: "muted", text: "@ " }) : m.encrypted ? h("span", { class: "muted", text: "∩ " }) : null,
        // a reply with the thread's own subject: quieter, so new subjects stand out
        h("span", { class: m.depth && sameSubject(m, msgs) ? "same" : null, text: subjectOf(m) }),
        g.id === "for-you" ? h("span", { class: "muted", text: "  (" + labelOf(m.group) + ")" }) : null),
      h("span", { class: "from mono", text: m.who }),
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
      } else if (t.trim() || out.length) out.push(h("p", { class: "text", text: t }));
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

function readerPane(g, m, msgs) {
  const marks = [];
  if (m.mine) marks.push(h("span", { class: "sm", text: "you" }));
  else if (m.contact) marks.push(h("span", { class: "sm", text: "contact" }));
  marks.push(h("span", { class: "sm", text: when(m.date) }));
  if (m.for_me === "reply") marks.push(h("span", { class: "sm you", text: "◄ reply to you" }));
  if (m.for_me === "mention") marks.push(h("span", { class: "sm you", text: "♦ names you" }));
  if (m.encrypted) marks.push(h("span", { class: "sm lock" }, svg(ICON.lock, 12, 2.5), " encrypted"));
  else if (m.private && m.verified) marks.push(h("span", { class: "sm ok" }, svg(ICON.check, 13, 2.5), " verified sender"));
  else if (!m.private) marks.push(h("span", { class: "sm ok" }, svg(ICON.check, 13, 2.5), " signed"));
  const parent = m.references.length ? msgs.find(x => x.id === m.references[m.references.length - 1]) : null;
  const canReply = (g.may_post || g.private_reply) && g.id !== "for-you" && m.readable && m.key;
  const pos = msgs.indexOf(m);
  return h("article", { class: "reader", "aria-label": "Post" },
    S.full ? h("div", { class: "fullbar" },
      h("span", { class: "mono", text: g.label }), h("span", { class: "grow" }),
      h("span", { class: "hint", text: "N next · P previous · Space page, then next unread · R reply · Esc back" })) : null,
    h("div", { class: "scroll", "data-scroll": "post:" + m.id },
      h("h2", { text: subjectOf(m) }),
      h("div", { class: "post" }, avatar(m),
        h("div", { class: "pb" }, h("div", { class: "ph" }, nameEl(m.who), marks),
          parent ? h("button", { class: "inreply", onclick: () => { S.post = parent.id; render(); } },
            "In reply to ", h("span", { class: "mono", text: parent.who })) : null)),
      h("div", { class: "pbody" },
        m.readable ? renderBody(m.text) : h("p", { class: "text bad", text: m.error || "Could not be read." }),
        m.signature ? h("p", { class: "sig", text: "-- \n" + m.signature }) : null)),
    h("div", { class: "pbar" },
      canReply ? h("button", { class: "btn primary", onclick: () => openReply(m, g) }, "Reply", h("kbd", { text: "R" })) : null,
      g.id === "for-you" ? h("button", { class: "btn", onclick: async () => {
        await openGroup(m.group); S.post = m.id; render(); } }, "Open in " + labelOf(m.group)) : null,
      !m.mine && m.key && !(m.private && m.kind === "chat") ? h("button", { class: "btn", title: "A private chat with them",
        onclick: () => openGroup("contact:" + m.key) }, "Chat") : null,
      !m.mine && m.key && !g.private_reply ? h("button", { class: "btn", title: "A private letter with a subject",
        onclick: () => openLetter(m.key, m.who.replace(/ √$/, "")) }, "Write a letter") : null,
      !m.mine && m.key && !m.contact ? h("button", { class: "btn", onclick: () => openAddContact(m.key, m.who.replace(/~.*$/, "").replace(/^@/, "")) }, "Add contact") : null,
      h("span", { class: "grow" }),
      h("span", { class: "hint", text: `${pos + 1} of ${msgs.length}` }),
      h("button", { class: "btn icon", "aria-label": "Previous post", title: "Previous (↑)", onclick: () => step(-1) }, "↑"),
      h("button", { class: "btn icon", "aria-label": "Next post", title: "Next (↓)", onclick: () => step(1) }, "↓"),
      h("button", { class: "btn", title: "Space", onclick: nextUnread }, "Next unread", h("kbd", { text: "Space" })),
      h("button", { class: "btn", title: S.full ? "Back to the list (Esc)" : "Read full screen (F or Enter)",
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
  try { const s = await api("GET", "/api/signature"); return s.preview || ""; } catch (_) { return ""; }
}

// A post's title in the list; a chat among the letters shows its first line (UN-RFC 0028).
function subjectOf(m) {
  if (m.private && m.kind === "chat") {
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
    send: (subject, text) => g.private_reply ?
      doSend("/api/private", g.id, { key: m.key, subject, body: text, reply_to: m.id }, { text }) :
      doPost(g.id, { subject, body: text, references: [...m.references, m.id], signature: false }, { text }) });
}

function openComposeWindow({ g, title, subject, body, cursor, send, private: priv }) {
  const go = async (e) => {
    e && e.preventDefault();
    const f = document.querySelector(".dialog form");
    const s = f.subject.value.trim(), b = f.body.value.replace(/\s+$/, "");
    const own = b.split(/\n-- \n/)[0].split("\n").filter(ln => !/^>/.test(ln) && !/ wrote:$/.test(ln)).join("").trim();
    if (!s || !own) { toast("Write something of your own above the signature."); return; }
    closeDialog();
    await send(s, b);
    toast(priv ? "Sending - sealed to them." : "Sending - postage takes a few seconds.");
  };
  S.dialog = { focus: "#body", render: () => dialogShell({ label: title, wide: true },
    h("div", { class: "dh" }, h("h2", { text: title }), h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("form", { class: "db", onsubmit: go, onkeydown: (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") go(e); } },
      h("label", { for: "subject", text: "Subject" }),
      h("input", { id: "subject", name: "subject", class: "in", "data-k": "csubject", autocomplete: "off", value: subject }),
      h("label", { for: "body", text: "Text" }),
      h("textarea", { id: "body", name: "body", class: "in compose-body mono", "data-k": "cbody", value: body, spellcheck: "true" }),
      h("p", { class: "hint", style: "margin:0", text: priv ? "Sealed to them: only they can read it." :
        "Cut the quote down to what you answer. Signed with your key; a little proof-of-work is added." })),
    h("div", { class: "df btns" }, h("button", { class: "btn", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn primary", onclick: go }, priv ? "Send" : "Post", h("kbd", { text: "Ctrl S" })))) };
  render();
  const ta = document.getElementById("body");
  if (ta && cursor != null) { ta.focus(); ta.setSelectionRange(cursor, cursor); ta.scrollTop = 0; }
}

function pendingState(p) {
  if (p.state === "failed") return h("span", { class: "state bad", text: "Not sent: " + (p.error || "") });
  if (p.state === "sent") return h("span", { class: "state" }, svg(ICON.check, 14, 2.5), "sent");
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
      if (!m.mine) col.append(h("div", { class: "hd" }, nameEl(m.who), h("span", { class: "hint", text: when(m.date, false) })));
      else col.append(h("div", { class: "hint", text: when(m.date, false) }));
      grp = { key: m.key, at: d0, col, el: h("div", { class: "mg" + (m.mine ? " mine" : "") }, m.mine ? null : avatar(m, true), col) };
    }
    grp.at = d0 || grp.at;
    const quoted = m.references.length && byId[m.references[m.references.length - 1]];
    grp.col.append(h("div", { class: "bubble", title: when(m.date) + (m.encrypted ? " · encrypted" : "") },
      quoted ? h("span", { class: "quote" }, h("span", { class: "mono", text: quoted.who }), " · " + quoted.text.slice(0, 80)) : null,
      m.readable ? m.text : h("i", { text: m.error || "Could not be read." })));
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
    out.push(h("div", { class: "empty" }, h("h2", { text: "Quiet here" }), h("p", { text: g.may_post ? "Say hello below." : "" })));
  }
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
    g.may_post ? h("form", { class: "chatbar", onsubmit: (e) => { e.preventDefault(); send(); } },
      h("div", { class: "row" },
        h("label", { for: "chat", class: "sr", text: "Message " + g.label }),
        h("input", { id: "chat", type: "text", "data-k": "chat", autocomplete: "off",
          placeholder: "Message " + (g.access || "") + (g.access ? " " : "") + g.label, value: S.drafts["chat:" + g.id] || "",
          oninput: (e) => { S.drafts["chat:" + g.id] = e.target.value; } }),
        h("button", { class: "send", type: "submit", "aria-label": "Send" }, svg(ICON.send, 18, 2.5))),
      h("div", { class: "hint" }, h("kbd", { text: "Enter" }), " sends · ", h("kbd", { text: "Esc" }), " for shortcuts",
        g.type === "contact" ? " · sealed to them" : g.encrypted ? " · encrypted for the members" : " · signed with your key")) :
      h("div", { class: "chatbar hint", text: "Only chosen people can write here." })));
}

// ---- posting ------------------------------------------------------------
function doPost(gid, body, local) {
  return doSend(`/api/groups/${encodeURIComponent(gid)}/post`, gid, body, local);
}

async function doSend(path, gid, body, local) {
  try {
    const { job } = await api("POST", path, body);
    S.pending[job] = { group: gid, state: "pow", body, path, ...local };
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
        h("dt", { text: "Delivery" }), h("dd", { text: g.fast ? "fast: nodes pass it on at once" : "normal: nodes wait a random time" }),
        h("dt", { text: "Owner" }), h("dd", { text: g.owner ? "you" : "the key after @ in the ID" }),
        h("dt", { text: "ID" }), h("dd", { class: "mono", text: g.id })),
      g.rules ? [h("h3", { style: "margin:4px 0 0;font-size:14px", text: "Rules" }), h("p", { class: "text", style: "margin:0", text: g.rules })] : null,
      g.members && g.members.length ? [h("h3", { style: "margin:4px 0 0;font-size:14px", text: `Members (${g.members.length})` }),
        g.members.map(m => h("div", { class: "member" }, h("span", { class: `av xs c${m.colour}`, text: initials(m.label) }),
          h("span", { class: "mono", text: m.label })))] : null),
    g.owner && g.type === "closed" ? h("div", { class: "df btns" }, h("button", { class: "btn primary", onclick: openInvite }, "Invite someone")) : null) };
  render();
}

async function openCompose() {
  const g = S.data && S.data.group;
  if (g && g.type === "contact") { openLetter(g.key, g.label.replace(/ √$/, "")); return; }   // N in a chat: a letter
  if (!g || !g.may_post || g.view === "chat") return;
  const sig = await signatureText();
  openComposeWindow({ g, title: "New post in " + g.label, subject: "", cursor: 0,
    body: "\n\n" + (sig ? "-- \n" + sig + "\n" : ""),
    send: (subject, text) => doPost(g.id, { subject, body: text, signature: false }, { text }) });
  setTimeout(() => { const s = document.getElementById("subject"); if (s) s.focus(); });
}

function openBrowse() {
  let list = null, filter = "", err = "";
  api("GET", "/api/browse").then(l => { list = l; if (S.dialog) render(); }).catch(e => { err = e.message; if (S.dialog) render(); });
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

// Write to someone by their key: a letter (a subject, read on its own) or a chat
// (a line in a running conversation). UN-RFC 0028; the same choice as in the TUI.
function openWrite(key = "", kind = "letter") {
  if (kind === "letter" && key) { openLetter(key); return; }
  formDialog({ values: { key, body: "", subject: "" },
    label: kind === "chat" ? "Chat with someone" : "Write a letter",
    title: kind === "chat" ? "Chat with someone" : "Write a letter",
    focus: key ? (kind === "chat" ? "#wtext" : "#wsubject") : "#wkey", button: kind === "chat" ? "Send" : "Write …",
    note: kind === "chat" ? "Sealed to their key: the node cannot read it, nor see who sent it. To write a letter instead: M." :
      "Next you write the letter in the compose window. To chat instead: Ctrl P, Chat with someone.",
    fields: (vals) => [
      h("label", { for: "wkey", text: "Their key" }),
      h("input", { id: "wkey", name: "key", class: "in mono", value: vals.key, "data-k": "wkey", placeholder: "ed25519:… - they find it with K", autocomplete: "off" }),
      kind === "chat" ? [
        h("label", { for: "wtext", text: "Message" }),
        h("textarea", { id: "wtext", name: "body", class: "in", "data-k": "wtext", style: "min-height:120px", value: vals.body })] :
      [h("label", { for: "wsubject", text: "Subject" }),
        h("input", { id: "wsubject", name: "subject", class: "in", "data-k": "wsubject", value: vals.subject, autocomplete: "off" })]],
    submit: async (v) => {
      const k = v.key.trim();
      if (!k) throw new Error("Their key, please.");
      if (kind === "chat") {
        const body = (v.body || "").trim();
        if (!body) throw new Error("Write a message, please.");
        const gid = "contact:" + k;
        closeDialog();
        await openGroup(gid);
        await doSend("/api/private", gid, { key: k, body, chat: true }, { text: body, chat: true });
      } else {
        closeDialog();
        openLetter(k, "", (v.subject || "").trim());
      }
    } });
}

// The compose window for a letter: subject, text, your signature; sent to their inbox.
async function openLetter(key, who = "", subject = "", replyTo = null, quote = "") {
  const sig = await signatureText();
  const top = quote;
  const inbox = S.sidebar && S.sidebar.inbox.id;
  openComposeWindow({ g: null, title: "Letter to " + (who || key.slice(0, 20) + "…"), subject, private: true,
    body: top + "\n" + (sig ? "-- \n" + sig + "\n" : ""), cursor: top.length,
    send: (subject, text) => doSend("/api/private", inbox,
      { key, subject, body: text, ...(replyTo ? { reply_to: replyTo } : {}) }, { text }) });
  if (!subject) setTimeout(() => { const s = document.getElementById("subject"); if (s) s.focus(); });
}

function openCreateGroup() {
  let gtype = "open", view = "threads";
  const pick = (name, value, current, label, small) => h("button", { type: "button", class: "choice", "aria-pressed": String(current === value),
    onclick: () => { if (name === "type") gtype = value; else view = value; render(); } },
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
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "fast", checked: !!vals.fast }), " Fast delivery: nodes pass messages on at once (less hiding of where they came from)"),
      h("label", { for: "gtitle", text: "Title" }),
      h("input", { id: "gtitle", name: "title", class: "in", "data-k": "gtitle", value: vals.title || "", placeholder: "One line about the group" })],
    submit: async (v) => {
      toast("Creating the group - proof-of-work takes a moment …");
      const { id } = await api("POST", "/api/groups", { name: v.name, type: gtype, view, fast: !!v.fast, title: v.title });
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
  const cur = await api("GET", "/api/signature");
  formDialog({ values: { template: cur.template }, label: "Signature", title: "Your signature", focus: "#sig", button: "Save",
    note: "Added below your posts (not chat). {name}, {key} and {fp} are filled in. Empty: no signature. At most 4 lines.",
    fields: (vals) => [h("label", { for: "sig", class: "sr", text: "Signature" }),
      h("textarea", { id: "sig", name: "template", class: "in mono", value: vals.template, "data-k": "sig", style: "min-height:100px" })],
    submit: async (v) => { await api("POST", "/api/signature", { template: v.template }); closeDialog(); toast("Signature saved."); } });
}

function commands() {
  const g = S.data && S.data.group;
  const cmds = [
    { name: "New post", key: "N", when: g && g.may_post && g.view !== "chat", run: openCompose },
    { name: "Switch between chat and threads", key: "V", when: g && g.type && g.type !== "inbox", run: toggleView },
    { name: "About this group: rules, type, owner", key: "?", when: g && g.type, run: openInfo },
    { name: "Find groups on your nodes", key: "G", run: openBrowse },
    { name: "Create a group", key: "", run: openCreateGroup },
    { name: "Write a letter (paste their key)", key: "M", run: () => openWrite("", "letter") },
    { name: "Add a contact", key: "", run: () => openAddContact("", "") },
    { name: "Invite to this closed group", key: "", when: g && g.owner && g.type === "closed", run: openInvite },
    { name: "Edit your signature", key: "", run: openSignature },
    { name: "Network and Wi-Fi", key: "", when: S.state.bootable, run: openNetwork },
    { name: "Restart the computer", key: "", when: S.state.bootable, run: () => power("reboot") },
    { name: "Shut down the computer", key: "", when: S.state.bootable, run: () => power("poweroff") },
    { name: theme() === "light" ? "Use the dark theme" : "Use the light theme", key: "", run: () => { theme(theme() === "light" ? "dark" : "light"); render(); } },
    { name: "Show my key", key: "K", run: openKey },
    { name: "Refresh now", key: "", run: () => api("POST", "/api/refresh").then(() => toast("Refreshing …")) },
    { name: "Letters", key: "", when: S.sidebar && S.sidebar.inbox.id, run: () => openGroup(S.sidebar.inbox.id) },
    { name: "Chat with someone", key: "", run: () => openWrite("", "chat") },
    { name: "For you: replies and mentions", key: "", run: () => openGroup("for-you") },
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
        h("kbd", { text: "Esc" })),
      h("div", { class: "db list", "data-scroll": "palette" },
        acts.length ? [h("div", { class: "sect", text: "Commands" }), acts.map(row)] : null,
        grps.length ? [h("div", { class: "sect", text: "Your groups" }), grps.map(row)] : null,
        !list.length ? h("p", { class: "muted", style: "padding:12px", text: "Nothing matches." }) : null),
      h("div", { class: "df" }, h("span", { text: "↑↓ move" }), h("span", { text: "Enter run" }), h("span", { text: "Esc close" })));
  } };
  render();
}

// ---- keys -----------------------------------------------------------------
document.addEventListener("keydown", (e) => {
  if (!S.state || !S.state.unlocked || S.state.setup) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && (e.key === "k" || e.key === "p")) { e.preventDefault(); if (S.dialog) closeDialog(); else openPalette(); return; }
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
      r: () => { if (cur && (g.may_post || g.private_reply) && g.id !== "for-you") openReply(cur, g); },
      m: () => { if (cur && !cur.mine && cur.key) { S.full = false; openGroup("contact:" + cur.key); } },
    }[e.key];
    if (k) { e.preventDefault(); k(); }
    return;
  }
  const keys = {
    n: () => openCompose(), v: () => toggleView(), m: () => openWrite(), g: () => openBrowse(), k: () => openKey(), "?": () => openInfo(),
  };
  if (keys[e.key]) { e.preventDefault(); keys[e.key](); return; }
  if (g && g.view === "chat") {
    if (e.key === "Enter") { const el = document.querySelector('[data-k="chat"]'); if (el) { e.preventDefault(); el.focus(); } }
    return;
  }
  if (!S.data || !S.data.messages.length) return;
  const cur = S.data.messages.find(x => x.id === S.post);
  if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); step(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
  else if (e.key === " ") { e.preventDefault(); nextUnread(); }
  else if (e.key === "Enter" || e.key === "f") { e.preventDefault(); S.full = true; render(); }
  else if (e.key === "r" && cur && (g.may_post || g.private_reply) && g.id !== "for-you") { e.preventDefault(); openReply(cur, g); }
});

// ---- events from the server --------------------------------------------
let sidebarTimer = null;
function connectEvents() {
  if (S.ws) return;
  const ws = new WebSocket(`ws://${location.host}/api/events`, ["unseenet", "unseenet-token." + TOKEN]);
  S.ws = ws;
  ws.onopen = async () => {          // catch up on what happened before we were listening
    try { S.state = await api("GET", "/api/state"); } catch (_) { }
    await loadGroup(); await loadSidebar();
  };
  ws.onmessage = async (ev) => {
    let e;
    try { e = JSON.parse(ev.data); } catch (_) { return; }
    if (e.type === "status") {
      S.state.status = e.text;
      S.state.connected = /^Connected/.test(e.text) ? true : /^Offline/.test(e.text) ? false : S.state.connected;
      const st = document.querySelector(".statusbar");
      if (st && !S.dialog) st.replaceWith(statusbar()); else render();
    } else if (e.type === "groups") {
      clearTimeout(sidebarTimer);
      sidebarTimer = setTimeout(async () => {
        try { S.state = await api("GET", "/api/state"); } catch (_) { }
        await loadSidebar();
      }, 250);
    } else if (e.type === "group" && (e.id === S.gid || S.gid === "for-you" ||
               (S.gid && S.gid.startsWith("contact:") && S.sidebar && e.id === S.sidebar.inbox.id))) {
      await loadGroup(); render();
    } else if (e.type === "post") {
      const p = S.pending[e.job];
      if (!p) return;
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
    S.state = await api("GET", "/api/state");
    if (S.state.unlocked) await afterUnlock();
  } catch (err) {
    S.state = { unlocked: false, vault: "", vault_exists: true };
    S.error = "The client is not running any more: " + err.message;
  }
  render();
})();
