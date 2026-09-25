// Background service worker (event page, MV3).
//
// Responsibilities:
//  - Own the cross-origin fetch to api.minimaxi.com (so the sidebar document
//    doesn't have to wrestle with CORS or expose the API key there).
//  - Handle keyboard commands (toggle sidebar, ask selection, etc.).
//  - Set up the right-click context menu.
//  - Relay messages between the content script and the sidebar.

import {
  chatCompletion,
  buildChatBody,
  getConfig,
  DEFAULT_BASE_URL,
} from "../common/config.js";

const CONTEXT_MENU_IDS = {
  askSelection: "mms-ask-selection",
  summarizePage: "mms-summarize-page",
  attachPage: "mms-attach-page",
  explainSelection: "mms-explain-selection",
};

const PROXY_CACHE = new Map(); // url → Promise<boolean>

browser.runtime.onInstalled.addListener(async () => {
  await setupContextMenus();
});

browser.runtime.onStartup.addListener(async () => {
  await setupContextMenus();
});

browser.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || !msg.type) return false;
  switch (msg.type) {
    case "mms/chat":
      return handleChat(msg.payload);
    case "mms/chat-test":
      return handleChatTest(msg.payload);
    case "mms/ping":
      return Promise.resolve({ ok: true });
    default:
      return false;
  }
});

browser.commands.onCommand.addListener(async (command) => {
  switch (command) {
    case "toggle-sidebar":
      await toggleSidebar();
      break;
    case "ask-selection":
      await runFromActiveTab("ask-selection");
      break;
    case "summarize-page":
      await runFromActiveTab("summarize-page");
      break;
    case "new-chat":
      await sendToSidebar({ type: "mms/new-chat" });
      await ensureSidebarOpen();
      break;
  }
});

async function setupContextMenus() {
  try {
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: CONTEXT_MENU_IDS.askSelection,
      title: "Ask MiniMax about selection",
      contexts: ["selection"],
    });
    browser.contextMenus.create({
      id: CONTEXT_MENU_IDS.explainSelection,
      title: "Explain selection with MiniMax",
      contexts: ["selection"],
    });
    browser.contextMenus.create({
      id: CONTEXT_MENU_IDS.summarizePage,
      title: "Summarize page with MiniMax",
      contexts: ["page"],
    });
    browser.contextMenus.create({
      id: CONTEXT_MENU_IDS.attachPage,
      title: "Attach page to MiniMax sidebar",
      contexts: ["page"],
    });
  } catch (e) {
    // contextMenus permission missing or already exists; ignore.
  }
}

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;
  switch (info.menuItemId) {
    case CONTEXT_MENU_IDS.askSelection: {
      const text = info.selectionText || "";
      await runFromActiveTab("ask-selection", { text });
      break;
    }
    case CONTEXT_MENU_IDS.explainSelection: {
      const text = info.selectionText || "";
      await runFromActiveTab("explain-selection", { text });
      break;
    }
    case CONTEXT_MENU_IDS.summarizePage: {
      await runFromActiveTab("summarize-page");
      break;
    }
    case CONTEXT_MENU_IDS.attachPage: {
      await attachPageToSidebar(tab.id);
      break;
    }
  }
});

async function handleChat(payload) {
  const { baseUrl, apiKey, body, proxy } = payload || {};
  try {
    const response = await chatCompletionRaw({ baseUrl, apiKey, body, proxy });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      return {
        ok: false,
        status: response.status,
        error: errorMessageFromBody(bodyText, response.status),
        bodyText: bodyText.slice(0, 2000),
      };
    }
    if (!response.body) {
      const text = await response.text();
      return {
        ok: true,
        status: response.status,
        body: wrappedTextStream(text),
      };
    }
    return {
      ok: true,
      status: response.status,
      body: response.body,
    };
  } catch (e) {
    return {
      ok: false,
      error: String(e && e.message ? e.message : e),
    };
  }
}

