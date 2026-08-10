/**
 * 文字数・バイト数カウンターのロジック。
 *
 * 「文字数」は数え方が複数あり、同じ文章でも結果が変わる。
 *
 * - UTF-16コード単位数（JSの `.length`）: 絵文字などサロゲートペアが必要な文字は
 *   2として数えられる。多くのSNSがこの数え方（またはコードポイント数）を
 *   文字数上限の計算に使っているとされるが、サービスによって異なるため
 *   このツールでは「参考値」として扱う。
 * - Unicodeコードポイント数: サロゲートペアを1文字として正しく数える。
 *   `[...str].length` はこの数え方になる。
 * - 見た目の文字数（書記素クラスタ数）: 結合文字（アクセント記号の合成）や
 *   肌色修飾子付き絵文字、家族の絵文字のようなZWJシーケンスは複数の
 *   コードポイントから成るが、画面には1文字として見える。人間の直感に
 *   一番近い数え方だが、計算コストが最も高い。
 * - UTF-8バイト数: ファイルサイズやAPIのペイロードサイズを見積もるときの数え方。
 *   ASCII文字は1バイト、日本語（ひらがな・カタカナ・大半の漢字）は3バイト、
 *   絵文字はさらに大きくなることが多い。
 *
 * これらが一致するのはASCIIだけの文章のときに限られる。日本語や絵文字が
 * 混じると数え方によって結果が変わる、というのがこのツールの存在理由。
 */

/** UTF-16コード単位数（JS文字列の `.length` そのもの） */
export function utf16Length(text: string): number {
  return text.length;
}

/**
 * Unicodeコードポイント数。
 *
 * 文字列をイテレート（`for...of` / スプレッド）すると、JSはサロゲートペアを
 * 1つのコードポイントとして扱う。これを利用してカウントする。
 */
export function codePointLength(text: string): number {
  return [...text].length;
}

/**
 * 見た目の文字数（書記素クラスタ数）の近似値。
 *
 * `Intl.Segmenter`（`granularity: 'grapheme'`）が使える環境ではそれを使い、
 * 結合文字やZWJシーケンスの絵文字も正しく1文字として数える。
 *
 * 使えない環境向けのフォールバックとしてコードポイント数を返す。この場合、
 * ZWJシーケンスの絵文字（家族の絵文字など）は複数文字として数えられてしまう
 * （近似値であることを明示するため、関数名にも「近似」の意図を込めている）。
 *
 * `segmenterCtor` は主にテスト用の差し替え口。省略時はグローバルの
 * `Intl.Segmenter` を使う（Node.js / モダンブラウザどちらでも利用可能）。
 * `null` を明示的に渡すとフォールバック（コードポイント数）を強制できる
 * （`undefined` はJSのデフォルト引数の仕組み上「省略」と区別できないため、
 * フォールバックを強制したい場合は `null` を使う）。
 */
export function graphemeLength(
  text: string,
  segmenterCtor: typeof Intl.Segmenter | null | undefined = typeof Intl !== 'undefined'
    ? Intl.Segmenter
    : undefined,
): number {
  if (!segmenterCtor) return codePointLength(text);
  const segmenter = new segmenterCtor('ja', { granularity: 'grapheme' });
  let count = 0;
  for (const _ of segmenter.segment(text)) count++;
  return count;
}

/**
 * UTF-8バイト数。
 *
 * `TextEncoder` はJS文字列（UTF-16）をUTF-8バイト列にエンコードする。
 * `Uint8Array` の長さがそのままバイト数になる。
 */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * 単語数（簡易カウント）。
 *
 * 空白（スペース・改行・タブなど）区切りで数えるだけの単純な実装。
 * 英語のように単語を空白で区切る言語では意味のある数字になるが、
 * 日本語のように分かち書きをしない言語では「単語」の境界がそもそも
 * 曖昧で、この数え方に実用的な意味はほとんどない（例えば「今日は晴れです」は
 * 空白がなければ1単語として数えられる）。あくまで参考値として提供する。
 */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/).length;
}

/** 文字数の数え方をまとめて計算した結果 */
export type CharCounts = {
  utf16: number;
  codePoints: number;
  graphemes: number;
  utf8Bytes: number;
  words: number;
};

/** 上のすべてのカウントをまとめて計算する */
export function countAll(text: string): CharCounts {
  return {
    utf16: utf16Length(text),
    codePoints: codePointLength(text),
    graphemes: graphemeLength(text),
    utf8Bytes: utf8ByteLength(text),
    words: wordCount(text),
  };
}

/** 文字数上限に対する残り／超過の計算結果 */
export type LimitCheck = {
  /** 判定に使った文字数 */
  count: number;
  /** 上限値 */
  limit: number;
  /** 残り文字数。上限を超えている場合は負の値になる */
  remaining: number;
  /** 上限を超えているか */
  isOver: boolean;
};

/**
 * 文字数上限に対する残り文字数（または超過文字数）を計算する。
 *
 * 具体的なSNSの上限値はこの関数の外（UI側）で定数として持つ。この関数は
 * 「count個の文字を、limit文字までの上限に当てはめるとどうなるか」だけを
 * 計算する汎用的なものにする。
 */
export function checkLimit(count: number, limit: number): LimitCheck {
  const remaining = limit - count;
  return { count, limit, remaining, isOver: remaining < 0 };
}
