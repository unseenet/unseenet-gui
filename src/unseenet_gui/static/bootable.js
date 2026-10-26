// bootable.js - the bootable image: network, keyboard and power.
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- the bootable image: network, keyboard, power ------------------------------
let SYS = null;
async function loadSystem() {
  try { SYS = await api("GET", "/x/gui/system"); } catch (_) { SYS = null; }
  render();
}

function systemBar() {
  if (SYS === null) { SYS = false; loadSystem(); }
  const s = SYS || {};
  const online = (s.addresses || []).length > 0;
  return h("div", { class: "sysbar" },
    h("button", { class: "btn", onclick: openNetwork },
      h("span", { class: "dot" + (online ? " ok" : "") }),
      online ? s.addresses.map(a => a.interface).join(", ") + " connected" : "No network - set it up"),
    h("label", { class: "sr", for: "kbd", text: "Keyboard" }),
    h("select", { id: "kbd", class: "btn", onchange: async (e) => {
        const r = await api("POST", "/x/gui/system/keyboard", { layout: e.target.value });
        toast(r.restart ? "Changing the keyboard …" : "The keyboard changes at the next start.");
      } }, (s.keyboards || []).map(k => h("option", { value: k.id, selected: k.id === s.keyboard ? "" : null, text: "⌨ " + k.name }))),
    h("button", { class: "btn", onclick: () => power("reboot") }, "Restart"),
    h("button", { class: "btn", onclick: () => power("poweroff") }, "Shut down"));
}

async function power(action) {
  if (!confirm(action === "poweroff" ? "Shut down the computer?" : "Restart the computer?")) return;
  try { await api("POST", "/x/gui/system/power", { action }); } catch (_) { }
  document.getElementById("root").replaceChildren(h("div", { class: "unlock" },
    h("p", { class: "muted", text: action === "poweroff" ? "Shutting down …" : "Restarting …" })));
}

// A newer signed release (unseenet#264): the updater replaces this stick's or
// folder's program files over Tor and keeps data/; then Unseenet is started again.
function openUpdate() {
  const u = S.state.update;
  if (!u) return;
  let msg = "", busy = false, done = false;
  const go = async () => {
    busy = true; msg = "Fetching and checking the release over Tor - this takes a few minutes …"; render();
    try {
      const r = await api("POST", "/x/gui/update");
      done = r.ok;
      msg = r.ok ? "Done. Close Unseenet and start it again to use the new version. Your data is as it was."
        : "The update did not finish:\n" + (r.output || "");
    } catch (e) { msg = e.message; }
    busy = false; render();
  };
  updateProgress = (text) => { if (busy) { msg = text; render(); } };
  S.dialog = { focus: ".dialog .btn.primary", render: () => dialogShell({ label: "Update Unseenet" },
    h("div", { class: "dh" }, h("h2", { text: `Unseenet ${u.version}` }),
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db" },
      h("p", { style: "margin:0" }, u.here
        ? `A newer ${u.channel === "dev" ? "development build" : "release"} is ready, signed by the Unseenet project. ` +
          "Updating replaces the program on this stick or folder and keeps your data/. Every file is checked against the signature."
        : "A newer release is ready. This Unseenet was not installed from a stick or a portable folder: update it the way you installed it (see unseenet.org)."),
      msg ? h("p", { class: "hint", style: "margin:0;white-space:pre-wrap", role: "status", text: msg }) : null),
    h("div", { class: "df" },
      u.here && !done ? h("button", { class: "btn primary", onclick: go, disabled: busy }, busy ? "Updating …" : "Update now") : null,
      h("button", { class: "btn", onclick: closeDialog }, done ? "Close" : "Later"))) };
  render();
}
let updateProgress = () => {};

