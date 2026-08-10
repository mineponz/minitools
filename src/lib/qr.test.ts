import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import {
  generateQr,
  chooseMode,
  qrToSvg,
  qrToPixels,
  QrGenerateError,
  QUIET_ZONE,
  type ErrorCorrectionLevel,
  type QrMatrix,
} from './qr.ts';

/**
 * 生成したQRを jsQR（別実装のデコーダ / Apache-2.0）に読ませて、元の文字列に戻るか確かめる。
 * 符号化ライブラリの自己テストではなく、こちらの描画（qrToPixels）まで含めた
 * 通しの検証になっているのが要点。行と列を取り違えていればここで落ちる。
 */
function decodeRoundTrip(text: string, level: ErrorCorrectionLevel): string | null {
  const matrix = generateQr(text, level);
  const pixels = qrToPixels(matrix, { moduleSize: 6 });
  return jsQR(pixels.data, pixels.width, pixels.height)?.data ?? null;
}

const LEVELS: ErrorCorrectionLevel[] = ['L', 'M', 'Q', 'H'];

// --- デコードできるか（最重要） ---

test('生成したQRをデコードするとURLが元に戻る（全誤り訂正レベル）', () => {
  const url = 'https://minitools.mineponz.workers.dev/tools/qr/';
  for (const level of LEVELS) {
    assert.equal(decodeRoundTrip(url, level), url, `レベル${level}で不一致`);
  }
});

test('日本語をデコードすると元に戻る（UTF-8で符号化できている）', () => {
  // ライブラリ既定の stringToBytes は charCode を 0xff で切るため、この検証が無いと
  // 「あ」が 'B' になるような文字化けに気づけない。
  const text = 'こんにちは、世界。QRコードのテストです。';
  for (const level of LEVELS) {
    assert.equal(decodeRoundTrip(text, level), text, `レベル${level}で不一致`);
  }
});

test('サロゲートペア（絵文字）を含む文字列もデコードできる', () => {
  const text = '打ち上げ 🎉 と寿司 🍣';
  assert.equal(decodeRoundTrip(text, 'M'), text);
});

test('数字だけ・英数字だけの入力もデコードできる（専用モード経由）', () => {
  assert.equal(decodeRoundTrip('0312345678', 'M'), '0312345678');
  assert.equal(decodeRoundTrip('HTTPS://EXAMPLE.COM/PATH', 'M'), 'HTTPS://EXAMPLE.COM/PATH');
});

test('長文（400文字）もデコードできる', () => {
  const text = 'a'.repeat(400);
  assert.equal(decodeRoundTrip(text, 'L'), text);
});

test('記号を多く含む文字列もデコードできる', () => {
  const text = 'WIFI:T:WPA;S:my-network;P:p@ss w0rd!#$;;';
  assert.equal(decodeRoundTrip(text, 'M'), text);
});

// --- モード選択 ---

test('chooseMode: 数字のみは数字モード', () => {
  assert.equal(chooseMode('0123456789'), 'Numeric');
  assert.equal(chooseMode('7'), 'Numeric');
});

test('chooseMode: 規格の英数字45文字に収まれば英数字モード', () => {
  assert.equal(chooseMode('ABC-123'), 'Alphanumeric');
  assert.equal(chooseMode('HTTPS://EXAMPLE.COM'), 'Alphanumeric');
  assert.equal(chooseMode('A B $%*+-./:'), 'Alphanumeric');
});

test('chooseMode: 小文字・日本語・英数字モード外の記号はバイトモード', () => {
  assert.equal(chooseMode('abc'), 'Byte');
  assert.equal(chooseMode('あ'), 'Byte');
  assert.equal(chooseMode('A_B'), 'Byte'); // アンダースコアは英数字モードに無い
  assert.equal(chooseMode('a@b.com'), 'Byte');
});

test('数字モードのほうがバイトモードよりQRが小さくなる', () => {
  const digits = '1234567890123456789012345678901234567890';
  const numeric = generateQr(digits, 'M');
  const bytes = generateQr(digits.replace(/0/g, 'o'), 'M'); // 同じ長さでバイトモードになる入力
  assert.equal(numeric.mode, 'Numeric');
  assert.equal(bytes.mode, 'Byte');
  assert.ok(
    numeric.size < bytes.size,
    `数字モード ${numeric.size} がバイトモード ${bytes.size} より小さいはず`,
  );
});

// --- 行列の構造 ---

test('モジュール数と型番は size = 4 * typeNumber + 17 の関係にある', () => {
  const matrix = generateQr('https://example.com/', 'M');
  assert.equal(matrix.size, 4 * matrix.typeNumber + 17);
  assert.equal(matrix.modules.length, matrix.size);
  for (const row of matrix.modules) {
    assert.equal(row.length, matrix.size);
  }
});

test('誤り訂正レベルを上げると同じ内容でもQRは大きくなる（または同じ）', () => {
  const text = 'https://minitools.mineponz.workers.dev/tools/qr/';
  const sizes = LEVELS.map((level) => generateQr(text, level).size);
  for (let i = 1; i < sizes.length; i += 1) {
    assert.ok(sizes[i] >= sizes[i - 1], `${LEVELS[i]} が ${LEVELS[i - 1]} より小さくなっている`);
  }
  assert.ok(sizes[3] > sizes[0], 'H は L より大きくなるはず');
});

