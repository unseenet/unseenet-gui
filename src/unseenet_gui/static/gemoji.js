// gemoji.js - a group's own emoji (#67, UN-RFC 0056).
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
//
// :name: shows as the group's picture only in the group the post is read in, at the
// height of the text; anywhere else, in subjects, in code, with pictures turned off, it
// stays text. The owner adds, renames, describes and removes them in their own dialog.
"use strict";

S.groupEmoji = S.groupEmoji || {};          // gid -> {name: picture}, as last read
const gemojiRead = new Set();               // groups whose emoji were read anew this session

// The emoji of a group as last read, or null.
function emojiSetOf(gid) {
  const set = gid && S.groupEmoji[gid];
  return set && Object.keys(set).length ? set : null;
}

// A group was opened: keep its emoji, and read them anew once a session in the background.
function noteGroupEmoji(g) {
  if (!g || !g.id) return;
  if (g.emoji) S.groupEmoji[g.id] = g.emoji;
  if (!g.emoji_possible || gemojiRead.has(g.id)) return;
  gemojiRead.add(g.id);
  api("GET", "/api/groups/" + encodeURIComponent(g.id) + "/emoji").then(d => {
    const was = JSON.stringify(S.groupEmoji[g.id] || {});
    S.groupEmoji[g.id] = d.emoji || {};
    if (JSON.stringify(S.groupEmoji[g.id]) !== was && S.gid === g.id) render();
  }, () => { /* the node does not answer: what we have */ });
}

// One group emoji as a picture at text size (data: from the set, nothing fetched).
function gemojiImg(name, p, cls = "gemoji") {
  return h("img", { class: cls, src: `data:${p.type};base64,${p.data}`, alt: p.alt || ":" + name + ":",
    title: ":" + name + ":" + (p.alt ? " - " + p.alt : ""), draggable: "false" });
}

// Text of a post, with :name: as the group's own emoji where it has them (UN-RFC 0056
// 6.1); ``then`` turns the rest into nodes (group addresses become links).
function withGroupEmoji(text, then) {
  const set = RENDERING && !(S.sidebar && S.sidebar.pictures === false) && emojiSetOf(RENDERING.group || S.gid);
  if (!set || text.indexOf(":") < 0) return then(text);
  const out = [];
  let last = 0;
  text.replace(/:([a-z0-9_+-]{2,32}):/g, (all, name, at) => {
    if (!set[name]) return all;
    if (at > last) out.push(then(text.slice(last, at)));
    out.push(gemojiImg(name, set[name]));
    last = at + all.length;
    return all;
  });
  if (last < text.length) out.push(then(text.slice(last)));
  return out;
}

