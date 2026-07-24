import React, { useId } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvOverlayHalftonePrint — 入力映像を「古い印刷物・フォトコピー」の質感に変える
 * オーバーレイ家族部品。クリーンルーム実装（技法メモとポスターの雰囲気のみを根拠に
 * 白紙から作成。数値はすべて自分の目で調整）。
 *
 * 骨格:
 *  - 最下層に素の children を全面描画し、その上に「加工済みルック層群」を重ね、
 *    マスター不透明度（台形エンベロープ×intensity）でクロスフェードする。
 *  - ルックは静止的。動きは粒子の位相ジッタ（ネイティブfps刻みに量子化）のみ。
 *  - px値はフルHD幅基準で定義し、実画面幅との比でスケール（解像度非依存）。
 *
 * variant(0..1) → 4プリセット:
 *   0.00 WARM PRINT   輝度→暖色ランプ着色＋45°黒点網点multiply＋overlay粒（基準形）
 *   0.33 FADED COPY   セピア退色グレード＋色収差＋暖色ソフトライト＋ビネット＋薄網点
 *   0.67 BLUE GLOW    黒地に発光。screen輝度スタック（二段ブルーム＋斜め異方性の尾）を
 *                     青multiply着色し最明部だけ白コアを戻す。粗い変調網点
 *   1.00 MONO COPY    網点なし。高コントラスト複写調＋ブルーム＋ラプラシアンエッジ＋
 *                     黒潰し暗幕＋二重overlay粒＋screen粒＋楕円ビネット
 * 完全に決定論的（Math.random不使用）。外部素材なし（CSS/SVG手続き生成のみ）。
 */
export interface MvOverlayHalftonePrintProps {
  children: React.ReactNode; // 下の絵。全面に描画して上に質感を重ねる
  durationInFrames: number;
  intensity?: number; // 0..100
  variant?: number; // 0..1 同家族内の見た目分岐（決定論的に）
  tint?: string; // 任意: 基調色の差し替え（空/未指定=デザイン既定）
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** 決定論的ハッシュ（tick+seed → 0..1）。粒ジッタ専用 */
const hash01 = (n: number, seed: number) => {
  const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453123;
  return s - Math.floor(s);
};

/** 緩急のあるS字（入り・抜きを静かに） */
const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

const svgUri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

/** フラクタルノイズ→彩度0→トーン調整を焼いた粒タイル（stitchでタイル可能） */
const grainTile = (freq: number, octaves: number, seed: number, slope: number) => {
  const inter = (1 - slope) / 2; // 中立グレー(0.5)を保ったままコントラストを付ける
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">` +
      `<filter id="n" x="0" y="0" width="100%" height="100%">` +
      `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${octaves}" seed="${seed}" stitchTiles="stitch"/>` +
      `<feColorMatrix type="saturate" values="0"/>` +
      `<feComponentTransfer>` +
      `<feFuncR type="linear" slope="${slope}" intercept="${inter}"/>` +
      `<feFuncG type="linear" slope="${slope}" intercept="${inter}"/>` +
      `<feFuncB type="linear" slope="${slope}" intercept="${inter}"/>` +
      `<feFuncA type="linear" slope="0" intercept="1"/>` +
      `</feComponentTransfer>` +
      `</filter>` +
      `<rect width="100%" height="100%" filter="url(#n)"/>` +
    `</svg>`,
  );
};

const GRAIN_FINE = grainTile(0.9, 2, 7, 1.35);
const GRAIN_COARSE = grainTile(0.35, 3, 11, 1.5);

/** 網点タイル: 中央に黒点（multiply向け・透明地なので素材が透ける） */
const DOT_TILE = svgUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12">` +
    `<circle cx="6" cy="6" r="4" fill="black"/>` +
  `</svg>`,
);

/** 変調網点タイル: 中心素通り→隙間（四隅）だけ暗灰に落ちる */
const DOT_TILE_INVERSE = svgUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12">` +
    `<radialGradient id="m" cx="0.5" cy="0.5" r="0.72">` +
    `<stop offset="0" stop-color="#17171c" stop-opacity="0"/>` +
    `<stop offset="0.5" stop-color="#17171c" stop-opacity="0"/>` +
    `<stop offset="1" stop-color="#17171c" stop-opacity="0.95"/>` +
    `</radialGradient>` +
    `<rect width="12" height="12" fill="url(#m)"/>` +
  `</svg>`,
);

