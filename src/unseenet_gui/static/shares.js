// shares.js - sharing (UN-RFC 0060, unseenet#805, gui#285).
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...), files.js's picture() and feeds.js's entries.
"use strict";

// ---- the original a share refers to (sections 5.1, 6.3) ----------------------------
// A share carries only a reference. The original is fetched through the core, which
// checks it itself and goes to another node when its own will not have it; while it is
// fetched the card says so and the rest of the feed is drawn as usual. Nothing in the
// share is shown as the original: the card is made from what was fetched.
const SHARE_RETRY = 3000;              // a node still fetching (503 later): ask again after this
const SHARE_TRIES = 20;                // ... at most this many times, then "not available"
const SHARE_STATES = {
  fetching: "Fetching the shared post …",
  withdrawn: "Withdrawn by its author",
  gone: "No longer in the network",
  unavailable: "Not available right now",
};

// What is known of the original {of, group}: {state, m, label, edited}. Starts fetching it
// the first time it is asked for.
function sharedOriginal(of, group) {
  S.shareTargets = S.shareTargets || {};
  const k = of + " " + group;
  if (!S.shareTargets[k]) {
    S.shareTargets[k] = { state: "fetching", tries: 0 };
    loadSharedOriginal(of, group);
  }
  return S.shareTargets[k];
}

// Ask the core for the original, again a little later while a node is still fetching it.
async function loadSharedOriginal(of, group) {
  const k = of + " " + group, cur = S.shareTargets[k] || { tries: 0 };
  try {
    const d = await api("GET", "/api/share-target?of=" + encodeURIComponent(of) + "&group=" + encodeURIComponent(group));
    S.shareTargets[k] = { state: d.state, m: d.message ? fromShared(d) : null, label: d.label || labelOf(group),
      edited: !!d.edited };
  } catch (x) {
    if (x.status === 503 && cur.tries < SHARE_TRIES) {
      S.shareTargets[k] = { state: "fetching", tries: cur.tries + 1 };
      setTimeout(() => loadSharedOriginal(of, group), SHARE_RETRY);
      return;
    }
    S.shareTargets[k] = { state: "unavailable", tries: cur.tries };
  }
  render();
}

// The fetched original as the page draws a message.
function fromShared(d) {
  const m = d.message;
  return { id: m.id, group: m.group, subject: m.subject, kind: m.kind, who: d.who || m.from_name,
    key: m.author_key, colour: colour(m.author_key), date: m.date, edited: m.edited, text: m.text,
    tree: [], markdown: false, readable: m.readable, attachments: m.attachments || [],
    card: m.card || null, references: m.references || [], share: m.share || null,
    private: false, encrypted: false };
}

// Open the original where it lives - asked first if you do not follow its group.
function openShared(of, group) {
  openAddress("unseenet:" + group + "?m=" + String(of).replace(/^<|>$/g, ""));
}

// The first lines of the original, as the card shows them.
function shareExcerpt(text) {
  const t = String(text || "").replace(/\n{3,}/g, "\n\n").trim();
  return t.length > 280 ? t.slice(0, 280).replace(/\s+\S*$/, "") + " …" : t;
}

// The card under a share with a comment, or a chat line someone sent you (sections 5.1,
// 5.3): who, where, when, the start of the text and the first picture. Opening it opens
// the original. "Edited after it was shared" when the version shown is newer than the share.
function shareCard(m, chat) {
  const s = m.share;
  if (!s || !s.of || !s.group || s.plain) return null;
  const t = sharedOriginal(s.of, s.group);
  if (t.state !== "ok" || !t.m) {
    return h("div", { class: "scard " + t.state, "data-share": s.of },
      h("span", { class: "hint", text: SHARE_STATES[t.state] || SHARE_STATES.unavailable }));
  }
  const o = t.m;
  const after = t.edited && o.edited && m.date && new Date(o.edited) > new Date(m.date);
  const pic = chat ? null : (o.attachments || []).find(a => SHOWN.test(a.type));
  let picEl = null;
  if (pic) {
    const p = picture(o.group, pic.blob);
    picEl = p.state === "ok" ? h("img", { class: "spic", src: p.pic.data, alt: pic.alt || "", draggable: "false" }) : null;
  }
  const open = () => openShared(s.of, s.group);
  return h("div", { class: "scard" + (chat ? " in-chat" : ""), role: "link", tabindex: "0", "data-share": s.of,
      "aria-label": "The shared post by " + o.who, title: "Open the shared post",
      onclick: (e) => { e.stopPropagation(); open(); },
      onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); open(); } } },
    h("div", { class: "shd" }, avatar(o, true), h("span", { class: "who", text: o.who }),
      h("span", { class: "hint", text: "in " + t.label }), timeEl(o.date)),
    o.kind !== "chat" && o.subject ? h("div", { class: "stitle", text: o.subject }) : null,
    h("div", { class: "stext", text: shareExcerpt(o.text) }),
    picEl,
    after ? h("div", { class: "hint sedited", text: "Edited after it was shared" }) : null);
}

