import React, { useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Anton";

const { fontFamily: ANTON } = loadFont("normal", {
  weights: ["400"],
  subsets: ["latin"],
});

/**
 * ArtisticDuotone01 — クリーンルーム再実装
 *
 * 派手なデュオトーン・アートフィルタで文字を塗り替える6秒タイトル。
 *
 * 画面いっぱいにスペクトルカラーの斜めバンドが交差するパッチワーク・
 * フィールドを敷き、その上に同じスペクトルで塗った極太コンデンス見出しを
 * 重ねる。見出しはダークエッジと柔らかな光のハローで下地から浮かせ、
 * 塗りのグラデーションがゆっくり横に流れて「文字を塗り替える」印象を作る。
 * 全体は 1s フェードイン → 保持 → 終端フェードアウトのエンベロープで出入り。
 *
 * 機能記述「派手なデュオトーン・アートフィルタで文字を塗り替える6秒タイトル」
 * を出発点に、旧レンダリング（見た目のものさし）と同等以上の質感を
 * 白紙から構成したもの。
 */
export type ArtisticDuotone4R2NProps = {
  /** 表示する文言 */
  text?: string;
  /** 演出全体の尺（フレーム）。省略時はコンポジションの尺 */
  durationInFrames?: number;
  /** 文字サイズ(px) */
  fontSize?: number;
  /** フォント（既定は Anton = Google Fonts、配布可） */
  fontFamily?: string;
  /** 字間(px) */
  letterSpacing?: number;
  /** 大文字化するか */
  uppercase?: boolean;
  /** 文字の中心位置 X（0〜1、画面幅比） */
  posX?: number;
  /** 文字の中心位置 Y（0〜1、画面高比） */
  posY?: number;
  /** スペクトルパレット（背景バンドと文字塗りの両方に使う） */
  palette?: string[];
  /** 文字グラデ終端の締め色（最後の1文字あたりが沈む色） */
  inkColor?: string;
  /** バンドの交差角（度）。第1層は +angle、第2層は 180-angle */
  bandAngle?: number;
  /** 第2層（交差側）バンドの透け具合 0〜1 */
  crossOpacity?: number;
  /** 背景全体の彩度ブースト（1で等倍） */
  saturation?: number;
  /** 細ストライプ（紙目テクスチャ）の濃さ 0〜1 */
  stripeStrength?: number;
  /** 背景がゆっくり流れる量(px)。0で完全静止 */
  driftPx?: number;
  /** キラキラ（4点グリント）の個数 */
  sparkleCount?: number;
  /** キラキラ等の配置シード */
  seed?: number;
  /** フェードイン所要（秒） */
  fadeInSeconds?: number;
  /** フェードアウト所要（秒） */
  fadeOutSeconds?: number;
  /** 文字グラデが1周流れるのにかける時間（秒）。0で静止 */
  paintCycleSeconds?: number;
  /** 入りで文字がわずかに縮んで決まるスケール演出の強さ（1で無し） */
  settleFromScale?: number;
};

/** 決定的な擬似乱数（seed 固定で毎フレーム同じ並びを返す） */
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

/** パレットをハードストップの帯に展開した linear-gradient を作る */
const bandsGradient = (angleDeg: number, colors: string[]) => {
  const n = colors.length;
  const stops = colors
    .map((c, i) => `${c} ${(i / n) * 100}% ${((i + 1) / n) * 100}%`)
    .join(", ");
  return `linear-gradient(${angleDeg}deg, ${stops})`;
};

/** 4点グリント（十字の光条＋中心のコア） */
const Glint: React.FC<{
  x: number;
  y: number;
  size: number;
  opacity: number;
}> = ({ x, y, size, opacity }) => (
  <div
    style={{
      position: "absolute",
      left: x - size / 2,
      top: y - size / 2,
      width: size,
      height: size,
      opacity,
      pointerEvents: "none",
    }}
  >
    {/* 4本の光条（中心から先細り） */}
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: `
          linear-gradient(0deg, transparent 40%, rgba(255,255,255,0.95) 50%, transparent 60%),
          linear-gradient(90deg, transparent 40%, rgba(255,255,255,0.95) 50%, transparent 60%)
        `,
        WebkitMaskImage:
          "radial-gradient(circle, rgba(0,0,0,1) 0%, rgba(0,0,0,0.85) 35%, rgba(0,0,0,0) 72%)",
        maskImage:
          "radial-gradient(circle, rgba(0,0,0,1) 0%, rgba(0,0,0,0.85) 35%, rgba(0,0,0,0) 72%)",
      }}
    />
    {/* 中心のコア */}
    <div
      style={{
        position: "absolute",
        inset: "26%",
        borderRadius: "50%",
        background:
          "radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 62%)",
      }}
    />
  </div>
);

