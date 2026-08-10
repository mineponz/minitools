/**
 * 関数電卓の式パーサと評価。
 *
 * `eval` や `new Function` は使わない。入力はブラウザ内で完結するとはいえ、
 * 式を実行可能なコードとして扱うと想定外の文字列で任意のコードが動きうるうえ、
 * 「0で割った」「√に負の数を入れた」といった状態をJSの `Infinity` / `NaN` としてしか
 * 受け取れず、利用者に理由を説明できない。ここでは字句解析→再帰下降パーサ→評価の
 * 3段階を自前で持ち、どこで何が起きたかをエラーとして返せるようにしている。
 *
 * 演算子の優先順位（弱い順）:
 *   1. `+` `-`
 *   2. `*` `/`（および暗黙の掛け算）
 *   3. 単項の `-` `+`
 *   4. `^`（右結合。`2^3^2` は `2^(3^2)` = 512）
 *   5. 後置の `!` `%`
 *   6. 数値・定数・括弧・関数呼び出し
 *
 * 意図的に対応していないもの:
 *   - 変数の定義、複数引数の関数、対数の底指定（`log(2, 8)` のような書き方）
 *   - ラジアンモードでの `tan` の発散判定。度数法と違って「ちょうど90°」を
 *     浮動小数点で判定できないため、`tan(π/2)` は巨大な数をそのまま返す
 */

export type AngleMode = 'deg' | 'rad';

export type EvaluateOptions = {
  /** 三角関数の角度の単位。既定は度数法 */
  angleMode?: AngleMode;
  /** `Ans` が指す直前の答え。既定は0 */
  ans?: number;
};

export class CalcError extends Error {
  /** エラーが起きた入力文字列上の位置（0始まり）。位置を特定できない場合は -1 */
  readonly position: number;

  constructor(message: string, position: number = -1) {
    super(message);
    this.name = 'CalcError';
    this.position = position;
  }
}

// --- 字句解析 ---------------------------------------------------------------

type FunctionName = 'sin' | 'cos' | 'tan' | 'asin' | 'acos' | 'atan' | 'log' | 'ln' | 'sqrt';

type Token =
  | { kind: 'number'; value: number; position: number }
  | { kind: 'constant'; name: 'pi' | 'e'; position: number }
  | { kind: 'ans'; position: number }
  | { kind: 'function'; name: FunctionName; position: number }
  | { kind: 'operator'; op: '+' | '-' | '*' | '/' | '^'; position: number }
  | { kind: 'postfix'; op: '!' | '%'; position: number }
  | { kind: 'lparen'; position: number }
  | { kind: 'rparen'; position: number };

const FUNCTION_NAMES: Record<string, FunctionName> = {
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  asin: 'asin',
  arcsin: 'asin',
  acos: 'acos',
  arccos: 'acos',
  atan: 'atan',
  arctan: 'atan',
  log: 'log',
  ln: 'ln',
  sqrt: 'sqrt',
};

/**
 * 全角文字などを対応するASCIIに置き換える。1文字を1文字に置き換えるだけなので、
 * 変換後も文字位置が元の入力とずれず、エラー位置をそのまま利用者に示せる。
 * 日本語入力のまま数式を打つと全角になりがちなので、弾かずに受け入れる。
 */
const CHAR_ALIASES: Record<string, string> = {
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
  '．': '.', '，': ',', '　': ' ',
  '（': '(', '）': ')',
  '＋': '+',
  '－': '-', '−': '-', '–': '-', '—': '-', 'ー': '-',
  '×': '*', '＊': '*', '・': '*',
  '÷': '/', '／': '/',
  '％': '%', '！': '!', '＾': '^',
};

function normalize(input: string): string {
  let out = '';
  for (const ch of input) {
    // サロゲートペアは数式に現れないため、1文字ずつの置換で問題ない
    out += CHAR_ALIASES[ch] ?? ch;
  }
  return out;
}

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '9';
}

