/**
 * 標準5フィールドcron式のパーサと次回実行時刻の算出。
 *
 * 対応構文: `*` / `*\/n` / `a` / `a-b` / `a-b/n` / `a/n` / カンマ区切り
 * 曜日は 0=日曜、7 も日曜として受け付ける。月・曜日の英語3文字略称にも対応。
 *
 * 非対応（意図的）: `L` `W` `#` `?` などのVixie/Quartz拡張、秒フィールド、@yearly等のエイリアス。
 * これらは実装系によって意味が異なるため、扱わないことを明示する。
 */

export type CronField = {
  /** マッチする値の集合 */
  values: Set<number>;
  /** `*` そのもの（制限なし）か。day-of-month と day-of-week のOR判定に使う */
  unrestricted: boolean;
};

export type ParsedCron = {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
};

export class CronParseError extends Error {
  /** エラーが発生したフィールドの位置（0始まり）。式全体のエラーなら -1 */
  readonly fieldIndex: number;

  constructor(message: string, fieldIndex: number = -1) {
    super(message);
    this.name = 'CronParseError';
    this.fieldIndex = fieldIndex;
  }
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DOW_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

const FIELD_LABELS = ['分', '時', '日', '月', '曜日'] as const;

type FieldSpec = {
  min: number;
  max: number;
  names?: Record<string, number>;
  /** パース後に値を正規化する（曜日の 7→0 など） */
  normalize?: (n: number) => number;
};

const FIELD_SPECS: FieldSpec[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12, names: MONTH_NAMES },
  { min: 0, max: 7, names: DOW_NAMES, normalize: (n) => (n === 7 ? 0 : n) },
];

/** 単一の値（数値または英語略称）を解釈する */
function parseValue(token: string, spec: FieldSpec, fieldIndex: number): number {
  const named = spec.names?.[token.toLowerCase()];
  if (named !== undefined) return named;

  if (!/^\d+$/.test(token)) {
    throw new CronParseError(
      `${FIELD_LABELS[fieldIndex]}フィールドの "${token}" を解釈できません`,
      fieldIndex,
    );
  }
  const n = Number(token);
  if (n < spec.min || n > spec.max) {
    throw new CronParseError(
      `${FIELD_LABELS[fieldIndex]}フィールドの "${token}" が範囲外です（${spec.min}〜${spec.max}）`,
      fieldIndex,
    );
  }
  return n;
}

/** 1フィールド分の指定をパースして、マッチする値の集合にする */
export function parseField(raw: string, fieldIndex: number): CronField {
  const spec = FIELD_SPECS[fieldIndex];
  const values = new Set<number>();
  let unrestricted = false;

  for (const part of raw.split(',')) {
    if (part === '') {
      throw new CronParseError(
        `${FIELD_LABELS[fieldIndex]}フィールドに空の項目があります`,
        fieldIndex,
      );
    }

    // ステップ（/n）の切り出し
    const slashIndex = part.indexOf('/');
    const rangePart = slashIndex === -1 ? part : part.slice(0, slashIndex);
    const stepPart = slashIndex === -1 ? null : part.slice(slashIndex + 1);

    let step = 1;
    if (stepPart !== null) {
      if (!/^\d+$/.test(stepPart) || Number(stepPart) === 0) {
        throw new CronParseError(
          `${FIELD_LABELS[fieldIndex]}フィールドのステップ "/${stepPart}" が不正です（1以上の整数）`,
          fieldIndex,
        );
      }
      step = Number(stepPart);
    }

    let start: number;
    let end: number;

    if (rangePart === '*') {
      start = spec.min;
      end = spec.max;
      if (step === 1) unrestricted = true;
    } else {
      const dashIndex = rangePart.indexOf('-');
      if (dashIndex > 0) {
        start = parseValue(rangePart.slice(0, dashIndex), spec, fieldIndex);
        end = parseValue(rangePart.slice(dashIndex + 1), spec, fieldIndex);
        if (start > end) {
          throw new CronParseError(
            `${FIELD_LABELS[fieldIndex]}フィールドの範囲 "${rangePart}" は開始値が終了値より大きいです`,
            fieldIndex,
          );
        }
      } else {
        start = parseValue(rangePart, spec, fieldIndex);
        // `a/n` は a から最大値までを n 刻み（`a` 単体なら a のみ）
        end = stepPart !== null ? spec.max : start;
      }
    }

    for (let v = start; v <= end; v += step) {
      values.add(spec.normalize ? spec.normalize(v) : v);
    }
  }

  if (values.size === 0) {
    throw new CronParseError(
      `${FIELD_LABELS[fieldIndex]}フィールドにマッチする値がありません`,
      fieldIndex,
    );
  }

  return { values, unrestricted };
}

