"""Every screen and dialog the layout test opens (gui#264), shared with tools/layout_audit.py.

Each is a name and the JavaScript that brings it up from the app with nothing open; ``G(name)``
finds a group by its name. Add a screen or dialog here when you add one to the client.
"""
from pathlib import Path

# phones (touch), a small laptop, a desktop, a wide screen (gui#264)
SIZES = {"phone360": (360, 740, True), "phone390": (390, 844, True), "laptop": (1024, 640, False),
         "desktop": (1280, 800, False), "wide": (1920, 1080, False)}

# how much of a phone's height the on-screen keyboard takes
KEYBOARD = 300

# the checks, run in the page (comment lines dropped, so Playwright sees a function)
CHECK = "\n".join(line for line in (Path(__file__).parent / "layout_check.js").read_text().splitlines()
                  if not line.startswith("//"))

PRELUDE = """window.G = (name) => { const g = allGroups().find(g => g.label === name || g.id.split('@')[0] === name);
  return g ? g.id : null; };"""

VIEWS = {
    "groups": "S.pane='groups'; S.gid=null; render()",
    "threads": "openGroup(G('unseenet'))",
    "thread-open": "openGroup(G('unseenet')).then(()=>{const r=document.querySelector('.prow:not(.head)'); r&&r.click();})",
    "chat": "openGroup(G('dk.snak.chat'))",
    "closed-chat": "openGroup(G('operators'))",
    "channel": "openGroup(G('dev.news'))",
    "foryou": "openGroup(FOR_YOU)",
    "timeline": "openGroup(TIMELINE)",
    "chats": "openGroup(CHATS)",
    "contacts": "openGroup(CONTACTS)",
    "you": "openGroup(YOU)",
    "private": "openGroup(PRIVATE)",
}

DIALOGS = {
    "key": "openKey()",
    "about": "openAbout()",
    "nodes": "openNodes()",
    "add-node": "openNodes(); await new Promise(r => setTimeout(r, 200)); "
                "const b = document.querySelector('.dialog .db'); if (b) b.scrollTop = 1e6;",
    "palette": "openPalette()",
    "my-profile": "openMyProfile()",
    "someones-profile": "openProfile((allGroups().find(g=>g.owner_key)||{}).owner_key || S.state.me.key, 'Mikkel')",
    "passphrase": "openPassphrase()",
    "create-group": "openCreateGroup()",
    "find-groups": "openBrowse()",
    "write-post": "openWrite('', 'post')",
    "write-chat": "openPersonPicker('chat')",
    "show-words": "openShowWords()",
    "restore": "openRestore()",
    "copy-to": "openCopyTo()",
    "copy-from": "openCopyFrom()",
    "export": "openExport()",
    "rules": "openRules()",
    "report-issuers": "openReportIssuers()",
    "content-warnings": "openContentWarnings()",
    "ripening": "openRipening()",
    "follow": "openFollow()",
    "following": "openFollowing()",
    "address": "openAddressDialog()",
    "ignored": "openIgnored()",
    "names": "openNames()",
    "state-where": "openStateWhere()",
    # in a group
    "info": "openGroup(G('unseenet')).then(()=>openInfo())",
    "compose-post": "openGroup(G('unseenet')).then(()=>openCompose())",
    "edit-group": "openGroup(G('unseenet')).then(()=>openEditGroup())",
    "roles": "openGroup(G('unseenet')).then(()=>openRoles())",
    "invite": "openGroup(G('operators')).then(()=>openInvite())",
    "group-emoji": "openGroup(G('unseenet')).then(()=>openGroupEmoji())",
    "moderation": "openGroup(G('unseenet')).then(()=>openModeration())",
    "pins": "openGroup(G('unseenet')).then(()=>openPinList())",
}


def script(js: str) -> str:
    """The function Playwright runs to bring up a screen: ``js`` after the helpers, its
    errors kept in window.__err rather than thrown, so one screen does not stop the rest."""
    return ("async () => { " + PRELUDE + " try { await (async () => { " + js +
            " })(); } catch (e) { window.__err = String(e); } }")


# Put the cursor in a dialog's first text field, as a person about to type; whether it has one.
FOCUS_FIELD = """() => { const f = document.querySelector(
  '.dialog input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]), .dialog textarea');
  if (!f) return false; f.focus(); return true; }"""

# Close whatever dialog is open and go back to the list of groups.
RESET = "() => { if (S.dialog) closeDialog(); }"
