// Publish a folder as a site (#125, on the core's site import, unseenet#538): pick a
// folder -> what would be sent (new / changed / unchanged / removed pages, and every
// change made on the way) -> Publish, sending only what changed. The browser gives
// files, not a path, so the GUI server puts them in a fresh folder first. Not in the
// browser build. Uses app.js's helpers: h, api, toast, S, render, dialogShell,
// closeDialog, TOKEN.
"use strict";

const PUBLISH_MARK = { new: "+", changed: "~", unchanged: "=", remove: "−", kept: "·" };
const PUBLISH_WORD = { new: "new", changed: "changed", unchanged: "unchanged", remove: "removed",
  kept: "not in the folder - kept" };

function publishPossible() {
  return !(S.state && S.state.web) && S.data && S.data.site && S.data.site.may_write;
}

function openPublishFolder() {
  if (!publishPossible()) return;
  const g = S.data.group;
  const input = h("input", { type: "file", style: "display:none" });
  input.setAttribute("webkitdirectory", "");
  input.multiple = true;
  input.onchange = () => { if (input.files.length) uploadFolder(g, input.files); input.remove(); };
  document.body.append(input);
  input.click();
}

async function uploadFolder(g, files) {
  const form = new FormData();
  for (const f of files) {
    // "my-site/guide/start.md" -> "guide/start.md": the folder itself is the site
    const rel = (f.webkitRelativePath || f.name).split("/").slice(1).join("/") || f.name;
    form.append(rel, f, rel);
  }
  let up;
  try {
    const r = await fetch("/x/gui/site-folder", { method: "POST", body: form,
      headers: { "X-Unseenet-Token": TOKEN || "" } });
    up = await r.json();
    if (!r.ok) throw new Error(up.error || r.statusText);
  } catch (x) { toast("Could not read the folder: " + x.message); return; }
  S.publish = { g, folder: up.folder, prune: false, plan: null, busy: true };
  showPublish();
  await planPublish();
}

async function planPublish() {
  const p = S.publish;
  p.busy = true; render();
  try {
    p.plan = await api("POST", `/api/groups/${encodeURIComponent(p.g.id)}/site`,
      { folder: p.folder, prune: p.prune, dry_run: true });
  } catch (x) { p.plan = { changes: [], notes: [], problems: [x.message], sent: 0 }; }
  p.busy = false; render();
}

function showPublish() {
  S.dialog = { focus: ".dialog .btn.primary", render: () => {
    const p = S.publish, plan = p.plan;
    const todo = plan ? plan.changes.filter(c => ["new", "changed", "remove"].includes(c.action)).length : 0;
    const publish = async () => {
      const job = await api("POST", `/api/groups/${encodeURIComponent(p.g.id)}/site`,
        { folder: p.folder, prune: p.prune, dry_run: false });
      closeDialog();
      toast(`Sending ${todo} page${todo === 1 ? "" : "s"} - the site shows them when they are in.`);
      S.publishJob = job.job;
    };
    return dialogShell({ label: "Publish a folder", wide: true },
      h("div", { class: "dh" }, h("h2", { text: `Publish a folder as ${p.g.label || "this site"}` })),
      h("div", { class: "db" },
        !plan ? h("p", { class: "hint", text: "Reading the folder…" }) : [
          plan.problems.length ? h("div", { class: "warn" }, h("b", { text: "Nothing can be sent yet:" }),
            h("ul", {}, plan.problems.map(t => h("li", { text: t })))) : null,
          h("table", { class: "publish" },
            h("tbody", {}, plan.changes.map(c => h("tr", { class: c.action },
              h("td", { class: "mono", text: PUBLISH_MARK[c.action] || "" }),
              h("td", { class: "mono", text: "/" + c.path }),
              h("td", { text: c.title }),
              h("td", { class: "hint", text: PUBLISH_WORD[c.action] + (c.files.length ? ` · ${c.files.length} picture${c.files.length === 1 ? "" : "s"}` : "") }))))),
          plan.notes.length ? h("details", {},
            h("summary", { text: `${plan.notes.length} change${plan.notes.length === 1 ? "" : "s"} made on the way` }),
            h("ul", { class: "notes" }, plan.notes.map(t => h("li", { class: "mono", text: t })))) : null,
          h("label", { class: "check" },
            h("input", { type: "checkbox", checked: p.prune, onchange: e => { p.prune = e.target.checked; planPublish(); } }),
            " Remove pages that are no longer in the folder"),
          h("p", { class: "hint", style: "margin:0", text: "Only what changed is sent: an edited page gets a new version, and the earlier one can be published again." })]),
      h("div", { class: "df btns" },
        h("button", { class: "btn", onclick: closeDialog }, "Cancel"),
        h("button", { class: "btn primary", disabled: !plan || p.busy || !!plan.problems.length || !todo, onclick: publish },
          todo ? `Publish ${todo} page${todo === 1 ? "" : "s"}` : "Nothing to send")));
  } };
  render();
}
