/**
 * Unixタイムスタンプと日時の相互変換ロジック。
 *
 * 「秒」と「ミリ秒」の混同はこの分野で頻発するバグの筆頭であり、
 * このツールの主な存在理由でもある。自動判定は行うが、その根拠を明示する。
 */

export class TimestampParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimestampParseError';
  }
}

export type TimestampUnit = 'seconds' | 'milliseconds';

/**
 * 数値が秒表記かミリ秒表記かを桁数から推定する。
 *
 * 判定の根拠: 2001-09-09 を過ぎると、Unix秒は10桁になる（2001年9月9日 01:46:40 UTC
 * が秒表記で 1000000000）。ミリ秒表記は同じ日時が 1000000000000（13桁）になる。
 * したがって「10桁以下は秒、13桁前後はミリ秒」という桁数ベースの判定が実用上機能する。
 * 閾値は 1e12（1兆）とし、これ未満なら秒、以上ならミリ秒とみなす。
 * 1e12 を秒として解釈すると西暦33658年相当になり非現実的なため、この閾値は
 * 現実的な日時範囲（およそ紀元前29719年〜西暦33658年をミリ秒として解釈する範囲）では
 * 誤判定しない。ただし1970年に極めて近い日時（数ヶ月以内）を秒表記で渡すと、
 * 値が小さすぎてミリ秒と誤判定される可能性があるという限界がある。
 */
export function guessUnit(value: number): TimestampUnit {
  return Math.abs(value) < 1e12 ? 'seconds' : 'milliseconds';
}

/**
 * タイムスタンプ（秒またはミリ秒）をミリ秒に正規化する。
 * unit を省略すると `guessUnit` で自動判定する。
 */
export function toMilliseconds(value: number, unit?: TimestampUnit): number {
  if (!Number.isFinite(value)) {
    throw new TimestampParseError('数値として解釈できません');
  }
  const resolvedUnit = unit ?? guessUnit(value);
  return resolvedUnit === 'seconds' ? value * 1000 : value;
}

export type TimestampResult = {
  /** 判定（または指定）に使われた単位 */
  unit: TimestampUnit;
  epochSeconds: number;
  epochMilliseconds: number;
  utc: string;
  local: string;
  iso8601: string;
  relative: string;
};

/**
 * タイムスタンプ文字列を受け取り、複数形式での表現をまとめて返す。
 * unit を指定しない場合は自動判定する。
 */
export function parseTimestamp(input: string, unit?: TimestampUnit, now: Date = new Date()): TimestampResult {
  const trimmed = input.trim();
  if (trimmed === '') {
    throw new TimestampParseError('タイムスタンプを入力してください');
  }
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new TimestampParseError('数値のタイムスタンプを入力してください（秒またはミリ秒）');
  }

  const value = Number(trimmed);
  const resolvedUnit = unit ?? guessUnit(value);
  const ms = toMilliseconds(value, resolvedUnit);
  const date = new Date(ms);

  if (Number.isNaN(date.getTime())) {
    throw new TimestampParseError('日時として扱える範囲を超えています');
  }

  return {
    unit: resolvedUnit,
    epochSeconds: ms / 1000,
    epochMilliseconds: ms,
    utc: formatUtc(date),
    local: formatLocal(date),
    iso8601: date.toISOString(),
    relative: formatRelative(date, now),
  };
}

/** 日時文字列（ISO 8601など、Dateコンストラクタが解釈できる形式）からタイムスタンプを計算する */
export function parseDateTime(input: string): { epochSeconds: number; epochMilliseconds: number } {
  const trimmed = input.trim();
  if (trimmed === '') {
    throw new TimestampParseError('日時を入力してください');
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new TimestampParseError('日時として解釈できません（例: 2026-01-01T00:00:00Z）');
  }
  return { epochSeconds: date.getTime() / 1000, epochMilliseconds: date.getTime() };
}

function pad(n: number, width = 2): string {
  return String(Math.trunc(n)).padStart(width, '0');
}

function formatUtc(date: Date): string {
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`
  );
}

function formatLocal(date: Date): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} (${tz})`
  );
}

/** 「3時間前」「5日後」のような相対時刻表現を作る */
export function formatRelative(date: Date, now: Date = new Date()): string {
  const diffMs = date.getTime() - now.getTime();
  const diffSec = diffMs / 1000;
  const abs = Math.abs(diffSec);

  const units: { unit: string; seconds: number }[] = [
    { unit: '年', seconds: 365 * 24 * 3600 },
    { unit: 'か月', seconds: 30 * 24 * 3600 },
    { unit: '日', seconds: 24 * 3600 },
    { unit: '時間', seconds: 3600 },
    { unit: '分', seconds: 60 },
  ];

  if (abs < 10) return 'たった今';

  for (const { unit, seconds } of units) {
    if (abs >= seconds) {
      const count = Math.floor(abs / seconds);
      return diffSec >= 0 ? `${count}${unit}後` : `${count}${unit}前`;
    }
  }

  const count = Math.floor(abs);
  return diffSec >= 0 ? `${count}秒後` : `${count}秒前`;
}

/** 現在時刻のタイムスタンプ（秒・ミリ秒）を返す薄いラッパー */
export function now(): { epochSeconds: number; epochMilliseconds: number } {
  const ms = Date.now();
  return { epochSeconds: ms / 1000, epochMilliseconds: ms };
}
