// events.js - events from the server.
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- events from the server --------------------------------------------
let sidebarTimer = null;
// The core's server events over a WebSocket (UN-RFC 0046 5): new posts, jobs, ripening,
// refreshes; reconnecting when it drops.
function connectEvents() {
  if (S.ws) return;
  const ws = new WebSocket(`ws://${location.host}/api/events`, ["unseenet", "unseenet-token." + TOKEN]);
  S.ws = ws;
  ws.onopen = async () => {          // catch up on what happened before we were listening
    try { await loadState(); } catch (_) { }
    await loadGroup(); await loadSidebar();
  };
  ws.onmessage = async (ev) => {
    let e;
    try { e = JSON.parse(ev.data); } catch (_) { return; }
    const type = e.event;
    if (type === "copy") { copyEvent(e); return; }           // UN-RFC 0046 4.19 (identity.js)
    const sidebarSoon = () => {
      clearTimeout(sidebarTimer);
      sidebarTimer = setTimeout(async () => {
        try { await loadState(); } catch (_) { }
        await loadSidebar();
      }, 250);
    };
    if (type === "status") {
      S.state.status = e.text;
      S.state.status_idle = !!e.idle;                           // unseenet#518
      // "Connected to <a node>" may be any of your nodes: only the core's round says
      // the network is reached; each node says itself with node-state (#111)
      if (/^Offline/.test(e.text)) S.state.connected = false;
      const st = document.querySelector(".statusbar");
      if (st && !S.dialog) { st.replaceWith(statusbar()); redrawNodeLink(); } else render();
    } else if (type === "release-offer") {
      try { await loadState(); } catch (_) { }
      const st = document.querySelector(".statusbar");
      if (st && !S.dialog) st.replaceWith(statusbar());
    } else if (type === "x-gui-update") {
      updateProgress(e.text);
    } else if (type === "groups-changed" || type === "refreshed" || type === "inbox-ready") {
      if (type !== "groups-changed") notifySoon();             // #126 (notify.js)
      if (type === "refreshed") {
        const was = S.state.connected;
        S.state.connected = !e.error; redrawNodeLink();
        // a node asked but not answering yet (unseenet#704): said plainly, the rest shown
        const slowBefore = (S.state.slow || []).join();
        S.state.slow = e.slow || [];
        if (S.state.slow.join() !== slowBefore) {
          const st = document.querySelector(".statusbar");
          if (st && !S.dialog) st.replaceWith(statusbar());
        }
        if (S.dialog && was !== S.state.connected) render();   // the palette: grey or ready now
      }
      sidebarSoon();
    } else if (type === "group-updated") {
      if (e.new) notifySoon();                                 // #126 (notify.js)
      if (e.new) sidebarSoon();                                // counts in the sidebar
      if (e.group_id === S.gid || S.gid === FOR_YOU ||
          (S.gid && S.gid.startsWith("contact:") && S.sidebar && e.group_id === S.sidebar.inbox.id)) {
        await loadGroup(); render();
      }
    } else if (type === "node-state") {
      S.nodes = S.nodes || {};
      S.nodes[e.address] = { up: e.up, error: e.error };
      if ((S.state.slow || []).includes(e.address)) {          // it answered, or gave up (#206)
        S.state.slow = S.state.slow.filter(a => a !== e.address);
        const st = document.querySelector(".statusbar");
        if (st && !S.dialog) st.replaceWith(statusbar());
      }
      if (e.address === S.state.node) redrawNodeLink();
    } else if (type === "tor-state") {
      S.tor = { progress: e.progress, summary: e.summary };
      if (e.progress < 100 && !S.dialog) {
        S.state.status = `Tor: ${e.progress}% ${e.summary || ""}`.trim();
        S.state.status_idle = false;
        const st = document.querySelector(".statusbar");
        if (st) st.replaceWith(statusbar());
      }
    } else if (type === "ripening") {
      setRipening({ level: e.level, next_at: e.next_at, t: e.t }, true);
      render();                                                 // the sidebar's level, a waiting message, the web's banner
    } else if (type === "ripening-paused") {                    // from this window or another (unseenet#337)
      ripeSamples = [];
      setRipening({ paused: e.paused }, false);
      render();
    } else if (type === "job") {
      await jobEvent(e);
    }
  };
  ws.onclose = () => { S.ws = null; setTimeout(() => { if (S.state && S.state.unlocked) connectEvents(); }, 3000); };
}
