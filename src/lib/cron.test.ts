import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCron, matches, nextRuns, describeCron, CronParseError } from './cron.ts';

test('* * * * * は全フィールド無制限', () => {
  const c = parseCron('* * * * *');
  assert.equal(c.minute.unrestricted, true);
  assert.equal(c.dayOfMonth.unrestricted, true);
  assert.equal(c.dayOfWeek.unrestricted, true);
  assert.equal(c.minute.values.size, 60);
  assert.equal(c.hour.values.size, 24);
});

test('*/15 はステップ展開される', () => {
  const c = parseCron('*/15 * * * *');
  assert.deepEqual([...c.minute.values].sort((a, b) => a - b), [0, 15, 30, 45]);
  // ステップ付きの * は「無制限」ではない
  assert.equal(c.minute.unrestricted, false);
});

test('範囲・カンマ・範囲ステップの併用', () => {
  const c = parseCron('0 9-17/4,22 * * *');
  assert.deepEqual([...c.hour.values].sort((a, b) => a - b), [9, 13, 17, 22]);
});

test('a/n は a から最大値まで', () => {
  const c = parseCron('5/20 * * * *');
  assert.deepEqual([...c.minute.values].sort((a, b) => a - b), [5, 25, 45]);
});

test('曜日の 7 は 0（日曜）に正規化される', () => {
  const c = parseCron('0 0 * * 7');
  assert.deepEqual([...c.dayOfWeek.values], [0]);
});

test('月・曜日の英語略称を解釈する', () => {
  const c = parseCron('0 0 * JAN-mar FRI');
  assert.deepEqual([...c.month.values].sort((a, b) => a - b), [1, 2, 3]);
  assert.deepEqual([...c.dayOfWeek.values], [5]);
});

test('日と曜日が両方指定されたときはOR条件（標準cronの仕様）', () => {
  const c = parseCron('0 0 1 * 1'); // 毎月1日 または 毎週月曜
  // 2026-06-01 は月曜（両方一致）
  assert.equal(matches(c, new Date(2026, 5, 1, 0, 0)), true);
  // 2026-06-08 は月曜だが1日ではない → 一致
  assert.equal(matches(c, new Date(2026, 5, 8, 0, 0)), true);
  // 2026-07-01 は水曜だが1日 → 一致
  assert.equal(matches(c, new Date(2026, 6, 1, 0, 0)), true);
  // 2026-06-09 は火曜で1日でもない → 不一致
  assert.equal(matches(c, new Date(2026, 5, 9, 0, 0)), false);
});

test('日のみ指定なら曜日は無視される', () => {
  const c = parseCron('0 0 15 * *');
  assert.equal(matches(c, new Date(2026, 5, 15, 0, 0)), true); // 15日(月曜)
  assert.equal(matches(c, new Date(2026, 5, 16, 0, 0)), false);
});

test('曜日のみ指定なら日は無視される', () => {
  const c = parseCron('30 9 * * 1');
  assert.equal(matches(c, new Date(2026, 5, 1, 9, 30)), true); // 月曜
  assert.equal(matches(c, new Date(2026, 5, 2, 9, 30)), false); // 火曜
});

test('nextRuns は指定時刻より後の時刻を返す', () => {
  const c = parseCron('0 9 * * 1'); // 毎週月曜9:00
  const from = new Date(2026, 5, 3, 12, 0); // 2026-06-03(水) 12:00
  const runs = nextRuns(c, from, 3);
  assert.equal(runs.length, 3);
  assert.deepEqual(
    runs.map((d) => [d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]),
    [
      [6, 8, 9, 0],
      [6, 15, 9, 0],
      [6, 22, 9, 0],
    ],
  );
  for (const r of runs) assert.ok(r > from);
});

test('nextRuns は from と同じ分を含めない', () => {
  const c = parseCron('* * * * *');
  const from = new Date(2026, 5, 3, 12, 0, 30);
  const runs = nextRuns(c, from, 1);
  assert.equal(runs[0].getMinutes(), 1);
  assert.equal(runs[0].getHours(), 12);
});

test('到達しない式は空配列を返す（2月30日）', () => {
  const c = parseCron('0 0 30 2 *');
  assert.deepEqual(nextRuns(c, new Date(2026, 0, 1), 3), []);
});

test('うるう日 2月29日は4年先まで走査して見つかる', () => {
  const c = parseCron('0 0 29 2 *');
  const runs = nextRuns(c, new Date(2026, 0, 1), 1);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].getFullYear(), 2028);
  assert.equal(runs[0].getMonth() + 1, 2);
  assert.equal(runs[0].getDate(), 29);
});

test('フィールド数が5でなければエラー', () => {
  assert.throws(() => parseCron('* * * *'), CronParseError);
  assert.throws(() => parseCron('* * * * * *'), CronParseError);
  assert.throws(() => parseCron('   '), CronParseError);
});

test('範囲外の値はエラー', () => {
  assert.throws(() => parseCron('60 * * * *'), /範囲外/);
  assert.throws(() => parseCron('* 24 * * *'), /範囲外/);
  assert.throws(() => parseCron('* * 0 * *'), /範囲外/);
  assert.throws(() => parseCron('* * * 13 *'), /範囲外/);
  assert.throws(() => parseCron('* * * * 8'), /範囲外/);
});

test('不正な構文はエラー', () => {
  assert.throws(() => parseCron('a * * * *'), /解釈できません/);
  assert.throws(() => parseCron('*/0 * * * *'), /ステップ/);
  assert.throws(() => parseCron('5-1 * * * *'), /開始値/);
  assert.throws(() => parseCron('1,,2 * * * *'), /空の項目/);
});

test('拡張構文は明示的に拒否する', () => {
  assert.throws(() => parseCron('0 0 L * *'), /拡張構文/);
  assert.throws(() => parseCron('0 0 ? * MON#1'), /拡張構文/);
});

test('describeCron が読みやすい日本語を返す', () => {
  assert.equal(describeCron(parseCron('* * * * *')), '毎日毎分に実行');
  assert.equal(describeCron(parseCron('*/15 * * * *')), '毎日毎時0分、15分、30分、45分に実行');
  assert.equal(describeCron(parseCron('0 9 * * 1')), '月曜日に9時0分に実行');
  assert.equal(describeCron(parseCron('30 2 1 * *')), '1日に2時30分に実行');
  // 連続値は範囲にまとめる
  assert.equal(describeCron(parseCron('0 9 * * 1-5')), '月〜金曜日に9時0分に実行');
  // OR条件は説明文でも明示する
  assert.match(describeCron(parseCron('0 0 1 * 1')), /OR条件/);
});
