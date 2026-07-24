/**
 * BackgroundSlide03（クリーンルーム再実装 / 配布可能ライン）
 *
 * 機能: 白い紙面が左右から滑り込んでくる背景。
 * 画面を上下2枚に割り、上半分は左から・下半分は右から紙テクスチャが
 * スライドインして1枚の紙面に合体する。全体は黒からのフェードインを伴い、
 * 定常状態は「簀の目（横罫の漉き目）＋雲状の淡いムラ＋微細な斑点」のある
 * 明るいオフホワイトのペーパー背景。黒系文字の歌詞を載せる明るい場面向き。
 *
 * 実装は機能記述と自前レンダリングの見た目比較のみを根拠にした白紙書き起こし。
 * 旧ポートのコード・定数は参照していない。
 *
 * タイムライン（既定値, 24fps基準）:
 *   0                  … 真っ黒。紙2枚がスライド開始
 *   slideDuration(10f) … 紙が全面を覆う（ほぼ等速）
 *   fadeDuration(24f)  … 黒フェードが明け切り、定常の白紙になる
 *   以降               … 静止した紙テクスチャ（歌詞の下地）
 *
 * フォント非依存（テキストを一切描画しない背景エフェクト）。
 * テクスチャはインラインSVG(feTurbulence)とCSSグラデーションのみで生成し、
 * 外部アセット・システムフォントに依存しない。
 */
import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export type BackgroundSlide03Props = {
  // ---- 色のつまみ ----
  /** 紙のベース色。既定はわずかに青みのあるオフホワイト */
  paperColor?: string;
  /** スライド前・フェイド元の背景色（黒フェードの色） */
  backgroundColor?: string;

  // ---- タイミングのつまみ ----
  /** 紙がスライドインし切るまでのフレーム数 */
  slideDurationInFrames?: number;
  /** 黒フェードが明け切るまでのフレーム数 */
  fadeDurationInFrames?: number;

  // ---- レイアウトのつまみ ----
  /** 上下分割位置（0〜1、上パネルの高さ比率） */
  splitRatio?: number;
  /** 上パネルの進入方向。下パネルは自動的に逆方向 */
  topEntersFrom?: "left" | "right";

  // ---- テクスチャのつまみ ----
  /** 雲状ムラの濃さ（0でムラなし。既定0.15） */
  mottleOpacity?: number;
  /** 簀の目（横罫）の濃さ（0で罫なし。既定0.06） */
  laidLineOpacity?: number;
  /** 簀の目の間隔(px) */
  laidLineSpacing?: number;
  /** 微細な斑点の濃さ（0で斑点なし。既定0.22） */
  speckleOpacity?: number;
  /** テクスチャの乱数シード（模様の出方を変える） */
  seed?: number;
};

