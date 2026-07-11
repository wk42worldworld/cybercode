# 快速开始

## 安装 CLI（推荐）

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/wk42worldworld/cybercode/main/scripts/install-cli.sh | bash
```

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/wk42worldworld/cybercode/main/scripts/install-cli.ps1 | iex
```

安装器会自动获取 GitHub 最新稳定版；如果系统中没有 Bun，会一并安装，然后将 `cybercode` 加入当前用户的 PATH。整个过程不需要管理员权限。再次执行同一条命令即可更新，已有 CLI `.env` 会被保留。

安装脚本公开可审查：[macOS/Linux](https://github.com/wk42worldworld/cybercode/blob/main/scripts/install-cli.sh) · [Windows](https://github.com/wk42worldworld/cybercode/blob/main/scripts/install-cli.ps1)

## 启动 Agent

打开一个新的终端，进入项目目录后运行：

```bash
cd /path/to/your-project
cybercode
```

## 首次启动：跟着向导配置模型

第一次运行 `cybercode` 时，不需要提前安装 LiteLLM、配置代理或手工修改 `.env`。按照终端中的提示完成：

1. 选择终端主题。
2. 选择模型厂商。已有桌面端厂商配置会直接显示在列表顶部。
3. 选择默认模型。厂商发布了新模型但列表里还没有时，选择“输入其他模型 ID”。
4. 按提示填写 API Key。LM Studio、Ollama 等无需 Key 的本地服务会自动跳过这一步。
5. 确认当前项目目录可信，然后进入聊天界面。

| 厂商类型 | 示例 | CyberCode 如何连接 |
|------|------|------|
| Claude 官方 | Claude 账号、Anthropic Console Key | 直接连接 |
| OpenAI 兼容接口 | OpenAI、Google Gemini、Kimi API | 自动启动内置协议桥接 |
| Anthropic 兼容接口 | DeepSeek、智谱 GLM、Kimi Code、MiniMax、小米 MiMo | 直接连接 |
| 本地模型 | LM Studio、Ollama | 直接连接本地服务 |

::: tip 不需要额外代理
OpenAI Chat Completions 和 OpenAI Responses 的协议转换已经内置在 CyberCode 中。桥接服务只监听本机 `127.0.0.1`，自动选择空闲端口，并在 TUI 退出时关闭。
:::

进入主界面后可以先发送一句：

```text
介绍一下这个项目，并告诉我你当前使用的模型。
```

右下角会显示当前模型；模型服务未启动、Key 无效或模型 ID 错误时，界面会返回对应错误，不需要检查或启动额外代理进程。

### 之后切换或新增厂商

在 TUI 输入：

```text
/provider
```

可以启用已经保存的厂商，或重新进入“厂商 → 模型 → API Key”配置流程。`/providers` 是同一个命令的别名；`/model` 用于切换当前厂商下的模型。

桌面端与 TUI 共用厂商配置。你也可以在桌面端打开“设置 → 模型厂商”进行高级配置、连接测试和不同角色的模型映射，保存后 TUI 会直接识别。

### 本地模型说明

CyberCode 已内置协议处理，但不会代替本地推理程序本身。使用 LM Studio 或 Ollama 前，仍需先安装对应程序、下载模型并启动本地模型服务：

- LM Studio 默认地址：`http://localhost:1234`
- Ollama 默认地址：`http://localhost:11434`

更完整的自定义 Base URL、API 格式和故障排查说明，请看 [第三方模型](./third-party-models.md)。CI、容器和脚本场景才通常需要 [环境变量配置](./env-vars.md)。

## 常用 CLI 命令

这些选项可以组合使用，例如指定模型后以 JSON 格式执行一次无头任务。

### 会话与模型

| 命令 | 用途 |
|------|------|
| `cybercode` | 在当前项目启动交互式 TUI |
| `cybercode "解释这个仓库"` | 带一条初始任务启动交互会话 |
| `cybercode -c` | 继续当前项目最近一次会话 |
| `cybercode -r` | 打开会话选择器并恢复历史会话 |
| `cybercode -r <session-id>` | 按会话 ID 恢复 |
| `cybercode -n api-refactor` | 为新会话设置便于识别的名称 |
| `cybercode --model <model>` | 为当前会话指定模型或模型别名 |
| `cybercode --permission-mode plan` | 以规划模式启动 |
| `cybercode --add-dir ../shared` | 允许 Agent 访问额外目录 |

### 脚本、CI 与结构化输出

| 命令 | 用途 |
|------|------|
| `cybercode -p "修复失败的测试"` | 输出最终结果后退出 |
| `cybercode -p --output-format json "总结改动"` | 返回单个 JSON 结果 |
| `cybercode -p --output-format stream-json "运行测试"` | 持续输出流式 JSON 事件 |
| `cybercode -p --json-schema '{"type":"object"}' "分析项目"` | 按 JSON Schema 约束结构化结果 |
| `cybercode -p --max-budget-usd 1.00 "检查代码"` | 为单次无头任务设置费用上限 |
| `cybercode -w feature-name` | 创建隔离的 Git worktree 并开始会话 |

### 工具、MCP 与插件

| 命令 | 用途 |
|------|------|
| `cybercode --allowed-tools "Read,Glob,Grep"` | 只允许指定工具 |
| `cybercode --disallowed-tools "Bash"` | 禁止指定工具 |
| `cybercode mcp list` | 查看已配置的 MCP 服务器 |
| `cybercode mcp --help` | 查看 MCP 添加、删除与检查命令 |
| `cybercode plugin list` | 查看已安装插件 |
| `cybercode plugin --help` | 查看插件安装、更新与市场命令 |
| `cybercode agents` | 列出已配置的自定义 Agent |
| `cybercode doctor` | 检查运行环境和更新器状态 |
| `cybercode --version` | 显示当前版本 |
| `cybercode --help` | 显示全部顶层选项和子命令 |

完整参数始终以当前安装版本的 `cybercode --help` 输出为准。

## 桌面端斜杠命令

在桌面端聊天输入框中输入 `/`，即可搜索并执行命令。这里使用的是正斜杠 `/`，不是 Windows 路径中的反斜杠 `\`。

| 类型 | 支持的命令 |
|------|------------|
| 信息与工具面板 | `/help`、`/status`、`/cost`、`/context`、`/mcp`、`/skills`、`/doctor`、`/memory`、`/bug` |
| 设置与账号 | `/plugin`、`/config`、`/permissions`、`/terminal-setup`、`/login`、`/logout`、`/agents` |
| 会话与开发操作 | `/model`、`/compact`、`/clear`、`/review`、`/commit`、`/pr`、`/init` |

`/plugins` 是 `/plugin` 的别名，`/feedback` 是 `/bug` 的别名。当前项目中的 Skills、插件、MCP Prompt 和 Workflow 也会动态加入 `/` 候选列表。

每条命令的作用、终端 TUI 命令、条件启用命令和 shell 等价操作，请查看 [斜杠命令完整参考](./slash-commands.md)。

## 从源码运行

下面的步骤适用于开发者或需要直接修改 CyberCode 源码的用户。

### 1. 安装 Bun

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# macOS (Homebrew)
brew install bun

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

> 精简版 Linux 如提示 `unzip is required`，先运行 `apt update && apt install -y unzip`。

### 2. 安装依赖

```bash
git clone https://github.com/wk42worldworld/cybercode.git
cd cybercode
bun install
```

无需先创建 `.env`。启动后使用同一套模型厂商向导即可；只有 CI 或无头脚本等高级场景才需要环境变量。

### 3. 运行源码

```bash
# macOS / Linux
./bin/cybercode

# Windows PowerShell / cmd
.\bin\cybercode.cmd
```

## 降级模式

如果 Ink TUI 出现问题，可以使用 Recovery CLI：

```bash
# macOS / Linux
CYBERCODE_FORCE_RECOVERY_CLI=1 cybercode
```

```powershell
# Windows PowerShell
$env:CYBERCODE_FORCE_RECOVERY_CLI = "1"
cybercode
```