// The owner's dialog: the group's emoji, each with its name and description, Add, and
// what publishing them means (said before the first, UN-RFC 0056 6.3).
async function openGroupEmoji() {
  const g = S.data && S.data.group;
  if (!g || !g.owner || !g.emoji_possible) return;
  const st = { set: S.groupEmoji[g.id] || g.emoji || {}, max: 16, warning: "", busy: false, err: "",
               preview: null, file: null, name: "", alt: "" };
  let dialog = null;
  const gid = encodeURIComponent(g.id);
  const change = async (body) => {
    st.busy = true; st.err = ""; draw();
    try {
      const d = await api("POST", `/api/groups/${gid}/emoji`, body);
      st.set = S.groupEmoji[g.id] = d.emoji || {};
      Object.assign(st, { preview: null, file: null, name: "", alt: "" });
      render();
    } catch (x) { st.err = x.message; }
    st.busy = false; draw();
  };
  const choose = async (files) => {
    const f = files && files[0];
    if (!f) return;
    st.err = "";
    try {
      st.file = await new Promise((ok, bad) => { const r = new FileReader();
        r.onload = () => ok(String(r.result).split(",", 2)[1] || ""); r.onerror = bad; r.readAsDataURL(f); });
      st.preview = (await api("POST", `/api/groups/${gid}/emoji`, { preview: { data: st.file, alt: st.alt } })).picture;
      if (!st.name) st.name = (f.name.replace(/\.[^.]*$/, "").toLowerCase().replace(/[^a-z0-9_+-]+/g, "_").slice(0, 32)) || "";
    } catch (x) { st.err = x.message; st.preview = st.file = null; }
    draw();
  };
  const build = () => {
    const names = Object.keys(st.set).sort();
    const input = Object.assign(h("input", { id: "gemfile", type: "file", accept: "image/*", class: "sr",
      onchange: (e) => { choose(e.target.files); e.target.value = ""; } }), { _take: choose });   // pasted, dropped too
    return dialogShell({ label: "The group's emoji", cls: "gemoji-dlg" },
      h("div", { class: "dh" }, h("h2", { text: "Emoji of " + g.label }),
        h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
      h("div", { class: "db" },
        h("p", { class: "hint", style: "margin:0", text: `Write :name: in this group, and its picture shows instead. ` +
          `${names.length} of ${st.max} used.` }),
        names.length ? h("div", { class: "gemoji-list" }, names.map(n => h("div", { class: "rrow gemoji-row" },
          gemojiImg(n, st.set[n], "gemoji big"), h("b", { class: "mono", text: ":" + n + ":" }),
          h("span", { class: "hint grow", text: st.set[n].alt || "no description" }),
          h("button", { class: "btn small", type: "button", disabled: st.busy, onclick: () => {
            const to = window.prompt("New name for :" + n + ":", n);
            if (to && to !== n) change({ rename: { from: n, to } }); } }, "Rename"),
          h("button", { class: "btn small", type: "button", disabled: st.busy, onclick: () => {
            const alt = window.prompt("A description for people who cannot see it", st.set[n].alt || "");
            if (alt !== null) change({ alt: { name: n, alt } }); } }, "Describe"),
          h("button", { class: "btn small", type: "button", disabled: st.busy,
            onclick: () => change({ remove: n }) }, "Remove")))) :
          h("p", { class: "muted", style: "margin:0", text: "No emoji yet." }),
        !names.length && st.warning ? h("p", { class: "hint warn-line", style: "margin:0", text: st.warning }) : null,
        names.length < st.max ? h("div", { class: "gemoji-add" },
          h("label", { for: "gemfile", class: "btn" }, st.preview ? "Choose another" : "Choose a picture"), input,
          st.preview ? [h("div", { class: "row" }, gemojiImg(st.name || "new", st.preview, "gemoji big"),
              h("span", { class: "hint", text: "As it will be shown: 32 by 32, without metadata." })),
            h("label", { for: "gemname", text: "Name - written as :name:" }),
            h("input", { id: "gemname", class: "in mono", maxlength: 32, "data-k": "gemname", value: st.name,
              placeholder: "e.g. marsvin", oninput: (e) => { st.name = e.target.value; } }),
            h("label", { for: "gemalt", text: "Description, for people who cannot see it" }),
            h("input", { id: "gemalt", class: "in", maxlength: 64, "data-k": "gemalt", value: st.alt,
              oninput: (e) => { st.alt = e.target.value; } })] : null) : null,
        st.err ? h("p", { class: "error", role: "alert", text: st.err }) : null),
      h("div", { class: "df btns" },
        h("button", { class: "btn", type: "button", onclick: closeDialog }, "Close"),
        st.preview ? h("button", { class: "btn primary", type: "button", disabled: st.busy,
          onclick: () => change({ add: { name: st.name, data: st.file, alt: st.alt } }) },
          st.busy ? "Publishing …" : "Add and publish") : null));
  };
  const draw = () => { if (!dialog || S.dialog !== dialog) return; const old = dialog.node; dialog.node = build(); old.replaceWith(dialog.node); };
  dialog = { focus: ".dialog .btn", render: () => dialog.node };
  dialog.node = build();
  S.dialog = dialog;
  render();
  try {                                               // read them anew, with the warning
    const d = await api("GET", `/api/groups/${gid}/emoji`);
    st.set = S.groupEmoji[g.id] = d.emoji || {}; st.max = d.max || 16; st.warning = d.warning || "";
    draw();
  } catch (_) { /* what we have */ }
}
