# Quick Start

## Install the CLI (Recommended)

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/wk42worldworld/cybercode/main/scripts/install-cli.sh | bash
```

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/wk42worldworld/cybercode/main/scripts/install-cli.ps1 | iex
```

The installer gets the latest stable GitHub release, installs Bun when needed, and adds `cybercode` to your user PATH. It does not require administrator access. Run the same command again to update; an existing CLI `.env` is preserved.

The installers are public and reviewable: [macOS/Linux](https://github.com/wk42worldworld/cybercode/blob/main/scripts/install-cli.sh) · [Windows](https://github.com/wk42worldworld/cybercode/blob/main/scripts/install-cli.ps1)

## Start an Agent

Open a new terminal, enter a project directory, and run:

```bash
cd /path/to/your-project
cybercode
```

## First Launch: Configure a Model in the Wizard

You do not need to install LiteLLM, configure a proxy, or edit `.env` before the first run. Follow the terminal prompts:

1. Choose a terminal theme.
2. Choose a model provider. Providers already configured in the desktop app appear at the top.
3. Choose the default model. Select "Enter another model ID" for a newly released model that is not listed yet.
4. Enter the API key when prompted. Local services such as LM Studio and Ollama skip this step when no key is needed.
5. Confirm that you trust the current project directory and enter the chat UI.

| Provider type | Examples | Connection mode |
|------|------|------|
| Claude Official | Claude account, Anthropic Console key | Direct |
| OpenAI-compatible | OpenAI, Google Gemini, Kimi API | Built-in protocol bridge |
| Anthropic-compatible | DeepSeek, GLM, Kimi Code, MiniMax, Xiaomi MiMo | Direct |
| Local models | LM Studio, Ollama | Direct to the local service |

::: tip No extra proxy required
CyberCode includes translation for OpenAI Chat Completions and OpenAI Responses. The bridge only listens on local `127.0.0.1`, chooses an available port automatically, and stops when the TUI exits.
:::

After the main UI opens, try:

```text
Introduce this project and tell me which model you are using.
```

The current model appears in the lower-right corner. If the model service is offline, the key is invalid, or the model ID is wrong, CyberCode reports that error directly; there is no separate proxy process to inspect.

### Switch or add a provider later

Run this inside the TUI:

```text
/provider
```

You can activate a saved provider or repeat the provider, model, and API-key flow. `/providers` is an alias for the same command, while `/model` switches models for the active provider.

The desktop app and TUI share provider settings. For connection tests and advanced per-role model mappings, open Settings -> Providers in the desktop app; saved changes are available to the TUI automatically.

### Local model note

CyberCode includes protocol handling, but it does not replace the local inference application. Before selecting LM Studio or Ollama, install it, download a model, and start its local server:

- LM Studio default: `http://localhost:1234`
- Ollama default: `http://localhost:11434`

See [Third-Party Models](./third-party-models.md) for custom Base URLs, API formats, and troubleshooting. [Environment Variables](./env-vars.md) are mainly for CI, containers, and headless scripts.

## Common CLI Commands

Options can be combined. For example, you can select a model and run one headless task with JSON output.

### Sessions and Models

| Command | Purpose |
|------|------|
| `cybercode` | Start the interactive TUI in the current project |
| `cybercode "explain this repository"` | Start an interactive session with an initial task |
| `cybercode -c` | Continue the latest conversation in the current project |
| `cybercode -r` | Open the session picker and resume a saved conversation |
| `cybercode -r <session-id>` | Resume a conversation by session ID |
| `cybercode -n api-refactor` | Give a new session a recognizable name |
| `cybercode --model <model>` | Select a model or model alias for this session |
| `cybercode --permission-mode plan` | Start in planning mode |
| `cybercode --add-dir ../shared` | Allow the agent to access another directory |

### Scripts, CI, and Structured Output

| Command | Purpose |
|------|------|
| `cybercode -p "fix the failing tests"` | Print the final result and exit |
| `cybercode -p --output-format json "summarize the changes"` | Return one JSON result |
| `cybercode -p --output-format stream-json "run the tests"` | Stream JSON events as they arrive |
| `cybercode -p --json-schema '{"type":"object"}' "analyze the project"` | Constrain structured output with JSON Schema |
| `cybercode -p --max-budget-usd 1.00 "review the code"` | Set a spending limit for one headless task |
| `cybercode -w feature-name` | Create an isolated Git worktree and start a session |

### Tools, MCP, and Plugins

| Command | Purpose |
|------|------|
| `cybercode --allowed-tools "Read,Glob,Grep"` | Allow only the named tools |
| `cybercode --disallowed-tools "Bash"` | Deny the named tools |
| `cybercode mcp list` | List configured MCP servers |
| `cybercode mcp --help` | Show MCP add, remove, and inspection commands |
| `cybercode plugin list` | List installed plugins |
| `cybercode plugin --help` | Show plugin install, update, and marketplace commands |
| `cybercode agents` | List configured custom agents |
| `cybercode doctor` | Check the runtime and updater health |
| `cybercode --version` | Print the installed version |
| `cybercode --help` | Show every top-level option and subcommand |

Use the `cybercode --help` output from your installed version as the complete option reference.

## Desktop Slash Commands

Type `/` in the desktop chat composer to search for and run commands. This is a forward slash `/`, not the backslash `\` used in Windows paths.

| Category | Supported commands |
|----------|--------------------|
| Information and tool panels | `/help`, `/status`, `/cost`, `/context`, `/mcp`, `/skills`, `/doctor`, `/memory`, `/bug` |
| Settings and accounts | `/plugin`, `/config`, `/permissions`, `/terminal-setup`, `/login`, `/logout`, `/agents` |
| Session and development actions | `/model`, `/compact`, `/clear`, `/review`, `/commit`, `/pr`, `/init` |

`/plugins` aliases `/plugin`, and `/feedback` aliases `/bug`. Skills, plugin commands, MCP prompts, and workflows from the current project can also appear dynamically in the `/` suggestions.

See the [complete Slash Command Reference](./slash-commands.md) for command behavior, terminal TUI commands, conditional commands, and shell equivalents.

## Run From Source

Use these steps when developing CyberCode or modifying the repository directly.

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

### 2. Install Dependencies

```bash
git clone https://github.com/wk42worldworld/cybercode.git
cd cybercode
bun install
```

You do not need to create `.env` first. Use the same provider wizard after launch; environment variables are only needed for advanced CI or headless setups.

### 3. Run the Source Checkout

```bash
# macOS / Linux
./bin/cybercode

# Windows PowerShell / cmd
.\bin\cybercode.cmd
```

## Recovery Mode

If the Ink TUI has issues, use the Recovery CLI:

```bash
# macOS / Linux
CYBERCODE_FORCE_RECOVERY_CLI=1 cybercode
```

```powershell
# Windows PowerShell
$env:CYBERCODE_FORCE_RECOVERY_CLI = "1"
cybercode
```
