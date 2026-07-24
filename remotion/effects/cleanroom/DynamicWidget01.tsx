import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadNotoSansJP } from "@remotion/google-fonts/NotoSansJP";

// 旧既定は Mac ローカルの 'Helvetica Neue'（和文は Hiragino Kaku Gothic ProN）。
// 配布ビルドで化けないよう、字形の近い Inter 700 に置換し、
// 和文グリフは Noto Sans JP 700 で受ける。
const { fontFamily: INTER } = loadInter("normal", {
  weights: ["700"],
  subsets: ["latin", "latin-ext"],
});
const { fontFamily: NOTO_SANS_JP } = loadNotoSansJP("normal", {
  weights: ["700"],
  subsets: ["japanese", "latin"],
});

// ============================================================================
// DynamicWidget01 (クリーンルーム再実装)
// 手描き風の白枠ウィジェットが小刻みに揺れ、効果線ダッシュ（アクセント）を
// 従えて見出しを囲むダイナミックタイトル。
// - 冒頭: 枠線がドローオン（一筆書き）
// - 続いて: 周囲のダッシュ群が時間差でポップイン、見出しがフェード着地
// - 保持: 全体がオーガニックに小刻みに揺れる（wriggle）
// - 終端: 全体がわずかに縮みながらフェードアウト
// 設計はデザイン空間 1920x1080 基準。実解像度へは width/1920 で等比スケール。
// ============================================================================

/** 滑らかな擬似ノイズ（周期の異なるsinの重ね合わせ、-1..1） */
const wobbleNoise = (t: number, seed: number): number =>
  Math.sin(t * 1.1 + seed * 12.9898) * 0.5 +
  Math.sin(t * 2.3 + seed * 78.233) * 0.32 +
  Math.sin(t * 4.1 + seed * 37.719) * 0.18;

/** 決定的な擬似乱数（-1..1）。ビルド毎に不変。 */
const hashRand = (seed: number): number => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

type AccentSpec = {
  /** 枠中心基準の相対位置（枠の半幅/半高に対する倍率） */
  rx: number;
  ry: number;
  /** ダッシュの向き（度、0=水平） */
  angle: number;
  /** ダッシュ本数（2〜3） */
  count: number;
  /** ポップイン開始の遅延（イン全体に対する 0..1） */
  delay: number;
};

/** 効果線ダッシュ群の配置。上下は「＝」、四隅は斜めの「//」。 */
const ACCENTS: readonly AccentSpec[] = [
  { rx: -0.09, ry: -1.24, angle: -7, count: 2, delay: 0.0 }, // 上中央 =
  { rx: 0.17, ry: 1.21, angle: -7, count: 2, delay: 0.1 }, // 下中央 =
  { rx: -1.19, ry: -0.85, angle: -64, count: 2, delay: 0.2 }, // 左上 //
  { rx: 1.16, ry: -0.83, angle: -64, count: 2, delay: 0.3 }, // 右上 //
  { rx: -1.15, ry: 0.76, angle: -64, count: 2, delay: 0.4 }, // 左下 //
  { rx: 1.21, ry: 0.55, angle: -64, count: 3, delay: 0.5 }, // 右下 ///
];

export type DynamicWidgetW4GLProps = {
  /** 見出しテキスト */
  text?: string;
  /** 総尺（フレーム） */
  durationInFrames: number;
  /** 見出しフォントサイズ（1920x1080基準px） */
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number | string;
  /** 字間（em） */
  letterSpacing?: number;
  /** 見出し色 */
  textColor?: string;
  /** 枠・ダッシュの線色 */
  lineColor?: string;
  /** 線の太さ（1920x1080基準px） */
  strokeWidth?: number;
  /** 枠のサイズ（1920x1080基準px） */
  frameWidth?: number;
  frameHeight?: number;
  /** ウィジェット全体の位置オフセット（画面中央基準、1920x1080基準px） */
  posX?: number;
  posY?: number;
  /** 見出しの枠内オフセット（1920x1080基準px） */
  textOffsetX?: number;
  textOffsetY?: number;
  /** 枠のベース回転（度） */
  baseRotation?: number;
  /** 揺れの強さ（1=標準、0=静止） */
  wobbleAmount?: number;
  /** 揺れの速さ（1=標準） */
  wobbleSpeed?: number;
  /** イン/アウトの長さ（フレーム） */
  inFrames?: number;
  outFrames?: number;
  /** ダッシュ群の表示（false で枠と見出しのみ） */
  showAccents?: boolean;
  /** ダッシュ群の大きさ倍率 */
  accentScale?: number;
  /** 揺れ・手描き歪みの乱数シード */
  seed?: number;
};

