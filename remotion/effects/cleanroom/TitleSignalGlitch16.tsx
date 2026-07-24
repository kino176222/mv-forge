/**
 * TitleSignalGlitch16（クリーンルーム再実装）
 *
 * 機能記述: 極太文字が上から1文字ずつ落ちてきて、赤/シアンの色ずれ（RGB分離）を
 * 起こすグリッチタイトル。定着後は文字下にRGB分解のセパレータ線が伸び、
 * 途中で短い分離ジョルトが走り、終盤は文字が再び分離しながら落ちて消える。
 *
 * - 外部コード/数値は参照していない（見た目のみをものさしに設計）。
 * - 既定フォントは Google Fonts の Noto Sans JP Black（配布可能・日英対応）。
 * - レイアウト/色/サイズ/タイミングはすべて props で調整可能。既定値のみで完成形。
 */
import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/NotoSansJP";

const { fontFamily: DEFAULT_FONT } = loadFont("normal", {
  weights: ["900"],
  subsets: ["latin", "japanese"],
});

export interface TitleGlitch16Props {
  text: string;
  durationInFrames: number;
  /** 文字サイズ(px) */
  fontSize?: number;
  /** フォント。既定は同梱の Noto Sans JP（配布可能） */
  fontFamily?: string;
  fontWeight?: number;
  /** 字間(em) */
  letterSpacingEm?: number;
  /** 本体色 */
  color?: string;
  /** 色ずれ暖色（赤側） */
  accentWarm?: string;
  /** 色ずれ寒色（シアン側） */
  accentCool?: string;
  /** セパレータ線の色（左→右） */
  lineColors?: string[];
  /** 線の太さ(px) */
  lineThickness?: number;
  /** 文字中心から線までの距離(px)。未指定は fontSize 比で自動 */
  lineOffsetY?: number;
  /** 画面高に対する文字中心位置 0..1 */
  centerY?: number;
  /** 落下インの長さ(フレーム) */
  introFrames?: number;
  /** 分離アウトの長さ(フレーム) */
  outroFrames?: number;
  /** 中盤ジョルトの強さ 0..1（0で無効） */
  joltIntensity?: number;
  /** 装飾（赤ダッシュ/ヘアライン/白バー）の量 0..1（0で無効） */
  decorDensity?: number;
  /** 乱数シード */
  seed?: number;
  /** 背景色。透明合成したい場合は "transparent" */
  background?: string;
}

/** 決定論ハッシュ（0..1） */
const rnd = (...ns: number[]): number => {
  let h = 2166136261 >>> 0;
  for (const n of ns) {
    h = Math.imul(h ^ (Math.floor(n * 8191) + 0x9e3779b9), 16777619) >>> 0;
    h ^= h >>> 13;
  }
  return ((h >>> 9) % 100000) / 100000;
};

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const easeInCubic = (t: number): number => t ** 3;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

interface LetterMotion {
  dx: number;
  dy: number;
  opacity: number;
  /** 色ずれ量(px)。0なら白のみ描画 */
  split: number;
  /** 色ずれの向き（単位ベクトル成分） */
  splitX: number;
  splitY: number;
}

