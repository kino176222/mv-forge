import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";
import { loadFont as loadNotoSansJP } from "@remotion/google-fonts/NotoSansJP";

/**
 * ArtisticBeamMLLK — クリーンルーム再実装
 *
 * 荘厳に発光する光柱と色収差のアーティスティックタイトル。
 * 極暗のネイビー空間に、左右一対の縦光柱（白いコアと暖色のハロー）が
 * 静かに立ち上がり、中央にはワイドトラッキングの細身大文字タイトルが
 * RGB分離（赤/シアンのフリンジ）とグロートで浮かび上がる。
 * タイトル背後には横方向のフォグ帯、全体には呼吸する光のゆらぎ、
 * モノクログレイン、ヴィネットを重ねてシネマティックに仕上げる。
 *
 * 機能記述「荘厳に発光する光柱と色収差のアーティスティックタイトル」を
 * 出発点に、旧レンダリング（見た目のものさし）と同等以上の質感を
 * 白紙から構成したもの。旧実装のコード・定数は参照していない。
 *
 * 既定フォントは配布可能な Google Fonts（Montserrat + Noto Sans JP）。
 * Mac内蔵限定フォントには依存しない。
 */

// 既定フォント: 幾何学系ライトウェイトのサンセリフ。和文は Noto Sans JP に落ちる。
const montserrat = loadMontserrat("normal", {
  subsets: ["latin"],
  weights: ["200"],
});
const notoSansJP = loadNotoSansJP("normal", {
  subsets: ["latin", "japanese"],
  weights: ["200"],
});
const DEFAULT_FONT_FAMILY = `${montserrat.fontFamily}, ${notoSansJP.fontFamily}, sans-serif`;

/** モノクログレイン（SVG feTurbulence を data URI 化した 128px タイル） */
const GRAIN_TILE = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="128" height="128" filter="url(#g)"/></svg>`
)}`;

export type ArtisticBeamMLLKProps = {
  /** 表示する文言 */
  text?: string;
  /** 演出全体の尺（フレーム）。省略時はコンポジション尺 */
  durationInFrames?: number;
  /** 文字サイズ(px, 1080p基準) */
  fontSize?: number;
  /** フォント（既定は Montserrat + Noto Sans JP。配布可能） */
  fontFamily?: string;
  /** 文字の太さ（既定はライトウェイト） */
  fontWeight?: number | string;
  /** 字間（fontSize に対する em 倍率）。ワイドトラッキングが持ち味 */
  letterSpacingEm?: number;
  /** 欧文を大文字化するか */
  uppercase?: boolean;
  /** 文字色（わずかに青みの白） */
  textColor?: string;
  /** タイトル中心の Y 位置（0〜1、画面高比） */
  posY?: number;
  /** 背景ベース色（極暗ネイビー） */
  backgroundColor?: string;
  /** 背景の持ち上がり色（空間の奥行き） */
  backgroundGlowColor?: string;
  /** ヴィネットの強さ（0〜1） */
  vignetteStrength?: number;
  /** 左光柱の X 位置（0〜1、画面幅比） */
  beamLeftX?: number;
  /** 右光柱の X 位置（0〜1、画面幅比） */
  beamRightX?: number;
  /** 光柱の中心 Y（0〜1、画面高比） */
  beamCenterY?: number;
  /** 光柱の高さ（0〜1、画面高比） */
  beamHeight?: number;
  /** 光柱ハローの幅(px, 1080p基準) */
  beamWidth?: number;
  /** 光柱コアの色 */
  beamCoreColor?: string;
  /** 光柱ハローの色（暖色寄りの生成り） */
  beamHaloColor?: string;
  /** 光柱の明るさ（0〜1目安） */
  beamIntensity?: number;
  /** 色収差のズレ量(px)。定常時の値で、出入りでは自動的に増える */
  splitPx?: number;
  /** 色収差 暖色側の色 */
  splitWarmColor?: string;
  /** 色収差 寒色側の色 */
  splitCoolColor?: string;
  /** タイトルのグロー強度（0〜1目安） */
  glowStrength?: number;
  /** タイトル背後のフォグ帯の濃さ（0〜1目安） */
  fogIntensity?: number;
  /** タイトル上を横切るシーン（艶）光の強さ（0〜1目安） */
  sheenIntensity?: number;
  /** グレインの濃さ（0で無効） */
  grainOpacity?: number;
  /** フェードイン秒 */
  fadeInSec?: number;
  /** フェードアウト秒 */
  fadeOutSec?: number;
};

