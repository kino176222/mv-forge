import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadCastoro } from "@remotion/google-fonts/Castoro";
import { loadFont as loadNotoSerifJP } from "@remotion/google-fonts/NotoSerifJP";

/**
 * CinematicTitle04 — クリーンルーム再実装
 *
 * 荘厳なブラー解けリビールで立ち上がる、シネマティックなセリフ体タイトル。
 * 大文字・ワイドトラッキングの主題が、文字ごとに左から右へ
 * 「強いデフォーカス→解像」の波で立ち上がり、背後には大きくボケた
 * 白いエコー（シネマティックな被写界深度の照り返し）が滲む。
 * 副題（スモールキャップ調・さらに広い字間）は主題を追いかけて同じ波で
 * 解像する。ホールド中は全体がごく緩やかにズームし続け、終端では
 * 入場と同じ左→右の波で文字がボケの中へ溶けながら、わずかに上へ
 * 抜けて消えていく。
 *
 * 機能記述「荘厳なブラー解けリビールで立ち上がる、シネマティックな
 * セリフ体タイトル。」を出発点に、旧レンダリング（見た目のものさし）と
 * 同等以上の質感を白紙から構成したもの。
 *
 * 既定フォントは Google Fonts（Castoro + Noto Serif JP）を
 * @remotion/google-fonts 経由でバンドル読込するため、Mac 内蔵フォントに
 * 依存せず配布可能。
 */

const castoro = loadCastoro("normal", {
  weights: ["400"],
  subsets: ["latin", "latin-ext"],
});
const notoSerifJP = loadNotoSerifJP("normal", {
  weights: ["400", "500"],
  subsets: ["japanese", "latin"],
});

/** 配布可能な既定フォントスタック（欧文=Castoro / 和文=Noto Serif JP） */
const DEFAULT_FONT_FAMILY = `${castoro.fontFamily}, ${notoSerifJP.fontFamily}, serif`;

export type CinematicTitleMP66Props = {
  /**
   * 表示する文言。1行目が主題、2行目以降は副題になる。
   * 副題を出さない場合は1行だけ渡す。
   */
  text?: string;
  /** 副題を明示指定する場合（指定時は text の2行目以降より優先） */
  subtitle?: string;
  /** 演出全体の尺（フレーム）。省略時はコンポジションの尺 */
  durationInFrames?: number;
  /** 主題の文字サイズ(px) */
  fontSize?: number;
  /** 副題の文字サイズ(px) */
  subtitleFontSize?: number;
  /** フォント（既定は Castoro + Noto Serif JP のセリフスタック） */
  fontFamily?: string;
  /** 主題の色 */
  color?: string;
  /** 副題の色（既定は主題よりやや沈めた白） */
  subtitleColor?: string;
  /** 主題を大文字化するか */
  uppercase?: boolean;
  /** 主題の字間（em単位・ワイドトラッキング） */
  letterSpacingEm?: number;
  /** 副題の字間（em単位。主題よりさらに広く） */
  subtitleLetterSpacingEm?: number;
  /** 主題の中心位置 Y（0〜1、画面高比） */
  posY?: number;
  /** 副題の中心位置 Y（0〜1、画面高比） */
  subtitleY?: number;
  /** 1文字がボケ→解像しきるまでの秒数 */
  inSeconds?: number;
  /** 1文字がボケへ溶けきるまでの秒数 */
  outSeconds?: number;
  /** 左端→右端の文字までリビール開始がずれる秒数（入場の波の幅） */
  staggerSeconds?: number;
  /** 左端→右端の文字まで退場開始がずれる秒数（退場の波の幅） */
  outStaggerSeconds?: number;
  /** 副題のリビールが主題より遅れる秒数 */
  subtitleLagSeconds?: number;
  /** 副題の退場が主題より遅れる秒数 */
  subtitleOutLagSeconds?: number;
  /** 主題が溶けきってから終端までの余韻の秒数 */
  endHoldSeconds?: number;
  /** 入退場時の最大ボケ量(px) */
  maxBlurPx?: number;
  /** 背後のボケた白エコーの強さ（0で無効、1で標準） */
  echo?: number;
  /** 文字周りの淡いグロー強度（0で無効、1で標準） */
  glow?: number;
  /** 尺全体でのスローズーム倍率の増分（0.05 = 5%拡大） */
  zoomGrow?: number;
  /** 終端で上へ抜ける距離（主題フォントサイズ比） */
  riseOut?: number;
  /** 主題の太さ */
  fontWeight?: number | string;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInCubic = (t: number) => t ** 3;
const easeInOutSine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);

