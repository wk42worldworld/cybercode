# CyberCode

<p align="center">
  <img src="docs/images/cybercode-app-icon.png" alt="CyberCode app icon" width="112"><br>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/cybercode-wordmark-dark.png">
    <img src="docs/images/cybercode-wordmark.png" alt="CyberCode" width="520">
  </picture>
</p>

<p align="center">
  <strong>Language:</strong>
  <strong>English</strong> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<div align="center">

[![GitHub Stars](https://img.shields.io/github/stars/wk42worldworld/cybercode?style=social)](https://github.com/wk42worldworld/cybercode/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/wk42worldworld/cybercode?style=social)](https://github.com/wk42worldworld/cybercode/network/members)
[![GitHub Issues](https://img.shields.io/github/issues/wk42worldworld/cybercode)](https://github.com/wk42worldworld/cybercode/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/wk42worldworld/cybercode)](https://github.com/wk42worldworld/cybercode/pulls)
[![Docs](https://img.shields.io/badge/📖_Documentation-Visit-D97757)](https://github.com/wk42worldworld/cybercode)

</div>

<p align="center">
  <strong>她不是工具，她是伙伴。</strong><br>
  <strong>She is not a tool. She is a partner.</strong><br>
  <strong>彼女はツールではなく、パートナーです。</strong><br>
  <strong>그녀는 도구가 아니라, 파트너입니다.</strong>
</p>

A **Claude Code-style local coding agent** with **permanent memory** and **self-evolution** capabilities, plus support for any Anthropic-compatible API endpoint (MiniMax, OpenRouter, etc.). Beyond the full TUI, we've also completed Computer Use (macOS / Windows), built a GUI **desktop app**, and enabled **full remote control** via Telegram / Feishu.

<p align="center">
  <strong>Open-source Claude Code-style desktop agent with permanent memory and self-evolution.</strong><br>
  Bring your own model, run real coding sessions locally, and use CLI, desktop, IM remote control, scheduled tasks, and Computer Use from one project.
</p>

<p align="center">
  <a href="#install-the-cli">Install CLI</a> · <a href="#why-cybercode">Why</a> · <a href="#quick-comparison">Compare</a> · <a href="#features">Features</a> · <a href="#quick-start">Quick Start</a> · <a href="#guided-tutorial">Guided Tutorial</a> · <a href="#feature-module-tutorials">Module Tutorials</a> · <a href="docs/en/guide/env-vars.md">Env Vars</a> · <a href="#community-and-growth">Community</a> · <a href="#more-documentation">More Docs</a>
</p>

---

## Install the CLI

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/wk42worldworld/cybercode/main/scripts/install-cli.sh | bash
```

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/wk42worldworld/cybercode/main/scripts/install-cli.ps1 | iex
```

Then open a project directory and start the agent:

```bash
cybercode
```

The installer gets the latest stable release, installs Bun when needed, and adds `cybercode` to your user PATH. It runs without administrator access and preserves an existing CLI `.env` when updating. You can review the [macOS/Linux installer](scripts/install-cli.sh) or [Windows installer](scripts/install-cli.ps1) before running it.

Looking for the GUI? [Download the desktop app for macOS, Windows, or Linux](https://github.com/wk42worldworld/cybercode/releases/latest).

---

## Why CyberCode

| If you want... | CyberCode gives you... |
|------|------|
| Claude Code-style agent workflows without being locked to one provider | Anthropic-compatible endpoints, OpenAI-compatible providers through proxy, and provider/model context-window metadata |
| A desktop app instead of only a terminal | Tauri + React GUI, multi-session tabs, project switching, file attachments, permission dialogs, and model/provider settings |
| A local coding agent that can keep working while you are away | Telegram / Feishu remote control, scheduled tasks, background agents, and persistent memory |
| A playground for advanced agent features | Multi-agent orchestration, Skills, MCP, Computer Use, custom providers, and CLI/headless mode |

## Quick Comparison

| Need | CyberCode | Claude Code | Cursor / Cline / Roo-style tools |
|------|------|------|------|
| Bring your own provider | Built around custom providers and Anthropic-compatible endpoints | Primarily official Anthropic path | Varies by tool |
| Desktop GUI | Built-in cross-platform desktop app | Terminal-first | Usually editor-first |
| CLI and headless mode | Yes | Yes | Usually not the main path |
| IM remote control | Telegram / Feishu adapters | Not the default workflow | Usually external setup |
| Scheduled coding tasks | Built into desktop workflow | Not the default workflow | Varies |
| Computer Use | macOS and Windows support | Official feature path | Varies |
| Open-source hackability | Full repo, desktop, server, adapters, docs | Closed source product | Varies |

## Community and Growth

- New contributors: start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [Roadmap](ROADMAP.md).
- Want to share CyberCode: use the ready-to-post copy in [Launch Kit](docs/marketing/launch-kit.md).
- Good first contribution areas: docs, provider presets, translations, reproducible bug reports, desktop UX polish, and platform-specific install notes.

---

## Latest Highlights

Latest stable desktop release: [CyberCode v1.0.21](https://github.com/wk42worldworld/cybercode/releases/tag/v1.0.21)

- **Running-turn input steering**: when an assistant response is still running, new user input is saved in a pending bar instead of disappearing or interrupting blindly. You can edit it, delete it, or add it to the current turn; otherwise queued input is sent automatically when the current turn finishes.
- **Provider-aware model context windows**: model presets can now carry context-window metadata, and CyberCode forwards those limits into desktop sessions so third-party providers behave more predictably.
- **Cross-platform desktop releases**: GitHub Actions now publishes macOS Apple Silicon, macOS Intel, Windows x64, and Linux x64 desktop builds together, with updater metadata included in `latest.json`.
- **Notarized macOS installers**: macOS desktop packages are signed and Apple-notarized to avoid the previous Gatekeeper "malicious software" style warning on normal installs.
- **Smarter Windows tool runtime**: CyberCode finds Git Bash when available, falls back to PowerShell when it is not, and only exposes executable tools that are actually available to the model.
- **Flexible file attachments**: unsupported audio, binary, and other file types are handled as file paths instead of blocking the conversation request.
- **Clearer command progress UI**: running command blocks now show GPT-style sweeping text highlights on both parent command rows and nested tool rows.

---

## Features

- Full Ink TUI experience (matching the official Claude Code interface)
- `--print` headless mode for scripts and CI
- MCP server, plugin, and Skills support
- Custom API endpoint and model support ([Third-Party Models Guide](docs/en/guide/third-party-models.md))
- Running-turn input steering with editable pending prompts
- Provider/model context-window metadata for more reliable long-context sessions
- Runtime-aware tool availability, including Git Bash / PowerShell fallback on Windows
- Desktop file upload fallback for unsupported file types
- Streaming command execution blocks with active progress highlighting
- **Memory System** (cross-session persistent memory) — [Usage Guide](docs/memory/01-usage-guide.md)
- **Multi-Agent System** (agent orchestration, parallel tasks, Teams collaboration) — [Usage Guide](docs/agent/01-usage-guide.md) | [Implementation](docs/agent/02-implementation.md)
- **Skills System** (extensible capability plugins, custom workflows) — [Usage Guide](docs/skills/01-usage-guide.md) | [Implementation](docs/skills/02-implementation.md)
- **Channel System** (remote Agent control via Telegram/Feishu/Discord IM platforms) — [Architecture](docs/en/channel/01-channel-system.md)
- **Computer Use desktop control** — [Guide](docs/en/features/computer-use.md) | [Architecture](docs/en/features/computer-use-architecture.md)
- **Desktop App** (Tauri 2 + React GUI client, multi-tab multi-session) — [Docs](docs/desktop/)
- Fallback Recovery CLI mode (`CYBERCODE_FORCE_RECOVERY_CLI=1 ./bin/cybercode`)

---

## Architecture Overview

<table>
  <tr>
    <td align="center" width="25%"><img src="docs/images/01-overall-architecture.png" alt="Overall architecture"><br><b>Overall architecture</b></td>
    <td align="center" width="25%"><img src="docs/images/02-request-lifecycle.png" alt="Request lifecycle"><br><b>Request lifecycle</b></td>
    <td align="center" width="25%"><img src="docs/images/03-tool-system.png" alt="Tool system"><br><b>Tool system</b></td>
    <td align="center" width="25%"><img src="docs/images/04-multi-agent.png" alt="Multi-agent architecture"><br><b>Multi-agent architecture</b></td>
  </tr>
  <tr>
    <td align="center" width="25%"><img src="docs/images/05-terminal-ui.png" alt="Terminal UI"><br><b>Terminal UI</b></td>
    <td align="center" width="25%"><img src="docs/images/06-permission-security.png" alt="Permissions and security"><br><b>Permissions and security</b></td>
    <td align="center" width="25%"><img src="docs/images/07-services-layer.png" alt="Services layer"><br><b>Services layer</b></td>
    <td align="center" width="25%"><img src="docs/images/08-state-data-flow.png" alt="State and data flow"><br><b>State and data flow</b></td>
  </tr>
</table>

---

## Desktop Download

<p align="center">
  <a href="https://github.com/wk42worldworld/cybercode/releases"><img src="https://img.shields.io/badge/⬇_Download_Desktop-macOS_%7C_Linux_%7C_Windows-D97757?style=for-the-badge" alt="Download Desktop"></a>
  &nbsp;
  <a href="docs/desktop/04-installation.md"><img src="https://img.shields.io/badge/📖_Install_Guide-Guide-gray?style=for-the-badge" alt="Install Guide"></a>
</p>

---

## Quick Start

### 1. Install Bun

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# macOS (Homebrew)
brew install bun

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

> On minimal Linux images, if you see `unzip is required`, run `apt update && apt install -y unzip` first.

### 2. Install Dependencies and Configure

```bash
bun install
cp .env.example .env
# Edit .env with your API key — see docs/en/guide/env-vars.md for details
```

### 3. Start

#### macOS / Linux

```bash
./bin/cybercode                          # Interactive TUI mode
./bin/cybercode -p "your prompt here"    # Headless mode
./bin/cybercode --help                   # Show all options
```

#### Windows

> [Git for Windows](https://git-scm.com/download/win) is recommended for Bash-compatible commands. If Git Bash is not available, CyberCode falls back to PowerShell automatically.

```powershell
# PowerShell / cmd — call Bun directly
bun --env-file=.env ./src/entrypoints/cli.tsx

# Or run inside Git Bash when available
./bin/cybercode
```

### 4. Global Usage (Optional)

Add `bin/` to your PATH to run from any directory. See [Global Usage Guide](docs/en/guide/global-usage.md):

```bash
export PATH="$HOME/path/to/cybercode/bin:$PATH"
```

### 5. Desktop Development

If you are developing or testing the `desktop/` frontend, start both the API server and the desktop frontend.

#### 5.1 Start the API server

```bash
cd /path/to/cybercode
SERVER_PORT=3456 bun run src/server/index.ts
```

Optional health check:

```bash
curl http://127.0.0.1:3456/health
```

#### 5.2 Start the desktop frontend

```bash
cd /path/to/cybercode/desktop
bun run dev --host 127.0.0.1 --port 2024
```

Then open:

```text
http://127.0.0.1:2024
```

#### 5.3 Notes

- If port `3456` is already occupied by an old server process, run `lsof -nP -iTCP:3456 -sTCP:LISTEN`, find the PID, then `kill <PID>`.
- For chat testing, create a fresh session and re-select a real working directory.
- If an old session points to a deleted directory, the server will return `Working directory does not exist`. That is separate from whether the API server is running.

---

## Guided Tutorial

Use this section when you are trying CyberCode for the first time. Follow the chapters in order; each one ends with a clear result so you know whether to continue.

### Chapter 1. Choose Your Running Mode

CyberCode can be used in three common ways:

| Mode | Best for | What to do |
|------|------|------|
| Desktop app | Daily coding, multi-session chat, visual project switching | Download the latest package from [GitHub Releases](https://github.com/wk42worldworld/cybercode/releases) |
| CLI from source | Terminal users, local development, scripts | Clone the repo, install Bun, then run `bun install` |
| Desktop development mode | Testing the React/Tauri frontend from source | Start the API server and Vite frontend as shown in [Desktop Development](#5-desktop-development) |

Expected result: you know whether you are installing the desktop app, running the CLI, or developing the desktop frontend.

### Chapter 2. Prepare Your Model Provider

CyberCode talks to Anthropic-compatible APIs. MiniMax and OpenRouter can be used directly if they expose a compatible endpoint. OpenAI-only providers usually need a proxy such as LiteLLM.

1. Create or copy an API key from your model provider.
2. Copy the example environment file:

```bash
cp .env.example .env
```

3. Edit `.env` and set at least these values:

```env
ANTHROPIC_AUTH_TOKEN=your_api_key_here
ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
ANTHROPIC_MODEL=MiniMax-M2.7
```

You can also use `ANTHROPIC_API_KEY` instead of `ANTHROPIC_AUTH_TOKEN` if your provider expects the `x-api-key` header. For provider-specific examples, see [Environment Variables](docs/en/guide/env-vars.md) and [Third-Party Models](docs/en/guide/third-party-models.md).

Expected result: `.env` contains a valid key, endpoint, and model name.

### Chapter 3. Run Your First CLI Task

Start with the interactive terminal UI:

```bash
./bin/cybercode
```

Try a small request first, for example:

```text
Read this project and summarize the main entry points.
```

For scripts or CI, use headless mode:

```bash
./bin/cybercode -p "Summarize package.json and list the available scripts"
```

Expected result: CyberCode connects to your model provider and streams an answer in the terminal.

### Chapter 4. Open a Real Project

CyberCode works best when it can see the project directory you want to change.

1. Start CyberCode from the project root, or choose the project folder in the desktop app.
2. Ask for a small inspection task first: `Explain the src/ directory structure`.
3. When CyberCode asks for permission to run a command or edit a file, review the action and approve only what you trust.
4. After the first successful answer, ask for a focused change such as `Fix the failing test in this file`.

Expected result: the assistant is working inside the correct directory and you can see which files or commands it wants to use.

### Chapter 5. Use the Desktop App Smoothly

For the installed desktop app, open CyberCode and create a session for your project. For local frontend development, run:

```bash
SERVER_PORT=3456 bun run src/server/index.ts
```

Then in another terminal:

```bash
cd desktop
bun run dev --host 127.0.0.1 --port 2024
```

Open `http://127.0.0.1:2024`, create or select a session, and choose a working directory.

Helpful workflow tips:

- If the assistant is already responding and you type another message, CyberCode saves it as a pending input row.
- Pending inputs can be edited or removed before they are sent.
- When the current assistant turn finishes, queued pending input is sent as the next user turn automatically.
- If a file type cannot be sent directly to the model, the desktop app passes it as a file path so the agent can still work with it.

Expected result: you can run normal multi-turn coding sessions without losing messages typed while the assistant is busy.

### Chapter 6. Make the CLI Available Everywhere

Add the repo `bin/` directory to your shell PATH:

```bash
export PATH="$HOME/path/to/cybercode/bin:$PATH"
```

Then test it from another project:

```bash
cybercode --help
cybercode -p "What files are in this directory?"
```

For a permanent setup, add the `export PATH=...` line to your shell profile such as `~/.zshrc` or `~/.bashrc`.

Expected result: `cybercode` works from any project directory.

### Chapter 7. Fix Common First-Run Problems

| Problem | What to check |
|------|------|
| `command not found: cybercode` | Use `./bin/cybercode` from the repo, or add `bin/` to PATH |
| API key or 401 error | Recheck `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, and the model name |
| Windows shell commands fail | Install [Git for Windows](https://git-scm.com/download/win), or let CyberCode fall back to PowerShell |
| Desktop cannot connect | Make sure the server is running on `127.0.0.1:3456` |
| Port `3456` is occupied | Stop the old process with `lsof -nP -iTCP:3456 -sTCP:LISTEN` and `kill <PID>` |
| `Working directory does not exist` | Re-select an existing project folder for that session |
| Long prompts fail unexpectedly | Choose a model/provider with enough context window, or update the model configuration metadata |

Expected result: you can identify whether the issue is shell setup, API configuration, server startup, or project path selection.

### Chapter 8. Learn the Next Features

| Goal | Read next |
|------|------|
| Use OpenAI, DeepSeek, Ollama, or other providers | [Third-Party Models](docs/en/guide/third-party-models.md) |
| Configure all environment variables | [Environment Variables](docs/en/guide/env-vars.md) |
| Run CyberCode globally | [Global Usage](docs/en/guide/global-usage.md) |
| Use persistent memory | [Memory System](docs/memory/01-usage-guide.md) |
| Use multiple agents | [Multi-Agent System](docs/agent/01-usage-guide.md) |
| Connect Telegram or Feishu | [Channel System](docs/en/channel/01-channel-system.md) |
| Control desktop apps | [Computer Use](docs/en/features/computer-use.md) |

Expected result: you can move from the first working session to the feature area you actually need.

---

## Feature Module Tutorials

This section is a module-by-module manual. Use it when you already have CyberCode running and want to understand each feature in a practical way.

### Module 1. Desktop App Installation and Updates

Use this module if you want the normal GUI app instead of running from source.

1. Open [GitHub Releases](https://github.com/wk42worldworld/cybercode/releases).
2. Download the package that matches your platform:
   - macOS Apple Silicon: `macos_arm64_dmg.dmg`
   - macOS Intel: `macos_x64_dmg.dmg`
   - Windows x64: `windows_x64_nsis.exe`
   - Linux x64: `linux_x64_deb.deb`
3. Install the package with the normal platform installer.
4. Launch CyberCode and create a new session.
5. Select a real project folder before sending your first coding request.

Verify it: the app opens, the sidebar shows sessions, and the status bar shows the selected project and model.

Notes:

- macOS packages are notarized. If macOS still blocks the app, see [Installation](docs/desktop/04-installation.md).
- The release also includes `latest.json` for desktop update metadata.

### Module 2. Model Providers, Models, and Context Windows

Use this module when you want CyberCode to call MiniMax, OpenRouter, OpenAI through a proxy, Ollama, or another compatible provider.

1. Open the desktop app.
2. Go to Settings -> Providers.
3. Choose a preset or add a custom provider.
4. Fill in:
   - Provider name
   - API key
   - Base URL
   - API format: `Anthropic`, `OpenAI Chat`, or `OpenAI Responses`
   - Model mapping: `main`, `haiku`, `sonnet`, `opus`
5. Fill the context window fields when you know the model limits, for example `200k` or `1m`.
6. Click Test Connection.
7. Activate the provider.
8. Click the model name in the status bar and select the model you want for the current session.

Verify it: send a short message, then open `/context` or the context inspector and confirm the active model and context limit look right.

Notes:

- For Anthropic-compatible endpoints, use the provider URL directly.
- For OpenAI-only APIs, use LiteLLM or another Anthropic-to-OpenAI proxy. See [Third-Party Models](docs/en/guide/third-party-models.md).
- If a model name contains a recognizable value like `200k` or `1m`, CyberCode can infer a context window, but explicit provider settings are clearer.

### Module 3. CLI and Headless Mode

Use this module when you prefer terminal workflows, automation, or CI.

1. Install dependencies:

```bash
bun install
```

2. Create your environment file:

```bash
cp .env.example .env
```

3. Edit `.env` with your provider settings.
4. Start the interactive TUI:

```bash
./bin/cybercode
```

5. Run a one-shot prompt:

```bash
./bin/cybercode -p "Explain this repository structure"
```

6. Check available options:

```bash
./bin/cybercode --help
```

Verify it: the interactive mode opens, and the `-p` command prints a complete answer without opening the TUI.

Notes:

- On Windows, Git Bash is recommended. If it is unavailable, CyberCode falls back to PowerShell.
- Add `bin/` to PATH if you want to run `cybercode` from any directory.

### Module 4. Desktop Sessions, Projects, and Tabs

Use this module to organize real coding work across multiple projects.

1. Click `+` in the sidebar or press `Cmd/Ctrl + N`.
2. Choose the project working directory.
3. Send a small inspection prompt first, such as `Explain this project layout`.
4. Use the project filter in the sidebar to show only sessions for one project.
5. Use sidebar search to find old sessions by title.
6. Right-click a session to rename or delete it.
7. Open multiple tabs when you want to keep separate tasks active.
8. Use tab right-click actions to close the current tab, other tabs, left tabs, right tabs, or all tabs.

Verify it: each session is tied to the expected project path, and the status bar displays the current project and model.

Notes:

- Closing a running tab asks whether to keep running, stop and close, or cancel.
- If a session points to a deleted directory, re-select an existing folder.

### Module 5. Chat Composer, Attachments, Slash Commands, and Pending Input

Use this module to send richer messages and manage input while the assistant is busy.

1. Type in the bottom composer.
2. Press `Enter` to send, or `Shift + Enter` for a new line.
3. Add files by pasting, dragging into the composer, or using the `+` file picker.
4. Type `/` to open slash commands such as `/status`, `/context`, `/memory`, `/mcp`, and `/skills`.
5. Type `@` to search and reference project files.
6. While the assistant is responding, send another message. It appears as a pending input row.
7. Edit or remove a pending row before it is sent.
8. Let the current assistant response finish. Queued pending input is sent automatically as the next user turn.
9. Click Stop or press `Cmd/Ctrl + .` if you need to interrupt generation.

Verify it: attachments appear above the composer, slash commands open the right panel or command, `@` references resolve to files, and busy-turn input is not lost.

Notes:

- Unsupported file types are passed as file paths so the agent can still inspect them with tools.
- The pending input row is for actual queued content, not a reminder banner.

### Module 6. Permissions and Tool Safety

Use this module whenever CyberCode wants to run shell commands or edit files.

1. Keep the default permission mode when working in an unfamiliar repository.
2. Read every permission card before approving it.
3. Choose Allow for a single action.
4. Choose Always Allow only when you trust that class of action for the current session.
5. Choose Deny if the command, file path, or diff does not look right.
6. Switch to Plan mode when you only want an implementation plan.
7. Use bypass permissions only in disposable or fully trusted environments.

Verify it: file edits and shell commands do not run until the permission policy allows them.

Notes:

- Permission cards show tool type, command or file preview, and expandable details.
- IM adapters also render permission requests as approval buttons.

### Module 7. Memory System

Use this module when you want CyberCode to remember preferences, project rules, or external references across sessions.

1. Work normally. CyberCode can extract useful memories after conversations.
2. Say `remember this: ...` when you want to save something explicitly.
3. Use `/memory` to open editable memory files.
4. Use `/remember` to review, promote, merge, or clean up automatic memories.
5. Ask CyberCode to forget a memory when it is no longer valid.
6. Say `ignore memory for this turn` when you want a clean answer.

Verify it: memory update notifications appear, and later sessions can use the saved preference or project context.

Good memory examples:

- Testing must use a real database, not mocks.
- Release freezes start on a specific date.
- A dashboard, ticket queue, or on-call reference lives in an external system.

Notes:

- Memory should store context that cannot be inferred from code.
- Disable automatic memory with `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.

### Module 8. Multi-Agent Workflows and Agent Teams

Use this module for large tasks that benefit from parallel exploration, planning, or verification.

1. Ask CyberCode to split a large task into agents, for example `Explore frontend, backend, and tests in parallel before planning changes`.
2. Use Explore agents for read-only codebase research.
3. Use Plan agents for architecture and implementation plans.
4. Use verification agents to independently check a completed change.
5. Ask for background agents when a task may take a long time.
6. Ask for worktree isolation when an experimental implementation should not touch the main working tree.
7. For collaborative work, ask CyberCode to create an Agent Team with named responsibilities.

Verify it: CyberCode reports agent launches, background task completions, verification results, or team summaries.

Notes:

- Keep each agent prompt focused.
- Use verification agents before trusting broad or risky changes.

### Module 9. Skills, Plugins, and MCP

Use this module to turn repeatable workflows into reusable capabilities.

1. Type `/` and browse available slash commands.
2. Start with built-in skills such as `/verify`, `/debug`, `/simplify`, `/remember`, and `/batch`.
3. In the desktop app, use `/skills` to inspect user-invocable skills for the current context.
4. For a project skill, create `.claude/skills/<skill-name>/SKILL.md`.
5. Add frontmatter fields such as `description`, `when_to_use`, `allowed-tools`, `model`, or `paths`.
6. Write the workflow instructions in Markdown below the frontmatter.
7. Trigger the skill with `/skill-name`, or describe a task that clearly matches its `when_to_use`.
8. Add MCP servers when you need external tools or prompts exposed to CyberCode.

Verify it: the skill appears in slash command discovery or is called by the model when the matching task appears.

Notes:

- Use `allowed-tools` to keep powerful skills scoped.
- Project skills are useful for team workflows because they can live in the repository.

### Module 10. IM Remote Control with Telegram and Feishu

Use this module when you want to control CyberCode from your phone or team chat.

1. Open the desktop app settings.
2. Go to the IM or Adapters section.
3. Set `serverUrl` and a default project directory if you want new chats to start in a known project.
4. Fill platform credentials:
   - Telegram: Bot Token
   - Feishu: App ID and App Secret
5. Set allowed users when needed.
6. Generate a six-character pairing code.
7. Start the adapter process:

```bash
cd adapters
bun install
bun run telegram
# or
bun run feishu
```

8. Send the pairing code to the bot in a private chat.
9. Send normal coding requests after pairing succeeds.
10. Use `/new`, `/projects`, and `/stop` from IM when needed.

Verify it: the bot connects to a CyberCode session, streams replies, and shows permission requests as buttons.

Notes:

- Pairing codes are single-use and expire after 60 minutes.
- If no default project is configured, the bot asks you to choose from recent projects.

### Module 11. Scheduled Tasks

Use this module when you want CyberCode to run a prompt on a schedule.

1. Open the desktop app.
2. Click the clock icon in the sidebar.
3. Click New Task.
4. Fill in task name and prompt.
5. Set the cron schedule or use the visual weekday/time controls.
6. Choose the model and permission mode for the run.
7. Save the task.
8. Use the enable switch to activate or pause it.
9. Click Run Now to test it manually.
10. Expand run history to inspect previous results.

Verify it: the task appears in the list with a readable schedule, and manual runs create history entries.

Notes:

- Scheduled tasks run while the desktop app and local service are available.
- Use conservative permission modes for unattended tasks.

### Module 12. Computer Use

Use this module when you want the model to operate desktop applications through screenshots, mouse, and keyboard.

1. Make sure Bun dependencies are installed.
2. Confirm Python 3.8 or newer is available:

```bash
python3 --version
```

3. On macOS, grant Accessibility and Screen Recording permissions to your terminal or the desktop app host.
4. Start CyberCode.
5. Ask for a visual desktop action, such as `Take a screenshot and tell me what is open`.
6. Approve the application access request when CyberCode asks.
7. Let the model screenshot, inspect, click, type, and verify step by step.

Verify it: CyberCode can take a screenshot, request app access, and operate only approved applications.

Notes:

- macOS Apple Silicon, macOS Intel, and Windows x64 are supported.
- Disable the feature with `CLAUDE_COMPUTER_USE_ENABLED=0`.
- Use simple, observable tasks first before asking for multi-app workflows.

### Module 13. Diagnostics, Context, and Cost Inspection

Use this module when something feels wrong or you need to inspect the current session.

1. Type `/status` to inspect the current session state.
2. Type `/context` to see context window usage, free tokens, and message/tool breakdowns.
3. Type `/cost` to inspect usage and cost-related data when available.
4. Type `/doctor` to check local setup health.
5. Use `curl http://127.0.0.1:3456/health` when testing the local desktop server.
6. If a provider fails, run the provider test from Settings -> Providers.
7. If the desktop cannot reach a session, confirm the project directory still exists.

Verify it: you can tell whether the problem is provider configuration, context pressure, local server state, or missing project paths.

---

## Tech Stack

| Category | Technology |
|------|------|
| Runtime | [Bun](https://bun.sh) |
| Language | TypeScript |
| Terminal UI | React + [Ink](https://github.com/vadimdemedes/ink) |
| CLI parsing | Commander.js |
| API | Anthropic SDK |
| Protocols | MCP, LSP |

---

## More Documentation

| Document | Description |
|------|------|
| [Environment Variables](docs/en/guide/env-vars.md) | Full env var reference and configuration methods |
| [Third-Party Models](docs/en/guide/third-party-models.md) | Using OpenAI / DeepSeek / Ollama and other non-Anthropic models |
| [Memory System](docs/memory/01-usage-guide.md) | Cross-session persistent memory usage and implementation |
| [Multi-Agent System](docs/agent/01-usage-guide.md) | Agent orchestration, parallel tasks and Teams collaboration |
| [Skills System](docs/skills/01-usage-guide.md) | Extensible capability plugins, custom workflows and conditional activation |
| [Channel System](docs/en/channel/01-channel-system.md) | Remote Agent control via Telegram/Feishu/Discord IM platforms |
| [Computer Use](docs/en/features/computer-use.md) | Desktop control (screenshots, mouse, keyboard) — [Architecture](docs/en/features/computer-use-architecture.md) |
| [Desktop App](docs/desktop/) | Tauri 2 + React GUI client — [Quick Start](docs/desktop/01-quick-start.md) \| [Architecture](docs/desktop/02-architecture.md) \| [Installation](docs/desktop/04-installation.md) |
| [Global Usage](docs/en/guide/global-usage.md) | Run cybercode from any directory |
| [FAQ](docs/en/guide/faq.md) | Common error troubleshooting |
| [Project Structure](docs/en/reference/project-structure.md) | Code directory structure |
| [Roadmap](ROADMAP.md) | Near-term priorities and good first issue ideas |
| [Contributing](CONTRIBUTING.md) | How to contribute docs, providers, tests, and desktop fixes |
| [Launch Kit](docs/marketing/launch-kit.md) | Ready-to-post copy for sharing CyberCode |

---

## Thanks

Thanks to the following open-source projects and community practices for reference and inspiration:

- [React](https://github.com/facebook/react): frontend engineering and component-based UI ecosystem.
- [Tauri](https://github.com/tauri-apps/tauri): cross-platform desktop app capabilities and engineering practices.
- [cc-switch](https://github.com/farion1231/cc-switch): reference for model provider configuration.

---

## ⭐ Star History

If this project helps you, please support it with a ⭐ Star so more people can discover CyberCode.

<a href="https://www.star-history.com/#wk42worldworld/cybercode&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=wk42worldworld/cybercode&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=wk42worldworld/cybercode&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=wk42worldworld/cybercode&type=Date" />
  </picture>
</a>

---

## Disclaimer

This project is an independent implementation that **heavily references** the product design, interaction model, and feature architecture of Claude Code by [Anthropic](https://www.anthropic.com). Claude and Claude Code are trademarks of Anthropic, and any related APIs and protocols belong to Anthropic. This project is provided for technical learning and research purposes only and has no commercial affiliation with Anthropic.
