// Sidebar controller. Wires UI events, talks to the background worker for
// API calls (sidebar pages can't always make cross-origin fetches with the
// right headers), and persists conversations to local storage.

import {
  getConfig,
  setConfig,
  getConversations,
  saveConversations,
  newConversation,
  buildChatBody,
  trimForContext,
  DEFAULT_MODEL,
  DEFAULT_THEME,
} from "../common/config.js";
import { renderMarkdown, escapeHtml } from "../common/markdown.js";

const els = {
  chat: document.getElementById("chat"),
  prompt: document.getElementById("prompt"),
  send: document.getElementById("send"),
  stop: document.getElementById("stop"),
  status: document.getElementById("status"),
  newChat: document.getElementById("new-chat"),
  openOptions: document.getElementById("open-options"),
  modelPicker: document.getElementById("model-picker"),
  toggleList: document.getElementById("toggle-list"),
  closeConvList: document.getElementById("close-conv-list"),
  convList: document.getElementById("conversation-list"),
  convItems: document.getElementById("conversation-items"),
  exportAll: document.getElementById("export-all"),
  clearAll: document.getElementById("clear-all"),
  contextBar: document.getElementById("page-context-bar"),
  contextLabel: document.querySelector("#page-context-bar .mms-context-label"),
  clearContext: document.getElementById("clear-context"),
  quickActions: document.querySelector(".mms-quick-actions"),
};

const state = {
  config: null,
  conversations: [],
  activeId: null,
  pageContext: null,
  abortController: null,
  pendingAsk: null,
};

// Wireframe-known model ids. The picker also accepts a free-form text input.
const KNOWN_MODELS = ["MiniMax-M3", "MiniMax-M2"];

(async function init() {
  state.config = await getConfig();
  applyTheme(state.config.theme);
  const { conversations, activeId } = await getConversations();
  state.conversations = conversations;
  state.activeId = activeId;
  if (!state.conversations.length) {
    const c = newConversation(state.config.model);
    state.conversations = [c];
    state.activeId = c.id;
    await saveConversations(state.conversations, state.activeId);
  } else if (!state.activeId || !state.conversations.find((c) => c.id === state.activeId)) {
    state.activeId = state.conversations[0].id;
    await saveConversations(state.conversations, state.activeId);
  }
  populateModelPicker();
  renderConversations();
  renderChat();
  wireEvents();
  await drainPendingMessages();
  restorePendingAsk();
})();

async function drainPendingMessages() {
  try {
    const stored = await browser.storage.session.get({ "minimax.pendingMessage": null });
    const queue = stored["minimax.pendingMessage"];
    if (!Array.isArray(queue) || queue.length === 0) return;
    await browser.storage.session.set({ "minimax.pendingMessage": [] });
    for (const msg of queue) {
      if (msg && msg.type === "mms/pending-ask") {
        state.pendingAsk = msg.payload;
      } else if (msg && msg.type === "mms/attach-page") {
        attachPageContext(msg.payload);
      } else if (msg && msg.type === "mms/new-chat") {
        await startNewChat();
      } else if (msg && msg.type === "mms/run-quick-action") {
        runQuickAction(msg.payload.action, msg.payload.args);
      }
    }
  } catch (e) {
    // storage.session may be unavailable in some contexts.
  }
}

function applyTheme(theme) {
  const t = theme || DEFAULT_THEME;
  if (t === "auto") {
    document.body.removeAttribute("data-theme");
  } else {
    document.body.setAttribute("data-theme", t);
  }
}

function populateModelPicker() {
  const cur = state.config.model || DEFAULT_MODEL;
  const seen = new Set([cur, ...KNOWN_MODELS]);
  els.modelPicker.innerHTML = "";
  for (const m of seen) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    if (m === cur) opt.selected = true;
    els.modelPicker.appendChild(opt);
  }
}

function renderConversations() {
  els.convItems.innerHTML = "";
  for (const c of state.conversations) {
    const li = document.createElement("li");
    if (c.id === state.activeId) li.classList.add("active");
    li.dataset.id = c.id;

    const title = document.createElement("span");
    title.className = "mms-conv-title";
    title.textContent = c.title || "Untitled";
    li.appendChild(title);

    const meta = document.createElement("span");
    meta.className = "mms-conv-meta";
    meta.textContent = `${c.messages.length} msgs`;
    li.appendChild(meta);

    const del = document.createElement("button");
    del.className = "mms-icon-btn mms-conv-del";
    del.title = "Delete";
    del.setAttribute("aria-label", "Delete conversation");
    del.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteConversation(c.id);
    });
    li.appendChild(del);

    li.addEventListener("click", () => activateConversation(c.id));
    els.convItems.appendChild(li);
  }
}

