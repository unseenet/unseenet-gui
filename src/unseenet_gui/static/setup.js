// setup.js - unlocking the vault and setting up a first identity.
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- unlock and setup -----------------------------------------------------
function unlockScreen() {
  const st = S.state, isNew = !st.vault_exists;
  // a PIN on this device (#145): which passkeys may open it, asked once
  if (!isNew && S.pinDevices === undefined && devicePinPossible()) {
    S.pinDevices = null;
    devicePinList().then(d => { S.pinDevices = d.devices || []; render(); });
  }
  const pins = !isNew && devicePinPossible() && S.pinDevices && S.pinDevices.length ? S.pinDevices : null;
  const submit = async (e) => {
    e.preventDefault();
    const f = e.target, pass = f.pass.value;
    if (isNew && pass !== f.again.value) { S.error = "The two passphrases are not the same."; render(); return; }
    if (isNew && pass.length < 8) { S.error = "Use at least 8 characters - a few words is best."; render(); return; }
    S.busy = true; S.error = ""; render();
    try { await loadState(await api("POST", "/api/unlock", { passphrase: pass })); await afterUnlock(); }
    catch (err) { S.error = /wrong|decrypt|passphrase|invalid/i.test(err.message) ? "Wrong passphrase." : err.message; }
    S.busy = false; render();
  };
  return h("div", { class: "unlock" }, h("div", { class: "unlock-box" },
    st.bootable ? systemBar() : null,
    brandHead(isNew ? "A new vault." : "Welcome back.",
      ["Vault: ", h("b", { text: st.vault })]),
    h("form", { class: "form", onsubmit: submit },
      h("label", { for: "pass", text: isNew ? "Choose a passphrase" : "Passphrase" }),
      h("input", { id: "pass", name: "pass", type: "password", class: "field", autocomplete: "current-password",
        autofocus: true, "data-k": "pass", required: true }),
      isNew ? [h("label", { for: "again", text: "The same again" }),
        h("input", { id: "again", name: "again", type: "password", class: "field", "data-k": "again", required: true })] : null,
      h("div", { class: "error", role: "alert", text: S.error }),
      h("button", { class: "btn primary", type: "submit", disabled: S.busy },
        S.busy ? "Unlocking …" : isNew ? "Create vault" : "Unlock"),
      pins ? h("button", { class: "btn", type: "button", "data-k": "pin-unlock", disabled: S.busy,
        onclick: () => unlockWithDevicePin(pins) }, "Unlock with this device's PIN") : null),
    isNew ? h("p", { class: "hint", text: "Your keys, groups and saved posts are kept in this one file, " +
      "encrypted with the passphrase. Lose both, and they are gone - nobody can reset it." }) : null,
    S.state.web ? h("div", { class: "statuscard" },
      h("div", { text: "Your keys stay in this browser: it signs, encrypts and checks signatures here." }),
      h("div", { class: "muted", text: "A web entrance carries the connection to a node over Tor. The entrance sees your IP address " +
        "(unless this is Tor Browser); the nodes do not. The vault is only kept here if you choose so in the bar at the top." }))
    : h("div", { class: "statuscard" },
      h("div", { text: "Tor starts when the vault is open." }),
      h("div", { class: "muted", text: "Nothing leaves this computer except through Tor. The window loads nothing from the internet." })),
    h("p", { class: "note" }, h("strong", { text: "Pre-alpha. " }),
      "The code has not had a security review. Do not rely on it to protect anyone yet. ",
      h("button", { class: "link", type: "button", onclick: openAbout }, "What is Unseenet?"))));
}
