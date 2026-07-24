import React, { useId } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

// ============================================================================
// ConfettiStrokes（クリーンルーム再実装）
// 走り書きされるネオンの筆跡6本が、書いては消える一瞬のフラッシュ。
// - 各筆跡は「先端(head)が素早く走って描かれ、尾(tail)が追いかけて消える」
//   ランニングテール方式。全体で約16フレームの一閃。
// - レイアウト・色・太さ・タイミングはすべて props で調整可能。
// - 背景は透明（黒背景・映像の上どちらにも重ねられる）。
// ============================================================================

/** 1本ぶんの設定。省略した項目は既定スロットの値を使う */
export type ConfettiStrokeConfig = {
  /** SVGパス。中心(0,0)基準のローカル座標で書く */
  path?: string;
  /** 筆跡の色（線の主色） */
  color?: string;
  /** 指定するとパス始点→終点の線形グラデーションになる */
  color2?: string;
  /** 書き出しの遅延（フレーム） */
  delay?: number;
};

export type ConfettiStrokesProps = {
  /** シーケンス長（既定 24 = 24fpsで1秒） */
  durationInFrames?: number;
  /** 筆跡クラスタの中心X（px, 1920基準） */
  posX?: number;
  /** 筆跡クラスタの中心Y（px, 1080基準） */
  posY?: number;
  /** クラスタ全体の拡大率 */
  scale?: number;
  /** 線の太さ（px） */
  strokeWidth?: number;
  /** ネオングローの強さ（0でグロー無し、1が既定） */
  glow?: number;
  /** 先端が走り切るまでのフレーム数（書き） */
  drawFrames?: number;
  /** 尾が走り切るまでのフレーム数（消え） */
  eraseFrames?: number;
  /** 書き始めから尾が動き出すまでの間（フレーム） */
  tailDelayFrames?: number;
  /** 全体の不透明度 */
  opacity?: number;
  /** 6色をまとめて差し替え（strokes 個別指定より弱い） */
  colors?: string[];
  /** 本数・形・色・遅延を個別に上書き（配列の長さ＝本数） */
  strokes?: ConfettiStrokeConfig[];
};

// ---- 既定の6本（中心(0,0)基準・おおよそ 560x500px のクラスタ） ----------
// 手描きの走り書きに見えるよう、各線は2〜3回うねる短いスクイグルにする。
const DEFAULT_SLOTS: Required<Omit<ConfettiStrokeConfig, "color2">>[] &
  ConfettiStrokeConfig[] = [
  {
    // 左上: 水色のジグザグ落書き
    path: "M -128 -228 C -162 -252 -196 -232 -186 -202 C -177 -175 -143 -179 -142 -146 C -141 -115 -172 -108 -177 -79",
    color: "#63c8ff",
    delay: 0,
  },
  {
    // 右上: 紫の小さなフック
    path: "M 88 -210 C 100 -240 140 -247 158 -223 C 171 -205 165 -183 149 -175",
    color: "#c06bff",
    delay: 0.6,
  },
  {
    // 中央: 藍紫→マゼンタの波線
    path: "M -75 -70 C -65 -115 -30 -124 -16 -95 C -4 -70 22 -66 40 -87 C 53 -103 77 -105 90 -89 C 100 -77 118 -76 128 -86",
    color: "#7d7bff",
    color2: "#d24fff",
    delay: 0.3,
  },
  {
    // 左下: 青のアーチ→内巻きフック
    path: "M -252 -2 C -218 -32 -180 -24 -169 6 C -159 33 -181 52 -155 76",
    color: "#4d9dff",
    delay: 0.9,
  },
  {
    // 下中央: 青の波線
    path: "M -88 186 C -72 148 -41 146 -22 169 C -5 189 30 191 49 168 C 62 153 84 149 98 162",
    color: "#3f8dff",
    delay: 0.4,
  },
  {
    // 右下: 黄→緑のS字
    path: "M 232 58 C 262 42 284 62 273 89 C 263 113 236 113 230 141 C 225 166 246 178 264 170",
    color: "#ffe94a",
    color2: "#5fe07a",
    delay: 1.0,
  },
];

const DEFAULTS = {
  durationInFrames: 24,
  posX: 960,
  posY: 540,
  scale: 1,
  strokeWidth: 12,
  glow: 1,
  drawFrames: 3,
  eraseFrames: 11,
  tailDelayFrames: 2.5,
  opacity: 1,
} as const;

// ---- イージング ------------------------------------------------------------
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** 出だしが速い（先端の走り出し用） */
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
/** ゆっくり始まり後半で走り抜ける（尾の追走用） */
const easeInOutQuad = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

