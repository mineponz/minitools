import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePassword,
  calculateEntropy,
  strengthLabel,
  PasswordOptionsError,
  type PasswordOptions,
} from './password.ts';

const base: PasswordOptions = {
  length: 16,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: false,
};

test('指定した長さで生成される', () => {
  for (const length of [1, 8, 16, 32, 64]) {
    const pw = generatePassword({ ...base, length });
    assert.equal(pw.length, length);
  }
});

test('数字のみオンなら数字だけが含まれる', () => {
  const options: PasswordOptions = {
    length: 50,
    uppercase: false,
    lowercase: false,
    numbers: true,
    symbols: false,
    excludeAmbiguous: false,
  };
  const pw = generatePassword(options);
  assert.match(pw, /^[0-9]+$/);
  assert.doesNotMatch(pw, /[a-zA-Z]/);
});

test('大文字のみオンなら大文字だけが含まれる', () => {
  const options: PasswordOptions = {
    length: 50,
    uppercase: true,
    lowercase: false,
    numbers: false,
    symbols: false,
    excludeAmbiguous: false,
  };
  const pw = generatePassword(options);
  assert.match(pw, /^[A-Z]+$/);
});

test('全文字種オフはエラーになる', () => {
  const options: PasswordOptions = {
    length: 10,
    uppercase: false,
    lowercase: false,
    numbers: false,
    symbols: false,
    excludeAmbiguous: false,
  };
  assert.throws(() => generatePassword(options), PasswordOptionsError);
});

test('長さが1未満や整数でない場合はエラーになる', () => {
  assert.throws(() => generatePassword({ ...base, length: 0 }), PasswordOptionsError);
  assert.throws(() => generatePassword({ ...base, length: -5 }), PasswordOptionsError);
  assert.throws(() => generatePassword({ ...base, length: 1.5 }), PasswordOptionsError);
});

test('紛らわしい文字を除外するオプションが機能する', () => {
  const options: PasswordOptions = {
    length: 200,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: false,
    excludeAmbiguous: true,
  };
  const pw = generatePassword(options);
  // 0, O, o, 1, l, I はすべて除外されているはず
  assert.doesNotMatch(pw, /[0O o1lI]/);
  for (const ch of ['0', 'O', 'o', '1', 'l', 'I']) {
    assert.equal(pw.includes(ch), false, `"${ch}" が含まれてはいけない`);
  }
});

test('エントロピー計算は文字種数と長さから正しく算出される', () => {
  // 数字のみ: 文字種10種、長さ10 → 10 * log2(10)
  const numbersOnly: PasswordOptions = {
    length: 10,
    uppercase: false,
    lowercase: false,
    numbers: true,
    symbols: false,
    excludeAmbiguous: false,
  };
  assert.ok(Math.abs(calculateEntropy(numbersOnly) - 10 * Math.log2(10)) < 1e-9);

  // 大文字+小文字: 52種、長さ12 → 12 * log2(52)
  const upperLower: PasswordOptions = {
    length: 12,
    uppercase: true,
    lowercase: true,
    numbers: false,
    symbols: false,
    excludeAmbiguous: false,
  };
  assert.ok(Math.abs(calculateEntropy(upperLower) - 12 * Math.log2(52)) < 1e-9);

  // 文字種なし → 0
  const none: PasswordOptions = {
    length: 12,
    uppercase: false,
    lowercase: false,
    numbers: false,
    symbols: false,
    excludeAmbiguous: false,
  };
  assert.equal(calculateEntropy(none), 0);
});

test('強度ラベルの境界値', () => {
  assert.equal(strengthLabel(0), '弱い');
  assert.equal(strengthLabel(39.9), '弱い');
  assert.equal(strengthLabel(40), '普通');
  assert.equal(strengthLabel(59.9), '普通');
  assert.equal(strengthLabel(60), '強い');
  assert.equal(strengthLabel(79.9), '強い');
  assert.equal(strengthLabel(80), '非常に強い');
  assert.equal(strengthLabel(200), '非常に強い');
});

test('生成結果は毎回異なる（統計的テスト）', () => {
  const options: PasswordOptions = { ...base, length: 20 };
  const results = new Set<string>();
  for (let i = 0; i < 50; i++) {
    results.add(generatePassword(options));
  }
  // 20文字・文字種豊富な条件で50回生成して重複が出る確率は天文学的に低い。
  // 万一の衝突を許容しても、ほぼ全部が異なっていることを確認する。
  assert.ok(results.size >= 49, `重複が多すぎる: ユニーク数 ${results.size}/50`);
});

test('生成結果は決め打ちの値に固定されない（同一オプションで複数回試行）', () => {
  const options: PasswordOptions = { ...base, length: 12 };
  const first = generatePassword(options);
  let sawDifferent = false;
  for (let i = 0; i < 20; i++) {
    if (generatePassword(options) !== first) {
      sawDifferent = true;
      break;
    }
  }
  assert.equal(sawDifferent, true);
});
