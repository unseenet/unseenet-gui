// compose.js - posting.
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- posting ------------------------------------------------------------
function doPost(gid, body, local) {
  return doSend(`/api/groups/${encodeURIComponent(gid)}/post`, gid, body, local);
}

// Your own message shows up greyed out at once (#48): it goes into S.pending under a
// local id *before* the request, and moves to the core's job id when the answer comes.
// Job events that beat the HTTP answer over the WebSocket wait in S.early meanwhile.
let localSeq = 0;
// Send a post or chat line through the core as a job, showing it on its way until the node
// has it.
async function doSend(path, gid, body, local) {
  const sent = { ...body, kind: body.chat ? "chat" : "post" };     // UN-RFC 0028
  delete sent.chat;
  const id = "local" + (++localSeq);
  const p = S.pending[id] = { group: gid, state: "queued", body, path, ...local };
  render();
  try {
    let r;
    try { r = await api("POST", path, sent); }
    catch (err) {           // a group whose posts are also published outside Tor: ask first
      if (!/portal|outside Tor/i.test(err.message) || !window.confirm(err.message + "\n\nPost anyway?")) throw err;
      r = await api("POST", path, { ...sent, publish_outside_tor: true });
    }
    delete S.pending[id];
    if (p.state === "queued") p.state = "pow";
    S.pending[r.job] = p;
    const early = S.early[r.job] || [];
    delete S.early[r.job];
    for (const e of early) await jobEvent(e, false);
  } catch (err) {
    p.state = "failed"; p.error = err.message;
  }
  render();
}

// Send a post again that was not sent.
function retry(job) {
  const p = S.pending[job];
  delete S.pending[job];
  doSend(p.path || `/api/groups/${encodeURIComponent(p.group)}/post`, p.group, p.body, { text: p.text, chat: p.chat, thread: p.thread });
}

// Pending messages to draw in group g: not yet among the group's messages. Once the
// core has said which message it became (`sent`), the real one replaces it - drawn
// once, whichever of `group-updated` and `reached` comes first.
function pendingIn(g, msgs, chat) {
  const have = new Set(msgs.map(m => m.id));
  return Object.entries(S.pending).filter(([, p]) =>
    p.group === g.id && !!p.chat === !!chat && !(p.message_id && have.has(p.message_id)));
}

// A job's progress from the core: postage, sent, reached the node, or not sent and why.
async function jobEvent(e, draw = true) {                   // a post on its way (section 5)
  const p = S.pending[e.job];
  if (!p) {
    // the answer to our POST may not be here yet: keep it for doSend (only while one is out)
    if (Object.values(S.pending).some(q => q.state === "queued")) (S.early[e.job] = S.early[e.job] || []).push(e);
    return;
  }
  if (e.state === "pow" || e.state === "ripening") {
    const before = p.state + Math.round((p.fraction || 0) * 100);
    p.state = e.state; p.fraction = e.fraction;
    if (draw && p.state + Math.round((e.fraction || 0) * 100) !== before) render();   // at most a hundred redraws
    return;
  }
  p.state = e.state; p.error = e.error;
  if (e.message_id) p.message_id = e.message_id;
  if (e.state === "reached") {
    // keep the grey line until the group has the real one: no gap, no jump
    if (S.gid === p.group) await loadGroup();
    delete S.pending[e.job];
  }
  if (e.state === "failed") toast("Not sent: " + (e.error || "unknown error"));
  if (draw) render();
}

// Show the group as threads or as a chat, for you (the owner's view stays theirs).
async function toggleView() {
  const g = S.data && S.data.group;
  if (!g || !g.type || g.type === "inbox") return;
  await api("POST", `/api/groups/${encodeURIComponent(g.id)}/view`, { view: nextView(g) });
  await loadGroup(); await loadSidebar();
}

// Copy text to the clipboard and say so.
async function copy(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done); }
  catch (_) { toast("Could not copy - select it and press Ctrl C."); }
}

// The same address on the web, https://<entrance>/a/... (UN-RFC 0031 section 3.4.1,
// #98): for sharing where unseenet: links do not work - the web, chats, mail. The core
// writes it on a known web entrance, without n= hints.
async function copyWeb(address, what = "address") {
  let a;
  try { a = await api("GET", "/api/address?a=" + encodeURIComponent(address)); }
  catch (x) { toast(x.message); return; }
  if (!a.web) { toast("No web entrance is known to write it on - copy the unseenet: address instead."); return; }
  copy(a.web, `The ${what}'s web address is copied - anyone can open it in a browser.`);
}
