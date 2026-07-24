import React, { useId } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * FireworksStrokes（クリーンルーム実装）
 * 8本の手描きネオン線が中心から花火状にバーストする1秒のタイトル素材。
 * 背景は透明。線はゆらぎ・ループ入りの手描き風ベジェで、write-on（描き起こし）
 * しながら放射し、先端の少し先をスパーク（ドット）が飛ぶ。
 *
 * 実装メモ:
 * - 各線は pathLength=1 + strokeDashoffset で 0→1 に描き起こす（ease-out cubic）
 * - ネオンは3層（外側グロー / 本線 / 明るい芯線）で表現
 * - レイアウトは中心(0,0)・半径約900unitのデザイン空間に置き、size で実寸に拡縮
 */

export type FireworksStrokesProps = {
  /** 素材の想定尺（フレーム）。drawFrames の既定値の算出に使う */
  durationInFrames?: number;
  /** バースト中心の横位置（0..1、画面幅比） */
  posX?: number;
  /** バースト中心の縦位置（0..1、画面高比） */
  posY?: number;
  /** バースト半径（px）。線の広がりの実寸 */
  size?: number;
  /** 本線の太さ（px、画面上の実寸） */
  strokeWidth?: number;
  /** 線ごとの色。8本に循環適用（1色だけ渡せば単色バースト） */
  colors?: string[];
  /** グロー強度。0でグロー無し、1が既定、2で強め */
  glow?: number;
  /** 描き切るまでのフレーム数（既定: 尺の約62%） */
  drawFrames?: number;
  /** 描き始めの遅延フレーム */
  delayFrames?: number;
  /** 線ごとの開始ずらし（手描き感。0で全線同時） */
  staggerFrames?: number;
  /** 先端スパーク（ドット）を出すか */
  sparks?: boolean;
  /** 全体の不透明度 */
  opacity?: number;
};

/** #rgb / #rrggbb を白と混ぜて明るくする（芯線用） */
const lighten = (hex: string, amount: number): string => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const num = parseInt(full, 16);
  if (Number.isNaN(num) || full.length !== 6) return hex;
  const mix = (v: number) => Math.round(v + (255 - v) * amount);
  const r = mix((num >> 16) & 255);
  const g = mix((num >> 8) & 255);
  const b = mix(num & 255);
  return `rgb(${r},${g},${b})`;
};

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/**
 * デザイン空間（中心0,0 / +yが下 / 半径約900unit）に手で置いた8本のストローク。
 * end は終点座標（スパークの飛ぶ方向に使う）。
 * 構図: 左半分に緑系4本（横線・上抜け・大ループ・下抜け）、
 *       右半分に 上=紫の稲妻風 / 右上=橙のループ+S字 / 右=サーモンのジグザグ横線 /
 *       右下=紫の二重ループ。
 */
type StrokeDef = {
  d: string;
  end: [number, number];
  /** スパークが終点ベクトルの何倍の位置に着地するか */
  sparkAt: number;
  /** スパーク半径（unit） */
  sparkR: number;
};

const STROKES: StrokeDef[] = [
  {
    // 左へほぼ水平。途中で折り返して二重線に見えるゆらぎ
    d: "M0,0 C-150,-28 -320,12 -470,4 C-592,-2 -612,-38 -522,-42 C-452,-44 -562,-28 -682,-24 C-782,-20 -822,-10 -876,-14",
    end: [-876, -14],
    sparkAt: 1.06,
    sparkR: 10,
  },
  {
    // 左上へ。中程に小さなフック（返し）を入れて画面上に抜ける
    d: "M0,0 C-64,-58 -146,-104 -238,-148 C-296,-176 -318,-128 -276,-118 C-234,-110 -266,-172 -338,-234 C-424,-308 -478,-424 -516,-556",
    end: [-516, -556],
    sparkAt: 1.1,
    sparkR: 9,
  },
  {
    // 左下へ。大きな楕円ループを一周して左下に抜ける
    d: "M0,0 C-84,88 -186,166 -306,218 C-462,284 -556,332 -554,410 C-552,488 -428,466 -352,398 C-278,332 -308,244 -432,302 C-528,348 -636,442 -734,556",
    end: [-734, 556],
    sparkAt: 1.08,
    sparkR: 9,
  },
  {
    // 真下へ。緩いS字
    d: "M0,0 C-18,108 -58,216 -50,326 C-44,418 -82,516 -128,598",
    end: [-128, 598],
    sparkAt: 1.16,
    sparkR: 8,
  },
  {
    // 真上へ。稲妻風の鋭いジグザグ
    d: "M0,0 C10,-52 38,-90 24,-134 C15,-162 62,-156 52,-198 C44,-232 16,-260 42,-304 C56,-328 36,-362 44,-398",
    end: [44, -398],
    sparkAt: 1.18,
    sparkR: 9,
  },
  {
    // 右上へ。筆記体の小ループ→長いS字で右上コーナーへ
    d: "M0,0 C62,-18 132,-38 202,-68 C262,-94 300,-138 260,-158 C220,-178 192,-120 252,-94 C330,-60 424,-98 502,-178 C578,-256 610,-328 642,-428",
    end: [642, -428],
    sparkAt: 1.08,
    sparkR: 10,
  },
  {
    // 右へほぼ水平。中程にジグザグの返し
    d: "M0,0 C122,12 262,-4 382,6 C462,12 484,42 424,40 C384,38 472,22 562,28 C642,34 702,22 782,32 C842,38 872,30 900,34",
    end: [900, 34],
    sparkAt: 1.05,
    sparkR: 10,
  },
  {
    // 右下へ。二つの小ループを描いて右下に抜ける
    d: "M0,0 C64,62 142,118 224,158 C304,198 332,258 282,290 C232,322 202,252 262,222 C322,192 362,242 352,310 C342,378 384,302 452,360 C520,420 560,478 622,556",
    end: [622, 556],
    sparkAt: 1.1,
    sparkR: 9,
  },
];

