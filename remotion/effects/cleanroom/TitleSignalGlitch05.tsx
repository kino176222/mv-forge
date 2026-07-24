import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";

/**
 * TitleSignalGlitch05 — クリーンルーム再実装
 *
 * 「三色（RGB）が収束して定着するグリッチタイトル」。
 * R/G/B のチャンネルクローンが上下から滑り込みながら文字送りで現れ、
 * 収束の瞬間に水平スライスの発作（チャンネルごとに独立したずれ）を挟んで
 * 白いタイトルへ定着する。定着後は三色アンダーラインとタイプライター字幕、
 * シアン/赤の矩形がまばらに明滅してデジタルのノイズ感を保ち、
 * 終端では再び三色に分離して闇へ溶ける。
 *
 * 機能記述「三色（RGB）が収束して定着するグリッチタイトル。」を出発点に、
 * 旧レンダリング（見た目のものさし）と同等以上の質感を白紙から構成したもの。
 *
 * 既定フォントは Google Fonts（Montserrat）を @remotion/google-fonts 経由で
 * バンドル読込するため、Mac 内蔵フォントに依存せず配布可能。
 */

const montserrat = loadMontserrat("normal", {
  weights: ["300", "400"],
  subsets: ["latin"],
  ignoreTooManyRequestsWarning: true,
});

export interface TitleGlitch05Props {
  /** タイトル本文（大文字化して表示） */
  text: string;
  /** 尺（フレーム, 24fps想定） */
  durationInFrames: number;
  /** 下段のタイプライター字幕。空文字で非表示 */
  subtitle?: string;
  /** タイトルの文字サイズ(px) */
  fontSize?: number;
  /** フォント。既定は Montserrat（配布可能） */
  fontFamily?: string;
  /** 定着後のタイトル色 */
  textColor?: string;
  /** アクセント色A（寒色系。上側クローン/アンダーライン左端/矩形） */
  accentCool?: string;
  /** アクセント色B（暖色系。下側クローン/アンダーライン右端/矩形） */
  accentWarm?: string;
  /** 収束前の上下クローンの離れ幅(px) */
  spread?: number;
  /** 収束にかけるフレーム数 */
  convergeFrames?: number;
  /** 終端の分離＋消灯にかけるフレーム数 */
  outroFrames?: number;
  /** グリッチ発作・明滅の強さ (0〜1) */
  glitchIntensity?: number;
  /** 乱数シード（明滅パターンを変えたいとき用） */
  seed?: number;
  /** レイアウト微調整: 中心からのオフセット(px) */
  offsetX?: number;
  offsetY?: number;
}

