import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadCinzel } from "@remotion/google-fonts/Cinzel";
import { loadFont as loadCormorantGaramond } from "@remotion/google-fonts/CormorantGaramond";

/**
 * CinematicTitle05 — クリーンルーム再実装
 *
 * 荘厳にフェードし、字間がゆっくり広がる映画クレジット風シネマティックタイトル。
 *
 * 構成は2ブロック:
 * - 上段: イタリック・セリフの小さなオーバーライン（例 "festival award nominee"）。
 *   ワイドな字間で静かに置かれるクレジット行。
 * - 下段: ローマン碑文様（Trajan 系）の見出し。語頭だけ大きく、続く文字を
 *   小さな大文字で組むスモールキャップス表現。
 *
 * 動き:
 * - 入場: 文字が左から右へ1文字ずつ、下からわずかに立ち上がりながら
 *   フェードインするカスケード。
 * - ホールド: 全体の字間が尺を通してゆっくり広がり続け、呼吸を保つ。
 * - 退場: 入場と同じ向き（左→右）で1文字ずつ静かにフェードアウト。
 *
 * 機能記述だけを設計の出発点とし、旧実装のレンダリング結果（見た目）を
 * 品質のものさしとして白紙から構成したもの。コード・定数は参照していない。
 *
 * 既定フォントは Google Fonts（Cinzel + Cormorant Garamond）を
 * @remotion/google-fonts 経由でバンドル読込するため、Mac 内蔵フォントに
 * 依存せず配布可能。
 */

const cinzel = loadCinzel();
const cormorant = loadCormorantGaramond();

/** 配布可能な既定フォント（見出し: Trajan系のCinzel） */
const DEFAULT_TITLE_FONT = `${cinzel.fontFamily}, serif`;
/** 配布可能な既定フォント（オーバーライン: イタリックセリフ） */
const DEFAULT_LABEL_FONT = `${cormorant.fontFamily}, serif`;

