import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, formatResult, CalcError } from './calc.ts';

function closeTo(actual: number, expected: number, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `期待値 ${expected} に対して ${actual} は誤差範囲外（差: ${Math.abs(actual - expected)}）`,
  );
}

/** エラーメッセージの一部が一致することを確かめる */
function throwsWith(expression: string, fragment: string, options = {}) {
  assert.throws(
    () => evaluate(expression, options),
    (e: unknown) =>
      e instanceof CalcError && e.message.includes(fragment)
        ? true
        : (() => {
            throw new Error(
              `"${expression}" のエラーが想定と違う: ${e instanceof Error ? e.message : String(e)}`,
            );
          })(),
    `"${expression}" はエラーになるはず`,
  );
}

// --- 四則演算と優先順位 ---

test('四則演算の優先順位: 掛け算・割り算が先', () => {
  assert.equal(evaluate('1+2*3'), 7);
  assert.equal(evaluate('1+6/3'), 3);
  assert.equal(evaluate('2*3+4*5'), 26);
});

test('括弧で優先順位を変えられる', () => {
  assert.equal(evaluate('(1+2)*3'), 9);
  assert.equal(evaluate('((1+2)*(3+4))'), 21);
  assert.equal(evaluate('2*(3+(4-1))'), 12);
});

test('同じ優先順位の演算は左から計算する', () => {
  assert.equal(evaluate('2-3-4'), -5);
  assert.equal(evaluate('100/5/2'), 10);
});

test('べき乗は右結合で、掛け算より強い', () => {
  assert.equal(evaluate('2^3^2'), 512); // 2^(3^2)
  assert.equal(evaluate('(2^3)^2'), 64);
  assert.equal(evaluate('2*3^2'), 18);
  assert.equal(evaluate('2^-3'), 0.125);
});

test('単項マイナスはべき乗より弱い（-2^2 は -4）', () => {
  assert.equal(evaluate('-2^2'), -4);
  assert.equal(evaluate('(-2)^2'), 4);
  assert.equal(evaluate('-3!'), -6);
  assert.equal(evaluate('--5'), 5);
});

test('小数と指数表記を読める', () => {
  closeTo(evaluate('0.1+0.2'), 0.3);
  assert.equal(evaluate('1e3'), 1000);
  assert.equal(evaluate('2e-3'), 0.002);
  assert.equal(evaluate('.5*4'), 2);
});

// --- 掛け算記号の省略 ---

test('掛け算記号を省略できる（数値と定数・括弧・関数のあいだ）', () => {
  closeTo(evaluate('2π'), 2 * Math.PI);
  assert.equal(evaluate('3(4+5)'), 27);
  assert.equal(evaluate('(1+2)(3+4)'), 21);
  closeTo(evaluate('2sin(30)'), 1);
});

test('数値どうしの省略は打ち間違いとみなしてエラーにする', () => {
  throwsWith('2 3', '読み切れませんでした');
});

// --- 関数 ---

test('三角関数（度数法が既定）', () => {
  closeTo(evaluate('sin(30)'), 0.5);
  closeTo(evaluate('cos(60)'), 0.5);
  closeTo(evaluate('tan(45)'), 1);
});

test('度数法では90°の倍数がぴったりの値になる', () => {
  assert.equal(evaluate('sin(180)'), 0);
  assert.equal(evaluate('sin(0)'), 0);
  assert.equal(evaluate('sin(90)'), 1);
  assert.equal(evaluate('cos(90)'), 0);
  assert.equal(evaluate('cos(270)'), 0);
  assert.equal(evaluate('tan(180)'), 0);
});

test('ラジアンモードに切り替えられる', () => {
  closeTo(evaluate('sin(π/2)', { angleMode: 'rad' }), 1);
  closeTo(evaluate('cos(0)', { angleMode: 'rad' }), 1);
  closeTo(evaluate('sin(30)', { angleMode: 'rad' }), Math.sin(30));
});

test('逆三角関数は角度モードに合わせた単位で返る', () => {
  closeTo(evaluate('asin(0.5)'), 30);
  closeTo(evaluate('acos(0)'), 90);
  closeTo(evaluate('atan(1)'), 45);
  closeTo(evaluate('asin(1)', { angleMode: 'rad' }), Math.PI / 2);
  closeTo(evaluate('arcsin(0.5)'), 30); // 別名
});

test('対数と平方根', () => {
  assert.equal(evaluate('log(1000)'), 3);
  assert.equal(evaluate('log(1)'), 0);
  closeTo(evaluate('ln(e)'), 1);
  assert.equal(evaluate('√9'), 3);
  assert.equal(evaluate('sqrt(16)'), 4);
  assert.equal(evaluate('√(9+16)'), 5);
});

test('括弧を省略した関数は直後の単項式ひとつだけを引数にする', () => {
  assert.equal(evaluate('√9+1'), 4); // √(9+1) ではない
  closeTo(evaluate('sin30*2'), 1); // (sin30)*2
  assert.equal(evaluate('sin30^2'), 0); // べき乗までは引数に含むので sin(900) = 0
});

// --- 階乗 ---

test('階乗', () => {
  assert.equal(evaluate('5!'), 120);
  assert.equal(evaluate('0!'), 1);
  assert.equal(evaluate('3!+2'), 8);
  assert.equal(evaluate('2^3!'), 64); // 2^(3!) = 2^6
  assert.equal(evaluate('(2+3)!'), 120);
});

