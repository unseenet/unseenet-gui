// profiles.js - your vault's passphrase (#32) and profiles, anyone's and your own (#20, UN-RFC 0022).
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- your vault's passphrase (#32, as the TUI's Change passphrase) ------------
const COPIES_NOTE = "Only this vault file changes. Copies of it on other devices, sticks or backups still open with the old passphrase: replace or delete them.";
// Change the vault's passphrase (#32), saying where copies of the vault are and that they
// keep the old one.
function openPassphrase() {
  formDialog({ label: "Change passphrase", title: "Change passphrase", focus: "#pold", button: "Change", note: COPIES_NOTE,
    fields: (vals) => [
      GUI && GUI.vault ? h("p", { class: "hint mono", style: "margin:0", text: GUI.vault }) : null,
      h("label", { for: "pold", text: "Current passphrase" }),
      h("input", { id: "pold", name: "old", type: "password", class: "in", "data-k": "pold", autocomplete: "current-password", value: vals.old || "" }),
      h("label", { for: "pnew", text: "New passphrase" }),
      h("input", { id: "pnew", name: "pw", type: "password", class: "in", "data-k": "pnew", autocomplete: "new-password", value: vals.pw || "" }),
      h("label", { for: "pnew2", text: "The new passphrase again" }),
      h("input", { id: "pnew2", name: "pw2", type: "password", class: "in", "data-k": "pnew2", autocomplete: "new-password", value: vals.pw2 || "" })],
    submit: async (v) => {
      if ((v.pw || "") !== (v.pw2 || "")) throw new Error("The new passphrases do not match.");
      if ((v.pw || "").length < 4) throw new Error("The new passphrase is too short.");
      if (v.pw === v.old) throw new Error("The new passphrase is the same as the current one.");
      toast("Encrypting the vault with the new passphrase …");
      await api("POST", "/api/passphrase", { old: v.old || "", new: v.pw });
      closeDialog();
      toast("Passphrase changed. Copies of the vault elsewhere still open with the old one - replace or delete them.");
    } });
}

// ---- profiles (#20, UN-RFC 0022): anyone's, and your own ----------------------
// Links are shown as written and never opened by themselves (section 9.2).
function profileBody(p) {
  const obj = p.profile;
  if (p.hidden) return h("p", { style: "margin:0", text: "You have hidden this profile." });
  if (!obj || (!obj.about && !(obj.lang || []).length && !(obj.links || []).length))
    return h("p", { class: "muted", style: "margin:0", text: p.mine ? "You have no public profile yet." : "No public profile." });
  return [
    obj.about ? (p.about_tree && p.about_tree.length ? h("div", { class: "md profile-about" }, renderTree(p.about_tree)) :
      renderBody(obj.about)) : null,
    (obj.lang || []).length ? h("p", { style: "margin:0", text: "Writes: " + obj.lang.join(", ") }) : null,
    (obj.links || []).length ? [h("p", { class: "hint", style: "margin:0", text: "Links, as stated by this identity (not checked):" }),
      h("ul", { class: "profile-links" }, obj.links.map(l => h("li", { class: "mono", text: `${l.kind}: ${l.value}${l.label ? "  (" + l.label + ")" : ""}` })))] : null];
}

