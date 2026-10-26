// grouptree.js - the group tree in the sidebar (unseenet.client.grouptree, as in the TUI).
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

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

// The sidebar's filter (as / in the terminal client): what matches, in one list.
function filtering() { return !!(S.sideFilter || "").trim(); }
function sideResults(sb, item) {
  if (!sb) return null;
  const q = S.sideFilter.trim().toLowerCase();
  const hit = (...s) => s.some(x => (x || "").toLowerCase().includes(q));
  const people = sb.people.filter(p => hit(p.label, p.key));
  const groups = sb.hierarchies.flatMap(hr => hr.groups).filter(g => hit(g.label, g.id, g.title, g.shown));
  return h("div", { class: "nav side-results" },
    people.length ? [h("h3", { text: "chats" }), people.map(p => h("button", {
      class: `item person${S.gid === p.id ? " on" : ""}${p.unread ? " unread" : ""}`,
      onclick: () => { S.sideFilter = ""; openGroup(p.id); } },
      h("span", { class: `av xs c${p.colour}`, "aria-hidden": "true", text: initials(p.label) }),
      h("span", { class: "nm", text: p.label }), p.unread ? h("span", { class: "count", text: p.unread }) : null))] : null,
    groups.length ? [h("h3", { text: "groups" }), groups.map(g => h("button", {
      class: `item group${S.gid === g.id ? " on" : ""}${g.unread ? " unread" : ""}`, title: g.label,
      onclick: () => { S.sideFilter = ""; openGroup(g.id); } },
      h("span", { class: "ic", text: (g.access || "") + g.icon }), h("span", { class: "nm", text: g.shown || g.label }),
      g.unread ? h("span", { class: "count", text: g.unread }) : null))] : null,
    !people.length && !groups.length ? h("p", { class: "hint", style: "margin:0 10px",
      text: "Nothing you follow matches. G finds groups on your node." }) : null);
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
  const host = address.split(":")[0];
  return host.endsWith(".onion") ? host.slice(0, 8) + "….onion" : address;
}
// A node by name (unseenet#518): the core's label - the known-node list's name, else the
// node's own marked "(unlisted)", else the start of its address.
function nodeLabel(address) {
  const n = address && (S.state.node_names || {})[address];
  return (n && n.label) || (address === S.state.node && S.state.node_label) || shortNode(address);
}
// Is a node reached right now? Its own node-state event (UN-RFC 0046 section 5) once
// there is one; before that, whether the last round reached the network.
function nodeUp(address) {
  const live = address && (S.nodes || {})[address];
  return live ? live.up : (S.state.connected ? true : null);     // null: not known yet
}
// The default node in the box at the bottom left, by name, always (#111): whether it
// is reached is said for that node, not guessed from the status line.
function nodeLink() {
  const node = S.state.node, up = nodeUp(node), live = node && (S.nodes || {})[node];
  const how = up === true ? (S.state.web ? "Entrance and Tor" : "Tor")
    : up === false ? "Not reachable" : "Connecting";
  const why = up === false && live && live.error ? "\n" + live.error : "";
  return h("button", { class: "hint node-link", "data-k": "node-link", title: nodeTitle(node) + why, onclick: openNodes },
    h("span", { class: "dot" + (up === true ? " ok" : up === false ? " bad" : "") }), " ",
    node ? how + " · " + nodeLabel(node) : "No node");
}
function redrawNodeLink() {
  const el = document.querySelector("[data-k='node-link']");
  if (el) el.replaceWith(nodeLink());
}
function nodeTitle(address) {
  if (!address) return "Your nodes";
  const n = (S.state.node_names || {})[address] || {};
  const why = n.source === "self" ? "\nThe node's own name - it is not on the list of known nodes." : "";
  return address + why + "\nClick for your nodes";
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
      h("span", { class: "dot" + (S.state.connected ? " ok" : "") }),
      // "Connected to <node>" only repeats the box at the bottom left (#111)
      S.state.status && !S.state.status_idle ? S.state.status + " · " : "", "pre-alpha"));
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
