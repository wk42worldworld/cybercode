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

Common commands:

```bash
cybercode                          # Interactive TUI mode
cybercode -p "your prompt here"    # Headless mode
cybercode --help                   # Show all options
```

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
