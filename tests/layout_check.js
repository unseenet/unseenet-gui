// What is off screen, cut off or too small to tap (gui#264). Run in the page by
// tests/test_layout.py and tools/layout_audit.py; returns a list of plain sentences.
({ phone, dialog }) => {
  const out = [];
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const shown = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const name = (e) => { const t = (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ");
    return e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).join(".") : "") +
      (t ? ` "${t.slice(0, 30)}"` : ""); };
  // things meant to be cut with … , and things meant to scroll sideways
  const ellipsizes = (e) => getComputedStyle(e).textOverflow === "ellipsis" || !!e.closest("[data-ellipsize]");
  const sideways = (e) => !!e.closest("pre, .md table, .table-wrap, .keybox, code, .chips-scroll, [data-hscroll]");
  // clipped by an ancestor that hides overflow (inside the viewport): not off screen, but cut
  const clipper = (e) => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
    const s = getComputedStyle(a); if (s.overflowX !== "visible" || s.overflowY !== "visible") return a; } return null; };

  // 1. the page never scrolls sideways
  if (document.documentElement.scrollWidth > vw + 1)
    out.push(`page wider than the screen (${document.documentElement.scrollWidth} > ${vw})`);

  // 2. nothing shown reaches past the screen's edges
  // with a dialog open, only the dialog is looked at: what lies under the scrim is covered
  const scope = document.querySelector(".scrim") || document.querySelector("#root");
  const all = [...scope.querySelectorAll("*")].filter(e => shown(e) && !e.matches(".sr, .sr *"));
  for (const e of all) {
    const r = e.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) {
      const c = clipper(e);
      if (c && c.getBoundingClientRect().right <= vw + 1 && c.getBoundingClientRect().left >= -1) continue;
      if (sideways(e)) continue;
      out.push(`off screen sideways: ${name(e)} (${Math.round(r.left)}..${Math.round(r.right)} of ${vw})`);
    }
  }

  // 3. a box that scrolls sideways where it should not
  for (const e of all) {
    const s = getComputedStyle(e);
    if (!["auto", "scroll", "hidden"].includes(s.overflowX)) continue;
    if (e.scrollWidth > e.clientWidth + 2 && !ellipsizes(e) && !sideways(e) && e.clientWidth > 0)
      out.push(`content wider than its box: ${name(e)} (${e.scrollWidth} > ${e.clientWidth})`);
  }

  // 4. a dialog: inside the screen, its ✕ and primary button visible, its body scrolls
  const d = document.querySelector(".dialog");
  if (dialog && !d) out.push("no dialog opened");
  if (d) {
    const r = d.getBoundingClientRect();
    if (r.top < -1 || r.left < -1 || r.bottom > vh + 1 || r.right > vw + 1)
      out.push(`dialog outside the screen (${Math.round(r.left)},${Math.round(r.top)}..${Math.round(r.right)},${Math.round(r.bottom)} of ${vw}x${vh})`);
    const inView = (b) => { const q = b.getBoundingClientRect(); return q.top >= -1 && q.bottom <= vh + 1 && q.left >= -1 && q.right <= vw + 1; };
    const x = d.querySelector('.dh [aria-label="Close"], .pal-close');
    if (x && shown(x) && !inView(x)) out.push("dialog's ✕ not on screen");
    // the dialog's own buttons (its foot and head) are always in sight; a button in a list
    // that scrolls (Add for each known node) need only be inside the dialog sideways
    for (const b of d.querySelectorAll(".df .btn.primary, .dh .btn.primary")) if (shown(b) && !inView(b))
      out.push(`dialog's primary button not on screen: ${name(b)}`);
    for (const b of d.querySelectorAll(".btn")) {
      const q = b.getBoundingClientRect(), dr = d.getBoundingClientRect();
      if (shown(b) && (q.right > dr.right + 1 || q.left < dr.left - 1)) out.push(`button cut by the dialog's side: ${name(b)}`);
    }
  }

  // 5. headings and buttons that matter are not cut off (unless meant to end in …)
  for (const e of all.filter(e => e.matches("h1, h2, h3, button, .btn, .tab-nm"))) {
    if (e.scrollWidth > e.clientWidth + 2 && !ellipsizes(e) && getComputedStyle(e).overflowX !== "visible")
      out.push(`text cut off: ${name(e)}`);
  }

  // 6. phones: a control you tap is at least 40x40. A link that reads as text (a name in a
  // post's head, "… more", "in dk.snak") is at least 24 high, as WCAG 2.5.8 asks - 40 would
  // pull the lines it sits in apart. Links in what people wrote are left as written.
  if (phone) for (const e of all.filter(e => e.matches("button, .btn, [role=button], input[type=checkbox], input[type=radio], select"))) {
    if (e.closest(".md, .pbody, .etext, .bubble .text, [data-small-ok]")) continue;
    // a checkbox or radio is tapped by its label
    const t = e.matches("input") ? (e.closest("label") || (e.id && document.querySelector(`label[for="${e.id}"]`)) || e) : e;
    const r = t.getBoundingClientRect();
    const textLink = e.matches(".link, .name-btn, .me-name, .node-link") && !e.matches(".btn");
    if (textLink ? r.height < 24 : (r.width < 40 || r.height < 40))
      out.push(`small to tap: ${name(e)}${e.type && e.matches("input") ? "[" + e.type + (e.name ? " " + e.name : "") + "]" : ""} (${Math.round(r.width)}x${Math.round(r.height)})`);
  }
  return [...new Set(out)];
}
