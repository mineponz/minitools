/**
 * サイト全体の定数。
 *
 * SITE_URL は canonical と sitemap.xml の生成に使われる。本番URLと一致していないと
 * Googleに存在しないURLを申告することになるため、変更時は robots.txt も併せて直す。
 * 独自ドメインを設定したらここを差し替える。
 */
export const SITE_URL = 'https://minitools.h748-ponz.workers.dev';
export const SITE_TITLE = 'minitools';
export const SITE_DESCRIPTION =
  'エンジニアの手元の作業を1つずつ片付ける、小さなツール集。すべてブラウザ内で動作し、入力内容をサーバーへ送信しません。';
