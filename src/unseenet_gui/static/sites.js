// sites.js - sites and their pages (UN-RFC 0035, UN-RFC 0046 section 4.15).
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- sites and pages (UN-RFC 0035, UN-RFC 0046 section 4.15) -------------------
// A site is shown as its home page with a list of its pages in force; links within
// the site come from the core as unseenet: addresses, and following them keeps a
// history to go back and forward in (section 9.1). Its writers edit pages with a
// preview rendered by the core, as readers will see them (section 9.2).
const SITE = { path: {}, back: [], forward: [] };       // per site: the page shown; one history
// Read a site and the page shown from the core (UN-RFC 0035).
async function loadSite(gid) {
  let site, page = null, err = "";
  try { site = await api("GET", `/api/groups/${encodeURIComponent(gid)}/site`); }
  catch (x) { return { error: x.message, pages: [] }; }
  const path = SITE.path[gid] || site.home;
  try { page = await api("GET", `/api/groups/${encodeURIComponent(gid)}/page?path=${encodeURIComponent(path)}`); }
  catch (x) { err = path === site.home ? "The home page is not here yet - the site may have no pages, or they are still being read." :
    `The page ${path} is not on this site any more.`; }
  return { ...site, path, page, err };
}

// open a page of a site, from a link or an address; the place left goes on the history
async function openPage(gid, path, how = "go") {
  const here = S.gid && S.data && S.data.site ? { gid: S.gid, path: S.data.site.path } : null;
  if (how === "go" && here && (here.gid !== gid || here.path !== path)) { SITE.back.push(here); SITE.forward = []; }
  SITE.path[gid] = path;
  S.full = false;
  if (S.gid === gid) { await loadGroup(); render(); } else await openGroup(gid);
  const sc = document.querySelector('[data-scroll^="page:"]');
  if (sc) sc.scrollTop = 0;
}
// Back or forward in the site's history of pages.
function siteStep(dir) {
  const from = dir < 0 ? SITE.back : SITE.forward, to = dir < 0 ? SITE.forward : SITE.back;
  const at = from.pop();
  if (!at) return;
  if (S.gid && S.data && S.data.site) to.push({ gid: S.gid, path: S.data.site.path });
  openPage(at.gid, at.path, "step");
}

// A site: its pages, the page shown, and the writers' tools.
function siteView(d) {
  const g = d.group, site = d.site || { pages: [] };
  if (site.error) return h("div", { class: "content" }, h("div", { class: "empty" }, h("h2", { text: "This site cannot be shown" }), h("p", { text: site.error })));
  const page = site.page, row = page ? fromRow(page.row) : null;
  if (row) markRead([row]);
  const list = h("nav", { class: "pagelist", "aria-label": "Pages" },
    h("h3", { class: "list-h", text: `pages · ${site.pages.length}` }),     // a quiet label, as in the sidebar
    site.pages.map(p => h("button", { class: "item" + (p.path === site.path ? " on" : ""), "aria-current": p.path === site.path ? "page" : null,
      onclick: () => openPage(g.id, p.path) },
      h("span", { class: "ic", text: p.home ? "⌂" : "·" }),
      h("span", { class: "nm" }, p.title, h("small", { class: "mono muted", text: " /" + p.path })))),
    site.may_write ? h("button", { class: "btn", onclick: () => openPageEditor(g, site, null) }, svg(ICON.plus, 16, 2.5), "New page") : null,
    publishPossible() ? h("button", { class: "btn", title: "Publish a folder of Markdown (and HTML) files as this site's pages",
      onclick: openPublishFolder }, "Publish a folder…") : null);
  return h("div", { class: "content site" }, list,
    h("article", { class: "page", "aria-label": "Page" },
      h("div", { class: "pagebar" },
        h("button", { class: "btn icon", "aria-label": "Back", title: "Back", disabled: !SITE.back.length, onclick: () => siteStep(-1) }, "←"),
        h("button", { class: "btn icon", "aria-label": "Forward", title: "Forward", disabled: !SITE.forward.length, onclick: () => siteStep(1) }, "→"),
        h("span", { class: "mono muted crumb", text: (site.title || site.label || "") + "  /" + (site.path || "") }),
        h("span", { class: "grow" }),
        page ? h("button", { class: "btn", onclick: () => copy(page.address, "The page's address is copied.") }, "Copy address") : null,
        page ? h("button", { class: "btn", title: "The same address as https://… on a web entrance",
          onclick: () => copyWeb(page.address, "page") }, "Copy web address") : null,
        page && site.may_write ? h("button", { class: "btn", onclick: () => openPageEditor(g, site, page) }, "Edit") : null,
        page && site.may_write && page.previous ? h("button", { class: "btn", title: "Publish the version before this one again (UN-RFC 0035 section 10.4)",
          onclick: () => pageAction(g, page, "restore") }, "Previous version") : null,
        page && site.may_write && !page.home ? h("button", { class: "btn", onclick: () => pageAction(g, page, "remove") }, "Remove") : null),
      h("div", { class: "scroll", "data-scroll": "page:" + g.id + ":" + (site.path || "") },
        page ? [
          // a page that begins with its own heading is not given a second one (its title
          // is in the list and the bar above); who wrote it and when goes below the page
          pageOwnTitle(row) ? null : h("h2", { text: page.title }),
          h("div", { class: "pbody" + (pageOwnTitle(row) ? " titled" : "") }, messageBody(row)),
          h("p", { class: "hint pmeta", text: [row.who, when(row.date), page.previous ? "edited" : ""].filter(Boolean).join(" · ") })] :
          h("div", { class: "empty" }, h("h2", { text: site.pages.length ? "Not here" : "No pages yet" }),
            h("p", { text: site.err || "" }),
            site.may_write && !site.pages.length ? h("button", { class: "btn primary", onclick: () => openPageEditor(g, site, null, site.home) }, "Write the home page") : null),
        pendingPages(g))));
}

