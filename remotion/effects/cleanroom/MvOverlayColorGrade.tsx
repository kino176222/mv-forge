import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvOverlayColorGrade — 画面全体を「一度モノクロに潰してから単一色相に染め直す」
 * デュオトーン／グラデーションマップ系のカラーグレード家族。クリーンルーム実装
 * （技法メモとポスターの雰囲気のみを根拠に白紙から作成）。
 *
 * レイヤー構成（下から）:
 *   1. 素の children（無加工・常時最下層。Mix<1 のとき下から透ける保険）
 *   2. ルック層: 同じ children をもう1枚、モノクロ化＋色染め。opacity が効果の Mix
 *   3. ブルーム層（variant による）: 強コントラストで明部抽出→色染め→大きくぼかし screen
 *   4. グレイン層（variant による）: 手続きノイズタイルを overlay 合成
 *   5. ビネット（variant による）: 楕円ラジアルグラデを multiply
 *   6. フラッシュ層（variant による）: 全画面ベタ最前面
 *
 * variant(0..1) → 3プリセット:
 *   0.0 DUOTONE   最小構成。grayscale＋純色ベタ soft-light の2段。グレインあり
 *   0.5 RICH MONO 折れ線グラデマップ（青黒→青→白飛び）＋ブルーム＋ビネット
 *   1.0 FILM FADE 線形グラデマップの退色調。常時被せ＋頭尾の白フラッシュ＋粗グレイン
 * 完全決定論（Math.random 不使用）。intensity 0..100 で強度調整、0 で素通し。
 */
