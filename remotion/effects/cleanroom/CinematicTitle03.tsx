import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadTinos } from "@remotion/google-fonts/Tinos";

/**
 * CinematicTitle03 — クリーンルーム再実装
 *
 * 映画クレジット風のスモールキャップス・タイトル（2段組み）を
 * 荘厳にフェードイン/アウトさせる。
 * 上段は小さめ・ワイドトラッキングのサブタイトル（例: "Written By"）、
 * 下段は大きなセリフの名前行。どちらも語頭だけフルサイズの大文字、
 * 残りは縮小した大文字（スモールキャップス）として描画する。
 * 登場は文字単位で左→右へ、フォーカスが合うようなブラー＋フェード＋
 * わずかな縦ドリフトの順次リビール。退場も左→右へ同じ質感で抜ける。
 *
 * 機能記述「映画クレジット風のスモールキャップス・タイトル(2段組み)を
 * 荘厳にフェードイン/アウト」を出発点に、旧レンダリング（見た目のものさし）
 * と同等の質感を白紙から構成したもの。既定フォントは配布可能な
 * Google Fonts の Tinos（Times 互換メトリクスのセリフ体）。
 */
export type CinematicTitle4ZYNProps = {
  /** 表示文言。1行目=サブタイトル、2行目以降=名前行。"\n" 区切り。 */
  text?: string;
  /** 演出全体の尺（フレーム）。イン→ホールド→アウトをこの中に収める。 */
  durationInFrames?: number;
  /** 名前行のフルサイズ文字の大きさ(px)。XpTitleProps 互換のつまみ。 */
  fontSize?: number;
  /** フォント。省略時は Google Fonts の Tinos（配布可能）。 */
  fontFamily?: string;
  /** サブタイトル行のフルサイズ文字の大きさ(px) */
  subtitleFontSize?: number;
  /** 文字色 */
  color?: string;
  /** 名前行の太さ */
  fontWeight?: number | string;
  /** サブタイトル行の太さ */
  subtitleFontWeight?: number | string;
  /** スモールキャップス縮小率（語頭以外の文字のサイズ比、0〜1） */
  smallCapsRatio?: number;
  /** 名前行の字間（em） */
  letterSpacingEm?: number;
  /** サブタイトル行の字間（em） */
  subtitleLetterSpacingEm?: number;
  /** 行間の隙間(px)。サブタイトル行と名前行の間。 */
  rowGap?: number;
  /** 2段組みブロックの中心位置 X（0〜1、画面幅比） */
  posX?: number;
  /** 2段組みブロックの中心位置 Y（0〜1、画面高比） */
  posY?: number;
  /** 退場アニメーションに確保する窓（秒）。尺の末尾から確保する。 */
  outSeconds?: number;
  /** 行ごとの開始遅れ（秒）。サブタイトルが先、名前行が後追い。 */
  lineLagSeconds?: number;
  /** 文字送りの間隔（秒）。左→右へ1文字ずつこの間隔で動き出す。 */
  charStaggerSeconds?: number;
  /** 1文字のフェードに掛ける時間（秒） */
  charFadeSeconds?: number;
  /** 登場/退場時の最大ブラー量(px) */
  maxBlurPx?: number;
  /** 登場時の縦ドリフト量(px)。下から浮き上がる距離。 */
  driftPx?: number;
};

type Glyph = {
  /** 大文字化済みの1文字 */
  char: string;
  /** 語頭ならフルサイズ、それ以外は縮小スモールキャップス */
  isWordInitial: boolean;
  /** 行内の登場順（スペースを除いた通し番号） */
  order: number;
};

/** 1行ぶんの文字列を、スモールキャップス描画用のグリフ列に分解する */
const toGlyphs = (line: string): Glyph[] => {
  const glyphs: Glyph[] = [];
  let prevWasSpace = true;
  let order = 0;
  for (const raw of Array.from(line)) {
    const isSpace = /\s/.test(raw);
    glyphs.push({
      char: isSpace ? " " : raw.toUpperCase(),
      isWordInitial: !isSpace && prevWasSpace,
      order: isSpace ? -1 : order,
    });
    if (!isSpace) order += 1;
    prevWasSpace = isSpace;
  }
  return glyphs;
};

const { fontFamily: tinosFamily } = loadTinos();

