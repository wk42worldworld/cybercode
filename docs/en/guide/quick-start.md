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

The first launch opens the configuration flow. See [Environment Variables](./env-vars.md) and [Third-Party Models](./third-party-models.md) for the complete provider setup reference.

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

### 2. Install Dependencies and Configure

```bash
git clone https://github.com/wk42worldworld/cybercode.git
cd cybercode
bun install
cp .env.example .env
# Edit .env with your API key
```

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