async function handleChatTest(payload) {
  const cfg = await getConfig();
  const baseUrl = (payload && payload.baseUrl) || cfg.baseUrl || DEFAULT_BASE_URL;
  const apiKey = (payload && payload.apiKey) || cfg.apiKey;
  const model = (payload && payload.model) || cfg.model;
  try {
    const response = await chatCompletionRaw({
      baseUrl,
      apiKey,
      body: {
        model,
        messages: [
          { role: "system", content: "You are a connectivity test." },
          { role: "user", content: "Reply with the single word: OK" },
        ],
        temperature: 0,
        max_tokens: 16,
        stream: false,
      },
    });
    const bodyText = await response.text();
    let preview = bodyText;
    try {
      const j = JSON.parse(bodyText);
      preview =
        (j.choices &&
          j.choices[0] &&
          j.choices[0].message &&
          j.choices[0].message.content) ||
        JSON.stringify(j).slice(0, 240);
    } catch (_) {}
    return {
      ok: response.ok,
      status: response.status,
      model,
      preview: String(preview).slice(0, 240),
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

async function chatCompletionRaw({ baseUrl, apiKey, body, proxy }) {
  const cfg = await getConfig();
  const url = joinUrl(
    baseUrl || cfg.baseUrl || DEFAULT_BASE_URL,
    "/v1/text/chatcompletion_v2"
  );
  const headers = { "Content-Type": "application/json" };
  if (apiKey || cfg.apiKey) {
    headers["Authorization"] = `Bearer ${apiKey || cfg.apiKey}`;
  }
  const effectiveProxy = proxy || cfg.proxy || "";
  return fetchWithProxy(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }, effectiveProxy);
}

async function fetchWithProxy(url, init, proxyUrl) {
  if (!proxyUrl) return fetch(url, init);
  // Firefox honors proxy.onRequest via proxy API; for simplicity we use
  // proxy.bypassList + proxy.settings. But for an HTTP proxy that the user
  // configures manually, we surface it via proxy.settings only when set.
  try {
    await configureProxy(proxyUrl);
  } catch (e) {
    // If proxy API is unavailable we fall through to direct fetch.
  }
  return fetch(url, init);
}

let proxyConfiguredUrl = null;
async function configureProxy(proxyUrl) {
  if (proxyConfiguredUrl === proxyUrl) return;
  if (!browser.proxy || !browser.proxy.onRequest) {
    proxyConfiguredUrl = proxyUrl;
    return;
  }
  // We register a transient onRequest listener that routes only requests
  // to api.minimaxi.com through the configured proxy, so that we don't
  // hijack the user's other traffic.
  if (browser.proxy.onRequest.hasListener(proxyOnRequest)) {
    browser.proxy.onRequest.removeListener(proxyOnRequest);
  }
  browser.proxy.onRequest.addListener(proxyOnRequest, { urls: ["<all_urls>"] }, ["blocking"]);
  proxyConfiguredUrl = proxyUrl;
}

function proxyOnRequest(requestDetails) {
  const u = new URL(requestDetails.url);
  if (u.hostname.endsWith("minimaxi.com") && proxyConfiguredUrl) {
    const p = new URL(proxyConfiguredUrl);
    return { host: p.hostname, port: p.port, scheme: p.protocol.replace(":", "") };
  }
  return { type: "direct" };
}

function joinUrl(base, path) {
  const b = (base || "").replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

function errorMessageFromBody(bodyText, status) {
  try {
    const j = JSON.parse(bodyText);
    if (j && j.error && j.error.message) return j.error.message;
    if (j && j.message) return j.message;
  } catch (_) {}
  return `HTTP ${status}`;
}

function wrappedTextStream(text) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(text));
      controller.close();
    },
  });
}

async function toggleSidebar() {
  // Firefox 115+ supports browser.sidebarAction.toggle() (Promise) and
  // browser.sidebarAction.close()/open(). We try toggle first; if it
  // doesn't exist we fall back to close→open.
  try {
    if (browser.sidebarAction.toggle) {
      await browser.sidebarAction.toggle();
      return;
    }
  } catch (e) {
    // fall through
  }
  // Last-resort: open the sidebar; if it's already open, the user can
  // press the same shortcut after we close it manually.
  try {
    await browser.sidebarAction.open();
  } catch (e) {
    await browser.sidebarAction.close();
  }
}

async function ensureSidebarOpen() {
  try {
    await browser.sidebarAction.open();
  } catch (e) {
    // ignore
  }
}

async function runFromActiveTab(action, args) {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !tab.id) return;
  await ensureSidebarOpen();
  if (action === "ask-selection" && args && args.text) {
    await sendToSidebar({
      type: "mms/pending-ask",
      payload: { prompt: `Explain or answer a question about this text:\n\n"""\n${args.text}\n"""` },
    });
    return;
  }
  if (action === "explain-selection" && args && args.text) {
    await sendToSidebar({
      type: "mms/pending-ask",
      payload: { prompt: `Explain this passage clearly:\n\n"""\n${args.text}\n"""` },
    });
    return;
  }
  if (action === "summarize-page") {
    await sendToSidebar({ type: "mms/run-quick-action", payload: { action: "summarize-page" } });
    return;
  }
}

async function attachPageToSidebar(tabId) {
  await ensureSidebarOpen();
  try {
    const resp = await browser.tabs.sendMessage(tabId, { type: "mms/get-page-context" });
    if (resp && resp.context) {
      await sendToSidebar({ type: "mms/attach-page", payload: resp.context });
    }
  } catch (e) {
    // ignore — content script may not be available on this tab.
  }
}

async function sendToSidebar(message) {
  try {
    // Broadcast to all extension pages; the sidebar picks it up.
    await browser.runtime.sendMessage(message);
  } catch (e) {
    // No listeners (sidebar not open); stash in storage so it gets applied
    // when the sidebar is opened next.
    await stashPending(message);
  }
}

async function stashPending(message) {
  const key = "minimax.pendingMessage";
  const stored = await browser.storage.session.get({ [key]: null });
  const queue = Array.isArray(stored[key]) ? stored[key] : [];
  queue.push(message);
  await browser.storage.session.set({ [key]: queue.slice(-10) });
}