export const TitleSignalGlitch16: React.FC<TitleGlitch16Props> = ({
  text,
  durationInFrames,
  fontSize = 110,
  fontFamily = DEFAULT_FONT,
  fontWeight = 900,
  letterSpacingEm = 0.14,
  color = "#f4f4f4",
  accentWarm = "#f01523",
  accentCool = "#00e0dc",
  lineColors = ["#0be060", "#00d5ff", "#1e3cff", "#e02cd8", "#f01523"],
  lineThickness = 5,
  lineOffsetY,
  centerY = 0.5,
  introFrames = 22,
  outroFrames = 26,
  joltIntensity = 0.85,
  decorDensity = 1,
  seed = 16,
  background = "#000",
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const letters = useMemo(() => Array.from(text), [text]);
  const n = Math.max(1, letters.length);

  // ---- タイムライン ------------------------------------------------------
  const outroStart = durationInFrames - outroFrames;
  const dropDistance = fontSize * 1.7;

  // 中盤ジョルト（短いバースト2回）。位置はシードで揺らす
  const joltWindows = useMemo(() => {
    const settleSpan = Math.max(1, outroStart - introFrames);
    return [0.38, 0.66].map((base, i) => {
      const at = introFrames + settleSpan * (base + (rnd(seed, 70 + i) - 0.5) * 0.1);
      return { start: Math.round(at), len: 3 };
    });
  }, [introFrames, outroStart, seed]);

  const joltAmt = useMemo(() => {
    if (joltIntensity <= 0) return 0;
    for (const w of joltWindows) {
      if (frame >= w.start && frame < w.start + w.len) {
        // バースト内で減衰
        return joltIntensity * (1 - (frame - w.start) / w.len);
      }
    }
    return 0;
  }, [frame, joltWindows, joltIntensity]);

  // ---- 文字ごとのモーション ---------------------------------------------
  const motions: LetterMotion[] = useMemo(() => {
    return letters.map((ch, i) => {
      if (ch === " ") {
        return { dx: 0, dy: 0, opacity: 1, split: 0, splitX: 0, splitY: 0 };
      }
      // 落下イン: 出現順はシャッフル、少しずつ遅れて落ちる
      const inOrder = rnd(seed, i, 1);
      const inStart = inOrder * introFrames * 0.55;
      const inDur = introFrames * 0.42;
      const pRaw = clamp01((frame - inStart) / inDur);
      const p = easeOutCubic(pRaw);

      // 分離アウト: こちらもランダム順で崩れ落ちる
      const outOrder = rnd(seed, i, 2);
      const outStart = outroStart + outOrder * outroFrames * 0.5;
      const outDur = outroFrames * 0.45;
      const qRaw = clamp01((frame - outStart) / outDur);
      const q = easeInCubic(qRaw);

      // 位置: インは上から、アウトは下へ抜けつつ横に流れる
      const dy =
        -(1 - p) * dropDistance +
        q * dropDistance * (0.9 + rnd(seed, i, 3) * 0.5);
      const dx =
        (1 - p) * fontSize * (rnd(seed, i, 4) - 0.5) * 0.35 +
        q * fontSize * (rnd(seed, i, 5) - 0.35) * 0.9;

      // 色ずれ量: 落下中とアウト中に大きく、定着中はジョルトのみ
      const introSplit = (1 - pRaw) * fontSize * 0.55;
      const outroSplit = qRaw * fontSize * 0.5;
      const joltSplit =
        joltAmt * fontSize * (0.14 + rnd(seed, i, Math.floor(frame / 2)) * 0.1);
      const split = Math.max(introSplit, outroSplit, joltSplit);

      // ずれの向き（文字ごとに固定・水平寄り）
      const ang = (rnd(seed, i, 6) - 0.5) * 1.2;
      const splitX = Math.cos(ang);
      const splitY = Math.sin(ang);

      // 不透明度: インで立ち上がり、アウトの後半で消える
      const opacity = clamp01(pRaw * 1.6) * (1 - clamp01((qRaw - 0.55) / 0.45));

      // ジョルト中の縦ガタつき
      const joltDy = joltAmt * (rnd(seed, i, Math.floor(frame / 2) + 50) - 0.5) * fontSize * 0.4;

      return { dx, dy: dy + joltDy, opacity, split, splitX, splitY };
    });
  }, [letters, frame, seed, introFrames, outroFrames, outroStart, fontSize, dropDistance, joltAmt]);

  const anySplit = motions.some((m) => m.split > 0.5);

  // ---- セパレータ線 -------------------------------------------------------
  const lineStart = introFrames + 3;
  const lineEnd = outroStart + outroFrames * 0.3;
  const lineVisible = frame >= lineStart && frame <= lineEnd;
  const lineGrowIn = clamp01((frame - lineStart) / 4);
  const lineWidthFrac = interpolate(
    frame,
    [lineStart, Math.max(lineStart + 1, outroStart)],
    [0.56, 0.95],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const lineOpacity =
    lineGrowIn *
    interpolate(frame, [outroStart, lineEnd], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  // セグメント幅は一定間隔で組み替わる
  const lineStep = Math.floor(frame / 14);
  const segWeights = lineColors.map((_, i) => 0.55 + rnd(seed, 90 + i, lineStep) * 1.1);
  const lineY = height * centerY + (lineOffsetY ?? fontSize * 0.82);

  // ---- 装飾（赤ダッシュ/ヘアライン/白バー） ------------------------------
  const glitchPhase =
    frame < introFrames + 4 || frame > outroStart - 2 || joltAmt > 0;
  const decorItems = useMemo(() => {
    const items: {
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
      kind: number;
    }[] = [];
    if (decorDensity <= 0) return items;
    // 上部の赤ダッシュ
    const dashCount = Math.round(3 * decorDensity);
    for (let i = 0; i < dashCount; i++) {
      items.push({
        x: width * (0.12 + i * 0.28 + rnd(seed, 20 + i) * 0.08),
        y: height * (0.03 + rnd(seed, 30 + i) * 0.05),
        w: 34 + rnd(seed, 40 + i) * 36,
        h: 9,
        color: accentWarm,
        kind: 0,
      });
    }
    // 中域の赤バー
    for (let i = 0; i < Math.round(2 * decorDensity); i++) {
      items.push({
        x: width * (0.45 + rnd(seed, 50 + i) * 0.2),
        y: height * (0.42 + rnd(seed, 55 + i) * 0.14),
        w: 90 + rnd(seed, 58 + i) * 40,
        h: 9,
        color: accentWarm,
        kind: 1,
      });
    }
    // 細い赤ヘアライン（右へ走る）
    items.push({
      x: width * 0.67,
      y: height * centerY - 2,
      w: width * 0.19,
      h: 2,
      color: accentWarm,
      kind: 2,
    });
    // 文字下の白バー
    for (let i = 0; i < Math.round(2 * decorDensity); i++) {
      items.push({
        x: width * (0.33 + i * 0.27 + rnd(seed, 60 + i) * 0.06),
        y: height * centerY + fontSize * 1.15,
        w: 120 + rnd(seed, 65 + i) * 70,
        h: 10,
        color: "#e8e8e8",
        kind: 3,
      });
    }
    return items;
  }, [decorDensity, width, height, seed, accentWarm, centerY, fontSize]);

  // ---- 文字列レンダラ（白/暖/寒の3層） ------------------------------------
  const renderCopy = (
    mode: "main" | "warm" | "cool",
    key: string
  ): React.ReactNode => {
    const isMain = mode === "main";
    const sign = mode === "warm" ? 1 : -1;
    return (
      <div
        key={key}
        aria-hidden={!isMain}
        style={{
          position: isMain ? "relative" : "absolute",
          inset: isMain ? undefined : 0,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          whiteSpace: "pre",
          mixBlendMode: isMain ? undefined : "screen",
        }}
      >
        {letters.map((ch, i) => {
          const m = motions[i] ?? {
            dx: 0,
            dy: 0,
            opacity: 1,
            split: 0,
            splitX: 0,
            splitY: 0,
          };
          const hasSplit = m.split > 0.5;
          if (!isMain && !hasSplit) {
            // 定着中のゴーストは透明のまま（レイアウト維持のため描画はする）
            return (
              <span key={i} style={{ opacity: 0 }}>
                {ch}
              </span>
            );
          }
          const ox = isMain ? 0 : sign * m.split * m.splitX;
          const oy = isMain ? 0 : sign * m.split * m.splitY * 0.7;
          const opacity = isMain
            ? m.opacity * (hasSplit ? 0.92 : 1)
            : clamp01(m.split / (fontSize * 0.1)) * 0.95 * (m.opacity > 0.02 ? 1 : 0);
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                transform: `translate(${m.dx + ox}px, ${m.dy + oy}px)`,
                opacity,
                color: isMain ? color : mode === "warm" ? accentWarm : accentCool,
              }}
            >
              {ch}
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <AbsoluteFill style={{ background, overflow: "hidden" }}>
      {/* 装飾レイヤ（グリッチ局面のみ・フレームごとに明滅） */}
      {glitchPhase &&
        decorItems.map((d, i) => {
          const on = rnd(seed, 100 + i, Math.floor(frame / 2)) > 0.35;
          if (!on) return null;
          // 白バーはイン中のみ / ヘアラインは長さが揺れる
          if (d.kind === 3 && frame > introFrames + 4 && joltAmt <= 0) return null;
          const wJitter = d.kind === 2 ? 0.5 + rnd(seed, 110 + i, Math.floor(frame / 3)) * 2.2 : 1;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: d.x,
                top: d.y,
                width: d.w * wJitter,
                height: d.h,
                background: d.color,
              }}
            />
          );
        })}

      {/* セパレータ線（RGB分解） */}
      {lineVisible && (
        <div
          style={{
            position: "absolute",
            top: lineY,
            left: "50%",
            transform: "translateX(-50%)",
            width: width * lineWidthFrac * lineGrowIn,
            height: lineThickness,
            display: "flex",
            gap: 4,
            opacity: lineOpacity,
          }}
        >
          {lineColors.map((c, i) => (
            <div key={i} style={{ flexGrow: segWeights[i] ?? 1, background: c }} />
          ))}
        </div>
      )}

      {/* タイトル本体（寒色/暖色ゴースト + 白） */}
      <AbsoluteFill
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div
          style={{
            position: "relative",
            transform: `translateY(${height * (centerY - 0.5)}px)`,
            fontFamily,
            fontWeight,
            fontSize,
            letterSpacing: `${letterSpacingEm}em`,
            lineHeight: 1.1,
          }}
        >
          {anySplit && renderCopy("cool", "cool")}
          {anySplit && renderCopy("warm", "warm")}
          {renderCopy("main", "main")}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
