// teams.js - team inboxes (UN-RFC 0047, unseenet#341, #68): accepting the post that adds
// you as a reader, a team inbox as a mailbox of its own with its name, replying on the
// inbox's behalf - with the team's name and never your signature - and, for an inbox's
// owner, who reads it: adding and removing readers.
//
// The core keeps the team keys and checks everything (UN-RFC 0046 section 4.22); this
// file only shows it.
//
// Part of the page, split by area (#152): a plain script in static/, loaded in
// index.html's order, sharing one scope. Uses core.js's helpers (h, api, S, render,
// toast), dialogs.js's dialogShell and nodes.js's formDialog.
"use strict";

// The reader's button for a post that adds you as a reader of a team inbox.
function teamInviteButton(m) {
  if (!m.team_invite) return null;
  return h("button", { class: "btn primary", onclick: () => acceptTeam(m) }, "Read this inbox with the team");
}

// Accept an invitation: the core checks that it comes from the inbox's owner and that the
// key it brings is a reader, then keeps the key; the inbox opens.
async function acceptTeam(m) {
  if (!window.confirm("You will read this inbox and can reply as the team. The owner can remove you at any time. Accept?")) return;
  let got;
  try { got = await api("POST", "/api/teams/accept", { id: m.id }); }
  catch (x) { toast("Not accepted: " + x.message); return; }
  await loadSidebar();
  await openGroup(got.group);
  toast("You read this inbox now. Replies go out as the team.");
}

// In a team inbox you were removed from: say so, and offer to forget its key.
function teamRemovedNote(g) {
  if (!g.team || g.team.reader) return null;
  return h("div", { class: "note team-removed", role: "note" },
    "The owner removed you as a reader: new messages are not for you. ",
    h("button", { class: "link", onclick: async () => {
      try { await api("POST", "/api/teams/forget", { group: g.id }); } catch (x) { toast(x.message); return; }
      await loadSidebar(); await openGroup(FOR_YOU); toast("Its team key is gone from your vault.");
    } }, "Forget it"));
}

// Owner of an inbox: who reads it with a team key, add someone (a new team key goes to
// their inbox), remove a reader, and the name replies go out as.
async function openTeamReaders(g) {
  let r;
  try { r = await api("GET", "/api/teams/readers?group=" + encodeURIComponent(g.id)); }
  catch (x) { toast(x.message); return; }
  const st = { key: "", name: r.team_name || "", error: "", busy: false };
  const change = async (body) => {
    st.busy = true; st.error = ""; render();
    try { r = await api("POST", "/api/teams/readers", { group: g.id, ...body }); st.key = ""; }
    catch (x) { st.error = x.message; }
    st.busy = false; render();
  };
  S.dialog = { focus: "#tkey", render: () => dialogShell({ label: "Who reads this inbox", wide: true },
    dialogHead("Who reads this inbox"),
    h("div", { class: "db" },
      h("p", { class: "hint", style: "margin:0", text: "Readers have a team key of their own, made for this inbox " +
        "only. They read it and reply as the team; you need your key only to change who reads. At most 16." }),
      r.readers.length ? h("div", { class: "issuers" }, r.readers.map(k => h("div", { class: "rrow" },
        h("span", { class: "mono hint", text: k }),
        h("button", { class: "btn small", type: "button", disabled: st.busy, onclick: () => change({ remove: k }) }, "Remove")))) :
        h("p", { class: "muted", text: "Nobody reads it with a team key yet." }),
      h("label", { for: "tname", text: "The name replies go out as" }),
      h("input", { id: "tname", class: "in", maxlength: 64, placeholder: "e.g. Example (operator)", value: st.name,
        oninput: (e) => { st.name = e.target.value; } }),
      h("label", { for: "tkey", text: "Add a reader: their key" }),
      h("input", { id: "tkey", class: "in mono", placeholder: "ed25519:…", value: st.key, oninput: (e) => { st.key = e.target.value.trim(); } }),
      st.error ? h("p", { class: "error", role: "alert", text: st.error }) : null),
    h("div", { class: "df btns" },
      h("button", { class: "btn", type: "button", onclick: closeDialog }, "Close"),
      h("button", { class: "btn primary", type: "button", disabled: st.busy, onclick: () => {
        if (!st.key) { st.error = "Paste their key."; render(); return; }
        change({ add: st.key, team_name: st.name.trim() }).then(() => { if (!st.error) toast("A team key is in their inbox, to accept."); });
      } }, "Add reader"))) };
  render();
}

// --- Operator boxes (UN-RFC 0065, gui#299) ---------------------------------------------
// An operator box is a team inbox your servers write to: what happened, what waits for
// you, answers to your commands. GET /api/teams lists its servers; the sidebar shows it
// as "My servers" with your private things, not in the group tree. A new message is for
// one server, chosen by name - the core puts "name:" first and seals it into the box, as
// `unseenet operator say` does. Answers to a server's message go to that server already.

// Mark the boxes among the groups and keep them, with their servers, in sb.operator.
// The groups stay in sb.hierarchies (reactions and the reader look them up there); the
// tree leaves them out (treeHierarchies).
function markOperatorBoxes(sb, teams) {
  const groups = sb.hierarchies.flatMap(hr => hr.groups);
  const followed = new Set(groups.map(g => g.id));          // one you stopped reading is gone
  const boxes = (teams || []).filter(t => Array.isArray(t.servers) && t.reader !== false && followed.has(t.group));
  const ids = new Set(boxes.map(b => b.group));
  groups.forEach(g => { if (ids.has(g.id)) g.operator = true; });
  sb.operator = boxes.map(b => ({ id: b.group, name: b.name || "",
    servers: b.servers.filter(s => s && s.key),
    unread: (groups.find(g => g.id === b.group) || {}).unread || 0 }));
}

