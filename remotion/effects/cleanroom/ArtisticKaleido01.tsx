import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadNotoSansJP } from "@remotion/google-fonts/NotoSansJP";

/**
 * ArtisticKaleido01 — クリーンルーム再実装
 *
 * ミラークローン万華鏡＋グレースケール・ティール/赤錆デュオトーンで組む
 * 装飾タイトル。
 *
 * 中央に主役のタイトル（近白・淡い赤の色収差フリンジ＋柔グロー）、
 * その周囲 8 方位に左右/上下反転したミラークローンを敷き、
 * クローンには位置ごとにティール灰と赤錆のデュオトーン階調を割り当てる。
 * 背景は漆黒＋斜めの淡い光条＋ビネット＋フィルムグレイン。
 * 全体はフェードイン → ホールド → フェードアウトの包絡線で出入りし、
 * ホールド中はごく僅かなズームドリフトで画に呼吸を与える。
 *
 * 機能記述「ミラークローン万華鏡＋グレースケール・ティール/赤錆
 * デュオトーンで組む装飾タイトル」を出発点に、旧レンダリング
 * （見た目のものさし）と同等以上の質感を白紙から構成したもの。
 * 旧実装のコード・定数は参照していない。
 */

const anton = loadAnton();
const notoJP = loadNotoSansJP("normal", {
  weights: ["900"],
  subsets: ["latin", "japanese"],
});

/** 既定フォント: Anton（Google Fonts/OFL）＋日本語は Noto Sans JP 900 で受ける */
const DEFAULT_FONT_FAMILY = `${anton.fontFamily}, ${notoJP.fontFamily}, sans-serif`;

export type ArtisticKaleido00R7Props = {
  /** 表示する文言 */
  text?: string;
  /** 演出全体の尺（フレーム）。フェードイン/アウトをこの中に収める */
  durationInFrames?: number;
  /** 文字サイズ(px) */
  fontSize?: number;
  /** フォント（既定は Anton + Noto Sans JP 900。配布可能な Google Fonts） */
  fontFamily?: string;
  /** 太さ */
  fontWeight?: number | string;
  /** 字間(em) */
  letterSpacingEm?: number;
  /** 大文字化するか */
  uppercase?: boolean;
  /** 主役テキストの色 */
  textColor?: string;
  /** デュオトーンの寒色（ティール灰） */
  tealColor?: string;
  /** デュオトーンの暖色（赤錆） */
  rustColor?: string;
  /** クローン全体の濃さ（0で消える、1で既定） */
  cloneStrength?: number;
  /** 上下の列の縦オフセット（画面高比 0〜1） */
  rowOffset?: number;
  /** 上下の列の横ずらし（画面幅比。上列は左へ、下列は右へ） */
  rowShiftX?: number;
  /** クローン面の傾き（度） */
  fieldTiltDeg?: number;
  /** 主役の中心位置 X（0〜1、画面幅比） */
  posX?: number;
  /** 主役の中心位置 Y（0〜1、画面高比） */
  posY?: number;
  /** 背景ベース色 */
  backgroundColor?: string;
  /** 色収差フリンジの強さ(px)。0で無効 */
  chromaOffset?: number;
  /** フィルムグレインの濃さ（0〜1） */
  grainOpacity?: number;
  /** ビネットの濃さ（0〜1） */
  vignetteStrength?: number;
  /** フェードイン所要（秒） */
  fadeInSeconds?: number;
  /** フェードアウト所要（秒） */
  fadeOutSeconds?: number;
  /** ホールド中に掛かる微ズーム量（1.02 = 2%） */
  zoomDrift?: number;
};

/** #rrggbb を [r,g,b] に。異形は黒扱い */
const hexToRgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};

/** 色 hex を明度係数 level(0〜1) で暗くして rgb() 文字列に */
const shade = (hex: string, level: number): string => {
  const [r, g, b] = hexToRgb(hex);
  const k = Math.max(0, Math.min(1, level));
  return `rgb(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)})`;
};

type Tint = { kind: "teal" | "rust"; level: number };

/**
 * 8方位クローンの配色マップ（行×列、中央は主役なので null）。
 * 上の列ほど明るく、下の列ほど沈む。左右で寒暖が入れ替わり、
 * 対角にも寒暖が散るように配置して万華鏡らしい色の回りを作る。
 */
const TINT_GRID: (Tint | null)[][] = [
  [
    { kind: "teal", level: 0.95 },
    { kind: "teal", level: 1.0 },
    { kind: "rust", level: 0.9 },
  ],
  [{ kind: "teal", level: 0.8 }, null, { kind: "rust", level: 0.65 }],
  [
    { kind: "rust", level: 0.55 },
    { kind: "teal", level: 0.45 },
    { kind: "teal", level: 0.4 },
  ],
];

