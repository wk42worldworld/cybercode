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

首次启动会进入配置流程。环境变量和第三方模型的完整说明请参考 [环境变量配置](./env-vars.md) 与 [第三方模型](./third-party-models.md)。

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

### 2. 安装依赖并配置

```bash
git clone https://github.com/wk42worldworld/cybercode.git
cd cybercode
bun install
cp .env.example .env
# 编辑 .env 填入你的 API Key
```

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
