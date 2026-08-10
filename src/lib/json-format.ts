/**
 * JSON整形・検証ロジック。
 *
 * `JSON.parse` のエラーメッセージから行番号・列番号を抜き出す実装は避けている。
 * メッセージの書式はJSエンジンによって異なり（例: "position N" が入るかどうか）、
 * 正規表現で抜き出す方式は将来のエンジン変更や非対応エンジンで静かに壊れる。
 * 代わりに、このファイルでは最小限の再帰下降パーサを自前で実装し、
 * どんな構文エラーでも常に正確な行・列を返せるようにしている。
 *
 * 副産物として、重複キーの検出も「文字列中の紛らわしい文字列を誤検出する」
 * リスクなしに正しく行える（正規表現ベースの重複検出だと
 * `{"note": "\"key\": is a tricky value"}` のようなケースを誤検出しやすい）。
 */

export type JsonPosition = {
  line: number;
  column: number;
  offset: number;
};

export class JsonSyntaxError extends Error {
  readonly position: JsonPosition;

  constructor(message: string, position: JsonPosition) {
    super(message);
    this.name = 'JsonSyntaxError';
    this.position = position;
  }
}

export type DuplicateKeyInfo = {
  key: string;
  position: JsonPosition;
};

export type ParsedJson = {
  value: unknown;
  duplicates: DuplicateKeyInfo[];
};

function isWhitespace(c: string | undefined): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r';
}
function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '9';
}

class Parser {
  private readonly text: string;
  private pos = 0;
  private line = 1;
  private col = 1;

  constructor(text: string) {
    this.text = text;
  }

  private peek(): string | undefined {
    return this.text[this.pos];
  }

  private eof(): boolean {
    return this.pos >= this.text.length;
  }

  private advance(): string {
    const c = this.text[this.pos++];
    if (c === '\n') {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return c;
  }

  private advanceBy(n: number): void {
    for (let i = 0; i < n; i++) this.advance();
  }

  private currentPosition(): JsonPosition {
    return { line: this.line, column: this.col, offset: this.pos };
  }

  private fail(message: string, position?: JsonPosition): never {
    const pos = position ?? this.currentPosition();
    throw new JsonSyntaxError(`${message}（${pos.line}行目 ${pos.column}列目）`, pos);
  }

  private skipWhitespace(): void {
    while (!this.eof() && isWhitespace(this.peek())) this.advance();
  }

  parse(): ParsedJson {
    this.skipWhitespace();
    const duplicates: DuplicateKeyInfo[] = [];
    const value = this.parseValue(duplicates);
    this.skipWhitespace();
    if (!this.eof()) {
      this.fail(`JSONの終わりの後に余分な文字があります: "${this.peek()}"`);
    }
    return { value, duplicates };
  }

  private parseValue(duplicates: DuplicateKeyInfo[]): unknown {
    this.skipWhitespace();
    if (this.eof()) this.fail('値が必要ですが、入力がここで終わっています');

    const c = this.peek();
    if (c === '{') return this.parseObject(duplicates);
    if (c === '[') return this.parseArray(duplicates);
    if (c === '"') return this.parseString();
    if (c === '-' || isDigit(c)) return this.parseNumber();
    if (this.text.startsWith('true', this.pos)) {
      this.advanceBy(4);
      return true;
    }
    if (this.text.startsWith('false', this.pos)) {
      this.advanceBy(5);
      return false;
    }
    if (this.text.startsWith('null', this.pos)) {
      this.advanceBy(4);
      return null;
    }
    this.fail(`予期しない文字です: "${c}"`);
  }

  private parseObject(duplicates: DuplicateKeyInfo[]): Record<string, unknown> {
    this.advance(); // '{'
    const obj: Record<string, unknown> = {};
    const seenKeys = new Set<string>();

    this.skipWhitespace();
    if (this.peek() === '}') {
      this.advance();
      return obj;
    }

    for (;;) {
      this.skipWhitespace();
      if (this.peek() !== '"') this.fail('オブジェクトのキーは文字列（ダブルクォート）で囲む必要があります');

      const keyPosition = this.currentPosition();
      const key = this.parseString();
      if (seenKeys.has(key)) {
        duplicates.push({ key, position: keyPosition });
      }
      seenKeys.add(key);

      this.skipWhitespace();
      if (this.peek() !== ':') this.fail('キーの後に ":" が必要です');
      this.advance();
      this.skipWhitespace();

      obj[key] = this.parseValue(duplicates);

      this.skipWhitespace();
      const c = this.peek();
      if (c === ',') {
        this.advance();
        this.skipWhitespace();
        if (this.peek() === '}') this.fail('カンマの直後に "}" があります（末尾のカンマは使えません）');
        continue;
      }
      if (c === '}') {
        this.advance();
        break;
      }
      this.fail('"," または "}" が必要です');
    }

    return obj;
  }

  private parseArray(duplicates: DuplicateKeyInfo[]): unknown[] {
    this.advance(); // '['
    const arr: unknown[] = [];

    this.skipWhitespace();
    if (this.peek() === ']') {
      this.advance();
      return arr;
    }

    for (;;) {
      arr.push(this.parseValue(duplicates));
      this.skipWhitespace();
      const c = this.peek();
      if (c === ',') {
        this.advance();
        this.skipWhitespace();
        if (this.peek() === ']') this.fail('カンマの直後に "]" があります（末尾のカンマは使えません）');
        continue;
      }
      if (c === ']') {
        this.advance();
        break;
      }
      this.fail('"," または "]" が必要です');
    }

    return arr;
  }

  private parseString(): string {
    this.advance(); // opening quote
    let result = '';
    for (;;) {
      if (this.eof()) this.fail('文字列が閉じられていません（終端のダブルクォートがありません）');
      const c = this.advance();
      if (c === '"') break;

      if (c === '\\') {
        if (this.eof()) this.fail('文字列が閉じられていません');
        const esc = this.advance();
        switch (esc) {
          case '"':
            result += '"';
            break;
          case '\\':
            result += '\\';
            break;
          case '/':
            result += '/';
            break;
          case 'b':
            result += '\b';
            break;
          case 'f':
            result += '\f';
            break;
          case 'n':
            result += '\n';
            break;
          case 'r':
            result += '\r';
            break;
          case 't':
            result += '\t';
            break;
          case 'u': {
            let hex = '';
            for (let i = 0; i < 4; i++) {
              if (this.eof()) this.fail('不正なUnicodeエスケープです（\\uの後に4桁の16進数が必要）');
              hex += this.advance();
            }
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              this.fail(`不正なUnicodeエスケープです: \\u${hex}`);
            }
            result += String.fromCharCode(parseInt(hex, 16));
            break;
          }
          default:
            this.fail(`不正なエスケープシーケンスです: \\${esc}`);
        }
      } else if (c.charCodeAt(0) < 0x20) {
        this.fail('文字列中に制御文字が含まれています（\\nなどエスケープする必要があります）');
      } else {
        result += c;
      }
    }
    return result;
  }

