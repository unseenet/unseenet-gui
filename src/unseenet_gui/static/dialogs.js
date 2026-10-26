// dialogs.js - dialogs shared by the page.
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- dialogs ------------------------------------------------------------
function closeDialog() { S.dialog = null; render(); }

// A click outside a dialog closes it only when the click also began outside it,
// so a click that starts on a button, or text you select, never closes it.
let downOnScrim = false;
// The frame of every dialog: a scrim that closes it when clicked, a box, Escape to close.
function dialogShell(props, ...kids) {
  return h("div", { class: "scrim", onmousedown: (e) => { downOnScrim = e.target === e.currentTarget; },
    onclick: (e) => { if (downOnScrim && e.target === e.currentTarget) closeDialog(); downOnScrim = false; } },
    h("div", { class: "dialog" + (props.wide ? " wide" : "") + (props.cls ? " " + props.cls : ""), role: "dialog",
      "aria-modal": "true", "aria-label": props.label }, kids));
}

// Your key: the fingerprint and key to give people, with its identicon.
function openKey() {
  const me = S.state.me;
  S.dialog = { focus: ".dialog .btn.primary", render: () => dialogShell({ label: "Your key" },
    h("div", { class: "dh" }, h("h2", { text: "Your key" }), h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db" },
      h("p", { style: "margin:0", text: "Share it to get private messages and invitations to closed groups. It is safe to share: it is the public half." }),
      h("div", { class: "keybox", text: me.key }),
      h("p", { class: "hint", style: "margin:0", text: "Fingerprint " + me.fp + " - others see it after your name until they add you as a contact." })),
    h("div", { class: "df btns" }, h("button", { class: "btn primary", onclick: () => copy(me.key, "Your key is copied.") }, "Copy key"))) };
  render();
}

// What Unseenet is, in plain words. The text is the core's (unseenet.core.about),
// the same as the TUI's F1, so every client says the same. Works before unlocking too.
let ABOUT = null;
// About: the versions of the core and this client, and where the code is.
async function openAbout() {
  if (!ABOUT) {
    try { ABOUT = await api("GET", "/api/about"); }
    catch (err) { toast("Could not load the about text: " + err.message); return; }
  }
  const a = ABOUT;
  const para = (t) => h("p", { style: "margin:0", text: t });
  const head = (t) => h("h3", { class: "about-h", text: t });
  S.dialog = { focus: ".dialog .btn.primary", render: () => dialogShell({ label: "About Unseenet", wide: true },
    h("div", { class: "dh" }, logo(26), h("h2", { text: "About Unseenet" }),
      h("span", { class: "muted mono", style: "font-size:12px", text: a.version }),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db about" },
      h("p", { class: "about-tag", text: a.tagline }),
      a.sections.map(s => [head(s.title), s.paragraphs.map(para)]),
      head(a.comparisons.title),
      h("p", { class: "muted", style: "margin:0", text: a.comparisons.intro }),
      h("dl", { class: "about-cmp" }, a.comparisons.items.map(c => [h("dt", { text: c.name }), h("dd", { text: c.text })])),
      h("div", { class: "about-status" }, head(a.status.title), a.status.paragraphs.map(para))),
    h("div", { class: "df btns" },
      h("button", { class: "btn", onclick: () => openLink(a.links.source) }, "GitHub"),
      h("button", { class: "btn primary", onclick: () => openLink(a.links.docs) }, "Documentation"))) };
  render();
}

