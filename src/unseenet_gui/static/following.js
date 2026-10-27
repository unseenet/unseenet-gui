// following.js - following people and feeds (UN-RFC 0034 section 6, UN-RFC 0046 4.14).
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- following (UN-RFC 0034 section 6, UN-RFC 0046 section 4.14) ----------------
// Kept in your vault and sent nowhere: following someone does not tell them.
async function setFollowing(body, who) {
  let r;
  try { r = await api("POST", "/api/following", body); } catch (x) { toast(x.message); return null; }
  if (body.refresh) toast(r.new && r.new.length ? `Following ${r.new.length} new feed${r.new.length === 1 ? "" : "s"}.` : "Nothing new.");
  else if (body.person && body.on !== false) toast(`Following ${who || r.name || "them"}` +
    (r.feeds && r.feeds.length ? `: ${r.feeds.map(labelOf).join(", ")}.` : " - their feeds come into your timeline when they start one."));
  else if (body.person) toast(`No longer following ${who || "them"}.`);
  else toast(body.on === false ? "No longer following the feed." : "Following the feed.");
  await loadSidebar();
  return r;
}

// Follow someone: a key, a fingerprint or an address, or the author of the selected post
// (UN-RFC 0034 6).
function openFollow() {
  const m = selectedPost();
  formDialog({ label: "Follow", title: "Follow someone", focus: "#ftarget", button: "Follow",
    values: { target: m && m.key && !m.mine && !m.private ? m.key : "" },
    note: "Their key, their name (such as andreas@lorensen) or their unseenet: address. This follows their personal feed and the feeds their profile lists. Nobody is told, and the list stays in your vault.",
    fields: (vals) => [h("input", { id: "ftarget", name: "target", class: "in mono", value: vals.target || "", "data-k": "ftarget",
      placeholder: "ed25519:… or name@hierarchy", autocomplete: "off", spellcheck: "false" })],
    submit: async (v) => {
      if (!(v.target || "").trim()) throw new Error("Whom? Their key, name or address.");
      await api("POST", "/api/following", { person: v.target.trim() }).then(async (r) => {
        closeDialog();
        toast(`Following ${r.name || "them"}` + (r.feeds.length ? `: ${r.feeds.map(labelOf).join(", ")}.` : " - no feeds yet."));
        await loadSidebar(); render();
      });
    } });
}

// The people and feeds you follow, to open, stop following, or see their profile.
async function openFollowing() {
  let f;
  try { f = await api("GET", "/api/following"); } catch (x) { toast(x.message); return; }
  const own = f.feeds.filter(x => !f.people.some(p => p.feeds.some(y => y.id === x.id)));
  const draw = () => dialogShell({ label: "Whom you follow", wide: true },
    h("div", { class: "dh" }, h("h2", { text: "Whom you follow" }),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db list" },
      h("p", { class: "hint", style: "margin:0 0 8px", text: "Only you know: the list stays in your vault and is never sent to anyone." }),
      f.people.length ? h("h3", { class: "row-h", text: "People" }) : null,
      f.people.map(p => h("div", { class: "cmd" },
        h("span", { class: "nm" }, h("span", { text: p.label }), " ",
          h("small", { class: "mono", text: p.feeds.length ? p.feeds.map(x => x.label).join(", ") : "no feeds yet" })),
        h("button", { class: "btn", onclick: async () => { await setFollowing({ person: p.fingerprint, on: false }, p.label); openFollowing(); } }, "Unfollow"))),
      own.length ? h("h3", { class: "row-h", text: "Feeds" }) : null,
      own.map(x => h("div", { class: "cmd" },
        h("button", { class: "nm link", onclick: () => { closeDialog(); openGroup(x.id); } }, x.label + (x.title ? " - " + x.title : "")),
        h("button", { class: "btn", onclick: async () => { await setFollowing({ feed: x.id, on: false }); openFollowing(); } }, "Unfollow"))),
      !f.people.length && !own.length ? h("p", { class: "muted", text: "You follow nobody yet." }) : null),
    h("div", { class: "df btns" },
      h("button", { class: "btn", title: "Read their profiles again and follow their new feeds",
        onclick: async () => { await setFollowing({ refresh: true }); openFollowing(); } }, "Look for new feeds"),
      h("button", { class: "btn", onclick: () => openFollow() }, "Follow someone"),
      h("button", { class: "btn primary", onclick: closeDialog }, "Close")));
  S.dialog = { focus: ".dialog .btn.primary", render: draw };
  render();
}

