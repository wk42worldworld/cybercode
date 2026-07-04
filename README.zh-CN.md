# CyberCode

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/cybercode-wordmark-dark.png">
    <img src="docs/images/cybercode-wordmark.png" alt="CyberCode" width="520">
  </picture>
</p>

<p align="center">
  <strong>语言：</strong>
  <a href="README.md">English</a> ·
  <strong>简体中文</strong> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<div align="center">

[![GitHub Stars](https://img.shields.io/github/stars/wk42worldworld/cybercode?style=social)](https://github.com/wk42worldworld/cybercode/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/wk42worldworld/cybercode?style=social)](https://github.com/wk42worldworld/cybercode/network/members)
[![GitHub Issues](https://img.shields.io/github/issues/wk42worldworld/cybercode)](https://github.com/wk42worldworld/cybercode/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/wk42worldworld/cybercode)](https://github.com/wk42worldworld/cybercode/pulls)
[![Docs](https://img.shields.io/badge/📖_文档站点-Visit-D97757)](https://github.com/wk42worldworld/cybercode)

</div>

**高度借鉴 Claude Code 设计**的本地可运行客户端，支持接入任意 Anthropic 兼容 API（MiniMax、OpenRouter 等）。在完整 TUI 之外，还补全了 Computer Use（macOS / Windows）、打造了图形化**桌面端**，并支持通过 Telegram / 飞书**完整远程驱动**。

<p align="center">
  <a href="#功能">功能</a> · <a href="#架构概览">架构概览</a> · <a href="#快速开始">快速开始</a> · <a href="#分章节教程">分章节教程</a> · <a href="docs/guide/env-vars.md">环境变量</a> · <a href="docs/guide/faq.md">FAQ</a> · <a href="docs/guide/global-usage.md">全局使用</a> · <a href="#更多文档">更多文档</a>
</p>

---

## 最新重点特性

最新稳定桌面版：[CyberCode v1.0.13](https://github.com/wk42worldworld/cybercode/releases/tag/v1.0.13)

- **运行中输入缓存与引导**：AI 正在答复时再次发送内容，会先进入待处理提示条；用户可以编辑、删除、加入当前任务；如果继续排队，本轮结束后会自动作为下一轮发送。
- **模型上下文窗口感知**：模型预设现在可以携带 context window 元数据，桌面会把这些限制传入会话，让第三方模型长上下文行为更稳定。
- **四平台桌面端发布**：GitHub Actions 现在会同时发布 macOS Apple Silicon、macOS Intel、Windows x64、Linux x64，并生成 `latest.json` 更新元数据。
- **macOS 安装包已公证**：macOS 桌面端包已完成签名和 Apple notarization，正常安装时不再触发之前那类“可能是恶意软件”的 Gatekeeper 提示。
- **Windows 工具运行时兜底**：CyberCode 会优先寻找 Git Bash，找不到就自动回退到 PowerShell，并且只把当前环境真正可执行的工具暴露给模型。
- **文件上传更灵活**：遇到模型不直接支持的音频、二进制或其他文件类型时，会按文件路径传递，避免请求被卡住。
- **命令执行状态更清晰**：正在运行的命令块会在父级命令行和子级工具行同时展示 GPT 风格的文字高光横扫效果。

---

## 功能

- 完整的 Ink TUI 交互界面（与官方 Claude Code 一致）
- `--print` 无头模式（脚本/CI 场景）
- 支持 MCP 服务器、插件、Skills
- 支持自定义 API 端点和模型（[第三方模型使用指南](docs/guide/third-party-models.md)）
- AI 运行中再次输入时支持待处理提示条、编辑、删除和加入当前任务
- 模型/供应商上下文窗口元数据，让长上下文会话更可靠
- 工具运行时会按当前环境兜底，包括 Windows 上的 Git Bash / PowerShell 自动切换
- 桌面端上传不支持的文件类型时会自动按文件路径传给模型
- 命令执行块支持运行中高光进度效果
- **记忆系统**（跨会话持久化记忆）— [使用指南](docs/memory/01-usage-guide.md)
- **多 Agent 系统**（多代理编排、并行任务、Teams 协作）— [使用指南](docs/agent/01-usage-guide.md) | [实现原理](docs/agent/02-implementation.md)
- **Skills 系统**（可扩展能力插件、自定义工作流）— [使用指南](docs/skills/01-usage-guide.md) | [实现原理](docs/skills/02-implementation.md)
- **Channel 系统**（通过 Telegram/飞书/Discord 等 IM 远程控制 Agent）— [架构解析](docs/channel/01-channel-system.md)
- **Computer Use 桌面控制** — [功能指南](docs/features/computer-use.md) | [架构解析](docs/features/computer-use-architecture.md)
- **桌面端**（Tauri 2 + React 图形化客户端，多标签多会话）— [文档](docs/desktop/)
- 降级 Recovery CLI 模式（`CYBERCODE_FORCE_RECOVERY_CLI=1 ./bin/cybercode`）

---

## 架构概览

<table>
  <tr>
    <td align="center" width="25%"><img src="docs/images/01-overall-architecture.png" alt="整体架构"><br><b>整体架构</b></td>
    <td align="center" width="25%"><img src="docs/images/02-request-lifecycle.png" alt="请求生命周期"><br><b>请求生命周期</b></td>
    <td align="center" width="25%"><img src="docs/images/03-tool-system.png" alt="工具系统"><br><b>工具系统</b></td>
    <td align="center" width="25%"><img src="docs/images/04-multi-agent.png" alt="多 Agent 架构"><br><b>多 Agent 架构</b></td>
  </tr>
  <tr>
    <td align="center" width="25%"><img src="docs/images/05-terminal-ui.png" alt="终端 UI"><br><b>终端 UI</b></td>
    <td align="center" width="25%"><img src="docs/images/06-permission-security.png" alt="权限与安全"><br><b>权限与安全</b></td>
    <td align="center" width="25%"><img src="docs/images/07-services-layer.png" alt="服务层"><br><b>服务层</b></td>
    <td align="center" width="25%"><img src="docs/images/08-state-data-flow.png" alt="状态与数据流"><br><b>状态与数据流</b></td>
  </tr>
</table>

---

## 桌面端下载

<p align="center">
  <a href="https://github.com/wk42worldworld/cybercode/releases"><img src="https://img.shields.io/badge/⬇_下载桌面端-macOS_%7C_Linux_%7C_Windows-D97757?style=for-the-badge" alt="下载桌面端"></a>
  &nbsp;
  <a href="docs/desktop/04-installation.md"><img src="https://img.shields.io/badge/📖_安装指南-Guide-gray?style=for-the-badge" alt="安装指南"></a>
</p>

---

## 快速开始

### 1. 安装 Bun

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# macOS (Homebrew)
brew install bun

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

> 精简版 Linux 如提示 `unzip is required`，先运行 `apt update && apt install -y unzip`

### 2. 安装依赖并配置

```bash
bun install
cp .env.example .env
# 编辑 .env 填入你的 API Key，详见 docs/guide/env-vars.md
```

### 3. 启动

#### macOS / Linux

```bash
./bin/cybercode                          # 交互 TUI 模式
./bin/cybercode -p "your prompt here"    # 无头模式
./bin/cybercode --help                   # 查看所有选项
```

#### Windows

> 推荐安装 [Git for Windows](https://git-scm.com/download/win) 以获得 Bash 兼容命令体验。如果没有 Git Bash，CyberCode 会自动回退到 PowerShell。

```powershell
# PowerShell / cmd 直接调用 Bun
bun --env-file=.env ./src/entrypoints/cli.tsx

# 或在可用时通过 Git Bash 运行
./bin/cybercode
```

### 4. 全局使用（可选）

将 `bin/` 加入 PATH 后可在任意目录启动，详见 [全局使用指南](docs/guide/global-usage.md)：

```bash
export PATH="$HOME/path/to/cybercode/bin:$PATH"
```

### 5. 桌面端联调（Desktop）

如果你在开发或测试 `desktop/` 前端，需要同时启动 API 服务端和桌面前端。

#### 5.1 启动服务端

```bash
cd /path/to/cybercode
SERVER_PORT=3456 bun run src/server/index.ts
```

可选自检：

```bash
curl http://127.0.0.1:3456/health
```

#### 5.2 启动桌面前端

```bash
cd /path/to/cybercode/desktop
bun run dev --host 127.0.0.1 --port 2024
```

然后在浏览器打开：

```text
http://127.0.0.1:2024
```

#### 5.3 常见注意事项

- 如果 `3456` 端口已经被旧服务端占用，先执行 `lsof -nP -iTCP:3456 -sTCP:LISTEN` 找到 PID，再 `kill <PID>`。
- 测试聊天时建议新建一个 session，并重新选择一个真实存在的工作目录。
- 如果某个旧 session 绑定的目录已被删除，服务端会返回 `Working directory does not exist`，这和服务端是否启动是两回事。

---

## 分章节教程

第一次使用 CyberCode 时，可以按下面章节一步一步走。每章最后都有“完成结果”，方便确认当前步骤是否成功。

### 第 1 章：选择使用方式

CyberCode 常见有三种使用方式：

| 方式 | 适合场景 | 你需要做什么 |
|------|------|------|
| 桌面端 App | 日常编码、多会话聊天、可视化切换项目 | 从 [GitHub Releases](https://github.com/wk42worldworld/cybercode/releases) 下载最新安装包 |
| 源码 CLI | 喜欢终端、需要本地开发、脚本化调用 | 克隆仓库，安装 Bun，然后执行 `bun install` |
| 桌面端开发模式 | 调试 React/Tauri 前端源码 | 按 [桌面端联调](#5-桌面端联调desktop) 同时启动 API 服务和 Vite 前端 |

完成结果：你已经明确自己要安装桌面端、运行 CLI，还是调试桌面端前端。

### 第 2 章：准备模型供应商

CyberCode 使用 Anthropic 兼容接口。MiniMax、OpenRouter 等如果提供兼容端点，可以直接使用；只有 OpenAI 协议的供应商通常需要通过 LiteLLM 这类代理转换。

1. 在模型供应商控制台创建或复制 API Key。
2. 复制示例环境变量文件：

```bash
cp .env.example .env
```

3. 编辑 `.env`，至少填写：

```env
ANTHROPIC_AUTH_TOKEN=your_api_key_here
ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
ANTHROPIC_MODEL=MiniMax-M2.7
```

如果供应商要求使用 `x-api-key` 头，也可以把 `ANTHROPIC_AUTH_TOKEN` 换成 `ANTHROPIC_API_KEY`。更多供应商示例见 [环境变量](docs/guide/env-vars.md) 和 [第三方模型](docs/guide/third-party-models.md)。

完成结果：`.env` 里已经有可用的 Key、接口地址和模型名。

### 第 3 章：运行第一个 CLI 任务

先启动交互式终端界面：

```bash
./bin/cybercode
```

建议先发一个小任务，例如：

```text
阅读这个项目，并总结主要入口文件。
```

如果是脚本或 CI 场景，可以使用无头模式：

```bash
./bin/cybercode -p "总结 package.json，并列出可用 scripts"
```

完成结果：CyberCode 能连接到模型供应商，并在终端里流式输出回答。

### 第 4 章：打开真实项目

CyberCode 最适合在需要修改的项目目录里工作。

1. 在项目根目录启动 CyberCode，或在桌面端选择项目文件夹。
2. 先让它做一个小范围检查：`解释 src/ 目录结构`。
3. 当 CyberCode 请求运行命令或编辑文件权限时，先看清楚动作，只批准你信任的操作。
4. 第一轮成功后，再提出更聚焦的任务，例如：`修复这个文件里的失败测试`。

完成结果：助手已经在正确目录工作，你也能看见它准备使用哪些文件和命令。

### 第 5 章：顺畅使用桌面端

如果使用已安装桌面端，直接打开 CyberCode 并为项目创建会话即可。如果是本地前端开发，先运行：

```bash
SERVER_PORT=3456 bun run src/server/index.ts
```

再打开另一个终端：

```bash
cd desktop
bun run dev --host 127.0.0.1 --port 2024
```

访问 `http://127.0.0.1:2024`，创建或选择会话，然后绑定真实存在的工作目录。

几个实用习惯：

- AI 正在回复时继续输入，新内容会进入待处理输入行。
- 待处理输入在发送前可以编辑或删除。
- 当前 AI 回复结束后，排队的待处理输入会自动作为下一轮用户消息发送。
- 如果某类文件不能直接发给模型，桌面端会按文件路径传递，让 Agent 仍然可以处理。

完成结果：你可以连续多轮编码，不会丢失 AI 忙碌期间输入的消息。

### 第 6 章：让 CLI 在任意目录可用

把仓库的 `bin/` 目录加入 PATH：

```bash
export PATH="$HOME/path/to/cybercode/bin:$PATH"
```

然后在另一个项目目录测试：

```bash
cybercode --help
cybercode -p "当前目录有哪些文件？"
```

如果想永久生效，把 `export PATH=...` 这一行加入 `~/.zshrc` 或 `~/.bashrc`。

完成结果：你可以在任意项目目录直接运行 `cybercode`。

### 第 7 章：排查首次运行常见问题

| 问题 | 检查方式 |
|------|------|
| `command not found: cybercode` | 在仓库内用 `./bin/cybercode`，或把 `bin/` 加入 PATH |
| API Key 或 401 错误 | 重新检查 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL` 和模型名 |
| Windows 命令执行失败 | 安装 [Git for Windows](https://git-scm.com/download/win)，或让 CyberCode 自动回退到 PowerShell |
| 桌面端连不上服务 | 确认服务端运行在 `127.0.0.1:3456` |
| `3456` 端口被占用 | 用 `lsof -nP -iTCP:3456 -sTCP:LISTEN` 找到旧进程，再执行 `kill <PID>` |
| `Working directory does not exist` | 为当前会话重新选择一个真实存在的项目目录 |
| 长提示词异常失败 | 选择上下文窗口足够大的模型/供应商，或更新模型配置里的上下文元数据 |

完成结果：你能判断问题属于终端环境、API 配置、服务启动，还是项目路径选择。

### 第 8 章：继续学习核心功能

| 目标 | 继续阅读 |
|------|------|
| 接入 OpenAI、DeepSeek、Ollama 或其他供应商 | [第三方模型](docs/guide/third-party-models.md) |
| 配置全部环境变量 | [环境变量](docs/guide/env-vars.md) |
| 在任意目录启动 CyberCode | [全局使用](docs/guide/global-usage.md) |
| 使用跨会话记忆 | [记忆系统](docs/memory/01-usage-guide.md) |
| 使用多个 Agent 协作 | [多 Agent 系统](docs/agent/01-usage-guide.md) |
| 接入 Telegram 或飞书 | [Channel 系统](docs/channel/01-channel-system.md) |
| 控制桌面应用 | [Computer Use](docs/features/computer-use.md) |

完成结果：你可以从第一个可用会话，自然进入自己真正需要的功能模块。

---

## 技术栈

| 类别 | 技术 |
|------|------|
| 运行时 | [Bun](https://bun.sh) |
| 语言 | TypeScript |
| 终端 UI | React + [Ink](https://github.com/vadimdemedes/ink) |
| CLI 解析 | Commander.js |
| API | Anthropic SDK |
| 协议 | MCP, LSP |

---

## 更多文档

| 文档 | 说明 |
|------|------|
| [环境变量](docs/guide/env-vars.md) | 完整环境变量参考和配置方式 |
| [第三方模型](docs/guide/third-party-models.md) | 接入 OpenAI / DeepSeek / Ollama 等非 Anthropic 模型 |
| [记忆系统](docs/memory/01-usage-guide.md) | 跨会话持久化记忆的使用与实现 |
| [多 Agent 系统](docs/agent/01-usage-guide.md) | 多代理编排、并行任务执行与 Teams 协作 |
| [Skills 系统](docs/skills/01-usage-guide.md) | 可扩展能力插件、自定义工作流与条件激活 |
| [Channel 系统](docs/channel/01-channel-system.md) | 通过 Telegram/飞书/Discord 等 IM 平台远程控制 Agent |
| [Computer Use](docs/features/computer-use.md) | 桌面控制功能（截屏、鼠标、键盘）— [架构解析](docs/features/computer-use-architecture.md) |
| [桌面端](docs/desktop/) | Tauri 2 + React 图形化客户端 — [快速上手](docs/desktop/01-quick-start.md) \| [架构设计](docs/desktop/02-architecture.md) \| [安装指南](docs/desktop/04-installation.md) |
| [全局使用](docs/guide/global-usage.md) | 在任意目录启动 cybercode |
| [常见问题](docs/guide/faq.md) | 常见错误排查 |
| [项目结构](docs/reference/project-structure.md) | 代码目录结构说明 |

---

## 感谢

感谢以下开源项目和社区实践为本项目提供参考与启发：

- [React](https://github.com/facebook/react)：前端工程与组件化 UI 生态。
- [Tauri](https://github.com/tauri-apps/tauri)：跨端桌面应用能力与工程实践。
- [cc-switch](https://github.com/farion1231/cc-switch)：模型供应商配置能力参考。

---

## ⭐ Star 趋势图

如果这个项目对您有帮助，请给个 ⭐ Star 支持一下，让更多的人看到 CyberCode！

<a href="https://www.star-history.com/#wk42worldworld/cybercode&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=wk42worldworld/cybercode&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=wk42worldworld/cybercode&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=wk42worldworld/cybercode&type=Date" />
  </picture>
</a>

---

## Disclaimer

本项目**高度借鉴** [Anthropic](https://www.anthropic.com) 推出的 Claude Code 的产品设计、交互模式与功能架构进行独立实现。Claude / Claude Code 是 Anthropic 的商标，相关 API 与协议归 Anthropic 所有。本项目仅作技术学习与研究用途，与 Anthropic 无任何商业关联。