// ---- a plain share in a feed or the timeline (sections 5.2, 5.4) --------------------
// The original itself, under a line "Andreas shared" - or "shared by Søren and Mette" in
// the timeline, naming only sharers you follow. Never a count. A share whose original is
// gone is not shown at all; one you hide is not shown either.
// Whether plain shares in a group are hidden from you (section 5.4, your settings).
function hidesShares(gid) {
  const hs = (S.sidebar && S.sidebar.hide_shares) || {};
  return !!hs.all || (hs.groups || []).includes(gid);
}

// Who shared it: "Mette", or in the timeline "Søren and Mette" (only those you follow).
function sharedBy(m) {
  const names = (m.shared_by || []).length ? m.shared_by : [m.who];
  return names.length > 2 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1]
    : names.join(" and ");
}

// A plain share as an entry: its line, then the original as fetched (or why it is not shown).
function sharedEntry(d, e) {
  const m = e.m, s = m.share || {};
  if (hidesShares(m.group)) return null;
  const t = sharedOriginal(s.of, s.group);
  if (t.state === "withdrawn" || t.state === "gone") return null;        // nothing to show
  const o = t.state === "ok" ? t.m : null;
  const timeline = isMixed(d.group);
  return h("article", { class: "entry shared" + (m.read ? "" : " unread") + (S.post === m.id ? " on" : ""), "data-id": m.id },
    h("div", { class: "shline" }, h("span", { class: "shicon", "aria-hidden": "true", text: "↻" }),
      h("span", { text: (m.shared_by || []).length ? "shared by " + sharedBy(m) : sharedBy(m) + " shared" }),
      timeEl(m.date),
      timeline ? h("button", { class: "link efeed", onclick: () => openGroup(m.group) }, "in " + (m.group_label || labelOf(m.group))) : null,
      moreMenu(m)),
    o ? [h("div", { class: "ehd" }, avatar(o), h("div", { class: "who" }, h("span", { class: "who-name", text: o.who }),
          timeEl(o.date), h("button", { class: "link efeed", onclick: () => openShared(s.of, s.group) }, "in " + t.label))),
        o.kind !== "chat" && o.subject ? h("h3", { class: "etitle", text: o.subject }) : null,
        h("div", { class: "ebody" }, messageBody(o)),
        // comments and reactions are the original's (section 5.2): where it lives
        h("div", { class: "eact" }, h("button", { class: "link", onclick: () => openShared(s.of, s.group) },
          "Comment or react where it was posted"))]
      : h("div", { class: "scard " + t.state }, h("span", { class: "hint", text: SHARE_STATES[t.state] || SHARE_STATES.unavailable })));
}

// ---- offering it (section 5.5) -----------------------------------------------------
// One set of items in the ⋯ menu where something can be shared: Share, Share with a
// comment, Share into a group, Send to. Nothing where it cannot be - with why, when the
// author asked. Undo share on your own shares.
function shareItems(m) {
  if (!m || m.private || !m.sharePerm) return [];               // an older core: nothing offered
  const out = [];
  if (m.sharePerm.allowed) {
    out.push(["Share", () => shareNow(m)], ["Share with a comment…", () => openShare(m, "comment")],
      ["Share into a group…", () => openShare(m, "group")], ["Send to…", () => openShare(m, "send")]);
  } else if (m.sharePerm.code === "asked_not") {
    out.push(["Why can't I share this?", () => toast(m.sharePerm.reason + " - anyone who reads it can still copy its words, so it is a request, not a protection.")]);
  }
  if (m.mine && m.share) out.push(["Undo share", () => undoShare(m)]);
  if (m.kind === "share" && !m.mine) out.push([hidesShares(m.group) ? "Show shares in this feed" : "Hide shares in this feed",
    () => setHideShares({ [hidesShares(m.group) ? "show" : "groups"]: [m.group] })]);
  return out;
}

// The first time: sharing is public.
function shareWarnOnce() {
  try { if (!localStorage.getItem("unseenet.shared")) {
    toast("Shares are public: anybody can see that you shared it. Send to… is for one person.");
    localStorage.setItem("unseenet.shared", "1"); } } catch (_) { /* no storage here */ }
}

// Share into your own feed at once.
async function shareNow(m) {
  shareWarnOnce();
  try {
    await api("POST", `/api/groups/${encodeURIComponent(m.group)}/share`, { id: m.id });
    toast("Shared in your feed.");
  } catch (x) {
    if (/Start your feed/.test(x.message)) { openMyFeed(); return; }
    toast("Not shared: " + x.message);
  }
}

// Take back your share (only in its own group).
async function undoShare(m) {
  try {
    await api("POST", `/api/groups/${encodeURIComponent(m.group)}/unshare`, { id: m.id, group: m.group });
    toast("The share is taken back.");
    await loadGroup();
  } catch (x) { toast(x.message); }
}

// Hide or show plain shares: {all: true|false} or {groups: [...]} / {show: [...]} (section 5.4).
async function setHideShares(change) {
  try { await api("POST", "/api/settings", { hide_shares: change }); await loadSidebar(); render(); }
  catch (x) { toast(x.message); }
}

