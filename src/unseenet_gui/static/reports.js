// reports.js - spam reports (UN-RFC 0045, unseenet#122, unseenet-gui#70): a post hidden by
// a report shown as hidden in its place - who hid it and why, "Show anyway", "Stop
// following" - the issuers you follow (those your hierarchies name, on or off, and your
// own), and being an issuer yourself: starting your reports group, publishing a report
// of a post or its author, the reports people sent you, and those you published.
//
// Each reader decides: nothing is hidden for you by an issuer you do not follow, and
// nothing is hidden silently. The core decides what is hidden (``reported`` on every
// post, UN-RFC 0046 section 4.21); this file only shows it.
//
// Part of the page, split by area (#152): a plain script in static/, loaded in
// index.html's order, sharing one scope. Uses core.js's helpers (h, api, S, render,
// toast), dialogs.js's dialogShell and nodes.js's formDialog.
"use strict";

const REASON_TEXT = { spam: "spam", flood: "flooding", phishing: "phishing", malware: "malware",
  illegal: "illegal", other: "other" };

// "Hidden by Spamjægeren: spam" for a post hidden by a report, "" for others.
function reportedText(m) {
  const r = m && m.reported;
  if (!r) return "";
  return `Hidden by ${r.label}: ${REASON_TEXT[r.reason] || r.reason}` +
    (r.kind === "key" ? " (its author)" : "") + (r.automatic ? " · automatic" : "");
}

// In a post's place: who hid it and why, with Show anyway and Stop following - never
// hidden silently (UN-RFC 0045 section 7.3).
function reportedNote(m) {
  const r = m.reported;
  return h("div", { class: "reported", role: "note" },
    h("span", { class: "rtext", text: reportedText(m) }),
    h("span", { class: "racts" },
      h("button", { class: "link", type: "button", onclick: (e) => { e.stopPropagation(); showReported(m); } }, "Show anyway"),
      h("button", { class: "link", type: "button", title: "Their reports hide nothing for you any more",
        onclick: (e) => { e.stopPropagation(); stopFollowingIssuer(r.issuer, r.label); } }, "Stop following " + r.label)));
}

// Show one hidden post anyway, on this device.
async function showReported(m) {
  try { await api("POST", `/api/groups/${encodeURIComponent(m.group)}/show`, { id: m.id }); }
  catch (x) { toast(x.message); return; }
  if (S.gid) await loadGroup();
  render();
}

// Stop following an issuer - also one your hierarchy names: its reports hide nothing for you.
async function stopFollowingIssuer(key, label) {
  try { S.reports = await api("POST", "/api/reports/follow", { key, on: false }); }
  catch (x) { toast(x.message); return; }
  toast(`${label}'s reports no longer hide anything for you.`);
  if (S.gid) await loadGroup();
  render();
}

// What the issuers you follow are, kept for the menus (whether you are an issuer).
async function loadReports() {
  try { S.reports = await api("GET", "/api/reports"); } catch (_) { /* asked again when needed */ }
  return S.reports;
}

// Where an issuer hides posts for you: the hierarchies and groups whose maintainer or
// owner named it (UN-RFC 0045 sections 7.1, 7.5), and everywhere if you follow it.
function issuerWhere(i) {
  const named = [...(i.hierarchies || []).map(x => x + ".*"), ...(i.groups || []).map(g => labelOf(g))];
  if (!named.length) return "followed by you, in every group";
  return "named for " + named.join(", ") + (i.yours ? ", and followed by you everywhere" : "");
}