async function activateConversation(id) {
  state.activeId = id;
  await saveConversations(state.conversations, state.activeId);
  renderConversations();
  renderChat();
  hideConvList();
}

async function deleteConversation(id) {
  state.conversations = state.conversations.filter((c) => c.id !== id);
  if (state.activeId === id) {
    if (state.conversations.length) {
      state.activeId = state.conversations[0].id;
    } else {
      const c = newConversation(state.config.model);
      state.conversations = [c];
      state.activeId = c.id;
    }
  }
  await saveConversations(state.conversations, state.activeId);
  renderConversations();
  renderChat();
}

function activeConv() {
  return state.conversations.find((c) => c.id === state.activeId);
}

function renderChat() {
  els.chat.innerHTML = "";
  const c = activeConv();
  if (!c || c.messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "mms-empty";
    empty.textContent =
      "Ask MiniMax anything. Use the chips below for Summarize page, Explain selection, Translate selection, or Attach page.";
    els.chat.appendChild(empty);
    return;
  }
  for (const m of c.messages) {
    els.chat.appendChild(renderMessage(m));
  }
  scrollToBottom();
}

function renderMessage(m) {
  const wrap = document.createElement("article");
  wrap.className = `mms-msg mms-msg-${m.role}`;

  const meta = document.createElement("div");
  meta.className = "mms-msg-meta";
  const who = document.createElement("span");
  who.textContent = m.role === "user" ? "You" : "MiniMax";
  meta.appendChild(who);

  if (m.role === "assistant") {
    const actions = document.createElement("div");
    actions.className = "mms-msg-actions";

    const copyBtn = document.createElement("button");
    copyBtn.className = "mms-link-btn";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", () => copyToClipboard(m.content));
    actions.appendChild(copyBtn);

    const regenBtn = document.createElement("button");
    regenBtn.className = "mms-link-btn";
    regenBtn.textContent = "Regenerate";
    regenBtn.addEventListener("click", () => regenerate(m));
    actions.appendChild(regenBtn);

    meta.appendChild(actions);
  } else if (m.role === "user" && m.attachment) {
    const att = document.createElement("div");
    att.className = "mms-msg-attachment";
    att.textContent = `📎 ${m.attachment.title || m.attachment.url}`;
    wrap.appendChild(att);
  }
  wrap.appendChild(meta);

  const body = document.createElement("div");
  body.className = "mms-msg-body";
  if (m.role === "user") {
    body.textContent = m.content;
  } else {
    body.innerHTML = renderMarkdown(m.content || "");
  }
  wrap.appendChild(body);
  return wrap;
}

function wireEvents() {
  els.send.addEventListener("click", sendPrompt);
  els.stop.addEventListener("click", stopGeneration);
  els.newChat.addEventListener("click", startNewChat);
  els.openOptions.addEventListener("click", () => {
    browser.runtime.openOptionsPage();
  });
  els.toggleList.addEventListener("click", () => toggleConvList());
  els.closeConvList.addEventListener("click", () => hideConvList());
  els.exportAll.addEventListener("click", exportAll);
  els.clearAll.addEventListener("click", clearAll);
  els.clearContext.addEventListener("click", () => clearPageContext());
  els.modelPicker.addEventListener("change", async (e) => {
    await setConfig({ model: e.target.value });
    state.config = await getConfig();
  });

  els.prompt.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendPrompt();
    }
  });

  els.quickActions.addEventListener("click", (e) => {
    const t = e.target.closest("[data-action]");
    if (!t) return;
    runQuickAction(t.dataset.action);
  });

  browser.runtime.onMessage.addListener(onRuntimeMessage);
}

async function onRuntimeMessage(msg) {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case "mms/pending-ask":
      state.pendingAsk = msg.payload;
      restorePendingAsk();
      break;
    case "mms/attach-page":
      attachPageContext(msg.payload);
      break;
    case "mms/open":
      // Already open, no-op.
      break;
    case "mms/run-quick-action":
      runQuickAction(msg.payload.action, msg.payload.args);
      break;
    case "mms/new-chat":
      startNewChat();
      break;
  }
}

function restorePendingAsk() {
  if (!state.pendingAsk) return;
  const { prompt, page } = state.pendingAsk;
  if (page) attachPageContext(page);
  els.prompt.value = prompt || "";
  els.prompt.focus();
  state.pendingAsk = null;
}

function showConvList() {
  els.convList.hidden = false;
  renderConversations();
}
function hideConvList() {
  els.convList.hidden = true;
}
function toggleConvList() {
  els.convList.hidden ? showConvList() : hideConvList();
}

