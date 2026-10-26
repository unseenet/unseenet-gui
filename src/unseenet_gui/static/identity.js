// Recovery words and copying to another device (UN-RFC 0050, unseenet-gui#142).
// The protocol, the words and the vault work are the core's (local API sections 4.18,
// 4.19); these are the screens. Uses app.js's helpers: h, api, toast, S, GUI, render,
// dialogShell, closeDialog, svg, ICON, loadState, afterUnlock.
"use strict";

const NOT_RESTORED = "Closed groups do not come back with recovery words: their owners must invite you again.";
const NOT_A_WALLET = "These are Unseenet recovery words, not a cryptocurrency wallet phrase: never type them into a wallet.";

// A dialog's heading with a close button.
function dialogHead(title) {
  return h("div", { class: "dh" }, h("h2", { text: title }),
    h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x)));
}

// The 24 recovery words as a numbered grid.
function wordsGrid(words) {
  return h("ol", { class: "words" }, words.map(w => h("li", { class: "mono", text: w })));
}

// ---- showing the words (section 4.2) ---------------------------------------------------
// Behind the passphrase every time, also with the vault open. ``first``: right after a
// new identity - "Later" then means a reminder in a week.
function openShowWords(first = false) {
  formDialog({ label: "Recovery words", title: first ? "Write down your recovery words" : "Show recovery words",
    focus: "#rwpw", button: "Show",
    note: first ? "24 words that bring this identity back on any device if you lose this one. Type your passphrase to see them." :
      "The words are your key, so the passphrase is asked for again.",
    fields: (vals) => [h("label", { for: "rwpw", text: "Passphrase" }),
      h("input", { id: "rwpw", name: "pw", type: "password", class: "in", "data-k": "rwpw", autocomplete: "current-password", value: vals.pw || "" })],
    submit: async (v) => {
      const r = await api("POST", "/api/recovery/words", { passphrase: v.pw || "" });
      showWords(r, v.pw || "", first);
    } });
}

// The recovery words on screen (UN-RFC 0050 4.2), with save and print where this machine
// allows it, then the check.
function showWords(r, passphrase, first) {
  const canSave = !(S.state.bootable || S.state.web);
  const canPrint = !S.state.bootable;
  const later = async () => { closeDialog(); if (first) await api("POST", "/api/recovery/reminded", {}).catch(() => {}); };
  S.dialog = { focus: ".dialog .btn.primary", render: () => dialogShell({ label: "Your recovery words", wide: true },
    dialogHead("Your recovery words"),
    h("div", { class: "db" },
      h("p", { class: "hint mono", style: "margin:0", text: `${S.state.me ? S.state.me.display : r.identity} · ${r.fingerprint}` }),
      wordsGrid(r.words),
      h("p", { style: "margin:0", text: "They bring this identity back on any device, with your groups, contacts and settings from the network. " +
        "Whoever has them is you: write them on paper and keep it safe, away from this computer." }),
      h("p", { class: "warn", style: "margin:0", text: r.note || NOT_RESTORED }),
      h("p", { class: "hint", style: "margin:0", text: r.not_a_wallet || NOT_A_WALLET })),
    h("div", { class: "df btns" },
      h("button", { class: "btn", onclick: later }, first ? "Later" : "Close"),
      canPrint ? h("button", { class: "btn", onclick: () => printWords(r) }, "Print …") : null,
      canSave ? h("button", { class: "btn", onclick: () => saveWords(passphrase) }, "Save as file …") : null,
      h("button", { class: "btn primary", onclick: () => checkWords(r) }, "I wrote them down"))) };
  render();
}

