# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CyberCode desktop is a Tauri 2 + React 18 client for a Claude Code-inspired local agent. The frontend lives in `desktop/src/` and communicates with a Bun-based local server (root `src/server/`) via WebSocket. The Tauri native layer is in `desktop/src-tauri/`.

## Commands

```bash
cd desktop

bun run dev              # Vite dev server (port 1420, HMR on 1421)
bun run build            # tsc --noEmit + vite build (production web assets)
bun run lint             # TypeScript type-check only (tsc --noEmit)
bun run test             # Vitest (jsdom, colocated *.test.ts/tsx)
bun run test -- path/to/file.test.ts   # run a single test file
bun run tauri dev        # Tauri native dev (requires Rust toolchain)
```

Server side (from repo root):
```bash
bun install                                    # root deps
SERVER_PORT=3456 bun run src/server/index.ts   # local API/WS server
```

## Architecture

### Desktop App (`desktop/src/`)

- **`pages/`** — Top-level route views: `ActiveSession` (chat with messages), `EmptySession` (new-session hero), `Settings`, `McpSettings`, etc.
- **`components/chat/`** — Chat UI: `ChatInput` (unified composer, both hero and default variants), `MessageList` (scrollable message area with virtual scrolling), `AttachmentGallery`, `FileSearchMenu`, `LocalSlashCommandPanel`.
- **`components/layout/`** — Shell: `AppShell`, `Sidebar` (session list), `ContentRouter` (routes active tab to `ActiveSession` / `EmptySession`), `IconRail`.
- **`components/shared/`** — Reusable: `Button`, `Icon`, `Avatar`, `DirectoryPicker`.
- **`components/controls/`** — `ModelSelector`, `PermissionModeSelector`.
- **`stores/`** — Zustand stores, one per domain:
  - `chatStore` — WebSocket connection, message state, streaming, history loading with sliding window (`loadMoreHistory`/`loadMoreRecent`, buffers for older/newer messages).
  - `sessionStore` — Session CRUD, work directory tracking.
  - `tabStore` — Tab management, `activeTabId`, `recentSessionIds` (controls how many sessions are mounted in DOM).
  - `providerStore`, `settingsStore`, `uiStore`, `teamStore`, `sessionRuntimeStore`, etc.
- **`api/`** — REST/WebSocket clients for the local server (`sessions.ts`, `websocket.ts`, `providers.ts`, etc.).
- **`i18n/`** — Translation files (`locales/en.ts`, `locales/zh.ts`).
- **`theme/globals.css`** — CSS custom properties, Tailwind 4 config, `.dark` class theming.

### Communication Flow

Desktop UI ↔ WebSocket (`api/websocket.ts`) ↔ Local server (`src/server/`) ↔ Anthropic-compatible API

### Key Patterns

- **Session-scoped state**: `ChatInput` and `MessageList` receive an optional `sessionId` prop. When used inside `ContentRouter`'s multi-panel cache, each panel binds to its own session. Without the prop, they fall back to `tabStore.activeTabId`.
- **Sliding window for messages**: `chatStore.loadHistory` loads only the last `HISTORY_PAGE_SIZE` (50) messages into `messages`, rest goes to `historyBuffer`. `loadMoreHistory` prepends chunks from `historyBuffer` and trims tail into `recentBuffer`. `loadMoreRecent` restores from `recentBuffer`. DOM stays bounded at ~100 messages.
- **EmptySession vs ActiveSession**: New sessions start in `EmptySession` (hero layout). Once a message is sent, the tab switches to `ActiveSession`. The sidebar "+" button sets `activeTabId = null` to show `EmptySession` without creating a session prematurely.

## WKWebView White-Screen Constraints (macOS)

These rules prevent GPU compositor crashes in Tauri's WKWebView:

- **Never add `backdrop-blur` to any layout element** (sidebar, headers, chat input, settings). Use `bg-white/90 dark:bg-black/90` as a substitute.
- **Never mount more than 1 session's MessageList simultaneously.** `tabStore.RECENT_MAX` controls this; keep it at 1.
- **Never render >100 Markdown-heavy messages at once.** The sliding window in `chatStore` enforces this.
- When adding new visible UI, test with 50+ instances of the component to verify no crash.

## Coding Style

TypeScript, 2-space indent, no semicolons, ESM. PascalCase components, camelCase functions/stores/hooks. Tailwind 4 for styling with CSS custom properties (`--color-*`). Tests are colocated or in `src/__tests__/`.

## i18n

All user-visible strings go through `useTranslation()` from `src/i18n`. Keys live in `locales/en.ts` and `locales/zh.ts`. Add keys to both files.

## Testing

Vitest + Testing Library + jsdom. Colocate focused tests (`Component.test.tsx`) or put broader coverage in `src/__tests__/`. No coverage gate; add regression tests for changed behavior.
