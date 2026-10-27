// labels.js - tags (UN-RFC 0052) and content labels (UN-RFC 0053): warnings as flags,
// blurred or hidden as you chose, never silently; topics as quiet chips (unseenet-gui#186).
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- warnings: a fixed set, one colour each, always with the word (UN-RFC 0052 4) ----
const WARNINGS = ["profanity", "sexual", "nudity", "violence", "gore", "spoiler"];
const WARNING_TEXT = { profanity: "Profanity", sexual: "Sexual content", nudity: "Nudity",
  violence: "Violence", gore: "Gore", spoiler: "Spoiler" };

// Who set a warning, in words: the author, the group, or labellers by name.
function warnedBy(by) {
  return (by || []).map(b => b === "author" ? "the author" : b === "group" ? "the group" : b).join(", ");
}

// What to do with a post: its warnings, topics and "show", "blur" or "hide" - the
// reader's choice per warning (from the core), a rule's blur (UN-RFC 0051), and Show
// anyway on this device.
function labelState(m) {
  const l = m.labels || null;
  const ruled = (m.actions || []).includes("blur");
  if (!l && !ruled) return null;
  let action = l ? l.action : "show";
  if (ruled && action === "show" && !m.mine) action = "blur";
  if ((S.labelShown || {})[m.id]) action = "show";
  return { warnings: l ? l.warnings : [], topics: l ? l.topics : [], action, ruled };
}

// The flags at the top of a post: one per warning, its colour and word, and who set it.
function warningFlags(m) {
  const st = labelState(m);
  if (!st || !st.warnings.length) return st && st.ruled && st.action !== "show"
    ? h("div", { class: "wflags" }, h("span", { class: "wflag w-rule" }, svg(ICON.flag, 12, 2), " your rules")) : null;
  return h("div", { class: "wflags" }, st.warnings.map(w => h("span", {
    class: "wflag w-" + w.warning, title: WARNING_TEXT[w.warning] + " - set by " + warnedBy(w.by) +
      (w.choice === "show" ? ". You chose to show it." : "") },
    svg(ICON.alert || ICON.flag, 12, 2), " ", w.warning)),
    h("span", { class: "hint wby", text: "from " + warnedBy([...new Set(st.warnings.flatMap(w => w.by))]) }));
}

// In a post's place when it is blurred or hidden: why, and Show anyway - never silently.
function labelVeil(m) {
  const st = labelState(m);
  if (!st || st.action === "show") return null;
  const words = st.warnings.map(w => w.warning);
  const why = words.length ? words.join(", ") : "your rules";
  return h("div", { class: "lveil" + (st.action === "hide" ? " hidden" : ""), role: "note" },
    h("span", { class: "ltext", text: (st.action === "hide" ? "Hidden: " : "Text and pictures are hidden: ") + why +
      (words.length ? " - from " + warnedBy([...new Set(st.warnings.flatMap(w => w.by))]) : "") }),
    h("button", { class: "btn small", type: "button", onclick: (e) => { e.stopPropagation(); showLabelled(m); } },
      "Show anyway"));
}

// Show one blurred or hidden post anyway, on this device, until the page is closed.
function showLabelled(m) {
  S.labelShown = { ...(S.labelShown || {}), [m.id]: true };
  render();
}

// Whether a post is covered (blurred or hidden) right now.
function labelCovered(m) {
  const st = labelState(m);
  return !!st && st.action !== "show";
}

// In the threads list: a narrow stripe in the warning's colour before the subject.
function warningStripe(m) {
  const st = labelState(m);
  if (!st || !st.warnings.length) return null;
  const w = st.warnings[0];
  return h("span", { class: "wstripe w-" + w.warning, role: "img",
    "aria-label": st.warnings.map(x => x.warning).join(", "),
    title: st.warnings.map(x => x.warning).join(", ") + " - from " + warnedBy(st.warnings.flatMap(x => x.by)) });
}

// The quiet line a hidden post is in the threads list.
function hiddenRowText(m) {
  const st = labelState(m);
  return st && st.action === "hide" ? "Hidden: " + (st.warnings.map(w => w.warning).join(", ") || "your rules") +
    (st.warnings.length ? ", from " + warnedBy(st.warnings.flatMap(w => w.by)) : "") : "";
}