function isLetter(c: string | undefined): boolean {
  return c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'));
}

/**
 * 数値リテラルを読む。`1,234,567` のような3桁区切りのカンマは取り除く。
 * ただし「カンマの後にちょうど3桁の数字が続く」場合だけに限定しているので、
 * `1,5`（小数点のつもりのカンマ）は数値の一部とみなさず、その場で切れて構文エラーになる。
 */
function readNumber(text: string, start: number): { value: number; end: number } {
  let i = start;
  let literal = '';

  while (i < text.length) {
    const c = text[i];
    if (isDigit(c)) {
      literal += c;
      i += 1;
      continue;
    }
    if (c === ',' && isDigit(text[i - 1]) && /^\d{3}(?!\d)/.test(text.slice(i + 1))) {
      i += 1; // 3桁区切りとして読み飛ばす
      continue;
    }
    break;
  }

  if (text[i] === '.') {
    literal += '.';
    i += 1;
    while (isDigit(text[i])) {
      literal += text[i];
      i += 1;
    }
  }

  // 指数表記。`e` の後ろに数字が続くときだけ指数として扱い、
  // そうでなければ `2e` = 2 × 自然対数の底 と解釈できるよう `e` を残す。
  if ((text[i] === 'e' || text[i] === 'E') && literal !== '') {
    const signLength = text[i + 1] === '+' || text[i + 1] === '-' ? 1 : 0;
    if (isDigit(text[i + 1 + signLength])) {
      literal += 'e' + text.slice(i + 1, i + 1 + signLength);
      i += 1 + signLength;
      while (isDigit(text[i])) {
        literal += text[i];
        i += 1;
      }
    }
  }

  const value = Number(literal);
  if (literal === '' || literal === '.' || Number.isNaN(value)) {
    throw new CalcError('数値として読み取れません', start);
  }
  return { value, end: i };
}

function tokenize(input: string): Token[] {
  const text = normalize(input);
  const tokens: Token[] = [];
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (c === ' ' || c === '\t' || c === '\n') {
      i += 1;
      continue;
    }

    if (isDigit(c) || (c === '.' && isDigit(text[i + 1]))) {
      const { value, end } = readNumber(text, i);
      tokens.push({ kind: 'number', value, position: i });
      i = end;
      continue;
    }

    if (c === 'π') {
      tokens.push({ kind: 'constant', name: 'pi', position: i });
      i += 1;
      continue;
    }

    if (c === '√') {
      tokens.push({ kind: 'function', name: 'sqrt', position: i });
      i += 1;
      continue;
    }

    if (isLetter(c)) {
      let word = '';
      const start = i;
      while (isLetter(text[i])) {
        word += text[i];
        i += 1;
      }
      const lower = word.toLowerCase();
      if (lower === 'ans') {
        tokens.push({ kind: 'ans', position: start });
      } else if (lower === 'pi') {
        tokens.push({ kind: 'constant', name: 'pi', position: start });
      } else if (lower === 'e') {
        tokens.push({ kind: 'constant', name: 'e', position: start });
      } else if (FUNCTION_NAMES[lower]) {
        tokens.push({ kind: 'function', name: FUNCTION_NAMES[lower], position: start });
      } else {
        throw new CalcError(`「${word}」は使えません`, start);
      }
      continue;
    }

    if (c === '+' || c === '-' || c === '*' || c === '/' || c === '^') {
      tokens.push({ kind: 'operator', op: c, position: i });
      i += 1;
      continue;
    }

    if (c === '!' || c === '%') {
      tokens.push({ kind: 'postfix', op: c, position: i });
      i += 1;
      continue;
    }

    if (c === '(') {
      tokens.push({ kind: 'lparen', position: i });
      i += 1;
      continue;
    }

    if (c === ')') {
      tokens.push({ kind: 'rparen', position: i });
      i += 1;
      continue;
    }

    throw new CalcError(`「${input[i] ?? c}」は使えません`, i);
  }

  return tokens;
}