/** 決定論的な擬似乱数（LCG）。フレームに依存しない静的テクスチャ用 */
const makeRandom = (seed: number) => {
  let state = (seed * 2654435761) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

/**
 * 紙テクスチャのSVGをdata URIとして生成する。
 * - 低周波 fractalNoise のアルファをコントラスト増幅 → 雲状の淡い陰影ムラ
 * - シード付き擬似乱数で散らした微小な円 → 紙面の斑点（漉きゴミ）
 */
const buildPaperTextureUri = (
  width: number,
  height: number,
  paperColor: string,
  mottleOpacity: number,
  speckleOpacity: number,
  seed: number,
): string => {
  const rand = makeRandom(seed);
  const speckleCount = Math.round((width * height) / 16000);
  let speckles = "";
  for (let i = 0; i < speckleCount; i++) {
    const cx = (rand() * width).toFixed(1);
    const cy = (rand() * height).toFixed(1);
    const r = (0.8 + rand() * 1.4).toFixed(2);
    const a = (speckleOpacity * (0.35 + rand() * 0.65)).toFixed(3);
    speckles += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="rgb(120,122,128)" fill-opacity="${a}"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <filter id="mottle" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.0018 0.0024" numOctaves="3" seed="${seed}" stitchTiles="stitch"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.53  0 0 0 4 -1.7"/>
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="${paperColor}"/>
  <rect width="100%" height="100%" filter="url(#mottle)" opacity="${mottleOpacity}"/>
  ${speckles}
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

type PaneProps = {
  /** パネル上端のy座標(px) */
  top: number;
  /** パネルの高さ(px) */
  height: number;
  /** 横方向オフセット(px)。0で定位置 */
  offsetX: number;
  /** 画面全体サイズ（テクスチャの継ぎ目を合わせるため） */
  screenWidth: number;
  screenHeight: number;
  textureUri: string;
  laidLineOpacity: number;
  laidLineSpacing: number;
};

/** 画面全幅ぶんの紙テクスチャを内包し、横スライドする1枚のパネル */
const PaperPane: React.FC<PaneProps> = ({
  top,
  height,
  offsetX,
  screenWidth,
  screenHeight,
  textureUri,
  laidLineOpacity,
  laidLineSpacing,
}) => {
  const laidLines = `repeating-linear-gradient(to bottom, rgba(108,111,120,${laidLineOpacity}) 0px, rgba(108,111,120,${laidLineOpacity}) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) ${laidLineSpacing}px)`;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top,
        width: screenWidth,
        height,
        overflow: "hidden",
        transform: `translateX(${offsetX}px)`,
      }}
    >
      {/*
        テクスチャはパネル内に「画面全体サイズ」で敷き、上端を -top ずらす。
        これで2枚が定位置に収まったとき模様が1枚の紙として連続する。
      */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: -top,
          width: screenWidth,
          height: screenHeight,
          backgroundImage: `${laidLines}, url("${textureUri}")`,
        }}
      />
    </div>
  );
};

export const BackgroundSlide03: React.FC<BackgroundSlide03Props> = ({
  paperColor = "#e4e5e7",
  backgroundColor = "#000000",
  slideDurationInFrames = 10,
  fadeDurationInFrames = 24,
  splitRatio = 0.5,
  topEntersFrom = "left",
  mottleOpacity = 0.15,
  laidLineOpacity = 0.06,
  laidLineSpacing = 6,
  speckleOpacity = 0.22,
  seed = 7,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const textureUri = useMemo(
    () =>
      buildPaperTextureUri(
        width,
        height,
        paperColor,
        mottleOpacity,
        speckleOpacity,
        seed,
      ),
    [width, height, paperColor, mottleOpacity, speckleOpacity, seed],
  );

  // 紙のスライド（ほぼ等速で滑り込み、定位置でピタッと止まる）
  // duration=0 だと interpolate が [0,0] で throw するため下限1を保証（=即着地）
  const slideProgress = interpolate(
    frame,
    [0, Math.max(1, slideDurationInFrames)],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const topSign = topEntersFrom === "left" ? -1 : 1;
  const topOffsetX = topSign * (1 - slideProgress) * width;
  const bottomOffsetX = -topSign * (1 - slideProgress) * width;

  // 黒からの全画面フェードイン（紙もろとも暗→明）
  // duration=0 だと interpolate が [0,0] で throw するため下限1を保証（=即点灯）
  const fadeOpacity = interpolate(
    frame,
    [0, Math.max(1, fadeDurationInFrames)],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const splitY = Math.round(height * splitRatio);

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      <PaperPane
        top={0}
        height={splitY}
        offsetX={topOffsetX}
        screenWidth={width}
        screenHeight={height}
        textureUri={textureUri}
        laidLineOpacity={laidLineOpacity}
        laidLineSpacing={laidLineSpacing}
      />
      <PaperPane
        top={splitY}
        height={height - splitY}
        offsetX={bottomOffsetX}
        screenWidth={width}
        screenHeight={height}
        textureUri={textureUri}
        laidLineOpacity={laidLineOpacity}
        laidLineSpacing={laidLineSpacing}
      />
      {fadeOpacity > 0 ? (
        <AbsoluteFill style={{ backgroundColor, opacity: fadeOpacity }} />
      ) : null}
    </AbsoluteFill>
  );
};

export default BackgroundSlide03;