// Your own feed (UN-RFC 0034 section 5): only when you ask, after the warning
// (UN-RFC 0029 section 2.1), with whether readers may comment.
async function openMyFeed() {
  let f;
  try { f = await api("GET", "/api/feed"); } catch (x) { toast(x.message); return; }
  if (f.started && f.followed) { S.full = false; openGroup(f.id); return; }
  const st = { comments: "open", busy: false, err: "" };
  const draw = () => dialogShell({ label: "Start your feed" },
    h("div", { class: "dh" }, h("h2", { text: "Start your feed?" }),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db" },
      h("div", { class: "warnbox" }, f.warning.split("\n\n").map(t => h("p", { text: t }))),
      h("p", { style: "margin:0", text: "May readers comment on what you post?" }),
      ["open", "none"].map(c => h("label", { class: "radio" },
        h("input", { type: "radio", name: "comments", value: c, checked: st.comments === c, onchange: () => { st.comments = c; } }),
        c === "open" ? " Yes, anybody may comment" : " No comments")),
      st.err ? h("p", { class: "error", text: st.err }) : null),
    h("div", { class: "df btns" }, h("span", { class: "mono muted", text: f.id }),
      h("button", { class: "btn", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn primary", disabled: st.busy, onclick: async () => {
        st.busy = true; st.err = ""; render();
        try { await api("POST", "/api/feed", { comments: st.comments }); }
        catch (x) { st.busy = false; st.err = x.message; render(); return; }
        closeDialog(); toast("Your feed is started: what you post there is public.");
        await loadSidebar(); S.full = false; openGroup(f.id); } }, st.busy ? "Starting …" : "Start your feed")));
  S.dialog = { focus: ".dialog .btn", render: draw };
  render();
}

// An unseenet: address (UN-RFC 0031 section 3.4.1, the older forms too): the core says
// what it names (UN-RFC 0046 section 4.13). A group you follow opens, at the post or the
// page it names; one you do not is shown first and you choose to follow it - never without
// asking. Its n= hints are only said: this client reads from your own nodes.
async function openAddress(text) {
  let a;
  try { a = await api("GET", "/api/address?a=" + encodeURIComponent(String(text || "").trim())); }
  catch (x) { toast(x.message); return; }
  if (a.kind === "identity") {
    if (a.key) { openProfile(a.key, a.label || ""); return; }
    toast(`Someone this client has not met yet: fingerprint ${a.fingerprint}.`);
    return;
  }
  if (!a.available) {
    toast("Your nodes do not have that group" + (a.nodes && a.nodes.length ?
      `. The address says it is on ${a.nodes.join(", ")}: add that node to read it.` : "."));
    return;
  }
  const go = async () => {
    S.full = false;
    await openGroup(a.group_id);
    if (a.kind === "post") {
      const here = S.data && S.data.messages.find(x => x.id === (a.message && a.message.id));
      if (!here) { toast("That post is not here - it may have been withdrawn or have expired."); return; }
      if (S.data.group.view === "chat") jumpToLine(here.id);
      else { S.post = here.id; render(); }
    } else if (a.kind === "page") {
      if (!a.page) toast("That page is not on the site - here is its home page.");
      else openPage(a.group_id, a.page.path);
    }
  };
  if (a.followed) { go(); return; }
  const g = a.group, what = a.kind === "post" ? (a.message ? ` - the post "${a.message.subject || "(no subject)"}"` : "") :
    a.kind === "page" && a.page ? ` - the page "${a.page.title}"` : "";
  S.dialog = { focus: "[data-k='follow-address']", render: () => dialogShell({ label: "Address" },
    h("div", { class: "dh" }, h("h2", {}, `Follow ${g.label}?`),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db" },
      g.title ? h("p", { style: "margin:0", text: g.title + what }) : what ? h("p", { style: "margin:0", text: what.slice(3) }) : null,
      g.type === "closed" ? h("p", { class: "muted", style: "margin:0", text: "Closed: you can read it only if its owner invites you." }) : null,
      h("p", { class: "hint", style: "margin:0", text: "The address took you here; you are not following it yet." })),
    h("div", { class: "df btns" }, h("span", { class: "mono muted", text: g.id }),
      h("button", { class: "btn", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn primary", "data-k": "follow-address", onclick: async () => {
        try { await api("POST", "/api/subscribe", { id: g.id, on: true }); }
        catch (x) { toast(x.message); return; }
        closeDialog(); await loadSidebar(); go(); } }, "Follow"))) };
  render();
}