// where it is opened decides whether a profile shared with you or this closed group is
// shown (UN-RFC 0022 section 6): the core answers one shared there, never from elsewhere
async function openProfile(key, who = "", context = S.gid) {
  let p = null, err = "";
  const again = () => openProfile(key, who, context);
  const draw = () => dialogShell({ label: "Profile" },
    h("div", { class: "dh" }, h("h2", { text: (p && p.label) || who || "Profile" }),
      p && p.profile && p.profile.bot ? h("span", { class: "chip", text: "bot" }) : null,
      h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db" },
      h("div", { class: "prof-head" }, bigAvatar(key), h("div", { class: "keybox", text: key })),
      err ? h("p", { class: "error", text: err }) :
      !p ? h("p", { class: "muted", style: "margin:0", text: "Reading the profile over Tor …" }) :
      p.shared && !p.hidden ? [h("p", { class: "hint shared-note", style: "margin:0",
        text: p.shared.context === "me" ? "Shared with you only - shown only in your private posts and chats with them."
          : `Shared with ${p.shared.context_label} only - shown only there.` }), profileBody({ ...p, ...p.shared })] :
      profileBody(p)),
    h("div", { class: "df btns wrap" },
      // their feed and site, when they have them: opened to read, not followed (unseenet#506)
      p && !p.mine && p.theirs && p.theirs.feed ? h("button", { class: "btn", title: "Their personal feed (UN-RFC 0034) - read it without following",
        onclick: () => { closeDialog(); S.full = false; openGroup(p.theirs.feed); } }, "Their feed") :
      p && !p.mine && !p.theirs && p.feed ? h("button", { class: "btn", title: "Their personal feed, if they have one (UN-RFC 0034)",
        onclick: () => { closeDialog(); openAddress("unseenet:" + p.feed); } }, "Feed") : null,
      p && !p.mine && p.theirs && p.theirs.site ? h("button", { class: "btn", title: "Their personal site (UN-RFC 0035) - read it without following",
        onclick: () => { closeDialog(); S.full = false; openGroup(p.theirs.site); } }, "Their site") : null,
      p && !p.mine && !p.hidden ? h("button", { class: "btn", title: "Follow their feeds - nobody is told (UN-RFC 0034 section 6.1)",
        onclick: async () => { await setFollowing({ person: key, on: !p.following }, p.label || who); again(); } },
        p.following ? "Unfollow" : "Follow") : null,
      p && p.address ? h("button", { class: "btn", title: "An unseenet: address for this person (UN-RFC 0031)",
        onclick: () => copy(p.address, "The address is copied.") }, "Copy address") : null,
      p && p.address ? h("button", { class: "btn", title: "The same address as https://… on a web entrance",
        onclick: () => copyWeb(p.address, "person") }, "Copy web address") : null,
      p && !p.mine ? h("button", { class: "btn", title: "A profile only they can read, shown only to them (UN-RFC 0022 section 6)",
        onclick: () => openShareProfile(key, p.label || who) }, "Share yours") : null,
      // a chat or a private post from the profile too (gui#215)
      p && !p.mine ? h("button", { class: "btn", title: "A private chat with them (UN-RFC 0047)",
        onclick: () => { closeDialog(); openGroup("contact:" + key); } }, "Chat") : null,
      p && !p.mine ? h("button", { class: "btn", title: "Write a private post to them",
        onclick: () => { closeDialog(); openPost(key, (p.label || who || "").replace(/ √$/, "")); } }, "Post") : null,
      p && !p.mine && contactList().some(c => c.key === key) ? h("button", { class: "btn",
        onclick: () => { closeDialog(); const c = contactList().find(c => c.key === key);
          openAddContact(key, (c && c.name) || (p.label || who || "").replace(/ √$/, "")); } }, "Rename") : null,
      p && !p.mine ? (contactList().some(c => c.key === key)
        ? h("button", { class: "btn", onclick: () => { closeDialog(); removeContact(key, p.label || who); } }, "Remove contact")
        : h("button", { class: "btn", onclick: () => { closeDialog(); openAddContact(key, (p.label || who || "").replace(/~.*$/, "").replace(/^@/, "")); } }, "Add contact")) : null,
      p && p.mine ? h("button", { class: "btn", onclick: () => openMyProfile() }, "Edit") : null,
      p && p.mine ? h("button", { class: "btn", title: "Your own feed (UN-RFC 0034) - public",
        onclick: () => { closeDialog(); openMyFeed(); } },
        S.sidebar && S.sidebar.my_feed && S.sidebar.my_feed.started ? "Your feed" : "Start your feed") : null,
      p && p.mine ? h("button", { class: "btn", title: "Your own site of pages (UN-RFC 0035) - public",
        onclick: () => { closeDialog(); openMySite(); } },
        S.sidebar && S.sidebar.my_site && S.sidebar.my_site.started ? "Your site" : "Start your site") : null,
      p && !p.mine ? h("button", { class: "btn", title: "Only you stop seeing it (UN-RFC 0022 section 9.2)", onclick: async () => {
        try { await api("POST", "/api/profile/hide", { key, hidden: !p.hidden }); }
        catch (x) { toast(x.message); return; }
        toast(p.hidden ? "Profile shown." : "Profile hidden."); again(); } }, p.hidden ? "Show" : "Hide") : null,
      h("button", { class: "btn primary", onclick: closeDialog }, "Close")));
  S.dialog = { focus: ".dialog .btn.primary", render: draw };
  render();
  try { p = await api("GET", "/api/profile?key=" + encodeURIComponent(key) + (context ? "&context=" + encodeURIComponent(context) : "")); }
  catch (x) { err = x.message; }
  if (S.dialog && S.dialog.render === draw) render();
}