/** フィルムグレイン用の SVG ノイズタイル（data URI、外部依存なし） */
const GRAIN_TILE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='240' height='240' filter='url(%23n)'/></svg>`
  );

export const ArtisticKaleido01: React.FC<ArtisticKaleido00R7Props> = ({
  text = "almost here",
  durationInFrames,
  fontSize = 170,
  fontFamily = DEFAULT_FONT_FAMILY,
  fontWeight = 400,
  letterSpacingEm = 0.01,
  uppercase = true,
  textColor = "#e9eded",
  tealColor = "#93a4a6",
  rustColor = "#6e3428",
  cloneStrength = 1,
  rowOffset = 0.455,
  rowShiftX = 0.05,
  fieldTiltDeg = 1.3,
  posX = 0.5,
  posY = 0.5,
  backgroundColor = "#0e1112",
  chromaOffset = 2,
  grainOpacity = 0.07,
  vignetteStrength = 0.6,
  fadeInSeconds = 0.6,
  fadeOutSeconds = 0.55,
  zoomDrift = 1.02,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames: compDuration } =
    useVideoConfig();
  const total = durationInFrames ?? compDuration;

  // ---- 包絡線: フェードイン → ホールド → フェードアウト ----
  const fadeInF = Math.max(1, Math.round(fadeInSeconds * fps));
  const fadeOutF = Math.max(1, Math.round(fadeOutSeconds * fps));
  const opacity = Math.max(
    0,
    Math.min(
      1,
      Math.min(frame / fadeInF, (total - frame) / fadeOutF)
    )
  );

  // ---- ホールド中の微ズームドリフト ----
  const t = total > 1 ? frame / (total - 1) : 0;
  const zoom = 1 + (zoomDrift - 1) * t;

  const display = uppercase ? text.toUpperCase() : text;

  const baseTextStyle: React.CSSProperties = useMemo(
    () => ({
      fontFamily,
      fontWeight,
      fontSize,
      letterSpacing: `${letterSpacingEm}em`,
      whiteSpace: "nowrap",
      lineHeight: 1,
    }),
    [fontFamily, fontWeight, fontSize, letterSpacingEm]
  );

  /** 1列 = [鏡像][正像][鏡像]。行ごとに反転・配色して敷く */
  const renderRow = (row: 0 | 1 | 2) => {
    const flipY = row !== 1;
    const yOffset = (row - 1) * rowOffset * height;
    const xShift = (row - 1) * rowShiftX * width; // 上列は左へ、下列は右へ
    return (
      <div
        key={row}
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: `translate(-50%, -50%) translate(${xShift}px, ${yOffset}px) ${
            flipY ? "scaleY(-1)" : ""
          }`,
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: `${fontSize * 0.12}px`,
        }}
      >
        {[0, 1, 2].map((col) => {
          const tint = TINT_GRID[row][col];
          if (!tint) {
            // 中央セル: 主役の場所は空けておく（主役は別レイヤで上に描く）
            return (
              <span
                key={col}
                style={{ ...baseTextStyle, visibility: "hidden" }}
              >
                {display}
              </span>
            );
          }
          const base = tint.kind === "teal" ? tealColor : rustColor;
          const color = shade(base, tint.level);
          const mirrored = col !== 1;
          return (
            <span
              key={col}
              style={{
                ...baseTextStyle,
                color,
                opacity: Math.max(0, Math.min(1, cloneStrength)),
                transform: mirrored ? "scaleX(-1)" : undefined,
              }}
            >
              {display}
            </span>
          );
        })}
      </div>
    );
  };

  // 色収差フリンジ + 柔グロー（主役のみ）
  const mainShadow =
    chromaOffset > 0
      ? `${chromaOffset}px 0 0 rgba(214, 58, 38, 0.35), ${-chromaOffset}px 0 0 rgba(180, 46, 32, 0.22), 0 0 ${
          fontSize * 0.15
        }px rgba(240, 246, 246, 0.16)`
      : `0 0 ${fontSize * 0.15}px rgba(240, 246, 246, 0.16)`;

  return (
    <AbsoluteFill style={{ backgroundColor, overflow: "hidden" }}>
      <AbsoluteFill style={{ opacity }}>
        {/* 斜めの淡い光条 */}
        <AbsoluteFill
          style={{
            background: `linear-gradient(112deg, rgba(255,255,255,0) 24%, rgba(228,238,238,0.06) 42%, rgba(255,255,255,0) 62%)`,
          }}
        />
        {/* クローン面 + 主役（まとめて微ズーム） */}
        <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
          {/* ミラークローン万華鏡（8方位）。面ごと僅かに傾ける */}
          <AbsoluteFill
            style={{
              transform: `rotate(${fieldTiltDeg}deg)`,
              left: `${(posX - 0.5) * 100}%`,
              top: `${(posY - 0.5) * 100}%`,
            }}
          >
            {renderRow(0)}
            {renderRow(1)}
            {renderRow(2)}
          </AbsoluteFill>
          {/* 主役タイトル（正立・近白・フリンジ＋グロー） */}
          <AbsoluteFill
            style={{
              justifyContent: "center",
              alignItems: "center",
              left: `${(posX - 0.5) * 100}%`,
              top: `${(posY - 0.5) * 100}%`,
            }}
          >
            <div
              style={{
                ...baseTextStyle,
                color: textColor,
                textShadow: mainShadow,
              }}
            >
              {display}
            </div>
          </AbsoluteFill>
        </AbsoluteFill>
        {/* ビネット */}
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse 72% 62% at ${posX * 100}% ${
              posY * 100
            }%, rgba(0,0,0,0) 42%, rgba(0,0,0,${
              0.62 * vignetteStrength
            }) 78%, rgba(0,0,0,${0.9 * vignetteStrength}) 100%)`,
          }}
        />
        {/* フィルムグレイン（フレームごとにタイルを揺らす） */}
        {grainOpacity > 0 ? (
          <AbsoluteFill
            style={{
              backgroundImage: `url("${GRAIN_TILE}")`,
              backgroundRepeat: "repeat",
              backgroundPosition: `${(frame * 61) % 240}px ${
                (frame * 83) % 240
              }px`,
              opacity: grainOpacity,
              mixBlendMode: "overlay",
            }}
          />
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export default ArtisticKaleido01;
