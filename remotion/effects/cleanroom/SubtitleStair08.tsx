/**
 * SubtitleStair08（クリーンルーム再実装 / 配布可能ライン）
 *
 * 機能: 白のライト級サンセリフ大文字の単語が、右下へ階段状に並びながら
 * 順番に流れ落ちるように現れるエレガントな歌詞テロップ。単語はまず淡く
 * ワイプインし、カラオケ的にじわっと白へ輝度が上がる。中盤で細い黄色の
 * 手描き風カーブが左から一筆書きで添えられ、退場時は入場と同じ順で
 * 単語が左から拭い去られ、カーブは先端から巻き戻って消える。
 *
 * 実装は機能記述と自前レンダリングの見た目比較のみを根拠にした白紙書き起こし。
 * 旧ポートのコード・定数は参照していない。
 *
 * タイムライン（既定値, durationInFrames=D, fps基準）:
 *   0             … 1語目がワイプイン開始（以降 wordStagger ずつ遅れて続く）
 *   revealDur     … 各語のワイプ完了（淡い状態）。その後 brightenDur かけて全白へ
 *   curveStart    … 黄カーブの描き始め（既定 0.65秒地点）
 *   outStart      … 退場開始（既定 D - 1.2秒地点）。語もカーブもここから消える
 */
import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Poppins";

const { fontFamily: POPPINS } = loadFont("normal", {
  weights: ["300"],
  subsets: ["latin", "latin-ext"],
});

export type SubtitleStair08Props = {
  /** 表示テキスト。空白区切りの単語ごとに階段の1段になる */
  text: string;
  /** この字幕の表示フレーム数 */
  durationInFrames: number;

  // ---- レイアウトのつまみ ----
  /** フォントサイズ(px)。既定は1920x1080でワンフレーズが画面幅6割ほどになる大きさ */
  fontSize?: number;
  /** フォントファミリー。既定はPoppins Light（配布可能なGoogle Fonts） */
  fontFamily?: string;
  /** フォントウェイト。既定はライト級 */
  fontWeight?: number;
  /** 字間 */
  letterSpacing?: string | number;
  /** 大文字化するか（既定true） */
  uppercase?: boolean;
  /** 1段ごとの下がり幅(px)。既定は fontSize の45% */
  stepY?: number;
  /** 単語間の水平間隔(px)。既定は fontSize の55% */
  wordGap?: number;
  /** 画面中央からの位置オフセット(px) */
  posX?: number;
  posY?: number;

  // ---- 色のつまみ ----
  /** 文字色 */
  color?: string;
  /** ワイプイン直後の淡さ(0-1)。ここから全白へ輝度が上がる */
  dimLevel?: number;
  /** 黄カーブの色 */
  accentColor?: string;
  /** 黄カーブの線幅(px) */
  accentWidth?: number;
  /** 黄カーブを描くか */
  showAccent?: boolean;

  // ---- タイミングのつまみ（すべてフレーム単位） ----
  /** 単語ごとの入場ずらし。既定 fps*0.18 */
  wordStagger?: number;
  /** 1語のワイプイン時間。既定 fps*0.32 */
  revealDur?: number;
  /** 淡い状態から全白になるまでの時間。既定 fps*0.5 */
  brightenDur?: number;
  /** カーブの描き始め。既定 fps*0.65 */
  curveStart?: number;
  /** カーブを描き切る時間。既定 fps*0.6 */
  curveDraw?: number;
  /** 退場開始。既定 durationInFrames - fps*1.2 */
  outStart?: number;
  /** 単語ごとの退場ずらし。既定 fps*0.1 */
  outStagger?: number;
  /** 1語の退場ワイプ時間。既定 fps*0.35 */
  outDur?: number;
};

/** 手描き風の一筆カーブ（正規化 0..100 座標系）。緩く沈んでから右肩上がりに抜ける */
const ACCENT_PATH = "M 2 42 C 18 58, 36 66, 55 56 C 70 48, 82 36, 96 40";

