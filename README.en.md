# DeepSeek Desktop

[中文](README.md) · **English**

A fast, native **desktop client and coding agent for DeepSeek** — streaming chat plus a full
built-in agent (read/write files, run commands, an interactive terminal, MCP tools, Office
documents, and more). Built primarily for the DeepSeek API, but works with **any
OpenAI‑compatible endpoint** (just change the Base URL).

> Not Electron: a tiny **C++ / Win32 / WebView2** native shell hosts a **React + Vite +
> TypeScript** frontend, with a Bun build. Windows 10/11.

---

## Features

**Chat**
- Token-by-token **streaming** over a native `http.stream` command (WinHTTP worker + line-safe
  SSE), so no CORS and no UTF‑8 truncation.
- DeepSeek V-series models with reasoning (`reasoning_content`) shown in a collapsible block.
- Markdown + code highlighting, message queue, context **compaction** for very long chats.

**Agent**
- Tools: read/list/find/search files, `edit_file` / `write_file`, `run_command`, persistent
  **processes** (PTY sessions), `web_search` / `read_url`, and Office read.
- **Approval modes** (Codex-style): *Read Only* / *Auto* / *Full Access*, per‑tool overrides,
  with an in‑UI approval bar.
- **Plan** and **Goal** modes; a live **plan / todo** panel.
- **MCP servers** (HTTP transport) for external tools.
- **Sub‑agents** — delegate a focused sub-task to an autonomous nested agent that returns a
  summary, keeping the main thread clean.
- **Checkpoints + one‑click undo** — every turn snapshots the files it touches, so you can
  revert the agent's edits.

**Office & documents**
- Create **Word (.docx)**, **Excel (.xlsx)** (with real formulas), and **PowerPoint (.pptx)** —
  including **Morph‑animated decks** — purely in the frontend (docx / pptxgenjs / SheetJS).
- In‑app **Office preview** (spreadsheets as tables, Word via mammoth, slides as cards).
- Built‑in **document skills**: pitch deck, financial model, data dashboard, 3D web deck,
  report, academic paper — domain knowledge injected via `/skill` slash commands.

**Workspace**
- **Preview panel**: live local web pages and Office files, with live refresh.
- **Built‑in terminal** — a real **ConPTY** pseudo‑console rendered with xterm.js (prompt,
  colours, full-screen apps).
- Resizable sidebars, command palette (Ctrl+K), Projects/Chats grouping, @‑mention files,
  custom slash commands, bilingual UI (EN/中文), light/dark themes, UI zoom (Ctrl ±), system
  tray, and a keyboard shortcuts panel (Ctrl+/).

---

## Quick start

**Requirements:** Windows 10/11 · [Bun](https://bun.sh) · Visual Studio 2022 Build Tools
(C++ desktop) · WebView2 Runtime (preinstalled on most Win10/11).

```bash
bun install
bun run setup     # one-time: downloads the WebView2 SDK + nlohmann/json into deps/
bun run dev       # hot-reload dev (Vite + native shell)
# or
bun run build     # → dist\app.exe
```

Then open **⚙ Settings**, paste your DeepSeek API key (from platform.deepseek.com), and
optionally set a Working Directory for the agent.

### Build variants

```bash
bun run build:single     # single self-contained .exe (HTML/JS/CSS embedded)
bun run package:single   # distributable zip
```

---

## Security & privacy

- Your **API key is stored locally only** (browser `localStorage` in the WebView2 user-data
  folder). It is never committed to this repo and never sent anywhere except the API endpoint
  you configure.
- The agent's file/command tools run on **your machine**; *Read Only* is the default approval
  mode, and edits / commands ask for confirmation unless you switch to Auto/Full.

---

## Project layout

```
native/main.cpp     C++ WebView2 shell (adds http.stream streaming + ConPTY pty.* commands)
src/api.ts          TS wrappers for the native commands
src/lib/            deepseek.ts (stream client) · useChat.ts (turn loop, tools, approvals,
                    sub-agents, checkpoints) · tools.ts · office.ts · skills.ts · storage.ts
src/components/     TitleBar / Sidebar / ChatView / Message / PreviewPanel / TerminalPanel /
                    Settings / Composer / CommandPalette / ShortcutsPanel …
scripts/            setup / dev / build / package (Bun)
```

---

## ☕ Support

If this project helps you, a coffee is much appreciated ❤️

- ⭐ Star: <https://github.com/kobolingfeng/deepseek-desktop>
- 💳 PayPal: <https://paypal.me/koboling>
- 💚 WeChat:

<img src="assets/wechat-reward.jpg" alt="WeChat reward" width="220">

---

## License

[MIT](LICENSE). Built on the QiangQiang (强强) native shell framework.
