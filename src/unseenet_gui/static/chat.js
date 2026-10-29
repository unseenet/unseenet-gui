// chat.js - chat.
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- chat ---------------------------------------------------------------
function chatView(d) {
  const g = d.group;
  const msgs = d.messages.slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  markRead(msgs);
  const byId = Object.fromEntries(msgs.map(m => [m.id, m]));
  const out = [h("div", { class: "spacer" }), olderButton(d)].filter(Boolean);   // unseenet#724
  let lastDay = null, grp = null;
  const flush = () => { if (grp) out.push(grp.el); grp = null; };
  for (const m of msgs) {
    const d0 = m.date ? new Date(m.date) : null;
    if (d0 && (!lastDay || !sameDay(d0, lastDay))) { flush(); out.push(h("div", { class: "day", text: dayLabel(d0) })); lastDay = d0; }
    const close = grp && grp.key === m.key && d0 && grp.at && d0 - grp.at < 5 * 60000;
    if (!close) {
      flush();
      const col = h("div", { class: "col" });
      if (!m.mine) col.append(h("div", { class: "hd" }, whoEl(m),
        m.bot ? h("span", { class: "hint", text: "bot" }) : null, h("span", { class: "hint", text: when(m.date, false) })));
      else col.append(h("div", { class: "hint", text: when(m.date, false) }));
      grp = { key: m.key, at: d0, col, el: h("div", { class: "mg" + (m.mine ? " mine" : "") }, m.mine ? null : avatar(m, true), col) };
    }
    grp.at = d0 || grp.at;
    const quoted = m.references.length && byId[m.references[m.references.length - 1]];
    const isPost = m.readable && m.kind !== "chat";     // a post among chat lines stands out (UN-RFC 0028)
    // tabindex and data-k: on a phone a tap picks the line, which shows ☺+ and Pin (gui#259)
    grp.col.append(h("div", { class: "bubble" + (isPost ? " is-post" : "") + (m.pinned ? " pinned" : ""), "data-id": m.id,
      tabindex: "0", "data-k": "line:" + m.id,
      title: when(m.date) + (m.origin ? " · " + originText(m) : "") + (m.encrypted ? " · encrypted" : "") + (m.pinned ? " · pinned" : "") },
      moreMenu(m),
      m.pinned ? h("span", { class: "pinmark", "aria-label": "Pinned", text: PIN + " " }) : null,
      quoted ? h("span", { class: "quote" }, h("span", { class: "mono", text: quoted.who }), " · " + (subjectOf(quoted) || quoted.text.slice(0, 80))) : null,
      isPost && !m.reported ? h("div", { class: "lsub", text: "≡ " + (m.subject || "(no subject)") }) : null,
      m.reported ? reportedNote(m) :                    // hidden by a report (UN-RFC 0045)
        labelCovered(m) ? [warningFlags(m), labelVeil(m)] :   // a warning (UN-RFC 0053)
        m.readable ? (m.markdown ? renderChatLine(m) : linkGroups(m.text)) : h("i", { text: m.error || "Could not be read." }),
      m.readable && !m.reported && !labelCovered(m) ? filesOf(m, true) : null,
      reactionBar(m),
      isPost && g.type !== "contact" && mayReply(d, m).allowed && (g.kinds || []).includes("post") ?
        h("div", { class: "lact" }, h("button", { class: "link", onclick: () => openReply(m, g) },
          commenting(d) ? "Comment with a quote" : "Reply with a quote")) : null,
      // Copy address is in the ⋯ menu (#120)
      g.may_pin && m.readable ? h("div", { class: "lact pinact" },
        h("button", { class: "link", onclick: () => openPin(m) }, m.pinned ? "Unpin" : "Pin")) : null));
    if (m.mine) grp.lastMine = m;
  }
  flush();
  const last = out[out.length - 1];
  if (msgs.length && msgs[msgs.length - 1].mine && last.classList && last.classList.contains("mg")) {
    last.querySelector(".col").append(h("div", { class: "state ok" }, svg(ICON.checks, 14, 2.5), "reached the node"));
  }
  const pend = pendingIn(g, msgs, true);
  for (const [job, p] of pend) {
    out.push(h("div", { class: "mg mine", "data-job": job }, h("div", { class: "col" },
      h("div", { class: "bubble " + (p.state === "failed" ? "failed" : "pending"), text: p.text }),
      p.state === "failed" ? h("div", { class: "state bad" }, "Not sent: " + (p.error || ""), " ",
        h("button", { class: "link", onclick: () => { retry(job); } }, "Try again")) : pendingState(p))));
  }
  if (msgs.length === 0 && !pend.length) {
    out.push(h("div", { class: "empty" }, h("h2", { text: "Quiet here" }), h("p", { text: g.type === "contact" || mayWrite(d, "chat").allowed ? "Say hello below." : "" })));
  }
  const cp = g.type === "contact" ? { allowed: true } : mayWrite(d, "chat");
  // files on a chat line (#102, UN-RFC 0028 section 6.1): where the group takes them,
  // and in a chat with a person, whose inbox may (the runtime says so when it does not)
  const takesFiles = g.type === "contact" || (g.files && g.node_files !== false);
  S.chatFiles = S.chatFiles || {};
  const pending = S.chatFiles[g.id] || (S.chatFiles[g.id] = []);
  const send = () => {
    const input = document.querySelector('[data-k="chat"]');
    const text = input.value.trim();
    if (!text && !pending.length) return;
    const files = pending.splice(0).map(f => ({ name: f.name, data: f.data, alt: "" }));
    const shown = text + (files.length ? ` (+ ${files.length} file${files.length > 1 ? "s" : ""})` : "");
    input.value = ""; S.drafts["chat:" + g.id] = "";        // before doSend draws the grey line (#48)
    const more = files.length ? { files } : {};
    if (g.type === "contact") doSend("/api/private", g.id, { key: g.key, body: text, chat: true, ...more }, { text: shown, chat: true });
    else doPost(g.id, { body: text, chat: true, ...more }, { text: shown, chat: true });
  };
  const chatFiles = takesFiles ? h("input", { type: "file", multiple: true, class: "sr", id: "chatfiles",
      accept: g.files && (g.files.types || []).length ? g.files.types.join(",") : "image/*",
      onchange: async (e) => { await readFiles(e.target.files, pending, g.files ? g.files.max_size : 0);
        e.target.value = ""; render(); } }) : null;
  if (chatFiles) chatFiles._take = async (files) => {                  // pasted, dropped (gui#187)
    await readFiles(files, pending, g.files ? g.files.max_size : 0); render(); };
  const attach = takesFiles ? [chatFiles,
    h("label", { for: "chatfiles", class: "btn icon attachbtn", title: "Add pictures to your next line",
      "aria-label": "Add pictures" }, svg(ICON.plus, 18, 2.5))] : [];
  const chips = pending.length ? h("div", { class: "chatfiles" }, pending.map((f, i) => h("span", { class: "chip" },
    h("span", { class: "mono", text: f.name }),
    h("button", { type: "button", class: "link", "aria-label": "Remove " + f.name,
      onclick: () => { pending.splice(i, 1); render(); } }, "×")))) : null;
  return h("div", { class: "content" }, h("section", { class: "chat", "aria-label": "Messages" },
    pinBar(d, msgs),
    h("div", { class: "msgs", "data-scroll": "chat:" + g.id, "data-stick": "bottom" }, out),
    g.type !== "contact" && g.kinds && !g.kinds.includes("chat") ?
      h("div", { class: "chatbar hint", text: mayWrite(d, "post").allowed ?
        "A discussion group: it takes posts with a subject only. N writes one." : mayWrite(d, "post").reason }) :
    cp.allowed ? h("form", { class: "chatbar", onsubmit: (e) => { e.preventDefault(); send(); },
      "data-nofiles": takesFiles ? null : "This group takes no files." },
      h("div", { class: "row" },
        h("label", { for: "chat", class: "sr", text: "Message " + g.label }),
        h("textarea", { id: "chat", rows: 1, class: "grow-in", "data-k": "chat", autocomplete: "off", spellcheck: "true",
          placeholder: "Message " + (g.access || "") + (g.access ? " " : "") + g.label, value: S.drafts["chat:" + g.id] || "",
          oninput: (e) => { S.drafts["chat:" + g.id] = e.target.value; growField(e.target); chatLanguage(g.id, e.target.value); },
          onkeydown: (e) => sendOnEnter(e, send) }),
        ...attach,
        languageChip(g.id),                               // what you write in here (0052 5a)
        emojiButton("chat"),
        h("button", { class: "send", type: "submit", "aria-label": "Send" }, svg(ICON.send, 18, 2.5))),
      chips,
      h("div", { class: "hint" }, h("kbd", { text: "Enter" }), " sends · ", h("kbd", { text: "Shift+Enter" }), " new line · ",
        h("kbd", { text: "Esc" }), " for shortcuts",
        g.type === "contact" ? " · sealed to them" : g.encrypted ? " · encrypted for the members" : " · signed with your key")) :
      h("div", { class: "chatbar off" }, h("div", { class: "row" },
        h("label", { for: "chat", class: "sr", text: "You cannot write here" }),
        h("input", { id: "chat", type: "text", disabled: true, "aria-describedby": "chat-why", placeholder: cp.reason || NOT_HERE }),
        h("button", { class: "send", type: "button", disabled: true, "aria-label": "Send" }, svg(ICON.send, 18, 2.5))),
        h("div", { class: "hint", id: "chat-why", text: cp.reason || NOT_HERE }))));
}