// About the group shown: its address, owner, rules, retention, node and settings.
function openInfo() {
  const g = S.data && S.data.group;
  if (!g || !g.type) return;
  S.dialog = { render: () => dialogShell({ label: "About this group" },
    h("div", { class: "dh" }, h("h2", { class: "mono", text: g.label }), h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db" },
      g.title ? h("p", { style: "margin:0", text: g.title }) : null,
      g.description ? h("p", { class: "muted", style: "margin:0", text: g.description }) : null,
      h("dl", { class: "kv" },
        h("dt", { text: "Type" }), h("dd", { text: g.type + (g.local ? ", local (one node)" : "") }),
        h("dt", { text: "Shown as" }), h("dd", { text: g.view + (g.owner_view !== g.view ? ` (the owner chose ${g.owner_view})` : "") }),
        h("dt", { text: "Takes" }), h("dd", { text: (g.kinds || []).length === 1 ?
          (g.kinds[0] === "post" ? "posts with a subject only (a discussion group)" : "chat lines only (a chat group)") :
          "posts and chat lines" }),
        h("dt", { text: "Delivery" }), h("dd", { text: g.fast ? "fast: nodes pass it on at once" : "normal: nodes wait a random time" }),
        h("dt", { text: "Owner" }), h("dd", { text: g.owner ? "you" : "the key after @ in the ID" }),
        h("dt", { text: "ID" }), h("dd", { class: "mono", text: g.id }),
        g.address ? [h("dt", { text: "Address" }), h("dd", { class: "mono", text: g.address })] : null),
      g.rules ? [h("h3", { style: "margin:4px 0 0;font-size:14px", text: "Rules" }),
        g.rules_markdown ? h("div", { class: "md rules" }, renderTree(g.rules_tree || []))
          : h("p", { class: "text", style: "margin:0", text: g.rules })] : null,
      g.members && g.members.length ? [h("h3", { style: "margin:4px 0 0;font-size:14px", text: `Members (${g.members.length})` }),
        g.members.map(m => h("div", { class: "member" }, h("span", { class: `av xs c${m.colour}`, text: initials(m.label) }),
          h("span", { class: "mono", text: m.label }),
          g.owner && m.key !== (S.state.me || {}).key ? h("button", { class: "link", style: "margin-left:auto",
            onclick: () => removeMember(g, m) }, "Remove") : null))] : null,
      (g.moderators || []).length ? [h("h3", { style: "margin:4px 0 0;font-size:14px", text: "Moderators" }),
        h("p", { class: "muted", style: "margin:0", text: g.moderators.map(p => p.label).join(", ") })] : null,
      (g.posters || []).length ? [h("h3", { style: "margin:4px 0 0;font-size:14px", text: "Posters" }),
        h("p", { class: "muted", style: "margin:0", text: g.posters.map(p => p.label).join(", ") })] : null),
    // what you can do here: everyone may leave; the owner has the group's tools (as the TUI's Ctrl+P)
    h("div", { class: "df btns wrap" },
      g.owner && g.type === "closed" ? h("button", { class: "btn", onclick: openInvite }, "Invite someone") : null,
      g.owner ? h("button", { class: "btn", onclick: openEditGroup }, "Edit group") : null,
      g.owner && g.type !== "closed" ? h("button", { class: "btn", onclick: openRoles }, "Moderators and posters") : null,
      g.owner ? h("button", { class: "btn", onclick: () => openBanned() }, `Banned (${(g.banned || []).length})`) : null,
      g.owner ? h("button", { class: "btn danger", onclick: openRemoveGroup }, "Remove group") : null,
      h("span", { class: "grow" }),
      g.address ? h("button", { class: "btn", onclick: () => copy(g.address, "The group's address is copied.") }, "Copy address") : null,
      g.address ? h("button", { class: "btn", title: "The same address as https://… on a web entrance",
        onclick: () => copyWeb(g.address, "group") }, "Copy web address") : null,
      g.type === "contact" ? [
        g.contact ? h("button", { class: "btn", onclick: () => { closeDialog(); removeContact(g.key, g.label.replace(/ √$/, "")); } }, "Remove contact") : null,
        h("button", { class: "btn", onclick: () => closeChat(g.key, g.label.replace(/ √$/, "")) }, "Close chat")] :
      g.id !== FOR_YOU ? h("button", { class: "btn", onclick: () => leaveGroup(g) }, "Unsubscribe") : null)) };
  render();
}