// Open an address: a group, post, page or person, unseenet: or its web form (UN-RFC 0031
// 3.4.1).
function openAddressDialog() {
  formDialog({ label: "Address", title: "Open an address", focus: "#addr", button: "Open",
    note: "An address of a group, a post, a page or a person - unseenet:…, or its web form https://…/a/… or web+unseenet:…",
    fields: (vals) => [h("input", { id: "addr", name: "a", class: "in mono", value: vals.a || "", "data-k": "addr",
      placeholder: "unseenet:… or https://…/a/…", autocomplete: "off", spellcheck: "false" })],
    submit: async (v) => {
      if (!(v.a || "").trim()) throw new Error("Paste an address: unseenet:… or https://…/a/….");
      closeDialog(); await openAddress(v.a);
    } });
}

// A mention notice (UN-RFC 0032): the post, or its group first (asking before following)
async function openMentioned(m) {
  const n = m.notice;
  if (!n) return;
  markRead([m]);
  if (!n.followed) { goToGroup(n.ref); return; }
  S.full = false;
  await openGroup(n.group);
  if (S.data && S.data.messages.some(x => x.id === n.id)) { S.post = n.id; render(); }
  else toast("The post is not there any more - perhaps it was withdrawn.");
}

// # on a post: its group, or a choice when it names several
function groupsInPost(m) {
  const refs = (m && m.groups) || [];
  if (!refs.length) { toast("This post names no group. Write e.g. #dk.snak to name one."); return; }
  if (refs.length === 1) { goToGroup(refs[0]); return; }
  S.dialog = { focus: "[data-k='ref:0']", render: () => dialogShell({ label: "Groups in this post" },
    h("div", { class: "dh" }, h("h2", {}, "Groups in this post"),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db list" }, refs.map((r, i) => h("button", { class: "cmd", "data-k": "ref:" + i,
      onclick: () => { closeDialog(); goToGroup(r); } }, h("span", { class: "nm mono", text: r }))))) };
  render();
}

// The text of the core's inline Markdown nodes, for copying and previews.
function inlineText(nodes) {
  return (nodes || []).map(n => n.v !== undefined ? n.v : n.c ? inlineText(n.c) : n.t === "br" ? "\n" : "").join("");
}
// The text of a block tree, quotes included, one block a line.
function inlineTextDeep(blocks) {
  return blocks.map(b => b.c && b.t !== "quote" ? inlineText(b.c) : b.c ? inlineTextDeep(b.c) : b.v || "").join("\n");
}

// A link opens only on a click; leaving Tor is said first (section 3.4).
function openLink(href) {
  let url;
  try { url = new URL(href); } catch (_) { return; }
  if (url.protocol === "unseenet:") { openAddress(href); return; }
  if (url.protocol === "news:") { copy(href, "The link is copied."); return; }
  if (!url.hostname.endsWith(".onion") &&
      !window.confirm(`Open ${href}?\n\nThis is on the ordinary web, not a .onion address. Unless this browser is Tor Browser, the site sees your real address.`)) return;
  window.open(href, "_blank", "noopener,noreferrer");
}

// The ⋯ menu at a post's head in a threaded group: what is about this post, its thread and
// its author, grouped - the tools that used to fill the bar under it (the bar keeps Reply
// and moving). The keys still do the same (D withdraw, M private post ...), and the
// palette has them all.
function postMenu(m, g) {
  if (!m || !m.readable) return null;
  const other = !m.mine && m.key;
  const groups = [
    ["This post", [
      m.may_edit && m.kind !== "chat" ? ["Edit", () => openEdit(m, g)] : null,
      m.may_withdraw ? ["Withdraw (delete)", () => openWithdraw(m)] : null,
      g.may_pin ? [m.pinned ? "Unpin" : "Pin", () => openPin(m)] : null,
      m.address && !m.private ? ["Copy address", () => copy(m.address, "The post's address is copied.")] : null,
      m.address && !m.private ? ["Copy web address", () => copyWeb(m.address, "post")] : null,
      m.why ? ["Why is this here?", () => openWhy(m)] : null,
      ...reportItems(m),                        // spam reports: show anyway, publish one
      !m.mine && !m.private && g.id !== FOR_YOU ? ["Report", () => openReport(m)] : null]],
    ["This thread", ruleItems(m).filter(i => i && i[0] !== "Why is this here?")],
    ["The author", [
      other && !(m.private && m.kind === "chat") ? ["Chat", () => openGroup("contact:" + m.key)] : null,
      other && !g.private_reply ? ["Write a private post", () => openPost(m.key, m.who.replace(/ √$/, ""))] : null,
      other && !m.contact ? ["Add contact", () => openAddContact(m.key, m.who.replace(/~.*$/, "").replace(/^@/, ""))] : null,
      other ? ["Profile", () => openProfile(m.key, m.who, m.private ? "me" : S.gid)] : null,
      g.owner && other && !m.private ? ["Ban from this group", () => openBanned(m.key)] : null,
      g.maintainer && other && !m.private ? ["Block in your hierarchy", () => openBlock(m)] : null,
      other ? ["Ignore this person", () => ignorePerson(m.key, m.who)] : null]],
  ].map(([title, items]) => [title, items.filter(Boolean)]).filter(([, items]) => items.length);
  if (!groups.length) return null;
  const open = S.menuFor === "post:" + m.id;
  if (open) requestAnimationFrame(() => placePostMenu());
  return h("div", { class: "more post-more" + (open ? " open" : "") },
    h("button", { class: "morebtn", type: "button", "aria-label": "More", title: "More for this post", "aria-haspopup": "menu",
      "aria-expanded": String(open), onclick: (e) => { e.stopPropagation(); S.menuFor = open ? null : "post:" + m.id; render(); } }, "⋯"),
    open ? h("div", { class: "menu", role: "menu" }, groups.map(([title, items]) => [
      h("div", { class: "msect", role: "presentation", text: title }),
      items.map(([label, run]) => h("button", { class: "mi", type: "button", role: "menuitem",
        onclick: (e) => { e.stopPropagation(); S.menuFor = null; render(); run(); } }, label))])) : null);
}

