// ripening.js - key ripening (UN-RFC 0025, #50).
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- key ripening (UN-RFC 0025, #50) ------------------------------------------
// The core ripens the key in the background, segment by segment, and says so with a
// `ripening` event after each one. Here: the level where you are, what it means,
// pause and resume (unseenet#337: only when the core's state has "paused"), and on
// the web "keep this page open" plus a screen wake lock while a new key gets to 0.
const RIPE_TOP = 4;                       // the core ripens up to level 4 (runtime.RIPEN_TO)
const RIPE_STEP = [8, 8, 8, 4];           // next level / this level's threshold (core.ripening.LEVELS)
let ripeSamples = [];                     // [t, ms] at the end of each segment, for a pace

// Keep the ripening state the core reports, and measure its pace from segment to segment.
function setRipening(r, fromSegment) {
  const was = S.ripening;
  S.ripening = { ...(was || {}), ...r };
  if (fromSegment) {
    ripeSamples = ripeSamples.filter(([t]) => t < r.t).concat([[r.t, Date.now()]]).slice(-6);
    if (was && r.level !== null && r.level !== was.level) {
      toast(was.level === null ? "Your key is ready: you can post now." : `Your key reached level ${r.level}.`);
    }
  }
  syncWakeLock();
}

// How far ripening is within the level you are at, 0 to 1.
function ripeFraction(r) {               // within the level you are at, 0 to 1
  if (!r || !r.next_at) return 1;
  const from = r.level === null ? 0 : r.next_at / RIPE_STEP[r.level];
  return Math.max(0, Math.min(1, (r.t - from) / (r.next_at - from)));
}

// About how long until the next level, from this run's own pace; null until it can tell.
function ripeSecondsLeft(r) {            // from this run's own pace; null until two segments are done
  if (!r || !r.next_at || r.paused || ripeSamples.length < 2) return null;
  const [[t0, m0], [t1, m1]] = [ripeSamples[0], ripeSamples[ripeSamples.length - 1]];
  if (t1 <= t0 || m1 <= m0) return null;
  return Math.max(0, (r.next_at - r.t) / ((t1 - t0) / ((m1 - m0) / 1000)));
}

// A time as people say it: about a minute, about 20 minutes, about 3 hours.
function roughly(sec) {
  if (sec < 90) return "about a minute";
  if (sec < 5400) return `about ${Math.round(sec / 60)} minutes`;
  if (sec < 48 * 3600) return `about ${Math.round(sec / 3600)} hours`;
  return `about ${Math.round(sec / 86400)} days`;
}

// The line under your name in the sidebar: your key's level and how ripening goes.
function ripeLine() {                     // under your name in the sidebar
  const r = S.ripening;
  if (!r) return null;
  let text;
  if (r.level === null) text = r.available === false ? "Key not ripened" :
    `New key getting ready · ${Math.min(99, Math.round(100 * ripeFraction(r)))}%`;
  else text = `Key level ${r.level}` + (r.level >= RIPE_TOP || !r.next_at ? "" : r.paused ? " · paused" : " · ripening");
  return h("button", { class: "link ripe", title: "What is key ripening?", onclick: openRipening }, text);
}

// Pause ripening, or let it go on.
async function setRipeningPaused(paused) {
  try {
    const r = await api("POST", "/api/ripening", { paused });
    ripeSamples = [];
    setRipening(r, false);
  } catch (err) { toast("Could not change it: " + err.message); }
  render();
}

// What key ripening is (UN-RFC 0025) and where yours is: level, time left, pause.
function openRipening() {
  const para = (t) => h("p", { style: "margin:0", text: t });
  S.dialog = { focus: ".dialog .btn.primary", render: () => {
    const r = S.ripening || {}, web = !!S.state.web;
    const canPause = typeof r.paused === "boolean" && r.available !== false && r.next_at;
    const pct = Math.round(100 * ripeFraction(r)), left = ripeSecondsLeft(r);
    const where = r.level === null ? "Getting ready for level 0" : `Level ${r.level}` +
      (r.next_at ? `, on the way to ${r.level + 1}` : " - fully ripened");
    return dialogShell({ label: "Key ripening" },
      h("div", { class: "dh" }, h("h2", { text: "Key ripening" }), h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
      h("div", { class: "db" },
        h("div", { class: "statuscard" },
          h("div", {}, h("b", { text: where }), r.paused ? h("span", { class: "chip warn", style: "margin-left:8px", text: "paused" }) : null),
          r.next_at ? h("span", { class: "bar determinate" }, h("span", { style: `width:${pct}%` })) : null,
          r.next_at ? h("div", { class: "muted", text: `${pct}%` + (left !== null ? ` · ${roughly(left)} of running time left` : "") }) : null),
        para("Ripening is work your device does to show that your key has been around for a while. " +
          "It costs a throwaway key the same time, which is what keeps spam out without anyone in charge. " +
          "It never signs anything, and only the result is shared."),
        para("Your key can post from level 0. A brand-new key needs about a quarter of an hour to get there. " +
          "Each level after that makes postage - the small proof-of-work on every post - cheaper, and opens groups that ask for a riper key. " +
          `Each level takes about eight times as long as the one before; it goes on up to level ${RIPE_TOP} while Unseenet is open, ` +
          "and carries on next time from where it stopped."),
        web ? para("In the browser it runs only while this page is open. Closing the page loses only the step in progress - " +
          "as long as your vault is saved as a file or kept on this device.") : null,
        canPause ? para("Pause it on a warm phone or when on battery. It stays paused on this device, also after a restart, until you resume it here. " +
          "A post that needs a riper key still waits for what it needs.") : null,
        r.available === false ? h("p", { class: "hint", style: "margin:0",
          text: "This copy of Unseenet cannot ripen keys (chiavdf is missing). Your key can still read, and post where groups ask for no ripening." }) : null),
      h("div", { class: "df btns" },
        canPause ? h("button", { class: "btn", onclick: () => setRipeningPaused(!r.paused) }, r.paused ? "Resume" : "Pause") : null,
        h("button", { class: "btn primary", onclick: closeDialog }, "Close")));
  } };
  render();
}

// On the web the page is the client: closing it, or a phone putting it to sleep, stops
// the ripening of a new key. Ask once, plainly, and keep the screen on where we may.
function ripeningBanner() {
  const r = S.ripening;
  if (!S.state.web || !r || r.level !== null || r.available === false) return null;
  const pct = Math.min(99, Math.round(100 * ripeFraction(r))), left = ripeSecondsLeft(r);
  return h("div", { class: "ripebar", role: "status" },
    r.paused ? h("span", { text: "Getting your new key ready is paused. Your first post will wait for it." }) :
      h("span", {}, h("b", { text: "Keep this page open" }),
        ` while your new key gets ready (${pct}%${left !== null ? ", " + roughly(left) + " left" : ""}). You can read meanwhile.`),
    h("span", { class: "bar determinate" }, h("span", { style: `width:${pct}%` })),
    typeof r.paused === "boolean" && r.paused ? h("button", { class: "btn", onclick: () => setRipeningPaused(false) }, "Resume") : null,
    h("button", { class: "link", onclick: openRipening }, "Why?"));
}

let wakeLock = null, wakeAsking = false;
// In the browser build, keep the screen awake while a new key ripens to level 0, so it is
// not slowed down.
async function syncWakeLock() {
  const r = S.ripening;
  const want = !!(S.state && S.state.web && r && r.level === null && !r.paused && r.available !== false &&
    document.visibilityState === "visible");
  if (want && !wakeLock && !wakeAsking && navigator.wakeLock) {
    wakeAsking = true;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } catch (_) { wakeLock = null; }         // not allowed here (battery saver, no permission)
    wakeAsking = false;
    if (wakeLock) syncWakeLock();            // ready or paused meanwhile: let it go again
  } else if (!want && wakeLock) {
    const w = wakeLock;
    wakeLock = null;
    w.release().catch(() => {});
  }
}
document.addEventListener("visibilitychange", syncWakeLock);   // the browser drops it when hidden