// Spam reports: the issuers that hide posts for you - those your hierarchies name, which you
// can turn off, and those you follow yourself - and following one by its key.
async function openReportIssuers() {
  const r = await loadReports();
  if (!r) { toast("Could not read your report issuers."); return; }
  const st = { key: "", label: "", error: "", busy: false };
  const again = async () => { await loadReports(); if (S.gid) await loadGroup(); render(); };
  const set = async (key, on, label) => {
    st.busy = true; st.error = ""; render();
    try { S.reports = await api("POST", "/api/reports/follow", { key, on, label: label || "" }); }
    catch (x) { st.error = x.message; }
    st.busy = false; await again();
  };
  S.dialog = { focus: ".dialog .btn.primary", render: () => dialogShell({ label: "Spam reports", wide: true },
    dialogHead("Spam reports"),
    h("div", { class: "db" },
      h("p", { class: "hint", style: "margin:0", text: "Issuers publish reports of spam. Their reports hide posts for " +
        "you only while you follow them, and a hidden post always says who hid it, so you can show it anyway. " +
        "Your own posts and your contacts' are never hidden." }),
      (S.reports.issuers || []).length ? h("div", { class: "issuers" }, S.reports.issuers.map(i =>
        h("div", { class: "issuer" + (i.on ? "" : " off") },
          h("label", { class: "check" }, h("input", { type: "checkbox", checked: i.on, disabled: st.busy,
            "aria-label": (i.on ? "Stop following " : "Follow ") + i.label,
            onchange: (e) => set(i.key, e.target.checked, i.label) }), " ", h("b", { text: i.label })),
          h("span", { class: "hint", text: issuerWhere(i) }),
          h("span", { class: "mono hint ikey", title: i.key, text: i.key })))) :
        h("p", { class: "muted", text: "You follow no issuers, and the hierarchies of your groups name none." }),
      h("h3", { class: "sub", text: "Follow an issuer" }),
      h("label", { for: "ikey", text: "Its key" }),
      h("input", { id: "ikey", class: "in mono", placeholder: "ed25519:…", value: st.key, oninput: (e) => { st.key = e.target.value.trim(); } }),
      h("label", { for: "ilabel", text: "What to call it (optional)" }),
      h("input", { id: "ilabel", class: "in", value: st.label, oninput: (e) => { st.label = e.target.value; } }),
      st.error ? h("p", { class: "error", role: "alert", text: st.error }) : null),
    h("div", { class: "df btns" },
      h("button", { class: "btn", type: "button", onclick: () => { closeDialog(); openIssuing(); } },
        S.reports.mine ? "Your reports" : "Become an issuer"),
      h("button", { class: "btn", type: "button", onclick: closeDialog }, "Close"),
      h("button", { class: "btn primary", type: "button", disabled: st.busy, onclick: () => {
        if (!st.key) { st.error = "Paste the issuer's key."; render(); return; }
        set(st.key, true, st.label).then(() => { st.key = ""; st.label = ""; render(); });
      } }, "Follow"))) };
  render();
}

// Being an issuer: start (or change) your reports group - what you report and where to
// object - then the reports people sent you, ready to publish, and those you published.
async function openIssuing() {
  const r = await loadReports();
  if (!r) { toast("Could not read your report settings."); return; }
  if (!r.mine) {
    let teams = [];
    try { teams = (await api("GET", "/api/teams")).teams.filter(t => t.reader); } catch (_) { /* none */ }
    formDialog({ label: "Become an issuer", title: "Become a spam report issuer", focus: "#rpolicy", button: "Start",
      note: "Your reports are public and signed with your key. They hide posts only for those who choose to follow you.",
      fields: (v) => [
        h("label", { for: "rpolicy", text: "What you report, and how" }),
        h("textarea", { id: "rpolicy", name: "policy", class: "in", rows: 3, value: v.policy || "" }),
        h("label", { for: "rland", text: "Where reports sent to you land" }),
        h("select", { id: "rland", name: "land", class: "in" },
          h("option", { value: "", selected: !v.land, text: "Your own inbox (Private posts)" }),
          teams.map(t => h("option", { value: t.group, selected: v.land === t.group, text: t.name + " - a team inbox you read" }))),
        h("p", { class: "hint", style: "margin:0", text: "A team inbox lets others read and answer reports with you. " +
          "It is also where people object to your reports." }),
        h("label", { for: "rcontact", text: "Or where to object, if not there (a web address, optional)" }),
        h("input", { id: "rcontact", name: "contact", class: "in", value: v.contact || "" })],
      submit: async (v) => {
        const contact = (v.land || "").trim() || (v.contact || "").trim();
        S.reports = await api("POST", "/api/reports/start", { policy: (v.policy || "").trim(), contact });
        closeDialog(); toast("Your reports group is started."); openIssuing();
      } });
    return;
  }
  let received = null, mine = null, err = "";
  const fill = async () => {
    try { received = (await api("GET", "/api/reports/received")).received;
          mine = (await api("GET", "/api/reports/mine")).reports; }
    catch (x) { err = x.message; }
    render();
  };
  fill();
  S.dialog = { focus: ".dialog .btn.primary", render: () => dialogShell({ label: "Your reports", wide: true },
    dialogHead("Your reports"),
    h("div", { class: "db" },
      h("p", { class: "hint", style: "margin:0", text: r.mine.policy || "You publish spam reports." }),
      h("h3", { class: "sub", text: "Sent to you" }),
      received === null ? h("p", { class: "muted", text: err || "Reading your inbox …" }) :
        received.length ? received.map(x => h("div", { class: "rrow" },
          h("span", { text: x.subject }), h("span", { class: "mono hint", text: x.id }),
          h("button", { class: "btn small", type: "button", onclick: () => openPublish({ id: x.id, group: x.group, key: x.author_key, subject: x.subject }) }, "Publish…"))) :
        h("p", { class: "muted", text: "Nobody has sent you a report." }),
      h("h3", { class: "sub", text: "Published" }),
      mine === null ? null : mine.length ? mine.map(x => h("div", { class: "rrow" },
        h("span", { text: `${x.posts.length} post(s), ${x.keys.length} key(s)` + (x.note ? " - " + x.note : "") }),
        timeEl(x.date, ""),
        h("button", { class: "btn small", type: "button", onclick: async () => {
          try { await api("POST", "/api/reports/withdraw", { id: x.id }); toast("Report withdrawn."); fill(); }
          catch (e) { toast(e.message); } } }, "Withdraw"))) :
        h("p", { class: "muted", text: "You have published no reports." })),
    h("div", { class: "df btns" },
      h("button", { class: "btn primary", type: "button", onclick: closeDialog }, "Close"))) };
  render();
}

