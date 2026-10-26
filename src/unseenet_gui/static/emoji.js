// emoji.js - the emoji picker and :shortcode: completion while typing (#21).
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

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

// The core's emoji table (UN-RFC 0031 emoji), read once and kept.
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

// The emoji you used lately, newest first (this browser only).
function recentEmoji() {
  try { const r = JSON.parse(localStorage.getItem(EMOJI_RECENT) || "[]"); return Array.isArray(r) ? r : []; }
  catch (_) { return []; }
}

// Keep an emoji first among the recent ones.
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

// The emoji button beside a text field, where emoji are on.
function emojiButton(k) {
  if (!emojiOn()) return null;
  return h("button", { type: "button", class: "btn icon emoji-btn", "aria-label": "Emoji", "aria-haspopup": "dialog",
    title: "Emoji - or type : and a name", onclick: (e) => openEmojiPicker(k, e.currentTarget) }, svg(ICON.smile, 18));
}

// Open the emoji picker for a text field (or onPick for reactions); a second click closes
// it.
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

// Close the emoji picker, putting the focus back in its field if asked.
function closeEmojiPicker(refocus) {
  if (!picker) return;
  const k = picker.k;
  picker.node.remove(); picker = null;
  if (refocus) { const el = emojiField(k); if (el) el.focus(); }
}

// Draw the picker: a search, the recent ones, and the emoji by category.
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

// While typing ":ta": the emoji whose names start so, under the field.
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

// Draw the :shortcode: suggestions with the chosen one marked.
function drawSuggest() {
  const s = suggest;
  s.node.replaceChildren(...s.items.map((c, i) => h("div", { role: "option", class: "emo-opt" + (i === s.i ? " on" : ""),
    "aria-selected": i === s.i ? "true" : "false", "data-code": c,
    onmousedown: (e) => { e.preventDefault(); s.i = i; takeSuggest(); } },
    h("span", { class: "emo-glyph", text: emojiData.table[c] }), h("span", { class: "mono", text: ":" + c + ":" }))));
}

// Put the chosen suggestion in the text in place of its :shortcode:.
function takeSuggest() {
  const s = suggest;
  closeSuggest();
  insertEmoji(s.k, s.items[s.i], s.from);
}

// Close the :shortcode: suggestions.
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