export const DynamicWidget01: React.FC<DynamicWidgetW4GLProps> = ({
  text = "SURGING",
  durationInFrames,
  fontSize = 110,
  fontFamily = `'${INTER}', '${NOTO_SANS_JP}', sans-serif`,
  fontWeight = 700,
  letterSpacing = 0.015,
  textColor = "#ffffff",
  lineColor = "#ffffff",
  strokeWidth = 3.6,
  frameWidth = 985,
  frameHeight = 572,
  posX = 0,
  posY = 5,
  textOffsetX = 0,
  textOffsetY = 0,
  baseRotation = -1.1,
  wobbleAmount = 1,
  wobbleSpeed = 1,
  inFrames = 20,
  outFrames = 16,
  showAccents = true,
  accentScale = 1,
  seed = 7,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const scale = width / 1920;
  const t = (frame / fps) * wobbleSpeed;

  const cx = 1920 / 2 + posX;
  const cy = 1080 / 2 + posY;
  const halfW = frameWidth / 2;
  const halfH = frameHeight / 2;

  // ---- 手描き風の枠パス（角ごとの微オフセット + 辺の微たわみ、揺れ付き） ----
  const framePath = useMemo(() => {
    // useMemo はパス構築ロジックの見通しのため。frame 依存なので毎フレーム再計算される。
    const jitter = (k: number, amp: number) =>
      wobbleNoise(t * 0.9, seed + k) * amp * 0.7 * wobbleAmount +
      hashRand(seed * 3 + k) * amp * 0.5;

    // 4角（左上から時計回り）。数pxの不揃いで「手描きの矩形」に。
    const corners = [
      [-halfW + jitter(1, 5), -halfH + jitter(2, 5)],
      [halfW + jitter(3, 5), -halfH + jitter(4, 5)],
      [halfW + jitter(5, 5), halfH + jitter(6, 5)],
      [-halfW + jitter(7, 5), halfH + jitter(8, 5)],
    ] as const;

    // 各辺は中点をわずかに膨らませた2次ベジェで「定規を使わない線」に。
    const seg = (
      a: readonly [number, number],
      b: readonly [number, number],
      k: number
    ): string => {
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      // 辺と直交方向へのたわみ
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const bow = jitter(20 + k, 3.5);
      return `Q ${mx + nx * bow} ${my + ny * bow} ${b[0]} ${b[1]}`;
    };

    return [
      `M ${corners[0][0]} ${corners[0][1]}`,
      seg(corners[0], corners[1], 1),
      seg(corners[1], corners[2], 2),
      seg(corners[2], corners[3], 3),
      seg(corners[3], corners[0], 4),
      "Z",
    ].join(" ");
  }, [t, seed, halfW, halfH, wobbleAmount]);

  // ---- タイミング ----
  // 枠ドローオン: 0 → inFrames*0.55
  const drawEnd = inFrames * 0.55;
  const drawProgress = interpolate(frame, [0, drawEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.33, 0, 0.2, 1),
  });

  // 見出し: ドローオン完了付近からフェード + 微スケール着地
  const textStart = inFrames * 0.45;
  const textOpacity = interpolate(
    frame,
    [textStart, textStart + inFrames * 0.35],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const textScale = interpolate(
    frame,
    [textStart, textStart + inFrames * 0.6],
    [0.94, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    }
  );

  // アウト: 全体フェード + 微シュリンク
  const outStart = durationInFrames - outFrames;
  const globalOpacity = interpolate(frame, [outStart, durationInFrames - 1], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.4, 0, 1, 1),
  });
  const globalScale = interpolate(frame, [outStart, durationInFrames - 1], [1, 0.955], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.4, 0, 0.8, 1),
  });

  // ---- 全体の揺れ（wriggle）----
  const wobRot = wobbleNoise(t * 0.8, seed + 40) * 0.4 * wobbleAmount;
  const wobX = wobbleNoise(t * 0.7, seed + 41) * 4 * wobbleAmount;
  const wobY = wobbleNoise(t * 0.7, seed + 42) * 4 * wobbleAmount;

  const dashLen = 55 * accentScale;
  const dashGap = 15 * accentScale;

  return (
    <AbsoluteFill style={{ opacity: globalOpacity }}>
      <AbsoluteFill
        style={{
          transform: `scale(${globalScale})`,
          transformOrigin: "50% 50%",
        }}
      >
        <svg
          width={width}
          height={height}
          viewBox="0 0 1920 1080"
          style={{ position: "absolute", inset: 0 }}
        >
          <g
            transform={`translate(${cx + wobX} ${cy + wobY}) rotate(${
              baseRotation + wobRot
            })`}
          >
            {/* 枠（一筆書きドローオン。pathLength=1 で進捗をそのまま dash に） */}
            <path
              d={framePath}
              fill="none"
              stroke={lineColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - drawProgress}
            />

            {/* 効果線ダッシュ群 */}
            {showAccents &&
              ACCENTS.map((a, i) => {
                const start = drawEnd * 0.6 + a.delay * inFrames * 0.55;
                const popDur = inFrames * 0.3;
                const pop = interpolate(frame, [start, start + popDur], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.2, 0.9, 0.3, 1),
                });
                if (pop <= 0) return null;

                // 群ごとの独立した微揺れ
                const ax =
                  a.rx * halfW + wobbleNoise(t * 1.1, seed + 60 + i) * 5 * wobbleAmount;
                const ay =
                  a.ry * halfH + wobbleNoise(t * 1.1, seed + 80 + i) * 5 * wobbleAmount;
                const aRot =
                  a.angle + wobbleNoise(t * 1.0, seed + 100 + i) * 4 * wobbleAmount;

                return (
                  <g
                    key={i}
                    transform={`translate(${ax} ${ay}) rotate(${aRot}) scale(${
                      0.5 + 0.5 * pop
                    })`}
                    opacity={pop}
                  >
                    {Array.from({ length: a.count }, (_, j) => {
                      const off = (j - (a.count - 1) / 2) * dashGap;
                      // ダッシュごとに長さと位置を少し不揃いに（手描き感）
                      const lenJitter = 1 + hashRand(seed + i * 10 + j) * 0.12;
                      const slide = hashRand(seed + 5 + i * 10 + j) * 6;
                      const half = (dashLen * lenJitter) / 2;
                      return (
                        <line
                          key={j}
                          x1={-half + slide}
                          y1={off}
                          x2={half + slide}
                          y2={off}
                          stroke={lineColor}
                          strokeWidth={strokeWidth + 1}
                          strokeLinecap="round"
                        />
                      );
                    })}
                  </g>
                );
              })}
          </g>
        </svg>

        {/* 見出し（枠と同じ揺れ系で追従） */}
        <AbsoluteFill
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              transform: [
                `translate(${(posX + textOffsetX + wobX) * scale}px, ${
                  (posY + textOffsetY + wobY) * scale
                }px)`,
                `rotate(${baseRotation + wobRot}deg)`,
                `scale(${textScale})`,
              ].join(" "),
              opacity: textOpacity,
              color: textColor,
              fontFamily,
              fontWeight,
              fontSize: fontSize * scale,
              letterSpacing: `${letterSpacing}em`,
              whiteSpace: "pre",
              textAlign: "center",
              lineHeight: 1.15,
            }}
          >
            {text}
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
