# MiniMax Sidebar

A Firefox WebExtension that puts MiniMax-M3 (by [MiniMax](https://MiniMax.com))
in a sidebar alongside any web page. Chat with the model, ask about the page
or your selection, summarize an article, or attach the active tab as
context — without leaving the page you're reading.

It follows the same idea as the existing ChatGPT / DeepSeek / Gemini
sidebar extensions, but speaks MiniMax's OpenAI-compatible chat-completions
endpoint at `https://api.minimaxi.com`.

## Features

- A native Firefox sidebar (`View → Sidebar → MiniMax Sidebar`, or
  **Alt+Shift+M**) with a multi-conversation chat UI.
- Streaming responses with a custom dependency-free Markdown renderer
  (paragraphs, lists, blockquotes, headings, fenced code, links, inline
  code, bold, italic).
- Quick actions: **Summarize page**, **Explain selection**, **Translate
  selection**, **Attach page**.
- Right-click context menu: ask about / explain selection, summarize or
  attach page.
- Keyboard shortcuts:
  - `Alt+Shift+M` — toggle sidebar
  - `Alt+Shift+S` — ask about selection
  - `Alt+Shift+P` — summarize page
  - `Alt+Shift+N` — new chat
- Persistent conversations (exportable as JSON) stored in
  `browser.storage.local`.
- Settings (API key, model, base URL, temperature, top-p, max tokens,
  proxy, system prompt, standing instructions, page context size, theme)
  stored in `browser.storage.sync` so they roam across your signed-in
  devices.
- Dark / light theme that follows the system, with an override.

## Install (development)

1. Get the source:
   ```sh
   git clone https://github.com/chengmingbo/firefox-minimax-sidebar.git
   cd firefox-minimax-sidebar
   ```
2. Open `about:debugging` in Firefox 115 or newer.
3. Click **This Firefox** → **Load Temporary Add-on…** and pick
   `src/manifest.json`. (Or run `./scripts/build.sh` and load the
   resulting `.xpi` from `build/`.)

For live reload during development, install `web-ext` and run
`./scripts/dev.sh`.

## Configure

Open the sidebar's ⚙ button (or `about:addons → MiniMax Sidebar →
Preferences`) and paste your MiniMax API key. Get one from
[MiniMax platform](https://platform.minimaxi.com/user-center/basic-information/interface-key).

The default model is `MiniMax-M3`; override per-session from the model
picker in the sidebar header.

## How it works

- `src/manifest.json` declares the sidebar, the keyboard commands, the
  context menus, and the host permissions for `api.minimaxi.com`.
- `src/sidebar/` is the chat UI. It imports shared modules from
  `src/common/`, persists conversations locally, and asks the background
  worker for chat completions.
- `src/background/background.js` is the event page. It owns the
  cross-origin `fetch` to MiniMax (so the sidebar document doesn't have
  to), handles keyboard commands, and sets up context menus. It also
  stashes pending messages so that "ask selection" still works when the
  sidebar is closed.
- `src/content/content.js` runs at `document_idle` on every page. It
  returns selection text on demand, plus a readability-style extract of
  the page (skips `script`/`style`/`nav`/etc., prefers `<main>`).
- `src/options/` is the settings page.

## Permissions

- `storage` (sync + local + session) — settings and conversations.
- `contextMenus` — right-click menu items.
- `activeTab`, `tabs`, `scripting` — talk to the active tab.
- `clipboardRead`, `clipboardWrite` — copy and insert text.
- `notifications` — (reserved for future error notifications).
- `host_permissions`: `https://api.minimaxi.com/*`, plus
  `http://127.0.0.1/*` and `http://localhost/*` for proxied setups.

## Project layout

```
src/
├── manifest.json
├── _locales/en/messages.json
├── common/         # config.js, markdown.js (shared modules)
├── background/     # background.js (event page)
├── sidebar/        # sidebar.html, sidebar.css, sidebar.js (the chat UI)
├── options/        # options.html, options.css, options.js (the settings page)
├── content/        # content.js (runs on every page)
├── styles/         # common.css (shared tokens)
└── icons/          # icon-16.png … icon-128.png
scripts/
├── make-icons.py   # regenerate icons
├── build.sh        # zip the extension as an unsigned .xpi
└── dev.sh          # run web-ext for live reload
```

## License

MIT — see [LICENSE.md](LICENSE.md).
