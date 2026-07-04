# CyberCode

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/cybercode-wordmark-dark.png">
    <img src="docs/images/cybercode-wordmark.png" alt="CyberCode" width="520">
  </picture>
</p>

<p align="center">
  <strong>言語:</strong>
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <strong>日本語</strong> ·
  <a href="README.ko.md">한국어</a>
</p>

<div align="center">

[![GitHub Stars](https://img.shields.io/github/stars/wk42worldworld/cybercode?style=social)](https://github.com/wk42worldworld/cybercode/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/wk42worldworld/cybercode?style=social)](https://github.com/wk42worldworld/cybercode/network/members)
[![GitHub Issues](https://img.shields.io/github/issues/wk42worldworld/cybercode)](https://github.com/wk42worldworld/cybercode/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/wk42worldworld/cybercode)](https://github.com/wk42worldworld/cybercode/pulls)
[![Docs](https://img.shields.io/badge/Documentation-Visit-D97757)](https://github.com/wk42worldworld/cybercode)

</div>

CyberCode は、**Claude Code のプロダクト設計を強く参考にした**ローカル実行可能なクライアントです。MiniMax、OpenRouter など、Anthropic 互換 API エンドポイントに接続できます。フル機能の TUI に加えて、Computer Use（macOS / Windows）、Tauri + React の**デスクトップアプリ**、Telegram / Feishu からの**リモート操作**にも対応しています。

<p align="center">
  <a href="#機能">機能</a> · <a href="#アーキテクチャ概要">アーキテクチャ</a> · <a href="#クイックスタート">クイックスタート</a> · <a href="#ステップ別チュートリアル">チュートリアル</a> · <a href="docs/en/guide/env-vars.md">環境変数</a> · <a href="docs/en/guide/faq.md">FAQ</a> · <a href="docs/en/guide/global-usage.md">グローバル利用</a>
</p>

---

## 機能

- 公式 Claude Code に近い Ink TUI 体験
- スクリプトや CI 向けの `--print` ヘッドレスモード
- MCP サーバー、プラグイン、Skills に対応
- カスタム API エンドポイントとモデルに対応（[Third-Party Models Guide](docs/en/guide/third-party-models.md)）
- 応答実行中の追加入力を保留バーに保存し、編集・削除・現在のタスクへの追加が可能
- プロバイダー / モデルごとのコンテキストウィンドウ情報に対応
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

> [Git for Windows](https://git-scm.com/download/win) の利用を推奨します。Git Bash がない場合、CyberCode は自動的に PowerShell にフォールバックします。

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

## ステップ別チュートリアル

初めて CyberCode を使う場合は、この章を上から順に進めてください。各章の最後に「完了結果」を置いているので、次へ進める状態か確認できます。

### 第 1 章: 実行方法を選ぶ

CyberCode には主に 3 つの使い方があります。

| 方法 | 向いている用途 | やること |
|------|------|------|
| デスクトップアプリ | 日常的な開発、複数セッション、GUI でのプロジェクト切り替え | [GitHub Releases](https://github.com/wk42worldworld/cybercode/releases) から最新パッケージをダウンロード |
| ソースから CLI 実行 | ターミナル中心の作業、ローカル開発、スクリプト実行 | リポジトリを clone し、Bun を入れて `bun install` を実行 |
| デスクトップ開発モード | React/Tauri フロントエンドの検証 | API サーバーと Vite フロントエンドを両方起動 |

完了結果: デスクトップアプリを使うのか、CLI を使うのか、開発モードで動かすのかを決められています。

### 第 2 章: モデルプロバイダーを準備する

CyberCode は Anthropic 互換 API と通信します。MiniMax や OpenRouter は互換エンドポイントがあれば直接利用できます。OpenAI 形式のみのプロバイダーは、通常 LiteLLM などのプロキシが必要です。

1. モデルプロバイダーの管理画面で API Key を作成またはコピーします。
2. サンプル環境変数ファイルをコピーします。

```bash
cp .env.example .env
```

3. `.env` を編集し、最低限以下を設定します。

```env
ANTHROPIC_AUTH_TOKEN=your_api_key_here
ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
ANTHROPIC_MODEL=MiniMax-M2.7
```

プロバイダーが `x-api-key` ヘッダーを要求する場合は、`ANTHROPIC_AUTH_TOKEN` の代わりに `ANTHROPIC_API_KEY` も使えます。詳しい例は [Environment Variables](docs/en/guide/env-vars.md) と [Third-Party Models](docs/en/guide/third-party-models.md) を参照してください。

完了結果: `.env` に有効なキー、エンドポイント、モデル名が入っています。

### 第 3 章: 最初の CLI タスクを実行する

まずインタラクティブ TUI を起動します。

```bash
./bin/cybercode
```

最初は小さな依頼から試します。

```text
このプロジェクトを読み、主要なエントリーポイントを要約してください。
```

スクリプトや CI ではヘッドレスモードを使えます。

```bash
./bin/cybercode -p "package.json を要約し、利用できる scripts を列挙してください"
```

完了結果: CyberCode がモデルプロバイダーへ接続し、ターミナルに回答をストリーミング表示します。

### 第 4 章: 実際のプロジェクトを開く

CyberCode は、変更したいプロジェクトディレクトリを見られる状態で最も力を発揮します。

1. プロジェクトルートで CyberCode を起動するか、デスクトップアプリでプロジェクトフォルダを選択します。
2. まず小さな調査を依頼します: `src/ ディレクトリ構成を説明してください`。
3. コマンド実行やファイル編集の許可を求められたら、内容を確認して信頼できる操作だけ承認します。
4. 最初の回答が成功したら、`このファイルの失敗しているテストを修正してください` のように対象を絞った依頼をします。

完了結果: アシスタントが正しいディレクトリで作業し、どのファイルやコマンドを使うか確認できます。

### 第 5 章: デスクトップアプリを快適に使う

インストール済みアプリでは CyberCode を開き、プロジェクト用のセッションを作成します。ローカル開発では、まず以下を実行します。

```bash
SERVER_PORT=3456 bun run src/server/index.ts
```

別のターミナルで以下を実行します。

```bash
cd desktop
bun run dev --host 127.0.0.1 --port 2024
```

`http://127.0.0.1:2024` を開き、セッションを作成または選択して、実在する作業ディレクトリを選びます。

便利な使い方:

- アシスタントが応答中に新しいメッセージを入力すると、保留入力行として保存されます。
- 保留入力は送信前に編集または削除できます。
- 現在の応答が終わると、キューにある保留入力は次のユーザーメッセージとして自動送信されます。
- モデルへ直接送れないファイル形式は、デスクトップアプリがファイルパスとして渡すため、Agent が扱えます。

完了結果: アシスタントが処理中でも入力を失わず、通常の複数ターンの開発作業を続けられます。

### 第 6 章: CLI をどこからでも使えるようにする

リポジトリの `bin/` ディレクトリを PATH に追加します。

```bash
export PATH="$HOME/path/to/cybercode/bin:$PATH"
```

別のプロジェクトで確認します。

```bash
cybercode --help
cybercode -p "このディレクトリにはどんなファイルがありますか？"
```

永続化する場合は、この `export PATH=...` 行を `~/.zshrc` や `~/.bashrc` に追加します。

完了結果: 任意のプロジェクトディレクトリから `cybercode` を実行できます。

### 第 7 章: 初回によくある問題を直す

| 問題 | 確認すること |
|------|------|
| `command not found: cybercode` | リポジトリ内では `./bin/cybercode` を使うか、`bin/` を PATH に追加 |
| API Key または 401 エラー | `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL`、モデル名を再確認 |
| Windows のシェルコマンドが失敗する | [Git for Windows](https://git-scm.com/download/win) を入れるか、PowerShell フォールバックを使う |
| デスクトップが接続できない | サーバーが `127.0.0.1:3456` で動いているか確認 |
| ポート `3456` が使用中 | `lsof -nP -iTCP:3456 -sTCP:LISTEN` で PID を確認し、`kill <PID>` |
| `Working directory does not exist` | セッションで実在するプロジェクトフォルダを選び直す |
| 長いプロンプトが失敗する | 十分なコンテキストウィンドウを持つモデルを選ぶか、モデル設定メタデータを更新 |

完了結果: 問題がシェル設定、API 設定、サーバー起動、プロジェクトパスのどこにあるか切り分けられます。

### 第 8 章: 次に読む機能

| 目的 | 次に読む |
|------|------|
| OpenAI、DeepSeek、Ollama などを使う | [Third-Party Models](docs/en/guide/third-party-models.md) |
| 環境変数を詳しく設定する | [Environment Variables](docs/en/guide/env-vars.md) |
| どのディレクトリからも CyberCode を起動する | [Global Usage](docs/en/guide/global-usage.md) |
| 永続メモリを使う | [Memory System](docs/memory/01-usage-guide.md) |
| 複数 Agent を使う | [Multi-Agent System](docs/agent/01-usage-guide.md) |
| Telegram / Feishu と接続する | [Channel System](docs/en/channel/01-channel-system.md) |
| デスクトップアプリを操作させる | [Computer Use](docs/en/features/computer-use.md) |

完了結果: 最初の動作確認から、自分が必要とする機能へ進めます。

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
