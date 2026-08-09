/**
 * サイト全体の定数。
 *
 * SITE_URL は Cloudflare Pages のプロジェクトを作った後に実際のURLへ差し替える。
 * sitemap.xml と canonical の生成に使われるため、間違っているとSEO上の実害が出る。
 */
export const SITE_URL = 'https://minitools.pages.dev'; // TODO: Cloudflare Pages の本番URLに差し替え
export const SITE_TITLE = 'minitools';
export const SITE_DESCRIPTION =
  'エンジニアの手元の作業を1つずつ片付ける、小さなツール集。すべてブラウザ内で動作し、入力内容をサーバーへ送信しません。';
