/**
 * 単位変換ロジック（長さ・重さ・温度）。
 *
 * 長さと重さは「基準単位への係数」を1つ持つだけで、任意の単位間を
 * 変換元→基準単位→変換先の2段階で変換できる（線形変換のため）。
 * 温度だけは摂氏・華氏・ケルビンで原点（0の位置）がずれているため、
 * 係数を掛けるだけでは変換できず、専用の変換式が必要になる。
 */

export type LengthUnit = 'm' | 'cm' | 'mm' | 'km' | 'in' | 'ft' | 'yd' | 'mi';
export type WeightUnit = 'g' | 'kg' | 'mg' | 'lb' | 'oz';
export type TemperatureUnit = 'c' | 'f' | 'k';

export const LENGTH_UNITS: { key: LengthUnit; label: string }[] = [
  { key: 'm', label: 'メートル (m)' },
  { key: 'cm', label: 'センチメートル (cm)' },
  { key: 'mm', label: 'ミリメートル (mm)' },
  { key: 'km', label: 'キロメートル (km)' },
  { key: 'in', label: 'インチ (in)' },
  { key: 'ft', label: 'フィート (ft)' },
  { key: 'yd', label: 'ヤード (yd)' },
  { key: 'mi', label: 'マイル (mi)' },
];

export const WEIGHT_UNITS: { key: WeightUnit; label: string }[] = [
  { key: 'g', label: 'グラム (g)' },
  { key: 'kg', label: 'キログラム (kg)' },
  { key: 'mg', label: 'ミリグラム (mg)' },
  { key: 'lb', label: 'ポンド (lb)' },
  { key: 'oz', label: 'オンス (oz)' },
];

export const TEMPERATURE_UNITS: { key: TemperatureUnit; label: string }[] = [
  { key: 'c', label: '摂氏 (°C)' },
  { key: 'f', label: '華氏 (°F)' },
  { key: 'k', label: 'ケルビン (K)' },
];

// 基準単位（メートル / グラム）への換算係数。値はすべて定義値（正確な定数）。
const LENGTH_TO_METERS: Record<LengthUnit, number> = {
  m: 1,
  cm: 0.01,
  mm: 0.001,
  km: 1000,
  in: 0.0254,
  ft: 0.3048,
  yd: 0.9144,
  mi: 1609.344,
};

const WEIGHT_TO_GRAMS: Record<WeightUnit, number> = {
  g: 1,
  kg: 1000,
  mg: 0.001,
  lb: 453.59237,
  oz: 28.349523125,
};

/**
 * 長さを変換する。同一単位の場合は係数計算による誤差を避けるため、値をそのまま返す。
 */
export function convertLength(value: number, from: LengthUnit, to: LengthUnit): number {
  if (from === to) return value;
  const meters = value * LENGTH_TO_METERS[from];
  return meters / LENGTH_TO_METERS[to];
}

/** 重さを変換する。同一単位の場合は値をそのまま返す。 */
export function convertWeight(value: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return value;
  const grams = value * WEIGHT_TO_GRAMS[from];
  return grams / WEIGHT_TO_GRAMS[to];
}

/**
 * 温度を変換する。摂氏・華氏・ケルビンは原点が異なるため係数方式は使えず、
 * 一度すべて摂氏に変換してから目的の単位に変換する2段階の専用ロジックにする。
 * ケルビンは絶対温度（0K=絶対零度=摂氏-273.15度）なので、摂氏との関係は
 * 単なる平行移動（+273.15）であり係数は不要。華氏は摂氏に対して
 * 傾き(9/5)と切片(32)の両方を持つ一次式になる。
 */
export function convertTemperature(value: number, from: TemperatureUnit, to: TemperatureUnit): number {
  if (from === to) return value;

  let celsius: number;
  switch (from) {
    case 'c':
      celsius = value;
      break;
    case 'f':
      celsius = ((value - 32) * 5) / 9;
      break;
    case 'k':
      celsius = value - 273.15;
      break;
  }

  switch (to) {
    case 'c':
      return celsius;
    case 'f':
      return (celsius * 9) / 5 + 32;
    case 'k':
      return celsius + 273.15;
  }
}

/**
 * 表示用に有効桁数を丸める。変換関数自体は丸めない生の値を返すため、
 * UI表示や見やすさが必要な場面ではこちらを使う。
 *
 * `toPrecision` を使い、浮動小数点演算の誤差（例: 0.1 + 0.2 の類の桁溢れ）を
 * 表示上吸収する。指数表記になったケースも `Number()` で通常の数値に戻す。
 */
export function roundForDisplay(value: number, significantDigits = 6): number {
  if (!Number.isFinite(value)) return value;
  if (value === 0) return 0;
  return Number(value.toPrecision(significantDigits));
}
