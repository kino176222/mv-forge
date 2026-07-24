import React, { useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadSourceSans3 } from "@remotion/google-fonts/SourceSans3";
import { loadFont as loadCastoro } from "@remotion/google-fonts/Castoro";

/**
 * CinematicTitleJVPJ — クリーンルーム再実装
 *
 * 荘厳にフェードするシネマティック・タイトル＋2カラムのクレジット。
 *
 * 全大文字・ワイド字間のボールドサンセリフ見出しが画面上寄せ中央に置かれ、
 * 1文字ずつ左から右へ静かにフェードイン。続いてその下のセリフ体クレジット
 * （役職ラベル｜氏名 の2カラム）が上の行から順に浮かび上がる。表示中は
 * 字間がごくゆっくり広がり続け、全体が微かにプッシュインすることで
 * 「静止しているのに生きている」映画エンドロールの质感を出す。終盤は
 * 全体が一様に暗転へ溶けて退場する。
 *
 * 機能記述「荘厳にフェードするシネマティックタイトル＋2カラムのクレジット」を
 * 出発点に、旧レンダリング（見た目のものさし）と同等の質感を白紙から構成した。
 * 既定フォントは Google Fonts（Source Sans 3 / Castoro）をバンドル読込する
 * ため、Mac 内蔵フォントに依存せず配布可能。
 */

const { fontFamily: SOURCE_SANS_3 } = loadSourceSans3("normal", {
  weights: ["700"],
  subsets: ["latin"],
});
const { fontFamily: CASTORO } = loadCastoro("normal", {
  weights: ["400"],
  subsets: ["latin"],
});

/** クレジット1行分（役職ラベルと氏名の2カラム） */
export interface CinematicCreditRow {
  /** 左カラム（役職ラベル。例 "music by:"） */
  label: string;
  /** 右カラム（氏名など） */
  value: string;
}

export interface CinematicTitleJVPJProps {
  /** 見出しの文言（全大文字推奨）。 */
  text?: string;
  /** クレジット行（2カラム）。空配列で見出しのみ。 */
  credits?: CinematicCreditRow[];
  /** 演出全体の尺（フレーム）。 */
  durationInFrames?: number;

  /* ---- 書体 ---- */
  /** 見出しフォント。既定は Source Sans 3（Google Fonts・配布可）。 */
  fontFamily?: string;
  /** 見出しの太さ。 */
  titleFontWeight?: number | string;
  /** クレジットフォント。既定は Castoro（Google Fonts・配布可）。 */
  creditFontFamily?: string;

  /* ---- サイズ・色 ---- */
  /** 見出しサイズ(px)。 */
  fontSize?: number;
  /** クレジットサイズ(px)。 */
  creditFontSize?: number;
  /** 見出しの色。 */
  titleColor?: string;
  /** クレジットの色。 */
  creditColor?: string;

  /* ---- レイアウト（画面比 0〜1） ---- */
  /** 見出し行の縦中心位置。 */
  titleY?: number;
  /** クレジットブロックの縦中心位置。 */
  creditsY?: number;
  /** クレジットブロックの幅（画面幅比）。 */
  creditsWidth?: number;
  /** クレジット2カラム間の隙間(px)。 */
  creditsColumnGap?: number;
  /** クレジット行間の隙間(px)。 */
  creditsRowGap?: number;

  /* ---- 字間の呼吸 ---- */
  /** 見出し字間の開始値（em）。 */
  titleTrackingStart?: number;
  /** 見出し字間の終了値（em）。尺全体をかけてゆっくり広がる。 */
  titleTrackingEnd?: number;
  /** 見出しの語間（em）。スペース1つに追加される幅。 */
  titleWordGap?: number;
  /** クレジットの字間（em）。 */
  creditTracking?: number;

  /* ---- タイミング（秒） ---- */
  /** 見出し1文字ごとのフェード開始ずらし。 */
  titleStaggerSeconds?: number;
  /** 見出し1文字のフェード所要。 */
  titleFadeSeconds?: number;
  /** クレジット最初の要素が出始めるまでの待ち。 */
  creditsDelaySeconds?: number;
  /** クレジット要素（ラベル→氏名→次行…）ごとのずらし。 */
  creditsStaggerSeconds?: number;
  /** クレジット1要素のフェード所要。 */
  creditsFadeSeconds?: number;
  /** 終盤の全体フェードアウト所要。 */
  fadeOutSeconds?: number;

  /* ---- カメラ ---- */
  /** 尺の最後までにかかる微プッシュイン倍率（1で無効）。 */
  pushInScale?: number;
}

const DEFAULT_CREDITS: CinematicCreditRow[] = [
  { label: "music by:", value: "Jerry Alcantara" },
  { label: "conducted by:", value: "Lu Chen Nguyen" },
];

