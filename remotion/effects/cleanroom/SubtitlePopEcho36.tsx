/**
 * SubtitlePopEcho36（クリーンルーム再実装 / 配布可能ライン）
 *
 * 機能: 極太ワイド書体の白い大文字テロップが1文字ずつハードポップで現れ、
 * 直下に「輪郭だけのエコーコピー」が上から下へのワイプで滑り込む字幕。
 * 表示終わりは時間反転（パリンドローム）で、エコーが上へ引き、文字が
 * 右から順にポップアウトして消える。リリックビデオのサビ強調向け。
 *
 * 実装は機能記述と自前レンダリングの見た目比較のみを根拠にした白紙書き起こし。
 * 旧ポートのコード・定数は参照していない。
 *
 * タイムライン（既定値, durationInFrames=D, fps基準）:
 *   0〜約0.3秒   … 1文字ずつ左から順にポップイン（スペースも1拍として数える）
 *   約0.2秒〜    … エコー（輪郭コピー）が上から下へワイプイン（約0.95秒）
 *   中盤         … ホールド
 *   終盤         … 上記の時間反転（エコーが引き、文字が右から消える）
 */
import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/Montserrat";

const { fontFamily: MONTSERRAT } = loadFont("normal", {
  weights: ["900"],
  subsets: ["latin"],
});

export type SubtitlePopEcho36Props = {
  /** 表示テキスト。改行(\n)で複数行（各行の直下にエコーが付く） */
  text: string;
  /** この字幕の表示フレーム数 */
  durationInFrames: number;

  // ---- レイアウトのつまみ ----
  /** フォントサイズ(px)。既定は1920x1080で1行がほぼ全幅になる大きさ */
  fontSize?: number;
  /** フォントファミリー。既定はMontserrat 900（極太ワイド） */
  fontFamily?: string;
  /** フォントウェイト（既定900） */
  fontWeight?: number;
  /** 字間（em推奨） */
  letterSpacing?: string | number;
  /** 大文字化するか（既定true） */
  uppercase?: boolean;
  /** 行揃え（既定left: 左端から並ぶレイアウト） */
  textAlign?: "left" | "center" | "right";
  /** 左右の余白(px)。textAlign=left/rightのときの端からの距離 */
  padX?: number;
  /** 画面中央からの位置オフセット(px) */
  posX?: number;
  posY?: number;

  // ---- 色のつまみ ----
  /** 本文の文字色 */
  color?: string;
  /** エコー（輪郭）の色。既定は本文と同色 */
  echoColor?: string;
  /** エコーの輪郭線の太さ(px) */
  echoStrokeWidth?: number;
  /** エコーの不透明度 0〜1 */
  echoOpacity?: number;
  /** 本文キャップ下端からエコー上端までの隙間(em)。既定0.015em */
  echoGap?: number;

  // ---- タイミングのつまみ（すべてフレーム単位） ----
  /** 1文字ごとのポップの間隔。既定 fps/18（24fpsで約1.3F） */
  inStagger?: number;
  /** 1文字のフェード時間。既定 fps/24（24fpsで1F） */
  charFade?: number;
  /** エコーのワイプ開始フレーム。既定 fps*0.19 */
  echoDelay?: number;
  /** エコーのワイプ所要フレーム。既定 fps*0.95 */
  echoDuration?: number;
  /** 終端で時間反転して消えるか（既定true） */
  mirrorOut?: boolean;
};