test('3隅に切り出しシンボル（7x7のファインダパターン）がある', () => {
  const matrix = generateQr('finder pattern check', 'M');
  const last = matrix.size - 7;
  // 中心の3x3が黒、それを囲む1マスが白、さらに外周1マスが黒、という構造を確認する
  for (const [baseRow, baseCol] of [[0, 0], [0, last], [last, 0]] as const) {
    for (let r = 0; r < 7; r += 1) {
      for (let c = 0; c < 7; c += 1) {
        const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3)); // 中心からの距離
        const expected = ring !== 2; // ring 2 のリングだけ白
        assert.equal(
          matrix.modules[baseRow + r][baseCol + c],
          expected,
          `(${baseRow + r}, ${baseCol + c}) の色が想定と違う`,
        );
      }
    }
  }
});

test('規格上かならず黒くなる固定モジュールが (4×型番+9, 8) にある', () => {
  // QRで1つだけ位置と色が固定されている「暗モジュール」。行と列を取り違えていると
  // 転置した位置を見ることになり、そこは形式情報で黒とは限らないため異常に気づける。
  // （右下隅はデータ領域で黒とも白とも決まっておらず、向きの判定には使えない）
  for (const text of ['x', 'https://example.com/', 'こんにちは']) {
    for (const level of LEVELS) {
      const matrix = generateQr(text, level);
      assert.equal(
        matrix.modules[4 * matrix.typeNumber + 9][8],
        true,
        `"${text}" / レベル${level} の固定モジュールが黒でない`,
      );
    }
  }
});

// --- エラー ---

test('空文字はエラーになる', () => {
  assert.throws(() => generateQr('', 'M'), QrGenerateError);
});

test('型番40にも収まらない長さはエラーになる', () => {
  assert.throws(
    () => generateQr('a'.repeat(4000), 'H'),
    (e: unknown) => e instanceof QrGenerateError && e.message.includes('長すぎて'),
  );
});

test('モジュールサイズ・余白が不正ならエラーになる', () => {
  const matrix = generateQr('x', 'M');
  assert.throws(() => qrToSvg(matrix, { moduleSize: 0 }), QrGenerateError);
  assert.throws(() => qrToSvg(matrix, { moduleSize: 1.5 }), QrGenerateError);
  assert.throws(() => qrToPixels(matrix, { margin: -1 }), QrGenerateError);
});

// --- SVG出力 ---

/** 手で組んだ小さな行列。描画結果を1文字ずつ確認するために使う。 */
const TINY_MATRIX: QrMatrix = {
  size: 3,
  modules: [
    [true, true, false],
    [false, true, false],
    [true, false, true],
  ],
  typeNumber: 1,
  errorCorrectionLevel: 'M',
  mode: 'Byte',
};

test('qrToSvg: 連続する黒を1つのサブパスにまとめる', () => {
  const svg = qrToSvg(TINY_MATRIX, { moduleSize: 10, margin: 1 });
  assert.equal(
    svg,
    '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"' +
      ' viewBox="0 0 5 5" shape-rendering="crispEdges" role="img" aria-label="QRコード">' +
      '<rect width="5" height="5" fill="#ffffff"/>' +
      '<path fill="#000000" d="M1 1h2v1h-2zM2 2h1v1h-1zM1 3h1v1h-1zM3 3h1v1h-1z"/>' +
      '</svg>',
  );
});

test('qrToSvg: 既定では静粛領域4モジュールぶんの余白が付く', () => {
  const matrix = generateQr('https://example.com/', 'M');
  const svg = qrToSvg(matrix, { moduleSize: 4 });
  const total = matrix.size + QUIET_ZONE * 2;
  assert.ok(svg.includes(`viewBox="0 0 ${total} ${total}"`));
  assert.ok(svg.includes(`width="${total * 4}" height="${total * 4}"`));
});

test('qrToSvg: 左上のモジュールは余白ぶんだけずれた位置に描かれる', () => {
  const matrix = generateQr('https://example.com/', 'M');
  const svg = qrToSvg(matrix);
  // ファインダパターンの1行目は必ず7マス連続の黒なので、最初のサブパスはこの形になる
  assert.ok(svg.includes(`d="M${QUIET_ZONE} ${QUIET_ZONE}h7v1h-7z`), svg.slice(0, 260));
});

// --- ピクセル出力 ---

test('qrToPixels: 画像サイズは (モジュール数 + 余白×2) × モジュールサイズ', () => {
  const matrix = generateQr('https://example.com/', 'M');
  const pixels = qrToPixels(matrix, { moduleSize: 5 });
  const expected = (matrix.size + QUIET_ZONE * 2) * 5;
  assert.equal(pixels.width, expected);
  assert.equal(pixels.height, expected);
  assert.equal(pixels.data.length, expected * expected * 4);
});

test('qrToPixels: 静粛領域は不透明な白、ファインダパターンの角は黒', () => {
  const matrix = generateQr('https://example.com/', 'M');
  const moduleSize = 5;
  const pixels = qrToPixels(matrix, { moduleSize });

  const at = (x: number, y: number) => {
    const o = (y * pixels.width + x) * 4;
    return [pixels.data[o], pixels.data[o + 1], pixels.data[o + 2], pixels.data[o + 3]];
  };

  assert.deepEqual(at(0, 0), [255, 255, 255, 255], '左上の余白が白でない');
  assert.deepEqual(
    at(pixels.width - 1, pixels.height - 1),
    [255, 255, 255, 255],
    '右下の余白が白でない',
  );
  // 余白の直後がQR本体の (0,0)。ファインダパターンの左上なので黒。
  assert.deepEqual(at(QUIET_ZONE * moduleSize, QUIET_ZONE * moduleSize), [0, 0, 0, 255]);
});