// A person's picture, or their identicon or initials, large for the profile dialog.
function bigAvatar(key) {
  const p = personOf(key);
  if (p && p.picture) return h("img", { class: "av big pic", src: p.picture.data, alt: p.picture.alt || "", title: p.picture.alt || "" });
  if (p && p.identicon) return identiconEl(p.identicon, "av big");
  return null;
}

// A yes-or-no dialog; ok runs on yes, danger makes the button red.
function confirmDialog({ title, text, button, danger, ok }) {
  S.dialog = { focus: ".dialog .btn.primary", render: () => dialogShell({ label: title },
    h("div", { class: "dh" }, h("h2", { text: title }), h("button", { class: "btn icon", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),
    h("div", { class: "db" }, text.split("\n\n").map(t => h("p", { style: "margin:0;white-space:pre-line", text: t }))),
    h("div", { class: "df btns" }, h("button", { class: "btn", onclick: closeDialog }, "Cancel"),
      h("button", { class: "btn primary" + (danger ? " danger" : ""), onclick: ok }, button))) };
  render();
}

// A profile's links as lines to edit: kind, value and an optional # label.
function linksText(links) {
  return (links || []).map(l => `${l.kind} ${l.value}` + (l.label ? `  # ${l.label}` : "")).join("\n");
}
// The links typed in the profile editor, checked line by line (UN-RFC 0022 links).
function parseLinks(text) {
  const out = [];
  text.split("\n").forEach((line, i) => {
    const [main, ...rest] = line.split("#");
    const parts = main.trim().split(/\s+/);
    if (!parts[0]) return;
    if (parts.length < 2) throw new Error(`Line ${i + 1}: the kind, a space, then the address.`);
    const link = { kind: parts[0].toLowerCase(), value: parts.slice(1).join(" ") };
    if (rest.join("#").trim()) link.label = rest.join("#").trim();
    out.push(link);
  });
  return out;
}

// Your own profile: open the editor with what is published.
async function openMyProfile() {
  let p;
  try { p = await api("GET", "/api/profile"); } catch (x) { toast(x.message); return; }
  if (!p.published) {               // the warning before the first, as in the TUI
    confirmDialog({ title: "Before you publish a profile", text: p.warning, button: "I understand", ok: () => editProfile(p) });
    return;
  }
  editProfile(p);
}

// A profile for one person or a closed group only (UN-RFC 0022 section 6, as the TUI's
// Share your profile): for those who want no public profile, or another one for friends.
// `to` is their key (or their chat) or the closed group; nothing is published.
async function openShareProfile(to, who) {
  let p;
  try { p = await api("GET", "/api/profile"); } catch (x) { toast(x.message); return; }
  editProfile(p, { to, who });
}
// Who a private profile would be shared with here: the person of the chat shown, if any.
function shareTarget() {
  const g = S.data && S.data.group;
  if (!g) return null;
  if (g.type === "closed") return { to: g.id, who: "the members of " + g.label };
  if (String(g.id || "").startsWith("contact:")) return { to: g.id, who: g.label };
  return null;
}
// Take back a profile shared privately: an empty one goes to them.
function withdrawShared({ to, who }) {
  confirmDialog({ title: "Take back your shared profile?", button: "Take back",
    text: `An empty profile goes to ${who}, and the one you shared is no longer shown. Copies they already kept cannot be taken back.`,
    ok: async () => { try { await api("POST", "/api/profile/share", { to, withdraw: true }); closeDialog(); toast(`Shared profile taken back from ${who}.`); }
      catch (x) { toast(x.message); } } });
}

// The profile editor: about (Markdown or plain), links, picture, bot mark; publish, or
// share privately with one person.
function editProfile(p, share = null) {
  const cur = p.profile || {};
  const md = cur.about ? /markdown/i.test(cur.about_type || "") : !(S.sidebar && S.sidebar.markdown === false);
  // Your picture is set here too (#82, UN-RFC 0022 section 8.5): shown exactly as it will
  // be published before it is, with the warning before the first.
  const pic = { file: null, preview: null, alt: (p.picture && p.picture.alt) || "", remove: false, err: "", busy: false };
  let dialog = null;
  const choose = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    Object.assign(pic, { err: "", busy: true, remove: false }); dialog.refresh();
    try {
      pic.file = await new Promise((ok, bad) => { const r = new FileReader();
        r.onload = () => ok(String(r.result).split(",", 2)[1] || ""); r.onerror = bad; r.readAsDataURL(file); });
      pic.preview = (await api("POST", "/api/profile/picture", { data: pic.file, alt: pic.alt, preview: true })).picture;
    } catch (x) { pic.err = x.message; pic.file = pic.preview = null; }
    pic.busy = false; dialog.refresh();
  };
  const shown = () => pic.remove ? null : (pic.preview || p.picture);
  const picturePart = () => [
    h("div", { class: "prof-head" },
      shown() ? h("img", { class: "av big pic", src: shown().data, alt: pic.alt || "" }) : bigAvatar(p.key),
      h("div", { class: "pic-side" },
        h("p", { class: "hint", style: "margin:0", text: pic.preview ? "Your new picture, exactly as it will be published: a square, at most 128 pixels, without where or when it was taken." :
          pic.remove ? "Your picture will be removed: your identicon is shown instead." :
          p.picture ? "Your picture - anybody can see it." : "No picture: your identicon is shown, made from your key." }),
        h("div", { class: "pic-btns" },
          h("label", { for: "picfile", class: "btn" }, pic.busy ? "Making it …" : p.picture || pic.preview ? "Choose another" : "Choose a picture"),
          Object.assign(h("input", { id: "picfile", type: "file", accept: "image/*", class: "sr", onchange: choose }),
            { _take: (files) => choose({ target: { files } }) }),          // pasted, dropped (gui#187)
          (p.picture || pic.preview) && !pic.remove ? h("button", { type: "button", class: "link", onclick: () => {
            Object.assign(pic, { file: null, preview: null, remove: !!p.picture }); dialog.refresh(); } }, "Remove picture") : null))),
    shown() || pic.file ? [h("label", { for: "picalt", text: "Picture description, for people who cannot see it" }),
      h("input", { id: "picalt", class: "in", maxlength: 128, "data-k": "picalt", value: pic.alt, oninput: (e) => { pic.alt = e.target.value; } })] : null,
    !p.picture && pic.preview ? h("p", { class: "hint warn-line", style: "margin:0;white-space:pre-line", text: p.picture_warning || "" }) : null,
    pic.err ? h("p", { class: "error", text: pic.err }) : null];
  const publishPicture = async () => {
    if (pic.file) await api("POST", "/api/profile/picture", { data: pic.file, alt: pic.alt });
    else if (pic.remove) await api("POST", "/api/profile/picture", { remove: true });
    else return false;
    PEOPLE.delete(p.key);
    return true;
  };
  const publish = async (body) => {
    await api("POST", "/api/profile", body.remove ? null : { edit: body });
    const picture = body.remove ? false : await publishPicture();
    closeDialog(); render();
    toast(body.remove ? "Your profile is removed." : picture ? "Your profile and picture are published." : "Your profile is published.");
  };
  const shareIt = (body) => confirmDialog({ title: "Share your profile", button: "Share",
    text: `Only ${share.who} can read it, and it is shown only there - your public profile, if you have one, stays as it is. You can take it back later.`,
    ok: async () => { try { await api("POST", "/api/profile/share", { to: share.to, profile: { edit: body } }); closeDialog(); toast(`Profile shared with ${share.who}.`); }
      catch (x) { toast(x.message); } } });
  dialog = formDialog({ label: share ? "Share your profile" : "Your profile", focus: "#pabout", button: share ? "Share …" : "Publish",
    title: share ? `A profile for ${share.who} only` : "Your public profile - anybody can read it",
    values: { about: cur.about || "", markdown: md, lang: (cur.lang || []).join(", "), links: linksText(cur.links) },
    note: "Kinds of links: " + (p.link_kinds || []).join(", ") + ", or x-something. Links are shown as written; nobody checks them." +
      (share ? "" : " What you see blurred or hidden - for a child, say - is set under Who reads on this device (Ctrl K), never in your profile."),
    fields: (vals) => [
      ...(share ? [] : picturePart()),      // your picture is public: not in a shared profile
      h("label", { for: "pabout", text: "About you - a few lines, or a small home page" }),
      h("textarea", { id: "pabout", name: "about", class: "in", "data-k": "pabout", value: vals.about, style: "min-height:120px" }),
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "markdown", checked: !!vals.markdown }),
        " Markdown - # headings, - lists, **strong**, [links](https://...), :tada: (no pictures)"),
      h("label", { for: "plang", text: "Languages you write, e.g. da, en" }),
      h("input", { id: "plang", name: "lang", class: "in", "data-k": "plang", value: vals.lang }),
      h("label", { for: "plinks", text: "Links, one per line: kind address  (# a label)" }),
      h("textarea", { id: "plinks", name: "links", class: "in mono", "data-k": "plinks", value: vals.links, style: "min-height:80px" }),
      p.published && !share ? h("button", { type: "button", class: "link", onclick: () => confirmDialog({ title: "Remove your profile?",
        text: "Nodes stop showing it. Copies others already kept cannot be taken back.", button: "Remove", danger: true,
        ok: () => publish({ remove: true }).catch(x => toast(x.message)) }) }, "Remove your profile") : null],
    submit: async (v) => {
      const links = parseLinks(v.links || "");
      const body = { about: v.about || "", markdown: !!v.markdown, lang: v.lang || "", links };
      if (share) { shareIt(body); return; }
      const old = new Set((cur.links || []).map(l => l.kind + " " + l.value));
      const added = links.filter(l => !old.has(l.kind + " " + l.value) && l.kind !== "onion");
      if (added.length && p.published) {     // each new link ties this identity to that account
        confirmDialog({ title: "New links", button: "Publish",
          text: "Each link ties this identity, and everything it posts, to that account:\n\n" + added.map(l => `${l.kind}: ${l.value}`).join("\n"),
          ok: () => publish(body).catch(x => toast(x.message)) });
        return;
      }
      await publish(body);
    } });
}

