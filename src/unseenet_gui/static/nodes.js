// nodes.js - your nodes (#111, unseenet#518).
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- your nodes (#111, unseenet#518) -------------------------------------------------
// As the terminal client's "Your nodes": you are the same on every node - your key is in
// the vault. Each group is read from one node; new groups and your inbox go to the
// default. Names come from the core: the known-node list's, else the node's own, marked.
function nodeSource(n) {
  return n.source === "known" ? h("span", { class: "chip", title: "On the signed list of known nodes", text: "listed" })
    : n.source === "self" ? h("span", { class: "chip warn", title: "The node's own name: anyone can give a node any name", text: "unlisted" })
    : null;
}
// Your nodes (#111): which is used, how each is doing, add one, remove one, make one the
// first.
function openNodes() {
  let list = null, err = "", info = {}, asked = false, busy = false, open = null, adding = "";
  const load = async (withInfo) => {
    try {
      const r = await api("GET", "/api/nodes" + (withInfo ? "?info=1" : ""));
      list = r;
      if (withInfo) { info = Object.fromEntries(r.nodes.map(n => [n.address, n])); asked = true; }
    } catch (e) { err = e.message; }
    if (S.dialog && S.dialog.nodes) render();
  };
  const change = async (action, address, done) => {
    if (busy) return;
    busy = true; render();
    try {
      const r = await api("POST", "/api/nodes", { action, address });
      list = r; adding = "";
      if (done) toast(done(r));
      await loadState(); await loadSidebar();
      load(true);                                    // ask the new one too
    } catch (e) { toast(e.message); }
    busy = false;
    if (S.dialog && S.dialog.nodes) render();
  };
  const remove = (n) => confirmDialog({ title: "Stop using this node?", danger: true, button: "Remove",
    text: `${n.label}\n\n${n.address}\n\nGroups you read from it move to your default node (if it carries them). Nothing is deleted on the node itself.`,
    ok: () => { S.dialog = dialog; change("remove", n.address, r => r.moved && r.moved.length
      ? `${n.label} removed - ${r.moved.length} ${r.moved.length === 1 ? "group" : "groups"} now read from ${nodeLabel(S.state.node)}.`
      : `${n.label} removed.`); } });
  const state = (n) => {
    const live = (S.nodes || {})[n.address];
    if (asked) return info[n.address] && info[n.address].reachable
      ? h("span", { class: "state ok", text: "answers" }) : h("span", { class: "state bad", text: "does not answer" });
    if (live) return h("span", { class: "state " + (live.up ? "ok" : "bad"), text: live.up ? "connected" : "not reachable" });
    return h("span", { class: "muted", text: "asking …" });
  };
  const details = (n) => {
    const i = info[n.address] && info[n.address].info;
    if (!asked) return h("p", { class: "hint", text: "Asking the node over Tor …" });
    if (!i) return h("p", { class: "hint", text: i === null ? "The node does not answer right now." : "The node gives no information." });
    const p = i.policy || {};
    const row = (k, v) => v === undefined || v === null || v === "" ? null : [h("dt", { text: k }), h("dd", { class: "mono", text: String(v) })];
    return h("div", { class: "node-info" },
      i.description ? h("p", { style: "margin:0 0 6px", text: i.description }) : null,
      h("dl", { class: "kv" },
        row("Carries", i.carries === undefined ? null : `${i.carries} ${i.carries === 1 ? "group" : "groups"}`),
        row("Its own name", i.name), row("Software", i.software), row("Node key", i.node_key),
        row("Operator", i.operator), row("Contact", i.contact),
        row("New groups", p.new_groups), row("Keeps posts", p.retention_days ? p.retention_days + " days" : null),
        row("Postage", p.min_pow), row("Key level", p.min_ripe),
        row("Files", p.files === undefined ? null : (p.files ? "carried" : "not carried")), row("Logs", p.logging)));
  };
  const nodeRow = (n) => h("div", { class: "node-row" + (n.default ? " default" : ""), "data-k": "node:" + n.address },
    h("div", { class: "node-head" },
      h("span", { class: "ic", title: n.default ? "Default: new groups and your inbox go here" : "", text: n.default ? "♦" : "" }),
      h("span", { class: "nm" }, h("strong", { text: n.name || shortNode(n.address) }), " ", nodeSource(n)),
      state(n),
      // how many of YOUR groups are read from it - not what it carries, which Details says (#153)
      h("span", { class: "muted", title: "Followed groups you read from this node. If it stops answering, they move to another of your nodes.",
        text: n.groups ? `${n.groups} ${n.groups === 1 ? "group" : "groups"} read here` : "none read here" })),
    n.description ? h("div", { class: "hint", text: n.description }) : null,
    h("div", { class: "node-addr" },
      h("code", { class: "mono", text: n.address }),
      h("button", { class: "btn small", onclick: () => copy(n.address, "The address is copied.") }, "Copy")),
    h("div", { class: "btns" },
      h("button", { class: "btn small", "aria-expanded": String(open === n.address), onclick: () => { open = open === n.address ? null : n.address; render(); } }, open === n.address ? "Hide details" : "Details"),
      n.default ? null : h("button", { class: "btn small", disabled: busy, onclick: () => change("default", n.address,
        () => `New groups and your inbox now go to ${n.label}.`) }, "Make default"),
      list.nodes.length > 1 ? h("button", { class: "btn small danger", disabled: busy, onclick: () => remove(n) }, "Remove") : null),
    open === n.address ? details(n) : null);
  const addPart = () => h("div", { class: "node-add" },
    h("h3", { text: "Add a node" }),
    h("p", { class: "hint", style: "margin:0", text: "You keep your key and your groups; the node's groups can then be found with G." }),
    (list.known || []).map(k => h("div", { class: "cmd" },
      h("span", { class: "nm" }, h("span", { class: "mono", text: k.name || shortNode(k.address) }), " ",
        h("small", { text: k.description || "" }), h("small", { class: "mono addr", text: k.address })),
      h("button", { class: "btn primary", disabled: busy, "data-k": "add:" + k.address,
        onclick: () => change("add", k.address, () => `Added ${k.label}.`) }, "Add"))),
    h("form", { class: "node-other", onsubmit: (e) => { e.preventDefault(); const v = adding.trim(); if (v) change("add", v, r => {
        const n = r.nodes.find(x => x.address === v); return `Added ${n ? n.label : v}.`; }); } },
      h("label", { for: "naddr", class: "sr", text: "A node's address" }),
      h("input", { id: "naddr", class: "field mono", "data-k": "naddr", placeholder: "or an address: xyz….onion or host:port", value: adding,
        oninput: (e) => { adding = e.target.value; } }),
      h("button", { class: "btn", type: "submit", disabled: busy }, "Add")));
  const dialog = { nodes: true, render: () => dialogShell({ label: "Your nodes", wide: true },
    h("div", { class: "dh" }, h("h2", { text: "Your nodes" }), h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db", "data-scroll": "nodes" },
      h("p", { class: "hint", style: "margin:0", text: "You are the same on every node - your key lives in your vault. Each group is read from one node; new groups and your inbox go to the default node (♦)." }),
      err ? h("p", { class: "error", text: err }) : null,
      list === null && !err ? h("p", { class: "muted", text: "Loading …" }) : null,
      list ? [list.nodes.map(nodeRow), addPart()] : null),
    h("div", { class: "df" }, h("span", { text: list ? `${list.nodes.length} ${list.nodes.length === 1 ? "node" : "nodes"}` : "" }), h("span", { text: "Esc close" }))) };
  S.dialog = dialog;
  render();
  load(false).then(() => load(true));            // the list at once, what the nodes say after
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

// A dialog with fields and a submit button, that keeps what was typed across redraws and
// shows the error.
function formDialog({ label, title, focus, fields, submit, button, note, values }) {
  let err = "";
  const vals = { ...(values || {}) };       // what you entered, also across a refresh()
  const keep = (e) => {
    if (!e.target.name || (e.target.type === "radio" && !e.target.checked)) return;   // the chosen radio only
    vals[e.target.name] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  };
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

// Add a key as a contact with a name of your own, never seen by others.
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

// Remove a contact; the chat stays.
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
// Type to find someone (#118, unseenet#523): any part of the name you gave them, their
// key or a name they hold (sonia@lorensen). Up/Down choose, Enter chats, Esc clears the
// filter first and closes on the second press.
function contactMatches(c, q) {
  if (!q) return true;
  const words = [c.label, c.key, (c.key || "").replace(/^ed25519:/, ""), ...(c.names || [])];
  return words.some(w => (w || "").toLowerCase().includes(q));
}

// Your contacts: find one, chat, add, rename, remove.
function openContacts() {
  let removing = null;                         // Remove asks once more, on the button itself
  let query = "", at = 0;
  const shownList = () => {
    const q = query.trim().toLowerCase();
    return contactList().filter(c => contactMatches(c, q))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  };
  const looksLikeKey = (t) => /^ed25519:[a-z2-7]{20,}$/i.test(t.trim());
  S.dialog = { focus: "#cfind", render: () => {
    const all = contactList(), list = shownList();
    if (at >= list.length) at = Math.max(0, list.length - 1);
    const count = !all.length ? "" : list.length === all.length ? `${all.length} contacts` :
      `${list.length} of ${all.length} contacts`;
    return dialogShell({ label: "Contacts", wide: true },
      h("div", { class: "dh" }, h("h2", { text: "Contacts" }), h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
      all.length ? h("div", { class: "side-filter cfind" }, svg(ICON.search, 16),
        h("label", { for: "cfind", class: "sr", text: "Find a contact" }),
        h("input", { id: "cfind", type: "search", "data-k": "cfind", autocomplete: "off", value: query,
          placeholder: "Find: a name, a key or sonia@lorensen",
          "aria-controls": "clist", "aria-activedescendant": list.length ? "c-" + at : null,
          oninput: (e) => { query = e.target.value; at = 0; removing = null; render(); },
          onkeydown: (e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              at = Math.max(0, Math.min(list.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)));
              render();
              const row = document.getElementById("c-" + at);
              if (row) row.scrollIntoView({ block: "nearest" });
            } else if (e.key === "Enter" && list[at]) {
              e.preventDefault(); closeDialog(); openGroup(list[at].id);
            } else if (e.key === "Escape" && query) {
              e.preventDefault(); e.stopPropagation(); query = ""; at = 0; render();
            }
          } })) : null,
      h("div", { class: "db list", id: "clist", role: "listbox", "aria-label": "Contacts" },
        list.length ? list.map((c, i) => h("div", { class: "cmd" + (i === at ? " on" : ""), id: "c-" + i,
            role: "option", "aria-selected": String(i === at), onmouseenter: () => { if (at !== i) { at = i; render(); } } },
          h("span", { class: `av xs c${c.colour}`, "aria-hidden": "true", text: initials(c.label) }),
          h("span", { class: "nm" }, h("span", { text: c.label }),
            c.names && c.names.length ? h("span", { class: "hint", text: " " + c.names.join(", ") }) : null),
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
        all.length ? h("div", { style: "padding:12px" },
          h("p", { class: "muted", style: "margin:0 0 8px", text: "No contacts match." }),
          looksLikeKey(query) ? h("div", { class: "row" },
            h("button", { class: "btn primary", onclick: () => { closeDialog(); openGroup("contact:" + query.trim()); } }, "Chat with this key"),
            h("button", { class: "btn", onclick: () => openAddContact(query.trim(), "") }, "Add as contact")) : null) :
        h("p", { class: "muted", style: "padding:12px", text: "No contacts yet. Open a post and choose Add contact to give its author a name of your own." })),
      h("div", { class: "df" }, h("span", { text: count }), h("span", { text: all.length ? "↑↓ choose · Enter chat · Esc " + (query ? "clear" : "close") : "Esc close" })));
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

// Create a group: name, type, view (threads, chat, feed, site), kinds, files and comments.
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

// Invite a key to a closed group you own.
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

// Your signature: the template, and a preview of it as it will be signed.
async function openSignature() {
  const cur = await api("GET", "/api/settings");
  formDialog({ values: { template: cur.signature }, label: "Signature", title: "Your signature", focus: "#sig", button: "Save",
    note: "Added below your posts (not chat). {name}, {key} and {fp} are filled in. Empty: no signature. At most 4 lines.",
    fields: (vals) => [h("label", { for: "sig", class: "sr", text: "Signature" }),
      h("textarea", { id: "sig", name: "template", class: "in mono", value: vals.template, "data-k": "sig", style: "min-height:100px" })],
    submit: async (v) => { await api("POST", "/api/settings", { signature: v.template }); closeDialog(); toast("Signature saved."); } });
}
