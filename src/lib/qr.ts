/**
 * QRコード生成ロジック。
 *
 * 符号化そのものは qrcode-generator（Kazuhiko Arase 作 / MIT）に任せている。
 * QRのリードソロモン誤り訂正符号とマスクパターンの選択は、自前で書くと
 * 「一見それらしいが読めない（あるいは別の文字列として読める）QR」を作ってしまいやすい。
 * 読めないQRは無いより有害なので、ここは実績のある実装に寄せる判断をした。
 * 依存の少なさで選定しており、qrcode-generator は依存パッケージ0個。
 * （候補に挙がった qrcode は pngjs / yargs / dijkstrajs に依存するため見送った）
 *
 * このファイルが自前で持つのは次の3つだけ:
 *   1. 入力文字列に応じた符号化モードの選択
 *   2. 例外の日本語メッセージへの変換
 *   3. モジュール（白黒のマス）配列から SVG / ピクセルへの描画
 * 3 は自前なのでズレると即バグになる。テスト（qr.test.ts）では別実装のデコーダ jsQR に
 * 描画結果を読ませ、元の文字列に戻ることまで確認している。
 */

import qrcode from 'qrcode-generator';

// qrcode-generator の既定の stringToBytes は charCode を 0xff でマスクするだけなので、
// ASCII外の文字が化ける（「あ」= U+3042 が 0x42 = 'B' になる）。日本語を扱うサイトでは
// 致命的なので、ライブラリが用意している差し替え口を使って UTF-8 に符号化し直す。
// なおバイトモードのUTF-8はECI指定なしで運用する。規格上の既定はUTF-8ではないが、
// 実運用のリーダはUTF-8を自動判別するものがほとんどで、ECIを付けるほうが読めない端末が増える。
const utf8Encoder = new TextEncoder();
qrcode.stringToBytes = (s: string) => Array.from(utf8Encoder.encode(s));

/** 誤り訂正レベル。右にいくほど汚れや欠けに強いが、同じ文字数でもQRが大きくなる。 */
export type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

/** 符号化モード。数字・英数字は専用モードのほうが同じ内容でも小さいQRになる。 */
export type QrMode = 'Numeric' | 'Alphanumeric' | 'Byte';

export const ERROR_CORRECTION_LEVELS: {
  key: ErrorCorrectionLevel;
  label: string;
  description: string;
}[] = [
  { key: 'L', label: 'L（低）', description: '約7%の欠けまで復元。QRは最も小さくなる' },
  { key: 'M', label: 'M（標準）', description: '約15%の欠けまで復元。通常はこれで十分' },
  { key: 'Q', label: 'Q（高）', description: '約25%の欠けまで復元' },
  { key: 'H', label: 'H（最高）', description: '約30%の欠けまで復元。印刷して屋外に貼るときなどに' },
];

export const QR_MODE_LABELS: Record<QrMode, string> = {
  Numeric: '数字モード',
  Alphanumeric: '英数字モード',
  Byte: 'バイトモード（UTF-8）',
};

/**
 * 静粛領域（クワイエットゾーン）のモジュール数。
 * QR規格で4モジュール以上と決まっている余白で、これが無いとリーダがQRの範囲を
 * 認識できず読み取れなくなる。ユーザーが変更できる値にはしていない。
 */
export const QUIET_ZONE = 4;

export class QrGenerateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QrGenerateError';
  }
}

export type QrMatrix = {
  /** 1辺のモジュール数（静粛領域を含まない） */
  size: number;
  /** modules[row][col] が true なら黒 */
  modules: boolean[][];
  /** 型番 1〜40。size = 4 * typeNumber + 17 の関係にある */
  typeNumber: number;
  errorCorrectionLevel: ErrorCorrectionLevel;
  mode: QrMode;
};

const NUMERIC_PATTERN = /^[0-9]+$/;
// 英数字モードで使える文字は規格で決まっており、この45文字だけ（小文字は含まれない）。
const ALPHANUMERIC_PATTERN = /^[0-9A-Z $%*+\-./:]+$/;

/**
 * 入力に使える最も効率のよい符号化モードを選ぶ。
 * 数字だけなら数字モード、規格の英数字45文字に収まるなら英数字モード、
 * それ以外（小文字・日本語・記号）はバイトモードになる。
 * 例えば電話番号のような数字だけの内容は、バイトモードよりQRが一回り小さくなる。
 */
export function chooseMode(text: string): QrMode {
  if (NUMERIC_PATTERN.test(text)) return 'Numeric';
  if (ALPHANUMERIC_PATTERN.test(text)) return 'Alphanumeric';
  return 'Byte';
}

/**
 * 文字列からQRコードのモジュール配列を作る。
 * 型番（大きさ）は内容が収まる最小のものが自動で選ばれる。
 */