// Publish a report of a post - and, if you choose, of its author's key for up to a year
// (UN-RFC 0045 section 4). ``p``: {id, group, key, subject}.
function openPublish(p) {
  const reasons = (S.reports && S.reports.reasons) || Object.keys(REASON_TEXT);
  formDialog({ label: "Publish a spam report", title: "Report “" + (p.subject || p.id) + "”", focus: "#rreason", button: "Publish",
    note: "Your report is public and signed by you; the person who told you is never named in it.",
    values: { reason: p.reason || "spam", days: 365 },
    fields: (v) => [
      h("label", { for: "rreason", text: "Why" }),
      h("select", { id: "rreason", name: "reason", class: "in" }, reasons.map(x =>
        h("option", { value: x, selected: (v.reason || "spam") === x }, REASON_TEXT[x] || x))),
      p.key ? h("label", { class: "check" }, h("input", { type: "checkbox", name: "key", checked: !!v.key }),
        " Also its author: everything they post, for") : null,
      p.key ? h("input", { name: "days", type: "number", min: 1, max: 365, class: "in short", value: v.days || 365,
        "aria-label": "Days" }) : null,
      p.key ? h("span", { class: "hint", text: " days (at most 365)" }) : null,
      h("label", { for: "rnote2", text: "A note for people (optional, 200 characters)" }),
      h("input", { id: "rnote2", name: "note", class: "in", maxlength: 200, value: v.note || "" })],
    submit: async (v) => {
      const body = { posts: [{ id: p.id, group: p.group, reason: v.reason || "spam" }], note: (v.note || "").trim() };
      if (p.key && v.key) body.keys = [{ key: p.key, reason: v.reason || "spam", days: Number(v.days) || 365 }];
      await api("POST", "/api/reports/publish", body);
      closeDialog(); toast("Report published.");
    } });
}

// Whether you publish spam reports: from your settings, or what /api/reports said.
function isIssuer() {
  return !!((S.sidebar && S.sidebar.report_issuer) || (S.reports && S.reports.mine));
}

// A report someone sent you (in your inbox or a team inbox you read): open the post it
// names, and - as an issuer - publish a report of it, with the reporter's reason. The
// reporter is never named in what you publish.
function reportedPostButtons(m) {
  const r = m.report;
  if (!r) return null;
  return [
    h("button", { class: "btn", onclick: () => openReportedPost(r) }, "Open the reported post"),
    isIssuer() ? h("button", { class: "btn primary", onclick: () => openPublish({ id: r.id, group: r.group,
      key: r.author_key, subject: m.subject.replace(/^Report: /, ""), reason: r.reason }) }, "Publish a spam report…") : null];
}

// Go to the post a report names, if you follow its group; otherwise say how.
async function openReportedPost(r) {
  if (!groupOf(r.group)) {
    toast("You do not follow " + labelOf(r.group) + ": follow it (G) and find " + r.id);
    return;
  }
  await openGroup(r.group);
  S.post = r.id; S.mobileReading = true;
  render();
}

// The ⋯ menu's items for reports: show a hidden post anyway; as an issuer, publish a
// report of a post that is not yours.
function reportItems(m) {
  if (!m || m.private) return [];
  return [
    m.reported ? ["Show anyway", () => showReported(m)] : null,
    isIssuer() && !m.mine && !m.reported ? ["Publish a spam report…",
      () => openPublish({ id: m.id, group: m.group, key: m.key, subject: subjectOf(m) })] : null,
  ];
}
