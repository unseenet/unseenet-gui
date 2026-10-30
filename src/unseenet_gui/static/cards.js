// cards.js - link cards (UN-RFC 0059, UN-RFC 0046 section 4.25).
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...) and files.js's picture().
"use strict";

// ---- showing a card --------------------------------------------------------
// A card is the poster's: made once by their client over Tor and carried in the post.
// Nothing here fetches anything from the web - the icon is in the card, the picture is a
// file of the post, fetched through the core like any other (files.js). The domain comes
// from the link and is always shown, before the site's own name (section 8).

const CARD_URL = /\bhttps?:\/\/[^\s<>"'`]+/gi;    // a web link in a text
// How many web links a text has: a feed shows "+N links" beside the card.
function linksIn(text) {
  const seen = new Set();
  for (const ln of String(text || "").split("\n")) {
    for (const u of ln.match(CARD_URL) || []) seen.add(u.replace(/[.,;:!?)\]}*_~'"]+$/, ""));
  }
  return seen.size;
}

// The icon: the card's own, or the domain's first letter - never a picture of ours.
function cardIcon(c, big) {
  const px = big ? 40 : 18;
  return c.icon ? h("img", { class: "cicon" + (big ? " big" : ""), src: "data:image/png;base64," + c.icon,
      alt: "", width: px, height: px, draggable: "false" })
    : h("span", { class: "cicon none" + (big ? " big" : ""), "aria-hidden": "true",
      text: (c.domain || "?").charAt(0).toUpperCase() });
}

// The line with the icon, the domain (from the link) and the site's own name.
function cardSource(c, big) {
  return h("div", { class: "csrc" }, big ? null : cardIcon(c, false),
    h("span", { class: "cdom" + (c.domain_confusable ? " odd" : ""), text: c.domain || "",
      title: c.domain_confusable ? "This address mixes letters from different alphabets and may look like another one. Check it carefully." : null }),
    c.domain_confusable ? h("span", { class: "codd", text: " ⚠" , "aria-label": "may look like another address" }) : null,
    c.site ? h("span", { class: "csite", text: " · " + c.site }) : null);
}

// A message's card: in a post or a feed with its picture, in a chat small (section 8).
function cardOf(m, chat) {
  const c = m.card;
  if (!c || !m.readable) return null;
  const pa = (m.attachments || []).find(a => a.card);
  let pic = null;
  if (pa && !chat && SHOWN.test(pa.type)) {
    const p = picture(m.group, pa.blob);
    const ratio = pa.dim ? `aspect-ratio:${pa.dim[0]}/${pa.dim[1]}` : null;
    pic = p.state === "ok" ? h("img", { class: "cpic", src: p.pic.data, alt: "", style: ratio, draggable: "false" })
      : h("div", { class: "cpic " + (p.state === "loading" ? "wait" : "off"), style: ratio },
        p.state === "loading" ? null : h("span", { class: "hint", text: p.error || "The picture is not shown." }));
  }
  const compact = !pic && !chat;
  const made = c.made ? new Date(c.made).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "";
  const more = chat ? 0 : linksIn(m.text) - 1;
  return [h("a", { class: "lcard" + (compact ? " compact" : "") + (chat ? " in-chat" : ""), href: c.url,
      title: c.url, "data-k": "card:" + m.id,
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); openLink(c.url); } },
      pic, compact ? cardIcon(c, true) : null,
      h("div", { class: "ctext" }, cardSource(c, compact),
        h("div", { class: "ctitle", text: c.title }),
        c.desc && !chat ? h("div", { class: "cdesc", text: c.desc }) : null,
        chat ? null : h("div", { class: "cfoot", text: "Preview from the poster" + (made ? " · " + made : "") }))),
    more > 0 ? h("span", { class: "hint cmore", text: `+${more} link${more > 1 ? "s" : ""} in the post` }) : null];
}

// ---- making a card while writing (section 7) --------------------------------
// The compose window asks the core for a card when a link is pasted or typing pauses -
// for the first link that is not quoted, or the one the poster chose. The card is shown
// as it will be sent; its title and description can be changed, its picture or the card
// removed. The core makes it over Tor; the page never fetches anything.

// The web links of a text being written, not quoted ("> "), in order.
function writtenLinks(text) {
  const out = [];
  for (const ln of String(text || "").split("\n")) {
    if (/^\s*>/.test(ln)) continue;
    for (let u of ln.match(CARD_URL) || []) {
      u = u.replace(/[.,;:!?)\]}*_~'"]+$/, "");
      if (!/^https?:\/\/[^/]+\/a\//i.test(u) && !out.includes(u)) out.push(u);   // not an Unseenet address
    }
  }
  return out;
}

