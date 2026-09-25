// Content script. Runs at document_idle on every page.
// Responds to messages from the sidebar/background:
//   mms/get-selection       → returns the current selection text + bounding info
//   mms/get-page-context    → returns {title, url, text} where text is a
//                             trimmed, main-content-skewed readable version.
//   mms/insert-text         → writes a string into the active editable element,
//                             or copies to clipboard if none exists.

(function () {
  "use strict";

  const SEL_MAX_CHARS_DEFAULT = 12000;
  const PAGE_MAX_CHARS_DEFAULT = 24000;

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return false;
    switch (msg.type) {
      case "mms/get-selection":
        sendResponse(getSelectionPayload());
        return false;
      case "mms/get-page-context":
        sendResponse(getPageContextPayload());
        return false;
      case "mms/insert-text":
        insertText(msg.payload && msg.payload.text).then((ok) =>
          sendResponse({ ok })
        );
        return true; // async
    }
    return false;
  });

  function getSelectionPayload() {
    const sel = window.getSelection();
    const text = sel ? sel.toString() : "";
    const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    const rect = range ? range.getBoundingClientRect() : null;
    return {
      text: text || "",
      hasSelection: !!text,
      rect: rect
        ? {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          }
        : null,
    };
  }

  function getPageContextPayload() {
    const text = extractReadableText(document, PAGE_MAX_CHARS_DEFAULT);
    return {
      context: {
        title: document.title || location.hostname,
        url: location.href,
        text,
      },
    };
  }

  function extractReadableText(doc, maxChars) {
    // Lightweight readability: clone the doc, strip non-content elements,
    // and walk the text nodes in document order.
    try {
      const clone = doc.cloneNode(true);
      const stripSelectors = [
        "script",
        "style",
        "noscript",
        "iframe",
        "link",
        "meta",
        "svg",
        "canvas",
        "video",
        "audio",
        "header nav",
        "footer",
        "aside",
        "[aria-hidden='true']",
        "[role='navigation']",
        "[role='banner']",
        "[role='contentinfo']",
        ".nav",
        ".navigation",
        ".sidebar",
        ".menu",
        ".ads",
        ".advertisement",
        "#nav",
        "#navigation",
        "#sidebar",
        "#footer",
        "#header",
      ];
      for (const sel of stripSelectors) {
        clone.querySelectorAll(sel).forEach((n) => n.remove());
      }
      // Prefer <main> / <article> if present.
      const main = clone.querySelector("main, article, [role='main']");
      const root = main || clone.body || clone.documentElement;
      const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      const parts = [];
      let total = 0;
      let node;
      while ((node = walker.nextNode())) {
        const t = node.nodeValue;
        if (!t || !t.trim()) continue;
        const clean = t.replace(/\s+/g, " ").trim();
        if (!clean) continue;
        parts.push(clean);
        total += clean.length + 1;
        if (total >= maxChars) break;
      }
      let out = parts.join("\n");
      if (out.length > maxChars) {
        const head = out.slice(0, Math.floor(maxChars * 0.7));
        const tail = out.slice(out.length - Math.floor(maxChars * 0.3));
        out = `${head}\n\n[…truncated…]\n\n${tail}`;
      }
      return out;
    } catch (e) {
      // Fall back to body.innerText.
      return ((doc.body && doc.body.innerText) || "").slice(0, maxChars);
    }
  }

  async function insertText(text) {
    if (!text) return false;
    const active = document.activeElement;
    if (isEditable(active)) {
      // Insert at the caret, replacing any current selection.
      try {
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(text));
          // Move caret to end of inserted text.
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          active.value = (active.value || "") + text;
        }
        dispatchInputEvent(active);
        return true;
      } catch (e) {
        // ignore
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      return false;
    }
  }

  function isEditable(el) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName === "INPUT") {
      const type = (el.type || "text").toLowerCase();
      return [
        "text",
        "search",
        "url",
        "tel",
        "email",
        "password",
        "number",
      ].includes(type);
    }
    if (el.isContentEditable) return true;
    return false;
  }

  function dispatchInputEvent(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
})();