// Put an open post menu where the window has room for it - under its button, or above it
// when the button is low - outside the reader's scrolling, which would cut it off; long,
// it scrolls itself.
function placePostMenu(sel = ".post-more.open") {
  const btn = document.querySelector(sel + " .morebtn");
  const menu = document.querySelector(sel + " .menu");
  if (!btn || !menu) return;
  const r = btn.getBoundingClientRect(), gap = 6, edge = 12;
  const below = window.innerHeight - r.bottom - gap - edge, above = r.top - gap - edge;
  const need = menu.scrollHeight;                     // its own height, all items shown
  const up = need > below && above > below;           // above when it fits better there
  menu.style.position = "fixed";
  menu.style.right = Math.max(edge, window.innerWidth - r.right) + "px";
  menu.style.left = "auto";
  menu.style.maxHeight = Math.max(160, up ? above : below) + "px";
  menu.style.overflowY = "auto";
  if (up) { menu.style.bottom = (window.innerHeight - r.top + gap) + "px"; menu.style.top = "auto"; }
  else { menu.style.top = (r.bottom + gap) + "px"; menu.style.bottom = "auto"; }
}

// The reader below the threads list: the selected post with who, when, files, reactions and
// what you may do.
function readerPane(g, m, msgs) {
  const marks = [];
  if (m.mine) marks.push(h("span", { class: "sm", text: "you" }));
  if (m.bot) marks.push(h("span", { class: "sm", title: "Its profile says it posts automatically (UN-RFC 0030)", text: "bot" }));
  else if (m.contact) marks.push(h("span", { class: "sm", text: "contact" }));
  if (m.origin) {                                     // UN-RFC 0049 5.1: the claim, and when posted
    marks.push(h("span", { class: "sm origin", text: originText(m) }));
    marks.push(h("span", { class: "sm" }, "posted ", timeEl(m.date, "")));
  } else marks.push(timeEl(m.date, "sm"));
  if (m.for_me === "reply") marks.push(h("span", { class: "sm you", text: "◄ reply to you" }));
  if (m.for_me === "mention") marks.push(h("span", { class: "sm you", text: "♦ names you" }));
  if (m.encrypted) marks.push(h("span", { class: "sm lock" }, svg(ICON.lock, 12, 2.5), " encrypted"));
  else if (m.private && m.verified) marks.push(h("span", { class: "sm ok" }, svg(ICON.check, 13, 2.5), " verified sender"));
  else if (!m.private) marks.push(h("span", { class: "sm ok" }, svg(ICON.check, 13, 2.5), " signed"));
  if (m.team) marks.push(h("span", { class: "sm" + (m.team.verified ? " ok" : " bad"),
    title: "Written by one of the inbox's readers; who is not said (UN-RFC 0047)",
    text: m.team.verified ? "on the inbox's behalf" : "claims to write for an inbox - not verified" }));
  const parent = m.references.length ? msgs.find(x => x.id === m.references[m.references.length - 1]) : null;
  const rp = mayReply(S.data, m), canReply = rp.code !== "none";
  const pos = msgs.indexOf(m);
  return h("article", { class: "reader", "aria-label": "Post" },
    S.full ? h("div", { class: "fullbar" },
      h("span", { class: "mono", text: g.label }), h("span", { class: "grow" }),
      h("span", { class: "hint", text: "N next · P previous · Space page, then next unread · R reply · Esc back" })) : null,
    h("div", { class: "scroll", "data-scroll": "post:" + m.id },
      h("h2", { text: subjectOf(m) }),
      h("div", { class: "post" }, avatar(m),
        h("div", { class: "pb" }, h("div", { class: "ph" }, whoEl(m), marks, postMenu(m, g)),
          parent ? h("button", { class: "inreply", onclick: () => { S.post = parent.id; render(); } },
            "In reply to ", h("span", { class: "mono", text: parent.who })) : null)),
      h("div", { class: "pbody" },
        messageBody(m),
        m.signature ? h("p", { class: "sig", text: "-- \n" + m.signature }) : null,
        reactionBar(m))),
    h("div", { class: "pbar" },
      canReply ? h("button", offProps(rp, { class: "btn primary", onclick: () => openReply(m, g) }),
        commenting(S.data) && !g.private_reply ? "Comment" : "Reply", h("kbd", { text: "R" })) : null,
      teamInviteButton(m),
      g.id === FOR_YOU && m.notice ? h("button", { class: "btn primary", onclick: () => openMentioned(m) },
        m.notice.followed ? "Open the post" : "Go to " + m.notice.label) :
      g.id === FOR_YOU ? h("button", { class: "btn", onclick: async () => {
        await openGroup(m.group); S.post = m.id; render(); } }, "Open in " + labelOf(m.group)) : null,
      h("span", { class: "grow" }),
      h("span", { class: "hint", text: `${pos + 1} of ${msgs.length}` }),
      h("button", { class: "btn icon", "aria-label": "Previous post", title: "Previous (↑)", onclick: () => step(-1) }, "↑"),
      h("button", { class: "btn icon", "aria-label": "Next post", title: "Next (↓)", onclick: () => step(1) }, "↓"),
      h("button", { class: "btn", title: "Space", onclick: nextUnread }, "Next unread", h("kbd", { text: "Space" })),
      h("button", { class: "btn full-btn", title: S.full ? "Back to the list (Esc)" : "Read full screen (F or Enter)",
        onclick: () => { S.full = !S.full; render(); } }, S.full ? "Back" : "Full screen", h("kbd", { text: S.full ? "Esc" : "F" }))));
}

