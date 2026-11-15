# Zizai Star Schema VSIX 配布

VS Code拡張機能（.vsix）の配布版です。既存のブラウザ版 `index.html` は変更していません。

## 最新版: v0.4.8

- ファイル: [zizai-star-schema-0.4.8.vsix](./zizai-star-schema-0.4.8.vsix)
- SHA-256: `04603ada58743910251c31026f198170bee47cc02dfe751d0e9b8fc9e242fd33`
- 主な変更: ファクトを「マスタ／トランザクション」に分類。マスタはディメンションのみ、トランザクションはディメンションと選択したマスタファクトを参照できます。02 データ入力でレコードごとのマスタ参照を指定可能です。
- 互換性: 既存MKRMはトランザクションとして移行し、既存のファクトとディメンションを保持します。参照されているマスタレコードの削除は防止します。
- 検証: Node.js/SQLite自動テスト6件、ChromiumによるWebview操作テスト、および5,000件の既存MKRMの読み込み・整合性確認済み（Windows実機は未検証）。

## 旧版: v0.4.7

- ファイル: [zizai-star-schema-0.4.7.vsix](./zizai-star-schema-0.4.7.vsix)
- SHA-256: `61169a9bd73bf2d58b059b7f114587f36cf7e1177445263710e1117bf8c3b325`
- 主な変更: `.mkrm` のダブルクリックで専用エディタを開くCustom Editor登録、既存の開く／新規作成コマンドを維持

## 旧版: v0.4.6

- ファイル: [zizai-star-schema-0.4.6.vsix](./zizai-star-schema-0.4.6.vsix)
- SHA-256: `7cb2e3cd4045269ef79814c58286f9f4ca461f072a47e09c86a06623bb492efb`
- 主な修正: 型変更時の確認アラート、入力規則違反セルの薄赤背景と左上の「！」、クリック時の説明表示

> Windows版VS Codeでの実機操作は未検証です。