/** 決定論的な擬似乱数 (0..1) */
const rand = (n: number, seed: number) => {
  const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453123;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 水平スライスの本数（タイトルを輪切りにしてずらす） */
const SLICE_COUNT = 7;

export const TitleSignalGlitch05: React.FC<TitleGlitch05Props> = ({
  text,
  durationInFrames,
  subtitle = "TYPE DESIGN",
  fontSize = 96,
  fontFamily = montserrat.fontFamily,
  textColor = "#f4fbf7",
  accentCool = "#00e0d0",
  accentWarm = "#f21d2f",
  spread = 115,
  convergeFrames = 30,
  outroFrames = 34,
  glitchIntensity = 1,
  seed = 7,
  offsetX = 0,
  offsetY = -30,
}) => {
  const frame = useCurrentFrame();
  const title = text.toUpperCase();
  // Array.from はサロゲートペア（絵文字等）を1文字として分割する（split("")は破壊する）
  const letters = useMemo(() => Array.from(title), [title]);

  const outroStart = durationInFrames - outroFrames;

  // ---- 収束（イントロ）: 1 -> 0 ----
  // ease-in: 分離状態を長く見せてから一気に白へ定着させる
  const converge = interpolate(frame, [0, convergeFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (t) => t * t * t,
  });

  // ---- 分離（アウトロ）: 0 -> 1 ----
  const diverge = interpolate(
    frame,
    [outroStart, outroStart + outroFrames * 0.45],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: (t) => t * t,
    }
  );

  // ---- 全体フェード ----
  const globalOpacity =
    interpolate(frame, [0, 6], [0.5, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) *
    interpolate(
      frame,
      [durationInFrames - 14, durationInFrames - 4],
      [1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );

  // ---- スライス発作の強さ（イントロ末期に2波 + アウトロ） ----
  const burst = (center: number, width: number) =>
    clamp01(1 - Math.abs(frame - center) / width);
  const sliceAmt =
    glitchIntensity *
    Math.max(
      burst(convergeFrames * 0.55, 5) * 0.9,
      burst(convergeFrames * 0.85, 4) * 0.7,
      diverge * 0.45
    );

  // チャンネルの縦ずれ。イントロは寒色が上・暖色が下から収束、アウトロで再分離。
  const separation = Math.max(converge, diverge * 0.85);
  // チャンネルをどれだけ見せるか（0=白定着のみ）。
  // 分離中はフル彩度で見せ、収束の最後だけ白へスナップさせる。
  const channelAmt = clamp01(Math.max(separation * 3, sliceAmt));

  // 文字送り: 1文字ずつ左から出現
  const perLetter = (convergeFrames * 0.42) / Math.max(letters.length, 1);
  const letterOpacity = (i: number) =>
    interpolate(frame, [i * perLetter + 1, i * perLetter + 3], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  // ---- タイトル1系統ぶんを描く ----
  const jitterTick = Math.floor(frame / 2); // 2フレームごとに乱数を引き直す
  const renderTitle = (
    color: string,
    dy: number,
    channelIdx: number,
    opacity: number
  ) => {
    const textEl = (
      <div
        style={{
          whiteSpace: "nowrap",
          fontSize,
          fontWeight: 300,
          letterSpacing: "0.22em",
          lineHeight: 1.15,
          color,
        }}
      >
        {letters.map((ch, i) => (
          <span key={i} style={{ opacity: letterOpacity(i) }}>
            {ch === " " ? " " : ch}
          </span>
        ))}
      </div>
    );

    if (sliceAmt < 0.03) {
      return (
        <div
          key={channelIdx}
          style={{
            position: channelIdx === 0 ? "relative" : "absolute",
            inset: channelIdx === 0 ? undefined : 0,
            transform: `translateY(${dy}px)`,
            opacity,
            mixBlendMode: channelIdx <= 2 ? "screen" : undefined,
          }}
        >
          {textEl}
        </div>
      );
    }

    // 発作中: 水平スライスごとに独立したXずれ
    const slices = Array.from({ length: SLICE_COUNT }, (_, s) => {
      const top = (s / SLICE_COUNT) * 100;
      const bottom = 100 - ((s + 1) / SLICE_COUNT) * 100;
      const r = rand(jitterTick * 31 + s * 13 + channelIdx * 97, seed);
      const dx = (r - 0.5) * 90 * sliceAmt;
      return (
        <div
          key={s}
          style={{
            position: s === 0 ? "relative" : "absolute",
            inset: s === 0 ? undefined : 0,
            clipPath: `inset(${top}% -5% ${bottom}% -5%)`,
            transform: `translateX(${dx}px)`,
          }}
        >
          {textEl}
        </div>
      );
    });
    return (
      <div
        key={channelIdx}
        style={{
          position: channelIdx === 0 ? "relative" : "absolute",
          inset: channelIdx === 0 ? undefined : 0,
          transform: `translateY(${dy}px)`,
          opacity,
          mixBlendMode: channelIdx <= 2 ? "screen" : undefined,
        }}
      >
        {slices}
      </div>
    );
  };

  // ---- 定着後の矩形明滅（シアン/赤のブロックノイズ） ----
  const blocks: React.ReactNode[] = [];
  if (frame > convergeFrames * 0.4 && frame < outroStart + 6) {
    const slot = Math.floor(frame / 14);
    const inSlot = frame - slot * 14;
    const r = rand(slot * 71 + 5, seed);
    const visible = r < 0.42 * glitchIntensity && inSlot < 7;
    if (visible) {
      const rx = rand(slot * 71 + 17, seed);
      const cool = rand(slot * 71 + 29, seed) < 0.5;
      blocks.push(
        <div
          key={slot}
          style={{
            position: "absolute",
            left: `${8 + rx * 96}%`,
            top: "6%",
            width: fontSize * 0.3,
            height: fontSize * 0.98,
            background: cool ? accentCool : accentWarm,
            opacity: 0.92,
          }}
        />
      );
    }
  }

  // ---- アンダーライン ----
  const lineGrow = interpolate(
    frame,
    [convergeFrames * 0.2, convergeFrames * 0.75],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: (t) => 1 - Math.pow(1 - t, 2),
    }
  );
  const lineShrink = interpolate(
    frame,
    [outroStart + 4, durationInFrames - 10],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const lineScale = lineGrow * lineShrink;

  // ---- タイプライター字幕 ----
  const subChars = Array.from(subtitle);
  const typeStart = convergeFrames * 0.3;
  const typeEvery = 1.7;
  const typedIn = Math.floor((frame - typeStart) / typeEvery);
  const typedOut = Math.floor((frame - (outroStart + 2)) / 1.1);
  const typedCount = Math.max(
    0,
    Math.min(
      subChars.length,
      frame >= outroStart + 2 ? subChars.length - Math.max(0, typedOut) : typedIn
    )
  );
  const typingActive = typedCount > 0 && typedCount < subChars.length;

  const subtitleEls = subChars.slice(0, typedCount).map((ch, i) => {
    // 打鍵直後の文字はまれに色付きブロックに化ける
    const isFresh = typingActive && i >= typedCount - 2;
    const corrupt =
      isFresh && rand(jitterTick * 53 + i * 19 + 3, seed) < 0.55 * glitchIntensity;
    if (corrupt) {
      const palette = [accentCool, accentWarm, "#2b3cf2", "#19e561", "#ffffff"];
      const c1 = palette[Math.floor(rand(jitterTick * 7 + i * 41, seed) * 5)];
      const c2 = palette[Math.floor(rand(jitterTick * 11 + i * 43, seed) * 5)];
      return (
        <span
          key={i}
          style={{
            display: "inline-block",
            width: "0.9em",
            height: "0.95em",
            verticalAlign: "-0.12em",
            background: `linear-gradient(180deg, ${c1} 0 50%, ${c2} 50% 100%)`,
          }}
        />
      );
    }
    const isLast = typingActive && i === typedCount - 1;
    return (
      <span key={i} style={{ color: isLast ? accentCool : undefined }}>
        {ch === " " ? " " : ch}
      </span>
    );
  });

  // チャンネル色（screen合成で重なると白になる純RGB）
  const channels: Array<{ color: string; dir: number; idx: number }> = [
    { color: "#ff0000", dir: 1, idx: 0 },
    { color: "#00ff00", dir: -1, idx: 1 },
    { color: "#0000ff", dir: -1, idx: 2 },
  ];

  const whiteOpacity = clamp01(1 - channelAmt);

  return (
    <AbsoluteFill
      style={{
        fontFamily,
        justifyContent: "center",
        alignItems: "center",
        opacity: globalOpacity,
      }}
    >
      {/* ごく淡い奥行きグロー */}
      <div
        style={{
          position: "absolute",
          width: "46%",
          height: "52%",
          borderRadius: "50%",
          background:
            "radial-gradient(closest-side, rgba(255,255,255,0.05), rgba(255,255,255,0))",
          transform: `translate(${offsetX}px, ${offsetY}px)`,
        }}
      />
      <div
        style={{
          position: "relative",
          transform: `translate(${offsetX}px, ${offsetY}px)`,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
        }}
      >
        {/* タイトル: RGBチャンネル + 白定着層 */}
        <div style={{ position: "relative", isolation: "isolate" }}>
          {channels.map((c) =>
            renderTitle(
              c.color,
              c.dir * spread * separation,
              c.idx,
              channelAmt > 0.02 ? channelAmt : 0
            )
          )}
          {/* 白の定着層（idx=3 => blendなし） */}
          <div style={{ position: "absolute", inset: 0 }}>
            {renderTitle(textColor, 0, 3, whiteOpacity)}
          </div>
          {/* 矩形明滅 */}
          {blocks}
        </div>

        {/* 三色アンダーライン */}
        <div
          style={{
            marginTop: fontSize * 0.32,
            width: "62%",
            height: Math.max(3, fontSize * 0.045),
            transform: `scaleX(${lineScale})`,
            transformOrigin: "left center",
            background: `linear-gradient(90deg, ${accentCool} 0 11%, #d7dee2 11% 83%, ${accentWarm} 83% 100%)`,
            opacity: interpolate(frame, [2, 10], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        />

        {/* タイプライター字幕 */}
        {subtitle.length > 0 ? (
          <div
            style={{
              marginTop: fontSize * 0.42,
              fontSize: fontSize * 0.36,
              fontWeight: 400,
              letterSpacing: "0.24em",
              color: textColor,
              whiteSpace: "nowrap",
              minHeight: fontSize * 0.45,
            }}
          >
            {subtitleEls}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