// Move the selection up or down the threads list.
function step(delta) {
  const msgs = S.data && S.data.messages;
  if (!msgs || !msgs.length) return;
  const i = msgs.findIndex(m => m.id === S.post);
  const next = msgs[Math.max(0, Math.min(msgs.length - 1, i + delta))];
  S.post = next.id; render();
  const row = document.querySelector(`.prow[data-id="${CSS.escape(next.id)}"]`);
  if (row) row.scrollIntoView({ block: "nearest" });
}

// Jump to the next unread post, in this group or the next one with unread posts.
async function nextUnread() {
  const msgs = (S.data && S.data.messages) || [];
  const i = msgs.findIndex(m => m.id === S.post);
  const next = msgs.slice(i + 1).find(m => !m.read) || msgs.slice(0, Math.max(0, i)).find(m => !m.read);
  if (next) { S.post = next.id; render(); return; }
  // nothing more here: the next group with something unread, as a newsreader does
  const groups = allGroups(), at = groups.findIndex(x => x.id === S.gid);
  const other = groups.slice(at + 1).concat(groups.slice(0, Math.max(0, at))).find(x => x.unread && x.view !== "chat");
  if (other) { await openGroup(other.id); toast("Next unread: " + other.label); }
  else toast("Nothing unread.");
}

// Your signature as it will be signed, for the compose window's preview.
async function signatureText() {
  try { const s = await api("GET", "/api/settings"); return s.signature_preview || ""; } catch (_) { return ""; }
}

// A post's title in the list; a chat line among posts shows its first line (UN-RFC 0028).
function subjectOf(m) {
  if (m.reported) return "⊘ " + reportedText(m);      // never the spam's own subject (0045)
  if (m.kind === "chat") {
    const first = ((m.text || "").trim().split("\n")[0] || "…");
    return "» " + (first.length > 60 ? first.slice(0, 60) + "…" : first);
  }
  return m.subject || "(no subject)";
}