export const ArtisticDuotone01: React.FC<ArtisticDuotone4R2NProps> = ({
  text = "RADIANT",
  durationInFrames,
  fontSize = 170,
  fontFamily = ANTON,
  letterSpacing = 3,
  uppercase = true,
  posX = 0.5,
  posY = 0.5,
  palette = [
    "#18a8c9",
    "#19e468",
    "#52e14b",
    "#ffb93a",
    "#ff7a35",
    "#f03434",
  ],
  inkColor = "#451337",
  bandAngle = 45,
  crossOpacity = 0.42,
  saturation = 1.5,
  stripeStrength = 0.05,
  driftPx = 24,
  sparkleCount = 10,
  seed = 7,
  fadeInSeconds = 1,
  fadeOutSeconds = 1,
  paintCycleSeconds = 12,
  settleFromScale = 1.045,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames: compDuration } =
    useVideoConfig();
  const dur = durationInFrames ?? compDuration;

  // ---- 全体エンベロープ: フェードイン → 保持 → 終端フェードアウト ----
  const fadeInF = Math.max(1, Math.round(fadeInSeconds * fps));
  const fadeOutF = Math.max(1, Math.round(fadeOutSeconds * fps));
  const envelope = interpolate(
    frame,
    [0, fadeInF, Math.max(fadeInF + 1, dur - fadeOutF), Math.max(fadeInF + 2, dur - 1)],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // ---- 背景のゆっくりしたドリフト ----
  const drift = dur > 1 ? (frame / (dur - 1)) * driftPx : 0;

  // ---- 斜めバンド2層のパッチワーク ----
  // 両層とも寒色→暖色のスペクトル順（横方向の色の流れを保つ）。
  // 交差層は色順を1段ずらすことで、隣り合う色同士は澄んだ混色、
  // 端の折り返し部分だけブラウン系の落ち着いたパッチが生まれる。
  const bandsA = useMemo(
    () =>
      bandsGradient(bandAngle, [
        ...palette.slice(-1),
        ...palette.slice(0, -1),
      ]),
    [bandAngle, palette]
  );
  const bandsB = useMemo(
    () => bandsGradient(180 - bandAngle, palette),
    [bandAngle, palette]
  );

  // ---- キラキラ（決定的配置 + ゆらぎ） ----
  const sparkles = useMemo(() => {
    const rnd = makeRandom(seed);
    return Array.from({ length: sparkleCount }, () => ({
      x: rnd() * width,
      y: rnd() * height,
      size: 14 + rnd() * 30,
      phase: rnd() * Math.PI * 2,
      speed: 0.5 + rnd() * 1.2,
    }));
  }, [seed, sparkleCount, width, height]);

  // ---- 文字塗り: スペクトルグラデ + ゆっくり揺れる「塗り替え」 ----
  // 全スペクトルが常に見える幅のまま、塗りの位相だけがゆっくり往復する
  const paintShift =
    paintCycleSeconds > 0
      ? 50 + 50 * Math.sin((frame / fps / paintCycleSeconds) * Math.PI * 2)
      : 0;
  const textStops = useMemo(() => {
    const cols = [...palette, inkColor];
    return cols
      .map((c, i) => `${c} ${(i / (cols.length - 1)) * 100}%`)
      .join(", ");
  }, [palette, inkColor]);

  // 入りでわずかに縮んで決まる（フェードインと同じ窓）
  const settle = interpolate(frame, [0, fadeInF], [settleFromScale, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const shown = uppercase ? text.toUpperCase() : text;

  return (
    <AbsoluteFill style={{ opacity: envelope }}>
      {/* 斜めバンド2層のパッチワーク（彩度ブースト込み） */}
      <AbsoluteFill style={{ filter: `saturate(${saturation})` }}>
        <AbsoluteFill
          style={{
            background: bandsA,
            transform: `translate(${-drift}px, ${drift * 0.4}px) scale(1.06)`,
          }}
        />
        <AbsoluteFill
          style={{
            background: bandsB,
            opacity: crossOpacity,
            transform: `translate(${drift * 0.6}px, ${drift * 0.25}px) scale(1.06)`,
          }}
        />
      </AbsoluteFill>

      {/* 紙目のような細い斜めストライプ */}
      <AbsoluteFill
        style={{
          background: `repeating-linear-gradient(${bandAngle}deg, rgba(255,255,255,${stripeStrength}) 0px 1px, transparent 1px 7px)`,
        }}
      />

      {/* うっすら中心を持ち上げるライト */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 50% 48%, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 70%)",
        }}
      />

      {/* キラキラ（4点グリント） */}
      <AbsoluteFill>
        {sparkles.map((s, i) => {
          const tw =
            0.35 + 0.65 * (0.5 + 0.5 * Math.sin(s.phase + (frame / fps) * s.speed * Math.PI));
          return (
            <Glint key={i} x={s.x} y={s.y} size={s.size} opacity={tw * 0.8} />
          );
        })}
      </AbsoluteFill>

      {/* 見出し */}
      <AbsoluteFill>
        <div
          style={{
            position: "absolute",
            left: `${posX * 100}%`,
            top: `${posY * 100}%`,
            transform: `translate(-50%, -50%) scale(${settle})`,
            whiteSpace: "pre",
            textAlign: "center",
            // 柔らかな光のハローと落ち影で下地から浮かせる
            filter:
              "drop-shadow(0 0 16px rgba(255,255,255,0.5)) drop-shadow(3px 5px 4px rgba(30,10,40,0.5))",
          }}
        >
          <span
            style={{
              fontFamily,
              fontSize,
              fontWeight: 400,
              letterSpacing,
              lineHeight: 1.1,
              backgroundImage: `linear-gradient(180deg, rgba(255,255,255,0.32) 0%, rgba(255,255,255,0) 52%), linear-gradient(90deg, ${textStops})`,
              backgroundSize: "112% 100%",
              backgroundPosition: `${paintShift}% 0%`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              WebkitTextStroke: "1.5px rgba(52,20,58,0.55)",
            }}
          >
            {shown}
          </span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export default ArtisticDuotone01;
