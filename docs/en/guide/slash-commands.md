# Slash Command Reference

Slash commands are commands that start with `/`. They are not Windows backslashes (`\`).

## Three Entry Points

| Entry point | How to use it | Notes |
|-------------|---------------|-------|
| Terminal TUI | Run `cybercode`, then type `/` in the input box | The richest interactive command surface for sessions, context, plugins, MCP, permissions, and more. |
| Desktop composer | Type `/` in the desktop chat composer | Desktop handles UI shortcuts first, such as Settings, Models, MCP, Skills, and Memory. Unsupported TUI commands tell you to use the terminal. |
| Normal shell | Run `cybercode <subcommand>` | This is not a slash command. Use it for scripts, CI, and management tasks such as `cybercode mcp list`. |

## Built-In Terminal TUI Commands

| Command | Alias / Arguments | Purpose |
|---------|-------------------|---------|
| `/help` | - | Show help and available commands. |
| `/status` | - | Show version, model, account, API connectivity, and tool status. |
| `/add-dir` | `<path>` | Add another working directory to the current session. |
| `/context` | - | Show current context usage. Interactive mode renders a visual grid. |
| `/cost` | - | Show current session cost and duration. |
| `/clear` | `/reset`, `/new` | Clear conversation history and free context. |
| `/compact` | `[summary instructions]` | Compact conversation history while keeping a summary. |
| `/resume` | `/continue [conversation ID or search term]` | Resume a previous conversation. |
| `/rename` | `[name]` | Rename the current conversation. |
| `/branch` | `/fork [name]` | Branch the conversation from the current point. |
| `/rewind` | `/checkpoint` | Restore code or conversation state to an earlier point. |
| `/exit` | `/quit` | Exit the REPL. |
| `/copy` | `[N]` | Copy the latest or Nth-latest assistant response. |
| `/export` | `[filename]` | Export the current conversation to a file or clipboard. |
| `/diff` | - | View uncommitted changes and per-turn diffs. |
| `/tasks` | `/bashes` | List and manage background tasks. |
| `/buddy` | `[hatch|pet|mute|unmute|info]` | Open companion and hint-style interactions. |
| `/btw` | `<question>` | Ask a quick side question without interrupting the main task. |
| `/plan` | `[open or description]` | Enable plan mode or view the current plan. |
| `/review` | `[PR number]` | Ask the agent to review a pull request. |
| `/pr-comments` | `[PR number]` | Fetch and organize GitHub pull request comments. |
| `/security-review` | - | Review the current branch for security issues. |
| `/init` | - | Initialize the project `CYBER.md` file. |
| `/statusline` | `[instructions]` | Configure status line output. |
| `/insights` | - | Generate a report about your CyberCode sessions. |
| `/model` | `[model]` | Switch the model for the current session. |
| `/provider` | `/providers` | Configure or switch providers; OpenAI-compatible APIs use the built-in protocol bridge. |
| `/effort` | `low`, `medium`, `high`, `max`, `auto` | Adjust model reasoning effort. |
| `/fast` | `on`, `off` | Toggle fast mode when available. |
| `/config` | `/settings` | Open the configuration panel. |
| `/permissions` | `/allowed-tools` | Manage allow and deny rules for tools. |
| `/sandbox` | `exclude "command pattern"` | Configure sandboxing and command exclusions. |
| `/theme` | - | Change the terminal theme. |
| `/color` | `<color or default>` | Set the prompt bar color for the session. |
| `/vim` | - | Toggle between Vim and normal editing modes. |
| `/terminal-setup` | - | Configure terminal newline key bindings. |
| `/keybindings` | - | Open or create the keybindings configuration file. |
| `/memory` | `status`, `log`, `edit`, `add`, `remove`, `replace`, `write` | Manage CyberCode long-term memory and instruction files. |
| `/skills` | - | List available Skills. |
| `/agents` | - | Manage custom agent configurations. |
| `/mcp` | `[enable or disable <server>]` | Manage MCP servers and tools. |
| `/plugin` | `/plugins`, `/marketplace` | Install, enable, disable, update, and manage plugins. |
| `/reload-plugins` | - | Activate pending plugin changes in the current session. |
| `/hooks` | - | View tool event hook configuration. |
| `/ide` | `[open]` | Manage IDE integrations and show status. |
| `/doctor` | - | Diagnose installation, configuration, and runtime health. |
| `/login` | - | Sign in or switch Anthropic accounts. |
| `/logout` | - | Sign out from your Anthropic account. |
| `/release-notes` | - | View release notes. |
| `/feedback` | `/bug [text]` | Submit feedback or a bug report. |

## Conditional Commands

These commands appear only when the platform, account type, feature flag, or policy allows them.

| Command | Purpose |
|---------|---------|
| `/desktop` | Continue the current session in the desktop app on supported platforms. |
| `/mobile` | Show a QR code for mobile app download. |
| `/chrome` | Configure Claude in Chrome integration. |
| `/advisor` | Configure the auxiliary Advisor model. |
| `/install-github-app` | Set up GitHub Actions integration for a repository. |
| `/install-slack-app` | Install the Slack app integration. |
| `/privacy-settings` | View and update privacy settings. |
| `/stats` | Show usage statistics and activity. |
| `/usage` | Show plan usage limits. |
| `/extra-usage` | Configure extra usage when limits are reached. |
| `/upgrade` | Open upgrade options for higher limits. |
| `/remote-env` | Configure the default environment for remote sessions. |
| `/remote-control` | Connect the local terminal to remote-control sessions. Alias: `/rc`. |
| `/web-setup` | Set up web-based remote session support. |
| `/session` | Show a remote session URL and QR code. |
| `/voice` | Toggle voice mode. |
| `/files` | List files currently in context. |
| `/tag` | Toggle a searchable tag on the current session. |
| `/ultrareview` | Start a deeper remote bug finding and verification flow when available. |
| `/passes` | Share Claude Code trial access. |
| `/stickers` | Open the sticker request flow. |
| `/think-back` | Year-in-review style feature, shown only when enabled. |

## Desktop Composer Shortcuts

The desktop composer provides these fixed commands. The frontend handles local panels, settings, and model commands directly; the remaining commands are sent to the current agent session.

| Command | Purpose |
|---------|---------|
| `/mcp` | Open available MCP tools for the current chat. |
| `/skills` | Open the Skills browser. |
| `/help` | Show desktop and agent command help. |
| `/status` | Show session status, usage, and context. |
| `/cost` | Show session usage and costs. |
| `/context` | Show current context usage. |
| `/doctor` | Open desktop diagnostics. |
| `/memory` | Inspect memory files for this session. |
| `/bug` | Open feedback and bug report options. |
| `/plugin` | Open plugin settings. |
| `/config` | Open desktop configuration. |
| `/permissions` | Open permission settings. |
| `/terminal-setup` | Open terminal integration settings. |
| `/login` | Open provider and account sign-in settings. |
| `/logout` | Open account sign-out settings. |
| `/agents` | Open agent configuration. |
| `/compact` | Compact conversation context. |
| `/clear` | Clear conversation history. |
| `/review` | Start a code review task. |
| `/commit` | Create a Git commit. |
| `/pr` | Create a pull request. |
| `/init` | Initialize project `CYBER.md`. |
| `/model` | Open model switching. |

Desktop aliases: `/plugins` is the same as `/plugin`, and `/feedback` is the same as `/bug`.

## Dynamic Commands

These commands are not fixed, so they vary by project, plugin, and MCP setup.

| Source | Form | Notes |
|--------|------|-------|
| Project Skills | `/skill-name` | Skills loaded from user or project directories. |
| Plugin Skills | `/plugin-skill` | Skills provided by installed plugins. |
| MCP Skills | `/mcp-skill` | Prompts or Skills exposed by MCP servers. |
| Workflow | `/workflow-name` | Commands generated from workflow scripts. |

If this page differs from your app, trust `/help`, `/skills`, and the suggestions shown after typing `/` in the current session.

## Normal Shell Equivalents

These are not slash commands. They are useful for scripts or management work outside the TUI.

| Shell command | Purpose |
|---------------|---------|
| `cybercode mcp list` | List MCP servers. |
| `cybercode mcp add ...` | Add an MCP server. |
| `cybercode mcp remove <name>` | Remove an MCP server. |
| `cybercode plugin list` | List installed plugins. |
| `cybercode plugin install <plugin>` | Install a plugin. |
| `cybercode plugin uninstall <plugin>` | Uninstall a plugin. |
| `cybercode plugin marketplace list` | List plugin marketplaces. |
| `cybercode agents` | List custom agents. |
| `cybercode doctor` | Check runtime and updater health. |
| `cybercode auth login` | Sign in to an Anthropic account. |
| `cybercode auth status` | Show sign-in status. |
| `cybercode auth logout` | Sign out. |
| `cybercode update` | Check for and install CLI updates. |
| `cybercode --help` | Show the full shell command reference for the installed version. |
