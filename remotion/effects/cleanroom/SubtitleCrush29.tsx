import React, { useId } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadNotoSansJP } from "@remotion/google-fonts/NotoSansJP";

// 旧既定は Mac ローカルの Helvetica。配布ビルドで化けないよう、
// 字形の近いネオグロテスク Inter に置換し、和文グリフは Noto Sans JP で受ける。
const { fontFamily: INTER } = loadInter("normal", {
  weights: ["400"],
  subsets: ["latin", "latin-ext"],
});
const { fontFamily: NOTO_SANS_JP } = loadNotoSansJP("normal", {
  weights: ["400"],
  subsets: ["japanese", "latin"],
});

/**
 * SubtitleCrush29 — 縦に潰した（水平圧縮した）巨大アウトライン文字を、
 * 白い光が左→右へ照らしていくリリック字幕。
 *
 * クリーンルーム実装（機能記述と旧レンダの見た目のみを根拠に白紙から作成）。
 * 構成は3幕:
 *   1. 入場: 暗いアウトラインの全文が黒からフェードイン
 *   2. 照明: 白い光のソフトエッジが左→右へ掃引し、通過した文字が白く輝く
 *   3. 退場: 左→右のワイプで文字が消えていく
 *
 * 文字は SVG の textLength で行幅いっぱいに水平圧縮するため、
 * どんな文言でも「画面幅ぴったりの潰れた巨大文字」になる。
 * アウトラインは stroke ではなく feMorphology(膨張−収縮)で塗り文字から作る。
 * stroke だと textLength の圧縮で縦線だけ細く潰れるが、この方式なら
 * 画面座標で均一な太さの輪郭になる。
 * レイアウト・色・サイズ・タイミングはすべて props のつまみで調整可能。
 */
export type SubtitleCrush29Props = {
  /** 表示する歌詞・字幕（1行） */
  text: string;
  /** この字幕が画面に居る総フレーム数（Sequence の長さに合わせる） */
  durationInFrames: number;
  /** 文字サイズ(px)。潰れ具合は行幅で決まるので、これは「縦の大きさ」 */
  fontSize?: number;
  /** フォント。既定はプレーンなサンセリフ（圧縮が映える直線的な書体） */
  fontFamily?: string;
  /** フォントウェイト */
  fontWeight?: number;
  /** 光が当たった文字の色 */
  litColor?: string;
  /** まだ光が届いていないアウトラインの色 */
  baseColor?: string;
  /** 輪郭線の太さ(px) */
  strokeWidth?: number;
  /** 行の水平中心 0..1（0.5=画面中央） */
  posX?: number;
  /** 行の垂直中心 0..1（0.5=画面中央） */
  posY?: number;
  /** 行が占める幅（画面幅に対する割合 0..1）。1で端から端まで */
  lineWidthRatio?: number;
  /** 入場フェードの長さ(フレーム) */
  inDurationFrames?: number;
  /** 光の掃引が始まるフレーム。省略時は尺の約1/3から */
  sweepStartFrame?: number;
  /** 光の掃引が全文字を照らし終わるフレーム。省略時は退場開始の直前 */
  sweepEndFrame?: number;
  /** 退場ワイプの長さ(フレーム) */
  outDurationFrames?: number;
  /** 退場ワイプが尺の終わりを何フレームはみ出すか。0で尺内に消え切る */
  outOverhangFrames?: number;
  /** 光の先端のぼかし幅（行幅に対する割合 0..1）。大きいほど柔らかい */
  sweepSoftness?: number;
  /** 退場ワイプのエッジのぼかし幅（行幅に対する割合 0..1） */
  outSoftness?: number;
  /** 照らされた文字のにじみ（光のブルーム）強さ。0で無効 */
  glowStrength?: number;
};

/** CJK（全角級）の文字か。行の自然幅を見積もるための粗い判定 */
const CJK_RE =
  /[\u1100-\u11FF\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFF00-\uFFEF]/;