/** デザイン空間の基準半径（STROKES の広がりに合わせた値） */
const DESIGN_RADIUS = 900;

const DEFAULT_COLORS = [
  "#1ee75e", // 緑（左横線）
  "#1ee75e", // 緑（左上）
  "#1ee75e", // 緑（左下ループ）
  "#1ee75e", // 緑（下）
  "#9a6bff", // 紫（上の稲妻）
  "#ffc08a", // 橙（右上ループ）
  "#ff9d9d", // サーモン（右横線）
  "#9a6bff", // 紫（右下ループ）
];

export const FireworksStrokes: React.FC<FireworksStrokesProps> = ({
  durationInFrames = 24,
  posX = 0.5,
  posY = 0.5,
  size = 900,
  strokeWidth = 11,
  colors = DEFAULT_COLORS,
  glow = 1,
  drawFrames,
  delayFrames = 1,
  staggerFrames = 0.5,
  sparks = true,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  const k = size / DESIGN_RADIUS; // デザイン空間→実寸
  const w = strokeWidth / k; // 画面上で strokeWidth px になる線幅（unit）
  const draw = drawFrames ?? Math.max(8, Math.round(durationInFrames * 0.62));
  const glowId = `fws-glow-${uid}`;

  return (
    <AbsoluteFill style={{ opacity, pointerEvents: "none" }}>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: "block" }}
      >
        {glow > 0 && (
          <defs>
            <filter id={glowId} x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation={w * 1.05 * glow} />
            </filter>
          </defs>
        )}
        <g transform={`translate(${posX * width}, ${posY * height}) scale(${k})`}>
          {STROKES.map((s, i) => {
            const color = colors[i % colors.length] ?? DEFAULT_COLORS[i];
            const start = delayFrames + (i % 3) * staggerFrames;
            const t = interpolate(frame, [start, start + draw], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const p = easeOutCubic(t);
            if (p <= 0) return null;

            const dash = { strokeDasharray: 1, strokeDashoffset: 1 - p };
            // スパーク: 描画中の先端の少し先を並走し、終点の少し外に着地する
            const lead = Math.min(1, p * 1.12);
            const sx = s.end[0] * s.sparkAt * (0.25 + 0.75 * lead);
            const sy = s.end[1] * s.sparkAt * (0.25 + 0.75 * lead);
            const sparkOpacity = interpolate(t, [0.06, 0.22], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });

            return (
              <g key={i}>
                {glow > 0 && (
                  <path
                    d={s.d}
                    pathLength={1}
                    fill="none"
                    stroke={color}
                    strokeWidth={w * 3.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.65 * Math.min(1, glow)}
                    filter={`url(#${glowId})`}
                    style={dash}
                  />
                )}
                <path
                  d={s.d}
                  pathLength={1}
                  fill="none"
                  stroke={color}
                  strokeWidth={w}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={dash}
                />
                <path
                  d={s.d}
                  pathLength={1}
                  fill="none"
                  stroke={lighten(color, 0.55)}
                  strokeWidth={w * 0.42}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={dash}
                />
                {sparks && sparkOpacity > 0 && (
                  <g opacity={sparkOpacity}>
                    {glow > 0 && (
                      <circle
                        cx={sx}
                        cy={sy}
                        r={s.sparkR * 1.9}
                        fill={color}
                        opacity={0.5 * Math.min(1, glow)}
                        filter={`url(#${glowId})`}
                      />
                    )}
                    <circle cx={sx} cy={sy} r={s.sparkR} fill={color} />
                    <circle
                      cx={sx}
                      cy={sy}
                      r={s.sparkR * 0.45}
                      fill={lighten(color, 0.6)}
                    />
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </AbsoluteFill>
  );
};
