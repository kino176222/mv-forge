/**
 * GrainLook01 — クリーンルーム再実装（外部非参照）。
 *
 * 機能記述: 「密な色付きフィルムグレインと退色・周辺減光でアナログ質感を出す、
 * タイトル用のLOOK（オーバーレイ）」。
 * - 画面全体に毎フレーム揺らぐ細かいカラーグレイン（色ノイズ）を重ねる。
 * - 黒が浮いた退色（フェード）トーン＋大きなムラ（モットル）でフィルムの質感。
 * - 周辺減光（ビネット）で四隅を落とし、映写機のような露光エンベロープ
 *   （暗転→白飛びフラッシュ→定着→終端フラッシュ→暗転）で入退場する。
 * - 中央に極太大文字サンセリフのタイトル。text を空にすれば LOOK のみとして
 *   フッテージへのオーバーレイにも使える。
 *
 * 既定フォントは Google Fonts の Archivo（weight 700、欧文）＋ Noto Sans JP
 * （weight 700、和文）。@remotion/google-fonts 経由でバンドル読込するため、
 * Mac内蔵限定フォントに依存しない。fontFamily prop で差し替え可。
 */
import React, { useId } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadArchivo } from "@remotion/google-fonts/Archivo";
import { loadFont as loadNotoSansJP } from "@remotion/google-fonts/NotoSansJP";

const archivo = loadArchivo("normal", { weights: ["700"], subsets: ["latin"] });
const notoSansJP = loadNotoSansJP("normal", { weights: ["700"] });

/** 決定論的な 0..1 ハッシュ（フレームごとの微妙な露光ゆらぎ用） */
const hash01 = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export interface GrainLookV9X3Props {
  /** タイトル本文（既定で大文字表示）。空文字なら LOOK のみ */
  text?: string;
  /** 総尺(フレーム)。省略時はコンポジションの尺。終端フラッシュがこれに追随 */
  durationInFrames?: number;
  /** 乱数シード（グレインパターンの個体差） */
  seed?: number;

  // ---- タイトル ----
  /** 文字サイズ(px) */
  fontSize?: number;
  /** フォント。既定は Archivo + Noto Sans JP（Google Fonts, 配布可） */
  fontFamily?: string;
  /** ウェイト（極太が身上） */
  fontWeight?: number;
  /** 文字色（わずかに退色したオフホワイト） */
  textColor?: string;
  /** 字間(em) */
  letterSpacingEm?: number;
  /** タイトル中心の縦位置（0=上端, 1=下端） */
  verticalPosition?: number;
  /** 大文字化を無効にしたいとき false */
  uppercase?: boolean;
  /** 文字のソフトさ(px)。フィルムらしい滲み */
  textSoftnessPx?: number;

  // ---- グレイン / 退色 ----
  /** グレイン強度 0〜1 */
  grainIntensity?: number;
  /** グレインの細かさ（SVG feTurbulence の baseFrequency） */
  grainFrequency?: number;
  /** グレインの色乗り 0(モノクロ)〜1(フルカラー) */
  grainChroma?: number;
  /** グレインパターンを保持するフレーム数（1=毎フレーム揺らぐ） */
  grainHoldFrames?: number;
  /** 黒浮き（退色）の量 0〜1 */
  fadeLift?: number;
  /** 大きな露光ムラ（モットル）の強度 0〜1 */
  mottleIntensity?: number;

  // ---- 周辺減光 ----
  /** ビネット強度 0〜1 */
  vignetteStrength?: number;

  // ---- 露光エンベロープ（タイミング, フレーム） ----
  /** 冒頭の暗転が明けるまでの長さ */
  fadeInFrames?: number;
  /** 冒頭フラッシュのピーク位置 */
  flashInPeakFrame?: number;
  /** 冒頭フラッシュが収まる位置 */
  flashInEndFrame?: number;
  /** 終端フラッシュのピーク（終端からのオフセット） */
  flashOutPeakOffset?: number;
  /** 終端フラッシュの立ち上がり（終端からのオフセット） */
  flashOutStartOffset?: number;
  /** 終端の暗転の長さ */
  fadeOutFrames?: number;
  /** フラッシュ（白飛び）の最大濃度 0〜1 */
  flashOpacity?: number;
  /** 露光の微小フリッカー量 0〜1 */
  flickerAmount?: number;
}

/** feTurbulence ベースのフルフレーム・ノイズ矩形 */
const NoiseRect: React.FC<{
  filterId: string;
  baseFrequency: number;
  octaves: number;
  seed: number;
  saturation: number;
  contrast: number;
  /** 出力の明るさオフセット（screen 合成時の黒浮きを抑える等） */
  bias?: number;
  blend: React.CSSProperties["mixBlendMode"];
  opacity: number;
}> = ({
  filterId,
  baseFrequency,
  octaves,
  seed,
  saturation,
  contrast,
  bias = 0,
  blend,
  opacity,
}) => {
  // コントラストを 0.5 中心に上げ下げする linear 伝達関数
  const slope = contrast;
  const intercept = 0.5 * (1 - contrast) + bias;
  return (
    <svg
      width="100%"
      height="100%"
      style={{
        position: "absolute",
        inset: 0,
        mixBlendMode: blend,
        opacity,
        pointerEvents: "none",
      }}
    >
      <filter id={filterId} x="0" y="0" width="100%" height="100%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency={baseFrequency}
          numOctaves={octaves}
          seed={seed}
          stitchTiles="stitch"
        />
        <feComponentTransfer>
          <feFuncR type="linear" slope={slope} intercept={intercept} />
          <feFuncG type="linear" slope={slope} intercept={intercept} />
          <feFuncB type="linear" slope={slope} intercept={intercept} />
          <feFuncA type="linear" slope={0} intercept={1} />
        </feComponentTransfer>
        <feColorMatrix type="saturate" values={String(saturation)} />
      </filter>
      <rect width="100%" height="100%" filter={`url(#${filterId})`} />
    </svg>
  );
};

