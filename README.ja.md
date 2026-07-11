# CyberCode

<p align="center">
  <img src="docs/images/cybercode-app-icon.png" alt="CyberCode app icon" width="112"><br>
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

<p align="center">
  <strong>她不是工具，她是伙伴。</strong><br>
  <strong>She is not a tool. She is a partner.</strong><br>
  <strong>彼女はツールではなく、パートナーです。</strong><br>
  <strong>그녀는 도구가 아니라, 파트너입니다.</strong>
</p>

CyberCode は、**Claude Code 風の基盤に永続メモリと自己進化機能を加えた**ローカル実行可能な Agent です。MiniMax、OpenRouter など、Anthropic 互換 API エンドポイントに接続できます。フル機能の TUI に加えて、Computer Use（macOS / Windows）、Tauri + React の**デスクトップアプリ**、Telegram / Feishu からの**リモート操作**にも対応しています。

<p align="center">
  <strong>永続メモリと自己進化機能を備えた、オープンソースの Claude Code 風デスクトップ Agent。</strong><br>
  自分のモデルを接続し、CLI、デスクトップ、IM リモート操作、定期タスク、Computer Use を 1 つのプロジェクトで扱えます。
</p>

<p align="center">
  <a href="#cli-をインストール">CLI をインストール</a> · <a href="#なぜ-cybercode">なぜ</a> · <a href="#クイック比較">比較</a> · <a href="#機能">機能</a> · <a href="#クイックスタート">クイックスタート</a> · <a href="#ステップ別チュートリアル">チュートリアル</a> · <a href="#機能モジュール別チュートリアル">モジュール別</a> · <a href="docs/en/guide/env-vars.md">環境変数</a> · <a href="#コミュニティと成長">コミュニティ</a>
</p>

---

## CLI をインストール

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/wk42worldworld/cybercode/main/scripts/install-cli.sh | bash
```

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/wk42worldworld/cybercode/main/scripts/install-cli.ps1 | iex
```

インストール後、任意のプロジェクトディレクトリで Agent を起動します。

```bash
cybercode
```

インストーラーは最新の安定版を取得し、必要に応じて Bun をインストールして、`cybercode` をユーザー PATH に追加します。管理者権限は不要で、更新時には既存の CLI `.env` が保持されます。実行前に [macOS/Linux](scripts/install-cli.sh) または [Windows](scripts/install-cli.ps1) のスクリプトを確認できます。

### よく使う CLI コマンド

| コマンド | 用途 |
|------|------|
| `cybercode` | 現在のプロジェクトで対話型 Agent を起動 |
| `cybercode "このリポジトリを説明して"` | 最初のタスクを指定して起動 |
| `cybercode -p "失敗しているテストを修正して"` | 結果を出力して終了。スクリプトや CI に最適 |
| `cybercode -c` | 現在のプロジェクトで直近の会話を継続 |
| `cybercode -r` | 保存済みの会話を選択して再開 |
| `cybercode --model <model>` | このセッションで使うモデルを指定 |
| `cybercode --permission-mode plan` | プランモードで起動 |
| `cybercode -p --output-format json "..."` | プログラムで扱いやすい JSON を返す |
| `cybercode -w feature-name` | セッション用に独立した Git worktree を作成 |
| `cybercode mcp --help` | MCP サーバーを設定・管理 |
| `cybercode plugin --help` | プラグインをインストール・管理 |
| `cybercode doctor` / `cybercode --help` | 実行環境を診断、または全オプションを表示 |

その他の例やオプションの組み合わせは [CLI クイックスタート](docs/ja/guide/quick-start.md)を参照してください。

