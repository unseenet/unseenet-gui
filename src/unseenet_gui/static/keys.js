// keys.js - keys and the command palette's shortcuts.
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- keys -----------------------------------------------------------------
document.addEventListener("click", () => { if (S.menuFor) { S.menuFor = null; render(); } });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && S.menuFor) { S.menuFor = null; render(); e.preventDefault(); return; }
  if (e.key === "F1" && TOKEN && S.state) { e.preventDefault(); if (!S.dialog) openAbout(); return; }   // as the TUI
  if (!S.state || !S.state.unlocked || S.state.setup) return;
  const ctrl = e.ctrlKey || e.metaKey;
  // letters work with Shift or Caps Lock too (the hints show capitals); only D is Shift+D, as in the TUI
  const key = e.key.length === 1 && e.key !== "D" ? e.key.toLowerCase() : e.key;
  if (ctrl && (key === "p" || key === "k")) { e.preventDefault(); if (S.dialog) closeDialog(); else openPalette(); return; }
  if (e.key === "Escape") {
    if (S.dialog) { e.preventDefault(); closeDialog(); return; }
    if (typing(document.activeElement)) { document.activeElement.blur(); return; }
    if (S.full) { S.full = false; render(); }
    return;
  }
  if (S.dialog || typing(document.activeElement) || ctrl || e.altKey) return;
  const g = S.data && S.data.group;
  if (reading()) {                     // the terminal client's reader keys
    const cur = S.data.messages.find(x => x.id === S.post);
    const sc = document.querySelector(".reader .scroll");
    const back = () => { S.full = false; render(); };
    const k = {
      n: () => step(1), p: () => step(-1), j: () => step(1), ArrowDown: () => step(1), ArrowUp: () => step(-1),
      q: back, f: back, Enter: back,
      " ": () => { if (sc && sc.scrollTop + sc.clientHeight < sc.scrollHeight - 4) sc.scrollBy({ top: sc.clientHeight * 0.9 }); else nextUnread(); },
      r: () => { if (cur) tryReply(cur, g); },
      m: () => { if (cur && !cur.mine && cur.key) { S.full = false; openGroup("contact:" + cur.key); } },
      "#": () => groupsInPost(cur),
    }[key];
    if (k) { e.preventDefault(); k(); }
    return;
  }
  if (g && g.view === "feed") {                // a feed: entries, not rows (unseenet#490)
    const fk = { ArrowDown: () => feedStep(1), j: () => feedStep(1), ArrowUp: () => feedStep(-1), k: () => feedStep(-1),
      " ": feedNextUnread, r: feedComment }[key];
    if (fk) { e.preventDefault(); fk(); return; }
  }
  if (g && g.view === "pages") {               // a site: its pages, back and forward
    const site = S.data.site || {};
    const pk = { ArrowDown: () => pageStep(1), j: () => pageStep(1), ArrowUp: () => pageStep(-1), k: () => pageStep(-1),
      ArrowLeft: () => siteStep(-1), ArrowRight: () => siteStep(1),
      e: site.may_write && site.page ? () => openPageEditor(g, site, site.page) : null,
      n: site.may_write ? () => openPageEditor(g, site, null) : () => {} }[key];
    if (pk) { e.preventDefault(); pk(); return; }
  }
  const keys = {
    n: () => openCompose(), v: () => toggleView(), m: () => openWrite(), c: () => openContacts(), "@": () => openNames(), g: () => openBrowse(), k: () => openKey(), "?": () => openInfo(),
  };
  if (keys[key]) { e.preventDefault(); keys[key](); return; }
  if (g && (g.view === "feed" || g.view === "pages")) return;     // their own keys, above
  if (g && g.view === "chat") {
    if (e.key === "Enter") { const el = document.querySelector('[data-k="chat"]'); if (el) { e.preventDefault(); el.focus(); } }
    return;
  }
  if (!S.data || !S.data.messages.length) return;
  const cur = S.data.messages.find(x => x.id === S.post);
  if (key === "ArrowDown" || key === "j") { e.preventDefault(); step(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
  else if (e.key === " ") { e.preventDefault(); nextUnread(); }
  else if ((key === "Enter" || key === "f") && cur && cur.notice) { e.preventDefault(); openMentioned(cur); }
  else if (key === "Enter" || key === "f") { e.preventDefault(); S.full = true; render(); }
  else if (key === "r" && cur) { e.preventDefault(); tryReply(cur, g); }
  else if (e.key === "D" && cur && cur.may_withdraw) { e.preventDefault(); openWithdraw(cur); }   // as the TUI's shift+d
  else if (e.key === "#" && cur) { e.preventDefault(); groupsInPost(cur); }
});
