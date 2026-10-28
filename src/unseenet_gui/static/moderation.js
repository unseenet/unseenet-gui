// moderation.js - the owner's and moderators' tools, names (UN-RFC 0019), ignoring people (#72) and blocking in a hierarchy (UN-RFC 0018 5.4).
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- the owner's and moderators' tools (the TUI's Ctrl+P) ----------------------
async function leaveGroup(g) {
  await api("POST", "/api/subscribe", { id: g.id, on: false });
  closeDialog(); S.gid = null; S.data = null; await loadSidebar();
  toast("You no longer follow " + g.label + ". G finds it again.");
}

// The owner's group settings: title, description, rules, view, comments, files, reactions,
// pins and pages - with Help (#178): per setting what it does, whom it affects and what
// changing it later does, the core's text, as in every client.
async function openEditGroup() {
  const g = S.data && S.data.group;
  if (!g || !g.owner) return;
  if (S.settingsHelp === undefined) {
    try { S.settingsHelp = await api("GET", "/api/help/group-settings"); }
    catch (_) { S.settingsHelp = null; }     // an older core: no help panel
  }
  let view = g.owner_view || g.view, kinds = (g.kinds || []).length === 1 ? g.kinds[0] : "both";
  let files = fileChoice(g.files);
  // reactions (UN-RFC 0048 section 4): the view's default, none, any, or your own set
  const rset = (g.reactions && g.reactions.setting) || "default";
  let reacts = Array.isArray(rset) ? "own" : rset;
  // a site: whether search engines may index it through its web form (UN-RFC 0035 section 3)
  const site = S.data && S.data.site;
  let index = site ? (site.index || "no") : null;
  // spam report issuers the group's readers follow by default (UN-RFC 0045 7.5); each
  // reader can still turn them off
  const issuers = (g.report_issuers || []).map(i => ({ ...i }));
  const startIssuers = issuers.map(i => i.key).join(" ");
  const follows = ((S.reports && S.reports.issuers) || []).filter(i => i.on);
  const addIssuer = (key, label) => {
    key = (key || "").trim();
    if (!key || issuers.some(i => i.key === key)) return;
    issuers.push({ key, label: label || key.slice(0, 20) + "…" });
    redrawDialog();
  };
  const pick = (name, value, current, label, small) => h("button", { type: "button", class: "choice", "aria-pressed": String(current === value),
    onclick: () => { if (name === "kinds") kinds = value; else if (name === "files") files = value;
      else if (name === "reactions") reacts = value; else if (name === "index") index = value; else view = value; redrawDialog(); } },
    h("span", {}, h("span", { text: label }), h("small", { text: small })));
  // the settings this dialog shows, in its order, for the help beside it
  const shown = ["title", "view", "kinds", "files", "reactions", site ? "index" : null,
    g.type !== "inbox" ? "report_issuers" : null, g.type !== "inbox" ? "languages" : null,
    g.type !== "inbox" ? "tags" : null, g.type === "inbox" ? "team_name" : null, "rules"].filter(Boolean);
  const help = S.settingsHelp && Array.isArray(S.settingsHelp.settings) ? S.settingsHelp : null;
  formDialog({ label: "Edit group", title: "Edit " + g.label, focus: "#etitle", button: "Save",
    cls: () => "edit-group" + (S.groupHelp ? " helping" : ""),
    headButtons: help ? () => h("button", { class: "btn small", type: "button", "aria-controls": "settings-help",
      "aria-expanded": S.groupHelp ? "true" : "false", onclick: toggleGroupHelp }, S.groupHelp ? "Hide help" : "Help") : null,
    aside: help ? () => settingsHelp(help, shown) : null,
    values: { title: g.title || "", description: g.description || "", rules: g.rules || "",
      team_name: g.team_name || "", gtags: (g.tags || []).join(", "), glangs: (g.languages || []).join(", "),
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
      reacts === "own" ? ownReactionSet(vals.reaction_set) : null,
      site ? h("label", { text: "Search engines" }) : null,
      site ? h("div", { class: "choices row" },
        pick("index", "no", index, "Not indexed", "found by its address only"),
        pick("index", "yes", index, "May be indexed", "search engines may list its pages")) : null,
      site && index === "yes" ? h("p", { class: "hint", style: "margin:0",
        text: "Copies in search engines are outside Unseenet: they can outlive the pages here, even after they expire or you withdraw them." }) : null,
      g.type !== "inbox" ? [
        h("label", { text: "Spam reports here" }),
        h("p", { class: "hint", style: "margin:0", text: "Issuers your readers follow here by default, so spam is hidden " +
          "from the start. Each reader can turn them off; a hidden post always says who hid it." }),
        issuers.length ? h("div", { class: "issuers" }, issuers.map((i, n) => h("div", { class: "rrow" },
          h("b", { text: i.label }), h("span", { class: "mono hint", text: i.key }),
          h("button", { class: "btn small", type: "button", onclick: () => { issuers.splice(n, 1); redrawDialog(); } }, "Remove")))) :
          h("p", { class: "muted", style: "margin:0", text: "None: only the issuers your readers choose, or the hierarchy names." }),
        follows.filter(f => !issuers.some(i => i.key === f.key)).length ? h("div", { class: "chips" },
          follows.filter(f => !issuers.some(i => i.key === f.key)).map(f =>
            h("button", { type: "button", class: "chip", title: "Add " + f.key, onclick: () => addIssuer(f.key, f.label) }, "+ " + f.label))) : null,
        h("div", { class: "row-in" },
          h("input", { id: "eissuer", class: "in mono", "aria-label": "Add an issuer by its key", placeholder: "Add an issuer: ed25519:…",
            onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); addIssuer(e.target.value); } } }),
          h("button", { class: "btn", type: "button", onclick: () => addIssuer(document.querySelector("#eissuer").value) }, "Add"))] : null,
      g.type !== "inbox" ? [h("label", { for: "elangs", text: "Languages written here - the first is the main one (e.g. da, or en, da)" }),
        h("input", { id: "elangs", name: "glangs", class: "in", "data-k": "elangs", placeholder: "none",
          value: vals.glangs || "" })] : null,
      g.type !== "inbox" ? [h("label", { for: "etags", text: "The group's tags - every post here has them (up to 8)" }),
        h("input", { id: "etags", name: "gtags", class: "in", "data-k": "etags", placeholder: "film, serier - or a warning such as sexual for an adult group",
          value: vals.gtags || "" })] : null,
      g.type === "inbox" ? [h("label", { for: "eteam", text: "The name replies go out as (a team inbox)" }),
        h("input", { id: "eteam", name: "team_name", class: "in", maxlength: 64, "data-k": "eteam",
          placeholder: "e.g. Example (operator)", value: vals.team_name || "" })] : null,
      h("label", { for: "erules", text: "Rules - shown to people before they post" }),
      h("textarea", { id: "erules", name: "rules", class: "in", "data-k": "erules", style: "min-height:110px", value: vals.rules }),
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "markdown", checked: !!vals.markdown }),
        " Markdown: # headings, - lists, **strong**, [links](https://…), :tada: (no pictures)")],
    submit: async (v) => {
      const rules = v.rules.trim();
      await api("POST", `/api/groups/${encodeURIComponent(g.id)}/settings`,
        { title: v.title.trim(), description: v.description.trim(), rules,
          rules_type: v.markdown && rules ? MARKDOWN : null, view, kinds,
          reactions: reacts === "own" ? splitOwnSet(v.reaction_set) : reacts,
          ...(files !== "custom" ? { files } : {}), ...(site && index !== site.index ? { index } : {}),
          ...(issuers.map(i => i.key).join(" ") !== startIssuers ? { report_issuers: issuers.map(i => i.key) } : {}),
          ...(g.type === "inbox" && (v.team_name || "") !== (g.team_name || "") ? { team_name: (v.team_name || "").trim() } : {}),
          ...(g.type !== "inbox" && (v.glangs || "") !== (g.languages || []).join(", ") ?
            { languages: languageCodes(v.glangs) } : {}),
          ...(g.type !== "inbox" && (v.gtags || "") !== (g.tags || []).join(", ") ?
            { tags: (v.gtags || "").split(/[\s,]+/).map(t => t.replace(/^#/, "").toLowerCase()).filter(Boolean) } : {}) });
      closeDialog(); toast("The group is updated."); await loadGroup(); await loadSidebar();
    } });
}

// The help panel beside Edit group (#178): the core's intro, then the settings shown here.
function settingsHelp(help, keys) {
  const by = Object.fromEntries((help.settings || []).map(s => [s.key, s]));
  return h("aside", { id: "settings-help", class: "settings-help", "aria-label": "What the settings do" },
    h("p", { class: "hint", text: help.intro || "" }),
    keys.filter(k => by[k]).map(k => h("section", { class: "sh-item" },
      h("h3", { text: by[k].label }), h("p", { text: by[k].what }),
      h("p", {}, h("b", { text: "Affects: " }), by[k].affects),
      h("p", {}, h("b", { text: "Later: " }), by[k].later))));
}

// Show or hide the help beside Edit group without drawing the form again - what you typed
// stays. Remembered while the page is open.
function toggleGroupHelp(e) {
  S.groupHelp = !S.groupHelp;
  const dlg = document.querySelector(".dialog.edit-group");
  if (dlg) dlg.classList.toggle("helping", S.groupHelp);
  e.currentTarget.textContent = S.groupHelp ? "Hide help" : "Help";
  e.currentTarget.setAttribute("aria-expanded", S.groupHelp ? "true" : "false");
}

// A group's own set of reactions (UN-RFC 0048 section 4): at most 12 emoji, each once.
const OWN_SET_MAX = 12;
const splitOwnSet = (text) => [...new Set((text || "").split(/[\s,]+/).filter(Boolean))];

// Choosing your own set (#179): the emoji as chips - a click takes one out -, the emoji
// picker to add more, open for several picks in a row, and the field for pasting. The
// field is the form's value (reaction_set); the chips follow it.
function ownReactionSet(value) {
  const field = h("input", { id: "ereacts", name: "reaction_set", class: "in", "data-k": "ereacts",
    "aria-label": "Your own reactions", placeholder: "e.g. 🎉 ❤️ 👏", value: value || "",
    oninput: () => draw() });
  const chips = h("div", { class: "chips own-set", role: "group", "aria-label": "Your set" });
  const put = (set) => {
    field.value = set.join(" ");
    field.dispatchEvent(new Event("input", { bubbles: true }));   // the form keeps it
  };
  const add = (e) => {
    const set = splitOwnSet(field.value);
    if (set.includes(e)) return;
    if (set.length >= OWN_SET_MAX) { toast(`Your own set takes up to ${OWN_SET_MAX} emoji.`); return; }
    put([...set, e]);
  };
  const draw = () => {
    const set = splitOwnSet(field.value);
    chips.replaceChildren(...set.map(e => h("button", { type: "button", class: "chip emo-chip", text: e,
        title: "Take " + e + " out", "aria-label": "Take " + e + " out", onclick: () => put(set.filter(x => x !== e)) })),
      h("span", { class: "hint" + (set.length > OWN_SET_MAX ? " error" : ""), text: `${set.length} of ${OWN_SET_MAX}` }));
  };
  draw();
  // the glyph itself goes in, not its :shortcode: - a set is emoji, not text; no picker
  // with a core without /api/emoji
  const button = emojiMissing ? null : h("button", { type: "button", class: "btn emoji-btn", "aria-haspopup": "dialog",
    "aria-label": "Add emoji", title: "Add emoji to your set - the picker stays open for more",
    onclick: (ev) => openEmojiPicker("ereacts", ev.currentTarget, add, { stay: true }) }, svg(ICON.smile, 16), " Emoji");
  return h("div", { class: "own-set-box" }, chips, h("div", { class: "row-in" }, field, button));
}

// Remove a group you own (UN-RFC 0013): with the reason readers will see, after a warning.
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

// The owner's moderators and posters of a group: add or remove keys.
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

// The keys banned from a group you own or moderate, to add or lift.
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

// Your own list of ignored people (#72): kept with your settings, never sent anywhere.
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

// Hide or show posts by bots (UN-RFC 0030 6), as a setting that follows you.
async function toggleBots() {
  const on = !(S.sidebar && S.sidebar.hide_bots);
  await api("POST", "/api/settings", { hide_bots: on });
  await loadSidebar(); await loadGroup(); render();
  toast(on ? "Posts by bots are hidden." : "You see bots again, marked bot.");
}

// Show people's pictures, or identicons only (UN-RFC 0022 8.5).
async function togglePictures() {
  const on = !(S.sidebar && S.sidebar.pictures !== false);
  await api("POST", "/api/settings", { pictures: on });
  PEOPLE.clear();
  await loadSidebar(); render();
  toast(on ? "People's pictures are shown." : "Identicons only: pictures are not fetched or shown.");
}

// Show or hide what a hierarchy's maintainer blocked (UN-RFC 0018 5.4).
async function toggleShowBlocked() {
  const on = !(S.sidebar && S.sidebar.show_blocked);
  await api("POST", "/api/settings", { show_blocked: on });
  await loadSidebar(); await loadGroup(); render();
  toast(on ? "You see posts blocked by maintainers, marked." : "Posts blocked by maintainers are hidden.");
}

// Remove a member from a closed group: the others get a new key, after asking.
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

// Report a post to those who can act on it - the group's owner and moderators, the
// hierarchy's maintainer, the node's operator, the spam report issuers you follow - with
// why, what you want to tell them in Markdown, and screenshots, sent encrypted to each
// (unseenet#74, #70). The post is shown small at the top, so the title stays short.
function openReport(m) {
  // the post's own group: in the timeline or For you, not the list it is shown in
  const g = (m && m.group && groupOf(m.group)) || (S.data && S.data.group);
  if (!g || !m) return;
  const st = { targets: null, reasons: [], reason: "", chosen: new Set(), err: "", busy: false, anonymous: false };
  const dialog = { focus: "#rnote", node: null, files: [] };
  api("GET", `/api/groups/${encodeURIComponent(m.group || g.id)}/report?id=${encodeURIComponent(m.id)}`)
    .then(r => { st.targets = r.targets; st.reasons = r.reasons || []; r.targets.forEach(x => st.chosen.add(x.i)); })
    .catch(e => { st.err = e.message; st.targets = []; })
    .then(() => { if (S.dialog === dialog) redraw(); });
  const keepNote = () => { const t = dialog.node && dialog.node.querySelector("#rnote"); if (t) S.drafts["rnote:" + m.id] = t.value; };
  const redraw = () => { keepNote(); const old = dialog.node; dialog.node = build(); if (old && old.parentNode) old.replaceWith(dialog.node); };
  const go = async (e) => {
    e && e.preventDefault();
    keepNote();
    if (!st.chosen.size) { st.err = "Choose who gets it."; redraw(); return; }
    const files = dialog.files.map(f => ({ name: f.name, data: f.data, alt: (f.alt || "").trim() }));
    st.busy = true; st.err = ""; redraw();
    try {
      const got = await api("POST", `/api/groups/${encodeURIComponent(m.group || g.id)}/report`,
        { id: m.id, targets: [...st.chosen], reason: st.reason, note: (S.drafts["rnote:" + m.id] || "").trim(),
          files, anonymous: st.anonymous });
      delete S.drafts["rnote:" + m.id];
      closeDialog();
      if (got.job) {                    // sent in the background: postage takes a while (unseenet#653)
        S.reportJobs = { ...(S.reportJobs || {}), [got.job]: got.targets };
        toast(`Sending the report to ${got.targets} - a sealed copy each, which takes a minute or two. You can go on.`);
      } else toast(`Reported to ${got.sent}.`);       // a core from before
    } catch (x) { st.busy = false; st.err = x.message; redraw(); }
  };
  // screenshots and documents: pictures and PDFs, encrypted to each receiver (unseenet#637)
  const fg = { files: { max_size: 4194304 - 40, types: ["image/*", "application/pdf"] }, node_files: true };
  const build = () => dialogShell({ label: "Report a post", wide: true, cls: "report-dlg" },
    h("div", { class: "dh" }, h("h2", { text: "Report a post" }),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("form", { class: "db", onsubmit: go, onkeydown: (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") go(e); } },
      h("div", { class: "rpost", "aria-label": "The post" },
        h("div", { class: "rphd" }, h("b", { text: m.who || "" }), timeEl(m.date, "hint")),
        h("div", { class: "rpsub", text: m.kind === "chat" ? "" : (m.subject || "(no subject)") }),
        h("div", { class: "rptext", text: (m.text || "").slice(0, 400) })),
      h("fieldset", { class: "rfs" }, h("legend", { text: "What is wrong with it?" }),
        h("div", { class: "chips", role: "radiogroup" }, st.reasons.map(r => h("button", { type: "button",
          class: "chip" + (st.reason === r.id ? " on" : ""), role: "radio", "aria-checked": String(st.reason === r.id),
          onclick: () => { st.reason = st.reason === r.id ? "" : r.id; redraw(); } }, r.label)))),
      h("fieldset", { class: "rfs" }, h("legend", { text: "Send it to" }),
        st.targets === null ? h("p", { class: "muted", text: "Finding who can act on it …" }) :
          st.targets.length ? h("div", { class: "rtargets" }, st.targets.map(t => h("label", { class: "check rtarget" },
            h("input", { type: "checkbox", checked: st.chosen.has(t.i),
              onchange: (e) => { if (e.target.checked) st.chosen.add(t.i); else st.chosen.delete(t.i); } }), " " + t.who))) :
          h("p", { class: "muted", text: "Nobody here can be reached about it." })),
      h("div", { class: "label-row" }, h("label", { for: "rnote", text: "Tell them more (optional)" }), emojiButton("rnote")),
      h("textarea", { id: "rnote", class: "in rnote", "data-k": "rnote", rows: 7, spellcheck: "true",
        placeholder: "What happened, and anything that helps them act: links, what you have done already …",
        value: S.drafts["rnote:" + m.id] || "", oninput: (e) => { S.drafts["rnote:" + m.id] = e.target.value; } }),
      h("p", { class: "hint", style: "margin:0", text: "Markdown: *emphasis*, **strong**, - lists, > quotes, links." }),
      filePicker(dialog, fg, true, "Add screenshots or PDFs"),
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: st.anonymous,
        onchange: (e) => { st.anonymous = e.target.checked; } }), " Anonymous - they cannot see who reported it or answer you"),
      h("p", { class: "hint", style: "margin:0", text: "For posts that break the group's rules or the law. In an emergency, " +
        "contact the police: nobody on Unseenet can see who anyone is. Screenshots are saved again without " +
        "where and when they were taken." }),
      st.err ? h("p", { class: "error", role: "alert", text: st.err }) : null),
    h("div", { class: "df btns" }, h("button", { class: "btn", type: "button", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn primary", type: "button", disabled: st.busy || !st.targets, onclick: go },
        st.busy ? "Sending …" : "Report", h("kbd", { text: "Ctrl Enter" }))));
  dialog.node = build();
  S.dialog = dialog;
  render();
}

// N: write a new post here - a thread, or in a chat a private post to that person.
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
    send: (subject, text, notify, files, tags, languages) => doPost(g.id, { subject, body: text, signature: false, notify,
      ...(files && files.length ? { files } : {}), ...(tags && tags.length ? { tags } : {}),
      ...(languages !== undefined ? { languages } : {}) }, { text }) });
  setTimeout(() => { const s = document.getElementById("subject"); if (s) s.focus(); });
}

// Browse the groups your nodes carry, to read or follow one.
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