// --- 構文解析 ---------------------------------------------------------------

export type ExpressionNode =
  | { kind: 'number'; value: number }
  | { kind: 'constant'; name: 'pi' | 'e' }
  | { kind: 'ans' }
  | { kind: 'negate'; operand: ExpressionNode }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: ExpressionNode; right: ExpressionNode; position: number }
  | { kind: 'factorial'; operand: ExpressionNode; position: number }
  | { kind: 'percent'; operand: ExpressionNode; position: number }
  | { kind: 'call'; name: FunctionName; argument: ExpressionNode; position: number };

/**
 * 掛け算記号を省略できる位置かどうか。`2π` `3(4+5)` `2sin(30)` は掛け算とみなす。
 * 数値どうし（`2 3`）は打ち間違いの可能性が高いので、あえて掛け算とはみなさず
 * 構文エラーにする。
 */
function startsImplicitProduct(token: Token): boolean {
  return (
    token.kind === 'lparen' ||
    token.kind === 'constant' ||
    token.kind === 'ans' ||
    token.kind === 'function'
  );
}

class Parser {
  private readonly tokens: Token[];
  private readonly length: number;
  private pos = 0;

  constructor(tokens: Token[], length: number) {
    this.tokens = tokens;
    this.length = length;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token | undefined {
    const t = this.tokens[this.pos];
    this.pos += 1;
    return t;
  }

  /** 入力の末尾位置。「式が途中で終わっている」系のエラー位置に使う */
  private endPosition(): number {
    return this.length;
  }

  parse(): ExpressionNode {
    if (this.tokens.length === 0) {
      throw new CalcError('式を入力してください', 0);
    }
    const node = this.parseAdditive();
    const rest = this.peek();
    if (rest) {
      if (rest.kind === 'rparen') {
        throw new CalcError('対応する開き括弧がありません', rest.position);
      }
      throw new CalcError('式を読み切れませんでした', rest.position);
    }
    return node;
  }

  private parseAdditive(): ExpressionNode {
    let left = this.parseMultiplicative();
    for (;;) {
      const t = this.peek();
      if (t?.kind === 'operator' && (t.op === '+' || t.op === '-')) {
        this.next();
        const right = this.parseMultiplicative();
        left = { kind: 'binary', op: t.op, left, right, position: t.position };
        continue;
      }
      return left;
    }
  }

  private parseMultiplicative(): ExpressionNode {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t?.kind === 'operator' && (t.op === '*' || t.op === '/')) {
        this.next();
        const right = this.parseUnary();
        left = { kind: 'binary', op: t.op, left, right, position: t.position };
        continue;
      }
      if (t && startsImplicitProduct(t)) {
        const right = this.parseUnary();
        left = { kind: 'binary', op: '*', left, right, position: t.position };
        continue;
      }
      return left;
    }
  }

  private parseUnary(): ExpressionNode {
    const t = this.peek();
    if (t?.kind === 'operator' && (t.op === '-' || t.op === '+')) {
      this.next();
      const operand = this.parseUnary();
      return t.op === '-' ? { kind: 'negate', operand } : operand;
    }
    return this.parsePower();
  }

  private parsePower(): ExpressionNode {
    const base = this.parsePostfix();
    const t = this.peek();
    if (t?.kind === 'operator' && t.op === '^') {
      this.next();
      // 右結合にするため、指数側は再び単項式から読む（`2^-3` の単項マイナスもここで拾う）
      const exponent = this.parseUnary();
      return { kind: 'binary', op: '^', left: base, right: exponent, position: t.position };
    }
    return base;
  }

  private parsePostfix(): ExpressionNode {
    let node: ExpressionNode = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t?.kind !== 'postfix') return node;
      this.next();
      node =
        t.op === '!'
          ? { kind: 'factorial', operand: node, position: t.position }
          : { kind: 'percent', operand: node, position: t.position };
    }
  }

  private parsePrimary(): ExpressionNode {
    const t = this.next();
    if (!t) {
      throw new CalcError('式が途中で終わっています', this.endPosition());
    }

    switch (t.kind) {
      case 'number':
        return { kind: 'number', value: t.value };
      case 'constant':
        return { kind: 'constant', name: t.name };
      case 'ans':
        return { kind: 'ans' };
      case 'function': {
        // 括弧が無い場合は直後の単項式ひとつを引数にする（`√9+1` は `√9 + 1`）
        const argument = this.parseUnary();
        return { kind: 'call', name: t.name, argument, position: t.position };
      }
      case 'lparen': {
        const inner = this.parseAdditive();
        const close = this.peek();
        if (close?.kind !== 'rparen') {
          throw new CalcError('括弧が閉じていません', t.position);
        }
        this.next();
        return inner;
      }
      case 'rparen':
        throw new CalcError('対応する開き括弧がありません', t.position);
      case 'postfix':
        throw new CalcError(`「${t.op}」の前に数値がありません`, t.position);
      case 'operator':
        throw new CalcError(`「${t.op}」の使い方が正しくありません`, t.position);
    }
  }
}