// The terminal client's compose window: subject, the post quoted, your signature below "-- ".
async function openReply(m, g) {
  if (g.team) return openTeamReply(m, g);             // on a team inbox's behalf (UN-RFC 0047)
  if (m.private && m.kind === "chat" && m.key) { await openGroup("contact:" + m.key); return; }   // answer a chat in the chat
  const subject = /^re:/i.test(m.subject) ? m.subject : "Re: " + m.subject;
  const quoted = m.text.trimEnd().split("\n").map(ln => "> " + ln).join("\n");
  const top = `${m.who} wrote:\n${quoted}\n\n`;
  const sig = await signatureText();
  const body = top + "\n" + (sig ? "-- \n" + sig + "\n" : "");
  openComposeWindow({ g, title: g.private_reply ? "Private reply to " + m.who : "Reply in " + g.label,
    subject, body, cursor: top.length, private: !!g.private_reply,
    send: (subject, text, notify, files) => g.private_reply ?
      doSend("/api/private", g.id, { key: m.key, subject, body: text, reply_to: m.id,
        ...(files && files.length ? { files } : {}) }, { text }) :
      doPost(g.id, { subject, body: text, references: [...m.references, m.id], signature: false, notify,
        ...(files && files.length ? { files } : {}) }, { text }) });
}

// Reply in a team inbox: as the team, sealed to the writer - without your signature,
// which would say who you are (UN-RFC 0047 section 8).
function openTeamReply(m, g) {
  const subject = /^re:/i.test(m.subject) ? m.subject : "Re: " + m.subject;
  const quoted = m.text.trimEnd().split("\n").map(ln => "> " + ln).join("\n");
  const top = `${m.who} wrote:\n${quoted}\n\n`;
  openComposeWindow({ g, title: "Reply as " + g.team.name, subject, body: top, cursor: top.length, private: true,
    send: (subject, text, _notify, files) => doSend("/api/private", g.id, { key: m.key, subject, body: text,
      reply_to: m.id, as_team: g.id, ...(files && files.length ? { files } : {}) }, { text }) });
}

// Edit your own post (UN-RFC 0042): a new version, in the same place in its thread.
function openEdit(m, g) {
  openComposeWindow({ g, title: "Edit your post in " + g.label, subject: m.subject, edit: true, cursor: 0,
    body: (m.text || "").trimEnd() + "\n" + (m.signature ? "\n-- \n" + m.signature + "\n" : ""),
    send: (subject, text) => doSend(`/api/groups/${encodeURIComponent(g.id)}/edit`, g.id,
      { id: m.id, subject, body: text }, { text }) });
}

// Edit a chat line or a comment (UN-RFC 0042): one line, no subject, no signature.
function openEditLine(m) {
  const gid = m.group || (S.data && S.data.group && S.data.group.id);
  formDialog({ label: "Edit", title: m.depth ? "Edit your comment" : "Edit your chat line", focus: "#eline", button: "Save",
    values: { line: (m.text || "").trimEnd() },
    note: "A new version: people may already have read the earlier one, and may keep it.",
    fields: (vals) => [h("label", { for: "eline", class: "sr", text: "Text" }),
      h("textarea", { id: "eline", name: "line", class: "in", "data-k": "eline", style: "min-height:80px", value: vals.line })],
    submit: async (v) => {
      const text = (v.line || "").trim();
      if (!text) throw new Error("Write something, or withdraw it instead.");
      closeDialog();
      await doSend(`/api/groups/${encodeURIComponent(gid)}/edit`, gid, { id: m.id, subject: "", body: text + "\n", chat: true }, { text, chat: true });
    } });
}

// "⋯" on a post, an entry, a comment or a chat line: what you may do with it - edit and
// withdraw your own, pin where you may, copy its address. Shown on hover (always where
// there is no hover, on a touch screen).
// "⋯" on a chat in the list: close it, or add or remove the person as a contact.
function chatMenu(p) {
  const id = "chat:" + p.key, open = S.menuFor === id;
  const items = [["Close chat", () => closeChat(p.key, p.label)],
    p.contact ? ["Remove contact", () => removeContact(p.key, p.label)]
      : ["Add contact", () => openAddContact(p.key, p.label.replace(/~.*$/, "").replace(/^@/, ""))]];
  return h("div", { class: "more" + (open ? " open" : "") },
    h("button", { class: "morebtn", type: "button", "aria-label": "More about the chat with " + p.label,
      "aria-haspopup": "menu", "aria-expanded": String(open),
      onclick: (e) => { e.stopPropagation(); S.menuFor = open ? null : id; render(); } }, "⋯"),
    open ? h("div", { class: "menu", role: "menu" }, items.map(([label, run]) => h("button", { class: "mi", type: "button", role: "menuitem",
      onclick: (e) => { e.stopPropagation(); S.menuFor = null; render(); run(); } }, label))) : null);
}