async function startNewChat() {
  const c = newConversation(state.config.model);
  state.conversations.unshift(c);
  state.activeId = c.id;
  await saveConversations(state.conversations, state.activeId);
  renderConversations();
  renderChat();
  clearPageContext(false);
  els.prompt.focus();
}

async function sendPrompt() {
  const text = els.prompt.value.trim();
  if (!text) return;
  if (state.abortController) return;

  if (!state.config.apiKey) {
    setStatus("Set your API key in Settings first.", true);
    browser.runtime.openOptionsPage();
    return;
  }

  const c = activeConv();
  if (!c) return;

  const userMsg = {
    role: "user",
    content: text,
    timestamp: Date.now(),
    attachment: state.pageContext
      ? {
          title: state.pageContext.title,
          url: state.pageContext.url,
        }
      : null,
  };
  c.messages.push(userMsg);
  if (c.messages.length === 1) c.title = deriveTitle(text);
  c.updatedAt = Date.now();
  await persistConversation(c);
  renderChat();

  els.prompt.value = "";
  els.prompt.style.height = "auto";
  setSending(true);

  const assistantMsg = {
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    model: state.config.model,
  };
  c.messages.push(assistantMsg);
  await persistConversation(c);

  // Render a streaming placeholder.
  const placeholder = renderMessage(assistantMsg);
  placeholder.classList.add("mms-streaming");
  els.chat.appendChild(placeholder);
  scrollToBottom();
  const bodyEl = placeholder.querySelector(".mms-msg-body");

  await runStream(c, userMsg, assistantMsg, bodyEl);
}

function deriveTitle(s) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 48 ? `${t.slice(0, 45)}…` : t;
}

async function runStream(conversation, userMsg, assistantMsg, bodyEl) {
  state.abortController = new AbortController();
  const messages = composeMessages(conversation, userMsg, state.config);

  setStatus("");
  try {
    const body = buildChatBody({
      model: state.config.model,
      messages,
      temperature: state.config.temperature,
      topP: state.config.topP,
      maxTokens: state.config.maxTokens,
      stream: state.config.stream,
    });

    const response = await browser.runtime.sendMessage({
      type: "mms/chat",
      payload: {
        baseUrl: state.config.baseUrl,
        apiKey: state.config.apiKey,
        body,
        proxy: state.config.proxy || "",
      },
    });

    if (!response || !response.ok) {
      const errText = (response && (response.error || response.bodyText)) || "Unknown error";
      throw new Error(errText);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let acc = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE: lines starting with "data: ". Multiple events per chunk possible.
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        if (line.startsWith("data:")) {
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload);
            const delta = extractDelta(json);
            if (delta) {
              acc += delta;
              assistantMsg.content = acc;
              bodyEl.innerHTML = renderMarkdown(acc);
              scrollToBottom();
            }
          } catch (e) {
            // ignore malformed chunk
          }
        }
      }
    }

    // Final render pass.
    bodyEl.innerHTML = renderMarkdown(acc);
    bodyEl.parentElement.classList.remove("mms-streaming");
    assistantMsg.content = acc;
    await persistConversation(conversation);
    setStatus("");
  } catch (err) {
    bodyEl.parentElement.classList.remove("mms-streaming");
    if (err.name === "AbortError") {
      setStatus("Stopped.");
    } else {
      const msg = String(err && err.message ? err.message : err);
      setStatus(msg, true);
    }
    // Remove the empty assistant placeholder if nothing was produced.
    if (!assistantMsg.content) {
      conversation.messages = conversation.messages.filter(
        (m) => m !== assistantMsg
      );
      await persistConversation(conversation);
      renderChat();
    }
  } finally {
    state.abortController = null;
    setSending(false);
  }
}

function extractDelta(json) {
  // OpenAI-compatible delta: choices[0].delta.content
  if (json && Array.isArray(json.choices) && json.choices.length) {
    const c = json.choices[0];
    if (c && c.delta && typeof c.delta.content === "string") return c.delta.content;
    if (c && typeof c.text === "string") return c.text;
  }
  return "";
}

