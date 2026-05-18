# CyberCode

<p align="center">
  <img src="docs/images/logo-horizontal.png" alt="CyberCode" width="480">
</p>

<div align="center">

[![GitHub Stars](https://img.shields.io/github/stars/wk42worldworld/cybercode?style=social)](https://github.com/wk42worldworld/cybercode/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/wk42worldworld/cybercode?style=social)](https://github.com/wk42worldworld/cybercode/network/members)
[![GitHub Issues](https://img.shields.io/github/issues/wk42worldworld/cybercode)](https://github.com/wk42worldworld/cybercode/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/wk42worldworld/cybercode)](https://github.com/wk42worldworld/cybercode/pulls)
[![English](https://img.shields.io/badge/English-Available-green)](README.md)
[![中文](https://img.shields.io/badge/中文-可用-green)](README.zh-CN.md)
[![日本語](https://img.shields.io/badge/日本語-現在-blue)](README.ja.md)
[![한국어](https://img.shields.io/badge/한국어-Available-green)](README.ko.md)
[![Docs](https://img.shields.io/badge/Documentation-Visit-D97757)](https://github.com/wk42worldworld/cybercode)

</div>

CyberCode は、**Claude Code のプロダクト設計を強く参考にした**ローカル実行可能なクライアントです。MiniMax、OpenRouter など、Anthropic 互換 API エンドポイントに接続できます。フル機能の TUI に加えて、Computer Use（macOS / Windows）、Tauri + React の**デスクトップアプリ**、Telegram / Feishu からの**リモート操作**にも対応しています。

<p align="center">
  <a href="#機能">機能</a> · <a href="#アーキテクチャ概要">アーキテクチャ</a> · <a href="#クイックスタート">クイックスタート</a> · <a href="docs/en/guide/env-vars.md">環境変数</a> · <a href="docs/en/guide/faq.md">FAQ</a> · <a href="docs/en/guide/global-usage.md">グローバル利用</a>
</p>

---

## 機能

- 公式 Claude Code に近い Ink TUI 体験
- スクリプトや CI 向けの `--print` ヘッドレスモード
- MCP サーバー、プラグイン、Skills に対応
- カスタム API エンドポイントとモデルに対応（[Third-Party Models Guide](docs/en/guide/third-party-models.md)）
- **Memory System**：セッションをまたいだ永続メモリ
- **Multi-Agent System**：複数 Agent の編成、並列タスク、Teams 協作
- **Skills System**：拡張可能な能力プラグインとカスタムワークフロー
- **Channel System**：Telegram / Feishu / Discord などの IM から Agent をリモート操作
- **Computer Use**：スクリーンショット、マウス、キーボードによるデスクトップ操作
- **Desktop App**：Tauri 2 + React の GUI クライアント、マルチタブ / マルチセッション
- Recovery CLI モード（`CYBERCODE_FORCE_RECOVERY_CLI=1 ./bin/cybercode`）

---

## アーキテクチャ概要

<table>
  <tr>
    <td align="center" width="25%"><img src="docs/images/01-overall-architecture.png" alt="Overall architecture"><br><b>全体アーキテクチャ</b></td>
    <td align="center" width="25%"><img src="docs/images/02-request-lifecycle.png" alt="Request lifecycle"><br><b>リクエストライフサイクル</b></td>
    <td align="center" width="25%"><img src="docs/images/03-tool-system.png" alt="Tool system"><br><b>ツールシステム</b></td>
    <td align="center" width="25%"><img src="docs/images/04-multi-agent.png" alt="Multi-agent architecture"><br><b>Multi-Agent アーキテクチャ</b></td>
  </tr>
  <tr>
    <td align="center" width="25%"><img src="docs/images/05-terminal-ui.png" alt="Terminal UI"><br><b>ターミナル UI</b></td>
    <td align="center" width="25%"><img src="docs/images/06-permission-security.png" alt="Permissions and security"><br><b>権限とセキュリティ</b></td>
    <td align="center" width="25%"><img src="docs/images/07-services-layer.png" alt="Services layer"><br><b>サービス層</b></td>
    <td align="center" width="25%"><img src="docs/images/08-state-data-flow.png" alt="State and data flow"><br><b>状態とデータフロー</b></td>
  </tr>
</table>

---

## デスクトップ版のダウンロード

<p align="center">
  <a href="https://github.com/wk42worldworld/cybercode/releases"><img src="https://img.shields.io/badge/Download_Desktop-macOS_%7C_Linux_%7C_Windows-D97757?style=for-the-badge" alt="Download Desktop"></a>
  &nbsp;
  <a href="docs/desktop/04-installation.md"><img src="https://img.shields.io/badge/Install_Guide-Guide-gray?style=for-the-badge" alt="Install Guide"></a>
</p>

---

## クイックスタート

### 1. Bun をインストール

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# macOS (Homebrew)
brew install bun

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

> 最小構成の Linux で `unzip is required` と表示された場合は、先に `apt update && apt install -y unzip` を実行してください。

### 2. 依存関係をインストールして設定

```bash
bun install
cp .env.example .env
# .env に API Key を設定してください。詳細は docs/en/guide/env-vars.md を参照してください。
```

### 3. 起動

#### macOS / Linux

```bash
./bin/cybercode                          # インタラクティブ TUI
./bin/cybercode -p "your prompt here"    # ヘッドレスモード
./bin/cybercode --help                   # オプション一覧
```

#### Windows

> **前提条件**：[Git for Windows](https://git-scm.com/download/win) が必要です。

```powershell
# PowerShell / cmd から Bun を直接実行
bun --env-file=.env ./src/entrypoints/cli.tsx

# または Git Bash で実行
./bin/cybercode
```

### 4. グローバル利用（任意）

`bin/` を PATH に追加すると、任意のディレクトリから起動できます。

```bash
export PATH="$HOME/path/to/cybercode/bin:$PATH"
```

---

## 技術スタック

| カテゴリ | 技術 |
|------|------|
| ランタイム | [Bun](https://bun.sh) |
| 言語 | TypeScript |
| ターミナル UI | React + [Ink](https://github.com/vadimdemedes/ink) |
| CLI パーサー | Commander.js |
| API | Anthropic SDK |
| プロトコル | MCP, LSP |

---

## 関連ドキュメント

| ドキュメント | 説明 |
|------|------|
| [Environment Variables](docs/en/guide/env-vars.md) | 環境変数と設定方法 |
| [Third-Party Models](docs/en/guide/third-party-models.md) | OpenAI / DeepSeek / Ollama などの非 Anthropic モデル接続 |
| [Memory System](docs/memory/01-usage-guide.md) | セッションをまたいだ永続メモリ |
| [Multi-Agent System](docs/agent/01-usage-guide.md) | Agent 編成、並列タスク、Teams 協作 |
| [Skills System](docs/skills/01-usage-guide.md) | 拡張可能な能力プラグインとワークフロー |
| [Channel System](docs/en/channel/01-channel-system.md) | IM プラットフォームからのリモート操作 |
| [Computer Use](docs/en/features/computer-use.md) | デスクトップ操作機能 |
| [Desktop App](docs/desktop/) | Tauri 2 + React GUI クライアント |

---

## 謝辞

本プロジェクトは、React、Tauri、cc-switch などのオープンソースプロジェクトとコミュニティ実践から多くの参考を得ています。

---

## Disclaimer

本プロジェクトは [Anthropic](https://www.anthropic.com) の Claude Code のプロダクト設計、インタラクション、機能アーキテクチャを強く参考にした独立実装です。Claude / Claude Code は Anthropic の商標であり、関連 API とプロトコルは Anthropic に帰属します。本プロジェクトは技術学習と研究目的で提供されており、Anthropic との商業的な関係はありません。
