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
// Which branches of the group tree are open, as this browser keeps them.
function foldState() {
  if (folds) return folds;
  try { folds = JSON.parse(localStorage.getItem(FOLDS_KEY) || "{}") || {}; } catch (_) { folds = {}; }
  return folds;
}
// Open or close a branch of the group tree, and keep it so in this browser.
function setFold(path, open) {
  foldState()[path] = open;
  try { localStorage.setItem(FOLDS_KEY, JSON.stringify(folds)); } catch (_) { /* not kept */ }
}
// Whether a branch of the tree holds a group, at any depth.
function treeHas(node, gid) {
  return node.groups.includes(gid) || node.children.some(c => treeHas(c, gid));
}
// Every group in a branch of the tree, at any depth.
function treeGroups(node) {
  return node.groups.concat(...node.children.map(treeGroups));
}
// Whether a branch is shown open: as folded by hand, else open when it is a hierarchy's
// root or holds the group shown.
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

// A sub-group's name with its leading dot shown quietly (".history.egypt").
function dotted(name) {           // ".history.egypt" with a quiet leading dot
  return name.startsWith(".") ? [h("span", { class: "dot-pre", text: "." }), name.slice(1)] : name;
}

// The sidebar's filter (as / in the terminal client): what matches, in one list.
function filtering() { return !!(S.sideFilter || "").trim(); }
// The sidebar while filtering: the groups and people whose names match, without the tree.
function sideResults(sb, item) {
  if (!sb) return null;
  const q = S.sideFilter.trim().toLowerCase();
  const hit = (...s) => s.some(x => (x || "").toLowerCase().includes(q));
  const people = sb.people.filter(p => hit(p.label, p.key));
  const groups = sb.hierarchies.flatMap(hr => hr.groups).filter(g => hit(g.label, g.id, g.title, g.shown));
  return h("div", { class: "nav side-results" },
    people.length ? [h("h3", { text: "people" }), people.map(p => h("button", {
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

// One hierarchy in the sidebar as a tree of groups (unseenet.client.grouptree), with unread
// counts on closed branches. A heading and a group with the same name are one row (gui#167):
// `unseenet` is the group and folds what is under it; a hierarchy with only one group you
// follow is that group alone, by its full name, without a heading.
function hierarchyNav(hier, item) {
  const byId = Object.fromEntries(hier.groups.map(g => [g.id, g]));
  const unreadIn = node => treeGroups(node).reduce((n, id) => n + ((byId[id] || {}).unread || 0), 0);
  const groupsIn = node => treeGroups(node).map(id => byId[id]).filter(Boolean);
  const suffix = g => { const at = g.label.indexOf("@"); return at >= 0 ? g.label.slice(at) : ""; };
  const fullName = g => g.label.split("@")[0];
  // a group's row: the button, and its ⋯ (also on a right click)
  const leaf = (id, shown, extra = []) => {
    const g = byId[id];
    if (!g) return null;
    return groupRow(g, item(g.id, (g.access || "") + g.icon, dotted(shown + suffix(g)), [
      timelineMark(g), forYouMarks(g),
      g.unread ? h("span", { class: "count", text: g.unread }) : null], "group" + (g.unread ? " unread" : ""), g.label), extra);
  };
  // "Mark all read" for the groups under a heading, when any of them has something unread
  const readAll = (node, name) => {
    const gs = groupsIn(node).filter(g => g.unread);
    return gs.length ? [["Mark all read in " + name, () => markAllRead(gs)]] : [];
  };
  const toggle = node => { setFold(node.path, !isOpen(node, node === hier.tree)); render(); };
  // a heading that is also a group (unseenet with .chat and .help under it): the arrow folds,
  // the name opens the group, and closed it counts what is unread under it
  const headGroup = (node, shown, root) => {
    const g = byId[node.groups[0]], open = isOpen(node, root), unread = unreadIn(node);
    const count = open ? g.unread : unread;
    return h("div", { class: "fold" + (root ? " top" : "") },
      groupRow(g, [
        h("button", { class: "car-btn", type: "button", "aria-expanded": open ? "true" : "false",
          "aria-label": (open ? "Fold " : "Unfold ") + node.path + ".*", title: (open ? "Fold " : "Unfold ") + node.path + ".*",
          onclick: () => toggle(node) }, open ? "▾" : "▸"),
        item(g.id, (g.access || "") + g.icon, dotted(shown + suffix(g)), [
          timelineMark(g), forYouMarks(g),
          count ? h("span", { class: "count", text: count }) : null],
          "group head" + (count ? " unread" : ""), g.label)],
        [[node.path + ".*", [...readAll(node, node.path), [open ? "Fold" : "Unfold", () => toggle(node)]]]], "headrow"),
      open ? h("div", { class: "sub" }, under(node)) : null);
  };
  // what is under a heading: its other groups of the same name, then its folders and groups
  const under = node => [
    node.groups.slice(1).map(id => leaf(id, node.own)),
    node.children.map(c => c.children.length ? folder(c) : c.groups.map(id => leaf(id, "." + c.label)))];
  const contents = node => [
    node.groups.map(id => leaf(id, node.own)),                   // alt.history inside .history
    node.children.map(c => c.children.length ? folder(c) : c.groups.map(id => leaf(id, "." + c.label)))];
  const folder = node => {
    if (node.groups.length && byId[node.groups[0]]) return headGroup(node, "." + node.label, false);
    const open = isOpen(node, false), unread = unreadIn(node);
    return h("div", { class: "fold" },
      h("button", { class: "item group folder" + (unread ? " unread" : ""), "aria-expanded": open ? "true" : "false",
        title: node.path + ".*", onclick: () => toggle(node) },
        h("span", { class: "ic", text: open ? "▾" : "▸" }), h("span", { class: "nm" }, dotted("." + node.label)),
        !open && unread ? h("span", { class: "count", text: unread }) : null),
      open ? h("div", { class: "sub" }, contents(node)) : null);
  };
  if (!hier.tree) return h("div", { class: "nav" }, h("h3", { text: hier.name }),
    hier.groups.map(g => leaf(g.id, fullName(g))));
  const root = hier.tree;
  // one group you follow here: just that group, by its full name
  const only = treeGroups(root);
  if (only.length === 1 && byId[only[0]]) return h("div", { class: "nav solo" }, leaf(only[0], fullName(byId[only[0]])));
  if (root.groups.length && byId[root.groups[0]]) return h("div", { class: "nav" }, headGroup(root, hier.name, true));
  const open = isOpen(root, true), unread = unreadIn(root), menuId = "hier:" + hier.name;
  return h("div", { class: "nav" },
    h("h3", { class: "row-h fold-h grouprow", oncontextmenu: (e) => { e.preventDefault(); S.menuFor = menuId; render(); } },
      h("button", { class: "fold-t", "aria-expanded": open ? "true" : "false",
        title: open ? "Fold " + hier.name + ".*" : "Unfold " + hier.name + ".*",
        onclick: () => toggle(root) },
        h("span", { class: "car", text: open ? "▾" : "▸" }), hier.name),
      !open && unread ? h("span", { class: "count", text: unread }) : null,
      sideMenu(menuId, "More for " + hier.name + ".*",
        [[null, [...readAll(root, hier.name).map(([, run]) => ["Mark all read", run]), [open ? "Fold" : "Unfold", () => toggle(root)]]]])),
    open ? contents(root) : null);
}

// What you follow because of a person (gui#210, unseenet#706): under "People you follow",
// one row per person by name - their feed and site together under them, or just the one
// row when they have only one - never hierarchies called "feed" and "site".
function peopleFollowedNav(sb, item) {
  const people = sb.people_followed || [];
  if (!people.length) return null;
  const KIND = { feed: ["☰", "feed"], site: ["⌂", "site"] };
  const unreadOf = p => p.items.reduce((n, x) => n + (x.g.unread || 0), 0);
  const counted = (n) => n ? h("span", { class: "count", text: n }) : null;
  const open = "people:" in foldState() ? foldState()["people:"] : true;
  return h("div", { class: "nav people-followed" },
    h("h3", { class: "row-h fold-h" },
      h("button", { class: "fold-t", "aria-expanded": String(open), title: open ? "Fold" : "Unfold",
        onclick: () => { setFold("people:", !open); render(); } },
        h("span", { class: "car", text: open ? "▾" : "▸" }), "People you follow"),
      !open && people.some(unreadOf) ? counted(people.reduce((n, p) => n + unreadOf(p), 0)) : null),
    open ? people.map(p => {
      if (p.items.length === 1) {                       // one thing of theirs: one row
        const { kind, g } = p.items[0];
        return groupRow(g, item(g.id, KIND[kind][0], p.label, [timelineMark(g), forYouMarks(g), counted(g.unread)],
          "group person-group" + (g.unread ? " unread" : ""), `${p.label}'s ${KIND[kind][1]}`));
      }
      const key = "person:" + p.fingerprint, popen = key in foldState() ? foldState()[key] : p.items.some(x => x.g.id === S.gid);
      return h("div", { class: "fold" },
        h("button", { class: "item group folder person-group" + (unreadOf(p) ? " unread" : ""),
          "aria-expanded": String(popen), title: p.label, onclick: () => { setFold(key, !popen); render(); } },
          h("span", { class: "ic", text: popen ? "▾" : "▸" }),
          h("span", { class: "nm", text: p.label }), !popen ? counted(unreadOf(p)) : null),
        popen ? h("div", { class: "sub" }, p.items.map(({ kind, g }) =>
          groupRow(g, item(g.id, KIND[kind][0], KIND[kind][1], [timelineMark(g), forYouMarks(g), counted(g.unread)],
            "group" + (g.unread ? " unread" : ""), `${p.label}'s ${KIND[kind][1]}`)))) : null);
    }) : null);
}

// The mark of a group whose entries come into your timeline (UN-RFC 0034 section 6.2).
function timelineMark(g) {
  return g.in_timeline ? h("span", { class: "tl-mark", title: "In your timeline" },
    "•", h("span", { class: "sr", text: " in your timeline" })) : null;
}

// A group's row in the sidebar: its button(s) and its ⋯, which a right click opens too.
// ``more`` adds sections to the menu (the hierarchy, for a heading that is a group).
function groupRow(g, buttons, more = [], cls = "") {
  const id = "group:" + g.id;
  return h("div", { class: "grouprow " + cls, oncontextmenu: (e) => { e.preventDefault(); S.menuFor = id; render(); } },
    buttons, groupMenu(g, more));
}

// The ⋯ of a group in the sidebar (gui#167): about it, mark it read, its address, the
// owner's settings, unsubscribe. Per-group notifications are not here: notifications are
// For you's, not a group's.
function groupMenu(g, more = []) {
  return sideMenu("group:" + g.id, "More for " + g.label, [
    [more.length ? "This group" : null, [
      ["About this group", () => withGroup(g.id, openInfo)],
      g.unread ? ["Mark all read", () => markAllRead([g])] : null,
      ["Copy address", () => copyGroupAddress(g)],
      g.owner ? ["Edit group", () => withGroup(g.id, openEditGroup)] : null,
      g.owner && g.emoji_possible ? ["The group's emoji", () => withGroup(g.id, openGroupEmoji)] : null,
      g.timeline_possible ? [g.in_timeline ? "Take out of the timeline" : "Add to the timeline",
        () => setTimeline(g, !g.in_timeline)] : null,
      ["Leave", () => unsubscribeGroup(g)]]],
    ...more]);
}

// A ⋯ menu in the sidebar, in sections ([title or null, [[label, run] ...]]), placed where
// the window has room so the sidebar's scrolling does not cut it off.
function sideMenu(id, label, sections) {
  sections = sections.map(([t, items]) => [t, items.filter(Boolean)]).filter(([, items]) => items.length);
  if (!sections.length) return null;
  const open = S.menuFor === id;
  if (open) requestAnimationFrame(() => placePostMenu(".side-more.open"));
  return h("div", { class: "more side-more" + (open ? " open" : "") },
    h("button", { class: "morebtn", type: "button", "aria-label": label, title: label, "aria-haspopup": "menu",
      "aria-expanded": String(open), onclick: (e) => { e.stopPropagation(); S.menuFor = open ? null : id; render(); } }, "⋯"),
    open ? h("div", { class: "menu", role: "menu" }, sections.map(([title, items]) => [
      title ? h("div", { class: "msect", role: "presentation", text: title }) : null,
      items.map(([text, run]) => h("button", { class: "mi", type: "button", role: "menuitem",
        onclick: (e) => { e.stopPropagation(); S.menuFor = null; render(); run(); } }, text))])) : null);
}

// Do something about a group that works on the group shown (About, Edit group): open it first.
async function withGroup(gid, run) {
  if (S.gid !== gid) await openGroup(gid);
  run();
}

// Mark every post in these groups read. The core takes Message-IDs, at most 500 at a time,
// until it can mark a whole group (unseenet#625).
async function markAllRead(groups) {
  try {
    for (const g of groups) {
      const d = await api("GET", "/api/groups/" + encodeURIComponent(g.id));
      const ids = d.rows.filter(r => !r.read && r.message && r.message.id).map(r => r.message.id);
      for (let i = 0; i < ids.length; i += 500)
        await api("POST", `/api/groups/${encodeURIComponent(g.id)}/read`, { ids: ids.slice(i, i + 500) });
    }
  } catch (x) { toast(x.message); return; }
  if (groups.some(g => g.id === S.gid)) await loadGroup();
  await loadSidebar();
  toast(groups.length === 1 ? groups[0].label + " is read." : "All read.");
}

// Copy a group's unseenet: address, which the sidebar does not carry: ask the core for it.
async function copyGroupAddress(g) {
  try {
    const d = await api("GET", "/api/groups/" + encodeURIComponent(g.id));
    if (d.group.address) copy(d.group.address, "The group's address is copied.");
    else toast("This group has no address to copy.");
  } catch (x) { toast(x.message); }
}

// Stop following a group from the sidebar, the shown one or another.
async function unsubscribeGroup(g) {
  try { await api("POST", "/api/subscribe", { id: g.id, on: false }); } catch (x) { toast(x.message); return; }
  if (S.gid === g.id) { S.gid = null; S.data = null; }
  await loadSidebar();
  toast("You no longer follow " + g.label + ". G finds it again.");
}

// A node's address made short for the status bar (an onion address cut in the middle).
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
// Draw the status bar's node link again, without drawing the whole page.
function redrawNodeLink() {
  const el = document.querySelector("[data-k='node-link']");
  if (el) el.replaceWith(nodeLink());
}
// The tooltip of the status bar's node link: the node's name, what it is and whether it is
// connected.
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

// The status bar: the keys that work here, the node you are connected to, and ripening.
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
    // nodes not answering yet (#206, unseenet#704): the others' groups are already shown
    (S.state.slow || []).length ? h("span", { class: "slow-node", role: "status",
      title: "Its groups and posts come as soon as it answers; the other nodes' are shown already",
      text: (S.state.slow.map(nodeLabel).join(", ")) + (S.state.slow.length === 1 ? " is" : " are") + " not answering yet" }) : null,
    h("span", { class: "st", title: S.state.status },
      h("span", { class: "dot" + (S.state.connected ? " ok" : "") }),
      // "Connected to <node>" only repeats the box at the bottom left (#111)
      S.state.status && !S.state.status_idle ? S.state.status + " · " : "", "pre-alpha"));
}

// The main part of the page: the group shown in its view (threads, chat, feed, site), or a
// welcome.
function mainArea() {
  const d = S.data;
  if (!S.gid || !d) {
    return h("div", { class: "empty" }, h("h2", { text: "Pick a group" }),
      h("p", { text: "Your groups are on the left. Press G to find more on your node." }));
  }
  if (S.gid === CHATS) return chatsView();             // the list of private chats (gui#172)
  if (S.gid === CONTACTS) return contactsView();       // your contacts (gui#209)
  if (S.gid === YOU) return youView();
  if (S.gid === PRIVATE) return privateView();         // a phone's Private tab (gui#256)                 // you and the state of things (gui#248)
  const g = d.group;
  const chips = [
    h("span", { class: "chip mono", text: g.view === "chat" ? "» chat" : g.view === "feed" ? "☰ feed" : g.view === "pages" ? "⌂ site" : "≡ threads" }),
    g.encrypted ? h("span", { class: "chip" }, svg(ICON.lock, 12, 2.5),
      g.type === "inbox" ? "sealed to you" : g.type === "contact" ? "private · sealed to each of you" : "closed · end-to-end encrypted") :
      g.type ? h("span", { class: "chip", text: g.type }) : null,
    g.fast ? h("span", { class: "chip warn", text: "fast delivery" }) : null,
    groupTagChips(g),                                   // the group's tags, once (UN-RFC 0052 5)
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
        h("button", { class: "btn primary fab", "aria-label": "Write a post", title: "A post with a subject instead of a chat line (N)",
          onclick: () => openPost(g.key, g.label.replace(/ √$/, "")) },
          svg(ICON.plus, 16, 2.5), h("span", { class: "lbl", text: "Write a post" }), h("kbd", { text: "N" }))] : null,
      // your private posts: the same head as the other private lists, one action (gui#209, gui#219)
      S.sidebar && g.id === S.sidebar.inbox.id ? [
        h("button", { class: "btn primary fab", "aria-label": "Write a private post", onclick: () => openWrite("", "post") },
          svg(ICON.plus, 16, 2.5), h("span", { class: "lbl", text: "Write a private post" }), h("kbd", { text: "M" }))] : null,
      g.owner && g.type === "closed" ? h("button", { class: "btn", onclick: () => openInvite() }, "Invite") : null,
      canSwitch ? h("button", { class: "btn", onclick: toggleView },
        "Show as " + nextView(g), h("kbd", { text: "V" })) : null,
      // in your timeline or not (UN-RFC 0034 6.2): one switch, not a second kind of follow
      g.subscribed !== false && g.timeline && g.timeline.possible ? h("button", {
        class: "btn tl-switch" + (g.timeline.on ? " on" : ""), "aria-pressed": String(!!g.timeline.on), "data-k": "tl-switch",
        title: g.timeline.on ? "Its new " + (g.view === "feed" ? "entries" : "threads") + " come into your timeline - click to take it out"
          : "Bring its new " + (g.view === "feed" ? "entries" : "threads") + " into your timeline, with the answers under them",
        onclick: () => setTimeline(g, !g.timeline.on) }, "☰ ", g.timeline.on ? "In timeline" : "Add to timeline") : null,
      g.type ? h("button", { class: "btn icon", "aria-label": "About this group", title: "About this group (?)", onclick: openInfo, text: "?" }) : null,
      paletteButton("btn icon pal-btn"),               // phones: the palette, one icon everywhere (gui#263)
      // New post (gui#257): in the head on a desktop; on a phone a round + above the tab bar,
      // or a + in the head of a chat group, whose bottom is the chat line - greyed with the
      // reason where you may not post, as on the desktop (#13)
      g.type && !["contact", "inbox"].includes(g.type) && g.view !== "pages" && (g.kinds || ["post"]).includes("post") ?
        h("button", offProps(mayWrite(d, "post"), { class: (g.view === "chat" ? "btn" : "btn primary") + " newpost fab",
          onclick: () => openCompose(), "aria-label": "New post", "data-k": "newpost",
          title: "A post with a subject (UN-RFC 0028)" }),
          svg(ICON.plus, 16, 2.5), h("span", { class: "lbl", text: "New post" }), h("kbd", { text: "N" })) : null,
      // the timeline (gui#257): what you write goes to your own feed, as on Facebook or Mastodon
      g.id === TIMELINE && S.sidebar && S.sidebar.my_feed && S.sidebar.my_feed.started ?
        h("button", { class: "btn primary newpost fab", "aria-label": "New post in your feed", "data-k": "newpost",
          title: "A new entry in your own feed",
          onclick: async () => { await openGroup(S.sidebar.my_feed.id); openCompose(); } },
          svg(ICON.plus, 16, 2.5), h("span", { class: "lbl", text: "New post" })) : null));
  return [head, g.view === "chat" ? chatView(d) : g.view === "feed" ? feedView(d) : g.view === "pages" ? siteView(d) : threadsView(d)];
}