// Whether a page starts with its own heading, so its title is not shown twice.
function pageOwnTitle(row) {
  const first = row && row.markdown && (row.tree || [])[0];
  return !!(first && first.t === "h" && first.n === 1);
}

// Pages on their way, shown until the node has them.
function pendingPages(g) {
  const pend = Object.entries(S.pending).filter(([, p]) => p.group === g.id && p.page);
  return pend.length ? h("div", { class: "pagepend" }, pend.map(([job, p]) => h("div", { class: "hint" },
    p.text + " ", p.state === "failed" ? [h("span", { class: "state bad", text: "Not done: " + (p.error || "") }), " ",
      h("button", { class: "link", onclick: () => retry(job) }, "Try again")] : pendingState(p)))) : null;
}

// Remove a page or publish its previous version again, after asking.
function pageAction(g, page, what) {
  const ask = what === "remove" ? `Remove the page "${page.title}"? Readers no longer see it; nodes keep the removal for a while.` :
    `Publish the version of "${page.title}" from ${when(page.previous.date)} by ${page.previous.who} again? It becomes the current one.`;
  S.dialog = { focus: ".dialog .btn", render: () => dialogShell({ label: what === "remove" ? "Remove page" : "Previous version" },
    h("div", { class: "dh" }, h("h2", { text: what === "remove" ? "Remove the page?" : "Go back to the previous version?" }),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db" }, h("p", { style: "margin:0", text: ask })),
    h("div", { class: "df btns" }, h("button", { class: "btn", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn " + (what === "remove" ? "danger" : "primary"), onclick: () => {
        closeDialog();
        if (what === "remove") SITE.path[g.id] = (S.data.site && S.data.site.home) || "index";
        doSend(`/api/groups/${encodeURIComponent(g.id)}/page`, g.id, { path: page.path, [what]: true },
          { text: (what === "remove" ? "Removing " : "Restoring ") + page.path, page: true });
        toast("Sending - postage takes a few seconds."); } }, what === "remove" ? "Remove" : "Publish it again"))) };
  render();
}