GUI は [macOS、Windows、Linux 向けデスクトップアプリ](https://github.com/wk42worldworld/cybercode/releases/latest)からダウンロードできます。

---

## なぜ CyberCode

| やりたいこと | CyberCode が提供するもの |
|------|------|
| Claude Code 風 Agent を使いたいが、1 つのプロバイダーに縛られたくない | Anthropic 互換エンドポイント、プロキシ経由の OpenAI 互換プロバイダー、モデル別コンテキスト設定 |
| ターミナルだけでなくデスクトップ UI も使いたい | Tauri + React GUI、複数セッションタブ、プロジェクト切替、添付、権限ダイアログ、モデル設定 |
| ローカル Agent に離席中も作業させたい | Telegram / Feishu リモート操作、定期タスク、バックグラウンド Agent、永続メモリ |
| 高度な Agent 機能を試せる OSS が欲しい | Multi-Agent、Skills、MCP、Computer Use、カスタムプロバイダー、CLI ヘッドレスモード |

## クイック比較

| ニーズ | CyberCode | Claude Code | Cursor / Cline / Roo 系 |
|------|------|------|------|
| 自分のプロバイダーを使う | カスタムプロバイダーと Anthropic 互換 API を中心に設計 | 主に公式 Anthropic 経路 | ツールによる |
| デスクトップ GUI | クロスプラットフォームのデスクトップアプリ内蔵 | ターミナル中心 | 多くはエディタ中心 |
| CLI / ヘッドレス | 対応 | 対応 | 主経路ではないことが多い |
| IM リモート操作 | Telegram / Feishu adapters | 標準ワークフローではない | 外部構成が必要なことが多い |
| 定期実行タスク | デスクトップワークフローに統合 | 標準ワークフローではない | ツールによる |
| Computer Use | macOS / Windows 対応 | 公式機能経路 | ツールによる |
| OSS として改造 | デスクトップ、サーバー、adapter、docs まで公開 | クローズド製品 | ツールによる |

## コミュニティと成長

- 新しい貢献者は [CONTRIBUTING.md](CONTRIBUTING.md) と [Roadmap](ROADMAP.md) から始められます。
- CyberCode を紹介したい場合は [Launch Kit](docs/marketing/launch-kit.md) の投稿文を使えます。
- 最初に取り組みやすい領域: docs、プロバイダープリセット、翻訳、再現可能な bug report、デスクトップ UX、各 OS のインストールメモ。

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

## 機能モジュール別チュートリアル

この章は機能ごとの実用マニュアルです。CyberCode を起動できる状態になった後、必要なモジュールから順番に確認してください。

### モジュール 1: デスクトップアプリのインストールと更新

ソースから起動するのではなく、通常の GUI アプリとして使いたい場合の手順です。

1. [GitHub Releases](https://github.com/wk42worldworld/cybercode/releases) を開きます。
2. 利用環境に合うパッケージをダウンロードします。
   - macOS Apple Silicon: `macos_arm64_dmg.dmg`
   - macOS Intel: `macos_x64_dmg.dmg`
   - Windows x64: `windows_x64_nsis.exe`
   - Linux x64: `linux_x64_deb.deb`
3. OS 標準の方法でインストールします。
4. CyberCode を起動し、新しいセッションを作成します。
5. 最初のコーディング依頼を送る前に、実在するプロジェクトフォルダを選択します。

確認結果: アプリが開き、サイドバーにセッションが表示され、ステータスバーにプロジェクトとモデルが表示されます。

注意:

- macOS パッケージは notarization 済みです。それでもブロックされる場合は [Installation](docs/desktop/04-installation.md) を参照してください。
- Release にはデスクトップ更新用の `latest.json` も含まれます。

### モジュール 2: モデルプロバイダー、モデル割り当て、コンテキストウィンドウ

MiniMax、OpenRouter、プロキシ経由の OpenAI、Ollama、その他互換プロバイダーを使う場合の手順です。

1. デスクトップアプリを開きます。
2. Settings -> Providers に移動します。
3. プリセットを選ぶか、カスタムプロバイダーを追加します。
4. 以下を入力します。
   - プロバイダー名
   - API Key
   - Base URL
   - API 形式: `Anthropic`、`OpenAI Chat`、`OpenAI Responses`
   - モデル割り当て: `main`、`haiku`、`sonnet`、`opus`
5. モデルの最大コンテキストが分かる場合は、`200k` や `1m` のように入力します。
6. Test Connection を実行します。
7. そのプロバイダーを有効化します。
8. ステータスバーのモデル名をクリックし、現在のセッションで使うモデルを選びます。

確認結果: 短いメッセージを送り、`/context` またはコンテキストパネルで、モデルとコンテキスト上限が想定通りか確認できます。

注意:

- Anthropic 互換エンドポイントは、その URL を直接設定できます。
- OpenAI 形式のみの API は LiteLLM などのプロキシが必要です。詳しくは [Third-Party Models](docs/en/guide/third-party-models.md) を参照してください。
- モデル名に `200k` や `1m` が含まれる場合は推定できますが、明示設定の方が分かりやすく安全です。

### モジュール 3: CLI とヘッドレスモード

ターミナル作業、自動化、CI で使う場合の手順です。

1. 依存関係をインストールします。

```bash
bun install
```

2. 環境変数ファイルを作成します。

```bash
cp .env.example .env
```

3. `.env` にプロバイダー設定を入力します。
4. インタラクティブ TUI を起動します。

```bash
./bin/cybercode
```

5. 1 回だけ実行するプロンプトを送ります。

```bash
./bin/cybercode -p "このリポジトリ構成を説明してください"
```

6. 利用可能なオプションを確認します。

```bash
./bin/cybercode --help
```

確認結果: インタラクティブモードが開き、`-p` は TUI を開かずに回答を出力します。

注意:

- Windows では Git Bash の利用を推奨します。ない場合は PowerShell にフォールバックします。
- 任意のディレクトリから `cybercode` を使いたい場合は、`bin/` を PATH に追加します。

### モジュール 4: デスクトップのセッション、プロジェクト、タブ

複数プロジェクトや複数タスクを整理するための手順です。

1. サイドバーの `+` をクリックするか、`Cmd/Ctrl + N` を押します。
2. 作業するプロジェクトディレクトリを選択します。
3. まず `このプロジェクト構成を説明してください` のような小さな調査を依頼します。
4. サイドバーのプロジェクトフィルターで、特定プロジェクトのセッションだけを表示します。
5. サイドバー検索で過去セッションをタイトル検索します。
6. セッションを右クリックして、名前変更または削除を行います。
7. 別タスクを並行して進める場合は複数タブを開きます。
8. タブの右クリックメニューで、現在、他、左、右、すべてのタブを閉じられます。

確認結果: 各セッションが正しいプロジェクトパスに紐づき、ステータスバーに現在のプロジェクトとモデルが表示されます。

注意:

- 実行中のタブを閉じると、続行、停止して閉じる、キャンセルを選ぶ確認が出ます。
- セッションのフォルダが削除済みの場合は、実在するフォルダを選び直してください。

### モジュール 5: 入力欄、添付、スラッシュコマンド、ファイル参照、保留入力

複雑なメッセージを送る場合や、アシスタント応答中に次の入力を準備する場合の手順です。

1. 下部の入力欄に内容を書きます。
2. `Enter` で送信、`Shift + Enter` で改行します。
3. 貼り付け、ドラッグ、`+` ファイル選択で添付を追加します。
4. `/` を入力し、`/status`、`/context`、`/memory`、`/mcp`、`/skills` などを開きます。
5. `@` を入力してプロジェクトファイルを検索、参照します。
6. アシスタントが応答中に別メッセージを送ると、保留入力行として保存されます。
7. 保留入力は送信前に編集または削除できます。
8. 現在の応答が終わると、保留入力は次のユーザーメッセージとして自動送信されます。
9. 生成を止めたい場合は Stop をクリックするか、`Cmd/Ctrl + .` を押します。

確認結果: 添付は入力欄上部に表示され、スラッシュコマンドは対応パネルまたはコマンドを開き、`@` はファイル参照になり、応答中の入力は失われません。

注意:

- モデルへ直接送れないファイル形式は、ファイルパスとして渡されます。
- 保留入力行は実際のキュー内容だけを表示し、不要な説明文は表示しません。

### モジュール 6: 権限管理とツール安全性

CyberCode が Shell コマンドやファイル編集を行う前に理解しておくべき手順です。

1. 慣れていないリポジトリでは、デフォルトの確認モードを使います。
2. 権限カードが出たら、内容を確認します。
3. その操作だけ許可する場合は Allow を選びます。
4. 現在のセッションで同種の操作を信頼できる場合だけ Always Allow を選びます。
5. コマンド、ファイルパス、diff に違和感がある場合は Deny を選びます。
6. 実行せず計画だけ見たい場合は Plan mode を使います。
7. bypass permissions は使い捨て環境または完全に信頼できる環境だけで使います。

確認結果: ファイル編集や Shell コマンドは、権限ポリシーが許可した後だけ実行されます。

注意:

- 権限カードにはツール種別、コマンドまたはファイルプレビュー、詳細パラメータが表示されます。
- IM アダプターでも、権限要求は承認ボタンとして表示されます。

### モジュール 7: メモリシステム

ユーザーの好み、プロジェクトルール、外部参照をセッション間で覚えさせたい場合の手順です。

1. 通常通り会話します。CyberCode は有用な情報を自動抽出できます。
2. 明示的に保存したい場合は `remember this: ...` と伝えます。
3. `/memory` で編集可能なメモリファイルを開きます。
4. `/remember` で自動メモリの確認、昇格、統合、整理を行います。
5. 古くなったメモリは忘れるよう依頼します。
6. クリーンな回答が欲しい場合は `ignore memory for this turn` と伝えます。

確認結果: メモリ更新通知が表示され、後続セッションで保存済みの好みや文脈が使われます。

保存に向いている例:

- テストは mock ではなく実 DB を使う。
- 特定の日付からリリースフリーズに入る。
- ダッシュボード、チケット、on-call 情報が外部システムにある。

注意:

- メモリにはコードから推測できない情報を保存します。
- 自動メモリは `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` で無効化できます。

### モジュール 8: Multi-Agent ワークフローと Agent Teams

大きなタスクを並列調査、計画、検証したい場合の手順です。

1. `フロントエンド、バックエンド、テストを並列に調べてから計画してください` のように依頼します。
2. 読み取り専用の調査には Explore agent を使います。
3. 設計や実装計画には Plan agent を使います。
4. 変更後の独立確認には verification agent を使います。
5. 長時間かかる作業は background agent を依頼します。
6. 実験的な実装は worktree isolation を依頼し、メイン作業ツリーを守ります。
7. 協調作業では、役割を分けた Agent Team を作成するよう依頼します。

確認結果: agent の起動、バックグラウンド完了、検証結果、チーム要約が報告されます。

注意:

- 各 agent の依頼内容は絞ってください。
- 大きい変更や危険な変更では、verification agent を使ってから判断してください。

### モジュール 9: Skills、Plugins、MCP

繰り返し行う作業を再利用可能な能力にしたい場合の手順です。

1. `/` を入力して利用可能なコマンドを確認します。
2. まず `/verify`、`/debug`、`/simplify`、`/remember`、`/batch` などの内蔵 Skills を試します。
3. デスクトップアプリでは `/skills` で現在の文脈で呼べる Skills を確認します。
4. プロジェクト Skill は `.claude/skills/<skill-name>/SKILL.md` に作成します。
5. frontmatter に `description`、`when_to_use`、`allowed-tools`、`model`、`paths` などを設定します。
6. frontmatter の下に Markdown で手順を書きます。
7. `/skill-name` で呼び出すか、`when_to_use` に合う自然言語タスクを依頼します。
8. 外部ツールや外部 prompt が必要な場合は MCP server を接続します。

確認結果: Skill がスラッシュコマンドに表示されるか、該当タスクでモデルに呼び出されます。

注意:

- 強力な Skill には `allowed-tools` で範囲を制限します。
- プロジェクト Skills はリポジトリに置けるため、チーム共有に向いています。

### モジュール 10: Telegram / Feishu による IM リモート操作

スマートフォンやチームチャットから CyberCode を操作したい場合の手順です。

1. デスクトップアプリの Settings を開きます。
2. IM または Adapters 設定へ移動します。
3. `serverUrl` を設定し、新規チャットの既定プロジェクトが必要なら default project directory も設定します。
4. プラットフォーム認証情報を入力します。
   - Telegram: Bot Token
   - Feishu: App ID と App Secret
5. 必要に応じて allowed users を設定します。
6. 6 文字のペアリングコードを生成します。
7. adapter プロセスを起動します。

```bash
cd adapters
bun install
bun run telegram
# または
bun run feishu
```

8. IM の private chat で Bot にペアリングコードを送ります。
9. ペアリング後、通常のコーディング依頼を送ります。
10. 必要に応じて `/new`、`/projects`、`/stop` を使います。

確認結果: Bot が CyberCode セッションにつながり、返信をストリーミングし、権限要求をボタンで表示します。

注意:

- ペアリングコードは 1 回限りで、60 分後に期限切れになります。
- 既定プロジェクトがない場合、Bot が最近のプロジェクトから選択を求めます。

### モジュール 11: 定期実行タスク

決まったスケジュールで CyberCode に prompt を実行させたい場合の手順です。

1. デスクトップアプリを開きます。
2. サイドバーの時計アイコンをクリックします。
3. New Task をクリックします。
4. タスク名と prompt を入力します。
5. cron 式または曜日/時刻の UI でスケジュールを設定します。
6. 実行時のモデルと権限モードを選びます。
7. タスクを保存します。
8. enable switch で有効化または停止します。
9. Run Now で手動テストします。
10. run history を展開して過去結果を確認します。

確認結果: タスク一覧に読みやすいスケジュールが表示され、手動実行で履歴が作成されます。

注意:

- 定期タスクはデスクトップアプリとローカルサービスが利用可能な間に実行されます。
- 無人実行では保守的な権限モードを推奨します。

### モジュール 12: Computer Use

スクリーンショット、マウス、キーボードでデスクトップアプリを操作させたい場合の手順です。

1. Bun の依存関係がインストール済みであることを確認します。
2. Python 3.8 以上を確認します。

```bash
python3 --version
```

3. macOS では、ターミナルまたはデスクトップアプリのホストに Accessibility と Screen Recording 権限を付与します。
4. CyberCode を起動します。
5. `スクリーンショットを撮って、何が開いているか教えてください` のような観察しやすい依頼をします。
6. CyberCode がアプリ操作権限を求めたら承認します。
7. モデルがスクリーンショット、分析、クリック、入力、確認を順番に行います。

確認結果: CyberCode がスクリーンショットを取得し、アプリ権限を要求し、承認済みアプリだけを操作できます。

注意:

- macOS Apple Silicon、macOS Intel、Windows x64 をサポートします。
- `CLAUDE_COMPUTER_USE_ENABLED=0` で無効化できます。
- 最初は単純で観察しやすいタスクから試してください。

### モジュール 13: 診断、コンテキスト、使用量確認

セッション状態がおかしい場合や、現在のコンテキストと使用量を見たい場合の手順です。

1. `/status` で現在のセッション状態を確認します。
2. `/context` でコンテキスト使用量、空き token、メッセージやツール結果の内訳を確認します。
3. `/cost` で利用可能な使用量やコスト情報を確認します。
4. `/doctor` でローカル環境の健康状態を確認します。
5. ローカルデスクトップサーバーの確認には `curl http://127.0.0.1:3456/health` を使います。
6. プロバイダーが失敗する場合は Settings -> Providers で接続テストを実行します。
7. デスクトップがセッションへ接続できない場合は、プロジェクトディレクトリがまだ存在するか確認します。

確認結果: 問題がプロバイダー設定、コンテキスト圧迫、ローカルサーバー、プロジェクトパスのどこにあるか切り分けられます。

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
| [Roadmap](ROADMAP.md) | 近い優先事項と beginner-friendly な貢献案 |
| [Contributing](CONTRIBUTING.md) | docs、provider、test、desktop 修正への貢献方法 |
| [Launch Kit](docs/marketing/launch-kit.md) | CyberCode を紹介するための投稿文 |

---

## 謝辞

本プロジェクトは、React、Tauri、cc-switch などのオープンソースプロジェクトとコミュニティ実践から多くの参考を得ています。

---

## Disclaimer

本プロジェクトは [Anthropic](https://www.anthropic.com) の Claude Code のプロダクト設計、インタラクション、機能アーキテクチャを強く参考にした独立実装です。Claude / Claude Code は Anthropic の商標であり、関連 API とプロトコルは Anthropic に帰属します。本プロジェクトは技術学習と研究目的で提供されており、Anthropic との商業的な関係はありません。