/** 行の自然幅（無圧縮時のおおよその幅, px）を見積もる。全角=1em / 半角=0.52em */
const estimateNaturalWidth = (line: string, size: number): number =>
  Array.from(line).reduce(
    (w, ch) => w + (CJK_RE.test(ch) ? size : size * 0.52),
    0,
  );

export const SubtitleCrush29: React.FC<SubtitleCrush29Props> = ({
  text,
  durationInFrames,
  fontSize = 660,
  fontFamily = `'${INTER}', '${NOTO_SANS_JP}', sans-serif`,
  fontWeight = 400,
  litColor = "#ffffff",
  baseColor = "#545454",
  strokeWidth = 2.6,
  posX = 0.5,
  posY = 0.49,
  lineWidthRatio = 1,
  inDurationFrames = 6,
  sweepStartFrame,
  sweepEndFrame,
  outDurationFrames = 11,
  outOverhangFrames = 2,
  sweepSoftness = 0.32,
  outSoftness = 0.08,
  glowStrength = 0.35,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  const lineWidth = width * lineWidthRatio;
  const left = width * posX - lineWidth / 2;
  const centerY = height * posY;

  // "\n" で複数行に対応（SVG <text> は生の \n を潰すため行ごとに描く）。
  // 複数行時は fontSize を行数で割り、centerY を中心に縦へ積む。1行なら従来と完全一致。
  const rawLines = text.split("\n");
  const lines =
    rawLines.length > 1 ? rawLines.filter((l) => l.trim().length > 0) : rawLines;
  const lineCount = Math.max(1, lines.length);
  const lineFontSize = fontSize / lineCount;
  const lineGap = lineFontSize * 1.06;
  const firstY = centerY - ((lineCount - 1) / 2) * lineGap;

  // 短文を textLength で行幅まで強制引き伸ばすと異常な間延びになるため、
  // 自然幅の2倍までに制限する（圧縮方向=長文はこれまでどおり行幅ぴったり）。
  const lineDrawLength = (line: string): number =>
    Math.min(lineWidth, Math.max(1, estimateNaturalWidth(line, lineFontSize) * 2));

  const outStart = durationInFrames - outDurationFrames;
  const sweepFrom = sweepStartFrame ?? Math.round(durationInFrames * 0.32);
  const sweepTo = sweepEndFrame ?? Math.max(sweepFrom + 1, outStart - 1);

  // 1. 入場: 暗いアウトラインが黒から浮かび上がる
  const appear = interpolate(frame, [0, inDurationFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // 2. 照明: 「完全に白くなった」境界の x 座標。境界の右に soft 幅の減衰の尾を引く
  const soft = lineWidth * Math.max(sweepSoftness, 0.001);
  const sweepProgress = interpolate(frame, [sweepFrom, sweepTo], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const sweepEdge = left + sweepProgress * lineWidth;
  // 尾は掃引の序盤で 0 → soft に育てる（開始前に先行点灯しないため）
  const sweepTail = Math.max(soft * Math.min(1, sweepProgress * 4), 0.001);

  // 3. 退場: 左からのワイプ。エッジが右端を抜けきったら全消灯
  const outSoft = lineWidth * Math.max(outSoftness, 0.001);
  const outProgress = interpolate(
    frame,
    [outStart, durationInFrames + outOverhangFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const wipeEdge = left + outProgress * (lineWidth + outSoft);

  const sweepMaskId = `crush29-sweep-${uid}`;
  const wipeMaskId = `crush29-wipe-${uid}`;
  const sweepGradId = `crush29-sweep-grad-${uid}`;
  const wipeGradId = `crush29-wipe-grad-${uid}`;
  const baseOutlineId = `crush29-outline-base-${uid}`;
  const litOutlineId = `crush29-outline-lit-${uid}`;

  const textProps = {
    x: width * posX,
    textAnchor: "middle" as const,
    dominantBaseline: "central" as const,
    fontFamily,
    fontWeight,
    fontSize: lineFontSize,
    lengthAdjust: "spacingAndGlyphs" as const,
    fill: "#fff",
  };

  const renderLines = (filterId: string) => (
    <>
      {lines.map((line, i) => (
        <text
          key={i}
          {...textProps}
          y={firstY + i * lineGap}
          textLength={lineDrawLength(line)}
          filter={`url(#${filterId})`}
        >
          {line}
        </text>
      ))}
    </>
  );

  // 塗り文字のアルファから「エッジを挟む strokeWidth 幅の帯」を作り、指定色で塗る。
  // dilate(r) − erode(r) の r。feMorphology は整数寄りの radius が安定するので丸めない。
  const outlineRadius = Math.max(strokeWidth / 2, 0.5);

  const outlineFilter = (id: string, color: string, glow: number) => (
    <filter
      id={id}
      filterUnits="userSpaceOnUse"
      x={-strokeWidth * 8}
      y={centerY - fontSize}
      width={width + strokeWidth * 16}
      height={fontSize * 2}
    >
      <feMorphology operator="dilate" radius={outlineRadius} in="SourceAlpha" result="fat" />
      <feMorphology operator="erode" radius={outlineRadius} in="SourceAlpha" result="thin" />
      <feComposite in="fat" in2="thin" operator="out" result="ring" />
      <feFlood floodColor={color} result="paint" />
      <feComposite in="paint" in2="ring" operator="in" result="coloredRing" />
      {glow > 0 ? (
        <>
          <feGaussianBlur in="coloredRing" stdDeviation={strokeWidth * 2.5} result="blurred" />
          <feComponentTransfer in="blurred" result="bloom">
            <feFuncA type="linear" slope={glow} />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode in="bloom" />
            <feMergeNode in="coloredRing" />
          </feMerge>
        </>
      ) : (
        <feMerge>
          <feMergeNode in="coloredRing" />
        </feMerge>
      )}
    </filter>
  );

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ position: "absolute", inset: 0 }}
      >
        <defs>
          {/* 光の先端: 左が白(点灯)・右が黒(未点灯)、soft幅でなだらかに減衰 */}
          <linearGradient
            id={sweepGradId}
            gradientUnits="userSpaceOnUse"
            x1={sweepEdge}
            y1={0}
            x2={sweepEdge + sweepTail}
            y2={0}
          >
            <stop offset={0} stopColor="#fff" />
            <stop offset={1} stopColor="#000" />
          </linearGradient>
          {/* 退場ワイプ: 左が黒(消灯済み)・右が白(まだ見える) */}
          <linearGradient
            id={wipeGradId}
            gradientUnits="userSpaceOnUse"
            x1={wipeEdge - outSoft}
            y1={0}
            x2={wipeEdge}
            y2={0}
          >
            <stop offset={0} stopColor="#000" />
            <stop offset={1} stopColor="#fff" />
          </linearGradient>
          <mask id={sweepMaskId}>
            <rect x={0} y={0} width={width} height={height} fill={`url(#${sweepGradId})`} />
          </mask>
          <mask id={wipeMaskId}>
            <rect x={0} y={0} width={width} height={height} fill={`url(#${wipeGradId})`} />
          </mask>
          {outlineFilter(baseOutlineId, baseColor, 0)}
          {outlineFilter(litOutlineId, litColor, glowStrength)}
        </defs>

        <g mask={`url(#${wipeMaskId})`} opacity={appear}>
          {/* 未点灯のベース: 暗いアウトラインの全文 */}
          {renderLines(baseOutlineId)}
          {/* 点灯レイヤー: 白アウトライン＋わずかなブルーム。掃引マスクで左から現れる */}
          <g mask={`url(#${sweepMaskId})`}>{renderLines(litOutlineId)}</g>
        </g>
      </svg>
    </AbsoluteFill>
  );
};