  private parseNumber(): number {
    const start = this.pos;

    if (this.peek() === '-') this.advance();

    if (this.peek() === '0') {
      this.advance();
    } else if (isDigit(this.peek())) {
      while (isDigit(this.peek())) this.advance();
    } else {
      this.fail('不正な数値です');
    }

    if (this.peek() === '.') {
      this.advance();
      if (!isDigit(this.peek())) this.fail('小数点の後には数字が必要です');
      while (isDigit(this.peek())) this.advance();
    }

    if (this.peek() === 'e' || this.peek() === 'E') {
      this.advance();
      if (this.peek() === '+' || this.peek() === '-') this.advance();
      if (!isDigit(this.peek())) this.fail('指数表記の後には数字が必要です');
      while (isDigit(this.peek())) this.advance();
    }

    return Number(this.text.slice(start, this.pos));
  }
}

/**
 * JSON文字列をパースし、値と重複キーの一覧を返す。
 * 構文エラーの場合は行番号・列番号つきの `JsonSyntaxError` を投げる。
 */
export function parseJsonWithDetails(text: string): ParsedJson {
  return new Parser(text).parse();
}

/**
 * JSONを整形する。`indent` は半角スペースの数、または `"\t"` のような文字列。
 * 重複キーがあった場合は標準の `JSON.stringify` と同じく後勝ち（最後の値が残る）。
 */
export function formatJson(text: string, indent: number | string = 2): string {
  const { value } = parseJsonWithDetails(text);
  return JSON.stringify(value, null, indent);
}

/** JSONを1行にミニファイする */
export function minifyJson(text: string): string {
  const { value } = parseJsonWithDetails(text);
  return JSON.stringify(value);
}

export type ValidationResult =
  | { valid: true; duplicates: DuplicateKeyInfo[] }
  | { valid: false; message: string; position: JsonPosition };

/** JSONの妥当性を検証する。例外を投げず、結果オブジェクトで返す */
export function validateJson(text: string): ValidationResult {
  try {
    const { duplicates } = parseJsonWithDetails(text);
    return { valid: true, duplicates };
  } catch (err) {
    if (err instanceof JsonSyntaxError) {
      return { valid: false, message: err.message, position: err.position };
    }
    throw err;
  }
}
