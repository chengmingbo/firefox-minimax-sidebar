import {
  getConfig,
  setConfig,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TEMPERATURE,
  DEFAULT_TOP_P,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM,
  DEFAULT_PAGE_CONTEXT_MAX_CHARS,
  DEFAULT_SELECTION_MAX_CHARS,
  DEFAULT_INCLUDE_PAGE_ON_ASK,
  DEFAULT_THEME,
} from "../common/config.js";

const form = document.getElementById("options-form");
const fields = {
  apiKey: form.elements.apiKey,
  baseUrl: form.elements.baseUrl,
  model: form.elements.model,
  proxy: form.elements.proxy,
  temperature: form.elements.temperature,
  topP: form.elements.topP,
  maxTokens: form.elements.maxTokens,
  stream: form.elements.stream,
  systemPrompt: form.elements.systemPrompt,
  standingInstructions: form.elements.standingInstructions,
  pageContextMaxChars: form.elements.pageContextMaxChars,
  selectionMaxChars: form.elements.selectionMaxChars,
  includePageOnAsk: form.elements.includePageOnAsk,
  theme: form.elements.theme,
};
const savedEl = document.getElementById("saved");
const toggleKeyBtn = document.getElementById("toggle-key");
const resetBtn = document.getElementById("reset");
const testBtn = document.getElementById("test-connection");
const testOut = document.getElementById("test-output");

(async function init() {
  const cfg = await getConfig();
  fields.apiKey.value = cfg.apiKey;
  fields.baseUrl.value = cfg.baseUrl;
  fields.model.value = cfg.model;
  fields.proxy.value = cfg.proxy;
  fields.temperature.value = cfg.temperature;
  fields.topP.value = cfg.topP;
  fields.maxTokens.value = cfg.maxTokens;
  fields.stream.checked = cfg.stream;
  fields.systemPrompt.value = cfg.systemPrompt;
  fields.standingInstructions.value = cfg.standingInstructions;
  fields.pageContextMaxChars.value = cfg.pageContextMaxChars;
  fields.selectionMaxChars.value = cfg.selectionMaxChars;
  fields.includePageOnAsk.checked = cfg.includePageOnAsk;
  fields.theme.value = cfg.theme;
})();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await save();
});

toggleKeyBtn.addEventListener("click", () => {
  const isPwd = fields.apiKey.type === "password";
  fields.apiKey.type = isPwd ? "text" : "password";
  toggleKeyBtn.textContent = isPwd ? "Hide" : "Show";
});

resetBtn.addEventListener("click", async () => {
  if (!confirm("Reset all settings to defaults? API key is preserved.")) return;
  const cfg = await getConfig();
  await setConfig({
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    temperature: DEFAULT_TEMPERATURE,
    topP: DEFAULT_TOP_P,
    maxTokens: DEFAULT_MAX_TOKENS,
    stream: DEFAULT_STREAM,
    pageContextMaxChars: DEFAULT_PAGE_CONTEXT_MAX_CHARS,
    selectionMaxChars: DEFAULT_SELECTION_MAX_CHARS,
    includePageOnAsk: DEFAULT_INCLUDE_PAGE_ON_ASK,
    theme: DEFAULT_THEME,
    proxy: "",
    standingInstructions: "",
  });
  await refreshUI();
  flash("Defaults restored.");
});

testBtn.addEventListener("click", testConnection);

async function save() {
  const cfg = await getConfig();
  const partial = {
    apiKey: fields.apiKey.value.trim(),
    baseUrl: fields.baseUrl.value.trim() || DEFAULT_BASE_URL,
    model: fields.model.value.trim() || DEFAULT_MODEL,
    proxy: fields.proxy.value.trim(),
    temperature: clamp(fields.temperature.value, 0, 2, DEFAULT_TEMPERATURE),
    topP: clamp(fields.topP.value, 0, 1, DEFAULT_TOP_P),
    maxTokens: clamp(parseInt(fields.maxTokens.value, 10), 64, 32768, DEFAULT_MAX_TOKENS),
    stream: fields.stream.checked,
    systemPrompt: fields.systemPrompt.value || DEFAULT_SYSTEM_PROMPT,
    standingInstructions: fields.standingInstructions.value,
    pageContextMaxChars: clamp(
      parseInt(fields.pageContextMaxChars.value, 10),
      1000,
      200000,
      DEFAULT_PAGE_CONTEXT_MAX_CHARS
    ),
    selectionMaxChars: clamp(
      parseInt(fields.selectionMaxChars.value, 10),
      200,
      60000,
      DEFAULT_SELECTION_MAX_CHARS
    ),
    includePageOnAsk: fields.includePageOnAsk.checked,
    theme: fields.theme.value,
  };
  await setConfig(partial);
  flash("Saved.");
}

async function refreshUI() {
  const cfg = await getConfig();
  fields.baseUrl.value = cfg.baseUrl;
  fields.model.value = cfg.model;
  fields.proxy.value = cfg.proxy;
  fields.temperature.value = cfg.temperature;
  fields.topP.value = cfg.topP;
  fields.maxTokens.value = cfg.maxTokens;
  fields.stream.checked = cfg.stream;
  fields.systemPrompt.value = cfg.systemPrompt;
  fields.standingInstructions.value = cfg.standingInstructions;
  fields.pageContextMaxChars.value = cfg.pageContextMaxChars;
  fields.selectionMaxChars.value = cfg.selectionMaxChars;
  fields.includePageOnAsk.checked = cfg.includePageOnAsk;
  fields.theme.value = cfg.theme;
}

function clamp(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function flash(text) {
  savedEl.textContent = text;
  setTimeout(() => {
    savedEl.textContent = "";
  }, 1500);
}

async function testConnection() {
  testOut.hidden = false;
  testOut.classList.remove("mms-error");
  testOut.textContent = "Testing…";
  try {
    const cfg = await getConfig();
    const resp = await browser.runtime.sendMessage({
      type: "mms/chat-test",
      payload: {
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
      },
    });
    if (resp && resp.ok) {
      testOut.textContent =
        `OK · HTTP ${resp.status}\n` +
        `model: ${resp.model}\n` +
        `reply preview: ${JSON.stringify(resp.preview)}`;
    } else {
      testOut.classList.add("mms-error");
      testOut.textContent =
        `Failed · ${resp && resp.status ? "HTTP " + resp.status : ""}\n` +
        `${(resp && (resp.error || resp.bodyText)) || "Unknown error"}`;
    }
  } catch (e) {
    testOut.classList.add("mms-error");
    testOut.textContent = String(e && e.message ? e.message : e);
  }
}
