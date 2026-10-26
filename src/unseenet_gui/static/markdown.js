// markdown.js - Markdown and emoji: the core's safe tree as DOM (UN-RFC 0031).
//
// Part of the page, split from app.js by area (#152): plain scripts in static/,
// loaded in index.html's order, sharing one scope - no build step, the same in the local
// GUI, the portable and bootable builds and the browser build. Uses core.js's
// helpers (h, api, S, render, toast ...).
"use strict";

// ---- Markdown and emoji (UN-RFC 0031): the core's safe tree as DOM, as the TUI shows it ----
// Nothing here loads anything: images come only from attachments (and until those
// exist, show their description), and links open only on a click, with a warning
// before leaving Tor.
function messageBody(m) {
  if (!m.readable) return h("p", { class: "text bad", text: m.error || "Could not be read." });
  RENDERING = m;
  const body = m.markdown ? h("div", { class: "md" }, renderTree(m.tree || [])) : renderBody(m.text || "");
  RENDERING = null;
  return [body, filesOf(m, false)];
}

function renderTree(blocks) {
  const out = [];
  blocks.forEach((b, i) => {
    const next = blocks[i + 1];
    if (b.t === "p") {
      const txt = inlineText(b.c);
      // "Sonia wrote:" before a quote: the attribution, as in plain text
      out.push(h("p", { class: next && next.t === "quote" && /(wrote|skrev):$/.test(txt) ? "attrib" : "text" }, renderInline(b.c)));
    } else if (b.t === "h") out.push(h("h" + Math.min(b.n + 2, 5), { class: "mdh" }, renderInline(b.c)));
    else if (b.t === "code") out.push(h("pre", { class: "mdcode", "data-lang": b.lang || null }, h("code", { text: b.v })));
    else if (b.t === "hr") out.push(h("hr", { class: "mdhr" }));
    else if (b.t === "quote") {
      const inner = renderTree(b.c), lines = (inlineTextDeep(b.c).match(/\n/g) || []).length + b.c.length;
      out.push(lines > 8 ? h("details", { class: "quote-block md" }, h("summary", { text: `Quoted text (${lines} lines)` }), inner)
        : h("blockquote", { class: "quote-block md" }, inner));
    } else if (b.t === "ul" || b.t === "ol") {
      out.push(h(b.t, b.t === "ol" && b.start !== 1 ? { start: b.start } : {}, b.items.map(item => h("li", {}, renderTree(item)))));
    } else if (b.t === "table") out.push(renderTable(b));
  });
  return out;
}

// A table (UN-RFC 0031 section 3.6): a real table in a box of its own that scrolls
// sideways when it is wider than the text, so it never pushes the page or a chat
// bubble out of shape.
function renderTable(b) {
  const al = (j) => (b.align || [])[j] ? { class: "al-" + b.align[j] } : {};
  return h("div", { class: "mdtable", tabindex: "0", role: "region", "aria-label": "Table" },
    h("table", {},
      (b.head || []).length ? h("thead", {}, h("tr", {}, b.head.map((c, j) => h("th", al(j), renderInline(c))))) : null,
      h("tbody", {}, (b.rows || []).map(r => h("tr", {}, r.map((c, j) => h("td", al(j), renderInline(c))))))));
}

// A chat line: its paragraphs inline, as one bubble (the chat subset has no blocks but code).
function renderChatLine(m) {
  const blocks = m.tree || [];
  RENDERING = m;
  const out = blocks.map((b, i) => [i ? h("br") : null,
    b.t === "code" ? h("pre", { class: "mdcode" }, h("code", { text: b.v })) :
    b.t === "p" ? h("span", {}, renderInline(b.c)) : h("div", { class: "md" }, renderTree([b]))]);
  RENDERING = null;
  return out;
}

function renderInline(nodes, inLink = false) {
  return nodes.map(n => {
    switch (n.t) {
      case "text": return inLink ? n.v : linkGroups(n.v);      // never a link inside a link
      case "br": return h("br");
      case "code": return h("code", { text: n.v });
      case "em": return h("em", {}, renderInline(n.c, inLink));
      case "strong": return h("strong", {}, renderInline(n.c, inLink));
      case "del": return h("del", {}, renderInline(n.c, inLink));
      case "emoji": return h("span", { class: "emoji", title: ":" + n.name + ":", text: n.v });
      case "image": {                         // a picture the post carries, where its text puts it
        const a = RENDERING && n.blob && RENDERING.attachments.find(x => x.blob === n.blob);
        return a ? fileView(RENDERING, { ...a, alt: n.alt || a.alt }, true) :
          h("span", { class: "mdimg", title: "A picture this post does not carry", text: "[image: " + (n.alt || "no description") + "]" });
      }
      case "link": {
        const shown = inlineText(n.c);
        return h("a", { class: "mdlink", href: n.href, title: n.href, rel: "noopener noreferrer",
          onclick: (e) => { e.preventDefault(); openLink(n.href); } },
          renderInline(n.c, true),
          // where a link leaves Tor shows plainly; an unseenet: address stays inside the network
          shown.trim() !== n.href && !/^unseenet:/i.test(n.href) ? h("span", { class: "addr", text: " " + n.href }) : null);
      }
      default: return null;
    }
  });
}
