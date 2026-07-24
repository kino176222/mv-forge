import React, { useId, useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * BackgroundGeo04（クリーンルーム再実装）
 *
 * 漆黒の背景の上で、赤→紫のグレイニーなグラデで塗られた幾何図形が躍る
 * リリックビデオ用の背景。
 *
 * 進行:
 *  1. イントロ: 傾いた大正方形・立体シェーディングの球・左向き三角が、
 *     下からのスライド＋ポップ（回転しながら）で順に登場。細い白線がドローイン。
 *  2. 中盤: 左上に白い「+」の格子、右半分に散在する「+」が段階的に出現。
 *     終盤に手描き風のループ線がドローイン。図形はゆっくり揺れ続ける。
 *  3. アウトロ: すべてが縮みながら沈んで消え、黒に戻る。
 *
 * テキストは一切使わないためフォント依存なし（配布安全）。
 * すべての見た目は props のつまみで調整可能。既定値だけで完成形になる。
 */

export type BackgroundGeo04Props = {
  /** グラデの始点色（既定は朱赤） */
  colorA?: string;
  /** グラデの終点色（既定は青紫） */
  colorB?: string;
  /** 装飾（+ / 線）の色 */
  accentColor?: string;
  /** 背景色（ほぼ黒） */
  backgroundColor?: string;
  /** 背景にうっすら差す明かりの色 */
  sheenColor?: string;

  /** 図形レイアウト全体の拡大率 */
  layoutScale?: number;
  /** 正方形: 中心位置（キャンバス比 0..1）・一辺（高さ比）・傾き（度） */
  squareX?: number;
  squareY?: number;
  squareSize?: number;
  squareTiltDeg?: number;
  /** 球: 中心位置（0..1）・半径（高さ比） */
  sphereX?: number;
  sphereY?: number;
  sphereRadius?: number;
  /** 三角: 重心位置（0..1）・外接半径（高さ比）・最終回転（度、-90で頂点が左） */
  triangleX?: number;
  triangleY?: number;
  triangleSize?: number;
  triangleRotationDeg?: number;

  /** 粒状ノイズの濃さ（0で無効） */
  grainAmount?: number;
  /** 図形のアイドル揺れの強さ（0で静止） */
  driftAmount?: number;

  /** イントロ開始フレーム */
  introDelay?: number;
  /** 「+」格子の出現開始フレーム */
  gridDelay?: number;
  /** 散在「+」の出現開始フレーム */
  scatterDelay?: number;
  /** ループ線のドローイン開始フレーム */
  loopDelay?: number;
  /** アウトロの長さ（フレーム、0で退場なし） */
  outroDuration?: number;

  /** 「+」格子の行列数と表示可否 */
  gridRows?: number;
  gridCols?: number;
  showGrid?: boolean;
  /** 散在「+」の個数・乱数シード・表示可否 */
  scatterCount?: number;
  seed?: number;
  showScatter?: boolean;
  /** ループ線の表示可否 */
  showLoop?: boolean;

  /** 全体の不透明度 */
  opacity?: number;
};

/** #rrggbb → [r,g,b] */
const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const v =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** 2色を t (0..1) で混ぜて #rrggbb を返す */
const mixHex = (a: string, b: string, t: number): string => {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  const c = ra.map((v, i) => Math.round(v + (rb[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

/** 決定論的な擬似乱数（seed 固定でレンダごとに同じ並び） */
const prand = (seed: number, i: number): number => {
  const x = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export const BackgroundGeo04: React.FC<BackgroundGeo04Props> = ({
  colorA = "#e5311a",
  colorB = "#7d43fa",
  accentColor = "#f2f3fa",
  backgroundColor = "#060609",
  sheenColor = "#13131e",
  layoutScale = 1,
  squareX = 0.347,
  squareY = 0.552,
  squareSize = 0.66,
  squareTiltDeg = -6,
  sphereX = 0.594,
  sphereY = 0.289,
  sphereRadius = 0.144,
  triangleX = 0.678,
  triangleY = 0.706,
  triangleSize = 0.245,
  triangleRotationDeg = -90,
  grainAmount = 0.5,
  driftAmount = 1,
  introDelay = 4,
  gridDelay = 38,
  scatterDelay = 72,
  loopDelay = 148,
  outroDuration = 22,
  gridRows = 4,
  gridCols = 4,
  showGrid = true,
  scatterCount = 14,
  seed = 7,
  showScatter = true,
  showLoop = true,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  // ---- 基準寸法（1920x1080 の設計座標で描き、SVG viewBox で全体スケール） ----
  const VW = 1920;
  const VH = 1080;
  const S = VH * layoutScale;

  // ---- アウトロ進行（0=通常, 1=完全退場） ----
  // outroDuration が極端に短い(1〜6)場合でも interpolate のレンジが
  // 逆転・同値にならないよう、終点を Math.max で下限保証する（0=退場なしは維持）。
  const outroStart =
    outroDuration > 0 ? durationInFrames - outroDuration : Infinity;
  const outro =
    outroDuration > 0
      ? interpolate(
          frame,
          [outroStart, Math.max(outroStart + 1, durationInFrames - 4)],
          [0, 1],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.in(Easing.cubic),
          },
        )
      : 0;
  // 装飾（+ / 線）は本体よりひと足先に消える
  const outroDecor =
    outroDuration > 0
      ? interpolate(
          frame,
          [outroStart - 4, Math.max(outroStart - 3, durationInFrames - 10)],
          [0, 1],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.in(Easing.quad),
          },
        )
      : 0;

  // ---- 図形の入場（下からスライド + ポップ） ----
  const enter = (delay: number) => {
    const f = Math.max(0, frame - introDelay - delay);
    const started = frame >= introDelay + delay;
    const pop = spring({
      frame: f,
      fps,
      config: { damping: 14, stiffness: 95, mass: 1 },
    });
    const rise = spring({
      frame: f,
      fps,
      config: { damping: 18, stiffness: 75, mass: 1 },
    });
    return {
      started,
      pop,
      scale: interpolate(pop, [0, 1], [0.12, 1]) * (1 - outro),
      dy:
        interpolate(rise, [0, 1], [S * 0.3, 0]) +
        outro * S * 0.3,
      opacity:
        (started ? interpolate(f, [0, 4], [0, 1], { extrapolateRight: "clamp" }) : 0) *
        interpolate(outro, [0.75, 1], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
    };
  };

  // ---- アイドル揺れ（ゆっくり呼吸するようなドリフト） ----
  const t = frame / fps;
  const drift = (phase: number, period: number) =>
    driftAmount * Math.sin((t * Math.PI * 2) / period + phase);

  // ---- 各図形のジオメトリ ----
  const sqCx = VW * squareX;
  const sqCy = VH * squareY;
  const sqSide = S * squareSize;
  const sq = enter(7);
  const sqRot =
    squareTiltDeg + (1 - sq.pop) * -12 + drift(0.4, 7.3) * 1.1;

  const spCx = VW * sphereX;
  const spCy = VH * sphereY;
  const spR = S * sphereRadius;
  const sp = enter(10);
  const spDy = drift(2.1, 5.9) * S * 0.012;

  const trCx = VW * triangleX;
  const trCy = VH * triangleY;
  const trR = S * triangleSize;
  const tr = enter(2);
  const trRot =
    triangleRotationDeg + (1 - tr.pop) * 84 + drift(4.0, 6.7) * 1.8;
  // 頂点が上の三角形（回転で最終向きに）
  const triPoints = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
      pts.push(`${Math.cos(a) * trR},${Math.sin(a) * trR}`);
    }
    return pts.join(" ");
  }, [trR]);

  // ---- 細い白線（正方形の右下からドローイン） ----
  const lineF = Math.max(0, frame - introDelay - 16);
  const lineDraw = interpolate(lineF, [0, 14], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const lineErase = interpolate(outroDecor, [0, 0.7], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // ---- 「+」格子（左上、行順に間引き出現） ----
  const gridItems = useMemo(() => {
    const items: { x: number; y: number; i: number }[] = [];
    const originX = VW * 0.138;
    const originY = VH * 0.106;
    const gap = S * 0.094;
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        items.push({
          x: originX + c * gap,
          y: originY + r * gap,
          i: r * gridCols + c,
        });
      }
    }
    return items;
  }, [gridRows, gridCols, S]);

  // ---- 散在「+」（右半分、シード固定のランダム配置） ----
  const scatterItems = useMemo(() => {
    const items: {
      x: number;
      y: number;
      size: number;
      delay: number;
      op: number;
    }[] = [];
    for (let i = 0; i < scatterCount; i++) {
      const rx = prand(seed, i * 4 + 0);
      const ry = prand(seed, i * 4 + 1);
      const rs = prand(seed, i * 4 + 2);
      const rd = prand(seed, i * 4 + 3);
      items.push({
        x: VW * (0.545 + rx * 0.42),
        y: VH * (0.03 + ry * 0.95),
        size: S * (0.013 + rs * 0.022),
        delay: rd * 46,
        op: 0.65 + rs * 0.3,
      });
    }
    return items;
  }, [scatterCount, seed, S]);

  // ---- 手描き風ループ線（右側、ドローイン） ----
  const loopDraw = interpolate(
    Math.max(0, frame - loopDelay),
    [0, 30],
    [0, 1],
    { extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) },
  );
  const loopErase = interpolate(outroDecor, [0, 0.65], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const loopPath = useMemo(() => {
    const x = (v: number) => VW * v;
    const y = (v: number) => VH * v;
    return [
      `M ${x(0.805)} ${y(0.312)}`,
      `C ${x(0.786)} ${y(0.39)}, ${x(0.782)} ${y(0.452)}, ${x(0.818)} ${y(0.466)}`,
      `C ${x(0.856)} ${y(0.48)}, ${x(0.866)} ${y(0.418)}, ${x(0.842)} ${y(0.396)}`,
      `C ${x(0.812)} ${y(0.368)}, ${x(0.792)} ${y(0.452)}, ${x(0.83)} ${y(0.53)}`,
      `C ${x(0.852)} ${y(0.574)}, ${x(0.878)} ${y(0.6)}, ${x(0.9)} ${y(0.594)}`,
    ].join(" ");
  }, []);

  // ---- 背景のうっすらした明かり ----
  const sheenIn = interpolate(frame, [2, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const sheenOpacity =
    sheenIn *
    interpolate(outro, [0.5, 1], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  // ---- 「+」1個を描くヘルパ ----
  const plus = (
    key: string,
    x: number,
    y: number,
    size: number,
    strokeW: number,
    op: number,
    scale: number,
  ) => (
    <g
      key={key}
      transform={`translate(${x} ${y}) scale(${scale})`}
      opacity={op}
    >
      <path
        d={`M ${-size} 0 H ${size} M 0 ${-size} V ${size}`}
        stroke={accentColor}
        strokeWidth={strokeW}
        strokeLinecap="butt"
        fill="none"
      />
    </g>
  );

  const gridMid = mixHex(colorA, colorB, 0.52);

  return (
    <AbsoluteFill style={{ backgroundColor, opacity }}>
      {/* 背景のうっすらした明かり */}
      <AbsoluteFill
        style={{
          opacity: sheenOpacity,
          background: `radial-gradient(125% 105% at 70% 58%, ${sheenColor} 0%, ${backgroundColor} 62%, ${backgroundColor} 100%)`,
        }}
      />
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${VW} ${VH}`}
        preserveAspectRatio="xMidYMid slice"
        style={{ position: "absolute", inset: 0 }}
      >
        <defs>
          {/* 正方形: 赤(左上)→紫(右下) */}
          <linearGradient
            id={`${uid}-sq`}
            x1="0"
            y1="0"
            x2="0.92"
            y2="1"
          >
            <stop offset="0" stopColor={colorA} />
            <stop offset="0.2" stopColor={colorA} />
            <stop offset="0.52" stopColor={gridMid} />
            <stop offset="0.82" stopColor={colorB} />
            <stop offset="1" stopColor={mixHex(colorB, "#4a2bd0", 0.35)} />
          </linearGradient>
          {/* 球: 左上に赤いハイライト、下は深い藍紫の闇に沈む */}
          <radialGradient id={`${uid}-sp`} cx="0.33" cy="0.21" r="0.98">
            <stop offset="0" stopColor={mixHex(colorA, "#ff6a3a", 0.3)} />
            <stop offset="0.27" stopColor={colorA} />
            <stop offset="0.56" stopColor={mixHex(colorA, "#2c1348", 0.58)} />
            <stop offset="0.82" stopColor="#2a1547" />
            <stop offset="1" stopColor="#1b0d34" />
          </radialGradient>
          {/* 三角: 上辺寄り（回転後）に赤のホットスポット、地は紫 */}
          <radialGradient id={`${uid}-tr`} cx="0.76" cy="0.57" r="0.8">
            <stop offset="0" stopColor={mixHex(colorA, colorB, 0.1)} />
            <stop offset="0.4" stopColor={mixHex(colorA, colorB, 0.6)} />
            <stop offset="0.75" stopColor={colorB} />
            <stop offset="1" stopColor={mixHex(colorB, "#5c33e0", 0.45)} />
          </radialGradient>
          {/* グレア筋のぼかし */}
          <filter
            id={`${uid}-soft`}
            x="-60%"
            y="-60%"
            width="220%"
            height="220%"
          >
            <feGaussianBlur stdDeviation="26" />
          </filter>
          {/* 粒状ノイズ（図形の中だけに合成） */}
          <filter
            id={`${uid}-grain`}
            x="-15%"
            y="-15%"
            width="130%"
            height="130%"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="2"
              seed="11"
              result="noise"
            />
            <feColorMatrix
              in="noise"
              type="matrix"
              values={`0.9 0 0 0 0.05  0.9 0 0 0 0.05  0.9 0 0 0 0.05  0 0 0 0 ${0.55 * grainAmount}`}
              result="tone"
            />
            <feComposite
              in="tone"
              in2="SourceAlpha"
              operator="in"
              result="clipped"
            />
            <feBlend in="SourceGraphic" in2="clipped" mode="overlay" />
          </filter>
          {/* 正方形内クリップ（グレア筋用） */}
          <clipPath id={`${uid}-sqclip`}>
            <rect
              x={-sqSide / 2}
              y={-sqSide / 2}
              width={sqSide}
              height={sqSide}
            />
          </clipPath>
        </defs>

        {/* ===== 球（正方形の背後） ===== */}
        <g
          transform={`translate(${spCx} ${spCy + sp.dy + spDy}) scale(${sp.scale})`}
          opacity={sp.opacity}
          filter={grainAmount > 0 ? `url(#${uid}-grain)` : undefined}
        >
          <circle r={spR} fill={`url(#${uid}-sp)`} />
        </g>

        {/* ===== 大正方形 ===== */}
        <g
          transform={`translate(${sqCx} ${sqCy + sq.dy}) rotate(${sqRot}) scale(${sq.scale})`}
          opacity={sq.opacity}
          filter={grainAmount > 0 ? `url(#${uid}-grain)` : undefined}
        >
          <rect
            x={-sqSide / 2}
            y={-sqSide / 2}
            width={sqSide}
            height={sqSide}
            fill={`url(#${uid}-sq)`}
          />
          <g clipPath={`url(#${uid}-sqclip)`}>
            {/* 斜めに走る白いグレア筋 */}
            <ellipse
              cx={-sqSide * 0.26}
              cy={-sqSide * 0.27}
              rx={sqSide * 0.27}
              ry={sqSide * 0.035}
              transform={`rotate(24 ${-sqSide * 0.26} ${-sqSide * 0.27})`}
              fill="#ffffff"
              opacity={0.75}
              filter={`url(#${uid}-soft)`}
            />
          </g>
        </g>

        {/* ===== 三角 ===== */}
        <g
          transform={`translate(${trCx} ${trCy + tr.dy}) rotate(${trRot}) scale(${tr.scale})`}
          opacity={tr.opacity}
          filter={grainAmount > 0 ? `url(#${uid}-grain)` : undefined}
        >
          <polygon points={triPoints} fill={`url(#${uid}-tr)`} />
        </g>

        {/* ===== 細い白線 ===== */}
        <path
          d={`M ${VW * 0.475} ${VH * 0.714} L ${VW * 0.543} ${VH * 0.729}`}
          stroke={accentColor}
          strokeWidth={2.4}
          strokeLinecap="round"
          fill="none"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - lineDraw * (1 - lineErase)}
          opacity={0.85 * (1 - lineErase)}
        />

        {/* ===== 「+」格子（左上） ===== */}
        {showGrid &&
          gridItems.map(({ x, y, i }) => {
            const f = Math.max(0, frame - gridDelay - i * 1.6);
            const popIn = spring({
              frame: f,
              fps,
              config: { damping: 14, stiffness: 180, mass: 0.6 },
            });
            const fadeOut = interpolate(
              outroDecor,
              [i / gridItems.length / 3, 0.55 + (i / gridItems.length) * 0.3],
              [1, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );
            return plus(
              `g${i}`,
              x,
              y,
              S * 0.0165,
              6.5,
              (frame >= gridDelay + i * 1.6 ? 0.88 : 0) * fadeOut,
              popIn,
            );
          })}

        {/* ===== 散在「+」（右半分） ===== */}
        {showScatter &&
          scatterItems.map((it, i) => {
            const f = Math.max(0, frame - scatterDelay - it.delay);
            const popIn = spring({
              frame: f,
              fps,
              config: { damping: 13, stiffness: 170, mass: 0.6 },
            });
            const fadeOut = interpolate(
              outroDecor,
              [prand(seed, i + 100) * 0.3, 0.5 + prand(seed, i + 200) * 0.35],
              [1, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );
            return plus(
              `s${i}`,
              it.x,
              it.y,
              it.size,
              Math.max(5, it.size * 0.45),
              (frame >= scatterDelay + it.delay ? it.op : 0) * fadeOut,
              popIn,
            );
          })}

        {/* ===== 手描き風ループ線 ===== */}
        {showLoop && (
          <path
            d={loopPath}
            stroke={accentColor}
            strokeWidth={2.6}
            strokeLinecap="round"
            fill="none"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - loopDraw * (1 - loopErase)}
            opacity={0.75 * (1 - loopErase)}
          />
        )}
      </svg>
    </AbsoluteFill>
  );
};
