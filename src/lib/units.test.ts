import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertLength, convertWeight, convertTemperature, roundForDisplay } from './units.ts';

function closeTo(actual: number, expected: number, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `期待値 ${expected} に対して ${actual} は誤差範囲外（差: ${Math.abs(actual - expected)}）`,
  );
}

// --- 長さ ---

test('長さ: 同一単位は値をそのまま返す', () => {
  assert.equal(convertLength(123.456, 'm', 'm'), 123.456);
});

test('長さ: 1インチ = 2.54センチメートル（定義値）', () => {
  closeTo(convertLength(1, 'in', 'cm'), 2.54);
});

test('長さ: 1マイル = 1609.344メートル（定義値）', () => {
  closeTo(convertLength(1, 'mi', 'm'), 1609.344);
});

test('長さ: 1キロメートル = 1000メートル', () => {
  closeTo(convertLength(1, 'km', 'm'), 1000);
});

test('長さ: 1フィート = 12インチ', () => {
  closeTo(convertLength(1, 'ft', 'in'), 12, 1e-6);
});

test('長さ: メートル→インチ→メートルの往復で誤差が小さい', () => {
  const original = 42;
  const roundTrip = convertLength(convertLength(original, 'm', 'in'), 'in', 'm');
  closeTo(roundTrip, original, 1e-9);
});

// --- 重さ ---

test('重さ: 同一単位は値をそのまま返す', () => {
  assert.equal(convertWeight(99.9, 'kg', 'kg'), 99.9);
});

test('重さ: 1キログラム = 1000グラム', () => {
  closeTo(convertWeight(1, 'kg', 'g'), 1000);
});

test('重さ: 1ポンド = 453.59237グラム（定義値）', () => {
  closeTo(convertWeight(1, 'lb', 'g'), 453.59237);
});

test('重さ: 1オンス = 28.349523125グラム（定義値）', () => {
  closeTo(convertWeight(1, 'oz', 'g'), 28.349523125);
});

test('重さ: 1ポンド = 16オンス', () => {
  closeTo(convertWeight(1, 'lb', 'oz'), 16, 1e-6);
});

test('重さ: グラム→ポンド→グラムの往復で誤差が小さい', () => {
  const original = 1000;
  const roundTrip = convertWeight(convertWeight(original, 'g', 'lb'), 'lb', 'g');
  closeTo(roundTrip, original, 1e-6);
});

// --- 温度 ---

test('温度: 摂氏0度 = 華氏32度 = ケルビン273.15', () => {
  closeTo(convertTemperature(0, 'c', 'f'), 32);
  closeTo(convertTemperature(0, 'c', 'k'), 273.15);
  closeTo(convertTemperature(32, 'f', 'c'), 0);
  closeTo(convertTemperature(273.15, 'k', 'c'), 0);
});

test('温度: 摂氏100度 = 華氏212度', () => {
  closeTo(convertTemperature(100, 'c', 'f'), 212);
});

test('温度: 絶対零度（摂氏-273.15度）はケルビン0', () => {
  closeTo(convertTemperature(-273.15, 'c', 'k'), 0);
});

test('温度: 華氏からケルビンへの直接変換', () => {
  // 華氏32度（=摂氏0度）はケルビン273.15
  closeTo(convertTemperature(32, 'f', 'k'), 273.15);
});

test('温度: 同一単位は値をそのまま返す', () => {
  assert.equal(convertTemperature(37.5, 'c', 'c'), 37.5);
});

test('温度: 摂氏→華氏→摂氏の往復で誤差が小さい', () => {
  const original = -40; // 摂氏-40度は華氏-40度と一致する有名な交点
  const roundTrip = convertTemperature(convertTemperature(original, 'c', 'f'), 'f', 'c');
  closeTo(roundTrip, original, 1e-9);
  closeTo(convertTemperature(original, 'c', 'f'), original, 1e-9); // -40℃ = -40℉
});

// --- 丸め表示 ---

test('roundForDisplay: 有効桁数で丸める', () => {
  assert.equal(roundForDisplay(1 / 3, 4), 0.3333);
  assert.equal(roundForDisplay(123456.789, 6), 123457);
});

test('roundForDisplay: 0はそのまま0', () => {
  assert.equal(roundForDisplay(0), 0);
});

test('roundForDisplay: 浮動小数点誤差を丸めで吸収できる', () => {
  const messy = 0.1 + 0.2; // 0.30000000000000004
  assert.equal(roundForDisplay(messy, 6), 0.3);
});
