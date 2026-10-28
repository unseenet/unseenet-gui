// feeds.js - feeds (UN-RFC 0034, UN-RFC 0046 section 4.14).
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- feeds (UN-RFC 0034, UN-RFC 0046 section 4.14) ---------------------------
// Entries newest first, each whole, comments under each, oldest first; the core lays
// the group out (Session.feed: every note its own entry) and says who may comment.
// The timeline is the pseudo-group timeline:, every followed feed's entries.
const FEED_SHOWN = 1;                              // the newest comment shown, and your own talks
const COMMENT_PAGE = 20;                           // "View more" shows this many more at a time
const CLIP_LINES = 6;                              // an entry's text before "… more" (10 wide)
// A feed's entries, each with its comments under it, newest first (UN-RFC 0034).
function feedEntries(d) {
  const out = [];
  for (const m of d.messages) {
    if (m.depth === 0 || !out.length) out.push({ m, comments: [] });
    else out[out.length - 1].comments.push(m);
  }
  const pinned = out.filter(e => e.m.pinned);       // pinned entries first (section 4.1)
  return pinned.concat(out.filter(e => !e.m.pinned));
}

// Keys in a feed (unseenet#490): up and down go from entry to entry, Space to the next
// unread one, R comments on the one you are on - the same keys as the terminal client.
function feedCurrent() {
  const entries = S.data && S.data.group && S.data.group.view === "feed" ? feedEntries(S.data) : [];
  return entries.find(e => e.m.id === S.post) || null;
}
// Select an entry and scroll it into view.
function feedGo(e) {
  if (!e) return;
  S.post = e.m.id; render();
  const el = document.querySelector(`.entry[data-id="${CSS.escape(e.m.id)}"]`);
  if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
}
// Move to the next or previous entry.
function feedStep(delta) {
  const entries = feedEntries(S.data);
  if (!entries.length) return;
  const i = entries.findIndex(e => e.m.id === S.post);
  feedGo(entries[i < 0 ? 0 : Math.max(0, Math.min(entries.length - 1, i + delta))]);
}
// Move to the next unread entry, or the next feed with any.
async function feedNextUnread() {
  const entries = feedEntries(S.data);
  const i = entries.findIndex(e => e.m.id === S.post);
  const unread = e => !e.m.read || e.comments.some(c => !c.read);
  const next = entries.slice(i + 1).find(unread) || entries.slice(0, Math.max(0, i)).find(unread);
  if (next) { feedGo(next); return; }
  S.post = null; await nextUnread();
}
// Put the cursor in the comment field of the selected entry.
function feedComment() {
  const e = feedCurrent();
  const el = e && document.querySelector(`[data-k="c:${CSS.escape(e.m.id)}"]`);
  if (el) { el.focus(); el.scrollIntoView({ block: "nearest" }); }
  else if (e) toast((e.m.comment && e.m.comment.reason) || "Comments are closed here.");
}

// Keys on a site: up and down go through its pages, left and right back and forward.
function pageStep(delta) {
  const site = S.data && S.data.site;
  if (!site || !site.pages || !site.pages.length) return;
  const i = site.pages.findIndex(p => p.path === site.path);
  const next = site.pages[Math.max(0, Math.min(site.pages.length - 1, (i < 0 ? 0 : i) + delta))];
  if (next && next.path !== site.path) openPage(S.data.group.id, next.path);
}