test('階乗が使えない値はエラーになる', () => {
  throwsWith('(-1)!', '0以上の整数');
  throwsWith('2.5!', '0以上の整数');
  throwsWith('171!', '170!まで');
});

// --- パーセント ---

test('パーセントは足し引きの右側だけ「左の値に対する割合」になる', () => {
  assert.equal(evaluate('50%'), 0.5);
  assert.equal(evaluate('200+10%'), 220);
  assert.equal(evaluate('200-10%'), 180);
  assert.equal(evaluate('1980+1980*0.1'), 2178);
});

test('掛け算・割り算のパーセントは単純に100分の1', () => {
  assert.equal(evaluate('200*10%'), 20);
  assert.equal(evaluate('200/10%'), 2000);
  closeTo(evaluate('200+10%*2'), 200.2); // 割合扱いになるのは % が右端にあるときだけ
});

// --- 定数と Ans ---

test('円周率とネイピア数', () => {
  closeTo(evaluate('π'), Math.PI);
  closeTo(evaluate('pi'), Math.PI);
  closeTo(evaluate('e'), Math.E);
  closeTo(evaluate('2e'), 2 * Math.E); // 指数表記ではなく 2 × e
  assert.equal(evaluate('2e3'), 2000); // こちらは指数表記
});

test('Ans は直前の答えを指す', () => {
  assert.equal(evaluate('Ans+1', { ans: 41 }), 42);
  assert.equal(evaluate('ans*2', { ans: 21 }), 42);
  assert.equal(evaluate('Ans'), 0); // 未指定なら0
});

// --- 全角・区切り文字 ---

test('全角で入力しても計算できる', () => {
  assert.equal(evaluate('１＋２×３'), 7);
  assert.equal(evaluate('（１＋２）×３'), 9);
  assert.equal(evaluate('１０ー３'), 7); // 長音符も引き算として扱う
});

test('3桁区切りのカンマを付けた数値を読める', () => {
  assert.equal(evaluate('1,234+1'), 1235);
  assert.equal(evaluate('1,234,567'), 1234567);
});

test('3桁区切りになっていないカンマはエラーになる', () => {
  throwsWith('1,23', '使えません');
  throwsWith('1,2345', '使えません');
});

// --- エラー ---

test('ゼロ除算はエラーになる', () => {
  throwsWith('1/0', '0で割る');
  throwsWith('5/(3-3)', '0で割る');
  throwsWith('0^-1', '0の負の乗');
});

test('定義域の外はエラーになる', () => {
  throwsWith('√(-1)', '負の数は入れられません');
  throwsWith('log(0)', '正の数だけ');
  throwsWith('log(-5)', '正の数だけ');
  throwsWith('ln(0)', '正の数だけ');
  throwsWith('asin(2)', '-1 〜 1');
  throwsWith('acos(-2)', '-1 〜 1');
  throwsWith('tan(90)', '定義されません');
  throwsWith('tan(270)', '定義されません');
  throwsWith('(-8)^(1/3)', '負の数を小数で累乗');
});

test('括弧の対応が取れていなければエラーになる', () => {
  throwsWith('(1+2', '括弧が閉じていません');
  throwsWith('1+2)', '対応する開き括弧がありません');
  throwsWith('sin(30', '括弧が閉じていません');
  throwsWith(')', '対応する開き括弧がありません');
});

test('式として成り立たない入力はエラーになる', () => {
  throwsWith('', '式を入力してください');
  throwsWith('1+', '途中で終わって');
  throwsWith('1**2', '使い方が正しくありません');
  throwsWith('!5', '前に数値がありません');
  throwsWith('foo(2)', '「foo」は使えません');
  throwsWith('2@3', '「@」は使えません');
});

test('桁があふれる計算はエラーになる', () => {
  throwsWith('10^400', '桁が大きすぎます');
});

test('エラーには入力上の位置が入る', () => {
  assert.throws(
    () => evaluate('12/0'),
    (e: unknown) => e instanceof CalcError && e.position === 2,
  );
  assert.throws(
    () => evaluate('1+foo'),
    (e: unknown) => e instanceof CalcError && e.position === 2,
  );
});

test('ラジアンモードの tan は発散を検出しない（対応しない仕様）', () => {
  // 度数法と違い「ちょうど π/2」を浮動小数点で判定できないため、巨大な数がそのまま返る
  const value = evaluate('tan(π/2)', { angleMode: 'rad' });
  assert.ok(Math.abs(value) > 1e15, `巨大な数になるはず: ${value}`);
});

// --- 表示用の整形 ---

test('formatResult: 浮動小数点の誤差を丸めて表示する', () => {
  assert.equal(formatResult(0.1 + 0.2), '0.3');
  assert.equal(formatResult(evaluate('sin(30)')), '0.5');
  assert.equal(formatResult(evaluate('tan(45)')), '1');
});

test('formatResult: 有効数字12桁までに収める', () => {
  assert.equal(formatResult(Math.sqrt(2)), '1.41421356237');
  assert.equal(formatResult(1 / 3), '0.333333333333');
});

test('formatResult: 桁が極端な値は指数表記にする', () => {
  assert.equal(formatResult(1e20), '1e+20');
  assert.equal(formatResult(-1.23e-10), '-1.23e-10');
});

test('formatResult: 0とエラー値', () => {
  assert.equal(formatResult(0), '0');
  assert.equal(formatResult(120), '120');
  assert.equal(formatResult(Infinity), 'エラー');
  assert.equal(formatResult(NaN), 'エラー');
});