/** プリセット既定の基調色（tintで差し替え可能） */
const DEFAULT_ACCENT: Record<number, string> = {
  0: "#ff8a3c", // 焦げオレンジ
  1: "#e8b078", // 褪せた琥珀
  2: "#3f6fd8", // 冷たい青
  3: "#9aa0a8", // 無彩の銀（複写調はほぼ効かせない）
};

export const MvOverlayHalftonePrint: React.FC<MvOverlayHalftonePrintProps> = ({
  children,
  durationInFrames,
  intensity = 100,
  variant = 0,
  tint,
}) => {
  const frame = useCurrentFrame();
  const { width, fps } = useVideoConfig();
  const rawId = useId();
  const uid = `htp${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const preset = Math.round(clamp(variant, 0, 1) * 3); // 0..3
  const dur = Math.max(1, durationInFrames);
  const k = clamp(intensity, 0, 100) / 100;
  const accent = tint && tint.trim() !== "" ? tint : DEFAULT_ACCENT[preset];
  const sc = width / 1920; // フルHD幅基準スケール

  // ---- 台形エンベロープ（入り約1秒 / 抜き約1秒、S字で静かに）----
  const inSec = frame / fps;
  const outSec = Math.max(0, dur - 1 - frame) / fps;
  const env = Math.min(smooth(inSec / 1.0), smooth(outSec / 0.9)) * k;

  // ---- 粒ジッタ: ネイティブ24fps刻みに量子化したtick → 毎コマ位置を飛ばす ----
  const tick = Math.floor((frame / fps) * 24);
  const seed = preset * 17 + 3;
  const jitter = (slot: number, span: number) => ({
    x: Math.floor(hash01(tick, seed + slot * 2) * span),
    y: Math.floor(hash01(tick, seed + slot * 2 + 1) * span),
  });

  // ---- 小さなレイヤービルダー ----
  const grainLayer = (
    uri: string,
    pitch: number,
    opacity: number,
    blend: "overlay" | "screen",
    slot: number,
  ) => {
    const j = jitter(slot, pitch);
    return (
      <AbsoluteFill
        style={{
          backgroundImage: `url("${uri}")`,
          backgroundRepeat: "repeat",
          backgroundSize: `${pitch}px ${pitch}px`,
          backgroundPosition: `${j.x}px ${j.y}px`,
          mixBlendMode: blend,
          opacity,
        }}
      />
    );
  };

  // 45°回転＋1.9倍拡大で四隅の隙間を画面外へ逃がす網点レイヤー
  const halftoneLayer = (uri: string, pitch: number, opacity: number) => (
    <AbsoluteFill
      style={{
        backgroundImage: `url("${uri}")`,
        backgroundRepeat: "repeat",
        backgroundSize: `${pitch}px ${pitch}px`,
        transform: "rotate(45deg) scale(1.9)",
        mixBlendMode: "multiply",
        opacity,
      }}
    />
  );

  // ---- プリセット別ルック層群 ----
  let look: React.ReactNode = null;

  if (preset === 0) {
    // WARM PRINT: 輝度→暖色ランプ着色＋黒点網点＋overlay粒の最小3点セット
    look = (
      <>
        <AbsoluteFill
          style={{
            filter: `grayscale(1) contrast(1.22) brightness(0.94) url(#${uid}-ramp)`,
          }}
        >
          {children}
        </AbsoluteFill>
        {tint ? (
          <AbsoluteFill
            style={{ background: accent, mixBlendMode: "soft-light", opacity: 0.4 }}
          />
        ) : null}
        {halftoneLayer(DOT_TILE, 13 * sc, 0.42)}
        {grainLayer(GRAIN_FINE, 240 * sc, 0.28, "overlay", 0)}
      </>
    );
  } else if (preset === 1) {
    // FADED COPY: セピア退色＋色収差＋暖色ソフトライト＋薄網点＋ビネット
    look = (
      <>
        <AbsoluteFill
          style={{
            // 4%拡大で、チャンネルずらしにより縁へ出る透明を画面外に隠す
            transform: "scale(1.045)",
            filter:
              `grayscale(0.6) sepia(0.32) saturate(0.78) contrast(0.92) ` +
              `brightness(1.06) url(#${uid}-aberration)`,
          }}
        >
          {children}
        </AbsoluteFill>
        <AbsoluteFill
          style={{ background: accent, mixBlendMode: "soft-light", opacity: 0.35 }}
        />
        {halftoneLayer(DOT_TILE, 10 * sc, 0.28)}
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 48%, rgba(24,14,8,0.6) 100%)",
            mixBlendMode: "multiply",
          }}
        />
        {grainLayer(GRAIN_FINE, 220 * sc, 0.24, "overlay", 0)}
      </>
    );
  } else if (preset === 2) {
    // BLUE GLOW: 黒地に発光する輝度スタック→青multiply→白コア戻し＋変調網点
    const breath = 0.85 + 0.15 * Math.sin((frame / fps) * (Math.PI * 2) / 3.2); // 静かな呼吸
    const cSquash = 0.12; // 圧縮比（実効の尾 ≒ blur/圧縮比）
    const tailDeg = 28;
    const tailBlur = 9 * sc;
    look = (
      <>
        <AbsoluteFill style={{ background: "#000" }} />
        {/* 広いブルーム */}
        <AbsoluteFill
          style={{
            filter: `grayscale(1) contrast(1.5) brightness(1.15) blur(${24 * sc}px)`,
            mixBlendMode: "screen",
            opacity: 0.7 * breath,
          }}
        >
          {children}
        </AbsoluteFill>
        {/* 締まったブルーム */}
        <AbsoluteFill
          style={{
            filter: `grayscale(1) contrast(1.75) brightness(1.05) blur(${8 * sc}px)`,
            mixBlendMode: "screen",
            opacity: 0.55,
          }}
        >
          {children}
        </AbsoluteFill>
        {/* 異方性の尾: 回転→横圧縮→ブラー→伸長で戻すサンドイッチ */}
        <AbsoluteFill
          style={{
            transform: `rotate(${-tailDeg}deg) scaleX(${1 / cSquash})`,
            mixBlendMode: "screen",
            opacity: 0.4,
          }}
        >
          <AbsoluteFill style={{ filter: `blur(${tailBlur}px)` }}>
            <AbsoluteFill
              style={{
                transform: `scaleX(${cSquash}) rotate(${tailDeg}deg)`,
                filter: "grayscale(1) contrast(2.1) brightness(1.05)",
              }}
            >
              {children}
            </AbsoluteFill>
          </AbsoluteFill>
        </AbsoluteFill>
        {/* 高コントラスト本体 */}
        <AbsoluteFill
          style={{
            filter: "grayscale(1) contrast(1.7) brightness(1.02)",
            mixBlendMode: "screen",
          }}
        >
          {children}
        </AbsoluteFill>
        {/* 青一色でmultiply着色 */}
        <AbsoluteFill style={{ background: accent, mixBlendMode: "multiply" }} />
        {/* 最明部だけ白コアを戻す */}
        <AbsoluteFill
          style={{
            filter: "grayscale(1) contrast(3.2) brightness(0.9)",
            mixBlendMode: "screen",
            opacity: 0.32,
          }}
        >
          {children}
        </AbsoluteFill>
        {/* 中心素通り/隙間暗灰の粗い変調網点 */}
        {halftoneLayer(DOT_TILE_INVERSE, 21 * sc, 0.55)}
        {/* 黒地にも粒を光らせる screen粒 */}
        {grainLayer(GRAIN_FINE, 260 * sc, 0.26, "screen", 0)}
      </>
    );
  } else {
    // MONO COPY: 網点なし。高コントラスト複写調の重ね技
    look = (
      <>
        {/* 黒潰し気味のモノクロ本体 */}
        <AbsoluteFill
          style={{ filter: "grayscale(1) contrast(1.9) brightness(0.8)" }}
        >
          {children}
        </AbsoluteFill>
        {/* ブルーム */}
        <AbsoluteFill
          style={{
            filter: `grayscale(1) contrast(2.2) brightness(0.9) blur(${14 * sc}px)`,
            mixBlendMode: "screen",
            opacity: 0.45,
          }}
        >
          {children}
        </AbsoluteFill>
        {/* コピー機の輪郭ざらつき: ラプラシアン白線をscreenで薄がけ */}
        <AbsoluteFill
          style={{
            filter: `grayscale(1) url(#${uid}-edge)`,
            mixBlendMode: "screen",
            opacity: 0.26,
          }}
        >
          {children}
        </AbsoluteFill>
        {/* 暗幕 */}
        <AbsoluteFill style={{ background: "#000", opacity: 0.22 }} />
        {/* 粗細二重overlay粒＋影用screen粒 */}
        {grainLayer(GRAIN_COARSE, 420 * sc, 0.3, "overlay", 0)}
        {grainLayer(GRAIN_FINE, 200 * sc, 0.24, "overlay", 1)}
        {grainLayer(GRAIN_FINE, 300 * sc, 0.13, "screen", 2)}
        {/* 楕円ビネット */}
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(ellipse 74% 62% at 50% 46%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.88) 100%)",
            mixBlendMode: "multiply",
          }}
        />
      </>
    );
  }

  // 色収差のずれ量: 画面幅の約0.4%、ほぼ下方向の斜めベクトル（R/Bで正負逆）
  const abDx = Math.max(1, Math.round(width * 0.0012));
  const abDy = Math.max(2, Math.round(width * 0.0032));

  return (
    <AbsoluteFill
      style={{ isolation: "isolate", backgroundColor: "#000", pointerEvents: "none" }}
    >
      {/* 素の入力映像は常時フルで敷く（ルック0のとき素通し） */}
      <AbsoluteFill>{children}</AbsoluteFill>
      {/* 加工済みルック層群をマスター不透明度でクロスフェード */}
      <AbsoluteFill style={{ opacity: env }}>{look}</AbsoluteFill>

      {/* CSSの filter:url() 参照用の隠しSVG（同一DOM内・幅高さ0） */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <defs>
          {/* 輝度→暖色ランプ写像（暗部=焦げ茶→中間=オレンジ→明部=白） */}
          <filter id={`${uid}-ramp`} colorInterpolationFilters="sRGB">
            <feComponentTransfer>
              <feFuncR type="table" tableValues="0.07 0.40 0.82 1 1" />
              <feFuncG type="table" tableValues="0.02 0.13 0.38 0.72 1" />
              <feFuncB type="table" tableValues="0.01 0.05 0.10 0.40 0.95" />
            </feComponentTransfer>
          </filter>

          {/* 色収差: R/Bを正負逆の斜めベクトルへずらし、薄ブラー後にscreen再合成 */}
          <filter
            id={`${uid}-aberration`}
            x="-10%"
            y="-10%"
            width="120%"
            height="120%"
            colorInterpolationFilters="sRGB"
          >
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="chR"
            />
            <feOffset in="chR" dx={abDx} dy={abDy} result="chRo" />
            <feGaussianBlur in="chRo" stdDeviation="1" result="chRb" />
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="chG"
            />
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
              result="chB"
            />
            <feOffset in="chB" dx={-abDx} dy={-abDy} result="chBo" />
            <feGaussianBlur in="chBo" stdDeviation="1" result="chBb" />
            <feBlend in="chRb" in2="chG" mode="screen" result="chRG" />
            <feBlend in="chRG" in2="chBb" mode="screen" />
          </filter>

          {/* 彩度0→3×3ラプラシアン→強ゲインの白線化 */}
          <filter id={`${uid}-edge`} colorInterpolationFilters="sRGB">
            <feColorMatrix type="saturate" values="0" />
            <feConvolveMatrix
              order="3"
              kernelMatrix="0 -1 0 -1 4 -1 0 -1 0"
              preserveAlpha="true"
            />
            <feComponentTransfer>
              <feFuncR type="linear" slope="6" intercept="0" />
              <feFuncG type="linear" slope="6" intercept="0" />
              <feFuncB type="linear" slope="6" intercept="0" />
            </feComponentTransfer>
          </filter>
        </defs>
      </svg>
    </AbsoluteFill>
  );
};
