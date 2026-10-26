// rules.js - your own rules for your feed and groups (UN-RFC 0051, unseenet#615): the editor,
// checked as you type through /api/rules/check, the suggestion shown when you have none
// (yours only if you save it), "Why is this here?", watching and ignoring threads, and
// how a thread list shows what the rules say: hidden, folded, dimmed, highlighted.
//
// Part of the page, split by area (#152): a plain script in static/, loaded in
// index.html's order, sharing one scope. Uses core.js's helpers (h, api, S, render,
// toast) and dialogs.js's dialogShell. Without rules the core sends no score and
// nothing here changes a list.
"use strict";

let rulesCheckTimer = null;

// Open the rules editor: your rules (or the core's suggestion when you have none), checked
// a moment after typing stops, with whether they are used, and Save.
async function openRules() {
  let r;
  try { r = await api("GET", "/api/rules"); } catch (x) { toast(x.message); return; }
  const st = { text: r.text || r.suggestion || "", on: r.on, problems: r.problems, count: r.rules,
               suggested: !r.text, busy: false, error: "" };
  const check = () => {
    clearTimeout(rulesCheckTimer);
    rulesCheckTimer = setTimeout(async () => {
      try { const c = await api("POST", "/api/rules/check", { text: st.text });
            st.problems = c.problems; st.count = c.rules; } catch (_) { /* checked on save */ }
      const out = document.querySelector("#rules-check");
      if (out) out.replaceWith(rulesCheck(st));
    }, 300);
  };
  if (st.suggested) check();
  S.dialog = { focus: "#rules-text", render: () => dialogShell({ label: "Your rules", class: "wide" },
    dialogHead("Your rules - for your feed and your groups"),
    h("p", { class: "hint", style: "margin:0", text: "Only you see them: they run here, and go with your " +
      "identity to your other devices." + (st.suggested ? " This is a suggestion - it is yours only if you save it." : "") }),
    h("textarea", { id: "rules-text", class: "in mono rules", "data-k": "rules-text", rows: 16, spellcheck: "false",
      value: st.text, oninput: (e) => { st.text = e.target.value; check(); } }),
    rulesCheck(st),
    h("label", { class: "check" }, h("input", { type: "checkbox", checked: st.on, onchange: (e) => { st.on = e.target.checked; } }),
      " Use my rules (off keeps them, to turn on again)"),
    st.error ? h("p", { class: "error", role: "alert", text: st.error }) : null,
    h("div", { class: "buttons" },
      h("button", { class: "btn", type: "button", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn primary", type: "button", disabled: st.busy, onclick: async () => {
        st.busy = true; st.error = ""; render();
        try {
          const got = await api("POST", "/api/rules", { text: st.text, on: st.on });
          closeDialog();
          toast(`Rules kept: ${got.rules} rule(s)` + (got.on ? "" : ", turned off") +
            (got.problems.length ? `; ${got.problems.length} line(s) not used` : ""));
          if (S.gid) await loadGroup();
          render();
        } catch (x) { st.busy = false; st.error = x.message; render(); }
      } }, "Save"))) };
  render();
}

// The line under the editor: how many rules are understood, or each line that is not and why.
function rulesCheck(st) {
  return h("div", { id: "rules-check", class: "hint mono", role: "status", style: "white-space:pre-wrap;margin:0" },
    st.problems && st.problems.length ? st.problems.map(p => `line ${p.line}: ${p.message}`).join("\n")
      : `${st.count || 0} rule(s), all understood.`);
}

// Why is this post here: which of your rules gave which points (UN-RFC 0051 section 10).
function openWhy(m) {
  S.dialog = { focus: ".dialog .btn", render: () => dialogShell({ label: "Why is this here?" },
    dialogHead("Why is this here?"),
    h("pre", { class: "mono why", text: m.why || "You have no rules (or they are off): the feed is newest first and threads are as they are." }),
    h("div", { class: "buttons" },
      h("button", { class: "btn", type: "button", onclick: () => { closeDialog(); openRules(); } }, "Your rules"),
      h("button", { class: "btn primary", type: "button", onclick: closeDialog }, "Close"))) };
  render();
}