// A feed or the timeline: entries with their pictures, the start of long ones, and their
// comments.
function feedView(d) {
  const g = d.group, timeline = isMixed(g), entries = feedEntries(d);
  S.feedOpen = S.feedOpen || {};
  requestAnimationFrame(clipEntries);              // "… more" only where text is really hidden
  const shownMsgs = entries.flatMap(e => [e.m, ...visibleComments(e)]);
  markRead(shownMsgs);
  const note = !timeline && mayWrite(d, "chat").allowed && (g.kinds || ["chat"]).includes("chat");
  const send = () => {
    const input = document.querySelector('[data-k="note"]');
    const text = input.value.trim();
    if (!text) return;
    input.value = ""; S.drafts["note:" + g.id] = "";
    doPost(g.id, { body: text, chat: true }, { text, chat: true, thread: "new:" + g.id });
  };
  const pendNew = Object.entries(S.pending).filter(([, p]) => p.thread === "new:" + g.id);
  return h("div", { class: "content" }, h("section", { class: "feed", "aria-label": timeline ? "Timeline" : "Feed",
    "data-scroll": "feed:" + g.id },
    String(g.id).startsWith(TAGGED) ? h("p", { class: "hint feed-note", text: `Everything tagged ${g.tag} in your groups and feeds, newest first - the authors' tags, the groups', and topics of labellers you follow for topics.` }) :
    timeline ? h("p", { class: "hint feed-note", text: `The newest entries of the ${g.feeds || 0} group${g.feeds === 1 ? "" : "s"} in your timeline, ${d.messages.some(x => x.score !== undefined) ? "in the order your rules give (⋯ on an entry says why)" : "in the order they were written"}. Nobody is told whom you follow.` }) : null,
    note ? h("form", { class: "chatbar notebar", onsubmit: (e) => { e.preventDefault(); send(); } },
      h("div", { class: "row" },
        h("label", { for: "note", class: "sr", text: "A note in " + g.label }),
        h("input", { id: "note", type: "text", "data-k": "note", autocomplete: "off", placeholder: "Write a note in " + g.label,
          value: S.drafts["note:" + g.id] || "", oninput: (e) => { S.drafts["note:" + g.id] = e.target.value; } }),
        emojiButton("note"),
        h("button", { class: "send", type: "submit", "aria-label": "Post the note" }, svg(ICON.send, 18, 2.5))),
      h("div", { class: "hint" }, "A short note; New post gives one a headline.")) : null,
    pendNew.map(([job, p]) => h("article", { class: "entry pending", "data-job": job },
      h("div", { class: "etext", text: p.text }), p.state === "failed" ?
        h("div", { class: "state bad" }, "Not sent: " + (p.error || ""), " ", h("button", { class: "link", onclick: () => retry(job) }, "Try again")) :
        pendingState(p))),
    tagFilterBar(),                                     // shown: only posts with a tag
    showAllBar(d),                                      // your rules paused here (0051 3)
    entries.length ? [entries.filter(e => passesTag(e.m)).map(e => entryCard(d, e)), olderButton(d)] :
      h("div", { class: "empty" }, h("h2", { text: timeline ? "Nothing yet" : "No entries yet" }),
        h("p", { text: timeline ? "Follow someone or a feed (Ctrl P), or add a group with ☰ in its header, and the entries come here." :
          note ? "Write the first note above." : "" }))));
}

// what shows under an entry: all when opened; else the newest few, and always your own
// (section 4.4 - never chosen by how many answers or reactions)
// Many comments are folded to the newest few - and every conversation you are in: the
// comments that are yours, answer you or name you, with what they answer and the answers
// under them, so you can follow your own threads without opening them all.
function visibleComments(e) {
  const how = (S.commentsHow || {})[e.m.id] || "newest";
  const ids = new Set(e.comments.map(c => c.id));
  const near = (keep) => {                       // a comment, what it answers and answers to it
    const out = new Set();
    keep.forEach(c => {
      out.add(c.id);
      (c.references || []).forEach(r => { if (ids.has(r)) out.add(r); });
      e.comments.forEach(o => { if ((o.references || []).includes(c.id)) out.add(o.id); });
    });
    return out;
  };
  if (how === "yours") return e.comments.filter(c => near(e.comments.filter(x => x.mine)).has(c.id));
  if (how === "mentions") return e.comments.filter(c => near(e.comments.filter(x => x.for_me)).has(c.id));
  const open = (S.feedOpen && S.feedOpen[e.m.id]) || 0;            // how many more you opened
  const shown = new Set(e.comments.slice(-(FEED_SHOWN + open)).map(c => c.id));
  near(e.comments.filter(c => c.mine || c.for_me)).forEach(id => shown.add(id));   // your own talks
  return e.comments.filter(c => shown.has(c.id));
}

