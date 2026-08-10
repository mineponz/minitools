/**
 * パスワード生成ロジック。
 *
 * 重要（セキュリティ）: 乱数の取得には必ず Web Crypto API の
 * `crypto.getRandomValues()` を使う。`Math.random()` は絶対に使わない。
 * `Math.random()` は暗号学的に安全な乱数生成器ではなく、実装によっては
 * 内部状態が短い出力列から推測できてしまうため、パスワードのような
 * 「他人に予測されては困る値」の生成に使うと、生成されたパスワードが
 * 推測可能になり脆弱性になる。`crypto.getRandomValues()` は
 * OS の暗号論的擬似乱数生成器（CSPRNG）を使うため、この用途に適する。
 * このモジュールはブラウザで動く前提で、`crypto` はグローバルの
 * Web Crypto API を指す（Node.js の `node --test` でも
 * `globalThis.crypto` として同等のAPIが利用できる）。
 */

export type PasswordOptions = {
  /** パスワードの長さ（文字数） */
  length: number;
  /** 大文字（A-Z）を含める */
  uppercase: boolean;
  /** 小文字（a-z）を含める */
  lowercase: boolean;
  /** 数字（0-9）を含める */
  numbers: boolean;
  /** 記号（!@#$%... など）を含める */
  symbols: boolean;
  /** 紛らわしい文字（0/O、1/l/I など）を除外する */
  excludeAmbiguous: boolean;
};

export class PasswordOptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordOptionsError';
  }
}

const CHARSETS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?',
} as const;

// 見た目が紛らわしく、読み間違えやすい文字。
// 数字の 0 とアルファベットの O、数字の 1 とアルファベットの l（エル）・I（大文字アイ）など。
const AMBIGUOUS_CHARS = new Set(['0', 'O', '1', 'l', 'I', 'o']);

/** 選択されたオプションから使用する文字集合（重複なし）を組み立てる */
function buildCharset(options: PasswordOptions): string {
  let charset = '';
  if (options.uppercase) charset += CHARSETS.uppercase;
  if (options.lowercase) charset += CHARSETS.lowercase;
  if (options.numbers) charset += CHARSETS.numbers;
  if (options.symbols) charset += CHARSETS.symbols;

  if (options.excludeAmbiguous) {
    charset = [...charset].filter((c) => !AMBIGUOUS_CHARS.has(c)).join('');
  }

  return charset;
}

/**
 * `crypto.getRandomValues()` を使って `[0, max)` の一様乱数整数を1つ返す。
 *
 * 単純に `randomByte % max` とすると max が256の約数でない場合に
 * 剰余バイアス（値の出現確率に偏り）が生じるため、
 * バイアスの原因になりうる範囲の値は棄却して引き直す（rejection sampling）。
 */
function randomInt(max: number): number {
  if (max <= 0 || max > 256) {
    throw new RangeError('randomInt は 1〜256 の範囲でのみ使用できます');
  }
  const limit = 256 - (256 % max);
  const buf = new Uint8Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % max;
}

/**
 * オプションに従ってランダムなパスワードを生成する。
 *
 * すべての文字種がオフの場合や、除外オプションの結果使える文字がなくなった場合はエラー。
 */
export function generatePassword(options: PasswordOptions): string {
  if (!Number.isInteger(options.length) || options.length < 1) {
    throw new PasswordOptionsError('長さは1文字以上の整数で指定してください');
  }

  const charset = buildCharset(options);
  if (charset.length === 0) {
    throw new PasswordOptionsError(
      '少なくとも1種類の文字（大文字・小文字・数字・記号）を選んでください',
    );
  }

  const chars = [...charset];
  let password = '';
  for (let i = 0; i < options.length; i++) {
    password += chars[randomInt(chars.length)];
  }
  return password;
}

/**
 * 生成に使った文字種の総数から、パスワードのエントロピー（ビット数）を計算する。
 *
 * 計算式: 長さ × log2(文字種の総数)
 * 文字がすべて独立かつ一様ランダムに選ばれている場合の理論値であり、
 * このツールの生成方法（各文字を毎回 crypto.getRandomValues で独立に選ぶ）と一致する。
 */
export function calculateEntropy(options: PasswordOptions): number {
  const charset = buildCharset(options);
  if (charset.length === 0) return 0;
  return options.length * Math.log2(charset.length);
}

export type StrengthLabel = '弱い' | '普通' | '強い' | '非常に強い';

/**
 * エントロピー（ビット数）から強度ラベルを返す。
 *
 * 閾値の根拠: オフライン攻撃を想定した一般的な目安として、
 * - 40bit未満: 一般的なPCでも比較的短時間（数日〜）で全数探索が現実的になりうる範囲 → 「弱い」
 * - 40〜60bit: すぐには破られにくいが、専用ハードウェアや長期的な攻撃を考えると余裕がない → 「普通」
 * - 60〜80bit: 現実的な時間での全数探索が非常に困難 → 「強い」
 * - 80bit以上: 現在の計算資源では事実上不可能な範囲 → 「非常に強い」
 * これらの数値はあくまで目安であり、攻撃者の計算資源や攻撃手法（辞書攻撃、漏洩使い回し等）
 * 次第で安全性は変わる。特定の攻撃に対する安全性を保証するものではない。
 */
export function strengthLabel(entropyBits: number): StrengthLabel {
  if (entropyBits < 40) return '弱い';
  if (entropyBits < 60) return '普通';
  if (entropyBits < 80) return '強い';
  return '非常に強い';
}