// Watch, ignore or neither the thread a post is in - kept in your state (UN-RFC 0044 4.5).
async function markThread(m, mark) {
  const root = (m.references && m.references.length) ? m.references[0] : m.id;
  try { await api("POST", "/api/threads", { id: root, mark }); } catch (x) { toast(x.message); return; }
  toast(mark === "watched" ? "Watching this thread" : mark === "ignored" ? "Ignoring this thread" : "Neither watched nor ignored");
  if (S.gid) await loadGroup();
  render();
}

// The ⋯ menu's items for your rules: why, and the thread's mark - only in a threaded group
// or the timeline, where rules apply.
function ruleItems(m) {
  const here = S.data && S.data.group;
  if (!here || !(here.view === "threads" || here.id === TIMELINE) || m.private) return [];
  const mark = threadMarkOf(m);
  return [
    m.why ? ["Why is this here?", () => openWhy(m)] : null,
    mark !== "watched" ? ["Watch this thread", () => markThread(m, "watched")] : null,
    mark !== "ignored" ? ["Ignore this thread", () => markThread(m, "ignored")] : null,
    mark ? ["Neither watch nor ignore", () => markThread(m, "")] : null,
  ];
}

// The same as buttons, for the reader's "more" tools under a post in a threaded group.
function ruleButtons(m) {
  return ruleItems(m).filter(Boolean).map(([label, run]) => h("button", { class: "btn", onclick: run }, label));
}

// The mark of the thread a post is in, from its first row ("" when neither).
function threadMarkOf(m) {
  const msgs = (S.data && S.data.messages) || [];
  const root = (m.references && m.references.length) ? m.references[0] : m.id;
  const first = msgs.find(x => x.id === root);
  return (first && first.thread_mark) || "";
}

// A thread list as your rules have it: hidden rows left out, the replies under a folded
// post left out (unless you opened it), and how many are folded under each. Without
// scores (no rules) the list as it is.
function ruledRows(msgs) {
  if (!msgs.some(m => m.score !== undefined)) return { rows: msgs, folded: {} };
  S.unfolded = S.unfolded || {};
  const rows = [], folded = {};
  let under = null;
  for (const m of msgs) {
    if (under) {
      if (m.depth > under.depth) { folded[under.id] = (folded[under.id] || 0) + 1; continue; }
      under = null;
    }
    if (m.hidden) continue;
    rows.push(m);
    if ((m.actions || []).includes("fold") && !S.unfolded[m.id]) under = m;
  }
  return { rows, folded };
}

// The class a row gets from your rules: dimmed or highlighted.
function ruleClass(m) {
  const a = m.actions || [];
  return a.includes("highlight") ? " hl" : a.includes("dim") ? " dimmed" : "";
}

// After a group is shown: what is on the screen is seen, up to its newest post (UN-RFC
// 0044 4.5) - only while you have rules on (the rows have scores), since only rules use
// it: without them nothing is sent. Pseudo-groups (For you, the timeline, chats) keep none.
function markSeen(g, msgs) {
  if (!g || !g.type || g.id === FOR_YOU || g.id === TIMELINE || String(g.id).startsWith("contact:")) return;
  if (!msgs.some(m => m.score !== undefined)) return;
  const newest = msgs.reduce((a, m) => (m.date && (!a || m.date > a) ? m.date : a), "");
  if (!newest || (S.seenSent || {})[g.id] === newest) return;
  S.seenSent = { ...(S.seenSent || {}), [g.id]: newest };
  api("POST", `/api/groups/${encodeURIComponent(g.id)}/seen`, { until: newest }).catch(() => {});
}
