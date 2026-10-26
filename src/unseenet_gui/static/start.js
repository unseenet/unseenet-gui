// start.js - starting the page: kept last of these, so every function above exists.
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- start --------------------------------------------------------------
(async () => {
  render();
  if (!TOKEN) return;
  try {
    await loadState();
    if (S.state.unlocked) await afterUnlock();
  } catch (err) {
    S.state = { unlocked: false, vault: "", vault_exists: true };
    S.error = "The client is not running any more: " + err.message;
  }
  render();
})();