// ---- topics: neutral chips at the bottom (UN-RFC 0052, 0053) ----
// The author's own (filled), the group's (dashed - shown where posts come from many
// groups), and a labeller's topics (dotted, with its name). No colours: a colour would
// read as a meaning.
function tagChips(m, opts = {}) {
  const own = (m.tags || []).filter(t => !WARNINGS.includes(t));
  const g = groupOf(m.group);
  const groupTags = opts.groupTags ? ((g && g.tags) || []).filter(t => !WARNINGS.includes(t) && !own.includes(t)) : [];
  const st = labelState(m);
  const topics = st ? st.topics.filter(t => !own.includes(t) && !groupTags.includes(t)) : [];
  if (!own.length && !groupTags.length && !topics.length) return null;
  const chip = (t, cls, title) => h("button", { class: "tchip" + cls, type: "button", title,
    onclick: (e) => { e.stopPropagation(); filterByTag(t); } }, cls === " lab" ? [svg(ICON.tag || ICON.flag, 11, 2), " "] : null, t);
  return h("span", { class: "tchips" },
    own.map(t => chip(t, "", "The author's tag - show everything with it here")),
    groupTags.map(t => chip(t, " grp", "The group's tag, its owner's")),
    topics.map(t => chip(t, " lab", "A topic from a labeller you follow for topics")));
}

// The group's own tags, once, in its head (a threads view: every post is in it).
function groupTagChips(g) {
  const tags = (g && g.tags) || [];
  if (!tags.length) return null;
  return h("span", { class: "tchips ghead" }, tags.map(t => h("span", { class: "tchip grp", title: "The group's tag, set by its owner",
    text: t + " · the group's" })));
}

// Everything with a tag in your groups and feeds, as a feed (UN-RFC 0052 section 7).
async function filterByTag(tag) {
  S.tagFilter = null;
  await openGroup(TAGGED + tag);
}

// Whether a post passes the tag filter: its own, its group's, or a labeller's topic.
function passesTag(m) {
  const t = S.tagFilter;
  if (!t) return true;
  const g = groupOf(m.group);
  const st = labelState(m);
  return (m.tags || []).includes(t) || ((g && g.tags) || []).includes(t) || !!(st && st.topics.includes(t));
}

// The bar over a filtered view.
function tagFilterBar() {
  if (!S.tagFilter) return null;
  return h("div", { class: "tagbar", role: "status" }, "Showing posts tagged ",
    h("b", { text: S.tagFilter }), " ", h("button", { class: "link", onclick: () => filterByTag(S.tagFilter) }, "Show all"));
}