export function generateQr(text: string, level: ErrorCorrectionLevel = 'M'): QrMatrix {
  if (text === '') {
    throw new QrGenerateError('文字列を入力してください');
  }

  const mode = chooseMode(text);
  // 第1引数の 0 は「収まる最小の型番を自動で選ぶ」の意味。
  const qr = qrcode(0, level);

  try {
    qr.addData(text, mode);
    qr.make();
  } catch (e) {
    // 型番40（最大）にも収まらない場合、ライブラリは "code length overflow" を投げる。
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('overflow')) {
      throw new QrGenerateError(
        '入力が長すぎてQRコードに収まりません。文字数を減らすか、誤り訂正レベルを下げてください。',
      );
    }
    throw new QrGenerateError(`QRコードを生成できませんでした（${message}）`);
  }

  const size = qr.getModuleCount();
  const modules: boolean[][] = [];
  for (let row = 0; row < size; row += 1) {
    const line: boolean[] = [];
    for (let col = 0; col < size; col += 1) {
      line.push(qr.isDark(row, col));
    }
    modules.push(line);
  }

  return {
    size,
    modules,
    typeNumber: (size - 17) / 4,
    errorCorrectionLevel: level,
    mode,
  };
}

export type RenderOptions = {
  /** 1モジュールあたりのピクセル数 */
  moduleSize?: number;
  /** 静粛領域のモジュール数。既定の4より小さくすると読み取れなくなる */
  margin?: number;
};

function resolveRenderOptions(options: RenderOptions | undefined) {
  const moduleSize = options?.moduleSize ?? 8;
  const margin = options?.margin ?? QUIET_ZONE;
  if (!Number.isInteger(moduleSize) || moduleSize < 1) {
    throw new QrGenerateError('モジュールサイズは1以上の整数で指定してください');
  }
  if (!Number.isInteger(margin) || margin < 0) {
    throw new QrGenerateError('余白は0以上の整数で指定してください');
  }
  return { moduleSize, margin };
}

/**
 * 各行の黒モジュールを横方向にまとめて、SVGのパスデータを組み立てる。
 * 1マスずつ `<rect>` を並べると型番40で3万要素を超えるため、
 * 連続する黒を1つのサブパスにまとめてファイルサイズを抑えている。
 */
function buildPathData(matrix: QrMatrix, margin: number): string {
  const parts: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    let col = 0;
    while (col < matrix.size) {
      if (!matrix.modules[row][col]) {
        col += 1;
        continue;
      }
      let run = 1;
      while (col + run < matrix.size && matrix.modules[row][col + run]) run += 1;
      parts.push(`M${col + margin} ${row + margin}h${run}v1h-${run}z`);
      col += run;
    }
  }
  return parts.join('');
}

/**
 * QRコードをSVG文字列にする。
 * viewBox はモジュール単位、width/height はピクセルで持たせているので、
 * 拡大しても輪郭がぼやけない。`shape-rendering="crispEdges"` は
 * 描画時のアンチエイリアスでマスの境界が濁るのを防ぐため。
 */
export function qrToSvg(matrix: QrMatrix, options?: RenderOptions): string {
  const { moduleSize, margin } = resolveRenderOptions(options);
  const total = matrix.size + margin * 2;
  const px = total * moduleSize;
  const path = buildPathData(matrix, margin);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"` +
    ` viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="QRコード">` +
    `<rect width="${total}" height="${total}" fill="#ffffff"/>` +
    (path ? `<path fill="#000000" d="${path}"/>` : '') +
    `</svg>`
  );
}

export type QrPixels = {
  width: number;
  height: number;
  /**
   * RGBA4バイト × width × height。canvas の ImageData にそのまま渡せる並び。
   * `ImageData` は SharedArrayBuffer 由来の配列を受け付けないため、
   * 型引数で通常の ArrayBuffer に固定しておく。
   */
  data: Uint8ClampedArray<ArrayBuffer>;
};

/**
 * QRコードをRGBAのピクセル列にする。
 * ページ側は canvas の `putImageData` にそのまま渡し、PNG保存は canvas 経由で行う。
 * 「画面に出す絵」と「テストでデコーダに読ませる絵」を同じ関数から作ることで、
 * 表示だけ壊れている状態に気づけるようにしている。
 */
export function qrToPixels(matrix: QrMatrix, options?: RenderOptions): QrPixels {
  const { moduleSize, margin } = resolveRenderOptions(options);
  const total = matrix.size + margin * 2;
  const side = total * moduleSize;
  const data = new Uint8ClampedArray(side * side * 4);
  data.fill(255); // まず全面を不透明な白で塗る

  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (!matrix.modules[row][col]) continue;
      const top = (row + margin) * moduleSize;
      const left = (col + margin) * moduleSize;
      for (let y = top; y < top + moduleSize; y += 1) {
        for (let x = left; x < left + moduleSize; x += 1) {
          const offset = (y * side + x) * 4;
          data[offset] = 0;
          data[offset + 1] = 0;
          data[offset + 2] = 0;
          // アルファは 255 のまま
        }
      }
    }
  }

  return { width: side, height: side, data };
}
