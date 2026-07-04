# CyberCode

<p align="center">
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

A **locally runnable client** that **heavily references Claude Code's design**, with support for any Anthropic-compatible API endpoint (MiniMax, OpenRouter, etc.). Beyond the full TUI, we've also completed Computer Use (macOS / Windows), built a GUI **desktop app**, and enabled **full remote control** via Telegram / Feishu.

<p align="center">
  <a href="#features">Features</a> · <a href="#architecture-overview">Architecture</a> · <a href="#quick-start">Quick Start</a> · <a href="#guided-tutorial">Guided Tutorial</a> · <a href="docs/en/guide/env-vars.md">Env Vars</a> · <a href="docs/en/guide/faq.md">FAQ</a> · <a href="docs/en/guide/global-usage.md">Global Usage</a> · <a href="#more-documentation">More Docs</a>
</p>

---

## Latest Highlights

Latest stable desktop release: [CyberCode v1.0.13](https://github.com/wk42worldworld/cybercode/releases/tag/v1.0.13)

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
