import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  guessUnit,
  toMilliseconds,
  parseTimestamp,
  parseDateTime,
  formatRelative,
  TimestampParseError,
} from './timestamp.ts';

test('guessUnit: 秒とミリ秒の判定境界（1e12未満は秒、以上はミリ秒）', () => {
  assert.equal(guessUnit(1_700_000_000), 'seconds'); // 現実的な秒表記
  assert.equal(guessUnit(999_999_999_999), 'seconds'); // 境界のすぐ下
  assert.equal(guessUnit(1_000_000_000_000), 'milliseconds'); // 境界ちょうど
  assert.equal(guessUnit(1_700_000_000_000), 'milliseconds'); // 現実的なミリ秒表記
});

test('guessUnit: 負の値も絶対値で判定する', () => {
  assert.equal(guessUnit(-999_999_999_999), 'seconds');
  assert.equal(guessUnit(-1_000_000_000_000), 'milliseconds');
});

test('toMilliseconds: 単位を指定した場合はそれに従う', () => {
  assert.equal(toMilliseconds(1000, 'seconds'), 1_000_000);
  assert.equal(toMilliseconds(1000, 'milliseconds'), 1000);
});

test('toMilliseconds: 不正な数値はエラー', () => {
  assert.throws(() => toMilliseconds(NaN), TimestampParseError);
  assert.throws(() => toMilliseconds(Infinity), TimestampParseError);
});

test('parseTimestamp: 秒表記の既知の値（2001-09-09 01:46:40 UTC = 1000000000）', () => {
  const result = parseTimestamp('1000000000');
  assert.equal(result.unit, 'seconds');
  assert.equal(result.epochSeconds, 1_000_000_000);
  assert.equal(result.iso8601, '2001-09-09T01:46:40.000Z');
});

test('parseTimestamp: ミリ秒表記の既知の値', () => {
  const result = parseTimestamp('1000000000000');
  assert.equal(result.unit, 'milliseconds');
  assert.equal(result.iso8601, '2001-09-09T01:46:40.000Z');
});

test('parseTimestamp: unit を明示指定すると自動判定より優先される', () => {
  // 桁数だけ見ると秒に見える小さい値でも、ミリ秒として明示すればそう扱う
  const result = parseTimestamp('1000', 'milliseconds');
  assert.equal(result.unit, 'milliseconds');
  assert.equal(result.epochSeconds, 1);
});

test('parseTimestamp: 負のタイムスタンプ（1970年より前）', () => {
  const result = parseTimestamp('-86400'); // 1969-12-31
  assert.equal(result.iso8601, '1969-12-31T00:00:00.000Z');
});

test('parseTimestamp: 空文字列や数値でない入力はエラー', () => {
  assert.throws(() => parseTimestamp(''), TimestampParseError);
  assert.throws(() => parseTimestamp('   '), TimestampParseError);
  assert.throws(() => parseTimestamp('abc'), TimestampParseError);
  assert.throws(() => parseTimestamp('12.34.56'), TimestampParseError);
});

test('parseTimestamp: 小数のタイムスタンプも扱える', () => {
  const result = parseTimestamp('1000000000.5');
  assert.equal(result.epochMilliseconds, 1_000_000_000_500);
});

test('parseDateTime: ISO 8601文字列からタイムスタンプを計算', () => {
  const result = parseDateTime('2001-09-09T01:46:40.000Z');
  assert.equal(result.epochSeconds, 1_000_000_000);
});

test('parseDateTime: 不正な日時文字列はエラー', () => {
  assert.throws(() => parseDateTime(''), TimestampParseError);
  assert.throws(() => parseDateTime('not a date'), TimestampParseError);
});

test('往復変換: 日時→タイムスタンプ→日時が一致する', () => {
  const original = '2026-03-15T12:34:56.000Z';
  const { epochSeconds } = parseDateTime(original);
  const back = parseTimestamp(String(epochSeconds));
  assert.equal(back.iso8601, original);
});

test('formatRelative: 過去と未来を区別する', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const future = new Date('2026-01-01T03:00:00Z');
  const past = new Date('2025-12-31T21:00:00Z');
  assert.equal(formatRelative(future, now), '3時間後');
  assert.equal(formatRelative(past, now), '3時間前');
});

test('formatRelative: 直近（10秒未満）は「たった今」', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const almostNow = new Date('2026-01-01T00:00:05Z');
  assert.equal(formatRelative(almostNow, now), 'たった今');
});

test('formatRelative: 年単位の差', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const twoYearsLater = new Date('2028-01-01T00:00:00Z');
  assert.equal(formatRelative(twoYearsLater, now), '2年後');
});

test('タイムゾーンをまたぐ変換でも日付がずれない（UTC表示は常にUTC基準）', () => {
  // UTCで日付が変わる瞬間のタイムスタンプ
  const result = parseTimestamp('1704067199'); // 2023-12-31T23:59:59Z
  assert.ok(result.utc.startsWith('2023-12-31'));
  const result2 = parseTimestamp('1704067200'); // 2024-01-01T00:00:00Z
  assert.ok(result2.utc.startsWith('2024-01-01'));
});
