// reader.js - the newsreader and pinned posts (UN-RFC 0033, UN-RFC 0046 section 4.12).
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- discussion: the newsreader (as in the terminal client) ------------------
// The posts as a tree, one row each; the selected one below, to read; R answers
// in a compose window with the post quoted. Chat groups are chats (chatView).
function threadsOf(msgs) {
  const out = [];
  for (const m of msgs) {
    if (m.depth === 0 || !out.length) out.push({ root: m, items: [m] });
    else out[out.length - 1].items.push(m);
  }
  return out;
}

// The selected post; if it is (briefly) not in the list, stay where you were
// instead of jumping to the first unread.
function currentPost(msgs) {
  const m = msgs.find(m => m.id === S.post);
  if (m) { S.postAt = msgs.indexOf(m); return m; }
  if (S.post && S.postAt != null) return msgs[Math.min(S.postAt, msgs.length - 1)];
  return msgs.find(m => !m.read) || msgs[0];
}

// ---- pinned posts (UN-RFC 0033, UN-RFC 0046 section 4.12) --------------------
// The core works out which pins are in force, with the rules every node uses; this
// shows them: a Pinned section above the threads, a bar above a chat (sections 7.2,
// 7.3), and pin and unpin for the owner and moderators only (section 7.1).
const PIN = "📌";
const pinsOf = (d) => (d && d.group && d.group.pins) || [];
// Whether you folded a group's pinned posts away here (this browser only).
function pinsHidden(gid, where) {
  try { return localStorage.getItem(`pins-hidden:${where}:${gid}`) === "1"; } catch (_) { return false; }
}
// Fold a group's pinned posts away, or show them again (this browser only).
function hidePins(gid, where, on) {
  try { if (on) localStorage.setItem(`pins-hidden:${where}:${gid}`, "1"); else localStorage.removeItem(`pins-hidden:${where}:${gid}`); }
  catch (_) { /* remembered for this page only */ }
  render();
}
// a pin's first line: the subject of a post, the text of a chat line
function pinLine(p, m) {
  if (m && m.kind === "chat") return ((m.text || "").split("\n").find(l => l.trim()) || "").slice(0, 140);
  return p.subject || (m ? subjectOf(m) : "") || "A post this client has not fetched yet";
}

// The pinned posts at the top of the threads list (UN-RFC 0033), newest pin first.
function pinnedSection(d, msgs) {
  const g = d.group, pins = pinsOf(d);
  if (!pins.length) return null;
  const hidden = pinsHidden(g.id, "threads");
  return h("section", { class: "pins", "aria-label": "Pinned posts" },
    h("button", { class: "pins-hd", "aria-expanded": hidden ? "false" : "true", onclick: () => hidePins(g.id, "threads", !hidden) },
      h("span", { "aria-hidden": "true", text: hidden ? "▸" : "▾" }), " " + PIN + " Pinned ",
      h("span", { class: "muted", text: String(pins.length) })),
    hidden ? null : pins.map(p => {
      const m = msgs.find(x => x.id === p.id);
      return h("button", { class: "pin" + (m && m.id === S.post ? " on" : ""), disabled: !m,
        title: m ? "Show the post" : "This client has not fetched the post yet",
        onclick: () => { S.post = m.id; S.mobileReading = true; render(); } },
        h("span", { class: "sj", text: PIN + " " + pinLine(p, m) }),
        h("span", { class: "from mono", text: p.who || (m && m.who) || "" }),
        p.note ? h("span", { class: "pnote", text: p.note }) : null);
    }));
}