export const CinematicTitleJVPJ: React.FC<CinematicTitleJVPJProps> = ({
  text = "SOUND LAB",
  credits = DEFAULT_CREDITS,
  durationInFrames = 192,
  fontFamily = SOURCE_SANS_3,
  titleFontWeight = 700,
  creditFontFamily = CASTORO,
  fontSize = 111,
  creditFontSize = 33.5,
  titleColor = "#ffffff",
  creditColor = "#ffffff",
  titleY = 0.405,
  creditsY = 0.622,
  creditsWidth = 0.499,
  creditsColumnGap = 112,
  creditsRowGap = 32,
  titleTrackingStart = 0.64,
  titleTrackingEnd = 1.0,
  titleWordGap = 1.2,
  creditTracking = 0.26,
  titleStaggerSeconds = 0.13,
  titleFadeSeconds = 0.34,
  creditsDelaySeconds = 0.5,
  creditsStaggerSeconds = 0.17,
  creditsFadeSeconds = 0.45,
  fadeOutSeconds = 1.27,
  pushInScale = 1,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const chars = useMemo(() => Array.from(text), [text]);

  // ---- 進行度 -------------------------------------------------------------
  const t = frame / fps;
  const totalSec = durationInFrames / fps;

  // 終盤の一様フェードアウト。ゆっくり暗くなり始めて加速しながら
  // 暗転へ溶ける（2次イーズイン）。尺の末尾 fadeOutSeconds をかける。
  const outProgress = interpolate(
    t,
    [totalSec - fadeOutSeconds - 2 / fps, totalSec - 2 / fps],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const outOpacity = 1 - outProgress * outProgress;

  // 字間はごくゆっくり広がり続ける（荘厳さの源）。
  const trackingEm = interpolate(
    t,
    [0, totalSec],
    [titleTrackingStart, titleTrackingEnd],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // 微プッシュイン。
  const scale = interpolate(t, [0, totalSec], [1, pushInScale], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // 要素ごとのフェードイン透明度。
  const fadeIn = (startSec: number, fadeSec: number) =>
    interpolate(t, [startSec, startSec + fadeSec], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  // ---- 見出し（1文字ずつ左→右） -----------------------------------------
  let revealIndex = 0;
  const titleSpans = chars.map((ch, i) => {
    if (ch === " ") {
      // 語間。字間に加えて titleWordGap 分だけ広げる。
      return (
        <span
          key={`sp-${i}`}
          style={{
            display: "inline-block",
            width: `${titleWordGap}em`,
          }}
        />
      );
    }
    const idx = revealIndex++;
    const opacity = fadeIn(idx * titleStaggerSeconds, titleFadeSeconds);
    return (
      <span key={`ch-${i}`} style={{ opacity }}>
        {ch}
      </span>
    );
  });

  // ---- クレジット（ラベル→氏名→次の行… の順に浮かぶ） -------------------
  const creditCells: { text: string; column: 0 | 1; opacity: number }[] = [];
  credits.forEach((row, r) => {
    const labelStart =
      creditsDelaySeconds + (r * 2 + 0) * creditsStaggerSeconds;
    const valueStart =
      creditsDelaySeconds + (r * 2 + 1) * creditsStaggerSeconds;
    creditCells.push({
      text: row.label,
      column: 0,
      opacity: fadeIn(labelStart, creditsFadeSeconds),
    });
    creditCells.push({
      text: row.value,
      column: 1,
      opacity: fadeIn(valueStart, creditsFadeSeconds),
    });
  });

  return (
    <AbsoluteFill style={{ opacity: outOpacity }}>
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>
        {/* 見出し */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: titleY * height,
            transform: "translateY(-50%)",
            textAlign: "center",
            fontFamily,
            fontWeight: titleFontWeight,
            fontSize,
            lineHeight: 1,
            color: titleColor,
            letterSpacing: `${trackingEm}em`,
            whiteSpace: "pre",
          }}
        >
          {titleSpans}
        </div>

        {/* クレジット（2カラム） */}
        {credits.length > 0 && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: creditsY * height,
              transform: "translate(-50%, -50%)",
              width: creditsWidth * width,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              columnGap: creditsColumnGap,
              rowGap: creditsRowGap,
              fontFamily: creditFontFamily,
              fontSize: creditFontSize,
              lineHeight: 1.05,
              color: creditColor,
              letterSpacing: `${creditTracking}em`,
            }}
          >
            {creditCells.map((cell, i) => (
              <span
                key={i}
                style={{
                  opacity: cell.opacity,
                  textAlign: "left",
                  whiteSpace: "pre",
                }}
              >
                {cell.text}
              </span>
            ))}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