function composeMessages(conversation, latestUserMsg, config) {
  const sysLines = [config.systemPrompt];
  if (config.standingInstructions && config.standingInstructions.trim()) {
    sysLines.push("", "Standing instructions:", config.standingInstructions.trim());
  }
  const sys = sysLines.join("\n");

  const out = [{ role: "system", content: sys }];
  for (const m of conversation.messages) {
    if (m === latestUserMsg && m.attachment) {
      const att = m.attachment;
      out.push({
        role: "user",
        content: `${m.content}\n\n---\nAttached page: ${att.title}\nURL: ${att.url}\n\n${att.text || ""}`,
      });
    } else if (m === latestUserMsg) {
      out.push({ role: m.role, content: m.content });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

async function regenerate(message) {
  const c = activeConv();
  if (!c) return;
  const idx = c.messages.indexOf(message);
  if (idx < 0) return;
  // Drop the assistant message and the user message that produced it.
  const userIdx = idx - 1;
  if (userIdx >= 0 && c.messages[userIdx].role === "user") {
    c.messages.splice(userIdx, 2);
    await persistConversation(c);
    els.prompt.value = c.messages[userIdx] ? c.messages[userIdx].content : "";
    // Push the dropped user content back into the prompt for the user to resend.
    if (c.messages[userIdx]) {
      els.prompt.value = c.messages[userIdx].content;
      // But we want the dropped user message, not the next one. Restore it:
      const dropped = c.messages.splice(userIdx, 2)[0];
      if (dropped) els.prompt.value = dropped.content;
    } else {
      els.prompt.value = "";
    }
  } else {
    c.messages.splice(idx, 1);
    await persistConversation(c);
  }
  renderChat();
  if (els.prompt.value.trim()) {
    sendPrompt();
  }
}

function setSending(on) {
  els.send.hidden = on;
  els.stop.hidden = !on;
  els.prompt.disabled = on;
}

function stopGeneration() {
  if (state.abortController) state.abortController.abort();
}

function setStatus(text, isError) {
  els.status.textContent = text || "";
  els.status.classList.toggle("mms-error", !!isError);
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    els.chat.scrollTop = els.chat.scrollHeight;
  });
}

async function persistConversation(c) {
  c.updatedAt = Date.now();
  await saveConversations(state.conversations, state.activeId);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Copied.");
    setTimeout(() => setStatus(""), 1200);
  } catch (e) {
    setStatus("Copy failed.", true);
  }
}

async function exportAll() {
  const dump = JSON.stringify(state.conversations, null, 2);
  const blob = new Blob([dump], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `minimax-sidebar-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function clearAll() {
  if (!confirm("Delete all conversations? This cannot be undone.")) return;
  const c = newConversation(state.config.model);
  state.conversations = [c];
  state.activeId = c.id;
  await saveConversations(state.conversations, state.activeId);
  renderConversations();
  renderChat();
}

function attachPageContext(ctx) {
  state.pageContext = ctx;
  els.contextBar.hidden = false;
  const label = `${ctx.title} — ${ctx.url}`;
  els.contextLabel.textContent = `Attached: ${label}`;
  els.contextLabel.title = label;
}

function clearPageContext(rerender = true) {
  state.pageContext = null;
  els.contextBar.hidden = true;
  if (rerender) renderChat();
}

async function runQuickAction(action, args) {
  switch (action) {
    case "summarize-page": {
      const ctx = await fetchActivePageContext();
      if (!ctx) {
        setStatus("No active page.", true);
        return;
      }
      attachPageContext(ctx);
      sendPromptWith(
        `Summarize the attached page. Include the main argument, key points, and any action items.`
      );
      break;
    }
    case "explain-selection": {
      const sel = await fetchActiveSelection();
      if (!sel || !sel.text) {
        setStatus("No selection.", true);
        return;
      }
      els.prompt.value = `Explain this:\n\n"""\n${sel.text}\n"""`;
      els.prompt.focus();
      break;
    }
    case "translate-selection": {
      const sel = await fetchActiveSelection();
      if (!sel || !sel.text) {
        setStatus("No selection.", true);
        return;
      }
      els.prompt.value = `Translate the following text into Simplified Chinese (简体中文), preserving formatting:\n\n"""\n${sel.text}\n"""`;
      els.prompt.focus();
      break;
    }
    case "attach-page": {
      const ctx = await fetchActivePageContext();
      if (!ctx) {
        setStatus("No active page.", true);
        return;
      }
      attachPageContext(ctx);
      setStatus("Page attached. Type your question.");
      break;
    }
  }
}

function sendPromptWith(text) {
  els.prompt.value = text;
  sendPrompt();
}

async function fetchActivePageContext() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) return null;
    const resp = await browser.tabs.sendMessage(tab.id, { type: "mms/get-page-context" });
    return resp && resp.context ? resp.context : null;
  } catch (e) {
    return null;
  }
}

async function fetchActiveSelection() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) return null;
    const resp = await browser.tabs.sendMessage(tab.id, { type: "mms/get-selection" });
    return resp && resp.text ? resp : null;
  } catch (e) {
    return null;
  }
}