// The operator box with this id, or null: a team inbox your servers write to.
function operatorBox(gid) {
  return ((S.sidebar && S.sidebar.operator) || []).find(b => b.id === gid) || null;
}

// "My servers" - with the box's own name only when you read more than one, and never
// "My servers · My servers" for a box that is called that itself.
function boxLabel(b) {
  const many = ((S.sidebar && S.sidebar.operator) || []).length > 1;
  const own = (b.name || "").trim();
  return many && own && own.toLowerCase() !== "my servers" ? "My servers · " + own : "My servers";
}

// The hierarchies as the group tree draws them: without the operator boxes, and without a
// hierarchy that held nothing else.
function treeHierarchies(sb) {
  return sb.hierarchies.map(hr => {
    const gs = hr.groups.filter(g => !g.operator);
    return gs.length === hr.groups.length ? hr : gs.length ? { ...hr, groups: gs } : null;
  }).filter(Boolean);
}

// The box's rows in the private part of the sidebar, each with its ⋯ (a right click
// opens it too), as a group in the tree has.
function operatorItems(sb, row) {
  return (sb.operator || []).map(b => {
    const id = "box:" + b.id, g = allGroups().find(x => x.id === b.id) || { id: b.id, label: boxLabel(b) };
    return h("div", { class: "grouprow box-row", oncontextmenu: (e) => { e.preventDefault(); S.menuFor = id; render(); } },
      row(b.id, ICON.server, boxLabel(b), b.unread, "What your servers tell you, and your commands to them"),
      sideMenu(id, "More for " + boxLabel(b), [[null, [
        b.unread ? ["Mark all read", () => markAllRead([g])] : null,
        ["Copy address", () => copyGroupAddress(g)],
        ["Stop reading this box", () => stopReadingBox(b)]]]]));
  });
}

// Stop reading an operator box: its team key goes from your vault, and it from your
// sidebar (POST /api/teams/forget). Its owner can add you again.
async function stopReadingBox(b) {
  if (!window.confirm(`Stop reading ${boxLabel(b)}? Its team key goes from your vault: you no longer see what ` +
      "its servers write, and cannot write to them. The box's owner can add you again.")) return;
  try { await api("POST", "/api/teams/forget", { group: b.id }); } catch (x) { toast(x.message); return; }
  if (S.gid === b.id) { S.gid = null; S.data = null; }   // the first group comes instead
  await loadSidebar();
  toast("You no longer read " + boxLabel(b) + ".");
}

// The head's line under "My servers": who is in it.
function boxServersLine(b) {
  const named = b.servers.filter(s => s.name).map(s => s.name);
  const waiting = b.servers.length - named.length;
  if (!b.servers.length) return "No server writes here yet.";
  return "Servers: " + named.join(", ") + (waiting ? (named.length ? ", " : "") +
    `${waiting} not heard from yet` : "") + ". Everyone who reads the box sees what you write here.";
}

// N in a team inbox: in an operator box a message to one of its servers; in another team
// inbox a private post to someone, on the inbox's behalf.
function openTeamNew(g) {
  const b = operatorBox(g.id);
  if (b) { openServerMessage(b); return; }
  if (!g.team || !g.team.reader) return;
  openPersonPicker("post", { title: "New message as " + g.team.name, onPick: (p) => openTeamPost(g, p) });
}

// A private post to someone as the team (UN-RFC 0047): sealed to them, without your
// signature, which would say who you are (section 8).
function openTeamPost(g, p) {
  openComposeWindow({ g, title: `To ${p.label}, as ${g.team.name}`, subject: "", body: "\n", cursor: 0, private: true,
    send: (subject, text, _notify, files, _tags, _languages, _days, card) => doSend("/api/private", g.id, {
      key: p.key, subject, body: text, as_team: g.id,
      ...(files && files.length ? { files } : {}), ...(card ? { card } : {}) }, { text }) });
  setTimeout(() => { const s = document.getElementById("subject"); if (s) s.focus(); });
}

// A message to one server in the box: To, the command, Send. Servers not heard from yet
// have no name to address them by, so they cannot be chosen.
function openServerMessage(b, key = "") {
  const named = b.servers.filter(s => s.name);
  if (!named.length) { toast("No server has written in this box yet, so none can be addressed by name."); return; }
  const first = named.find(s => s.key === key) || named[0];
  formDialog({ label: "New message", title: "New message to a server", focus: "#otext", button: "Send",
    values: { to: first.key, text: "" },
    note: "A command, e.g. status or help. It goes into the box: everyone who reads it sees the message and the answer.",
    fields: (v) => [
      h("label", { for: "oto", text: "To" }),
      h("select", { id: "oto", name: "to", class: "in", "data-k": "op-to" }, b.servers.map(s => h("option", {
        value: s.key, disabled: !s.name, selected: s.key === v.to,
        text: s.name || "(not heard from yet) " + s.key.slice(0, 20) + "…" }))),
      h("label", { for: "otext", text: "Message" }),
      h("input", { id: "otext", name: "text", class: "in mono", "data-k": "op-text", autocomplete: "off",
        placeholder: "status", value: v.text || "" })],
    submit: async (v) => {
      const text = (v.text || "").trim();
      if (!text) throw new Error("Write a command, e.g. status.");
      const s = b.servers.find(x => x.key === v.to && x.name);
      if (!s) throw new Error("Choose a server.");
      closeDialog();
      await doSend("/api/private", b.id, { key: s.key, body: text, chat: true, as_team: b.id }, { text });
      toast("Sent to " + s.name + ". Its answer comes in the box.");
    } });
}