export function parse(input: string): ExpressionNode {
  return new Parser(tokenize(input), input.length).parse();
}

// --- 評価 -------------------------------------------------------------------

/** 角度を0以上360未満に畳む。度数法での特異点判定に使う */
function mod360(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * 度数法の三角関数。`sin(180°)` を `1.2246e-16` ではなく `0` にするため、
 * 90°の倍数だけは計算せずに厳密な値を返す。丸め込みでごまかすのではなく
 * 特異点を明示的に列挙する形にしてある。
 */
function sinDegrees(degrees: number): number {
  const m = mod360(degrees);
  if (m === 0 || m === 180) return 0;
  if (m === 90) return 1;
  if (m === 270) return -1;
  return Math.sin((degrees * Math.PI) / 180);
}

function cosDegrees(degrees: number): number {
  const m = mod360(degrees);
  if (m === 90 || m === 270) return 0;
  if (m === 0) return 1;
  if (m === 180) return -1;
  return Math.cos((degrees * Math.PI) / 180);
}

function tanDegrees(degrees: number, position: number): number {
  const m = mod360(degrees);
  if (m === 90 || m === 270) {
    throw new CalcError('tan は 90°・270° など（90°+180°×n）では定義されません', position);
  }
  if (m === 0 || m === 180) return 0;
  return Math.tan((degrees * Math.PI) / 180);
}

function factorial(value: number, position: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new CalcError('階乗（!）は0以上の整数にしか使えません', position);
  }
  if (value > 170) {
    // 171! は倍精度浮動小数点で表せる範囲（約1.8e308）を超える
    throw new CalcError('階乗は170!までしか計算できません（それ以上は桁が大きすぎます）', position);
  }
  let result = 1;
  for (let i = 2; i <= value; i += 1) result *= i;
  return result;
}

type EvalContext = { angleMode: AngleMode; ans: number };

function evaluateCall(node: ExpressionNode & { kind: 'call' }, ctx: EvalContext): number {
  const x = evaluateNode(node.argument, ctx);
  const deg = ctx.angleMode === 'deg';
  // 逆三角関数の結果はラジアンで出るので、度数法モードなら度に直して返す
  const fromRadians = (v: number) => (deg ? (v * 180) / Math.PI : v);

  switch (node.name) {
    case 'sin':
      return deg ? sinDegrees(x) : Math.sin(x);
    case 'cos':
      return deg ? cosDegrees(x) : Math.cos(x);
    case 'tan':
      return deg ? tanDegrees(x, node.position) : Math.tan(x);
    case 'asin':
      if (x < -1 || x > 1) {
        throw new CalcError('asin に渡せるのは -1 〜 1 の範囲だけです', node.position);
      }
      return fromRadians(Math.asin(x));
    case 'acos':
      if (x < -1 || x > 1) {
        throw new CalcError('acos に渡せるのは -1 〜 1 の範囲だけです', node.position);
      }
      return fromRadians(Math.acos(x));
    case 'atan':
      return fromRadians(Math.atan(x));
    case 'log':
      if (x <= 0) {
        throw new CalcError('log に渡せるのは正の数だけです', node.position);
      }
      return Math.log10(x);
    case 'ln':
      if (x <= 0) {
        throw new CalcError('ln に渡せるのは正の数だけです', node.position);
      }
      return Math.log(x);
    case 'sqrt':
      if (x < 0) {
        throw new CalcError('√ に負の数は入れられません', node.position);
      }
      return Math.sqrt(x);
  }
}

