// Export my data (#141, on the core's export, unseenet#577 / UN-RFC 0049 section 7):
// your articles as signed, their files, your sites, profile and state - never keys -
// saved in Downloads; private posts and chats only when chosen, and then the whole
// file encrypted with a passphrase. Not in the browser build yet (no Downloads there).
// Uses app.js's helpers: h, api, toast, S, render, dialogShell, closeDialog.
"use strict";

function exportPossible() { return !(S.state && S.state.web) && S.state && S.state.unlocked; }

function openExport() {
  const st = { private: false, pass: "", again: "", busy: false, error: "", done: null };
  const go = async () => {
    if (st.private && (st.pass.length < 8 || st.pass !== st.again)) {
      st.error = st.pass !== st.again ? "The passphrases differ." : "Use a passphrase of at least 8 characters.";
      render(); return;
    }
    st.busy = true; st.error = ""; render();
    try {
      st.done = await api("POST", "/api/export", { private: st.private, passphrase: st.private ? st.pass : null });
    } catch (x) { st.error = x.message; }
    st.busy = false; st.pass = st.again = ""; render();
  };
  S.dialog = { focus: ".dialog .btn.primary", render: () => dialogShell({ label: "Export my data" },
    h("div", { class: "dh" }, h("h2", { text: "Export my data" })),
    st.done ? h("div", { class: "db" },
      h("p", { style: "margin:0" }, "Saved: ", h("span", { class: "mono", text: st.done.path })),
      h("p", { class: "hint", style: "margin:0", text: `${st.done.articles} articles, ${st.done.files} files, ${st.done.sites} sites` +
        (st.done.encrypted ? `, ${st.done.private} private messages - encrypted with your passphrase.` : ".") +
        (st.done.missing ? ` ${st.done.missing} could not be had from the nodes.` : "") }),
      h("p", { class: "hint", style: "margin:0", text: st.done.note })) :
    h("div", { class: "db" },
      h("p", { style: "margin:0", text: "A zip with your own posts, comments, chat lines and pages exactly as you signed them - anyone can check them against your key - with their pictures and files, your profile and the groups you follow." }),
      h("p", { class: "hint", style: "margin:0", text: "Never your keys: an export is not a backup of your identity (your recovery words are). It holds what the nodes still carry and what this computer has kept, not everything you ever wrote." }),
      h("label", { class: "check" },
        h("input", { type: "checkbox", checked: st.private, onchange: e => { st.private = e.target.checked; render(); } }),
        " Include private posts and chats (both sides)"),
      st.private ? [
        h("p", { class: "hint", style: "margin:0", text: "Then the whole file is encrypted with a passphrase - without it, it cannot be opened. Write it down." }),
        h("input", { type: "password", class: "input", placeholder: "Passphrase for the export", "aria-label": "Passphrase for the export",
          value: st.pass, oninput: e => { st.pass = e.target.value; } }),
        h("input", { type: "password", class: "input", placeholder: "Again", "aria-label": "The passphrase again",
          value: st.again, oninput: e => { st.again = e.target.value; } })] : null,
      st.error ? h("p", { class: "warn", text: st.error }) : null),
    h("div", { class: "df btns" },
      h("button", { class: "btn", onclick: closeDialog }, st.done ? "Close" : "Cancel"),
      st.done ? null : h("button", { class: "btn primary", disabled: st.busy, onclick: go },
        st.busy ? "Exporting…" : "Export"))) };
  render();
}