export interface MvOverlayColorGradeProps {
  children: React.ReactNode; // 下の絵。全面に描画して上に質感を重ねる
  durationInFrames: number;
  intensity?: number; // 0..100
  variant?: number; // 0..1 同家族内の見た目分岐（決定論的に）
  tint?: string; // 任意: 基調色の差し替え（空/未指定=デザイン既定）
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// 緩急のあるフェード（smoothstep）。線形等速を避けつつ家族の素直な出入りを保つ
const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

// 決定論的な整数ハッシュ → 0..1
const hash01 = (x: number, seed: number) => {
  let h = (Math.imul(x, 374761393) + Math.imul(seed, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h >>> 8) / 0xffffff;
};

// 手続きグレインタイル（data URI）。50%グレー中心に整えた fractalNoise
const grainTileUri = (baseFrequency: number) => {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'>` +
    `<filter id='g' x='0' y='0' width='100%' height='100%'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='${baseFrequency}' numOctaves='2' stitchTiles='stitch' result='n'/>` +
    `<feColorMatrix in='n' type='saturate' values='0'/>` +
    `<feComponentTransfer>` +
    `<feFuncR type='linear' slope='0.5' intercept='0.25'/>` +
    `<feFuncG type='linear' slope='0.5' intercept='0.25'/>` +
    `<feFuncB type='linear' slope='0.5' intercept='0.25'/>` +
    `<feFuncA type='linear' slope='0' intercept='1'/>` +
    `</feComponentTransfer>` +
    `</filter>` +
    `<rect width='260' height='260' filter='url(%23g)'/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/%2523/g, "%23")}")`;
};

// Rec.709 系輝度でモノクロ化する行列（alpha 保持）
const LUMA_MATRIX =
  "0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0";

const TEMPLATE_GRAIN_FPS = 30; // グレインの tick はテンプレ元fps刻み（再生fps非依存）

export const MvOverlayColorGrade: React.FC<MvOverlayColorGradeProps> = ({
  children,
  durationInFrames,
  intensity = 100,
  variant = 0,
  tint,
}) => {
  const frame = useCurrentFrame();
  const { width, fps } = useVideoConfig();

  const preset = Math.round(clamp(variant, 0, 1) * 2); // 0=DUOTONE 1=RICH 2=FADE
  const k = clamp(intensity / 100, 0, 1);
  const t = frame / fps; // 先頭からの経過秒
  const D = Math.max(1, durationInFrames) / fps; // 実尺（秒）
  const remain = D - t; // 終端からの残り秒

  // 台形エンベロープ（イン=経過秒 / アウト=残り秒 の min 合成。任意の尺で頭尻が保たれる）
  const env = Math.min(smooth(t / 1.0), smooth(remain / 0.9));
  // ブルームは本体より遅く立ち上がり早く抜ける（エンベロープの小ずらし）
  const envBloom = Math.min(smooth((t - 0.4) / 1.2), smooth((remain - 0.35) / 0.7));

  const scale = width / 1920; // 解像度追従係数

  // グレインの位置飛ばし（決定論）
  const seed = preset * 7919 + 101;
  const tick = Math.floor(t * TEMPLATE_GRAIN_FPS);
  const grainTilePx = Math.max(64, Math.round((preset === 2 ? 340 : 240) * scale));
  const grainX = Math.round(hash01(tick, seed) * grainTilePx);
  const grainY = Math.round(hash01(tick + 4241, seed) * grainTilePx);
  const grainImage = useMemo(
    () => grainTileUri(preset === 2 ? 0.55 : 0.9),
    [preset]
  );

  // 染め色（DUOTONE の soft-light ベタ。既定は深い青）
  const tintColor = tint && tint.length > 0 ? tint : "#1e2fd6";

  // ---- 各層の不透明度 ----
  const lookMix =
    preset === 2
      ? k // FILM FADE はルック常時被せ（時間演出は頭尾フラッシュのみ）
      : env * k;
  const bloomOp = preset === 1 ? clamp(envBloom, 0, 1) * 0.75 * k : 0;
  const grainOp = preset === 0 ? 0.3 * env * k : preset === 2 ? 0.5 * k : 0;
  const vignetteOp = preset === 1 ? 0.8 * env * k : preset === 2 ? 0.75 * k : 0;

  // 白フラッシュ（FILM FADE）: 不透明度と明度を別カーブ・逆位相で駆動
  let flashOp = 0;
  let flashLum = 1;
  if (preset === 2) {
    const opHead = 1 - smooth(t / 1.5);
    const opTail = smooth((t - (D - 1.0)) / 1.0);
    flashOp = clamp(Math.max(opHead, opTail), 0, 1) * k;
    const lumHead = 1 - smooth(t / 1.15);
    const lumTail = smooth((t - (D - 0.8)) / 0.8);
    flashLum = clamp(Math.max(lumHead, lumTail), 0, 1);
  }
  const flashGray = Math.round(255 * flashLum);

  // ルック層の filter チェーン
  const lookFilter =
    preset === 0
      ? "grayscale(1)"
      : preset === 1
        ? "brightness(1.1) contrast(1.5) url(#mvcg-map-rich)"
        : "url(#mvcg-map-fade)";

  const bloomBlurPx = Math.max(8, Math.round(width * 0.025));

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", isolation: "isolate" }}>
      {/* SVGフィルタ定義（不可視・幅0） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          {/* 折れ線テーブルのグラデマップ: 暗部 青黒 → 中間 青 → 明部 白飛び気味 */}
          <filter id="mvcg-map-rich" colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={LUMA_MATRIX} />
            <feComponentTransfer>
              <feFuncR type="table" tableValues="0.02 0.10 0.42 0.94" />
              <feFuncG type="table" tableValues="0.04 0.20 0.55 0.97" />
              <feFuncB type="table" tableValues="0.13 0.58 0.93 1.00" />
            </feComponentTransfer>
          </filter>
          {/* 線形グラデマップ: ほぼ黒の緑がかった暗端 → 退色した砂色の明端 */}
          <filter id="mvcg-map-fade" colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={LUMA_MATRIX} />
            <feComponentTransfer>
              <feFuncR type="linear" slope="0.808" intercept="0.039" />
              <feFuncG type="linear" slope="0.765" intercept="0.059" />
              <feFuncB type="linear" slope="0.714" intercept="0.039" />
            </feComponentTransfer>
          </filter>
        </defs>
      </svg>

      {/* 1. 素の映像（常時最下層の保険） */}
      <AbsoluteFill>{children}</AbsoluteFill>

      {/* 2. ルック層: 同じ映像をモノクロ化＋色染めして重ね、opacity で Mix */}
      {lookMix > 0.01 && (
        <AbsoluteFill style={{ opacity: lookMix, isolation: "isolate", pointerEvents: "none" }}>
          <AbsoluteFill style={{ filter: lookFilter }}>{children}</AbsoluteFill>
          {preset === 0 && (
            <>
              <AbsoluteFill style={{ backgroundColor: tintColor, mixBlendMode: "soft-light" }} />
              <AbsoluteFill
                style={{ backgroundColor: tintColor, mixBlendMode: "soft-light", opacity: 0.6 }}
              />
            </>
          )}
          {preset !== 0 && tint && tint.length > 0 && (
            <AbsoluteFill
              style={{ backgroundColor: tintColor, mixBlendMode: "soft-light", opacity: 0.5 }}
            />
          )}
        </AbsoluteFill>
      )}

      {/* 3. ブルーム層: 明部抽出→色染め→大ぼかし→screen */}
      {bloomOp > 0.01 && (
        <AbsoluteFill
          style={{
            opacity: bloomOp,
            mixBlendMode: "screen",
            pointerEvents: "none",
            filter: `brightness(1.15) contrast(2.4) url(#mvcg-map-rich) blur(${bloomBlurPx}px)`,
          }}
        >
          {children}
        </AbsoluteFill>
      )}

      {/* 4. グレイン層: 中立グレー土台＋ノイズタイルを overlay 合成 */}
      {grainOp > 0.01 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "overlay",
            opacity: grainOp,
            pointerEvents: "none",
            backgroundColor: "#808080",
            backgroundImage: grainImage,
            backgroundSize: `${grainTilePx}px ${grainTilePx}px`,
            backgroundPosition: `${grainX}px ${grainY}px`,
          }}
        />
      )}

      {/* 5. 周辺減光: 楕円ラジアルグラデを multiply */}
      {vignetteOp > 0.01 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "multiply",
            opacity: vignetteOp,
            pointerEvents: "none",
            background:
              "radial-gradient(ellipse 75% 62% at 50% 48%, rgba(255,255,255,1) 52%, rgba(120,128,150,1) 78%, rgba(38,42,58,1) 100%)",
          }}
        />
      )}

      {/* 6. フラッシュ層: 不透明度と明度を逆位相で駆動する全画面ベタ */}
      {flashOp > 0.01 && (
        <AbsoluteFill
          style={{
            pointerEvents: "none",
            opacity: flashOp,
            backgroundColor: `rgb(${flashGray}, ${flashGray}, ${flashGray})`,
          }}
        />
      )}
    </AbsoluteFill>
  );
};