// Writing a page (section 9.2): Markdown kept as written, a preview from the core as
// readers will see it, pictures as on posts; a new version names the current one.
function openPageEditor(g, site, page, path = "") {
  const row = page ? page.row.message : null;
  const dialog = { focus: page ? "#ptext" : "#ppath", node: null, files: [] };
  const st = { preview: null, busy: false, err: "" };
  const field = (n) => dialog.node.querySelector(`[name="${n}"]`);
  const values = () => ({ path: (page ? page.path : field("path").value).trim().replace(/^\/+|\/+$/g, ""),
    title: field("title").value.trim(), text: field("text").value, markdown: field("markdown").checked });
  const showPreview = async () => {
    const v = values();
    try { st.preview = (await api("POST", `/api/groups/${encodeURIComponent(g.id)}/page`, { ...v, preview: true })).tree; st.err = ""; }
    catch (x) { st.err = x.message; }
    const box = dialog.node.querySelector(".ppreview");
    box.replaceChildren(st.err ? h("p", { class: "error", text: st.err }) : h("div", { class: "md" }, renderTree(st.preview || [])));
    box.hidden = false;
  };
  const go = async (e) => {
    e && e.preventDefault();
    const v = values();
    if (!/^[a-z0-9_.-]{1,64}(\/[a-z0-9_.-]{1,64}){0,7}$/.test(v.path)) { toast("A path is 1-8 parts of a-z, 0-9 and - _ . separated by /, such as about or projects/ovos."); return; }
    if (!v.text.trim()) { toast("Write the page first."); return; }
    if (!page && site.pages.some(p => p.path === v.path) &&
        !window.confirm(`There is a page ${v.path} already. Write a new version of it?`)) return;
    if (!page && site.pages.length >= site.max_pages && !site.pages.some(p => p.path === v.path) &&
        !window.confirm(`The site keeps at most ${site.max_pages} pages; a new one pushes the last out (UN-RFC 0035 section 9.2). Write it anyway?`)) return;
    const files = dialog.files.map(f => ({ name: f.name, data: f.data, alt: f.alt.trim() }));
    closeDialog();
    SITE.path[g.id] = v.path;
    await doSend(`/api/groups/${encodeURIComponent(g.id)}/page`, g.id, { ...v, ...(files.length ? { files } : {}) },
      { text: "Writing " + v.path, page: true });
    toast("Writing the page - postage takes a few seconds.");
  };
  dialog.node = dialogShell({ label: page ? "Edit page" : "New page", wide: true },
    h("div", { class: "dh" }, h("h2", { text: page ? `Edit /${page.path}` : "New page" }),
      h("button", { class: "btn primary dh-send", onclick: go }, "Publish"),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("form", { class: "db", onsubmit: go, onkeydown: (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") go(e); } },
      page ? null : [h("label", { for: "ppath", text: "Path" }),
        h("input", { id: "ppath", name: "path", class: "in mono", "data-k": "ppath", value: path, placeholder: "about, or projects/ovos", autocomplete: "off", spellcheck: "false" })],
      h("label", { for: "ptitle", text: "Title" }),
      h("input", { id: "ptitle", name: "title", class: "in", "data-k": "ptitle", value: page ? page.title : "", autocomplete: "off", maxlength: 128 }),
      h("div", { class: "label-row" }, h("label", { for: "ptext", text: "Text" }), emojiButton("ptext")),
      h("textarea", { id: "ptext", name: "text", class: "in compose-body mono", "data-k": "ptext", value: row ? row.text : "", spellcheck: "true" }),
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "markdown", checked: !row || isMd(row.content_type) }),
        " Markdown: # headings, *emphasis*, [links](about) to other pages of the site"),
      g.files ? filePicker(dialog, g, g.node_files !== false) : null,
      h("div", { class: "ppreview", hidden: true }),
      h("p", { class: "hint", style: "margin:0", text: "A page is public to everyone who reads the site. A new version replaces this one; the one before is kept a while." })),
    h("div", { class: "df btns" },
      h("button", { class: "btn", onclick: (e) => { e.preventDefault(); showPreview(); } }, "Preview"),
      h("span", { class: "grow" }),
      h("button", { class: "btn", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn primary", onclick: go }, "Publish", h("kbd", { text: "Ctrl S" }))));
  S.dialog = dialog;
  dialog.render = () => dialog.node;
  render();
}

// Your own site (UN-RFC 0035 section 7): only when you ask, after the warning.
async function openMySite() {
  let f;
  try { f = await api("GET", "/api/site"); } catch (x) { toast(x.message); return; }
  if (f.started && f.followed) { S.full = false; openGroup(f.id); return; }
  const st = { busy: false, err: "" };
  const draw = () => dialogShell({ label: "Start your site" },
    h("div", { class: "dh" }, h("h2", { text: "Start your site?" }),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db" },
      h("div", { class: "warnbox" }, f.warning.split("\n\n").map(t => h("p", { text: t }))),
      st.err ? h("p", { class: "error", text: st.err }) : null),
    h("div", { class: "df btns" }, h("span", { class: "mono muted", text: f.id }),
      h("button", { class: "btn", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn primary", disabled: st.busy, onclick: async () => {
        st.busy = true; st.err = ""; render();
        try { await api("POST", "/api/site", {}); }
        catch (x) { st.busy = false; st.err = x.message; render(); return; }
        closeDialog(); toast("Your site is started: write its home page.");
        await loadSidebar(); S.full = false; openGroup(f.id); } }, st.busy ? "Starting …" : "Start my site")));
  S.dialog = { focus: ".dialog .btn", render: draw };
  render();
}