// The card part of a compose window. ``start``: an edit's card (kept unless changed), its
// picture fetched from ``group`` and kept unless the poster removes it.
// Returns {node, value(), onText(text, pasted)}: value() is undefined to keep (an edit),
// null for none, or the card to send.
function cardComposer(start, enabled, group) {
  // keepPic: an edit's card keeps the picture its post carries until the poster removes it
  const st = { card: start ? { ...start } : null, chosen: null, off: new Set(), loading: null,
    changed: false, timer: null, ask: 0, links: [], keepPic: !!(start && start.image), thumb: null };
  if (st.keepPic && group) {                     // the post's own picture, through the core
    api("GET", `/api/groups/${encodeURIComponent(group)}/files/${encodeURIComponent(start.image)}`)
      .then(p => { st.thumb = p.data; draw(); }).catch(() => { /* shown without it */ });
  }
  const box = h("div", { class: "cardbox", hidden: !st.card });
  const draw = () => {
    box.hidden = !st.card && !st.loading;
    if (st.loading) {
      box.replaceChildren(h("div", { class: "lcard edit wait" },
        h("span", { class: "hint", text: "Making a preview of " + shortLink(st.loading) + " over Tor …" }),
        h("button", { type: "button", class: "btn icon", "aria-label": "No preview",
          onclick: () => { st.off.add(st.loading); st.loading = null; st.ask++; draw(); } }, svg(ICON.x))));
      return;
    }
    const c = st.card;
    if (!c) { box.replaceChildren(); return; }
    const others = st.links.filter(u => u !== c.url);
    // a small picture beside the text: the card as sent, without stretching it to the window
    const src = c.picture ? `data:${c.picture.type};base64,${c.picture.data}` : st.keepPic ? st.thumb : null;
    const thumb = src ? h("img", { class: "cthumb", src, alt: "" })
      : st.keepPic ? h("div", { class: "cthumb wait" }) : cardIcon(c, true);
    const hasPic = !!(c.picture || st.keepPic);
    box.replaceChildren(
      h("div", { class: "lcard edit" }, thumb,
        h("div", { class: "ctext" }, cardSource(c, true),
          h("input", { class: "in ctitle-in", "aria-label": "The preview's title", value: c.title, maxlength: 200,
            placeholder: "A title for the preview", oninput: (e) => { c.title = e.target.value; st.changed = true; } }),
          h("textarea", { class: "in cdesc-in", "aria-label": "The preview's description", rows: 2, maxlength: 300,
            placeholder: "A short description (optional)", value: c.desc || "",
            oninput: (e) => { c.desc = e.target.value; st.changed = true; } }),
          c.note ? h("p", { class: "hint", style: "margin:0", text: c.note }) : null),
        h("button", { type: "button", class: "btn icon cx", "aria-label": "Send without a preview", title: "Send without a preview",
          onclick: () => { st.off.add(c.url); st.card = null; st.keepPic = false; st.changed = true; draw(); } }, svg(ICON.x))),
      h("div", { class: "cardtools" },
        h("span", { class: "hint", text: "Preview of the link, sent with your post - readers fetch nothing." }),
        hasPic ? h("button", { type: "button", class: "link",
          onclick: () => { c.picture = null; st.keepPic = false; st.changed = true; draw(); } }, "Without the picture") : null,
        others.length ? h("button", { type: "button", class: "link",
          onclick: () => { st.chosen = others[0]; st.off.delete(others[0]); make(others[0]); } }, "Preview " + shortLink(others[0]) + " instead") : null));
  };
  const make = async (url) => {
    const ask = ++st.ask;
    st.loading = url; draw();
    try {
      const r = await api("POST", "/api/card", { url }, { timeout: 90000 });
      if (ask !== st.ask) return;
      st.loading = null;
      st.card = r.card && (r.card.title || r.card.note) ? r.card : null;
      if (st.card && !st.card.title) st.card.title = "";
      st.keepPic = false; st.changed = true;
    } catch (err) {
      if (ask !== st.ask) return;
      st.loading = null; st.card = null; st.off.add(url);
      toast("No preview: " + err.message);
    }
    draw();
  };
  const onText = (text, pasted) => {
    st.links = writtenLinks(text);
    if (!enabled) return;
    clearTimeout(st.timer);
    // the card's link taken out of the text: the card goes too
    if (st.card && !st.links.includes(st.card.url)) { st.card = null; st.keepPic = false; st.changed = true; draw(); }
    if (st.card || st.loading) { if (st.card) draw(); return; }
    const url = (st.chosen && st.links.includes(st.chosen)) ? st.chosen : st.links.find(u => !st.off.has(u));
    if (!url) return;
    st.timer = setTimeout(() => make(url), pasted ? 0 : 1200);
  };
  draw();
  return { node: box, onText,
    value: () => {
      if (start && !st.changed) return undefined;            // an edit keeps its card
      const c = st.card;
      if (!c || !c.title.trim()) return start ? null : undefined;
      return { url: c.url, title: c.title.trim(), desc: (c.desc || "").trim(), site: c.site || "",
        icon: c.icon || null, picture: c.picture || null, made: c.made || null,
        ...(st.keepPic && !c.picture ? { keep_picture: true } : {}) };   // the post's own picture
    } };
}

// A link shortened for a button: its host and the start of its path.
function shortLink(u) {
  try { const x = new URL(u); return x.hostname.replace(/^www\./, "") + (x.pathname.length > 1 ? x.pathname.slice(0, 18) + (x.pathname.length > 18 ? "…" : "") : ""); }
  catch (_) { return u.slice(0, 30); }
}
