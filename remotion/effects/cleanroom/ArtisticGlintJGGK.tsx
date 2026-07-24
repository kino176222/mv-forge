import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadCinzel } from "@remotion/google-fonts/Cinzel";
import { loadFont as loadNotoSerifJP } from "@remotion/google-fonts/NotoSerifJP";

/**
 * ArtisticGlintJGGK — クリーンルーム再実装
 *
 * ムーディーな濃紺の背景に、暖色の光条（glint shafts）と中央フレアが
 * ゆっくり揺らめくアーティスティックタイトル。
 * 縦に走る琥珀色のシャフトが呼吸するように明滅し、中央の大きな
 * フレアがタイトルを背後から照らす。全体は静かにフェードインし、
 * 終端でフェードアウトする。粒状のフィルムグレインで質感を足す。
 *
 * 機能記述「ムーディーな濃紺の背景に、暖色の光条と中央フレアが差す
 * アーティスティックタイトル」を出発点に、旧レンダリング（見た目の
 * ものさし）と同等の質感を白紙から構成したもの。
 *
 * フォントは配布可能な Google Fonts（Cinzel + Noto Serif JP）を既定に
 * バンドルし、Mac内蔵限定フォントには依存しない。
 */

// 既定フォント：Trajan 系の風格を持つ Google Fonts のセリフ体。
// 和文が来た場合に備えて Noto Serif JP をフォールバックに連結する。
const cinzel = loadCinzel("normal", { subsets: ["latin"], weights: ["500"] });
const notoSerif = loadNotoSerifJP("normal", {
  subsets: ["latin", "japanese"],
  weights: ["500"],
});
const DEFAULT_FONT_FAMILY = `${cinzel.fontFamily}, ${notoSerif.fontFamily}, serif`;

export type ArtisticGlintJGGKProps = {
  /** 表示する文言 */
  text?: string;
  /** 演出全体の尺（フレーム）。フェードイン/アウトをこの中に収める */
  durationInFrames?: number;
  /** 文字サイズ(px) */
  fontSize?: number;
  /** フォント（既定は Cinzel + Noto Serif JP。配布可能） */
  fontFamily?: string;
  /** 文字の太さ */
  fontWeight?: number | string;
  /** 字間（fontSize に対する em 倍率） */
  letterSpacingEm?: number;
  /** 文字色（クリーム系） */
  textColor?: string;
  /** 文字を大文字化するか */
  uppercase?: boolean;
  /** タイトルの中心位置 Y（0〜1、画面高比） */
  posY?: number;
  /** 背景のベース色（濃紺） */
  baseColor?: string;
  /** 背景中心のわずかな持ち上がり色 */
  baseGlowColor?: string;
  /** 光条・フレアの暖色 */
  glintColor?: string;
  /** 光条の本数 */
  shaftCount?: number;
  /** 光条の強さ（0〜1目安） */
  shaftIntensity?: number;
  /** 光条の揺らぎ幅（px） */
  shaftDrift?: number;
  /** 中央フレアの強さ（0〜1目安） */
  flareIntensity?: number;
  /** 中央フレアの中心位置 X/Y（0〜1） */
  flareX?: number;
  flareY?: number;
  /** フィルムグレインの濃さ（0で無効） */
  grainOpacity?: number;
  /** 周辺減光の濃さ（0〜1） */
  vignetteStrength?: number;
  /** フェードイン所要（秒） */
  fadeInSeconds?: number;
  /** フェードアウト所要（秒） */
  fadeOutSeconds?: number;
  /** テキストが背景より遅れて現れる分（秒） */
  textDelaySeconds?: number;
  /** 光条の配置を変えるシード */
  seed?: number;
};

/** 決定的な擬似乱数（seed 固定で毎回同じ並びを返す） */
const makeRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** 0→1 のスムーズステップ */
const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** hex → "r,g,b" （rgba() 組み立て用） */
const hexToRgb = (hex: string): string => {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
};

type Shaft = {
  /** 画面幅比の中心位置 */
  x: number;
  /** 幅（画面幅比） */
  w: number;
  /** 基本強度 */
  strength: number;
  /** 明滅の位相 */
  phase: number;
  /** 明滅の速さ（rad/秒） */
  speed: number;
  /** 横揺らぎの位相 */
  driftPhase: number;
  /** 横揺らぎの速さ（rad/秒） */
  driftSpeed: number;
  /** ぼかしの強さ（px） */
  blur: number;
};

