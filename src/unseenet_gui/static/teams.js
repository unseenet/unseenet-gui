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
