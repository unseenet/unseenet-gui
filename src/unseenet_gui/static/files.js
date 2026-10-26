// files.js - files on posts (UN-RFC 0027, UN-RFC 0046 section 4.10).
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- files on posts (UN-RFC 0027, UN-RFC 0046 section 4.10) -------------------
// The page never gets anything from the network the core has not checked: a picture
// comes as the core's own copy, decoded and saved again in a separate process, and a
// file to save comes checked against its blob ID - and is never opened from here.
let RENDERING = null;                          // the post whose text is being drawn
const PICS = new Map();                        // "group blob" -> {state, pic, error, why}
const ASKED = new Set();                       // pictures by ignored people you chose to see
const SHOWN = /^image\/(png|jpeg|gif|webp)$/;

// A picture a post carries, fetched through the core and decoded safely; asked for once per
// page.
function picture(gid, blob) {
  const k = gid + " " + blob, asked = ASKED.has(k);
  let p = PICS.get(k);
  if (!p || (asked && p.why === "ignored")) {
    p = { state: "loading" };
    PICS.set(k, p);
    api("GET", `/api/groups/${encodeURIComponent(gid)}/files/${encodeURIComponent(blob)}` + (asked ? "?asked=1" : ""))
      .then(pic => { PICS.set(k, { state: "ok", pic }); render(); })
      .catch(err => {
        PICS.set(k, { state: "err", error: err.message, why: err.why });
        if (err.why === "later") setTimeout(() => { PICS.delete(k); render(); }, 8000);   // the node is fetching it
        render();
      });
  }
  return p;
}

// A file's size for people: KB or MB.
function size(octets) {
  return octets >= 1048576 ? (octets / 1048576).toFixed(1) + " MB" : octets >= 1024 ? Math.round(octets / 1024) + " KB" : octets + " bytes";
}

// The files of a post not already drawn in its text.
function filesOf(m, chat) {
  const inline = new Set();
  (function walk(nodes) { (nodes || []).forEach(n => { if (n.t === "image" && n.blob) inline.add(n.blob); walk(n.c); (n.items || []).forEach(walk); }); })(m.markdown ? m.tree : []);
  const rest = (m.attachments || []).filter(a => !inline.has(a.blob));
  return rest.length ? h("div", { class: "files" + (chat ? " in-chat" : "") }, rest.map(a => fileView(m, a, false))) : null;
}

// A file on a post: the picture shown, or its name and size with a Save button.
function fileView(m, a, inline) {
  const what = a.alt || a.name || "a picture";
  if (SHOWN.test(a.type)) {
    const p = picture(m.group, a.blob);
    const box = (cls, ...kids) => h("span", { class: "pic " + cls + (inline ? " inline" : ""),
      style: a.dim ? `aspect-ratio:${a.dim[0]}/${a.dim[1]};max-width:min(100%,${a.dim[0]}px)` : null }, ...kids);
    if (p.state === "ok") {
      return h("figure", { class: "pic" + (inline ? " inline" : "") },
        h("img", { src: p.pic.data, alt: what, width: p.pic.width, height: p.pic.height, title: a.name || "" }),
        a.alt && !inline ? h("figcaption", { text: a.alt }) : null);
    }
    if (p.state === "loading") return box("wait", h("span", { class: "hint", text: "Fetching " + what + " …" }));
    if (p.why === "ignored") {
      return box("off", h("span", { class: "hint", text: "A picture by someone you ignore." }),
        h("button", { class: "link", onclick: () => { ASKED.add(m.group + " " + a.blob); render(); } }, "Show it"));
    }
    return box("off", h("span", { class: "hint", text: (a.alt ? `[${a.alt}] ` : "") + (p.error || "Not shown.") }),
      p.why === "not_shown" ? h("button", { class: "link", onclick: () => saveFile(m, a) }, "Save it") : null);
  }
  return h("span", { class: "file" + (inline ? " inline" : "") },
    h("span", { class: "fname mono", text: a.name || "file" }),
    h("span", { class: "hint", text: " " + a.type + " · " + size(a.size) }),
    a.alt ? h("span", { class: "falt", text: a.alt }) : null,
    h("button", { class: "btn", onclick: () => saveFile(m, a) }, "Save"));
}