export const SubtitlePopEcho36: React.FC<SubtitlePopEcho36Props> = ({
  text,
  durationInFrames,
  fontSize = 326,
  fontFamily,
  fontWeight = 900,
  letterSpacing = "0.11em",
  uppercase = true,
  textAlign = "left",
  padX = 128,
  posX = 0,
  posY = -6,
  color = "#FFFFFF",
  echoColor,
  echoStrokeWidth = 2.5,
  echoOpacity = 1,
  echoGap = 0.015,
  inStagger,
  charFade,
  echoDelay,
  echoDuration,
  mirrorOut = true,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 終盤は時間反転（イントロの逆再生）で消える
  const t = mirrorOut ? Math.min(frame, durationInFrames - frame) : frame;

  const stagger = inStagger ?? fps / 18;
  const fade = charFade ?? Math.max(0.5, fps / 24);
  const echoT0 = echoDelay ?? fps * 0.19;
  const echoDur = echoDuration ?? fps * 0.95;

  const lines = text.split("\n").map((l) => Array.from(l));
  const totalChars = lines.reduce((n, l) => n + l.length, 0);
  if (totalChars === 0) return null;

  // 1文字ごとのポップイン（スペースも1拍として数え、間にタメを作る）
  const charOpacity = (globalIndex: number): number =>
    interpolate(t, [globalIndex * stagger, globalIndex * stagger + fade], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  // エコーの上→下ワイプ（出だし速く、終わりゆっくり）
  const echoReveal = interpolate(t, [echoT0, echoT0 + echoDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
  });

  const family = fontFamily ?? MONTSERRAT;
  const lineBase: React.CSSProperties = {
    fontFamily: family,
    fontWeight,
    fontSize,
    lineHeight: 1,
    letterSpacing,
    textTransform: uppercase ? "uppercase" : "none",
    whiteSpace: "pre",
  };

  // エコー上端の位置（本文行ボックス上端から, em）。
  // 0.72 ≒ 太字サンセリフのキャップ下端までの目安 + echoGap で微調整。
  const echoTopEm = 0.72 + echoGap;

  const stroke = echoColor ?? color;
  // エコーの輪郭は WebkitTextStroke だと字形パスの自己交差（Wの中央など）が
  // 線として見えてしまうため、SVGフィルタで「膨張-収縮の差分リング」を作る。
  const filterId = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const rOut = Math.max(0.5, echoStrokeWidth / 2);
  const rIn = Math.max(0.5, echoStrokeWidth - rOut);
  let running = 0; // 行をまたぐ通し文字番号

  return (
    <AbsoluteFill
      style={{
        flexDirection: "column",
        justifyContent: "center",
        alignItems:
          textAlign === "left"
            ? "flex-start"
            : textAlign === "right"
              ? "flex-end"
              : "center",
        paddingLeft: textAlign === "left" ? padX : 0,
        paddingRight: textAlign === "right" ? padX : 0,
        transform: `translate(${posX}px, ${posY}px)`,
      }}
    >
      {/* 輪郭抽出フィルタ: 太らせた形から細らせた形を引いてリングだけ残す */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter id={filterId} x="-5%" y="-20%" width="110%" height="140%">
            <feMorphology in="SourceAlpha" operator="dilate" radius={rOut} result="grow" />
            <feMorphology in="SourceAlpha" operator="erode" radius={rIn} result="shrink" />
            <feComposite in="grow" in2="shrink" operator="out" result="ring" />
            <feFlood floodColor={stroke} result="paint" />
            <feComposite in="paint" in2="ring" operator="in" />
          </filter>
        </defs>
      </svg>
      {lines.map((chars, li) => {
        const startIndex = running;
        running += chars.length;
        const renderChars = (extra: React.CSSProperties) =>
          chars.map((ch, ci) => (
            <span key={ci} style={{ opacity: charOpacity(startIndex + ci), ...extra }}>
              {ch}
            </span>
          ));
        return (
          <div key={li} style={{ position: "relative" }}>
            {/* 本文（ベタ塗り） */}
            <div style={{ ...lineBase, color }}>{renderChars({})}</div>
            {/* エコー（輪郭のみ・直下・上から下へワイプ）。
                レイアウト外(absolute)に置き、本文の縦センターを崩さない */}
            {echoReveal > 0 && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: `${echoTopEm * fontSize}px`,
                  clipPath: `inset(0 -0.1em ${(1 - echoReveal) * 100}% -0.1em)`,
                  opacity: echoOpacity,
                }}
              >
                <div
                  style={{
                    ...lineBase,
                    color: stroke,
                    filter: `url(#${filterId})`,
                  }}
                >
                  {renderChars({})}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

export default SubtitlePopEcho36;