function evaluateNode(node: ExpressionNode, ctx: EvalContext): number {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'constant':
      return node.name === 'pi' ? Math.PI : Math.E;
    case 'ans':
      return ctx.ans;
    case 'negate':
      return -evaluateNode(node.operand, ctx);
    case 'factorial':
      return factorial(evaluateNode(node.operand, ctx), node.position);
    case 'percent':
      return evaluateNode(node.operand, ctx) / 100;
    case 'call':
      return evaluateCall(node, ctx);
    case 'binary':
      return evaluateBinary(node, ctx);
  }
}

function evaluateBinary(node: ExpressionNode & { kind: 'binary' }, ctx: EvalContext): number {
  // `200+10%` は「200に200の10%を足す」= 220 と解釈する。一般的な電卓の挙動に合わせ、
  // 足し算・引き算の右側に来た `%` だけ、左側の値に対する割合として扱う。
  // 掛け算・割り算では `10%` はそのまま 0.1（`200×10%` = 20）。
  if ((node.op === '+' || node.op === '-') && node.right.kind === 'percent') {
    const base = evaluateNode(node.left, ctx);
    const ratio = evaluateNode(node.right.operand, ctx) / 100;
    return node.op === '+' ? base + base * ratio : base - base * ratio;
  }

  const a = evaluateNode(node.left, ctx);
  const b = evaluateNode(node.right, ctx);

  switch (node.op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      if (b === 0) {
        throw new CalcError('0で割ることはできません', node.position);
      }
      return a / b;
    case '^': {
      if (a === 0 && b < 0) {
        throw new CalcError('0の負の乗（0で割るのと同じ）は計算できません', node.position);
      }
      const result = Math.pow(a, b);
      if (Number.isNaN(result)) {
        // 負の数の小数乗（例: (-8)^(1/3)）は実数の範囲では値が定まらない
        throw new CalcError('負の数を小数で累乗することはできません', node.position);
      }
      return result;
    }
  }
}

/**
 * 式を計算する。構文・定義域のエラーはすべて CalcError として投げる。
 */
export function evaluate(input: string, options: EvaluateOptions = {}): number {
  const node = parse(input);
  const result = evaluateNode(node, {
    angleMode: options.angleMode ?? 'deg',
    ans: options.ans ?? 0,
  });

  if (!Number.isFinite(result)) {
    throw new CalcError('計算結果の桁が大きすぎます');
  }
  return result;
}

/**
 * 計算結果を表示用の文字列にする。
 *
 * 浮動小数点の誤差（`sin30` が 0.49999999999999994 になる類）をそのまま出すと
 * 電卓として使いものにならないため、有効数字12桁に丸めてから文字列にする。
 * 12桁は「倍精度の精度（約15〜16桁）より十分低く、常用の計算では丸めが目に見えない」
 * ラインとして選んだ。桁が極端な値は指数表記にする。
 */
export function formatResult(value: number): string {
  if (!Number.isFinite(value)) return 'エラー';
  if (value === 0) return '0';

  const abs = Math.abs(value);
  if (abs >= 1e15 || abs < 1e-9) {
    return value.toExponential(9).replace(/\.?0+e/, 'e');
  }
  return String(Number(value.toPrecision(12)));
}
