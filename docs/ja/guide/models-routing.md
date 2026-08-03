# モデル接続、同期、エージェントルーティング

CyberCode はモデル接続を分かりやすいグループに整理し、デスクトップとターミナル TUI で同じローカル設定を共有します。カスタム provider を独立した先頭グループに置き、その後に公式 API Key、主要 aggregator、OAuth、Web セッション、画像・動画・音声、ローカルモデルを表示します。カスタム endpoint と LM Studio / Ollama は別グループです。

## 接続方式を選ぶ

| 種類 | 主な用途 | 説明 |
| --- | --- | --- |
| カスタム provider | 既存の互換 endpoint または自前 gateway | Base URL、protocol、モデル ID、任意の API Key を設定できます。 |
| 公式 API Key | 安定性と明確な課金を重視 | Key はローカルに保存されます。Kimi Code と Kimi のような別製品は別エントリです。 |
| Aggregator | 1 つのアカウントで複数モデルを利用 | OpenAI / Anthropic 互換 endpoint に対応します。 |
| OAuth | ブラウザー認証を提供するサービス | 認証結果をローカルに保存し、対応サービスでは token を自動更新します。 |
| Web セッション | 既存サイトのログイン状態を利用 | Cookie、JWT、Web token を使用するため、公式 API より安定性、rate limit、アカウント規約のリスクが高くなります。 |
| 画像・動画・音声 | メディアモデルと認証情報の管理 | 中国向け provider を優先表示します。接続テストは有料生成を実行せず、メディアモデルを chat の既定値にしません。 |
| ローカルモデル | LM Studio、Ollama などのローカル推論 | ローカルサービスへ直接接続します。CyberCode は推論アプリ自体の代わりにはなりません。 |

デスクトップでは **設定 → モデルとルーティング → モデルプロバイダー** を開きます。表示名は CyberCode の選択言語に従います。

## OAuth と Web セッション

OAuth カードを開いて認証を完了すると、接続済みカードだけが強調表示されます。token rotation に対応する provider は CyberCode がローカルで有効な token を維持します。

Web セッションでは、カードに表示された Cookie または Web token を入力します。CyberCode は Cookie を正規化し、ブラウザー互換 header と upstream の token 更新を処理します。ブラウザーデータの読み取り、CAPTCHA の代行、アカウント制限や地域制限の回避は行いません。

### 最短の設定手順

1. Provider カードを開いて **Web サイトを開く** を選び、自分のアカウントでログインしてメッセージを送信できることを確認します。
2. `F12` でブラウザー開発者ツールを開きます。ダイアログには、**Application / Storage → Cookies**、**Local Storage**、**Network** のどこを開くかと、探す正確な項目が表示されます。
3. 値をコピーします。Cookie は `name=value` をセミコロンで区切るか、**Network → Request Headers → Cookie** から Cookie の値全体をコピーできます。
4. CyberCode に戻り、**クリップボードからインポート**、**セッションを保存**、**テスト**の順に実行します。テスト成功後に既定へ設定してください。

選択した provider の正確な項目と入力形式は常にダイアログに表示されます。主な例：

| Provider | ブラウザー内の場所 | コピーする値 |
| --- | --- | --- |
| Kimi Web | Application / Storage → Cookies | `kimi-auth` または Cookie の値全体 |
| Claude Web | Application / Storage → Cookies | `sessionKey` または Cookie の値全体 |
| ChatGPT Web | Application / Storage → Cookies | `__Secure-next-auth.session-token` または Cookie の値全体 |
| Gemini Web | Application / Storage → Cookies | `__Secure-1PSID` と `__Secure-1PSIDTS` |
| DeepSeek Web | Application / Storage → Local Storage | `userToken` の値 |
| Microsoft Copilot Web | Network の chat request | `access_token` |
| Microsoft 365 Copilot | Network の WebSocket request URL | `access_token` と `chathubPath` |

ブラウザーは HttpOnly Cookie を保護するため、デスクトップアプリが広いブラウザー権限なしで無断取得することはできません。CyberCode はユーザーが明示的にコピーした後のワンクリックインポートを採用し、ブラウザープロファイルの走査やバックグラウンドのクリップボード権限保持は行いません。

::: warning 利用規約を確認してください
Web interface は予告なく変わり、rate limit やアカウント制御の対象になる場合があります。権限のあるアカウントだけを使用し、安定運用では公式 API を優先してください。
:::

## モデルの取り込みと同期

互換 `/models` endpoint を持つ API Key、カスタム、ローカル provider では **最新モデルを同期** を利用できます。CyberCode はリモート一覧を統合し、手入力したモデル ID を保持します。

**リアルタイム同期**を有効にすると、起動後と約 24 時間ごとに対応 provider を更新します。OAuth、Web セッション、内蔵メディア一覧はそれぞれの接続方式で管理され、汎用 `/models` 同期では上書きされません。

```text
/provider status
/provider sync [provider ID または名前]
/provider auto-sync on|off [provider ID または名前]
```

## エージェントルートを作成する

**モデルとエージェントルーティング → エージェントルーティング**で複数の利用可能なモデルを 1 つの route に追加します。CyberCode は可用性、health 履歴、失敗 cooldown を見て試行先を選び、最大試行回数の範囲で次の候補へ切り替えます。

```text
/routing
/routing status
/routing create coding-fast Daily coding
/routing strategy coding-fast auto
/routing use coding-fast
/routing reset-health
```

`/route` は `/routing` の alias です。詳細な順序と policy はデスクトップで編集できます。

## 他の Agent へ公開

**ノード**は設定済みモデルと route を、専用キーで保護された OpenAI Chat Completions / Anthropic Messages endpoint として公開します。元の provider Key は外部 Agent に渡りません。詳しくは [Agent ノード接続](./agent-node.md) を参照してください。

独立 TUI は必要時に内蔵ローカル runtime を起動するため、追加 proxy は不要です。デスクトップから起動された TUI では、二重書き込みを防ぐためデスクトップ側が server、同期 scheduler、node lifecycle を管理します。