export const SubtitleStair08: React.FC<SubtitleStair08Props> = ({
  text,
  durationInFrames,
  fontSize = 96,
  fontFamily,
  fontWeight = 300,
  letterSpacing = "0.05em",
  uppercase = true,
  stepY,
  wordGap,
  posX = 0,
  posY = 0,
  color = "#FFFFFF",
  dimLevel = 0.55,
  accentColor = "#F2D437",
  accentWidth = 4,
  showAccent = true,
  wordStagger,
  revealDur,
  brightenDur,
  curveStart,
  curveDraw,
  outStart,
  outStagger,
  outDur,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return null;

  // タイミング既定値（fps・尺に対して相対で決める）
  const stagger = wordStagger ?? fps * 0.18;
  const reveal = Math.max(1, revealDur ?? fps * 0.32);
  const brighten = Math.max(1, brightenDur ?? fps * 0.5);
  const curveT0 = curveStart ?? fps * 0.65;
  const curveWin = Math.max(1, curveDraw ?? fps * 0.6);
  const outT0 = outStart ?? Math.max(0, durationInFrames - fps * 1.2);
  const outStep = outStagger ?? fps * 0.1;
  const outWin = Math.max(1, outDur ?? fps * 0.35);

  // レイアウト既定値
  const drop = stepY ?? fontSize * 0.45;
  const gap = wordGap ?? fontSize * 0.55;

  /** 単語 i の見た目状態を計算 */
  const wordStyle = (i: number): React.CSSProperties => {
    const tIn = i * stagger;
    // 入場: 右側から開いていくワイプ（左端の文字から見えていく）
    const wipeIn = interpolate(frame, [tIn, tIn + reveal], [100, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });
    // 淡→白のカラオケ的な輝度上昇
    const opacityIn = interpolate(
      frame,
      [tIn, tIn + reveal, tIn + reveal + brighten],
      [0, dimLevel, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    // 流れ落ちる導入: 少し上から沈み込む
    const fallIn = interpolate(frame, [tIn, tIn + reveal + brighten * 0.4], [-0.22, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });
    // 退場: 左から拭い去られ、わずかに下へ流れる
    const tOut = outT0 + i * outStep;
    const wipeOut = interpolate(frame, [tOut, tOut + outWin], [0, 100], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.in(Easing.cubic),
    });
    const opacityOut = interpolate(frame, [tOut, tOut + outWin], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const fallOut = interpolate(frame, [tOut, tOut + outWin], [0, 0.18], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.in(Easing.quad),
    });
    return {
      display: "inline-block",
      transform: `translateY(${(i * drop + (fallIn + fallOut) * fontSize).toFixed(2)}px)`,
      opacity: opacityIn * opacityOut,
      clipPath: `inset(-0.3em ${wipeIn.toFixed(2)}% -0.3em ${wipeOut.toFixed(2)}%)`,
    };
  };

  // 黄カーブ: 一筆書きの描画進行（入場で伸び、退場で先端から巻き戻る）
  const drawP = interpolate(frame, [curveT0, curveT0 + curveWin], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const retractP = interpolate(frame, [outT0, outT0 + fps * 0.5], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  const curveP = Math.min(drawP, retractP);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        transform: `translate(${posX}px, ${posY}px)`,
      }}
    >
      <div
        style={{
          position: "relative",
          // 階段の総下がり分を上に半分逃して、ブロック全体を視覚的に中央へ
          marginTop: -((words.length - 1) * drop) / 2,
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "nowrap",
            columnGap: gap,
            fontFamily: fontFamily ?? POPPINS,
            fontWeight,
            fontSize,
            letterSpacing,
            textTransform: uppercase ? "uppercase" : "none",
            color,
            whiteSpace: "pre",
          }}
        >
          {words.map((w, i) => (
            <span key={`${w}-${i}`} style={wordStyle(i)}>
              {w}
            </span>
          ))}
        </div>
        {/* 手描き風の黄カーブ（テキストブロック全体に重ねる） */}
        {showAccent && curveP > 0 && (
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{
              position: "absolute",
              left: "-2%",
              top: 0,
              width: "104%",
              height: `${fontSize * 1.2 + (words.length - 1) * drop}px`,
              overflow: "visible",
              pointerEvents: "none",
              // 左→右へ筆が走るように見せるクリップ描画（先端から巻き戻りも同じ軸）
              clipPath: `inset(-50% ${((1 - curveP) * 100).toFixed(2)}% -50% -5%)`,
            }}
          >
            <path
              d={ACCENT_PATH}
              fill="none"
              stroke={accentColor}
              strokeWidth={accentWidth}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </div>
    </AbsoluteFill>
  );
};

export default SubtitleStair08;