// Ask for three of the words, so the person knows they wrote them down right (UN-RFC 0050
// 4.2).
function checkWords(r) {
  const pos = r.check || [3, 11, 19];
  formDialog({ label: "Check your recovery words", title: "Check your recovery words", focus: `#cw${pos[0]}`, button: "Check",
    note: "From what you wrote down. Four letters of each are enough.",
    fields: (vals) => pos.map(p => [h("label", { for: `cw${p}`, text: `Word ${p}` }),
      h("input", { id: `cw${p}`, name: `w${p}`, class: "in mono", "data-k": `cw${p}`, autocomplete: "off", spellcheck: "false", value: vals[`w${p}`] || "" })]),
    submit: async (v) => {
      const wrong = pos.filter(p => {
        const t = (v[`w${p}`] || "").trim().toLowerCase(), want = r.words[p - 1];
        return !(t === want || (t.length >= 4 && want.startsWith(t.slice(0, 4))));
      });
      if (wrong.length) throw new Error(`Word ${wrong.join(", ")} does not match. Look at what you wrote.`);
      await api("POST", "/api/recovery/written", {});
      closeDialog();
      await loadState();
      toast("Your recovery words are written down.");
    } });
}

// A warning to read before something risky with the words; then runs the action.
function confirmDanger(text, then) {
  S.dialog = { focus: ".dialog .btn", render: () => dialogShell({ label: "Be careful" },
    dialogHead("Be careful"),
    h("div", { class: "db" }, h("p", { class: "warn", style: "margin:0", text })),
    h("div", { class: "df btns" }, h("button", { class: "btn", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn danger", onclick: then }, "I understand, go on"))) };
  render();
}

// Save the words as a file in Downloads, after the warning; the GUI server refuses the
// vault's own disk and cloud folders.
async function saveWords(passphrase) {
  const back = S.dialog;
  confirmDanger("Whoever has this file is you: they can read your private posts and post in your name. Paper is safer. " +
    "It goes to your Downloads folder - never keep it on the same stick or disk as the vault, and not in a cloud folder.", async () => {
    try {
      const r = await api("POST", "/x/gui/save-words", { passphrase });
      S.dialog = back; render();
      toast("Saved in " + r.path + ". Keep it safe, or delete it once written on paper.");
    } catch (err) { S.dialog = back; render(); toast(err.message); }
  });
}

// Print the words, after the warning; the page prints only the words.
async function printWords(r) {
  const back = S.dialog;
  confirmDanger("Whoever has the printed page is you. Print it on a printer you trust, and keep the page safe, away from this computer.", () => {
    const sheet = h("div", { class: "print-sheet" },
      h("h1", { text: "Unseenet recovery words" }),
      h("p", { class: "mono", text: `${S.state.me ? S.state.me.display : r.identity} · ${r.fingerprint}` }),
      wordsGrid(r.words),
      h("p", { text: "Whoever has these words IS this identity. Keep this page safe, away from the vault." }),
      h("p", { text: "To restore: in an Unseenet client choose \"Restore from recovery words\" and type the words. " +
        "Your groups, contacts and settings come back from the network." }),
      h("p", { text: NOT_RESTORED }), h("p", { text: NOT_A_WALLET }));
    document.body.append(sheet);
    const done = () => { sheet.remove(); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    S.dialog = back; render();
    window.print();
    setTimeout(done, 60000);          // where afterprint never comes
  });
}

// the gentle reminder (4.2): at most once a week, until written down
async function wordsReminder() {
  if (!S.state.identity || !S.state.identity.words_reminder) return;
  try { await api("POST", "/api/recovery/reminded", {}); } catch (_) { return; }
  toast("Your recovery words are not written down yet - they bring your identity back if this computer is lost. Menu: Show recovery words.");
}

// ---- restoring (section 4.4) -------------------------------------------------------------
let wordsCheckTimer = null;
// As the words are typed: say how many are known, and which are not, a moment after typing
// stops.
function wordsChecker(area, out) {
  clearTimeout(wordsCheckTimer);
  wordsCheckTimer = setTimeout(async () => {
    const n = area.value.trim() ? area.value.trim().split(/[\s,.;:()\-]+/).filter(w => w && !/^\d+$/.test(w)).length : 0;
    if (n < 24) { out.textContent = `${n} of 24 words`; return; }
    try {
      const r = await api("POST", "/api/recovery/check", { words: area.value });
      out.textContent = r.ok ? "The words fit together." : r.error;
    } catch (err) { out.textContent = err.message; }
  }, 250);
}

// The fields of restoring from words: the words, checked as typed, and a display name.
function restoreFields(vals) {
  const out = h("p", { class: "hint", role: "status", style: "margin:0", text: "" });
  const area = h("textarea", { id: "rwords", name: "words", class: "in mono", "data-k": "rwords", rows: 5, autocomplete: "off",
    spellcheck: "false", autocapitalize: "off", value: vals.words || "", placeholder: "word1 word2 … word24",
    oninput: (e) => wordsChecker(e.target, out) });
  return [h("label", { for: "rwords", text: "Your 24 recovery words, in order" }), area, out,
    h("label", { for: "rdisplay", text: "Your name (optional)" }),
    h("input", { id: "rdisplay", name: "display", class: "in", "data-k": "rdisplay", value: vals.display || "" }),
    h("p", { class: "hint", style: "margin:0", text: NOT_RESTORED })];
}

// Restore an identity from its recovery words (UN-RFC 0050 3.5).
function openRestore() {
  formDialog({ label: "Restore from recovery words", title: "Restore from recovery words", focus: "#rwords", button: "Restore",
    note: "Four letters of each word are enough. The identity becomes your default.",
    fields: restoreFields,
    submit: async (v) => { await afterRestore(await api("POST", "/api/recovery/restore", { words: v.words || "", display: v.display || "" })); } });
}

// After restoring: what came back from the network, and closed groups to ask to be invited
// to again.
async function afterRestore(r) {
  await loadState();
  const lead = { read: "Your groups, contacts and settings came back from the network.",
    none: "Nothing was found in the network for this identity: you start with the default groups.",
    unreachable: "The network could not be reached; your groups come back once it can be." }[r.state] || "";
  const groups = r.closed_groups || [];
  const ask = new Set(groups.filter(g => !g.mine).map(g => g.group));
  const send = async () => {
    let n = 0;
    for (const gid of ask) {
      try { await api("POST", "/api/recovery/ask", { group: gid }); n++; } catch (err) { toast(err.message); }
    }
    closeDialog();
    if (n) toast(`Asked ${n} owner(s) to invite you again.`);
  };
  S.dialog = { focus: ".dialog .btn.primary", render: () => dialogShell({ label: "Your identity is back" },
    dialogHead("Your identity is back"),
    h("div", { class: "db" },
      h("p", { style: "margin:0", text: lead }),
      h("p", { class: "warn", style: "margin:0", text: NOT_RESTORED }),
      groups.length ? h("div", { class: "choices" }, groups.map(g => h("label", { class: "check" },
        h("input", { type: "checkbox", checked: ask.has(g.group), disabled: g.mine,
          onchange: (e) => { if (e.target.checked) ask.add(g.group); else ask.delete(g.group); } }),
        h("span", { text: g.label + (g.mine ? " (yours: make a new group key)" : "") })))) : null),
    h("div", { class: "df btns" }, h("button", { class: "btn", onclick: closeDialog }, "Close"),
      groups.length ? h("button", { class: "btn primary", onclick: send }, "Ask the owners to invite me") : null)) };
  render();
  await afterUnlock();
}

// ---- copying (section 3) -----------------------------------------------------------------
let copyDialog = null;            // the offer on screen, told by "copy" events

// SVG markup from the GUI server (a QR code) as an element on the page.
function svgNode(markup) {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  const el = document.importNode(doc.documentElement, true);
  el.setAttribute("class", "qr");
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", "QR code");
  return el;
}

// Copy an identity to another device (UN-RFC 0050 3.6): choose which, then the code and QR
// code to type or scan there.
function openCopyTo() {
  if (S.state.web) { toast("A browser cannot copy to another device; it can receive a copy."); return; }
  const ids = GUI.identities || [];
  const chosen = new Set(ids.map(i => i.name));
  let secrets = true;
  S.dialog = { focus: ".dialog .btn.primary", render: () => dialogShell({ label: "Copy to another device" },
    dialogHead("Copy to another device"),
    h("div", { class: "db" },
      h("p", { style: "margin:0", text: "Your identities go straight to the other device over Tor, after you check two words on both. " +
        "A phone is lost more often than a computer: leave out an identity that needs to stay hidden." }),
      ids.length > 1 ? h("div", { class: "choices" }, ids.map(i => h("label", { class: "check" },
        h("input", { type: "checkbox", checked: chosen.has(i.name), onchange: (e) => { if (e.target.checked) chosen.add(i.name); else chosen.delete(i.name); } }),
        h("span", { text: `${i.display} (${i.name})` })))) : null,
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: secrets, onchange: (e) => { secrets = e.target.checked; } }),
        h("span", { text: "Also the keys of closed groups (without them the other device cannot read them)" }))),
    h("div", { class: "df btns" }, h("button", { class: "btn", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn primary", onclick: async () => {
        if (!chosen.size) { toast("Choose at least one identity."); return; }
        try {
          toast("Opening a one-time onion service …");
          const offer = await api("POST", "/api/copy/offer", { identities: [...chosen], group_secrets: secrets });
          await showOffer(offer);
        } catch (err) { toast(err.message); }
      } }, "Show the code"))) };
  render();
}

// The code and QR code of a copy in progress, the check words when the other device
// connects, and Confirm.
async function showOffer(offer) {
  let qr = null;
  try { qr = svgNode((await api("POST", "/x/gui/qr", { text: offer.qr })).svg); } catch (_) { /* the code is enough */ }
  const state = { check: null, timer: null };
  const left = () => { const s = Math.max(0, Math.round(offer.expires - Date.now() / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const cancel = async () => { clearInterval(state.timer); copyDialog = null; closeDialog(); await api("POST", "/api/copy/cancel", {}).catch(() => {}); };
  const answer = async (match) => {
    clearInterval(state.timer);
    try {
      const r = await api("POST", "/api/copy/confirm", { match });
      copyDialog = null; closeDialog();
      toast(r.state === "done" ? "Copied" + (r.added && r.added.length ? ": " + r.added.join(", ") : " - the other device had it already.") :
        (r.error || "The copy " + r.state + "."));
    } catch (err) { copyDialog = null; closeDialog(); toast(err.message); }
  };
  const dialog = { focus: ".dialog .btn", render: () => dialogShell({ label: "Copy to another device" },
    dialogHead("Copy to another device"),
    h("div", { class: "db copy" },
      state.check ? [
        h("p", { style: "margin:0", text: "Check words:" }),
        h("p", { class: "checkwords mono", text: state.check.join("   ") }),
        h("p", { style: "margin:0", text: "Does the other device show the same two words? Nothing is sent until you say so." })] : [
        h("p", { style: "margin:0", text: "On the other device choose \"Get identity from another device\", then scan this or type the code:" }),
        qr, h("p", { class: "code mono", text: offer.code }),
        h("p", { class: "hint", id: "copyleft", style: "margin:0", text: `The code works once, for ${left()} more.` })]),
    h("div", { class: "df btns" },
      h("button", { class: "btn", onclick: cancel }, "Cancel"),
      state.check ? h("button", { class: "btn", onclick: () => answer(false) }, "They do not match") : null,
      state.check ? h("button", { class: "btn primary", onclick: () => answer(true) }, "The words match") : null)) };
  dialog.state = state;
  copyDialog = dialog;
  S.dialog = dialog;
  render();
  state.timer = setInterval(() => { const el = document.getElementById("copyleft"); if (el) el.textContent = `The code works once, for ${left()} more.`; }, 1000);
}

// "copy" events from the runtime (UN-RFC 0046 section 4.19)
function copyEvent(e) {
  if (e.role !== "old" || !copyDialog) return;
  if (e.state === "check") {
    copyDialog.state.check = e.check_words;
    if (S.dialog === copyDialog) render();
  } else if (["failed", "expired"].includes(e.state)) {
    clearInterval(copyDialog.state.timer);
    if (S.dialog === copyDialog) closeDialog();
    copyDialog = null;
    toast(e.error || "The copy " + e.state + ".");
  }
}

// ---- receiving a copy (the new device) ---------------------------------------------------
function scanSupported() {
  return "BarcodeDetector" in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
}

// Scan a QR code with the camera into the code field, where the browser can.
async function scanInto(input) {
  let stream;
  try {
    const det = new BarcodeDetector({ formats: ["qr_code"] });
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const video = h("video", { class: "scan", autoplay: true, muted: true, playsinline: true });
    video.srcObject = stream;
    input.closest("form").prepend(video);
    for (let i = 0; i < 600; i++) {               // about a minute
      await new Promise(r => setTimeout(r, 100));
      const found = video.readyState >= 2 ? await det.detect(video) : [];
      const hit = found.find(c => (c.rawValue || "").startsWith("unseenet-copy:"));
      if (hit) { input.value = hit.rawValue; input.dispatchEvent(new Event("input", { bubbles: true })); break; }
    }
    video.remove();
  } catch (err) { toast("The camera could not be used: " + err.message); }
  finally { if (stream) stream.getTracks().forEach(t => t.stop()); }
}

// The field for a copy's code, with a scan button where there is a camera.
function codeFields(vals) {
  const input = h("input", { id: "ccode", name: "code", class: "in mono", "data-k": "ccode", autocomplete: "off", spellcheck: "false",
    autocapitalize: "off", placeholder: "7-guitar-tunnel", value: vals.code || "" });
  return [h("label", { for: "ccode", text: "The code the other device shows" }), input,
    scanSupported() ? h("button", { type: "button", class: "btn", onclick: () => scanInto(input) }, "Scan the QR code") : null];
}

// Connect with a code from another device, then compare the check words before the identity
// is taken.
async function receiveCopy(code, node) {
  const got = await api("POST", "/api/copy/receive", { code, node: node || "" });
  S.dialog = { focus: ".dialog .btn", render: () => dialogShell({ label: "Check words" },
    dialogHead("Check words"),
    h("div", { class: "db" }, h("p", { class: "checkwords mono", text: got.check_words.join("   ") }),
      h("p", { style: "margin:0", text: "Confirm on the other device that it shows the same two words. Waiting for it …" })),
    h("div", { class: "df btns" }, h("button", { class: "btn", onclick: async () => { closeDialog(); await api("POST", "/api/copy/cancel", {}).catch(() => {}); } }, "Cancel"))) };
  render();
  const done = await api("POST", "/api/copy/finish", {});
  closeDialog();
  return done;
}

// Get an identity from another device (UN-RFC 0050 3.6) with the code it shows.
function openCopyFrom() {
  formDialog({ label: "Get identity from another device", title: "Get identity from another device", focus: "#ccode", button: "Connect",
    note: "On the other device choose \"Copy to another device\". The code works once, for 10 minutes.",
    fields: codeFields,
    submit: async (v) => {
      toast("Connecting to the other device over Tor …");
      const done = await receiveCopy((v.code || "").trim());
      await loadState();
      toast("Got " + (done.added.length ? done.added.join(", ") : "nothing new") + " from the other device.");
      await afterUnlock();
    } });
}

// ---- first start: create, restore or copy ------------------------------------------------
function setupHowChoice() {
  const how = S.setupHow || "new";
  const pick = (v) => () => { S.setupHow = v; S.error = ""; render(); };
  return h("div", { class: "howpicks", role: "group", "aria-label": "Your identity" }, [["new", "Create a new identity"], ["restore", "Restore from recovery words"],
    ["copy", "Get it from another device"]].map(([v, t]) => h("button", { type: "button", class: "howpick", "aria-pressed": String(how === v), onclick: pick(v) },
    h("span", { text: t }))));
}

// The first-start fields for the way chosen: a new identity, restore from words, or copy
// from another device.
function setupHowFields() {
  const how = S.setupHow || "new";
  if (how === "restore") return restoreFields(S.setupVals || {});
  if (how === "copy") return codeFields(S.setupVals || {});
  return null;
}

// the setup's submit for "restore" and "copy"; true when it was one of those
async function setupOther(f, node) {
  const how = S.setupHow || "new";
  if (how === "new") return false;
  if (how === "restore") {
    const r = await api("POST", "/api/recovery/restore", { words: f.words.value, display: f.display.value, node });
    await afterRestore(r);
  } else {
    const done = await receiveCopy(f.code.value.trim(), node);
    await loadState();
    toast("Got " + (done.added.length ? done.added.join(", ") : "nothing new") + " from the other device.");
    await afterUnlock();
  }
  return true;
}
