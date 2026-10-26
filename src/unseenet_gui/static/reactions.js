// reactions.js - reactions under posts, comments and chat lines (UN-RFC 0048, #107).
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// --- reactions (UN-RFC 0048, unseenet-gui#107) -----------------------------------
// Under every post, comment and chat line: each emoji with its count, yours marked; a
// click gives that one (or takes yours back), right-click says who, and + offers the
// group's set. Never shown as comments, never used to order anything (section 7.2).
function reactionBar(m) {
  // never on your own post, comment or chat line (#119, unseenet#524): the core says so
  // in react, and m.mine keeps it so against an older core
  const may = !!(m.react && m.react.allowed) && !m.mine;
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
// Close the reaction picker.
function closeReactions() { if (reactPop) { reactPop.remove(); reactPop = null; } }

// The reaction picker under a post: the group's set first, any emoji where the group takes
// any.
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

// React with an emoji, or take yours back, showing it at once until the core has sent it.
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

// Who gave an emoji (right-click on it).
async function whoReacted(m, emoji) {
  try {
    const d = await api("POST", `/api/groups/${encodeURIComponent(m.group)}/react`, { id: m.id, emoji, who: true });
    toast(emoji + "  " + ((d.who || []).join(", ") || "nobody yet"));
  } catch (x) { toast(x.message); }
}

// Focus an element after the page is drawn.
function focusLater(sel) {
  setTimeout(() => { const el = document.querySelector(sel); if (el) el.focus(); });
}

// A group by its id, from the sidebar.
function groupOf(gid) {
  return allGroups().find(x => x.id === gid) || null;
}

// V: threads and chat; a feed also as a feed (UN-RFC 0034 section 3.1)
function nextView(g) {
  if (g.view === "pages" || g.owner_view === "pages") return g.view === "pages" ? "threads" : "pages";
  if (g.view === "feed" || g.owner_view === "feed") return { feed: "threads", threads: "chat" }[g.view] || "feed";
  return g.view === "chat" ? "threads" : "chat";
}