// The post selected in the threads list, or null in a chat.
function selectedPost() {
  return (S.data && S.data.group && S.data.group.view !== "chat" && S.data.messages.find(x => x.id === S.post)) || null;
}

// The command palette's commands here (Ctrl+K): each with its name, key and when it is
// offered.
function commands() {
  const g = S.data && S.data.group;
  const cmds = [
    { name: "New post", key: "N", when: g && g.type && mayWrite(S.data, "post").allowed && g.view !== "chat", run: openCompose },
    { name: "Switch between chat and threads", key: "V", when: g && g.type && g.type !== "inbox", run: toggleView },
    { name: "About this group: rules, type, owner", key: "?", when: g && g.type, run: openInfo },
    { net: true, name: "Find groups on your nodes", key: "G", run: openBrowse },
    { net: true, name: "Who reads this inbox: readers with team keys", key: "", also: "team inbox readers operator",
      when: g && g.type === "inbox" && g.owner && !(S.sidebar && S.sidebar.inbox && S.sidebar.inbox.id === g.id),
      run: () => openTeamReaders(g) },
    { name: "Your rules: what comes first, what is hidden or folded", key: "", also: "scorefile killfile score filter sort regler", run: openRules },
    { net: true, name: "Spam reports: the issuers that hide posts for you", key: "", also: "spam report issuer nocem hidden skjult", run: openReportIssuers },
    { net: true, name: "Content warnings and labels", key: "", also: "spoiler nsfw blur sløret advarsel labeller tags age alder", run: openContentWarnings },
    { net: true, name: "Who reads on this device: an age guide for warnings", key: "", also: "age alder barn child kids parental", run: openAgeGuide },
    { net: true, name: "Show all here, for now - nothing changes in your settings", key: "", also: "rules regler pause all alle", run: toggleShowAll },
    { net: true, name: isIssuer() ? "Your spam reports: sent to you, published, withdraw" : "Become a spam report issuer", key: "",
      also: "spam report issuer publish publicer", run: openIssuing },
    { name: "Your nodes: add, remove, choose the default", key: "", also: "node server switch change onion noder skift", run: openNodes },
    { net: true, name: "Create a group", key: "", run: openCreateGroup },
    { name: "Write a private post", key: "M", run: () => openWrite("", "post") },
    { name: "Contacts", key: "C", run: openContacts },
    { net: true, name: "Names: claim yours, ask for one, give names under yours", key: "@", run: openNames },
    { name: "People you ignore", key: "", run: openIgnored },
    { name: S.sidebar && S.sidebar.notices && S.sidebar.notices.send === false ? "Tell people you mention" : "Stop telling people you mention", key: "",
      run: async () => { const on = !!(S.sidebar && S.sidebar.notices && S.sidebar.notices.send === false);
        await api("POST", "/api/settings", { notices: { send: on } }); await loadSidebar();
        toast(on ? "People you mention by name are told in their inbox (you can say no per post)." : "People you mention are no longer told; they see it if they follow the group."); } },
    { name: S.sidebar && S.sidebar.notices && S.sidebar.notices.receive === false ? "Show mention notices" : "Stop showing mention notices", key: "",
      run: async () => { const on = !!(S.sidebar && S.sidebar.notices && S.sidebar.notices.receive === false);
        await api("POST", "/api/settings", { notices: { receive: on } }); await loadSidebar();
        toast(on ? "Mentions of you in groups you do not follow show in For you." : "Mention notices from others are no longer shown."); } },
    { name: S.sidebar && S.sidebar.markdown === false ? "Write Markdown (*emphasis*, `code`, :tada:)" : "Write plain text instead of Markdown", key: "",
      run: async () => { const on = !(S.sidebar && S.sidebar.markdown !== false); await api("POST", "/api/settings", { markdown: on }); await loadSidebar();
        toast(on ? "You write Markdown: *emphasis*, **strong**, `code`, lists, :tada:" : "You write plain text: sent and shown exactly as typed."); } },
    { name: S.sidebar && S.sidebar.show_blocked ? "Hide posts blocked by maintainers" : "Show posts blocked by maintainers", key: "", run: toggleShowBlocked },
    { name: S.sidebar && S.sidebar.hide_bots ? "Show bots" : "Hide bots: posts by keys that say they post automatically", key: "", run: toggleBots },
    { name: S.sidebar && S.sidebar.pictures === false ? "Show people's pictures" : "Identicons only: do not show people's pictures", key: "", run: togglePictures },
    { net: true, name: "Your picture: in your profile", key: "", run: openMyProfile },
    // the owner's and moderators' tools, as in the TUI's Ctrl+P
    { net: true, name: "To approve: posts waiting in groups you moderate", key: "", run: openModeration },
    { net: true, name: "Edit this group", key: "", when: g && g.owner, run: openEditGroup },
    { net: true, name: "Moderators and posters", key: "", when: g && g.owner && g.type !== "closed", run: openRoles },
    { net: true, name: "Banned from this group", key: "", when: g && g.owner, run: () => openBanned() },
    { net: true, name: "Remove this group from the network", key: "", when: g && g.owner, run: openRemoveGroup },
    { name: "Leave this group", key: "", also: "unsubscribe unfollow stop following forlad", when: g && g.type && !["inbox", "contact"].includes(g.type) && g.subscribed !== false, run: () => leaveGroup(g) },
    { net: true, name: g && g.timeline && g.timeline.on ? "Take this group out of the timeline" : "Add this group to the timeline",
      key: "", also: "timeline feed tidslinje", when: g && g.subscribed !== false && g.timeline && g.timeline.possible, run: () => setTimeline(g, !g.timeline.on) },
    { net: true, name: "Withdraw (delete) the selected post", key: "D", also: "delete remove slet fjern tilbagetræk",
      when: selectedPost() && selectedPost().may_withdraw, run: () => openWithdraw(selectedPost()) },
    { net: true, name: "Pin the selected post", key: "", when: S.data && S.data.group.may_pin && selectedPost() && !selectedPost().pinned, run: () => openPin(selectedPost()) },
    { net: true, name: "Unpin the selected post", key: "", when: S.data && S.data.group.may_pin && selectedPost() && selectedPost().pinned, run: () => openPin(selectedPost()) },
    { name: "Pinned posts in this group", key: "", when: pinsOf(S.data).length > 0, run: () => openPinList() },
    { net: true, name: "Open an unseenet: address", key: "", run: openAddressDialog },
    { name: "Timeline: the groups you have in it, newest first", key: "", when: S.sidebar && S.sidebar.timeline.feeds > 0, run: () => openGroup(TIMELINE) },
    { net: true, name: "Follow someone: their feeds, by key, name or address", key: "", run: openFollow },
    { name: "Whom you follow", key: "", run: openFollowing },
    // going to them works offline; starting one needs the network
    { net: !(S.sidebar && S.sidebar.my_feed && S.sidebar.my_feed.started), name: "Your feed: start it, or go to it", key: "", run: openMyFeed },
    { net: !(S.sidebar && S.sidebar.my_site && S.sidebar.my_site.started), name: "Your site: start it, or go to it", key: "", run: openMySite },
    { name: "New page on this site", key: "", when: S.data && S.data.site && S.data.site.may_write,
      run: () => openPageEditor(S.data.group, S.data.site, null) },
    { net: true, name: "Publish a folder as this site", key: "", also: "import upload markdown html folder site",
      when: publishPossible(), run: openPublishFolder },                // #125 (publish.js)
    { name: "Show this group as a feed", key: "", when: g && g.type && !["inbox", "contact"].includes(g.type) && g.view !== "feed",
      run: async () => { await api("POST", `/api/groups/${encodeURIComponent(g.id)}/view`, { view: "feed" }); await loadGroup(); await loadSidebar(); render(); } },
    { name: "Copy the address of this group", key: "", when: g && g.address, run: () => copy(g.address, "The group's address is copied.") },
    { name: "Copy the address of the selected post", key: "", when: selectedPost() && selectedPost().address && !selectedPost().private,
      run: () => copy(selectedPost().address, "The post's address is copied.") },
    { name: "Copy the web address of this group (https://…)", key: "", when: g && g.address, run: () => copyWeb(g.address, "group") },
    { name: "Copy the web address of the selected post (https://…)", key: "", when: selectedPost() && selectedPost().address && !selectedPost().private,
      run: () => copyWeb(selectedPost().address, "post") },
    { name: "Go to a !group in the selected post", key: "!", when: selectedPost() && (selectedPost().groups || []).length, run: () => groupsInPost(selectedPost()) },
    { net: true, name: "Report the selected post", key: "", when: selectedPost() && !selectedPost().mine && !selectedPost().private, run: () => openReport(selectedPost()) },
    { name: "Add a contact", key: "", run: () => openAddContact("", "") },
    { name: "Close this chat", key: "", also: "hide archive remove luk skjul", when: g && g.type === "contact",
      run: () => closeChat(g.key, g.label.replace(/ √$/, "")) },
    { net: true, name: "Invite to this closed group", key: "", when: g && g.owner && g.type === "closed", run: openInvite },
    { name: "Edit your signature", key: "", run: openSignature },
    { net: true, name: "Profile of this author: about, languages, links (UN-RFC 0022)", key: "", when: selectedPost() && selectedPost().key,
      run: () => openProfile(selectedPost().key, selectedPost().who) },
    { net: true, name: "Your profile: write, change or remove it", key: "", run: openMyProfile },
    { net: true, name: g && g.type === "closed" ? "Share your profile with this group only" : "Share your profile with this person only", key: "",
      when: !!shareTarget(), run: () => openShareProfile(shareTarget().to, shareTarget().who) },
    { net: true, name: "Take back the profile you shared here", key: "", when: !!shareTarget(), run: () => withdrawShared(shareTarget()) },
    { name: "Change passphrase (copies of the vault elsewhere keep the old one)", key: "", run: openPassphrase },
    ...notifyCommands(),                                      // #126 (notify.js)
    { name: "Export your data", key: "", also: "export download backup takeout data gdpr",
      when: exportPossible(), run: openExport },                    // #141 (export.js)
    { name: "Show recovery words" + (S.state.identity && !S.state.identity.words_written ? " (not written down yet)" : ""),
      key: "", also: "backup recovery seed words gendannelse", run: () => openShowWords(false) },
    { name: "Restore from recovery words", key: "", also: "recover backup words", run: openRestore },
    { net: true, name: "Copy to another device (a code or QR code, then two check words)", key: "", also: "phone move transfer qr",
      when: !S.state.web, run: openCopyTo },
    { net: true, name: "Get identity from another device", key: "", also: "phone move transfer qr receive", run: openCopyFrom },
    { net: true, name: "Update Unseenet", key: "", when: !!S.state.update, run: openUpdate },
    { name: "Network and Wi-Fi", key: "", when: S.state.bootable, run: openNetwork },
    { name: "Restart the computer", key: "", when: S.state.bootable, run: () => power("reboot") },
    { name: "Shut down the computer", key: "", when: S.state.bootable, run: () => power("poweroff") },
    { name: theme() === "light" ? "Use the dark theme" : "Use the light theme", key: "", run: () => { theme(theme() === "light" ? "dark" : "light"); render(); } },
    { name: "Follow the system's theme", key: "", when: !!THEME, run: () => { theme(null); render(); } },
    { name: S.sidebar && S.sidebar.state_local ? "Your state: keep it in the network again" : "Your state: keep it on this device only",
      key: "", when: !!S.sidebar, run: openStateWhere },
    { name: "Show your key", key: "K", run: openKey },
    { name: "Key ripening: your level, what it means" + (S.ripening && typeof S.ripening.paused === "boolean" ? ", pause or resume" : ""),
      key: "", when: !!S.ripening, run: openRipening },
    { name: "About Unseenet: what it is, why, and how it protects you", key: "F1", run: openAbout },
    { name: "Refresh now", key: "", run: () => api("POST", "/api/refresh").then(() => toast("Refreshing …")) },
    { name: "Private posts", key: "", when: S.sidebar && S.sidebar.inbox.id, run: () => openGroup(S.sidebar.inbox.id) },
    { name: "Private chats: every person you chat with", key: "", also: "chats people dm messages beskeder", run: () => openGroup(CHATS) },
    { name: "Chat with someone", key: "", run: () => openWrite("", "chat") },
    { name: "For you: replies and mentions", key: "", run: () => openGroup(FOR_YOU) },
  ].filter(c => c.when === undefined || c.when);
  return cmds.concat(allGroups().map(x => ({ name: x.label, group: x, key: "", run: () => openGroup(x.id) })));
}