// SVG feTurbulence によるモノクロ粒状ノイズ（自己完結 data URI）
const GRAIN_URI = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0.6 0.6 0.6 0 0"/></filter><rect width="240" height="240" filter="url(#g)"/></svg>`
)}`;

export const ArtisticGlintJGGK: React.FC<ArtisticGlintJGGKProps> = ({
  text = "Radiant",
  durationInFrames,
  fontSize = 110,
  fontFamily = DEFAULT_FONT_FAMILY,
  fontWeight = 500,
  letterSpacingEm = 0.22,
  textColor = "#f6ecdd",
  uppercase = true,
  posY = 0.5,
  baseColor = "#0a111e",
  baseGlowColor = "#1a2334",
  glintColor = "#dd9038",
  shaftCount = 6,
  shaftIntensity = 0.8,
  shaftDrift = 70,
  flareIntensity = 0.9,
  flareX = 0.52,
  flareY = 0.44,
  grainOpacity = 0.06,
  vignetteStrength = 0.9,
  fadeInSeconds = 0.7,
  fadeOutSeconds = 0.9,
  textDelaySeconds = 0.1,
  seed = 7,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames: compDuration, width, height } =
    useVideoConfig();
  const total = durationInFrames ?? compDuration;
  const t = frame / fps; // 経過秒

  // ---- 全体フェード（背景ごと）----
  const fadeIn = smooth(frame / Math.max(1, fadeInSeconds * fps));
  const fadeOut = smooth(
    (total - 1 - frame) / Math.max(1, fadeOutSeconds * fps)
  );
  const globalOpacity = Math.min(fadeIn, fadeOut);

  // テキストは背景より一拍遅れて現れ、同じく先にフェードアウト
  const textIn = smooth(
    (frame - textDelaySeconds * fps) / Math.max(1, fadeInSeconds * fps)
  );
  const textOpacity = Math.min(textIn, fadeOut);

  // ---- 光条の配置（シード決定的）----
  const shafts = useMemo<Shaft[]>(() => {
    const rand = makeRandom(seed);
    const list: Shaft[] = [];
    for (let i = 0; i < shaftCount; i++) {
      // 中央寄りに集める（端は暗いまま残してムーディーさを保つ）
      const x = 0.5 + (rand() - 0.5) * 0.66;
      list.push({
        x,
        w: 0.02 + rand() * 0.06,
        strength: 0.35 + rand() * 0.65,
        phase: rand() * Math.PI * 2,
        speed: 0.25 + rand() * 0.5,
        driftPhase: rand() * Math.PI * 2,
        driftSpeed: 0.12 + rand() * 0.22,
        blur: 14 + rand() * 26,
      });
    }
    return list;
  }, [seed, shaftCount]);

  const glintRgb = hexToRgb(glintColor);
  const baseRgb = hexToRgb(baseColor);

  // 中央フレアのゆっくりした呼吸
  const flareBreath = 0.82 + 0.18 * Math.sin(t * 0.55 + 1.2);
  const flareAlpha = 0.5 * flareIntensity * flareBreath;

  // グレインの位置ジッタ（フレームごとに違う場所を見せる）
  const grainJitter = useMemo(() => {
    const rand = makeRandom(seed * 131 + frame * 7 + 1);
    return { x: Math.floor(rand() * 240), y: Math.floor(rand() * 240) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, seed]);

  const letterSpacing = `${letterSpacingEm}em`;

  return (
    <AbsoluteFill style={{ opacity: globalOpacity }}>
      {/* ベース：濃紺のムーディーなグラデーション ＋ 上方のかすかな暖色ヘイズ */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(110% 85% at 50% 44%, ${baseGlowColor} 0%, ${baseColor} 52%, rgba(${baseRgb},1) 68%, #030509 100%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(55% 45% at ${flareX * 100}% 10%, rgba(${glintRgb},${0.16 * flareIntensity}) 0%, rgba(${glintRgb},0) 70%)`,
          mixBlendMode: "screen",
        }}
      />

      {/* 光条レイヤー（screen 合成でふわっと足す） */}
      <AbsoluteFill style={{ overflow: "hidden" }}>
        {shafts.map((s, i) => {
          const flicker =
            0.55 + 0.45 * Math.sin(t * s.speed * Math.PI * 2 * 0.32 + s.phase);
          const drift =
            Math.sin(t * s.driftSpeed * Math.PI * 2 * 0.5 + s.driftPhase) *
            shaftDrift;
          const wPx = s.w * width;
          const alpha = 0.46 * shaftIntensity * s.strength * flicker;
          // 上から差す光らしく、下へ向かって減衰させる
          const falloff =
            "linear-gradient(180deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0.85) 45%, rgba(0,0,0,0.35) 80%, rgba(0,0,0,0.12) 100%)";
          const shaftStyle = (w: number, a: number, blur: number) =>
            ({
              position: "absolute",
              top: -height * 0.1,
              height: height * 1.2,
              left: s.x * width - w / 2,
              width: w,
              transform: `translateX(${drift}px)`,
              background: `linear-gradient(90deg, rgba(${glintRgb},0) 0%, rgba(${glintRgb},${a}) 50%, rgba(${glintRgb},0) 100%)`,
              filter: `blur(${blur}px)`,
              mixBlendMode: "screen",
              maskImage: falloff,
              WebkitMaskImage: falloff,
            }) as const;
          return (
            <React.Fragment key={i}>
              {/* 広いハロー */}
              <div style={shaftStyle(wPx, alpha, s.blur)} />
              {/* 細く明るい芯 */}
              <div
                style={shaftStyle(wPx * 0.32, alpha * 1.15, s.blur * 0.45)}
              />
            </React.Fragment>
          );
        })}
      </AbsoluteFill>

      {/* 中央フレア：大きな暖色の面光源 ＋ 縦のアナモルフィックな芯 */}
      <AbsoluteFill style={{ mixBlendMode: "screen" }}>
        <div
          style={{
            position: "absolute",
            left: (flareX - 0.5) * width,
            top: (flareY - 0.5) * height,
            width,
            height,
            background: `radial-gradient(50% 52% at 50% 50%, rgba(${glintRgb},${flareAlpha}) 0%, rgba(${glintRgb},${flareAlpha * 0.35}) 42%, rgba(${glintRgb},0) 72%)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: flareX * width - width * 0.035,
            top: -height * 0.1,
            width: width * 0.07,
            height: height * 1.2,
            background: `linear-gradient(90deg, rgba(${glintRgb},0) 0%, rgba(${glintRgb},${0.4 * flareIntensity * flareBreath}) 50%, rgba(${glintRgb},0) 100%)`,
            filter: "blur(18px)",
          }}
        />
      </AbsoluteFill>

      {/* 周辺減光（ムーディーさの締め） */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(95% 82% at 50% 48%, rgba(0,0,0,0) 46%, rgba(3,5,10,${0.55 * vignetteStrength}) 78%, rgba(2,3,7,${vignetteStrength}) 100%)`,
        }}
      />

      {/* タイトル */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: `${posY * 100}%`,
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "88%",
            textAlign: "center",
            fontFamily,
            fontWeight,
            fontSize,
            letterSpacing,
            color: textColor,
            opacity: textOpacity,
            whiteSpace: "pre-wrap",
            // 暖色のグローを内→外へ三層重ねる
            textShadow: [
              `0 0 ${fontSize * 0.12}px rgba(${glintRgb},0.55)`,
              `0 0 ${fontSize * 0.35}px rgba(${glintRgb},0.35)`,
              `0 0 ${fontSize * 0.9}px rgba(${glintRgb},0.22)`,
            ].join(", "),
          }}
        >
          {uppercase ? text.toUpperCase() : text}
        </div>
      </AbsoluteFill>

      {/* フィルムグレイン */}
      {grainOpacity > 0 ? (
        <AbsoluteFill
          style={{
            backgroundImage: `url("${GRAIN_URI}")`,
            backgroundRepeat: "repeat",
            backgroundPosition: `${grainJitter.x}px ${grainJitter.y}px`,
            opacity: grainOpacity,
            mixBlendMode: "overlay",
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

export default ArtisticGlintJGGK;