function openNetwork() {
  const nets = {}, busy = {};
  let msg = "", pick = null;
  loadSystem();
  const scan = async (dev) => {
    busy[dev] = true; render();
    try { nets[dev] = await api("POST", "/x/gui/system/wifi", { action: "scan", device: dev }); }
    catch (e) { msg = e.message; }
    busy[dev] = false; render();
  };
  const connect = async (dev, name, pass) => {
    msg = "Connecting to " + name + " …"; render();
    try {
      const r = await api("POST", "/x/gui/system/wifi", { action: "connect", device: dev, name, passphrase: pass });
      msg = r.ok ? "Connected to " + name + "." : r.message; pick = null;
      await loadSystem(); scan(dev);
    } catch (e) { msg = e.message; render(); }
  };
  S.dialog = { render: () => {
    const s = SYS || {};
    return dialogShell({ label: "Network", wide: true },
      h("div", { class: "dh" }, h("h2", { text: "Network" }), h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
      h("div", { class: "db" },
        h("p", { style: "margin:0" }, (s.addresses || []).length ? ["Connected: ",
          s.addresses.map(a => h("span", { class: "mono", text: `${a.interface} ${a.address}  ` }))] :
          "Not connected. A network cable works by itself; for Wi-Fi, pick a network below."),
        h("p", { class: "hint", style: "margin:0", text: "Only Tor uses the network. The computer gets a new random hardware address for each Wi-Fi network." }),
        (s.wifi || []).map(dev => [
          h("div", { class: "row-between" }, h("h3", { style: "margin:6px 0 0;font-size:14px", text: "Wi-Fi (" + dev + ")" }),
            h("button", { class: "btn", onclick: () => scan(dev), disabled: busy[dev] }, busy[dev] ? "Looking …" : "Look for networks")),
          (nets[dev] || []).map(n => h("div", { class: "cmd" + (pick === n.name ? " on" : "") },
            h("span", { class: "nm", text: (n.connected ? "● " : "") + n.name }),
            h("small", { text: `${n.security} · ${n.signal}` }),
            n.connected ? h("small", { text: "connected" }) : pick === n.name && n.security !== "open" ?
              h("form", { class: "inline", onsubmit: (e) => { e.preventDefault(); connect(dev, n.name, e.target.pw.value); } },
                h("label", { class: "sr", for: "pw", text: "Passphrase" }),
                h("input", { id: "pw", name: "pw", type: "password", class: "in", placeholder: "Passphrase", "data-k": "pw", autofocus: true }),
                h("button", { class: "btn primary", type: "submit" }, "Connect")) :
              h("button", { class: "btn", onclick: () => { if (n.security === "open") connect(dev, n.name, ""); else { pick = n.name; render(); } } }, "Connect")))]),
        !(s.wifi || []).length ? h("p", { class: "muted", style: "margin:0", text: "No Wi-Fi on this computer (or its firmware is not on the stick)." }) : null,
        msg ? h("p", { class: "hint", style: "margin:0", role: "status", text: msg }) : null));
  } };
  render();
}

function setupScreen() {
  const st = S.state, needName = !st.me, needNode = !st.node;
  if (needNode && S.knownNodes === null) {
    S.knownNodes = []; S.nodesState = "loading";
    api("GET", "/api/known-nodes").then(r => { const n = r.nodes; S.knownNodes = n; S.nodesState = "";
      // a known node at random, so new users do not all start on the first (UN-RFC 0043 5.1)
      if (!S.setupNode && n.length) S.setupNode = n[Math.floor(Math.random() * n.length)].address;
      render(); })
      // say so: without the list a new user only sees an address field they cannot fill in
      .catch(err => { S.nodesState = err.message || "unknown error"; render(); });
  }
  const nodesNote = S.nodesState === "loading" ? h("p", { class: "hint", text: "Getting the list of nodes …" }) :
    S.nodesState ? h("div", { class: "hint", role: "alert" },
      "The list of nodes could not be loaded (" + S.nodesState + "). ",
      h("button", { type: "button", class: "link", onclick: () => { S.knownNodes = null; S.nodesState = ""; render(); } }, "Try again"),
      " - or type a node's address below.") : null;
  const submit = async (e) => {
    e.preventDefault();
    const f = e.target;
    S.busy = true; S.error = ""; render();
    try {
      const node = needNode ? (f.custom.value.trim() || S.setupNode || "") : "";
      // UN-RFC 0050: an identity you have, from its words or another device (identity.js)
      if (!(needName && await setupOther(f, node))) {
        await loadState(await api("POST", "/api/setup", { display: needName ? f.display.value : "", node }));
        S.firstWords = needName;
        await afterUnlock();
        if (needName) openShowWords(true);       // write them down now, or later (4.2)
      }
    } catch (err) { S.error = err.message; }
    S.busy = false; render();
  };
  return h("div", { class: "unlock" }, h("div", { class: "unlock-box" },
    brandHead("First start."),
    h("form", { class: "form", onsubmit: submit },
      needName ? setupHowChoice() : null,
      needName && (S.setupHow || "new") !== "new" ? setupHowFields() :
      needName ? [h("label", { for: "display", text: "Your name" }),
        h("input", { id: "display", name: "display", class: "field", "data-k": "display", required: true,
          placeholder: "What others see next to your posts" }),
        h("p", { class: "hint", text: "Anyone can choose any name, so others also see the start of your key. " +
          "You can claim a name like @you later." })] : null,
      needNode ? [h("label", { text: "Your node" }),
        h("div", { class: "choices" }, (S.knownNodes || []).map(n => h("button", {
          type: "button", class: "choice", "aria-pressed": String(S.setupNode === n.address),
          onclick: () => { S.setupNode = n.address; render(); } },
          h("span", {}, h("span", { class: "mono", text: n.name || n.address }),
            h("small", { text: n.description || n.operator || "" }),
            n.name ? h("small", { class: "mono addr", text: n.address }) : null)))),
        nodesNote,
        h("input", { name: "custom", class: "field mono", "data-k": "custom", placeholder: "or an address: xyz.onion or host:port",
          style: "font-size:14px" })] : null,
      h("div", { class: "error", role: "alert", text: S.error }),
      h("button", { class: "btn primary", type: "submit", disabled: S.busy }, S.busy ? "Starting …" : "Start"))));
}

async function afterUnlock() {
  if (S.state.setup) return;
  connectEvents();
  await Promise.all([loadSidebar(), loadTheme()]);
  if (!S.firstWords) wordsReminder();          // UN-RFC 0050 4.2 (identity.js)
  refreshNotifySettings().then(notifySoon);     // #126 (notify.js)
  offerProtocolHandler();
  if (OPEN_AT) { const a = OPEN_AT; OPEN_AT = null; openAddress(a); }
}

// In a browser (the web client), web+unseenet: links open here (UN-RFC 0031 section
// 3.4.1): the browser asks the reader once. Never in the local GUI, whose port changes.
function offerProtocolHandler() {
  if (!(GUI && GUI.web) || !navigator.registerProtocolHandler || !window.isSecureContext) return;
  try { navigator.registerProtocolHandler("web+unseenet", location.origin + location.pathname + "#open=%s"); }
  catch (_) { /* the browser said no, or asked and was told no: nothing to do */ }
}
