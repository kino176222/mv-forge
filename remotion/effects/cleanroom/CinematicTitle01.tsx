import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadCastoro } from "@remotion/google-fonts/Castoro";
import { loadFont as loadNotoSerifJP } from "@remotion/google-fonts/NotoSerifJP";

/**
 * CinematicTitle01 — クリーンルーム再実装
 *
 * ボケから浮かび上がる、荘厳なシネマティックタイトル。
 * 主題（大文字・ワイドトラッキングのセリフ体）が強いデフォーカスと
 * 低い不透明度から静かに解像し、ホールド中はごく緩いスローズームと
 * 字間の広がり・淡いグローで呼吸を続け、終端では入場と対称に
 * 再びボケの中へ溶けて消える。画面下部には控えめな副題（クレジット）。
 *
 * 機能記述「ボケから浮かび上がる、荘厳なシネマティックタイトル。
 * 主題＋控えめな副題。」を出発点に、旧レンダリング（見た目のものさし）と
 * 同等以上の質感を白紙から構成したもの。
 *
 * 既定フォントは Google Fonts（Castoro + Noto Serif JP）を
 * @remotion/google-fonts 経由でバンドル読込するため、Mac 内蔵フォントに
 * 依存せず配布可能。
 */

const castoro = loadCastoro("normal", { weights: ["400"] });
const notoSerifJP = loadNotoSerifJP("normal", {
  weights: ["400", "500"],
  subsets: ["japanese", "latin"],
  ignoreTooManyRequestsWarning: true,
});

/** 配布可能な既定フォントスタック（欧文=Castoro / 和文=Noto Serif JP） */
const DEFAULT_FONT_FAMILY = `${castoro.fontFamily}, ${notoSerifJP.fontFamily}, serif`;

export type CinematicTitle1JPNProps = {
  /**
   * 表示する文言。1行目が主題、2行目以降は副題（クレジット）になる。
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
  /** 副題の字間（em単位） */
  subtitleLetterSpacingEm?: number;
  /** 主題の中心位置 Y（0〜1、画面高比） */
  posY?: number;
  /** 副題の中心位置 Y（0〜1、画面高比） */
  subtitleY?: number;
  /** 解像（ボケ→クリア）に使う秒数 */
  inSeconds?: number;
  /** 終端でボケに溶けるまでの秒数 */
  outSeconds?: number;
  /** 入退場時の最大ボケ量(px) */
  maxBlurPx?: number;
  /** 尺全体でのスローズーム倍率の増分（0.06 = 6%拡大） */
  zoomGrow?: number;
  /** 尺全体で主題の字間が広がる量（em） */
  trackingGrowEm?: number;
  /** 解像後の淡いグロー強度（0で無効、1で標準） */
  glow?: number;
  /** 主題の太さ */
  fontWeight?: number | string;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 滑らかに立ち上がって収束するイージング（解像の呼吸感） */
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInOutSine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);

export const CinematicTitle01: React.FC<CinematicTitle1JPNProps> = ({
  text = "ECLIPSE",
  subtitle,
  durationInFrames,
  fontSize = 96,
  subtitleFontSize = 27,
  fontFamily = DEFAULT_FONT_FAMILY,
  color = "#f4f2ec",
  subtitleColor = "rgba(238, 236, 228, 0.82)",
  uppercase = true,
  letterSpacingEm = 0.56,
  subtitleLetterSpacingEm = 0.3,
  posY = 0.46,
  subtitleY = 0.87,
  inSeconds = 1.3,
  outSeconds = 1.3,
  maxBlurPx = 26,
  zoomGrow = 0.06,
  trackingGrowEm = 0.04,
  glow = 1,
  fontWeight = 400,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames: compDuration } = useVideoConfig();
  const total = durationInFrames ?? compDuration;

  const [titleLine, subLines] = useMemo(() => {
    const lines = String(text).split("\n");
    const title = lines[0] ?? "";
    const rest = subtitle ?? lines.slice(1).join("\n").trim();
    return [title, rest] as const;
  }, [text, subtitle]);

  // ---- 入退場の「解像度」(0=完全にボケて透明 / 1=完全に解像) ----
  const inFrames = Math.max(1, Math.round(inSeconds * fps));
  const outFrames = Math.max(1, Math.round(outSeconds * fps));
  const inRaw = clamp01(frame / inFrames);
  const outRaw = clamp01((total - 1 - frame) / outFrames);
  const reveal = Math.min(easeOutCubic(inRaw), easeOutCubic(outRaw));

  // 入場: ボケは解像より少し粘る（芯が先に見えてから輪郭が締まる）
  // 退場: ボケが先に戻り、フェードは最後まで粘る（ボケの中へ溶けて消える）
  const blurIn = (1 - easeOutCubic(inRaw)) ** 1.35;
  const blurOut = (1 - outRaw) ** 1.8;
  const blurAmount = maxBlurPx * Math.max(blurIn, blurOut);
  // 不透明度: 入場はゆっくり満ち、退場はボケに包まれながら残光として粘る
  const opacity = Math.min(easeInOutSine(inRaw) ** 1.15, outRaw ** 0.45);

  // ---- 常時の呼吸：スローズーム＋字間の広がり ----
  const lifetime = clamp01(frame / Math.max(1, total - 1));
  const scale = 1 + zoomGrow * easeInOutSine(lifetime);
  const tracking = letterSpacingEm + trackingGrowEm * lifetime;

  // ---- 解像後の淡いグロー（荘厳さの照度） ----
  const glowAlpha = 0.16 * glow * reveal;
  const titleShadow =
    glow > 0
      ? `0 0 ${fontSize * 0.28}px rgba(255,255,250,${glowAlpha.toFixed(3)}), ` +
        `0 0 ${fontSize * 0.9}px rgba(255,255,245,${(glowAlpha * 0.4).toFixed(3)})`
      : undefined;

  const titleStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    top: `${posY * 100}%`,
    transform: `translateY(-50%) scale(${scale})`,
    transformOrigin: "50% 50%",
    textAlign: "center",
    fontFamily,
    fontWeight,
    fontSize,
    color,
    letterSpacing: `${tracking}em`,
    // ワイドトラッキング時の視覚センター補正（末尾字間ぶん右へ寄るのを戻す）
    textIndent: `${tracking}em`,
    textTransform: uppercase ? "uppercase" : undefined,
    whiteSpace: "pre",
    lineHeight: 1.25,
    opacity,
    filter: `blur(${blurAmount.toFixed(2)}px)`,
    textShadow: titleShadow,
  };

  const subtitleStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    top: `${subtitleY * 100}%`,
    transform: `translateY(-50%) scale(${1 + (scale - 1) * 0.5})`,
    transformOrigin: "50% 50%",
    textAlign: "center",
    fontFamily,
    fontWeight: 400,
    fontSize: subtitleFontSize,
    color: subtitleColor,
    letterSpacing: `${subtitleLetterSpacingEm}em`,
    textIndent: `${subtitleLetterSpacingEm}em`,
    textTransform: uppercase ? "uppercase" : undefined,
    whiteSpace: "pre",
    lineHeight: 1.6,
    opacity,
    filter: `blur(${(blurAmount * 0.8).toFixed(2)}px)`,
  };

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={titleStyle}>{titleLine}</div>
      {subLines ? <div style={subtitleStyle}>{subLines}</div> : null}
    </AbsoluteFill>
  );
};
