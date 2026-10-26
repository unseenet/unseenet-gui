// Notifications when something new lands in For you (unseenet-gui#126). What is new
// comes from the core (GET /api/notifications), so every client tells alike; this
// only shows it, through the browser's Notification API - while the window is open,
// never by push (no push servers that would know who you are and when). Content is
// hidden by default: notifications show on lock screens and stay in histories. Never
// on the bootable image. Uses app.js's helpers: h, api, toast, S, render, dialogShell,
// closeDialog, openGroup, FOR_YOU.
"use strict";

let notifyTimer = null;
let notifyAskedNow = false;            // "Not now": not again this session

// Whether notifications can be shown here: a browser that has them, a secure page, not the
// bootable image.
function notifyPossible() {
  return "Notification" in window && !(S.state && S.state.bootable) && window.isSecureContext;
}

// after a refresh: ask the core what is new, at most once a second
function notifySoon() {
  if (!notifyPossible() || !S.state || !S.state.me) return;
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(checkNotifications, 1000);
}

// Ask the core what is new in For you, and tell, ask first, or stay quiet as the reader
// chose.
async function checkNotifications() {
  let n;
  try { n = await api("GET", "/api/notifications"); } catch (_) { return; }
  const set = n.settings || {};
  if (!n.count || set.on === false) return;
  if (set.on === null || set.on === undefined) {
    if (!notifyAskedNow) askNotifications(n);
    return;
  }
  showNotification(n);
}

// Whether an item is already in view, so needs no notification.
function onScreen(item) {
  return document.hasFocus() && (S.gid === item.group || S.gid === FOR_YOU ||
    (S.gid && S.gid.startsWith("contact:") && item.why === "private"));
}

// The notification: "N new in For you", or who and what when the reader chose so; one for a
// burst.
function showNotification(n) {
  if (Notification.permission !== "granted") return;
  const items = n.items.filter(i => !onScreen(i));
  if (!items.length) return;
  const content = n.settings && n.settings.content;
  const body = content && items.length === 1 && items[0].text
    ? `${items[0].who}: ${items[0].text}`
    : `${items.length} new in For you`;
  try {
    const note = new Notification("Unseenet", { body, tag: "unseenet-for-you", renotify: true, silent: false });
    note.onclick = () => { window.focus(); openGroup(FOR_YOU); note.close(); };
  } catch (_) { /* some browsers only allow it from a service worker: then not here */ }
}

// Change the notification choice, kept with your settings in the core.
async function setNotify(changes) {
  await api("POST", "/api/settings", { notifications: changes });
}

// Ask once whether to tell about new messages: Yes, Not now, Never.
function askNotifications(n) {
  notifyAskedNow = true;
  const yes = async () => {
    closeDialog();
    let perm = Notification.permission;
    if (perm === "default") { try { perm = await Notification.requestPermission(); } catch (_) { perm = "denied"; } }
    if (perm !== "granted") { toast("Your browser did not allow notifications; change it in the browser's site settings."); return; }
    await setNotify({ on: true });
    showNotification({ ...n, settings: { on: true, content: false } });
  };
  const never = async () => { closeDialog(); await setNotify({ on: false }); toast("No notifications. The menu turns them on again."); };
  S.dialog = { focus: ".dialog .btn.primary", render: () => dialogShell({ label: "Notifications" },
    h("div", { class: "dh" }, h("h2", { text: "Tell you about new messages?" })),
    h("div", { class: "db" },
      h("p", { style: "margin:0", text: "A notification when a private message, a reply or a mention lands in For you - only while Unseenet is open." }),
      h("p", { class: "hint", style: "margin:0", text: "It says only \"new in For you\": notifications show on the lock screen and stay in your system's history, so who wrote and what is left out unless you choose otherwise in the menu." })),
    h("div", { class: "df btns" },
      h("button", { class: "btn", onclick: never }, "Never"),
      h("button", { class: "btn", onclick: closeDialog }, "Not now"),
      h("button", { class: "btn primary", onclick: yes }, "Yes"))) };
  render();
}

// the menu (command palette)
function notifyCommands() {
  if (!notifyPossible()) return [];
  const set = (S.settings && S.settings.notifications) || {};
  return [
    { name: set.on ? "Notifications: stop telling me about For you" : "Notifications: tell me when something lands in For you",
      key: "", also: "notify notifications alert besked",
      run: async () => {
        if (!set.on && Notification.permission !== "granted") {
          const perm = await Notification.requestPermission().catch(() => "denied");
          if (perm !== "granted") { toast("Your browser did not allow notifications."); return; }
        }
        await setNotify({ on: !set.on }); await refreshNotifySettings();
        toast(set.on ? "No more notifications." : "Notifications on (they say only \"new in For you\").");
      } },
    { name: set.content ? "Notifications: hide who wrote and what" : "Notifications: show who wrote and the start of the text",
      key: "", also: "notify notifications content privacy", when: !!set.on,
      run: async () => {
        await setNotify({ content: !set.content }); await refreshNotifySettings();
        toast(set.content ? "Notifications say only \"new in For you\"."
          : "Notifications show the sender and the start of the text - also on the lock screen and in the system's history.");
      } },
  ];
}

// Read the notification choice from the core again, for the menu.
async function refreshNotifySettings() {
  try { const st = await api("GET", "/api/settings"); S.settings = { ...(S.settings || {}), notifications: st.notifications }; }
  catch (_) { /* keep what we had */ }
}