// The ⋯ menu of a post or chat line: reply privately, copy its address, edit, withdraw,
// pin, report.
function moreMenu(m) {
  if (!m || !m.readable) return null;
  const here = S.data && S.data.group;
  const pinHere = here && here.may_pin && (!m.group || m.group === here.id);
  const items = [
    m.may_edit ? ["Edit", () => (m.kind === "chat" ? openEditLine(m) : openEdit(m, groupOf(m.group) || here))] : null,
    m.may_withdraw ? ["Withdraw (delete)", () => openWithdraw(m)] : null,
    pinHere ? [m.pinned ? "Unpin" : "Pin", () => openPin(m)] : null,
    m.address && !m.private ? ["Copy address", () => copy(m.address, "The address is copied.")] : null,
    m.address && !m.private ? ["Copy web address", () => copyWeb(m.address, "post")] : null,
    ...ruleItems(m),                        // your own rules: why, and the thread's mark
    ...reportItems(m),                      // spam reports: show anyway, publish one
    // report it to those who can act on it - in a feed, a comment or a chat as in the reader
    !m.mine && !m.private && m.group ? ["Report", () => openReport(m)] : null,
  ].filter(Boolean);
  if (!items.length) return null;
  const open = S.menuFor === m.id;
  return h("div", { class: "more" + (open ? " open" : "") },
    h("button", { class: "morebtn", type: "button", "aria-label": "More", "aria-haspopup": "menu", "aria-expanded": String(open),
      onclick: (e) => { e.stopPropagation(); S.menuFor = open ? null : m.id; render(); } }, "⋯"),
    open ? h("div", { class: "menu", role: "menu" }, items.map(([label, run]) => h("button", { class: "mi", type: "button", role: "menuitem",
      onclick: (e) => { e.stopPropagation(); S.menuFor = null; render(); run(); } }, label))) : null);
}