export const CinematicTitle03: React.FC<CinematicTitle4ZYNProps> = ({
  text = "Written By\nElliot Danforth",
  durationInFrames = 192,
  fontSize = 132,
  fontFamily,
  subtitleFontSize = 60,
  color = "#ffffff",
  fontWeight = 400,
  subtitleFontWeight = 700,
  smallCapsRatio = 0.72,
  letterSpacingEm = 0.04,
  subtitleLetterSpacingEm = 0.38,
  rowGap = 56,
  posX = 0.5,
  posY = 0.5,
  outSeconds = 1.4,
  lineLagSeconds = 0.28,
  charStaggerSeconds = 0.058,
  charFadeSeconds = 0.32,
  maxBlurPx = 11,
  driftPx = 10,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const family = fontFamily ?? `'${tinosFamily}', 'Times New Roman', serif`;

  const lines = useMemo(() => {
    const rows = text.split("\n").filter((l) => l.trim().length > 0);
    return rows.map(toGlyphs);
  }, [text]);

  // 各行の演出設計。行 l は lineLagSeconds * l 遅れて動き出し、
  // 行内の文字は左→右へ charStaggerSeconds 間隔で動き出す。
  const lineTimings = useMemo(() => {
    return lines.map((_, l) => {
      const inStart = lineLagSeconds * l * fps;
      const outStart =
        durationInFrames - outSeconds * fps + lineLagSeconds * l * fps;
      return { inStart, outStart };
    });
  }, [lines, fps, durationInFrames, outSeconds, lineLagSeconds]);

  const fadeFrames = Math.max(1, charFadeSeconds * fps);
  const staggerFrames = charStaggerSeconds * fps;

  /** 1文字の登場/退場を合成した進行度（0=不可視, 1=定着）とブラー・ドリフト */
  const glyphState = (lineIndex: number, order: number) => {
    const t = lineTimings[lineIndex];

    const inBegin = t.inStart + order * staggerFrames;
    const appear = interpolate(
      frame,
      [inBegin, inBegin + fadeFrames],
      [0, 1],
      {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.cubic),
      }
    );

    const outBegin = t.outStart + order * staggerFrames;
    const vanish = interpolate(
      frame,
      [outBegin, outBegin + fadeFrames],
      [1, 0],
      {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.in(Easing.cubic),
      }
    );

    const visibility = Math.min(appear, vanish);
    // 登場中は残りぶん、退場中は失ったぶんだけボケる
    const blur = maxBlurPx * (1 - visibility);
    // 登場時は下からわずかに浮上、退場時は上へわずかに抜ける
    const drift = driftPx * (1 - appear) - driftPx * 0.6 * (1 - vanish);
    return { opacity: visibility, blur, drift };
  };

  const renderLine = (
    glyphs: Glyph[],
    lineIndex: number,
    baseSize: number,
    weight: number | string,
    trackingEm: number
  ) => (
    <div
      key={lineIndex}
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "center",
        whiteSpace: "pre",
      }}
    >
      {glyphs.map((g, i) => {
        if (g.order < 0) {
          // スペース: フルサイズ基準の空きを確保
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                width: `${baseSize * (0.34 + trackingEm)}px`,
              }}
            />
          );
        }
        const { opacity, blur, drift } = glyphState(lineIndex, g.order);
        const size = g.isWordInitial ? baseSize : baseSize * smallCapsRatio;
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              fontSize: `${size}px`,
              fontWeight: weight,
              letterSpacing: `${baseSize * trackingEm}px`,
              opacity,
              filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined,
              transform: `translateY(${drift.toFixed(2)}px)`,
            }}
          >
            {g.char}
          </span>
        );
      })}
    </div>
  );

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: posX * width,
          top: posY * height,
          transform: "translate(-50%, -50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          rowGap: `${rowGap}px`,
          color,
          fontFamily: family,
          lineHeight: 1,
          textAlign: "center",
        }}
      >
        {lines.map((glyphs, l) =>
          l === 0 && lines.length > 1
            ? renderLine(
                glyphs,
                l,
                subtitleFontSize,
                subtitleFontWeight,
                subtitleLetterSpacingEm
              )
            : renderLine(glyphs, l, fontSize, fontWeight, letterSpacingEm)
        )}
      </div>
    </AbsoluteFill>
  );
};