/** 片側の光柱。コア（白）+ ハロー（暖色）+ 微細な色フリンジで構成 */
const Beam: React.FC<{
  x: number;
  centerY: number;
  height: number;
  width: number;
  coreColor: string;
  haloColor: string;
  opacity: number;
  scale: number;
}> = ({ x, centerY, height, width, coreColor, haloColor, opacity, scale }) => {
  const maskV =
    "linear-gradient(180deg, transparent 0%, #000 14%, #000 84%, transparent 100%)";
  return (
    <div
      style={{
        position: "absolute",
        left: `calc(${x * 100}% - ${width / 2}px)`,
        top: `${(centerY - (height * scale) / 2) * 100}%`,
        width,
        height: `${height * scale * 100}%`,
        opacity,
        WebkitMaskImage: maskV,
        maskImage: maskV,
      }}
    >
      {/* 広いハロー（暖色寄り） */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(90deg, transparent 0%, ${haloColor} 50%, transparent 100%)`,
          filter: "blur(10px)",
          opacity: 0.5,
        }}
      />
      {/* 中間のグロー */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: "50%",
          width: width * 0.3,
          transform: "translateX(-50%)",
          background: `linear-gradient(90deg, transparent, ${coreColor}, transparent)`,
          filter: "blur(6px)",
          opacity: 0.65,
        }}
      />
      {/* 白いコアライン */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: "50%",
          width: 3,
          transform: "translateX(-50%)",
          background: coreColor,
          filter: "blur(0.6px)",
          boxShadow: `0 0 10px ${coreColor}, 0 0 26px rgba(245, 240, 228, 0.5)`,
        }}
      />
      {/* プリズムの名残: コア両脇のごく淡い青/橙フリンジ */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: "50%",
          width: 2,
          transform: `translateX(${-width * 0.11}px)`,
          background: "rgba(140, 190, 255, 0.5)",
          filter: "blur(2.5px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: "50%",
          width: 2,
          transform: `translateX(${width * 0.09}px)`,
          background: "rgba(255, 190, 120, 0.4)",
          filter: "blur(2.5px)",
        }}
      />
    </div>
  );
};

export const ArtisticBeamMLLK: React.FC<ArtisticBeamMLLKProps> = ({
  text = "Almost Here",
  durationInFrames,
  fontSize = 96,
  fontFamily = DEFAULT_FONT_FAMILY,
  fontWeight = 200,
  letterSpacingEm = 0.42,
  uppercase = true,
  textColor = "#eef4fb",
  posY = 0.51,
  backgroundColor = "#04070d",
  backgroundGlowColor = "#16243c",
  vignetteStrength = 0.5,
  beamLeftX = 0.165,
  beamRightX = 0.79,
  beamCenterY = 0.62,
  beamHeight = 0.64,
  beamWidth = 96,
  beamCoreColor = "#f7f4ee",
  beamHaloColor = "rgba(206, 196, 178, 0.85)",
  beamIntensity = 1,
  splitPx = 5,
  splitWarmColor = "#ff2b3c",
  splitCoolColor = "#1ee6ff",
  glowStrength = 1,
  fogIntensity = 0.5,
  sheenIntensity = 0.35,
  grainOpacity = 0.05,
  fadeInSec = 0.85,
  fadeOutSec = 0.9,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames: compDuration, height } = useVideoConfig();
  const total = durationInFrames ?? compDuration;
  const scale = height / 1080; // 1080p基準の px 指定をコンポジション解像度に追従させる

  const inFrames = Math.max(1, Math.round(fadeInSec * fps));
  const outFrames = Math.max(1, Math.round(fadeOutSec * fps));
  const outStart = Math.max(inFrames, total - outFrames);

  // 出入りのエンベロープ（0→1→0）
  const envIn = interpolate(frame, [0, inFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const envOut = interpolate(frame, [outStart, total - 1], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.quad),
  });
  const env = envIn * envOut;

  // 白レイヤーは色レイヤーより一拍遅れて満ちる → 立ち上がりで色収差が先に見える
  const envWhite =
    interpolate(frame, [inFrames * 0.3, inFrames * 1.15], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }) * envOut;

  // 色収差: 定常 splitPx、出入りでは広がる
  const splitNow =
    (splitPx + (1 - env) * splitPx * 1.6) * scale;

  // 立ち上がりの残像ブラー（フェードアウトはブラーせず暗くなるだけ）
  const blurNow = interpolate(envIn, [0, 1], [7, 0]) * scale;

  // 光柱の呼吸（ゆっくり明滅、左右で位相をずらす）
  const breatheL = 0.86 + 0.14 * Math.sin((frame / fps) * 1.7);
  const breatheR = 0.86 + 0.14 * Math.sin((frame / fps) * 1.7 + 2.1);
  // 光柱は下から静かに伸び上がる
  const beamGrow = interpolate(envIn, [0, 1], [0.55, 1]);

  // タイトル上を横切るシーン光（ゆっくり一往復弱）
  const sheenX = interpolate(
    frame,
    [0, total],
    [30, 70],
    { extrapolateRight: "clamp" }
  );

  // グレインのタイルオフセット（決定的な擬似乱数でフレームごとにずらす）
  const grainX = ((frame * 97) % 128) - 64;
  const grainY = ((frame * 53) % 128) - 64;

  const displayText = uppercase ? text.toUpperCase() : text;

  const titleCommon: React.CSSProperties = useMemo(
    () => ({
      position: "absolute",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily,
      fontWeight,
      fontSize: fontSize * scale,
      letterSpacing: `${letterSpacingEm}em`,
      whiteSpace: "pre",
      // 字間ぶん右に寄るのを最後の字間の半分だけ戻して光学中央に置く
      paddingLeft: `${letterSpacingEm}em`,
    }),
    [fontFamily, fontWeight, fontSize, scale, letterSpacingEm]
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor,
        overflow: "hidden",
      }}
    >
      {/* 空間の奥行き: 上方の淡い持ち上がり + 足元のリフト */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(120% 90% at 72% 12%, ${backgroundGlowColor} 0%, transparent 55%),
            radial-gradient(140% 60% at 50% 108%, ${backgroundGlowColor} 0%, transparent 60%)`,
          opacity: 0.9,
        }}
      />

      {/* 左右の光柱 */}
      <Beam
        x={beamLeftX}
        centerY={beamCenterY}
        height={beamHeight}
        width={beamWidth * scale}
        coreColor={beamCoreColor}
        haloColor={beamHaloColor}
        opacity={env * beamIntensity * breatheL}
        scale={beamGrow}
      />
      <Beam
        x={beamRightX}
        centerY={beamCenterY}
        height={beamHeight}
        width={beamWidth * scale}
        coreColor={beamCoreColor}
        haloColor={beamHaloColor}
        opacity={env * beamIntensity * breatheR}
        scale={beamGrow}
      />

      {/* タイトル背後のフォグ帯（横に伸びる淡い光溜まり） */}
      <div
        style={{
          position: "absolute",
          left: "18%",
          right: "18%",
          top: `${(posY - 0.1) * 100}%`,
          height: "20%",
          background:
            "radial-gradient(50% 85% at 52% 50%, rgba(150, 175, 210, 0.20) 0%, rgba(120, 145, 185, 0.06) 60%, transparent 100%)",
          filter: "blur(30px)",
          opacity: envWhite * fogIntensity,
        }}
      />

      {/* タイトル群（色収差3層 + シーン光） */}
      <AbsoluteFill
        style={{
          top: `${(posY - 0.5) * 100}%`,
          filter: blurNow > 0.2 ? `blur(${blurNow}px)` : undefined,
        }}
      >
        {/* 暖色チャンネル（左へズレる） */}
        <div
          style={{
            ...titleCommon,
            color: splitWarmColor,
            transform: `translateX(${-splitNow}px)`,
            opacity: env * 0.9,
            mixBlendMode: "screen",
          }}
        >
          {displayText}
        </div>
        {/* 寒色チャンネル（右へズレる） */}
        <div
          style={{
            ...titleCommon,
            color: splitCoolColor,
            transform: `translateX(${splitNow}px)`,
            opacity: env * 0.9,
            mixBlendMode: "screen",
          }}
        >
          {displayText}
        </div>
        {/* 本体（白）+ グロー */}
        <div
          style={{
            ...titleCommon,
            color: textColor,
            opacity: envWhite,
            textShadow: `0 0 ${1.6 * scale}px ${textColor}, 0 0 ${14 * scale * glowStrength}px rgba(205, 225, 255, ${0.6 * glowStrength}), 0 0 ${56 * scale * glowStrength}px rgba(140, 170, 230, ${0.32 * glowStrength})`,
          }}
        >
          {displayText}
        </div>
        {/* シーン光: タイトル帯をゆっくり流れる艶 */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "44%",
            height: "12%",
            background: `radial-gradient(18% 100% at ${sheenX}% 50%, rgba(190, 210, 240, 0.5) 0%, transparent 100%)`,
            filter: "blur(14px)",
            opacity: env * sheenIntensity,
            mixBlendMode: "screen",
          }}
        />
      </AbsoluteFill>

      {/* モノクログレイン（自動アニメ） */}
      {grainOpacity > 0 ? (
        <AbsoluteFill
          style={{
            backgroundImage: `url("${GRAIN_TILE}")`,
            backgroundRepeat: "repeat",
            backgroundPosition: `${grainX}px ${grainY}px`,
            opacity: grainOpacity,
            mixBlendMode: "overlay",
          }}
        />
      ) : null}

      {/* ヴィネット */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(115% 95% at 50% 46%, transparent 55%, rgba(0, 0, 0, ${vignetteStrength}) 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};

export default ArtisticBeamMLLK;
