import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseJsonWithDetails,
  formatJson,
  minifyJson,
  validateJson,
  JsonSyntaxError,
} from './json-format.ts';

test('正常なJSONを整形できる', () => {
  const out = formatJson('{"b":2,"a":1}', 2);
  assert.equal(out, '{\n  "b": 2,\n  "a": 1\n}');
});

test('正常なJSONをミニファイできる', () => {
  const out = minifyJson('{\n  "a": 1,\n  "b": [1, 2, 3]\n}');
  assert.equal(out, '{"a":1,"b":[1,2,3]}');
});

test('トップレベルの各種プリミティブ値も有効なJSONとして扱う', () => {
  assert.equal(minifyJson('42'), '42');
  assert.equal(minifyJson('"hello"'), '"hello"');
  assert.equal(minifyJson('true'), 'true');
  assert.equal(minifyJson('false'), 'false');
  assert.equal(minifyJson('null'), 'null');
  assert.equal(minifyJson('[1,2,3]'), '[1,2,3]');
});

test('ネストしたオブジェクト・配列を正しく扱う', () => {
  const input = '{"a":{"b":[1,{"c":true},null]}}';
  assert.equal(minifyJson(input), input);
});

test('文字列のエスケープを正しく扱う', () => {
  const input = String.raw`{"s":"line1\nline2\t\"quoted\"\\backslash"}`;
  const { value } = parseJsonWithDetails(input);
  assert.equal((value as any).s, 'line1\nline2\t"quoted"\\backslash');
});

test('Unicodeエスケープを正しく扱う', () => {
  const { value } = parseJsonWithDetails('{"s":"\\u3042"}'); // "あ"
  assert.equal((value as any).s, 'あ');
});

test('空文字列は不正なJSON', () => {
  const result = validateJson('');
  assert.equal(result.valid, false);
});

test('空白のみも不正なJSON', () => {
  const result = validateJson('   \n  ');
  assert.equal(result.valid, false);
});

test('カンマ抜けはエラー', () => {
  const result = validateJson('{"a":1 "b":2}');
  assert.equal(result.valid, false);
});

test('閉じ括弧なしはエラー', () => {
  const result = validateJson('{"a":1');
  assert.equal(result.valid, false);
});

test('キーのクォート抜けはエラー', () => {
  const result = validateJson('{a:1}');
  assert.equal(result.valid, false);
});

test('末尾カンマはエラー（オブジェクト・配列とも）', () => {
  assert.equal(validateJson('{"a":1,}').valid, false);
  assert.equal(validateJson('[1,2,]').valid, false);
});

test('妥当なJSONの後に余分な文字があるとエラー', () => {
  const result = validateJson('{"a":1} extra');
  assert.equal(result.valid, false);
});

test('制御文字が生のまま文字列に含まれるとエラー', () => {
  const result = validateJson('{"a":"line1\nline2"}'); // 生の改行（\\nエスケープでない）
  assert.equal(result.valid, false);
});

test('不正なエスケープシーケンスはエラー', () => {
  const result = validateJson('{"a":"\\x41"}'); // \x はJSONの正当なエスケープではない
  assert.equal(result.valid, false);
});

test('行番号・列番号が複数行のJSONで正しい', () => {
  const input = '{\n  "a": 1,\n  "b": ,\n}'; // 3行目の値が抜けている
  const result = validateJson(input);
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.equal(result.position.line, 3);
  }
});

test('エラーメッセージに行と列が日本語で含まれる', () => {
  const result = validateJson('{"a":}');
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.match(result.message, /\d+行目 \d+列目/);
  }
});

test('JsonSyntaxError は position プロパティを持つ', () => {
  assert.throws(
    () => parseJsonWithDetails('{'),
    (err: unknown) => {
      assert.ok(err instanceof JsonSyntaxError);
      assert.ok(typeof err.position.line === 'number');
      assert.ok(typeof err.position.column === 'number');
      return true;
    },
  );
});

test('重複キーを検出する', () => {
  const result = validateJson('{"a":1,"b":2,"a":3}');
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.duplicates.length, 1);
    assert.equal(result.duplicates[0].key, 'a');
  }
});

test('重複キーが無ければ空配列', () => {
  const result = validateJson('{"a":1,"b":2}');
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.deepEqual(result.duplicates, []);
  }
});

test('重複キー検出は文字列値の中の紛らわしい文字列を誤検出しない', () => {
  // 値の中に "key": のような文字列が含まれていても、実際のキーではないので無視する
  const input = String.raw`{"a":1,"note":"the \"a\": field is important","a":2}`;
  const result = validateJson(input);
  assert.equal(result.valid, true);
  if (result.valid) {
    // 本当に重複しているのは最上位の "a" だけ
    assert.equal(result.duplicates.length, 1);
    assert.equal(result.duplicates[0].key, 'a');
  }
});

test('ネストしたオブジェクト同士で同じキー名を使っても重複扱いしない（スコープが違う）', () => {
  const input = '{"a":{"x":1},"b":{"x":2}}';
  const result = validateJson(input);
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.deepEqual(result.duplicates, []);
  }
});

test('formatJson はタブ区切りも指定できる', () => {
  const out = formatJson('{"a":1}', '\t');
  assert.equal(out, '{\n\t"a": 1\n}');
});

test('数値の各形式（負数・小数・指数）を正しくパースする', () => {
  const { value } = parseJsonWithDetails('[-1,0,1.5,1e10,1.5e-3,-2.5E+2]');
  assert.deepEqual(value, [-1, 0, 1.5, 1e10, 1.5e-3, -2.5e2]);
});

test('先頭に0を持つ複数桁の数値はエラー（JSON仕様違反）', () => {
  const result = validateJson('[01]');
  assert.equal(result.valid, false);
});
