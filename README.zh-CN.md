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
  <a href="#功能">功能</a> · <a href="#架构概览">架构概览</a> · <a href="#快速开始">快速开始</a> · <a href="docs/guide/env-vars.md">环境变量</a> · <a href="docs/guide/faq.md">FAQ</a> · <a href="docs/guide/global-usage.md">全局使用</a> · <a href="#更多文档">更多文档</a>
</p>

---

## 最新重点特性

最新稳定桌面版：[CyberCode v1.0.8](https://github.com/wk42worldworld/cybercode/releases/tag/v1.0.8)

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