// One entry of a feed: who, when, the text, pictures, reactions and its comments.
function entryCard(d, e) {
  const m = e.m, g = d.group, timeline = isMixed(g);
  const shown = visibleComments(e), hidden = e.comments.length - shown.length;
  const byId = Object.fromEntries(e.comments.map(c => [c.id, c]));
  const cp = m.comment || { allowed: false, reason: NOT_HERE };
  const target = (S.answering && S.answering[m.id] && byId[S.answering[m.id]]) || null;
  const send = () => {
    const input = document.querySelector(`[data-k="c:${m.id}"]`);
    const text = input.value.trim();
    if (!text) return;
    input.value = ""; S.drafts["c:" + m.id] = "";
    const to = target || m;
    if (S.answering) delete S.answering[m.id];
    doPost(m.group, { body: text, chat: true, references: [...to.references, to.id] }, { text, chat: true, thread: m.id });
  };
  const pend = Object.entries(S.pending).filter(([, p]) => p.thread === m.id);
  const own = groupOf(m.group) || g;
  return h("article", { class: "entry" + (m.pinned ? " pinned" : "") + (m.read ? "" : " unread") + (S.post === m.id ? " on" : ""), "data-id": m.id },
    warningFlags(m),                                    // warnings at the top left (UN-RFC 0053)
    h("div", { class: "ehd" }, avatar(m), h("div", { class: "who" }, whoEl(m),
      m.bot ? h("span", { class: "sm", text: "bot" }) : null,
      timeEl(m.date), languageMark(m),
      m.origin ? h("span", { class: "hint origin", title: "Posted " + exactTime(m.date) + " - the date it was first published is the poster's claim",
        text: originText(m) }) : null,
      timeline ? h("button", { class: "link efeed", onclick: () => openGroup(m.group) }, "in " + (m.group_label || labelOf(m.group))) : null,
      m.pinned ? h("span", { class: "pinmark", "aria-label": "Pinned", text: PIN }) : null),
      moreMenu(m)),
    m.kind !== "chat" ? h("h3", { class: "etitle", text: subjectOf(m) }) : null,
    entryBody(m),
    reactionBar(m),
    // Comment (with the count) and Reply with a post as icons with tooltips; Pin and Copy
    // address are in the ⋯ menu (#120); topics as quiet chips at the end (UN-RFC 0052)
    h("div", { class: "eact" }, h("span", { class: "eact-tags" }, tagChips(m, { groupTags: timeline })),
      cp.allowed ? iconAction(ICON.bubble, "Comment", () => focusLater(`[data-k="c:${m.id}"]`), {}, e.comments.length || null) :
        e.comments.length ? h("span", { class: "hint ccount", "aria-label": `${e.comments.length} comments` },
          svg(ICON.bubble, 16, 2), String(e.comments.length)) : null,
      m.replyPerm && m.replyPerm.allowed && (own.kinds || ["post"]).includes("post") ?
        iconAction(ICON.mail, "Reply with a post", () => openReply(m, own)) : null),
    h("div", { class: "comments" },
      commentsHead(e, hidden),
      shown.map(c => commentEl(c, m, byId)),
      pend.map(([job, p]) => h("div", { class: "comment mine pending", "data-job": job },
        h("div", { class: "ctext", text: p.text }), p.state === "failed" ?
          h("div", { class: "state bad" }, "Not sent: " + (p.error || ""), " ", h("button", { class: "link", onclick: () => retry(job) }, "Try again")) :
          pendingState(p))),
      cp.allowed ? h("form", { class: "cbar", onsubmit: (ev) => { ev.preventDefault(); send(); } },
        target ? h("div", { class: "hint answering" }, "Answering " + target.who + " ",
          h("button", { class: "link", type: "button", "aria-label": "Answer the entry instead", onclick: () => { delete S.answering[m.id]; render(); } }, "×")) : null,
        h("label", { for: "c-" + m.id, class: "sr", text: "Comment" }),
        h("textarea", { id: "c-" + m.id, rows: 1, class: "grow-in", "data-k": "c:" + m.id, autocomplete: "off", spellcheck: "true",
          placeholder: target ? "Your answer" : "Write a comment", value: S.drafts["c:" + m.id] || "",
          title: "Enter sends · Shift+Enter new line",
          oninput: (ev) => { S.drafts["c:" + m.id] = ev.target.value; growField(ev.target); },
          onkeydown: (ev) => sendOnEnter(ev, send) }),
        timeline ? null : languageChip(m.group),            // what you write in here (0052 5a)
        h("button", { class: "send", type: "submit", "aria-label": "Send the comment" }, svg(ICON.send, 16, 2.5))) :
      cp.reason ? h("p", { class: "hint", text: cp.code === "comments_closed" ? "Comments are closed." : cp.reason }) : null));
}

// An entry's text, cut after a few lines with "… more" when it is long - opened in place,
// "Show less" at its end - and its pictures under it, never cut, so a picture post shows
// its picture (unseenet-gui#143). Whether it is long is measured after drawing (clipEntries).
function entryBody(m) {
  if (m.reported) return h("div", { class: "ebody" }, reportedNote(m));   // UN-RFC 0045
  if (labelCovered(m)) return h("div", { class: "ebody" }, labelVeil(m));   // UN-RFC 0053
  if (m.kind === "chat" && m.readable)
    return h("div", { class: "ebody" }, m.markdown ? renderChatLine(m) : linkGroups(m.text), filesOf(m, false));
  const open = S.textOpen && S.textOpen[m.id];
  // the author's read-more line (UN-RFC 0031 3.2.1): cut there, up to twice the normal cut
  const more = !open && hasReadMore(m) && !(S.moreTooLong || {})[m.id];
  const [text, files] = messageBody(more ? beforeReadMore(m) : m);
  return h("div", { class: "ebody" + (more ? " cut" : "") },
    h("div", { class: "etext" + (open ? " open" : more ? " more-cut" : " clip"), "data-clip": m.id }, text),
    open ? h("button", { class: "link less", onclick: () => { delete S.textOpen[m.id]; render(); } }, "Show less") :
      h("button", { class: "link emore", onclick: () => { S.textOpen = { ...(S.textOpen || {}), [m.id]: true }; render(); } }, "… more"),
    files);
}

