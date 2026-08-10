import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  utf16Length,
  codePointLength,
  graphemeLength,
  utf8ByteLength,
  wordCount,
  countAll,
  checkLimit,
} from './char-count.ts';

test('空文字列はすべて0', () => {
  assert.equal(utf16Length(''), 0);
  assert.equal(codePointLength(''), 0);
  assert.equal(graphemeLength(''), 0);
  assert.equal(utf8ByteLength(''), 0);
  assert.equal(wordCount(''), 0);
});

test('ASCII文字列はどの数え方でも一致する', () => {
  const s = 'Hello, world!';
  assert.equal(utf16Length(s), 13);
  assert.equal(codePointLength(s), 13);
  assert.equal(graphemeLength(s), 13);
  assert.equal(utf8ByteLength(s), 13); // ASCIIは1文字1バイト
});

test('日本語（ひらがな・カタカナ・漢字）はUTF-16長・コードポイント数は一致するがバイト数は増える', () => {
  const s = 'こんにちはカタカナ漢字';
  // BMP内の文字なのでUTF-16長とコードポイント数は一致する
  assert.equal(utf16Length(s), 11);
  assert.equal(codePointLength(s), 11);
  assert.equal(graphemeLength(s), 11);
  // 日本語は基本的にUTF-8で1文字3バイト
  assert.equal(utf8ByteLength(s), 11 * 3);
});

test('サロゲートペアが必要な絵文字は .length とコードポイント数が異なる', () => {
  const s = '🎉'; // U+1F389、BMP外なのでサロゲートペア(2コード単位)が必要
  assert.equal(utf16Length(s), 2);
  assert.equal(codePointLength(s), 1);
  assert.equal(graphemeLength(s), 1);
  // UTF-8では4バイト
  assert.equal(utf8ByteLength(s), 4);
});

test('複数の絵文字が混じった文章での差', () => {
  const s = 'やった🎉🎊'; // 「やった」3文字 + 絵文字2つ(各サロゲートペア)
  assert.equal(utf16Length(s), 3 + 2 + 2);
  assert.equal(codePointLength(s), 3 + 1 + 1);
  assert.equal(graphemeLength(s), 3 + 1 + 1);
});

test('ZWJシーケンスの絵文字（家族の絵文字）は書記素クラスタ数では1文字になる', () => {
  // 👨‍👩‍👧‍👦 = 男性 + ZWJ + 女性 + ZWJ + 女児 + ZWJ + 男児（4つの絵文字がZWJで連結）
  const family = '👨‍👩‍👧‍👦';
  const graphemes = graphemeLength(family);
  const codePoints = codePointLength(family);
  // 見た目は1文字だが、コードポイント数は7つ（絵文字4つ + ZWJ3つ）ある
  assert.equal(graphemes, 1);
  assert.ok(codePoints > 1, `コードポイント数は複数のはず（実際: ${codePoints}）`);
});

test('肌色修飾子付き絵文字も書記素クラスタ数では1文字になる', () => {
  const wave = '👋🏽'; // 手を振る + 中間の肌色修飾子
  assert.equal(graphemeLength(wave), 1);
  assert.equal(codePointLength(wave), 2);
});

test('結合文字（アクセント記号の合成）も書記素クラスタ数では1文字になる', () => {
  // "e" + COMBINING ACUTE ACCENT (U+0301) は見た目「é」で1文字
  const combined = 'é';
  assert.equal(codePointLength(combined), 2);
  assert.equal(graphemeLength(combined), 1);
});

test('Intl.Segmenter が使えない環境ではコードポイント数にフォールバックする', () => {
  const family = '👨‍👩‍👧‍👦';
  // null を渡すとフォールバック（コードポイント数）が強制される
  const fallback = graphemeLength(family, null);
  assert.equal(fallback, codePointLength(family));
  // フォールバック時は見た目1文字のはずが複数として数えられてしまう（近似値であることの確認）
  assert.ok(fallback > 1);
});

test('単語数は空白区切りの単純カウント', () => {
  assert.equal(wordCount('hello world'), 2);
  assert.equal(wordCount('  hello   world  foo '), 3);
  assert.equal(wordCount('hello\nworld\ttab'), 3);
  assert.equal(wordCount('single'), 1);
  assert.equal(wordCount('   '), 0);
});

test('日本語は分かち書きしないため単語数の概念が曖昧（空白がなければ1単語として数えられる）', () => {
  assert.equal(wordCount('今日は晴れです'), 1);
});

test('countAll はすべての数え方をまとめて返す', () => {
  const result = countAll('🎉');
  assert.deepEqual(result, {
    utf16: 2,
    codePoints: 1,
    graphemes: 1,
    utf8Bytes: 4,
    words: 1,
  });
});

test('checkLimit: ちょうど上限ぴったりは超過ではない', () => {
  const r = checkLimit(280, 280);
  assert.equal(r.remaining, 0);
  assert.equal(r.isOver, false);
});

test('checkLimit: 1文字超過', () => {
  const r = checkLimit(281, 280);
  assert.equal(r.remaining, -1);
  assert.equal(r.isOver, true);
});

test('checkLimit: 大幅超過', () => {
  const r = checkLimit(1000, 280);
  assert.equal(r.remaining, -720);
  assert.equal(r.isOver, true);
});

test('checkLimit: 上限に余裕がある場合', () => {
  const r = checkLimit(50, 280);
  assert.equal(r.remaining, 230);
  assert.equal(r.isOver, false);
});
