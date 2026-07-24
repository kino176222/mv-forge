import React, { useMemo } from "react";

/**
 * GlowStroke — ストローク族クリーンルーム実装の共通プリミティブ。
 *
 * 折れ線（点列）を「テーパー付きリボン」として描き、長さ方向にグラデーションを
 * 走らせ、加算ブルーム（下敷きのぼかしコピー）で発光させる。描き込み進行
 * （progress 0..1）で先端まで描かれる。すべて透明背景に重ねる想定。
 *
 * 幾何が違うだけの Swoosh / Winding / Curved / Radiating / Bursting などは、
 * 点列と色・幅・グローのつまみを変えるだけでこの1本から作れる。
 *
 * 座標・幅はすべて px（呼び出し側で useVideoConfig の width/height から算出）。
 */

export type ColorStop = { offset: number; color: string };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

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

/** カラーストップ列を u∈[0,1] で線形サンプリング → "rgb(...)" */
export const sampleStops = (stops: ColorStop[], u: number): string => {
  const s = [...stops].sort((a, b) => a.offset - b.offset);
  const uu = clamp01(u);
  let ca = hexToRgb(s[0].color);
  if (uu <= s[0].offset) ca = hexToRgb(s[0].color);
  else if (uu >= s[s.length - 1].offset) ca = hexToRgb(s[s.length - 1].color);
  else {
    for (let i = 0; i < s.length - 1; i++) {
      if (uu <= s[i + 1].offset) {
        const t = (uu - s[i].offset) / Math.max(1e-6, s[i + 1].offset - s[i].offset);
        const a = hexToRgb(s[i].color);
        const b = hexToRgb(s[i + 1].color);
        ca = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        break;
      }
    }
  }
  return `rgb(${Math.round(ca[0])},${Math.round(ca[1])},${Math.round(ca[2])})`;
};

export type Pt = [number, number];

/** イーズ: 序盤速く末尾で落ち着く（描き込みの走り感） */
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);

export interface GlowStrokeProps {
  /** 点列（px）。2点以上。 */
  points: Pt[];
  /** 各頂点の半幅（px）。単一値なら一定。省略時は 6。 */
  halfWidth?: number | number[];
  /** 長さ方向グラデーション（offset0=始点 / 1=終点） */
  colorStops: ColorStop[];
  /** 描き込み進行 0..1（先端がどこまで描かれたか） */
  progress?: number;
  /** ブルーム（発光）の強さ。0で無効。 */
  glow?: number;
  /** ブルームのぼかし半径（px） */
  bloomRadius?: number;
  /** 先端の白熱コアを描くか */
  leadCore?: boolean;
  leadCoreColor?: string;
  /** 全体不透明度 */
  opacity?: number;
  /** SVG filter の一意プレフィックス（同一 svg 内で複数使うとき衝突回避） */
  uid: string;
}

/** 頂点法線（隣接セグメント法線の平均）を返す */
function normals(pts: Pt[]): Pt[] {
  const n: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[Math.max(0, i - 1)];
    const q = pts[Math.min(pts.length - 1, i + 1)];
    let dx = q[0] - p[0];
    let dy = q[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    n.push([-dy, dx]); // 法線
  }
  return n;
}

/**
 * 描き込み progress を反映した「実効点列」を返す。
 * 末尾セグメントは frac だけ延ばした点で打ち切る。
 */
function drawnPoints(pts: Pt[], progress: number): Pt[] {
  if (progress >= 1) return pts;
  if (progress <= 0) return [pts[0]];
  const segs = pts.length - 1;
  const pos = progress * segs;
  const idx = Math.floor(pos);
  const frac = pos - idx;
  const out = pts.slice(0, idx + 1);
  if (idx < segs) {
    const a = pts[idx];
    const b = pts[idx + 1];
    out.push([a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac]);
  }
  return out;
}

export const GlowStroke: React.FC<GlowStrokeProps> = ({
  points,
  halfWidth = 6,
  colorStops,
  progress = 1,
  glow = 1,
  bloomRadius = 14,
  leadCore = false,
  leadCoreColor = "#fffdf5",
  opacity = 1,
  uid,
}) => {
  const { quads, tip } = useMemo(() => {
    const drawn = drawnPoints(points, progress);
    if (drawn.length < 2) return { quads: [] as { d: string; fill: string }[], tip: drawn[0] };
    const norm = normals(drawn);
    const hw = (i: number) => {
      if (Array.isArray(halfWidth)) {
        const u = i / (points.length - 1);
        const fi = u * (halfWidth.length - 1);
        const a = Math.floor(fi);
        const b = Math.min(halfWidth.length - 1, a + 1);
        return halfWidth[a] + (halfWidth[b] - halfWidth[a]) * (fi - a);
      }
      return halfWidth;
    };
    const L: Pt[] = drawn.map((p, i) => [p[0] + norm[i][0] * hw(i), p[1] + norm[i][1] * hw(i)]);
    const R: Pt[] = drawn.map((p, i) => [p[0] - norm[i][0] * hw(i), p[1] - norm[i][1] * hw(i)]);
    const qs: { d: string; fill: string }[] = [];
    for (let i = 0; i < drawn.length - 1; i++) {
      const u = i / Math.max(1, points.length - 1);
      qs.push({
        d: `M${L[i][0]},${L[i][1]} L${R[i][0]},${R[i][1]} L${R[i + 1][0]},${R[i + 1][1]} L${L[i + 1][0]},${L[i + 1][1]} Z`,
        fill: sampleStops(colorStops, u),
      });
    }
    return { quads: qs, tip: drawn[drawn.length - 1] };
  }, [points, halfWidth, colorStops, progress]);

  if (quads.length === 0) return null;
  const tipHalf = Array.isArray(halfWidth) ? Math.max(...halfWidth) : halfWidth;

  return (
    <g style={{ opacity }}>
      <defs>
        <filter id={`${uid}-bloom`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation={bloomRadius} />
        </filter>
      </defs>
      {/* 加算ブルーム: ぼかしコピーを下に敷く（screen 合成で光らせる） */}
      {glow > 0 && (
        <g
          filter={`url(#${uid}-bloom)`}
          style={{ mixBlendMode: "screen", opacity: 0.85 * glow }}
        >
          {quads.map((q, i) => (
            <path key={`b${i}`} d={q.d} fill={q.fill} />
          ))}
        </g>
      )}
      {/* 本体リボン */}
      {quads.map((q, i) => (
        <path key={i} d={q.d} fill={q.fill} stroke={q.fill} strokeWidth={0.6} />
      ))}
      {/* 先端の白熱コア */}
      {leadCore && tip && (
        <g style={{ mixBlendMode: "screen" }}>
          <circle
            cx={tip[0]}
            cy={tip[1]}
            r={tipHalf * 2.4}
            fill={leadCoreColor}
            opacity={0.5 * glow}
            filter={`url(#${uid}-bloom)`}
          />
          <circle cx={tip[0]} cy={tip[1]} r={tipHalf * 0.9} fill={leadCoreColor} />
        </g>
      )}
    </g>
  );
};
