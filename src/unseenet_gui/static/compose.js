// compose.js - posting.
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- posting ------------------------------------------------------------
function doPost(gid, body, local) {
  // the language: as chosen in the compose window, else what the core suggests for the
  // group - chat lines and comments too; nothing when it suggests nothing (UN-RFC 0052 5a)
  if (body.languages === undefined) {
    const chosen = S.langChosen && S.langChosen[gid];
    const sug = S.data && S.data.group && S.data.group.id === gid && S.data.group.suggested_languages;
    if (chosen) body = { ...body, languages: chosen };          // your choice for lines here
    else if (sug && sug.codes && sug.codes.length) body = { ...body, languages: sug.codes };
  }
  return doSend(`/api/groups/${encodeURIComponent(gid)}/post`, gid, body, local);
}

// What a suggestion's origin says, by the language field.
function languageWhy(from) {
  return from === "you" ? "what you wrote in here last" : from === "group" ? "the group's" :
    from === "profile" ? "from your profile" : "none: no language is sent";
}

// Language codes as typed: "da, en" or "da en" - lower case, a region dropped.
function languageCodes(text) {
  const out = [];
  for (const w of String(text || "").split(/[\s,]+/)) {
    const c = w.trim().toLowerCase().split(/[-_]/)[0];
    if (/^[a-z]{2,3}$/.test(c) && !out.includes(c)) out.push(c);
  }
  return out.slice(0, 4);
}

// A post's language, small, only where it differs from its group's (a Danish group does
// not say "da" on every post).
function languageMark(m) {
  const langs = m.languages || [];
  if (!langs.length) return null;
  const g = (S.data && S.data.group && S.data.group.id === m.group) ? S.data.group : groupOf(m.group);
  const main = (g && g.languages) || [];
  if (main.length && langs.every(l => main.includes(l))) return null;
  return h("span", { class: "sm lang", title: "Written in " + langs.join(", "), text: langs.join(" · ") });
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
  revealSent(id);
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

// What you just sent is in sight (gui#258): a comment lands under its entry, far from the
// bottom of a feed or the timeline, where sticking to the bottom (chats) does not help. Shown
// as being sent until it is, which marks it.
function revealSent(job) {
  const el = document.querySelector(`[data-job="${CSS.escape(job)}"]`);
  if (el) el.scrollIntoView({ block: "nearest" });
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
  if (S.reportJobs && e.job in S.reportJobs) {               // a report, sent or published in the background
    const publish = S.reportJobs[e.job] === "publish";
    if (e.state === "sent") toast(publish ? "Spam report published." : `Report sent to ${e.message_id || S.reportJobs[e.job]}.`);
    if (e.state === "failed") toast((publish ? "The spam report was not published: " : "The report was not sent: ") + (e.error || "unknown error"));
    if (e.state === "sent" || e.state === "failed") delete S.reportJobs[e.job];
    return;
  }
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
    // keep the grey line until the view has the real one: no gap, no jump - in the group
    // itself, and in a view that mixes groups (the timeline, a tag), where a comment's
    // group is one of those shown (gui#235)
    if (S.gid === p.group || isMixed(S.data && S.data.group)) await loadGroup();
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

// Put a group you follow into your timeline or take it out (UN-RFC 0034 section 6.2). A
// setting on what you follow, apart from the view you read it in: from a group of threads
// each new thread comes in once, with its answers under it.
async function setTimeline(g, on) {
  try { await api("POST", `/api/groups/${encodeURIComponent(g.id)}/timeline`, { on }); }
  catch (x) { toast(x.message); return; }
  toast(on ? g.label + " is in your timeline now." : g.label + " is no longer in your timeline.");
  await loadSidebar();
  if (S.gid === g.id || S.gid === TIMELINE) await loadGroup();
  render();
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


// The language of chat lines and comments here, as a small chip by the input: what the
// core suggests (your last choice here, else the group's); a click changes it, and the
// core remembers it for the group with the next line you send (UN-RFC 0052 5a).
function languageChip(gid) {
  const g = S.data && S.data.group;
  if (!g || g.id !== gid || !g.suggested_languages) return null;
  const codes = g.suggested_languages.codes || [];
  return h("span", { class: "langchip-slot" }, languageButton(codes, async (chosen) => {
    // kept by the core for your lines here, in every client (unseenet#692)
    let r = { codes: chosen, from: chosen.length ? "chosen" : "" };
    try { r = await api("POST", `/api/groups/${encodeURIComponent(gid)}/language/choose`, { languages: chosen }); }
    catch (_) { /* this page still uses it */ }
    g.suggested_languages = { codes: r.codes || [], from: r.from || "" };
    S.langChosen = { ...(S.langChosen || {}), [gid]: chosen.length ? chosen : null };
    render();
  }, { small: true, why: languageWhy(g.suggested_languages.from), group: g.languages || [],
       suggested: codes, suggestedWhy: languageWhy(g.suggested_languages.from) }));
}


// A chat line's language from its text, at pauses in typing (unseenet#686): the core keeps
// the conversation's for short lines and changes it only for a longer line it is sure of.
// Never over a language chosen with the chip.
let chatLangTimer = null;
// Ask the core what the chat line being written is in, after a pause.
function chatLanguage(gid, text) {
  clearTimeout(chatLangTimer);
  if ((S.langChosen || {})[gid] || !text.trim()) return;
  chatLangTimer = setTimeout(async () => {
    const g = S.data && S.data.group;
    if (!g || g.id !== gid || !g.suggested_languages) return;
    try {
      const r = await api("POST", `/api/groups/${encodeURIComponent(gid)}/language`, { text, kind: "chat" });
      const before = (g.suggested_languages.codes || []).join(" ");
      g.suggested_languages = { codes: r.codes || [], from: r.from || "" };
      if (before !== (r.codes || []).join(" ")) {
        const slot = document.querySelector(".chatbar .langchip-slot");
        if (slot) slot.replaceWith(languageChip(gid));
      }
    } catch (_) { /* keep it */ }
  }, 700);
}