export type CinematicTitleX7ZJProps = {
  /**
   * 見出しの文言。1行目が見出し、2行目があればオーバーラインを上書きする。
   * （`label` prop の方が優先）
   */
  text?: string;
  /** 見出しの上に置く小さなクレジット行（イタリック） */
  label?: string;
  /** 演出全体の尺（フレーム）。省略時はコンポジションの尺 */
  durationInFrames?: number;
  /** 見出しの基準文字サイズ(px, 1920幅基準で自動スケール) */
  fontSize?: number;
  /** オーバーラインの文字サイズ(px, 1920幅基準で自動スケール) */
  labelFontSize?: number;
  /** 見出しフォント（既定は Cinzel） */
  fontFamily?: string;
  /** オーバーラインフォント（既定は Cormorant Garamond Italic） */
  labelFontFamily?: string;
  /** 見出しの色 */
  color?: string;
  /** オーバーラインの色 */
  labelColor?: string;
  /** 見出し中心の縦位置（0〜1、画面高比） */
  posY?: number;
  /** オーバーライン中心の縦位置（0〜1、画面高比） */
  labelY?: number;
  /** 見出しの初期字間（em） */
  letterSpacingEm?: number;
  /** オーバーラインの初期字間（em） */
  labelLetterSpacingEm?: number;
  /** 尺全体で字間が広がる量（em）——映画クレジットの「ゆっくり開く」呼吸 */
  trackingGrowEm?: number;
  /** 入場カスケードが行全体を走り切る秒数 */
  inSeconds?: number;
  /** 退場カスケードが行全体を走り切る秒数 */
  outSeconds?: number;
  /** 1文字のフェードに使う秒数 */
  charFadeSeconds?: number;
  /** 入場時に文字が立ち上がる距離（em） */
  riseEm?: number;
  /** 語頭に対する後続文字の縮小率（スモールキャップス）。1で無効 */
  smallCapScale?: number;
  /** 見出しを大文字化するか */
  uppercase?: boolean;
  /** 見出しの太さ */
  fontWeight?: number | string;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInSine = (t: number) => 1 - Math.cos((Math.PI / 2) * t);

type CharSpec = {
  char: string;
  /** 0〜1: 行内での正規化位置（カスケードの順番） */
  order: number;
  /** 語頭かどうか（スモールキャップスの大文字側） */
  wordInitial: boolean;
};

/** 行をカスケード用の文字リストへ分解する */
const toChars = (line: string): CharSpec[] => {
  const chars = Array.from(line);
  const n = Math.max(1, chars.length - 1);
  let prevWasSpace = true;
  return chars.map((char, i) => {
    const wordInitial = prevWasSpace && char.trim() !== "";
    prevWasSpace = char.trim() === "";
    return { char, order: i / n, wordInitial };
  });
};

type CascadeLineProps = {
  chars: CharSpec[];
  /** 現在フレームの秒 */
  t: number;
  /** 尺全体の秒 */
  totalSeconds: number;
  inSeconds: number;
  outSeconds: number;
  charFadeSeconds: number;
  riseEm: number;
  style: React.CSSProperties;
  smallCapScale: number;
};

/**
 * 1文字ずつのカスケード行。
 * レイアウトは最終状態で固定し（リフローなし）、透明度と縦オフセットだけを動かす。
 */
const CascadeLine: React.FC<CascadeLineProps> = ({
  chars,
  t,
  totalSeconds,
  inSeconds,
  outSeconds,
  charFadeSeconds,
  riseEm,
  style,
  smallCapScale,
}) => {
  const outStart = totalSeconds - outSeconds - charFadeSeconds;
  return (
    <div style={style}>
      {chars.map((c, i) => {
        // --- 入場: 左→右カスケード（フェード + 立ち上がり） ---
        const inBegin = c.order * inSeconds;
        const pIn = easeOutCubic(clamp01((t - inBegin) / charFadeSeconds));
        // --- 退場: 同じ向きで静かにフェードアウト ---
        const outBegin = outStart + c.order * outSeconds;
        const pOut = easeInSine(clamp01((t - outBegin) / charFadeSeconds));

        const opacity = pIn * (1 - pOut);
        const dy = (1 - pIn) * riseEm;
        const isSpace = c.char.trim() === "";
        const inner: React.CSSProperties = {
          display: "inline-block",
          whiteSpace: "pre",
          opacity,
          transform: dy !== 0 ? `translateY(${dy.toFixed(4)}em)` : undefined,
          fontSize:
            !isSpace && !c.wordInitial && smallCapScale !== 1
              ? `${smallCapScale}em`
              : undefined,
        };
        return (
          <span key={i} style={inner}>
            {c.char}
          </span>
        );
      })}
    </div>
  );
};

export const CinematicTitle05: React.FC<CinematicTitleX7ZJProps> = ({
  text = "Ingrid Solberg",
  label,
  durationInFrames,
  fontSize = 122,
  labelFontSize = 40,
  fontFamily = DEFAULT_TITLE_FONT,
  labelFontFamily = DEFAULT_LABEL_FONT,
  color = "#f5f4f0",
  labelColor = "#efeee9",
  posY = 0.575,
  labelY = 0.4,
  letterSpacingEm = 0.06,
  labelLetterSpacingEm = 0.24,
  trackingGrowEm = 0.05,
  inSeconds = 1.05,
  outSeconds = 1.05,
  charFadeSeconds = 0.55,
  riseEm = 0.28,
  smallCapScale = 0.72,
  uppercase = true,
  fontWeight = 400,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, durationInFrames: compDuration } = useVideoConfig();
  const total = durationInFrames ?? compDuration;

  // 1920幅を基準に解像度へ追従
  const scale = width / 1920;

  const [titleLine, labelLine] = useMemo(() => {
    const lines = String(text).split("\n");
    const title = lines[0] ?? "";
    const rest =
      label ?? (lines.slice(1).join(" ").trim() || "festival award nominee");
    return [title, rest] as const;
  }, [text, label]);

  const titleChars = useMemo(
    () => toChars(uppercase ? titleLine.toUpperCase() : titleLine),
    [titleLine, uppercase]
  );
  const labelChars = useMemo(() => toChars(labelLine), [labelLine]);

  const t = frame / fps;
  const totalSeconds = Math.max(1 / fps, total / fps);

  // ---- 尺を通してゆっくり開き続ける字間（映画クレジットの呼吸） ----
  const lifetime = clamp01(frame / Math.max(1, total - 1));
  const titleTracking = letterSpacingEm + trackingGrowEm * lifetime;
  const labelTracking = labelLetterSpacingEm + trackingGrowEm * 1.4 * lifetime;

  const shared = {
    t,
    totalSeconds,
    inSeconds,
    outSeconds,
    charFadeSeconds,
  } as const;

  const labelStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    top: `${labelY * 100}%`,
    transform: "translateY(-50%)",
    textAlign: "center",
    fontFamily: labelFontFamily,
    fontStyle: "italic",
    fontWeight: 500,
    fontSize: labelFontSize * scale,
    color: labelColor,
    letterSpacing: `${labelTracking}em`,
    // 字間ぶん右へ寄る視覚センターを戻す
    textIndent: `${labelTracking}em`,
    lineHeight: 1.3,
  };

  const titleStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    top: `${posY * 100}%`,
    transform: "translateY(-50%)",
    textAlign: "center",
    fontFamily,
    fontWeight,
    fontSize: fontSize * scale,
    color,
    letterSpacing: `${titleTracking}em`,
    textIndent: `${titleTracking}em`,
    lineHeight: 1.2,
  };

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {labelLine ? (
        <CascadeLine
          {...shared}
          chars={labelChars}
          riseEm={riseEm * 0.55}
          style={labelStyle}
          smallCapScale={1}
        />
      ) : null}
      <CascadeLine
        {...shared}
        chars={titleChars}
        riseEm={riseEm}
        style={titleStyle}
        smallCapScale={smallCapScale}
      />
    </AbsoluteFill>
  );
};