// Scroll a chat to a line and show it briefly; say so when it is not here (section 7.3).
function jumpToLine(id) {
  setTimeout(() => {
    const el = [...document.querySelectorAll(".msgs [data-id]")].find(x => x.dataset.id === id);
    if (!el) { toast("That message is no longer here: earlier messages have expired."); return; }
    el.scrollIntoView({ block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1600);
  });
}

// The one-line bar of a chat's pinned posts (UN-RFC 0033).
function pinBar(d, msgs) {
  const g = d.group, pins = pinsOf(d);
  if (!pins.length) return null;
  if (pinsHidden(g.id, "chat")) {
    return h("div", { class: "pinbar off" }, h("button", { class: "link", onclick: () => hidePins(g.id, "chat", false) },
      `${PIN} Show the pins (${pins.length})`));
  }
  S.pinAt = S.pinAt || {};
  const i = (S.pinAt[g.id] || 0) % pins.length, p = pins[i], m = msgs.find(x => x.id === p.id);
  return h("div", { class: "pinbar", role: "region", "aria-label": "Pinned" },
    h("button", { class: "pb-main", title: pins.length > 1 ? "Go to it; then the next pin" : "Go to it",
      onclick: () => { S.pinAt[g.id] = i + 1; jumpToLine(p.id); render(); } },
      h("span", { "aria-hidden": "true", text: PIN }),
      h("span", { class: "pb-text" }, h("b", { text: (p.who || (m && m.who) || "") + " " }), pinLine(p, m),
        p.note ? h("span", { class: "muted", text: " - " + p.note }) : null),
      pins.length > 1 ? h("span", { class: "hint", text: `${i + 1}/${pins.length}` }) : null),
    pins.length > 1 || g.may_pin ? h("button", { class: "link", onclick: () => openPinList() }, "All pins") : null,
    h("button", { class: "btn icon", "aria-label": "Hide the pins", title: "Hide the pins", onclick: () => hidePins(g.id, "chat", true) }, svg(ICON.x)));
}

// Pin or unpin a post through the core, which needs a moment for the marker's proof of
// work.
async function pinRequest(g, body, done) {
  toast(body.unpin ? "Unpinning … the marker needs its proof of work first." : "Pinning … the marker needs its proof of work first.");
  await api("POST", `/api/groups/${encodeURIComponent(g.id)}/pin`, body);
  if (S.pinAt) S.pinAt[g.id] = 0;                 // the bar starts again at the newest pin
  closeDialog(); await loadGroup(); render(); toast(done);
}

// All the pinned posts of a group, to open or, for its owner and moderators, unpin.
function openPinList() {
  const d = S.data, g = d && d.group;
  if (!g) return;
  const chat = g.view === "chat";
  S.dialog = { focus: ".dialog .btn.primary", render: () => {
    const pins = pinsOf(S.data);
    return dialogShell({ label: "Pinned" },
      h("div", { class: "dh" }, h("h2", { text: PIN + " Pinned in " + g.label }), h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
      h("div", { class: "db" }, pins.length ? h("ul", { class: "pinlist" }, pins.map(p => {
        const m = S.data.messages.find(x => x.id === p.id);
        return h("li", {},
          h("button", { class: "link", disabled: !m, onclick: () => { closeDialog(); S.post = p.id; if (chat) jumpToLine(p.id); render(); } }, pinLine(p, m)),
          h("span", { class: "muted", text: " " + (p.who || (m && m.who) || "") + " · pinned by " + p.by_label + ", " + when(p.pinned) }),
          p.note ? h("div", { class: "pnote", text: p.note }) : null,
          g.may_pin ? h("button", { class: "btn", onclick: () => openUnpin(p, m) }, "Unpin") : null);
      })) : h("p", { class: "muted", text: "Nothing is pinned here." })),
      h("div", { class: "df btns" }, h("button", { class: "btn primary", onclick: closeDialog }, "Close")));
  } };
  render();
}

// Ask whether to unpin a post, and unpin it.
function openUnpin(p, m) {
  const g = S.data && S.data.group;
  if (!g || !g.may_pin) return;
  confirmDialog({ title: "Unpin “" + pinLine(p, m) + "”?", button: "Unpin", danger: !!p.beyond_window,
    text: p.beyond_window ? "It is older than this group keeps posts, so the nodes delete it as soon as it is unpinned." :
      "It stays where it is, and goes when it is older than this group keeps posts.",
    ok: async () => { try { await pinRequest(g, { id: p.id, unpin: true }, "Unpinned."); } catch (x) { toast(x.message); } } });
}

// Pin (or unpin) a post: the owner and moderators only (UN-RFC 0033 section 7.1).
function openPin(m) {
  const d = S.data, g = d && d.group;
  if (!g || !m || !g.may_pin) return;
  const pins = pinsOf(d), now = pins.find(p => p.id === m.id);
  if (now) { openUnpin(now, m); return; }
  const out = pins.length >= g.max_pins ? pins[pins.length - 1] : null;   // the oldest pin stops counting
  formDialog({ label: "Pin", title: "Pin “" + (m.kind === "chat" ? pinLine({}, m) : subjectOf(m)) + "”", focus: "#pnote", button: "Pin",
    note: "Everyone sees it at the top of " + g.label + ", and the nodes keep it until it is unpinned.",
    fields: (vals) => [
      out ? h("div", { class: "warnbox" },
        h("p", { style: "margin:0", text: `This group shows at most ${g.max_pins} pins, so “${pinLine(out, S.data.messages.find(x => x.id === out.id))}” stops counting.` }),
        h("button", { type: "button", class: "link", onclick: () => openPinList() }, "Unpin another one instead")) : null,
      h("label", { for: "pnote", text: "A note shown with it (optional)" }),
      h("input", { id: "pnote", name: "note", class: "in", "data-k": "pnote", maxlength: 256, value: vals.note || "" })],
    submit: async (v) => pinRequest(g, { id: m.id, note: (v.note || "").trim() }, "Pinned.") });
}

// A threads group: the list of threads and replies, and the reader below it.
function threadsView(d) {
  const g = d.group, msgs = d.messages;
  if (!msgs.length) {
    const pend = pendingIn(g, msgs, false);              // your first post on its way (#48)
    return h("div", { class: "content" }, pend.length ?
      h("section", { class: "ptable", "aria-label": "Posts" }, pend.map(([job, p]) => pendingRow(job, p))) :
      h("div", { class: "empty" },
        h("h2", { text: g.id === FOR_YOU ? "Nothing for you yet" : "No posts yet" }),
        h("p", { text: g.id === FOR_YOU ? "Replies to your posts, and posts that name you, show up here." :
          mayWrite(d, "post").allowed ? "Be the first: press N to write a post." : mayWrite(d, "post").reason })));
  }
  const ruled = ruledRows(msgs);                        // your own rules (UN-RFC 0051)
  const shown = (ruled.rows.length ? ruled.rows : msgs).filter(passesTag);   // a tag chosen
  if (!shown.length) return h("div", { class: "content" }, tagFilterBar(),
    h("div", { class: "empty" }, h("h2", { text: "Nothing tagged " + S.tagFilter + " here" })));
  const cur = currentPost(shown);
  S.post = cur.id;
  markRead([cur]);
  markSeen(g, shown);
  const pend = pendingIn(g, msgs, false);
  const table = h("section", { class: "ptable", "aria-label": "Posts", "data-scroll": "ptable:" + g.id },
    teamRemovedNote(g),                                 // removed from a team inbox (0047)
    tagFilterBar(),                                     // only posts with a tag (UN-RFC 0052)
    pinnedSection(d, msgs),
    h("div", { class: "prow head", "aria-hidden": "true" }, h("span", {}), h("span", { text: "Subject" }),
      h("span", { text: "From" }), h("span", { text: "Date" })),
    shown.map(m => h("button", {
      class: `prow${m === cur ? " on" : ""}${m.read ? "" : " unread"}${m.depth === 0 ? " root" : ""}${ruleClass(m)}`,
      "data-id": m.id, "aria-current": m === cur ? "true" : null,
      onclick: () => { S.post = m.id; S.mobileReading = true; render(); },
      ondblclick: () => { S.post = m.id; S.full = true; render(); } },
      h("span", { class: "flag", "aria-label": m.read ? null : "Unread", text: m.read ? "" : "●" }),
      h("span", { class: "sj" },
        warningStripe(m),                               // a warning's colour (UN-RFC 0053)
        m.depth ? h("span", { class: "tree", "aria-hidden": "true", text: "  ".repeat(m.depth - 1) + "└ " }) : null,
        m.for_me === "reply" ? h("span", { class: "you", text: "◄ " }) : m.for_me === "mention" ? h("span", { class: "you", text: "♦ " }) : null,
        m.pinned ? h("span", { class: "pinmark", title: "Pinned", text: PIN + " " }) : null,
        m.private && !m.notice ? h("span", { class: "muted", text: "@ " }) : m.encrypted && !m.notice ? h("span", { class: "muted", text: "∩ " }) : null,
        // a reply with the thread's own subject: quieter, so new subjects stand out
        // hidden by a warning you chose to hide: a quiet line, never silently (UN-RFC 0053)
        hiddenRowText(m) ? h("span", { class: "muted lhidden", text: hiddenRowText(m) }) :
          h("span", { class: m.depth && sameSubject(m, msgs) ? "same" : null, text: subjectOf(m) }),
        m.origin ? h("span", { class: "muted origin", title: originText(m), text: "  ⇲ " + networkName(m.origin.network) }) : null,
        g.id === FOR_YOU ? h("span", { class: "muted", text: "  (" + (m.notice ? m.notice.label + ", not followed" : labelOf(m.group)) + ")" }) : null,
        ruled.folded[m.id] ? h("span", { class: "folded", role: "button", tabindex: "0", title: "Show them",
          onclick: (e) => { e.stopPropagation(); S.unfolded = { ...(S.unfolded || {}), [m.id]: true }; render(); },
          text: `  ▸ ${ruled.folded[m.id]} folded` }) : null,
        m.score !== undefined ? h("span", { class: "score", title: "Your rules' score - ⋯ says why",
          text: `  ${m.score > 0 ? "+" : ""}${m.score}` }) : null),
      h("span", { class: "from mono" }, m.who, m.bot ? h("span", { class: "muted", text: " · bot" }) : null),
      h("span", { class: "date" }, timeEl(m.date, "")))),
    pend.map(([job, p]) => pendingRow(job, p)));
  return h("div", { class: "content news" + (S.full ? " full" : "") + (S.mobileReading ? " reading" : "") },
    table, readerPane(g, cur, msgs));
}

// A post on its way, shown in the list until the node has it.
function pendingRow(job, p) {
  return h("div", { class: "prow pending" + (p.state === "failed" ? " failed" : ""), "data-job": job }, h("span", {}),
    h("span", { class: "sj", text: p.body.subject || "" }),
    h("span", { class: "from mono", text: S.state.me.label }),
    h("span", { class: "date" }, p.state === "failed" ?
      h("button", { class: "link", onclick: () => retry(job), title: p.error || "" }, "Not sent - again") : pendingState(p)));
}

// Whether a reply keeps its thread's subject, so the list can show it quieter.
function sameSubject(m, msgs) {
  const bare = (s) => (s || "").replace(/^(re:\s*)+/i, "").trim().toLowerCase();
  const i = msgs.indexOf(m);
  for (let j = i - 1; j >= 0; j--) if (msgs[j].depth === 0) return bare(msgs[j].subject) === bare(m.subject);
  return false;
}

// A group's name for showing, also for groups not in the sidebar.
function labelOf(gid) {
  const g = allGroups().find(x => x.id === gid);
  return g ? g.label : gid.split("@")[0];
}

// Quoted lines ("> ...", "> > ...") as quotes, one colour per level; long ones folded.
function renderBody(text) {
  const lines = text.split("\n"), out = [];
  let i = 0;
  const level = (ln) => { const m = ln.match(/^((?:>\s?)+)/); return m ? (m[1].match(/>/g) || []).length : 0; };
  while (i < lines.length) {
    if (level(lines[i]) === 0) {
      const para = [];
      while (i < lines.length && level(lines[i]) === 0) para.push(lines[i++]);
      const t = para.join("\n");
      const wrote = /^(.{1,80}) (wrote|skrev):$/.test(para[para.length - 1] || "") && i < lines.length;
      if (wrote) {
        const before = para.slice(0, -1).join("\n");
        if (before.trim()) out.push(h("p", { class: "text", text: before }));
        out.push(h("p", { class: "attrib", text: para[para.length - 1] }));
      } else if (t.trim() || out.length) out.push(h("p", { class: "text" }, linkGroups(t)));
      continue;
    }
    const q = [];
    while (i < lines.length && level(lines[i]) > 0) q.push(lines[i++]);
    const rows = q.map(ln => h("div", { class: "ql q" + Math.min(level(ln), 3) }, ln.replace(/^((?:>\s?)+)/, "") || " "));
    out.push(q.length > 6 ?
      h("details", { class: "quote-block" }, h("summary", { text: `Quoted text (${q.length} lines)` }), rows) :
      h("div", { class: "quote-block" }, rows));
  }
  return out;
}