// The compose window for a post, a reply, an edit or a private message: subject, text with
// preview, files, signature.
function openComposeWindow({ g, title, subject, body, cursor, send, private: priv, edit }) {
  const dialog = { focus: "#body", node: null, files: [] };
  // files (UN-RFC 0027): where the group takes them; said plainly where its node does not.
  // A private post: pictures, encrypted to them (#102, unseenet#497) - if their inbox
  // takes none, the runtime says so when it sends.
  // a private post: pictures and PDFs, encrypted to them (#102, unseenet#497, unseenet#637)
  const fg = priv ? { files: { max_size: 4194304 - 40, types: ["image/*", "application/pdf"] }, node_files: true } : g;
  const takes = !edit && fg && fg.files, carries = takes && fg.node_files !== false;
  // mention notices (UN-RFC 0032): who would be told, and a box to say no
  const N = { may: !priv && !edit && g && g.type !== "closed", names: [], max: 5,
    on: !(S.sidebar && S.sidebar.notices && S.sidebar.notices.send === false), timer: null };
  let lookup = 0;
  const askWho = () => {
    clearTimeout(N.timer);
    const version = ++lookup;
    if (!N.may) return;
    N.timer = setTimeout(async () => {
      if (S.dialog !== dialog || version !== lookup) return;
      const f = dialog.node.querySelector("form");
      try {
        const r = await api("POST", `/api/groups/${encodeURIComponent(g.id)}/mentioned`, { subject: f.subject.value, body: f.body.value });
        if (S.dialog !== dialog || version !== lookup) return;
        N.may = r.may; N.names = r.names; N.max = r.max || 5;
      } catch (_) { return; }
      const el = dialog.node.querySelector("#notify-who");
      if (el) {
        if (N.may) el.textContent = whoText();
        else { dialog.node.querySelector(".check").remove(); el.remove(); }
      }
    }, 400);
  };
  const whoText = () => !N.names.length ? "" : !N.on ?
    `Nobody is told: ${N.names.join(", ")} see it only if they follow the group.` :
    "Told: " + N.names.slice(0, N.max).join(", ") +
      (N.names.length > N.max ? `  (at most ${N.max}; not told: ${N.names.slice(N.max).join(", ")})` : "");
  const go = async (e) => {
    e && e.preventDefault();
    if (S.dialog !== dialog) return;
    const f = dialog.node.querySelector("form");
    const s = f.subject.value.trim(), b = f.body.value.replace(/\s+$/, "");
    const own = b.split(/\n-- \n/)[0].split("\n").filter(ln => !/^>/.test(ln) && !/ wrote:$/.test(ln)).join("").trim();
    if (!s || (!own && !dialog.files.length)) { toast("Write something of your own above the signature."); return; }
    const files = dialog.files.map(f => ({ name: f.name, data: f.data, alt: f.alt.trim() }));
    if (files.some(f => /^image\//.test(dialog.files.find(x => x.name === f.name).type) && !f.alt) &&
        !window.confirm("A picture without a description: people who cannot see it - a terminal, a screen reader - get only its name. Post anyway?")) return;
    closeDialog();
    await send(s, b, N.may ? N.on : undefined, files);
    toast(edit ? "Saving the new version - postage takes a few seconds." :
      priv ? "Sending - sealed to them." : "Sending - postage takes a few seconds." +
      (N.may && N.on && N.names.length ? ` ${Math.min(N.names.length, N.max)} told in a few minutes.` : ""));
  };
  dialog.node = dialogShell({ label: title, wide: true },
    h("div", { class: "dh" }, h("h2", { text: title }),
      h("button", { class: "btn primary dh-send", onclick: go }, priv ? "Send" : "Post"),   // phones: above the keyboard
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("form", { class: "db", onsubmit: go, onkeydown: (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") go(e); } },
      h("label", { for: "subject", text: "Subject" }),
      h("input", { id: "subject", name: "subject", class: "in", "data-k": "csubject", autocomplete: "off", value: subject, oninput: askWho }),
      h("div", { class: "label-row" }, h("label", { for: "body", text: "Text" }), emojiButton("cbody")),
      h("textarea", { id: "body", name: "body", class: "in compose-body mono", "data-k": "cbody", value: body, spellcheck: "true", oninput: askWho }),
      N.may ? h("label", { class: "check" }, h("input", { type: "checkbox", checked: N.on,
        onchange: (e) => { N.on = e.target.checked; const el = dialog.node.querySelector("#notify-who"); if (el) el.textContent = whoText(); } }),
        " Tell the people you mention (a notice in their inbox)") : null,
      N.may ? h("p", { id: "notify-who", class: "hint", style: "margin:0", text: whoText() }) : null,
      takes ? filePicker(dialog, fg, carries) : null,
      h("p", { class: "hint", style: "margin:0", text: (priv ? "Sealed to them: only they can read it. " :
        "Cut the quote down to what you answer. Signed with your key; a little proof-of-work is added. ") +
        (S.sidebar && S.sidebar.markdown === false ? "Plain text." : "Markdown: *emphasis*, **strong**, `code`, - lists, > quotes, :tada:") })),
    h("div", { class: "df btns" }, h("button", { class: "btn", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn primary", onclick: go }, priv ? "Send" : "Post", h("kbd", { text: "Ctrl S" }))));
  S.dialog = dialog;
  render();
  const ta = dialog.node.querySelector("#body");
  if (ta && cursor != null) { ta.focus(); ta.setSelectionRange(cursor, cursor); ta.scrollTop = 0; }
  askWho();
}

// What a post on its way shows: postage being worked out, sent, reached the node, or not
// sent and why.
function pendingState(p) {
  if (p.state === "failed") return h("span", { class: "state bad", text: "Not sent: " + (p.error || "") });
  if (p.state === "sent") return h("span", { class: "state" }, svg(ICON.check, 14, 2.5), "sent");
  if (p.state === "reached") return h("span", { class: "state ok" }, svg(ICON.checks, 14, 2.5), "reached the node");
  if (p.state === "queued") return h("span", { class: "sending" }, "Sending …");
  // a brand-new key ripens first, once (UN-RFC 0025): sequential, so t/next_at is exact
  if (p.state === "ripening" && typeof p.fraction === "number") {
    const pct = Math.min(99, Math.round(100 * p.fraction));
    return h("span", { class: "sending", title: "A new key works a few minutes, once, before it can post. " +
                       "That is what keeps throwaway keys from spamming." },
      `Your new key is getting ready · ${pct}%`,
      h("span", { class: "bar determinate" }, h("span", { style: `width:${pct}%` })));
  }
  if (typeof p.fraction !== "number" && S.ripening && S.ripening.level === null && S.ripening.next_at) {
    const pct = Math.min(99, Math.round(100 * S.ripening.t / S.ripening.next_at));
    return h("span", { class: "sending", title: "A new key works a few minutes, once, before it can post. " +
                       "That is what keeps throwaway keys from spamming." },
      `Your new key is getting ready · ${pct}%`,
      h("span", { class: "bar determinate" }, h("span", { style: `width:${pct}%` })));
  }
  // postage progress from the core (#29): the chance it is done by now, never 100% early
  if (typeof p.fraction === "number") {
    const pct = Math.round(p.fraction * 100);
    return h("span", { class: "sending", title: "Postage (proof-of-work) for this message" },
      `Sending · postage ${pct}%`,
      h("span", { class: "bar determinate" }, h("span", { style: `width:${pct}%` })));
  }
  return h("span", { class: "sending" }, "Sending · proof-of-work", h("span", { class: "bar" }, h("span", {})));
}
