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

// A list to choose one from, with a filter above it (the share dialogs: a contact, a
// group): the house's search field and rows, as in the person picker - never a bare
// select, and never a list longer than the dialog. Arrows move, Enter chooses.
function shareChooser({ id, label, placeholder, rows, q, chosen, onQuery, onChoose, empty }) {
  const pick = rows.filter(r => !r.off);
  const go = (d) => {
    const i = pick.findIndex(r => r.value === chosen);
    const r = pick[Math.max(0, Math.min(pick.length - 1, (i < 0 ? -1 : i) + d))];
    if (r) { onChoose(r); const el = document.querySelector(`#${id}-list [data-v="${CSS.escape(r.value)}"]`);
      if (el) el.scrollIntoView({ block: "nearest" }); }
  };
  return h("div", { class: "schoose" },
    h("label", { for: id, text: label }),
    h("div", { class: "side-filter" }, svg(ICON.search, 16),
      h("input", { id, type: "search", "data-k": id, autocomplete: "off", placeholder, value: q, "aria-controls": id + "-list",
        oninput: (e) => onQuery(e.target.value),
        onkeydown: (e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); go(e.key === "ArrowDown" ? 1 : -1); }
          else if (e.key === "Enter") { e.preventDefault(); if (pick.length === 1) onChoose(pick[0]); }
          else if (e.key === "Escape" && q) { e.preventDefault(); e.stopPropagation(); onQuery(""); }
        } })),
    h("div", { class: "slist", id: id + "-list", role: "listbox", "aria-label": label },
      rows.length ? rows.map(r => h("div", { class: "cmd" + (r.value === chosen ? " on" : "") + (r.off ? " off" : ""),
          role: "option", "aria-selected": String(r.value === chosen), "aria-disabled": r.off ? "true" : null, "data-v": r.value,
          onclick: () => { if (!r.off) onChoose(r); } },
        r.colour !== undefined ? h("span", { class: `av xs c${r.colour}`, "aria-hidden": "true", text: initials(r.label) }) : null,
        h("span", { class: "nm", text: r.label }),
        r.sub ? h("small", { text: r.sub }) : null,
        r.value === chosen ? svg(ICON.check, 16) : null))
        : h("p", { class: "muted", style: "padding:10px 12px;margin:0", text: empty })));
}

// Share with a comment, into a group, or send to one person (sections 5.5, 7.2, 7.4): the
// ordinary compose window - subject, text, files, link card, language, tags - with the
// shared post as a card under the text. Into a group: the group is chosen first, from those
// that take shares; send to: the person, with the person picker.
async function openShare(m, mode) {
  let o;
  try { o = await api("GET", `/api/groups/${encodeURIComponent(m.group)}/share?id=${encodeURIComponent(m.id)}`); }
  catch (x) { toast(x.message); return; }
  const share = { group: m.group, id: m.id, of: o.target, ofGroup: o.target_group };
  sharedOriginal(share.of, share.ofGroup);                  // fetched while you choose
  if (mode === "send") {
    openPersonPicker("post", { title: "Send to…", onPick: (p) => openPost(p.key, p.label, "", null, "", share) });
    return;
  }
  const places = o.destinations || [];
  if (mode === "comment") {
    const feed = places.find(p => p.own_feed);
    if (!feed || feed.reason) { toast(feed && feed.reason ? feed.reason + "." : "Start your feed first."); openMyFeed(); return; }
    openShareCompose(share, feed.group, "Share in your feed");
    return;
  }
  openSharePlace(share, places.filter(p => !p.own_feed));
}

// Into a group: which one - a search over the groups you follow that take shares, those
// that cannot take this one last, with why.
function openSharePlace(share, places) {
  const st = { q: "", into: "" };
  const rows = () => {
    const q = st.q.trim().toLowerCase();
    return places.filter(p => !q || (p.label + " " + p.group).toLowerCase().includes(q))
      .sort((a, b) => (b.allowed - a.allowed) || a.label.localeCompare(b.label, undefined, { sensitivity: "base" }))
      .map(p => ({ value: p.group, label: p.label, off: !p.allowed,
        sub: !p.allowed ? p.reason : p.shared ? "shared here - this replaces it" : "" }));
  };
  const go = (r) => { const p = places.find(x => x.group === r.value); closeDialog();
    openShareCompose(share, r.value, "Share in " + (p ? p.label : labelOf(r.value))); };
  S.dialog = { focus: "#sinto", render: () => dialogShell({ label: "Share into a group", cls: "picker sharing" },
    h("div", { class: "dh" }, h("h2", { text: "Share into a group" }),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db" },
      places.length ? shareChooser({ id: "sinto", label: "Into", placeholder: "Find a group", rows: rows(), q: st.q,
        chosen: st.into, onQuery: (v) => { st.q = v; render(); }, onChoose: go,
        empty: "No group you follow matches." })
        : h("p", { class: "hint", text: "None of the groups you follow takes shares." })),
    h("div", { class: "df" }, h("span", { text: "At most three groups besides your feed · each share is its own post there" }))) };
  render();
}

// The compose window for a share in a group (your feed or another): a post of your own,
// the shared post as a card under it; no subject needed - the core makes one.
async function openShareCompose(share, gid, title) {
  let g;
  try { g = fromGroup((await api("GET", "/api/groups/" + encodeURIComponent(gid) + "?limit=1")).group); }
  catch (x) { toast(x.message); return; }
  const sig = await signatureText();
  openComposeWindow({ g, title, subject: "", cursor: 0, newThread: true, share,
    body: "\n\n" + (sig ? "-- \n" + sig + "\n" : ""),
    send: (subject, text, notify, files, tags, languages, days, card) => {
      shareWarnOnce();
      return doPost(gid, { subject, body: text, signature: false, notify, share: { group: share.group, id: share.id },
        ...(files && files.length ? { files } : {}), ...(tags && tags.length ? { tags } : {}),
        ...(languages !== undefined ? { languages } : {}), ...(days !== undefined ? { comment_days: days } : {}),
        ...(card ? { card } : {}) }, { text });
    } });
}

// The shared post in a compose window: drawn again until it is fetched.
function shareSlot(share) {
  const slot = h("div", { class: "share-slot" });
  const fill = () => {
    if (!slot.isConnected && slot.dataset.drawn) return;          // the window is closed
    slot.dataset.drawn = "1";
    const t = sharedOriginal(share.of, share.ofGroup);
    slot.replaceChildren(shareCard({ share: { of: share.of, group: share.ofGroup }, date: null }, false) || h("span"));
    if (t.state === "fetching") setTimeout(fill, 1000);
  };
  fill();
  return slot;
}
