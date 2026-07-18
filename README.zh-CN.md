# CyberCode

<p align="center">
  <img src="docs/images/cybercode-app-icon.png" alt="CyberCode app icon" width="112"><br>
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
[![Docs](https://img.shields.io/badge/📖_文档站点-Visit-D97757)](https://wk42worldworld.github.io/cybercode/)

</div>

<p align="center">
  <strong>她不是工具，她是伙伴。</strong><br>
  <strong>She is not a tool. She is a partner.</strong><br>
  <strong>彼女はツールではなく、パートナーです。</strong><br>
  <strong>그녀는 도구가 아니라, 파트너입니다.</strong>
</p>

一个在 **Claude Code 风格基础上扩展永久记忆与自进化能力** 的本地可运行 Agent，支持接入任意 Anthropic 兼容 API（MiniMax、OpenRouter 等）。在完整 TUI 之外，还补全了 Computer Use（macOS / Windows）、打造了图形化**桌面端**，并支持通过 Telegram / 飞书**完整远程驱动**。

<p align="center">
  <strong>带有永久记忆与自进化能力的开源 Claude Code 风格桌面 Agent。</strong><br>
  自带 CLI、桌面端、IM 远程控制、定时任务和 Computer Use；你可以接自己的模型，在本地跑真实编码会话。
</p>

<p align="center">
  <a href="#安装命令行版本">安装 CLI</a> · <a href="#为什么是-cybercode">为什么</a> · <a href="#快速对比">对比</a> · <a href="#图形界面速览">图形界面</a> · <a href="#功能">功能</a> · <a href="#从源码运行">从源码运行</a> · <a href="#分章节教程">分章节教程</a> · <a href="#功能模块教程">模块教程</a> · <a href="docs/guide/env-vars.md">环境变量</a> · <a href="#社区与传播">社区</a> · <a href="#更多文档">更多文档</a>
</p>

---

## 安装命令行版本

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/wk42worldworld/cybercode/main/scripts/install-cli.sh | bash
```

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/wk42worldworld/cybercode/main/scripts/install-cli.ps1 | iex
```

安装完成后，在任意项目目录启动 Agent：

```bash
cybercode
```

安装器会自动获取最新稳定版；没有 Bun 时会自动安装，并把 `cybercode` 加入当前用户的 PATH。整个过程不需要管理员权限，更新时也会保留已有 CLI `.env`。执行前可以先查看 [macOS/Linux 安装脚本](scripts/install-cli.sh) 或 [Windows 安装脚本](scripts/install-cli.ps1)。

### 常用 CLI 命令

| 命令 | 用途 |
|------|------|
| `cybercode` | 在当前项目启动交互式 Agent |
| `cybercode "解释这个仓库"` | 带一条初始任务启动 Agent |
| `cybercode -p "修复失败的测试"` | 输出结果后退出，适合脚本和 CI |
| `cybercode -c` | 继续当前项目最近一次会话 |
| `cybercode -r` | 选择并恢复已保存的会话 |
| `cybercode --model <model>` | 为当前会话指定模型 |
| `cybercode --permission-mode plan` | 以规划模式启动 |
| `cybercode -p --output-format json "..."` | 返回便于程序处理的 JSON |
| `cybercode -w feature-name` | 为会话创建隔离的 Git worktree |
| `cybercode mcp --help` | 配置和管理 MCP 服务器 |
| `cybercode plugin --help` | 安装和管理插件 |
| `cybercode doctor` / `cybercode --help` | 诊断运行环境或查看全部选项 |

更多示例和参数组合请查看 [CLI 快速开始](https://wk42worldworld.github.io/cybercode/guide/quick-start)。

需要图形界面？可以直接[下载 macOS、Windows 或 Linux 桌面端](https://github.com/wk42worldworld/cybercode/releases/latest)。

---

## 为什么是 CyberCode

| 如果你想要... | CyberCode 提供... |
|------|------|
| Claude Code 风格 Agent，但不想被单一供应商绑定 | Anthropic 兼容端点、OpenAI 兼容供应商代理接入、供应商/模型上下文窗口元数据 |
| 不只在终端里用，而是有桌面端 | Tauri + React GUI、多会话标签、项目切换、文件附件、权限弹窗、模型/供应商设置 |
| 本地 Agent 能在你离开时继续工作 | Telegram / 飞书远程控制、定时任务、后台 Agent、跨会话记忆 |
| 一个能研究高级 Agent 能力的开源项目 | 多 Agent 编排、Skills、MCP、Computer Use、自定义供应商、CLI 无头模式 |

## 核心优势详解

### 不只是记住聊天，而是逐渐学会与你协作

CyberCode 会从长期协作中提炼稳定的沟通偏好、项目知识和跨任务做事方法，让新会话不必每次从零开始。重复验证有效的工作方式还可以沉淀为 Skill 候选，逐步形成更适合你的执行习惯。

这些认知并不是不可见的黑箱。桌面端会展示「CyberCode 对你的了解」与「已提炼的做事方法」，注明来源和分类；每条内容都可以编辑或删除，底层记忆文件和学习记录也由用户自己掌控。

<p align="center">
  <img src="docs/images/gui/cybercode-memory-evolution.png" alt="CyberCode 记忆与自进化画像" width="980">
</p>

### 把上下文当成有限资源来管理

大型仓库、冗长命令输出、重复系统提示和过期工具结果都会挤占模型上下文。CyberCode 将 Lite 基础清理、智能裁剪、懒程序员策略、Caveman 响应压缩、RTK 工具输出压缩和代码图谱拆成可独立控制的优化层，用户可以按需全局开启或关闭。

面板会显示每层当前状态、作用范围和组合后的预估节省区间。这里展示的是透明的估算，不会把估算包装成保证发生的账单降幅。

<p align="center">
  <img src="docs/images/gui/cybercode-token-optimization.png" alt="CyberCode Token 优化面板" width="980">
</p>

### 先理解代码关系，再决定读取哪些文件

本地代码图谱会索引文件、符号、引用与调用关系。Agent 可以先获得紧凑的架构和依赖上下文，再定位真正需要打开的源码，减少在陌生大型仓库中逐文件试探。它尤其适合实现定位、影响分析和跨文件重构。

同一份索引也能在桌面端直接查看：支持搜索符号、切换架构与文件视图、缩放模块，并在代码变化后重建索引。

<p align="center">
  <img src="docs/images/gui/cybercode-code-graph.png" alt="CyberCode 本地代码图谱" width="980">
</p>

### 模型能力与产品能力解耦

无论选择 Claude 官方路径、Anthropic 兼容接口、OpenAI 兼容供应商还是本地端点，桌面工作流、工具与记忆能力都保持一致。对于原生联网能力不稳定的模型，CyberCode 还提供与模型厂商无关的本地 WebSearch 兜底，支持实时搜索、域名过滤、缓存和 GitHub Trending 直连抓取，避免模型只能依赖过期训练知识。

<table>
  <tr>
    <td width="50%"><img src="docs/images/gui/cybercode-gui-providers.png" alt="CyberCode 供应商配置"><br><b>在应用内管理供应商</b><br>配置云端或本地接口、测试连接并设置默认供应商，不必离开桌面工作流。</td>
    <td width="50%"><img src="docs/images/gui/cybercode-gui-model-picker.png" alt="CyberCode 模型选择器"><br><b>每个会话自由选择模型</b><br>选择已知模型或填写自定义模型标识，同时保留相同的 Agent 工具与界面。</td>
  </tr>
</table>

### 同一个 Agent，贯穿桌面、终端和远程渠道

React + Tauri 桌面端和 Ink 终端界面共享同一个本地 Agent 核心。文件附件、反斜杠命令、权限控制、MCP、Skills、插件、后台 Agent、Agent Teams、Git worktree、Computer Use 与无头输出都属于同一套工作流，而不是彼此割裂的产品。

Telegram 和飞书适配器可以在用户离开电脑后继续传递会话与权限请求。定时任务则支持一次性或周期性的本地工作，让仓库维护和例行检查不必等待手动打开聊天窗口。

<p align="center">
  <img src="docs/images/gui/cybercode-gui-scheduled-tasks.png" alt="CyberCode 定时编码任务" width="900">
</p>

### 保持可检查、可编辑和可迁移

CyberCode 将客户端、服务端、桌面壳、适配器、记忆、搜索、供应商桥接和优化逻辑全部开放。Agent 数据迁移工具会在导入前检查其他本地 Agent 中兼容的 Skills、记忆、规则与项目资料，降低更换工具时丢失长期积累的成本。

## 能力全景

| 领域 | 已包含能力 |
|---|---|
| 编码工作流 | 文件编辑、终端工具、项目搜索、权限模式、反斜杠命令、附件、回退、分支与会话恢复 |
| Agent 智能 | 永久记忆、自进化复盘、可复用 Skills、子 Agent、Agent Teams、后台任务与 worktree |
| 上下文效率 | 动态上下文窗口感知、自动压缩、Lite 清理、智能裁剪、懒程序员、Caveman、RTK 与代码图谱 |
| 模型接入 | Claude 官方登录、Anthropic 兼容 API、OpenAI 兼容供应商、本地端点、自定义模型与模型上下文元数据 |
| 联网与工具 | 与供应商无关的 WebSearch 兜底、WebFetch、MCP、插件、Computer Use 与环境感知工具可用性 |
| 使用界面 | 跨平台桌面端、终端 TUI、`--print` 无头模式、Telegram 与飞书 |
| 自动化 | 一次性和周期性定时任务、远程授权、后台 Agent 与机器可读 JSON 输出 |
| 可迁移性 | Agent 数据迁移、可编辑本地记忆、开放适配器与开源本地服务端 |

## 快速对比

| 需求 | CyberCode | Claude Code | Cursor / Cline / Roo 类工具 |
|------|------|------|------|
| 自带供应商配置 | 围绕自定义供应商和 Anthropic 兼容接口设计 | 主要是官方 Anthropic 路径 | 视工具而定 |
| 桌面 GUI | 内置跨平台桌面端 | 终端优先 | 通常编辑器优先 |
| CLI 和无头模式 | 支持 | 支持 | 通常不是主路径 |
| IM 远程控制 | Telegram / 飞书 adapters | 不是默认工作流 | 通常需要外部方案 |
| 定时编码任务 | 集成到桌面端工作流 | 不是默认工作流 | 视工具而定 |
| Computer Use | 支持 macOS 和 Windows | 官方功能路径 | 视工具而定 |
| 开源可改造 | 仓库包含桌面端、服务端、适配器和文档 | 闭源产品 | 视工具而定 |

## 图形界面速览

CyberCode 桌面端把核心编码工作流放在一个界面里：选择项目、和 Agent 对话、配置供应商、切换模型、创建定时任务，都可以直接在 GUI 内完成。

<p align="center">
  <img src="docs/images/gui/cybercode-gui-home.png" alt="CyberCode 桌面端首页和会话选择" width="860">
</p>

<table>
  <tr>
    <td width="50%"><img src="docs/images/gui/cybercode-gui-chat.png" alt="CyberCode 桌面端聊天工作区"><br><b>项目聊天工作区</b><br>支持多会话桌面聊天、紧凑输入框、文件附件入口、供应商/模型选择，并保留项目上下文。</td>
    <td width="50%"><img src="docs/images/gui/cybercode-gui-model-picker.png" alt="CyberCode 供应商模型选择器"><br><b>按供应商选择模型</b><br>每个供应商既能手动填写自定义模型名，也能从按新到旧整理的模型下拉选项里选择。</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/gui/cybercode-gui-providers.png" alt="CyberCode 供应商列表"><br><b>内置供应商列表</b><br>内置 OpenAI、Google、DeepSeek、Kimi、MiniMax、GLM、OpenRouter、Claude 兼容端点等常见供应商入口。</td>
    <td width="50%"><img src="docs/images/gui/cybercode-gui-scheduled-tasks.png" alt="CyberCode 定时任务面板"><br><b>定时编码任务</b><br>可以创建一次性或周期性的自动化任务，让本地 Agent 在你离开时继续处理工作。</td>
  </tr>
</table>

## 社区与传播

- 新贡献者可以先看 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [Roadmap](ROADMAP.md)。
- 想帮忙传播，可以直接使用 [Launch Kit](docs/marketing/launch-kit.md) 里的发布文案。
- 适合新手贡献的方向：文档、供应商预设、翻译、可复现 bug 报告、桌面端交互打磨、不同平台安装说明。

---

## 最新重点特性

最新稳定桌面版：[查看 GitHub Releases](https://github.com/wk42worldworld/cybercode/releases/latest)

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

## 从源码运行

下面的步骤适用于开发或直接运行仓库源码。日常使用 CLI，建议优先使用上面的[一行安装命令](#安装命令行版本)。

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

## 功能模块教程

这一节是按功能模块拆开的使用手册。你已经能启动 CyberCode 后，可以按自己的需求逐个模块查看。

### 模块 1：桌面端安装与更新

如果你想使用正常图形界面，而不是从源码启动，就看这一节。

1. 打开 [GitHub Releases](https://github.com/wk42worldworld/cybercode/releases)。
2. 按平台下载对应安装包：
   - macOS Apple Silicon：`macos_arm64_dmg.dmg`
   - macOS Intel：`macos_x64_dmg.dmg`
   - Windows x64：`windows_x64_nsis.exe`
   - Linux x64：`linux_x64_deb.deb`
3. 使用系统默认安装方式安装。
4. 启动 CyberCode，创建新会话。
5. 发送第一条编码请求前，先选择一个真实存在的项目目录。

验证结果：应用能打开，左侧能看到会话列表，底部状态栏能看到当前项目和模型。

注意事项：

- macOS 安装包已经公证；如果仍被系统拦截，参考 [安装指南](docs/desktop/04-installation.md)。
- Release 中也会包含 `latest.json`，用于桌面端更新元数据。

### 模块 2：模型供应商、模型映射与上下文窗口

如果你要接入 MiniMax、OpenRouter、通过代理接 OpenAI、Ollama 或其他兼容供应商，就看这一节。

1. 打开桌面端。
2. 进入设置 -> Providers。
3. 选择一个预设，或添加自定义供应商。
4. 填写：
   - 供应商名称
   - API Key
   - Base URL
   - API 协议：`Anthropic`、`OpenAI Chat` 或 `OpenAI Responses`
   - 模型映射：`main`、`haiku`、`sonnet`、`opus`
5. 如果知道模型最大上下文，填写上下文窗口，例如 `200k` 或 `1m`。
6. 点击测试连接。
7. 激活该供应商。
8. 点击底部状态栏的模型名称，为当前会话选择模型。

验证结果：发送一条短消息后，打开 `/context` 或上下文面板，确认当前模型和上下文上限符合预期。

注意事项：

- Anthropic 兼容接口可以直接填写供应商 URL。
- 只有 OpenAI 协议的接口通常需要 LiteLLM 等代理转换，详见 [第三方模型](docs/guide/third-party-models.md)。
- 如果模型名里包含 `200k` 或 `1m` 这类明显标记，CyberCode 可以推断上下文窗口；但显式配置更可靠。

### 模块 3：CLI 与无头模式

如果你偏好终端、自动化脚本或 CI，就看这一节。

1. 安装依赖：

```bash
bun install
```

2. 创建环境变量文件：

```bash
cp .env.example .env
```

3. 编辑 `.env`，填入供应商配置。
4. 启动交互式 TUI：

```bash
./bin/cybercode
```

5. 执行一次性提示词：

```bash
./bin/cybercode -p "解释这个仓库的结构"
```

6. 查看所有参数：

```bash
./bin/cybercode --help
```

验证结果：交互模式能打开，`-p` 模式能直接输出完整回答，不进入 TUI。

注意事项：

- Windows 推荐安装 Git Bash；如果没有，CyberCode 会自动回退到 PowerShell。
- 如果想在任意目录运行 `cybercode`，把仓库的 `bin/` 加入 PATH。

### 模块 4：桌面端会话、项目与标签页

如果你要同时管理多个真实项目或多个任务，就看这一节。

1. 点击左侧 `+`，或按 `Cmd/Ctrl + N`。
2. 选择项目工作目录。
3. 先发送一个小范围检查任务，例如：`解释这个项目结构`。
4. 使用左侧项目筛选器，只显示某个项目的会话。
5. 使用侧边栏搜索，按标题查找旧会话。
6. 右键会话，可以重命名或删除。
7. 多个任务并行时，打开多个标签页。
8. 右键标签页，可以关闭当前、关闭其他、关闭左侧、关闭右侧或关闭全部。

验证结果：每个会话都绑定到正确项目路径，底部状态栏展示当前项目和模型。

注意事项：

- 关闭正在运行的标签页时，会提示继续运行、停止并关闭或取消。
- 如果会话绑定的目录已经删除，需要重新选择真实存在的文件夹。

### 模块 5：聊天输入、附件、斜杠命令、文件引用与输入缓存

如果你要发更复杂的消息，或在 AI 忙碌时继续输入，就看这一节。

1. 在底部输入框输入内容。
2. 按 `Enter` 发送，按 `Shift + Enter` 换行。
3. 通过粘贴、拖拽或 `+` 文件选择器添加附件。
4. 输入 `/` 打开斜杠命令，例如 `/status`、`/context`、`/memory`、`/mcp`、`/skills`。
5. 输入 `@` 搜索并引用项目文件。
6. AI 正在回复时继续发送消息，新消息会进入待处理输入行。
7. 待处理输入发送前可以编辑或删除。
8. 当前 AI 回复结束后，排队输入会自动作为下一轮用户消息发送。
9. 需要中断时，点击停止按钮或按 `Cmd/Ctrl + .`。

验证结果：附件显示在输入框上方，斜杠命令打开对应面板或命令，`@` 能解析到文件，AI 忙碌时输入的消息不会丢。

注意事项：

- 不支持直接传给模型的文件类型，会按文件路径传递，Agent 仍可通过工具读取。
- 待处理输入行只展示真实排队内容，不再显示无意义提示文字。

### 模块 6：权限控制与工具安全

只要 CyberCode 要执行 Shell 命令或修改文件，就应该理解这一节。

1. 在不熟悉的仓库里，保持默认询问权限模式。
2. 每次权限卡片弹出时，先看清楚内容。
3. 只想允许本次操作，点允许。
4. 确定当前会话里同类操作都可信，再点一直允许。
5. 命令、文件路径或 diff 看起来不对时，点拒绝。
6. 只想看方案、不想执行时，切换到计划模式。
7. 只在一次性环境或完全信任环境里使用绕过权限。

验证结果：文件编辑和 Shell 命令只会在权限策略允许后执行。

注意事项：

- 权限卡片会展示工具类型、命令或文件预览，以及可展开的详细参数。
- IM 远程控制里，权限请求也会以按钮卡片形式展示。

### 模块 7：记忆系统

如果你希望 CyberCode 跨会话记住偏好、项目规则或外部引用，就看这一节。

1. 正常对话即可，CyberCode 会在合适时机自动提取有价值记忆。
2. 想显式保存时，直接说：`记住这个：...`。
3. 输入 `/memory`，打开可编辑的记忆文件。
4. 输入 `/remember`，审查、提升、合并或清理自动记忆。
5. 某条记忆过期时，让 CyberCode 忘记它。
6. 想要干净回答时，说：`本轮忽略记忆`。

验证结果：出现记忆更新通知，后续会话能使用保存过的偏好或项目上下文。

适合保存的记忆：

- 测试必须使用真实数据库，不要 mock。
- 某个日期开始进入发布冻结。
- 仪表盘、工单队列、on-call 信息在外部系统里。

注意事项：

- 记忆应该保存无法从代码中推断出来的上下文。
- 可通过 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` 禁用自动记忆。

### 模块 8：多 Agent 工作流与 Agent Teams

如果任务很大，需要并行探索、规划或独立验证，就看这一节。

1. 让 CyberCode 拆分任务，例如：`先并行探索前端、后端和测试，再给我实现计划`。
2. 代码库调研使用 Explore agent。
3. 架构方案和实现步骤使用 Plan agent。
4. 改动完成后，用 verification agent 做独立验证。
5. 耗时任务可以要求后台 agent。
6. 实验性实现可以要求 worktree 隔离，避免影响主工作区。
7. 协作型任务可以让 CyberCode 创建 Agent Team，并给不同成员分工。

验证结果：CyberCode 会报告 agent 启动、后台任务完成、验证结果或团队总结。

注意事项：

- 每个 agent 的任务要尽量聚焦。
- 面对大范围或高风险修改，先用 verification agent 再做最终确认。

### 模块 9：Skills、插件与 MCP

如果你想把重复工作沉淀成可复用能力，就看这一节。

1. 输入 `/` 浏览当前可用命令。
2. 先尝试内置 Skills，例如 `/verify`、`/debug`、`/simplify`、`/remember`、`/batch`。
3. 在桌面端输入 `/skills`，查看当前上下文可由用户调用的 Skills。
4. 项目级 Skill 可创建在 `.claude/skills/<skill-name>/SKILL.md`。
5. 在 frontmatter 中填写 `description`、`when_to_use`、`allowed-tools`、`model`、`paths` 等字段。
6. 在 frontmatter 下方用 Markdown 写清楚工作流。
7. 通过 `/skill-name` 调用，或用自然语言提出明显符合 `when_to_use` 的任务。
8. 如果需要外部工具或外部 prompt，把 MCP server 接入 CyberCode。

验证结果：Skill 能在斜杠命令里出现，或在匹配任务时被模型自动调用。

注意事项：

- 用 `allowed-tools` 限制强能力 Skill 的工具范围。
- 项目级 Skills 可以放进仓库，适合团队共享流程。

### 模块 10：Telegram / 飞书 IM 远程控制

如果你想在手机或团队聊天工具里远程控制 CyberCode，就看这一节。

1. 打开桌面端设置。
2. 进入 IM 或 Adapters 配置区。
3. 填写 `serverUrl`，如果希望新聊天默认进入某个项目，也填写默认项目目录。
4. 填写平台凭据：
   - Telegram：Bot Token
   - 飞书：App ID 和 App Secret
5. 需要时配置允许用户。
6. 生成 6 位配对码。
7. 启动 adapter 进程：

```bash
cd adapters
bun install
bun run telegram
# 或
bun run feishu
```

8. 在 IM 私聊里把配对码发给 Bot。
9. 配对成功后，直接发送正常编码请求。
10. 需要时使用 `/new`、`/projects`、`/stop`。

验证结果：Bot 能连接到 CyberCode 会话，能流式回复，并用按钮展示权限请求。

注意事项：

- 配对码一次性使用，60 分钟后过期。
- 如果没有默认项目，Bot 会让你从最近项目中选择。

### 模块 11：定时任务

如果你希望 CyberCode 按计划自动执行某个 prompt，就看这一节。

1. 打开桌面端。
2. 点击左侧时钟图标。
3. 点击新建任务。
4. 填写任务名称和提示词。
5. 设置 Cron 表达式，或使用星期/时间可视化控件。
6. 选择运行时模型和权限模式。
7. 保存任务。
8. 用启用开关控制任务是否运行。
9. 点击立即运行，先手动测试一次。
10. 展开运行历史，查看以前的结果。

验证结果：任务列表中能看到人类可读的执行计划，手动运行后会生成历史记录。

注意事项：

- 定时任务依赖桌面端和本地服务可用。
- 无人值守任务建议使用保守权限模式。

### 模块 12：Computer Use 桌面控制

如果你希望模型通过截图、鼠标和键盘操作桌面应用，就看这一节。

1. 确保 Bun 依赖已经安装。
2. 确认 Python 3.8 或更新版本可用：

```bash
python3 --version
```

3. macOS 上需要给终端或桌面端宿主授权辅助功能和屏幕录制。
4. 启动 CyberCode。
5. 先发一个可观察的小任务，例如：`截屏看看现在打开了什么`。
6. CyberCode 请求应用访问权限时，按需批准。
7. 让模型按步骤截图、分析、点击、输入并确认结果。

验证结果：CyberCode 能截屏、请求应用访问权限，并且只操作已批准的应用。

注意事项：

- macOS Apple Silicon、macOS Intel、Windows x64 已支持。
- 可用 `CLAUDE_COMPUTER_USE_ENABLED=0` 禁用。
- 第一次使用先从简单、可观察的任务开始，不要直接交给复杂多应用流程。

### 模块 13：诊断、上下文与用量检查

如果你觉得会话状态不对，或想看当前上下文和用量，就看这一节。

1. 输入 `/status` 查看当前会话状态。
2. 输入 `/context` 查看上下文窗口占用、剩余 token、消息和工具结果占比。
3. 输入 `/cost` 查看可用的用量和成本信息。
4. 输入 `/doctor` 检查本地环境健康情况。
5. 测试本地桌面服务时，可运行 `curl http://127.0.0.1:3456/health`。
6. 供应商请求失败时，到 Settings -> Providers 里运行连接测试。
7. 桌面端无法接入某个会话时，先确认项目目录仍然存在。

验证结果：你能判断问题大概来自供应商配置、上下文压力、本地服务状态，还是项目路径失效。

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
| [Roadmap](ROADMAP.md) | 近期优先级和适合新手的贡献方向 |
| [Contributing](CONTRIBUTING.md) | 如何贡献文档、供应商配置、测试和桌面端修复 |
| [Launch Kit](docs/marketing/launch-kit.md) | 可直接复制使用的传播文案 |

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