// The command palette: type to find a command, Enter to run it.
function openPalette() {
  let q = "", sel = 0;
  const shown = () => commands().filter(c => !q || c.name.toLowerCase().includes(q) ||
    (c.also && c.also.includes(q)) ||
    (c.group && (c.group.title || "").toLowerCase().includes(q)));
  // a command that needs the network, while Unseenet is not connected yet: said, not run -
  // it is ready by itself once connected (the palette is drawn again then)
  const waiting = (c) => c.net && !(S.state && S.state.connected);
  const run = (c) => {
    if (waiting(c)) { toast("Waiting for the network: this is ready as soon as Unseenet is connected."); return; }
    S.dialog = null; render(); c.run();
  };
  S.dialog = { focus: "#palette", render: () => {
    const list = shown();
    sel = Math.max(0, Math.min(sel, list.length - 1));
    const acts = list.filter(c => !c.group), grps = list.filter(c => c.group);
    const row = (c) => h("button", { class: "cmd" + (list.indexOf(c) === sel ? " on" : "") + (waiting(c) ? " waiting" : ""),
      "aria-disabled": waiting(c) ? "true" : null, title: waiting(c) ? "Needs the network - not connected yet" : null,
      onclick: () => run(c),
      onmousemove: () => { if (list.indexOf(c) !== sel) { sel = list.indexOf(c); render(); } } },
      c.group ? h("span", { class: "mono muted", style: "width:28px", text: (c.group.access || "") + c.group.icon }) : null,
      h("span", { class: "nm" + (c.group ? " mono" : ""), text: c.name }),
      waiting(c) ? h("span", { class: "wait", text: "waiting for the network" }) : null,
      c.group && c.group.unread ? h("span", { class: "count", text: c.group.unread }) : null,
      c.key ? h("kbd", { text: c.key }) : null);
    return dialogShell({ label: "Command palette" },
      h("div", { class: "dh" }, svg(ICON.search, 18),
        h("label", { for: "palette", class: "sr", text: "Search commands and groups" }),
        h("input", { id: "palette", "data-k": "palette", placeholder: "Commands and groups …", value: q, autocomplete: "off",
          oninput: (e) => { q = e.target.value.toLowerCase(); sel = 0; render(); },
          onkeydown: (e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); sel++; render(); }
            else if (e.key === "ArrowUp") { e.preventDefault(); sel--; render(); }
            // the Enter that runs a command is the palette's: it must not reach the page too,
            // where it would open the post shown - a command that fetches first leaves the
            // page without a dialog for a moment
            else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); const c = shown()[sel]; if (c) run(c); }
          } }),
        h("kbd", { text: "Esc" }),
        h("button", { class: "btn icon pal-close", "aria-label": "Close", onclick: closeDialog }, svg(ICON.x))),   // phones: no Esc key
      h("div", { class: "db list", "data-scroll": "palette" },
        S.state && !S.state.connected ? h("p", { class: "pal-offline", role: "status",
          text: "Not connected yet - " + (S.state.status || "connecting").replace(/[\s.…]+$/, "") +
            ". What needs the network is grey until then." }) : null,
        acts.length ? [h("div", { class: "sect", text: "Commands" }), acts.map(row)] : null,
        grps.length ? [h("div", { class: "sect", text: "Your groups" }), grps.map(row)] : null,
        !list.length ? h("p", { class: "muted", style: "padding:12px", text: "Nothing matches." }) : null),
      h("div", { class: "df keys-only" }, h("span", { text: "↑↓ move" }), h("span", { text: "Enter run" }), h("span", { text: "Esc close" })));
  } };
  render();
}
