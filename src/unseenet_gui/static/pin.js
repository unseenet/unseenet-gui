// pin.js - unlocking with a PIN on this device (#145, UN-RFC 0050 section 5).
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
//
// A PIN is too short to protect a file. So it is never the vault's key: a passkey is,
// with the WebAuthn PRF extension - the device's secure hardware gives its secret only
// after the PIN or the device's own unlock, and limits guesses. The core wraps the vault
// key with that secret, beside the vault; the passphrase keeps working everywhere. Not
// on a stick or the bootable client: there, the passphrase only.
"use strict";

// The same salt every time, so the passkey gives the same secret every time.
const DEVICE_PIN_SALT = new TextEncoder().encode("UNSEENET-VAULT-PRF-1");

const b64Pin = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64urlPin = (buf) => b64Pin(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64urlPin = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") +
  "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));

// Whether this page may offer a PIN at all: a browser with passkeys, not a stick or the
// bootable client. Whether the passkey can do PRF is only known when it is made.
// Passkeys need a host name, not an address: a web entrance, or localhost - not 127.0.0.1.
function devicePinPossible() {
  const host = location.hostname;
  return !!(window.PublicKeyCredential && navigator.credentials && window.isSecureContext)
    && !/^[\d.]+$|:/.test(host) && !(S.state && (S.state.bootable || S.state.portable));
}

// The devices that can open this vault without the passphrase (the core's list).
async function devicePinList() {
  try { return await api("GET", "/api/device-unlock"); } catch (_) { return { possible: false, devices: [] }; }
}

// The passkey's secret for this vault (its PRF output), after its PIN or unlock.
// ``ids``: the passkeys that may answer; answers {id, secret} or throws.
async function devicePinSecret(ids) {
  const cred = await navigator.credentials.get({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)), userVerification: "required", timeout: 60000,
    allowCredentials: ids.map(id => ({ type: "public-key", id: fromB64urlPin(id) })),
    extensions: { prf: { eval: { first: DEVICE_PIN_SALT } } } } });
  const prf = cred && cred.getClientExtensionResults().prf;
  if (!prf || !prf.results || !prf.results.first)
    throw new Error("This passkey cannot do it (no PRF): use the passphrase.");
  return { id: b64urlPin(cred.rawId), secret: b64Pin(prf.results.first) };
}

// Unlock with this device: its passkey, then the core opens the vault.
async function unlockWithDevicePin(devices) {
  S.busy = true; S.error = ""; render();
  try {
    const got = await devicePinSecret(devices.map(d => d.id));
    await loadState(await api("POST", "/api/unlock", { device: got.id, secret: got.secret }));
    await afterUnlock();
  } catch (err) {
    S.error = err.name === "NotAllowedError" ? "Not unlocked - the passkey was not used." : err.message;
  }
  S.busy = false; render();
}

// Set up, or remove, the PIN on this device: a passkey made here, kept by the device;
// the vault's passphrase is asked for first (the core needs it).
async function openDevicePin() {
  if (!devicePinPossible()) { toast("A PIN needs a passkey in this browser - not on a stick or the bootable client."); return; }
  const have = (await devicePinList()).devices || [];
  formDialog({ label: "PIN on this device", title: "Unlock with a PIN on this device", focus: "#pinpass",
    button: "Set up",
    note: "The passphrase keeps working, here and everywhere. A copy of the vault file alone is still protected by it.",
    fields: (vals) => [
      h("p", { class: "hint", style: "margin:0", text: "Your device keeps a passkey that only opens with its PIN, " +
        "fingerprint or face, and that stops after a few wrong tries. Unseenet uses it to open the vault, so " +
        "you do not type the passphrase here each time." }),
      have.length ? h("div", { class: "pin-devices" }, have.map(d => h("div", { class: "rrow" },
        h("b", { text: d.label || "A device" }),
        h("span", { class: "hint", text: d.created ? new Date(d.created * 1000).toLocaleDateString() : "" }),
        h("button", { class: "btn small", type: "button", onclick: async () => {
          try { await api("POST", "/api/device-unlock/remove", { id: d.id }); } catch (x) { toast(x.message); return; }
          closeDialog(); toast("That device no longer opens the vault."); } }, "Remove")))) : null,
      h("label", { for: "pinpass", text: "The vault's passphrase" }),
      h("input", { id: "pinpass", name: "pass", type: "password", class: "in", "data-k": "pinpass",
        autocomplete: "current-password", value: vals.pass || "" })],
    submit: async (v) => {
      if (!v.pass) throw new Error("The passphrase is needed to let this device in.");
      const cred = await navigator.credentials.create({ publicKey: {
        rp: { name: "Unseenet" }, challenge: crypto.getRandomValues(new Uint8Array(32)),
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "Unseenet vault", displayName: "Unseenet vault" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
        timeout: 60000, extensions: { prf: { eval: { first: DEVICE_PIN_SALT } } } } });
      const ext = cred.getClientExtensionResults().prf;
      if (!ext || ext.enabled === false) throw new Error("This device's passkeys cannot do it (no PRF). Keep using the passphrase.");
      // some give the secret when the passkey is made, others only when it is used
      const got = ext.results && ext.results.first ? { id: b64urlPin(cred.rawId), secret: b64Pin(ext.results.first) }
        : await devicePinSecret([b64urlPin(cred.rawId)]);
      await api("POST", "/api/device-unlock", { passphrase: v.pass, id: got.id, secret: got.secret,
        label: navigator.platform || "This device" });
      closeDialog();
      toast("Set up. Next time, unlock with this device's PIN.");
    } });
}
