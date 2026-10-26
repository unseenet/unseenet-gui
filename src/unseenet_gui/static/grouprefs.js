// grouprefs.js - #group references (unseenet#172).
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- #group references (unseenet #172) ----------------------------------
// The same rule as the core's group_refs(): '#' and a group name (a-z, digits, + _ -
// and dots), maybe '@' and the start of the owner's fingerprint. Not '# heading',
// not '#170', not inside a word or a URL.
const GROUP_REF = /(?<![\p{L}\p{N}_@#\/&.+-])#(?=[a-z0-9+_.-]*[a-z])([a-z0-9][a-z0-9+_-]*(?:\.[a-z0-9][a-z0-9+_-]*)*)(?:@([a-z2-7]{4,16}))?(?![\p{L}\p{N}_+@-]|\.[\p{L}\p{N}_])/gu;

// A bare unseenet: address in plain text is a link too (UN-RFC 0031 section 3.4.1);
// a full stop or a bracket after it is the sentence's, not the address's.
const ADDRESS_REF = /(?<![\p{L}\p{N}_])unseenet:[^\s<>"']*[^\s<>"'.,;:!?)\]]/gu;

// A plain text with #group references made buttons that open the group (unseenet#172).
function linkGroups(text) {
  const t = text || "", out = [];
  let last = 0;
  for (const m of t.matchAll(ADDRESS_REF)) {
    if (m.index > last) out.push(...linkGroupRefs(t.slice(last, m.index)));
    const ref = m[0];
    out.push(h("a", { class: "mdlink aref", href: "#", title: "Open " + ref,
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); openAddress(ref); } }, ref));
    last = m.index + ref.length;
  }
  if (last < t.length) out.push(...linkGroupRefs(t.slice(last)));
  return out;
}

// The #group references in a text, as buttons, for under a post.
function linkGroupRefs(text) {
  const out = [];
  let last = 0;
  for (const m of (text || "").matchAll(GROUP_REF)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const ref = m[0];
    out.push(h("a", { class: "mdlink gref", href: "#", title: "Go to " + ref.slice(1),
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); goToGroup(ref); } }, ref));
    last = m.index + ref.length;
  }
  if (last < (text || "").length) out.push(text.slice(last));
  return out;
}

// Open a group a post names: one you follow opens; one you do not is shown first,
// and you choose to follow it - never without asking (as the TUI's #).
async function goToGroup(ref) {
  let found;
  try { found = (await api("GET", "/api/group-ref?ref=" + encodeURIComponent(ref))).groups.map(fromGroup); }
  catch (x) { toast(x.message); return; }
  if (!found.length) { toast(`No group called ${ref.slice(1).split("@")[0]} on your nodes.`); return; }
  if (found[0].subscribed) { S.full = false; openGroup(found[0].id); return; }
  const several = found.length > 1;
  S.dialog = { focus: "[data-k='follow:0']", render: () => dialogShell({ label: ref },
    h("div", { class: "dh" }, h("h2", {}, several ? `Groups called ${ref.slice(1)}` : `Follow ${found[0].label}?`),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db list" },
      several ? h("p", { class: "hint", style: "margin:0 0 8px", text: "Groups with the same name have different owners: check the fingerprint." }) : null,
      found.map((g, i) => h("div", { class: "cmd" },
        h("span", { class: "mono muted", style: "width:28px", text: (g.access || "") + (g.icon || "") }),
        h("span", { class: "nm" }, h("span", { class: "mono", text: several ? g.short : g.label }), " ",
          h("small", { text: g.description || "" }),
          g.warning && !(several && g.warning.startsWith("There is more than one")) ?   // said once, above
            h("small", { class: "muted", style: "display:block", text: g.warning }) : null,
          g.type === "closed" ? h("small", { class: "muted", style: "display:block", text: "Closed: you can read it only if its owner invites you." }) : null),
        h("button", { class: "btn primary", "data-k": "follow:" + i, onclick: async () => {
          try { await api("POST", "/api/subscribe", { id: g.id, on: true }); }
          catch (x) { toast(x.message); return; }
          closeDialog(); S.full = false; await loadSidebar(); openGroup(g.id); } }, "Follow")))),
    h("div", { class: "df btns" }, h("span", { class: "mono muted", text: several ? "" : found[0].id }),
      h("button", { class: "btn", onclick: closeDialog }, "Cancel"))) };
  render();
}
