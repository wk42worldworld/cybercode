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

常用命令：

```bash
cybercode                          # 交互 TUI 模式
cybercode -p "your prompt here"    # 无头模式
cybercode --help                   # 查看所有选项
```

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