// Save a file as it came, checked. The core writes it in Downloads; in a browser the
// browser saves it. Never opened: another program runs outside Unseenet and Tor.
function saveFile(m, a) {
  confirmDialog({ title: "Save " + (a.name || "the file") + "?", button: "Save",
    text: `${a.name || "The file"} (${a.type}, ${size(a.size)}) is saved as it came, checked against what the post names.\n\n` +
      "Unseenet does not open it. If you open it in another program, that program runs outside Unseenet and may go to the internet without Tor.",
    ok: async () => {
      closeDialog();
      try {
        if (GUI && GUI.web) {
          const f = await api("GET", `/api/groups/${encodeURIComponent(m.group)}/files/${encodeURIComponent(a.blob)}?save=1`);
          const link = h("a", { href: `data:application/octet-stream;base64,${f.data}`, download: f.name });
          document.body.append(link); link.click(); link.remove();
          toast("Saved: " + f.name);
        } else {
          const r = await api("POST", "/x/gui/save", { group: m.group, blob: a.blob });
          toast("Saved in " + r.path);
        }
      } catch (err) { toast(err.message); }
    } });
}

// Read chosen files as base64 for the local API, at most four and within ``max`` each.
async function readFiles(fileList, into, max) {
  for (const file of Array.from(fileList)) {
    if (into.length >= 4) { toast("At most four files on a post."); break; }
    if (max && file.size > max) { toast(`${file.name} is ${size(file.size)}; this group takes files up to ${size(max)}.`); continue; }
    const data = await new Promise((ok, bad) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(",", 2)[1] || ""); r.onerror = bad;
      r.readAsDataURL(file);
    });
    into.push({ name: file.name, size: file.size, type: file.type, data, alt: "" });
  }
}

// What files a group takes, as the core's FILE_CHOICES names them (#102, unseenet#496).
function fileChoice(files) {
  if (!files) return "none";
  const types = [...(files.types || [])].sort().join(",");
  if (files.max_size !== 4194304) return "custom";
  return types === "image/*" ? "pictures" : types === "application/pdf,image/*" ? "pictures+pdf" : "custom";
}
const FILE_PICKS = [["none", "No files", "text only"], ["pictures", "Pictures", "up to 4 MiB each"],
  ["pictures+pdf", "Pictures and PDFs", "up to 4 MiB each"]];

// Choosing files for a post: at most four, with a description each. The core saves
// pictures again without their metadata (GPS, time, camera) before they are sent.
function filePicker(dialog, g, carries) {
  if (!carries) return h("p", { class: "hint", style: "margin:0",
    text: "This group takes pictures and files, but your node does not carry them." });
  const max = g.files.max_size || 0, list = h("div", { class: "picklist" });
  const draw = () => list.replaceChildren(...dialog.files.map((f, i) => h("div", { class: "pick" },
    h("span", { class: "fname mono", text: f.name }), h("span", { class: "hint", text: size(f.size) }),
    h("input", { class: "in", placeholder: "Describe it for people who cannot see it", value: f.alt, maxlength: 400,
      "aria-label": "Description of " + f.name, oninput: (e) => { f.alt = e.target.value; } }),
    h("button", { type: "button", class: "btn icon", "aria-label": "Remove " + f.name,
      onclick: () => { dialog.files.splice(i, 1); draw(); } }, svg(ICON.x)))));
  const input = h("input", { type: "file", multiple: true, class: "sr", id: "cfiles",
    accept: (g.files.types || []).length ? g.files.types.join(",") : "image/*,application/pdf",
    onchange: async (e) => {
      await readFiles(e.target.files, dialog.files, max);
      e.target.value = "";
      draw();
    } });
  draw();
  return h("div", { class: "attach" },
    h("label", { for: "cfiles", class: "btn" }, "Add pictures or files"), input,
    h("span", { class: "hint", text: " Pictures are saved again without where and when they were taken." + (max ? ` Up to ${size(max)} each.` : "") }),
    list);
}
