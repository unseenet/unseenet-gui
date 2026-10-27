// langpick.js - choosing what you write in (UN-RFC 0052 5a, unseenet#686): one small
// button with the language's code and own name, and a list to pick from or search - in
// the compose window and by the chat and comment inputs. The list is the core's
// (/api/languages): own names, no flags (a flag is a country, not a language).
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// The core's list, fetched once: [{code, name, english, recognised}].
async function languageList() {
  if (S.languages) return S.languages;
  try { S.languages = (await api("GET", "/api/languages")).languages || []; }
  catch (_) { S.languages = []; }
  return S.languages;
}

// A language's own name, from the list when it is here, else its code.
function languageName(code) {
  const l = (S.languages || []).find(x => x.code === code);
  return l ? l.name : code;
}

// The button: "EN English ▾", or "None ▾". ``codes`` what is chosen now; ``pick(codes)``
// when you choose; ``why`` a short word for where it came from, as a tooltip.
function languageButton(codes, pick, opts = {}) {
  codes = codes || [];
  if (!S.languages && !S.languagesAsked) {            // the names come with the list: once
    S.languagesAsked = true;
    languageList().then(() => render());
  }
  const label = codes.length ? [h("span", { class: "lbadge", text: codes[0].toUpperCase() }),
    h("span", { class: "lname", text: codes.map(languageName).join(", ") })] : h("span", { class: "lname", text: "None" });
  return h("button", { type: "button", class: "langbtn" + (opts.small ? " small" : ""), "aria-haspopup": "listbox",
    title: (opts.why ? opts.why + " - " : "") + "what you write in; click to change",
    "aria-label": "Language: " + (codes.map(languageName).join(", ") || "none") + ", change",
    onclick: async (e) => { e.preventDefault(); e.stopPropagation(); await openLanguagePicker(e.currentTarget, codes, pick, opts); } },
    label, h("span", { class: "caret", "aria-hidden": "true", text: "▾" }));
}

// The list by the button: Suggested and This group first, then the languages a text can
// be told in, then the rest, and None; a search box that finds "da", "dansk", "danish".
async function openLanguagePicker(anchor, current, pick, opts = {}) {
  closeLanguagePicker();
  const all = await languageList();
  const seen = new Set();
  const row = (code, extra) => {
    if (seen.has(code)) return null;
    seen.add(code);
    const l = all.find(x => x.code === code) || { code, name: code, english: code };
    return h("button", { type: "button", role: "option", class: "lpick" + (current.includes(code) ? " on" : ""),
      "aria-selected": String(current.includes(code)), "data-code": code,
      "data-find": (l.code + " " + l.name + " " + l.english).toLowerCase(),
      onclick: () => { closeLanguagePicker(); pick([code]); } },
      h("span", { class: "lbadge", text: code.toUpperCase() }), h("span", { class: "lname", text: l.name }),
      l.name !== l.english ? h("span", { class: "lhint", text: l.english }) : null,
      extra ? h("span", { class: "lhint", text: extra }) : null);
  };
  const section = (title, items) => {
    const list = items.filter(Boolean);
    return list.length ? [h("div", { class: "lsec", text: title }), ...list] : [];
  };
  const box = h("div", { class: "langpop", role: "listbox", "aria-label": "Languages" },
    h("input", { class: "in lsearch", placeholder: "Search: da, dansk, español …", "aria-label": "Search languages",
      oninput: (e) => {
        const q = e.target.value.trim().toLowerCase();
        box.querySelectorAll(".lpick").forEach(b => { b.hidden = !!q && !(b.dataset.find || "").split(" ").some(w => w.startsWith(q)); });
        box.querySelectorAll(".lsec").forEach(s => { s.hidden = !!q; });
      },
      onkeydown: (e) => {
        if (e.key === "Escape") { closeLanguagePicker(); anchor.focus(); }
        if (e.key === "Enter") {
          e.preventDefault();
          const first = [...box.querySelectorAll(".lpick")].find(b => !b.hidden);
          const typed = e.target.value.trim().toLowerCase();
          if (first) first.click();
          else if (/^[a-z]{2,3}$/.test(typed)) { closeLanguagePicker(); pick([typed]); }
        }
      } }),
    h("div", { class: "lscroll" },
      ...section("Suggested", (opts.suggested || []).map(c => row(c, opts.suggestedWhy || ""))),
      ...section("This group", (opts.group || []).map(c => row(c))),
      ...section("Told from your text", all.filter(x => x.recognised).map(x => row(x.code))),
      ...section("More", all.filter(x => !x.recognised).map(x => row(x.code))),
      h("button", { type: "button", role: "option", class: "lpick none", "data-find": "none ingen",
        onclick: () => { closeLanguagePicker(); pick([]); } },
        h("span", { class: "lname", text: "None" }), h("span", { class: "lhint", text: "no language is sent" }))));
  document.body.append(box);
  const r = anchor.getBoundingClientRect();
  const top = r.bottom + 4 + 320 > window.innerHeight ? Math.max(8, r.top - 324) : r.bottom + 4;
  box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 300)) + "px";
  box.style.top = top + "px";
  S.langPop = { box, anchor };
  setTimeout(() => {
    box.querySelector(".lsearch").focus();
    document.addEventListener("pointerdown", langPopOutside, true);
  });
}

// Close the list when you click elsewhere.
function langPopOutside(e) {
  if (S.langPop && !S.langPop.box.contains(e.target) && !S.langPop.anchor.contains(e.target)) closeLanguagePicker();
}

// Close the list, if it is open.
function closeLanguagePicker() {
  if (!S.langPop) return;
  S.langPop.box.remove();
  S.langPop = null;
  document.removeEventListener("pointerdown", langPopOutside, true);
}
