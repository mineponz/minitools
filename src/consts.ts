/**
 * サイト全体の定数。
 *
 * SITE_URL は canonical と sitemap.xml の生成に使われる。本番URLと一致していないと
 * Googleに存在しないURLを申告することになるため、変更時は robots.txt も併せて直す。
 * 独自ドメインを設定したらここを差し替える。
 */
export const SITE_URL = 'https://minitools.mineponz.workers.dev';
export const SITE_TITLE = 'minitools';
export const SITE_DESCRIPTION =
  'パスワード生成・QRコード作成・単位変換・文字数カウントなど、日常のちょっとした用事を片付ける無料のミニツール集。登録もインストールも不要。すべてブラウザ内で動作し、入力内容をサーバーへ送信しません。';

/**
 * お問い合わせ先メールアドレス。
 *
 * 差し替え済み（2026-08-11）。この値が CONTACT_EMAIL_PLACEHOLDER と一致する間だけ
 * /contact/ が mailto リンクを出さず「準備中」と表示する（src/pages/contact.astro）。
 */
export const CONTACT_EMAIL_PLACEHOLDER = 'CONTACT_EMAIL_TODO';
export const CONTACT_EMAIL: string = 'ponneraru@gmail.com';

/** プライバシーポリシーの最終更新日（ページ末尾の表示に使う）。内容を変えたら必ず更新する。 */
export const PRIVACY_POLICY_UPDATED = '2026-08-11';