// ---- writing: tags as chips under the text, warnings first (UN-RFC 0052 3) ----
// #words in the text are shown as chips at once; the core puts both in the header.
function tagWords(text) {
  const out = [];
  for (const m of (text || "").matchAll(/(?<![\p{L}\p{N}_@#!\/&.+-])#([\p{L}\p{N}](?:[\p{L}\p{N}_-]*[\p{L}\p{N}])?)(?![\p{L}\p{N}_-])/gu)) {
    const t = m[1].normalize("NFC").toLowerCase();
    if (/\p{L}/u.test(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

// The tags field of a compose window: the warnings to tick, your own words as chips,
// and the #words of the text shown too. Keeps its state in st.tags and draws itself
// (the compose window is built once); call box.redraw() when the text changes.
function tagField(st, textOf) {
  st.tags = st.tags || [];
  const box = h("div", { class: "tagfield" });
  const add = (v) => {
    for (const w of String(v).split(/[\s,]+/)) {
      const t = w.replace(/^#/, "").normalize("NFC").toLowerCase();
      if (t && /^[\p{L}\p{N}][\p{L}\p{N}-]{0,31}$/u.test(t) && !st.tags.includes(t) && st.tags.length < 8) st.tags.push(t);
    }
    draw();
    const next = box.querySelector(".tagin");          // write the next one at once
    if (next) next.focus();
  };
  const draw = () => {
    const fromText = tagWords(textOf()).filter(t => !st.tags.includes(t));
    box.replaceChildren(
      h("div", { class: "warnpick", role: "group", "aria-label": "Content warnings" },
        h("span", { class: "hint", text: "Warn about:" }),
        WARNINGS.map(w => h("button", { type: "button", class: "wpick w-" + w + (st.tags.includes(w) ? " on" : ""),
          "aria-pressed": String(st.tags.includes(w)),
          onclick: () => { st.tags = st.tags.includes(w) ? st.tags.filter(x => x !== w) : [...st.tags, w].slice(0, 8); draw(); } }, w))),
      h("div", { class: "tchips edit" },
        h("span", { class: "hint", text: "Tags:" }),
        st.tags.filter(t => !WARNINGS.includes(t)).map(t => h("span", { class: "tchip" }, t,
          h("button", { type: "button", class: "x", "aria-label": "Remove " + t,
            onclick: () => { st.tags = st.tags.filter(x => x !== t); draw(); } }, "×"))),
        fromText.map(t => h("span", { class: "tchip lab", title: "From #" + t + " in your text", text: t })),
        st.tags.length < 8 ? h("input", { class: "tagin", "aria-label": "Add a tag", placeholder: "add a tag, or write #word in the text",
          onkeydown: (e) => { if (e.key === "Enter" || e.key === "," || e.key === " ") { e.preventDefault(); add(e.target.value); e.target.value = ""; } },
          onblur: (e) => { if (e.target.value.trim()) { add(e.target.value); e.target.value = ""; } } }) : null));
  };
  // only when the #words of the text change: redrawing on every key would split the
  // text's undo into single letters
  let words = "";
  box.redraw = () => {
    const now = tagWords(textOf()).join(" ");
    if (now !== words) { words = now; draw(); }
  };
  words = tagWords(textOf()).join(" ");
  draw();
  return box;
}

// ---- settings: what to do with each warning, and the labellers (UN-RFC 0053 5, 6) ----
async function openContentWarnings() {
  let d;
  try { d = await api("GET", "/api/labels"); } catch (x) { toast(x.message); return; }
  let err = "", key = "", label = "", topics = false;
  const reload = async (p) => { try { d = await p; err = ""; } catch (x) { err = x.message; } redrawDialog(); };
  S.dialog = { render: () => dialogShell({ label: "Content warnings", wide: true },
    h("div", { class: "dh" }, h("h2", { text: "Content warnings and labels" }),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db list" },
      h("p", { class: "hint", style: "margin:0", text: "Labels only describe: they hide nothing for anyone who did not choose it, and what is blurred or hidden always says why. Your own posts and your contacts' are never covered." }),
      h("h3", { style: "margin:4px 0 0;font-size:14px", text: "What to do with each warning" }),
      d.warnings.map(w => h("div", { class: "wrow" },
        h("span", { class: "wflag w-" + w.warning }, w.warning),
        h("span", { class: "grow", text: w.label }),
        ["show", "blur", "hide"].map(c => h("label", { class: "check" },
          h("input", { type: "radio", name: "w-" + w.warning, checked: w.choice === c,
            onchange: () => reload(api("POST", "/api/labels/warning", { warning: w.warning, choice: c })) }), " " + c)))),
      h("h3", { style: "margin:8px 0 0;font-size:14px", text: "Labellers" }),
      d.labellers.length ? d.labellers.map(l => h("div", { class: "rrow" },
        h("label", { class: "check" }, h("input", { type: "checkbox", checked: l.on,
          onchange: (e) => reload(api("POST", "/api/labels/follow", e.target.checked ? { key: l.key, label: l.label, topics: l.topics } : { key: l.key, follow: false })) }),
          " ", h("b", { text: l.label })),
        h("span", { class: "hint", text: [
          ...l.hierarchies.map(x => "named for " + x + ".*"), ...l.groups.map(x => "named for " + labelOf(x)),
          l.yours ? "followed by you" + (l.topics ? ", topics too" : "") : null].filter(Boolean).join(" · ") }))) :
        h("p", { class: "muted", style: "margin:0", text: "None yet. A labeller you follow, or one a group or hierarchy names, appears here." }),
      h("h3", { style: "margin:8px 0 0;font-size:14px", text: "Follow a labeller" }),
      h("label", { for: "lkey", text: "Its key" }),
      h("input", { id: "lkey", class: "in mono", placeholder: "ed25519:…", value: key, oninput: (e) => { key = e.target.value; } }),
      h("label", { for: "llabel", text: "What to call it (optional)" }),
      h("input", { id: "llabel", class: "in", value: label, oninput: (e) => { label = e.target.value; } }),
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: topics, onchange: (e) => { topics = e.target.checked; } }),
        " Also its topics, for your rules - never chosen for you"),
      err ? h("p", { class: "bad", role: "alert", text: err }) : null),
    h("div", { class: "df btns" },
      h("button", { class: "btn", onclick: closeDialog }, "Close"),
      h("button", { class: "btn primary", onclick: () => { if (key.trim()) reload(api("POST", "/api/labels/follow", { key: key.trim(), label, topics })); } }, "Follow"))) };
  render();
}