// Share with a comment, into a group, or send to one person: a dialog. The places come
// from the core - your feed first, the groups you follow that take shares, at most three
// besides your feed, where you shared it already marked (section 7.2).
async function openShare(m, mode) {
  let o;
  try { o = await api("GET", `/api/groups/${encodeURIComponent(m.group)}/share?id=${encodeURIComponent(m.id)}`); }
  catch (x) { toast(x.message); return; }
  const places = (o.destinations || []).filter(p => mode === "group" ? !p.own_feed : true);
  const first = mode === "group" ? places.find(p => p.allowed) : places.find(p => p.own_feed) || places.find(p => p.allowed);
  const st = { mode, into: first ? first.group : "", comment: S.drafts["share:" + m.id] || "", to: "", busy: false, err: "" };
  const contacts = (S.sidebar && S.sidebar.contacts) || [];
  const place = () => places.find(p => p.group === st.into) || null;
  const needs = () => mode === "comment" || (mode === "group" && place() && !place().plain);
  const title = mode === "send" ? "Send to…" : mode === "group" ? "Share into a group" : "Share with a comment";
  const draw = () => dialogShell({ label: title },
    h("div", { class: "dh" }, h("h2", { text: title }),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db" },
      mode === "send" ? [
        h("p", { style: "margin:0", text: "Only they can read it, sent privately. Nobody else is told." }),
        contacts.length ? h("label", { class: "field" }, "A contact",
          h("select", { "aria-label": "A contact", onchange: (e) => { st.to = e.target.value; } },
            h("option", { value: "", text: "Choose …" }),
            contacts.map(c => h("option", { value: c.key, selected: st.to === c.key, text: c.label })))) : null,
        h("label", { class: "field" }, "Or their key",
          h("input", { type: "text", "aria-label": "Their key", placeholder: "ed25519:…", value: st.to,
            oninput: (e) => { st.to = e.target.value.trim(); } }))] :
      mode === "group" ? [
        places.length ? h("div", { class: "places", role: "radiogroup", "aria-label": "Where" },
          places.map(p => h("label", { class: "radio" + (p.allowed ? "" : " off") },
            h("input", { type: "radio", name: "into", value: p.group, checked: st.into === p.group, disabled: !p.allowed,
              onchange: () => { st.into = p.group; render(); } }),
            " " + p.label, p.shared ? h("span", { class: "sm", text: "shared here" }) : null,
            !p.allowed ? h("span", { class: "hint", text: " " + p.reason }) : !p.plain ? h("span", { class: "hint", text: " needs a comment" }) : null)))
          : h("p", { class: "hint", text: "None of your groups takes shares, or you shared it into three already." }),
        h("p", { class: "hint", text: "At most three groups besides your feed. Each share is its own post there, at its own postage." })] :
      places.length && places.length > 1 ? h("label", { class: "field" }, "Where",
        h("select", { "aria-label": "Where", onchange: (e) => { st.into = e.target.value; render(); } },
          places.filter(p => p.allowed || p.own_feed).map(p => h("option", { value: p.group, selected: st.into === p.group,
            text: p.own_feed ? "Your feed" : p.label })))) : null,
      h("label", { class: "field" }, mode === "send" ? "A few words (if you like)" : needs() ? "Your words" : "A few words (if you like)",
        h("textarea", { rows: 3, "aria-label": "Your words", value: st.comment, "data-k": "share:" + m.id,
          placeholder: needs() ? "Why you bring it here" : "",
          oninput: (e) => { st.comment = e.target.value; S.drafts["share:" + m.id] = e.target.value; } })),
      shareCard({ share: { of: o.target, group: o.target_group }, date: null }, false),
      st.err ? h("p", { class: "error", text: st.err }) : null),
    h("div", { class: "df btns" },
      h("button", { class: "btn", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn primary", disabled: st.busy, onclick: async () => {
        const body = { id: m.id, comment: st.comment.trim() };
        if (mode === "send") {
          if (!st.to) { st.err = "Choose a contact or give their key."; render(); return; }
          body.to = st.to;
        } else {
          if (needs() && !body.comment) { st.err = "Write a few words: why you bring it here."; render(); return; }
          const p = place();
          if (p && !p.own_feed) body.into = p.group;
          if (p && p.own_feed && p.reason) { closeDialog(); openMyFeed(); return; }
        }
        st.busy = true; st.err = ""; render(); shareWarnOnce();
        try { await api("POST", `/api/groups/${encodeURIComponent(m.group)}/share`, body); }
        catch (x) { st.busy = false; st.err = x.message; render(); return; }
        delete S.drafts["share:" + m.id];
        closeDialog();
        toast(mode === "send" ? "Sent." : body.into ? "Shared into " + (place() ? place().label : "the group") + "." : "Shared in your feed.");
      } }, st.busy ? "Sending …" : mode === "send" ? "Send" : "Share")));
  S.dialog = { focus: ".dialog textarea", render: draw };
  render();
}