/** cron式全体をパースする */
export function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/);

  if (expression.trim() === '') {
    throw new CronParseError('cron式が空です');
  }
  if (fields.length !== 5) {
    throw new CronParseError(
      `フィールドが${fields.length}個です。標準cronは5個（分 時 日 月 曜日）です`,
    );
  }
  for (const f of fields) {
    if (/[LW#?]/i.test(f)) {
      throw new CronParseError(
        `"${f}" に拡張構文（L / W / # / ?）が含まれています。このツールは標準cronのみ対応です`,
      );
    }
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields.map((f, i) => parseField(f, i));
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

/**
 * 指定時刻がcron式にマッチするか。
 *
 * 日の判定は標準cronの仕様に従う: 日(dom)と曜日(dow)の**両方**が制限されている場合は
 * OR条件（どちらかに一致すれば実行）。片方だけ制限されている場合はその条件のみ。
 * この挙動は直感に反するため、多くの簡易ツールが間違えるポイント。
 */
export function matches(cron: ParsedCron, date: Date): boolean {
  if (!cron.minute.values.has(date.getMinutes())) return false;
  if (!cron.hour.values.has(date.getHours())) return false;
  if (!cron.month.values.has(date.getMonth() + 1)) return false;

  const domMatch = cron.dayOfMonth.values.has(date.getDate());
  const dowMatch = cron.dayOfWeek.values.has(date.getDay());
  const domRestricted = !cron.dayOfMonth.unrestricted;
  const dowRestricted = !cron.dayOfWeek.unrestricted;

  if (domRestricted && dowRestricted) return domMatch || dowMatch;
  if (domRestricted) return domMatch;
  if (dowRestricted) return dowMatch;
  return true;
}

/**
 * 次に実行される時刻を count 件返す。
 *
 * 分単位で前方走査する。走査上限に達した場合は見つかった分だけを返す
 * （例: `0 0 30 2 *` = 2月30日 は永久に来ないため 0 件）。
 */
export function nextRuns(cron: ParsedCron, from: Date, count = 5): Date[] {
  const results: Date[] = [];
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  // 4年分の分数（うるう年を確実に含む上限）
  const maxIterations = 4 * 366 * 24 * 60;

  for (let i = 0; i < maxIterations && results.length < count; i++) {
    if (matches(cron, cursor)) results.push(new Date(cursor.getTime()));
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return results;
}

/** 値の集合を「1,2,3」「1〜5」のように読みやすくまとめる */
function summarizeValues(values: Set<number>, format: (n: number) => string = String): string {
  const sorted = [...values].sort((a, b) => a - b);
  const chunks: string[] = [];
  let runStart = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i <= sorted.length; i++) {
    const current = sorted[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    chunks.push(
      runStart === prev
        ? format(runStart)
        : `${format(runStart)}〜${format(prev)}`,
    );
    runStart = current;
    prev = current;
  }

  return chunks.join('、');
}

const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

/** cron式を日本語の説明文にする */
export function describeCron(cron: ParsedCron): string {
  const parts: string[] = [];

  // 月
  if (!cron.month.unrestricted) {
    parts.push(`${summarizeValues(cron.month.values, (n) => `${n}月`)}の`);
  }

  // 日 / 曜日
  const domRestricted = !cron.dayOfMonth.unrestricted;
  const dowRestricted = !cron.dayOfWeek.unrestricted;
  const domText = summarizeValues(cron.dayOfMonth.values, (n) => `${n}日`);
  const dowText = `${summarizeValues(cron.dayOfWeek.values, (n) => DOW_JA[n])}曜日`;

  if (domRestricted && dowRestricted) {
    parts.push(`${domText} または ${dowText}（cronの仕様上OR条件）に`);
  } else if (domRestricted) {
    parts.push(`${domText}に`);
  } else if (dowRestricted) {
    parts.push(`${dowText}に`);
  } else {
    parts.push('毎日');
  }

  // 時刻
  const hourAll = cron.hour.unrestricted;
  const minuteAll = cron.minute.unrestricted;

  if (hourAll && minuteAll) {
    parts.push('毎分');
  } else if (hourAll) {
    parts.push(`毎時${summarizeValues(cron.minute.values, (n) => `${n}分`)}`);
  } else if (minuteAll) {
    parts.push(`${summarizeValues(cron.hour.values, (n) => `${n}時`)}の毎分`);
  } else {
    parts.push(
      `${summarizeValues(cron.hour.values, (n) => `${n}時`)}${summarizeValues(cron.minute.values, (n) => `${n}分`)}`,
    );
  }

  return `${parts.join('')}に実行`;
}
