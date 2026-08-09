# minitools

エンジニア向けミニツール集。すべてクライアントサイドで動作する静的サイト。
運用記録・タスク管理は別リポジトリの Obsidian vault（`~/secondBrain`）側にある。

## このリポジトリの方針

- **ツールのロジックは `src/lib/` に分離し、必ずテストを書く。** UIから切り離しておくことで
  `node --test` で検証できる。ロジックを `.astro` の `<script>` に直接書かない。
- **ブラウザ内で完結させる。** 入力内容を外部へ送信しない。これがこのサイトの売りなので、
  サーバー送信が必要な機能を足すときは方針変更として明示的に判断する。
- **対応しない仕様は「対応しない」と書く。** 中途半端に実装して間違った結果を出すより、
  エラーとして弾いてページ本文で理由を説明する（cronの `L` / `W` / `#` がその例）。
- 記事や説明文を追加するときは、実際に自分で確かめた内容だけを書く。

## コマンド

```
npm run dev      # 開発サーバー
npm test         # src/lib/*.test.ts を実行
npm run check    # 型チェック + テスト
npm run build    # dist/ に静的出力
```

## ツールを追加する手順

1. `src/lib/<tool>.ts` にロジックを書く（DOM に触れない純粋な関数として）
2. `src/lib/<tool>.test.ts` にテストを書き、`npm test` を通す
3. `src/pages/tools/<tool>.astro` にUIを書き、`<script>` から `src/lib/` を import する
4. `src/pages/index.astro` の `tools` 配列に1行足す（`status: 'ready'`）
5. `npm run build` が通ることを確認する

## 注意点（実際に踏んだもの）

- Node の型ストリップは TypeScript の**パラメータプロパティ**（`constructor(readonly x: T)`）に
  非対応。`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` になるのでフィールドを明示的に宣言する。
- JSON-LD は `<script type="application/ld+json" set:html={...} />` と書く。
  `<set:html value={...} />` は単体タグとして使えず、不正な要素がそのまま出力される。
- `SITE_URL`（`src/consts.ts`）は canonical と sitemap.xml に直結する。本番URLと一致させる。

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