// After a feed is drawn: an entry's text that is cut by only a line or two is shown whole,
// and "… more" is shown only where something is really hidden.
function clipEntries() {
  // a read-more line further down than twice the normal cut is ignored (UN-RFC 0031 3.2.1)
  let again = false;
  document.querySelectorAll(".etext.more-cut").forEach(el => {
    const line = parseFloat(getComputedStyle(el).lineHeight) || 22;
    const lines = matchMedia("(min-width: 1100px)").matches ? 10 : CLIP_LINES;   // as app.css
    if (el.scrollHeight > line * lines * 2 + line / 2) {
      S.moreTooLong = { ...(S.moreTooLong || {}), [el.dataset.clip]: true };
      again = true;
    }
  });
  if (again) { render(); return; }
  document.querySelectorAll(".etext.clip").forEach(el => {
    const line = parseFloat(getComputedStyle(el).lineHeight) || 22;
    const hidden = el.scrollHeight - el.clientHeight;
    const long = hidden > line * 2;
    el.classList.toggle("fits", !long);
    el.parentElement.classList.toggle("cut", long);
  });
}

// Over an entry's comments: how many are not shown and "View N more" (COMMENT_PAGE at a
// time), the choice of which to show when there are many - newest, where you wrote, what
// names you - and "Show fewer". What is shown is never chosen by how many answer or react
// (UN-RFC 0034 section 4.4).
function commentsHead(e, hidden) {
  const id = e.m.id, how = (S.commentsHow || {})[id] || "newest";
  const set = (v) => { S.commentsHow = { ...(S.commentsHow || {}), [id]: v }; render(); };
  const choice = e.comments.length > 3 ? h("div", { class: "cwhich", role: "group", "aria-label": "Which comments" },
    [["newest", "Newest"], ["yours", "Where you wrote"], ["mentions", "Mentions you"]]
      .filter(([v]) => v === "newest" || (v === "yours" ? e.comments.some(c => c.mine) : e.comments.some(c => c.for_me)))
      .map(([v, label]) => h("button", { class: "chip" + (how === v ? " on" : ""), "aria-pressed": String(how === v),
        type: "button", onclick: () => set(v) }, label))) : null;
  const more = how === "newest" && hidden > 0 ? h("button", { class: "link more", onclick: () => {
    S.feedOpen[id] = ((S.feedOpen[id]) || 0) + COMMENT_PAGE; render(); } },
    `View ${Math.min(hidden, COMMENT_PAGE) === hidden ? hidden : COMMENT_PAGE + " of " + hidden} more comment${hidden === 1 ? "" : "s"}`) : null;
  const fewer = how === "newest" && S.feedOpen[id] ? h("button", { class: "link more", onclick: () => {
    delete S.feedOpen[id]; render(); } }, "Show fewer") : null;
  return choice || more || fewer ? h("div", { class: "chead" }, choice, more, fewer) : null;
}

// two levels (section 4.2; the core caps the depth at 2): a deeper answer sits at the
// second level and says whom it answers
function commentEl(c, entry, byId) {
  const parent = c.references.length ? byId[c.references[c.references.length - 1]] : null;
  return h("div", { class: "comment" + (c.depth > 1 ? " answer" : "") + (c.mine ? " mine" : ""), "data-id": c.id },
    avatar(c, true),
    h("div", { class: "cb" },
      h("div", { class: "chd" }, whoEl(c), timeEl(c.date),
        parent && parent.depth > 1 ? h("span", { class: "hint", text: "in answer to " + parent.who }) : null,
        moreMenu(c)),
      h("div", { class: "ctext" }, c.reported ? reportedNote(c) : labelCovered(c) ? labelVeil(c) : c.readable ? (c.kind === "chat" ? (c.markdown ? renderChatLine(c) : linkGroups(c.text)) :
        [h("strong", { text: subjectOf(c) }), messageBody(c)]) : h("i", { text: c.error || "Could not be read." })),
      // the reactions given stay; adding one and Answer show on hover or focus (#120)
      h("div", { class: "crow" }, reactionBar(c),
        entry.comment && entry.comment.allowed ? iconAction(ICON.bubble, "Answer", () => {
          S.answering = S.answering || {}; S.answering[entry.id] = c.id; render(); focusLater(`[data-k="c:${entry.id}"]`); },
          { cls: "cans" }) : null)));
}
