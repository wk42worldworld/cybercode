# クイックスタート

## CLI をインストール（推奨）

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/wk42worldworld/cybercode/main/scripts/install-cli.sh | bash
```

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/wk42worldworld/cybercode/main/scripts/install-cli.ps1 | iex
```

インストーラーは GitHub の最新安定版を取得し、必要に応じて Bun をインストールして、`cybercode` をユーザー PATH に追加します。管理者権限は不要です。同じコマンドをもう一度実行すると更新でき、既存の CLI `.env` は保持されます。

インストールスクリプトは公開されています：[macOS/Linux](https://github.com/wk42worldworld/cybercode/blob/main/scripts/install-cli.sh) · [Windows](https://github.com/wk42worldworld/cybercode/blob/main/scripts/install-cli.ps1)

## Agent を起動

新しいターミナルを開き、プロジェクトディレクトリへ移動して実行します。

```bash
cd /path/to/your-project
cybercode
```

初回起動時に設定フローが開きます。プロバイダー設定の詳細は [環境変数](../../en/guide/env-vars.md) と [サードパーティーモデル](../../en/guide/third-party-models.md)を参照してください。

## よく使う CLI コマンド

オプションは組み合わせて使えます。たとえば、モデルを指定し、JSON 出力で 1 回のヘッドレスタスクを実行できます。

### セッションとモデル

| コマンド | 用途 |
|------|------|
| `cybercode` | 現在のプロジェクトで対話型 TUI を起動 |
| `cybercode "このリポジトリを説明して"` | 最初のタスクを指定して対話セッションを開始 |
| `cybercode -c` | 現在のプロジェクトで直近の会話を継続 |
| `cybercode -r` | セッション選択画面から保存済みの会話を再開 |
| `cybercode -r <session-id>` | セッション ID を指定して再開 |
| `cybercode -n api-refactor` | 新しいセッションに識別しやすい名前を設定 |
| `cybercode --model <model>` | このセッションで使うモデルまたは別名を指定 |
| `cybercode --permission-mode plan` | プランモードで起動 |
| `cybercode --add-dir ../shared` | Agent が追加ディレクトリへアクセスできるようにする |

### スクリプト、CI、構造化出力

| コマンド | 用途 |
|------|------|
| `cybercode -p "失敗しているテストを修正して"` | 最終結果を出力して終了 |
| `cybercode -p --output-format json "変更を要約して"` | 1 つの JSON 結果を返す |
| `cybercode -p --output-format stream-json "テストを実行して"` | JSON イベントをストリーム出力 |
| `cybercode -p --json-schema '{"type":"object"}' "プロジェクトを分析して"` | JSON Schema で構造化出力を制約 |
| `cybercode -p --max-budget-usd 1.00 "コードをレビューして"` | 1 回のヘッドレスタスクに費用上限を設定 |
| `cybercode -w feature-name` | 独立した Git worktree を作成してセッションを開始 |

### ツール、MCP、プラグイン

| コマンド | 用途 |
|------|------|
| `cybercode --allowed-tools "Read,Glob,Grep"` | 指定したツールだけを許可 |
| `cybercode --disallowed-tools "Bash"` | 指定したツールを禁止 |
| `cybercode mcp list` | 設定済み MCP サーバーの一覧を表示 |
| `cybercode mcp --help` | MCP の追加、削除、確認コマンドを表示 |
| `cybercode plugin list` | インストール済みプラグインの一覧を表示 |
| `cybercode plugin --help` | プラグインのインストール、更新、マーケットプレイス操作を表示 |
| `cybercode agents` | 設定済みカスタム Agent の一覧を表示 |
| `cybercode doctor` | 実行環境とアップデーターの状態を確認 |
| `cybercode --version` | インストール済みバージョンを表示 |
| `cybercode --help` | すべてのトップレベルオプションとサブコマンドを表示 |

完全なオプション一覧は、インストール済みバージョンの `cybercode --help` を参照してください。

## デスクトップのスラッシュコマンド

デスクトップのチャット入力欄で `/` を入力すると、コマンドを検索して実行できます。ここで使うのはスラッシュ `/` で、Windows パスのバックスラッシュ `\` ではありません。

| カテゴリ | 対応コマンド |
|----------|--------------|
| 情報・ツールパネル | `/help`、`/status`、`/cost`、`/context`、`/mcp`、`/skills`、`/doctor`、`/memory`、`/bug` |
| 設定・アカウント | `/plugin`、`/config`、`/permissions`、`/terminal-setup`、`/login`、`/logout`、`/agents` |
| セッション・開発操作 | `/model`、`/compact`、`/clear`、`/review`、`/commit`、`/pr`、`/init` |

`/plugins` は `/plugin`、`/feedback` は `/bug` の別名です。現在のプロジェクトにある Skills、プラグイン、MCP Prompt、Workflow も `/` の候補へ動的に追加されます。

各コマンドの動作、ターミナル TUI コマンド、条件付きコマンド、shell の対応操作は [スラッシュコマンド完全リファレンス](./slash-commands.md) を参照してください。

## ソースから実行

CyberCode の開発やソースコードの変更を行う場合に使用します。

```bash
git clone https://github.com/wk42worldworld/cybercode.git
cd cybercode
bun install
cp .env.example .env
./bin/cybercode
```

Windows PowerShell / cmd では最後の行を `.\bin\cybercode.cmd` に置き換えてください。

## リカバリーモード

Ink TUI に問題がある場合は Recovery CLI を使用できます。

```bash
CYBERCODE_FORCE_RECOVERY_CLI=1 cybercode
```

```powershell
$env:CYBERCODE_FORCE_RECOVERY_CLI = "1"
cybercode
```