export const GrainLook01: React.FC<GrainLookV9X3Props> = ({
  text = "ALMOST HERE",
  durationInFrames,
  seed = 9,
  fontSize = 144,
  fontFamily = `${archivo.fontFamily}, ${notoSansJP.fontFamily}, sans-serif`,
  fontWeight = 700,
  textColor = "#f3f2ef",
  letterSpacingEm = 0.035,
  verticalPosition = 0.49,
  uppercase = true,
  textSoftnessPx = 0.7,
  grainIntensity = 0.75,
  grainFrequency = 0.8,
  grainChroma = 0.75,
  grainHoldFrames = 1,
  fadeLift = 0.05,
  mottleIntensity = 0.28,
  vignetteStrength = 0.85,
  fadeInFrames = 10,
  flashInPeakFrame = 8,
  flashInEndFrame = 18,
  flashOutPeakOffset = 8,
  flashOutStartOffset = 17,
  fadeOutFrames = 7,
  flashOpacity = 0.7,
  flickerAmount = 0.05,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames: compDuration } = useVideoConfig();
  const D = durationInFrames ?? compDuration;
  const rawId = useId().replace(/:/g, "");

  // ---- 露光エンベロープ ----
  // 冒頭: 黒 → 白飛びフラッシュ → 定着
  const darkIn = interpolate(frame, [0, fadeInFrames], [0.94, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.quad),
  });
  const washIn = interpolate(
    frame,
    [1, flashInPeakFrame, flashInEndFrame],
    [0, flashOpacity, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.quad),
    }
  );
  // 終端: フラッシュ → 暗転
  const washOut = interpolate(
    frame,
    [
      D - flashOutStartOffset,
      D - flashOutPeakOffset,
      D - flashOutPeakOffset + 5,
    ],
    [0, flashOpacity, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.quad),
    }
  );
  const darkOut = interpolate(frame, [D - fadeOutFrames, D - 1], [0, 0.96], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.quad),
  });
  const wash = Math.max(washIn, washOut);
  const dark = Math.max(darkIn, darkOut);
  // 微小な露光フリッカー（決定論的）
  const flickerDark = hash01(frame * 7.13 + seed) * flickerAmount * 0.6;

  const grainSeed =
    seed * 101 + Math.floor(frame / Math.max(1, grainHoldFrames));
  const mottleSeed = seed * 13 + Math.floor(frame / 24);

  const displayText = uppercase ? text.toUpperCase() : text;

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {/* 退色（黒浮き）: LOOK の土台。下のフッテージ/黒地をチャコールに持ち上げる */}
      <AbsoluteFill
        style={{ backgroundColor: `rgba(203, 206, 210, ${fadeLift})` }}
      />

      {/* タイトル */}
      {displayText ? (
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            top: `${(verticalPosition - 0.5) * 200}%`,
          }}
        >
          <div
            style={{
              fontFamily,
              fontWeight,
              fontSize,
              color: textColor,
              letterSpacing: `${letterSpacingEm}em`,
              whiteSpace: "pre-wrap",
              textAlign: "center",
              padding: "0 4%",
              filter: `blur(${textSoftnessPx}px)`,
              textShadow: "0 0 18px rgba(255,255,255,0.12)",
            }}
          >
            {displayText}
          </div>
        </AbsoluteFill>
      ) : null}

      {/* 白飛びフラッシュ（露光の入・出）。グレインの下に置き、粒はフラッシュ中も乗る */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(120% 95% at 50% 44%, rgb(184, 186, 189) 0%, rgb(152, 153, 155) 58%, rgb(112, 113, 114) 100%)",
          opacity: wash,
        }}
      />

      {/* 大きな露光ムラ（モットル） */}
      <NoiseRect
        filterId={`${rawId}-mottle`}
        baseFrequency={0.0035}
        octaves={3}
        seed={mottleSeed}
        saturation={0}
        contrast={1}
        blend="overlay"
        opacity={mottleIntensity}
      />

      {/* 密なカラーグレイン: 中間調〜ハイライト用（overlay で強めに粒立てる） */}
      <NoiseRect
        filterId={`${rawId}-grain-mid`}
        baseFrequency={grainFrequency}
        octaves={2}
        seed={grainSeed}
        saturation={grainChroma}
        contrast={2.4}
        blend="overlay"
        opacity={grainIntensity}
      />

      {/* 密なカラーグレイン: シャドウ用（screen + 負バイアスで暗部にだけ粒を浮かせる） */}
      <NoiseRect
        filterId={`${rawId}-grain-shadow`}
        baseFrequency={grainFrequency}
        octaves={2}
        seed={grainSeed + 1013}
        saturation={grainChroma}
        contrast={2.2}
        bias={-0.25}
        blend="screen"
        opacity={grainIntensity * 0.5}
      />

      {/* 周辺減光（ビネット） */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(115% 100% at 50% 46%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.45) 78%, rgba(0,0,0,0.78) 100%)",
          opacity: vignetteStrength,
        }}
      />

      {/* 暗転＋微小フリッカー */}
      <AbsoluteFill
        style={{
          backgroundColor: "#050505",
          opacity: Math.min(1, dark + flickerDark),
        }}
      />
    </AbsoluteFill>
  );
};

export default GrainLook01;