/**
 * 文字ごとの「解像度」(0=完全にボケて透明 / 1=完全に解像)。
 * 入場は左→右の波で解像し、退場も左→右の波でボケへ還る。
 */
const charReveal = (
  frame: number,
  index: number,
  count: number,
  opts: {
    inStartFrame: number;
    inFrames: number;
    staggerFrames: number;
    outStartFrame: number;
    outFrames: number;
    outStaggerFrames: number;
  }
): { in: number; out: number } => {
  const ratio = count > 1 ? index / (count - 1) : 0;
  const inLocal =
    (frame - opts.inStartFrame - ratio * opts.staggerFrames) /
    Math.max(1, opts.inFrames);
  const outLocal =
    (frame - opts.outStartFrame - ratio * opts.outStaggerFrames) /
    Math.max(1, opts.outFrames);
  return {
    in: easeOutCubic(clamp01(inLocal)),
    out: 1 - easeInCubic(clamp01(outLocal)),
  };
};

type LineSpec = {
  chars: string[];
  fontSize: number;
  color: string;
  letterSpacingEm: number;
  fontWeight: number | string;
  posY: number;
  inStartFrame: number;
  outStartFrame: number;
  blurScale: number;
};

export const CinematicTitle04: React.FC<CinematicTitleMP66Props> = ({
  text = "SPECTACLE",
  subtitle,
  durationInFrames,
  fontSize = 110,
  subtitleFontSize = 30,
  fontFamily = DEFAULT_FONT_FAMILY,
  color = "#f5f3ee",
  subtitleColor = "rgba(240, 238, 231, 0.9)",
  uppercase = true,
  letterSpacingEm = 0.38,
  subtitleLetterSpacingEm = 0.5,
  posY = 0.45,
  subtitleY = 0.585,
  inSeconds = 0.55,
  outSeconds = 0.35,
  staggerSeconds = 0.85,
  outStaggerSeconds = 0.66,
  subtitleLagSeconds = 0.35,
  subtitleOutLagSeconds = 0.66,
  endHoldSeconds = 0.33,
  maxBlurPx = 22,
  echo = 1,
  glow = 1,
  zoomGrow = 0.05,
  riseOut = 0.45,
  fontWeight = 400,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames: compDuration } = useVideoConfig();
  const total = durationInFrames ?? compDuration;

  const [titleLine, subLine] = useMemo(() => {
    const lines = String(text).split("\n");
    const title = lines[0] ?? "";
    const rest = subtitle ?? lines.slice(1).join(" ").trim();
    return [title, rest] as const;
  }, [text, subtitle]);

  const inFrames = Math.max(1, Math.round(inSeconds * fps));
  const outFrames = Math.max(1, Math.round(outSeconds * fps));
  const staggerFrames = Math.max(0, Math.round(staggerSeconds * fps));
  const outStaggerFrames = Math.max(0, Math.round(outStaggerSeconds * fps));
  const lagFrames = Math.max(0, Math.round(subtitleLagSeconds * fps));
  const outLagFrames = Math.max(0, Math.round(subtitleOutLagSeconds * fps));
  const endHoldFrames = Math.max(0, Math.round(endHoldSeconds * fps));
  // 退場の波は「主題が余韻を残して溶けきる」逆算で開始する。
  // 副題は主題より遅れて溶けはじめ、終端で余韻ごと断ち切られる。
  const outSpan = outFrames + outStaggerFrames;
  const titleOutStart = total - endHoldFrames - outSpan;
  const subOutStart = titleOutStart + outLagFrames;

  // ---- 常時の呼吸：スローズーム＋終端の上方ドリフト ----
  const lifetime = clamp01(frame / Math.max(1, total - 1));
  const scale = 1 + zoomGrow * easeInOutSine(lifetime);
  const outGlobal = clamp01(
    (frame - titleOutStart) / Math.max(1, total - titleOutStart)
  );
  const rise = -riseOut * fontSize * easeInCubic(outGlobal);

  const lines: LineSpec[] = [
    {
      chars: Array.from(titleLine),
      fontSize,
      color,
      letterSpacingEm,
      fontWeight,
      posY,
      inStartFrame: 0,
      outStartFrame: titleOutStart,
      blurScale: 1,
    },
  ];
  if (subLine) {
    lines.push({
      chars: Array.from(subLine),
      fontSize: subtitleFontSize,
      color: subtitleColor,
      letterSpacingEm: subtitleLetterSpacingEm,
      fontWeight: 500,
      posY: subtitleY,
      inStartFrame: lagFrames,
      outStartFrame: subOutStart,
      blurScale: 0.8,
    });
  }

  const renderLine = (line: LineSpec, echoLayer: boolean, key: string) => {
    const count = line.chars.length;
    const spans = line.chars.map((ch, i) => {
      const r = charReveal(frame, i, count, {
        inStartFrame: line.inStartFrame,
        inFrames,
        staggerFrames,
        outStartFrame: line.outStartFrame,
        outFrames,
        outStaggerFrames,
      });
      const reveal = Math.min(r.in, r.out);
      if (ch === " ") {
        return (
          <span key={i} style={{ display: "inline-block", width: "0.6em" }} />
        );
      }
      if (echoLayer) {
        // 背後のエコー: 解像後も残る大きなボケの照り返し
        const echoOpacity = 0.55 * echo * reveal;
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              opacity: echoOpacity,
              filter: `blur(${(line.fontSize * 0.16).toFixed(1)}px)`,
            }}
          >
            {ch}
          </span>
        );
      }
      // 前面の本体: ボケが解けて解像する。芯が立ってから輪郭が締まる
      const blurPx = maxBlurPx * line.blurScale * (1 - reveal) ** 1.4;
      const opacity = clamp01(reveal * 1.2) ** 0.85;
      const glowAlpha = 0.5 * glow * reveal;
      const shadow =
        glow > 0
          ? `0 0 ${(line.fontSize * 0.14).toFixed(1)}px rgba(255,255,250,${glowAlpha.toFixed(3)})`
          : undefined;
      return (
        <span
          key={i}
          style={{
            display: "inline-block",
            opacity,
            filter: `blur(${blurPx.toFixed(2)}px)`,
            textShadow: shadow,
          }}
        >
          {ch}
        </span>
      );
    });

    return (
      <div
        key={key}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${line.posY * 100}%`,
          transform: "translateY(-50%)",
          textAlign: "center",
          fontFamily,
          fontWeight: line.fontWeight,
          fontSize: line.fontSize,
          color: line.color,
          letterSpacing: `${line.letterSpacingEm}em`,
          // ワイドトラッキング時の視覚センター補正（末尾字間ぶん右へ寄るのを戻す）
          textIndent: `${line.letterSpacingEm}em`,
          textTransform: uppercase ? "uppercase" : undefined,
          whiteSpace: "pre",
          lineHeight: 1.2,
        }}
      >
        {spans}
      </div>
    );
  };

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          transform: `scale(${scale}) translateY(${rise.toFixed(2)}px)`,
          transformOrigin: "50% 50%",
        }}
      >
        {echo > 0 && lines.map((l, i) => renderLine(l, true, `echo-${i}`))}
        {lines.map((l, i) => renderLine(l, false, `main-${i}`))}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