/** "M x y C ..." 形式のパスから始点/終点座標を雑に取り出す（グラデ軸用） */
const pathEndpoints = (
  d: string,
): { x1: number; y1: number; x2: number; y2: number } => {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [0, 0, 0, 0];
  return {
    x1: nums[0] ?? 0,
    y1: nums[1] ?? 0,
    x2: nums[nums.length - 2] ?? 0,
    y2: nums[nums.length - 1] ?? 0,
  };
};

export const ConfettiStrokes: React.FC<ConfettiStrokesProps> = (props) => {
  const {
    durationInFrames = DEFAULTS.durationInFrames,
    posX = DEFAULTS.posX,
    posY = DEFAULTS.posY,
    scale = DEFAULTS.scale,
    strokeWidth = DEFAULTS.strokeWidth,
    glow = DEFAULTS.glow,
    drawFrames = DEFAULTS.drawFrames,
    eraseFrames = DEFAULTS.eraseFrames,
    tailDelayFrames = DEFAULTS.tailDelayFrames,
    opacity = DEFAULTS.opacity,
    colors,
    strokes,
  } = props;

  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  // 24fps・24フレームを基準に、実fps/尺へ時間スケールを合わせる
  const timeScale = (fps / 24) * (durationInFrames / DEFAULTS.durationInFrames);
  const f = frame / timeScale;

  // 1920x1080 基準の座標系を実解像度へ
  const resScale = width / 1920;

  const slots: ConfettiStrokeConfig[] = (strokes ?? DEFAULT_SLOTS).map(
    (s, i) => {
      const base = DEFAULT_SLOTS[i % DEFAULT_SLOTS.length];
      return {
        path: s.path ?? base.path,
        color: s.color ?? colors?.[i] ?? base.color,
        color2:
          s.color2 ?? (s.color || colors?.[i] ? undefined : base.color2),
        delay: s.delay ?? base.delay,
      };
    },
  );

  const w = strokeWidth;

  return (
    <AbsoluteFill style={{ opacity }}>
      <svg
        width={width}
        height={height}
        viewBox="0 0 1920 1080"
        style={{ position: "absolute", inset: 0 }}
      >
        <defs>
          <filter
            id={`${uid}-glowNear`}
            x="-120%"
            y="-120%"
            width="340%"
            height="340%"
          >
            <feGaussianBlur stdDeviation={4.5 * glow} />
          </filter>
          <filter
            id={`${uid}-glowFar`}
            x="-200%"
            y="-200%"
            width="500%"
            height="500%"
          >
            <feGaussianBlur stdDeviation={13 * glow} />
          </filter>
          {slots.map((s, i) => {
            if (!s.color2) return null;
            const { x1, y1, x2, y2 } = pathEndpoints(s.path ?? "");
            return (
              <linearGradient
                key={i}
                id={`${uid}-grad-${i}`}
                gradientUnits="userSpaceOnUse"
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
              >
                <stop offset="0" stopColor={s.color} />
                <stop offset="1" stopColor={s.color2} />
              </linearGradient>
            );
          })}
        </defs>
        <g transform={`translate(${posX * resScale} ${posY * resScale}) scale(${scale * resScale})`}>
          {slots.map((s, i) => {
            const delay = s.delay ?? 0;
            const local = f - delay;
            // 先端: 一気に走る／尾: 少し遅れて追いかけ、走り抜けて消す
            const head = easeOutCubic(clamp01(local / drawFrames));
            const tail = easeInOutQuad(
              clamp01((local - tailDelayFrames) / eraseFrames),
            );
            const seg = head - tail;
            if (seg <= 0.004 || local < 0) return null;

            // 書き出しの一瞬だけフェードイン（フラッシュの立ち上がり）
            const flash = clamp01(local / 1.5);
            const paint = s.color2 ? `url(#${uid}-grad-${i})` : s.color;

            const common = {
              d: s.path,
              fill: "none" as const,
              strokeLinecap: "round" as const,
              strokeLinejoin: "round" as const,
              pathLength: 1,
              strokeDasharray: `${seg} 2`,
              strokeDashoffset: -tail,
            };

            return (
              <g key={i} opacity={flash}>
                {glow > 0 && (
                  <>
                    <path
                      {...common}
                      stroke={paint}
                      strokeWidth={w * 3.6}
                      opacity={0.5}
                      filter={`url(#${uid}-glowFar)`}
                    />
                    <path
                      {...common}
                      stroke={paint}
                      strokeWidth={w * 1.9}
                      opacity={0.65}
                      filter={`url(#${uid}-glowNear)`}
                    />
                  </>
                )}
                <path {...common} stroke={paint} strokeWidth={w} />
                <path
                  {...common}
                  stroke="#ffffff"
                  strokeWidth={w * 0.42}
                  opacity={0.85}
                />
              </g>
            );
          })}
        </g>
      </svg>
    </AbsoluteFill>
  );
};

export default ConfettiStrokes;
