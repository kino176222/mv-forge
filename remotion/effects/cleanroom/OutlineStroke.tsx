import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowStroke, easeOutCubic, type Pt, type ColorStop } from "./lib/GlowStroke";

/**
 * OutlineStroke（クリーンルーム再実装）
 *
 * 角丸長方形の輪郭を一筆で描き上げる、残ると発光するネオン枠。金→桃→金へ
 * 長さ方向にグラデーションし（継ぎ目で色が合うので閉ループがなめらか）、
 * 先端に白熱コアが走る。描き切った直後にわずかに発光がポップして「弾ける」。
 * 加算ブルームで発光。背景は透明。約24f/24fps 想定だが durationInFrames に追従。
 */
export interface OutlineStrokeProps {
  durationInFrames?: number;
  /** 0..1 の種。色相回転・回転角・インセット/半径・描き始め位置を決定論的に振る */
  variant?: number;
  opacity?: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** HSL(0..360, 0..1, 0..1) → "#rrggbb"。色相はラップする。 */
const hslToHex = (h: number, s: number, l: number): string => {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
};

/** variant から決定論的な擬似乱数 */
const hash = (v: number, seed: number) => {
  const x = Math.sin((v * 57.3 + seed) * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** 角丸長方形の周を等間隔に近い点列（閉じない開ループ）で返す。時計回り。 */
function roundRectPoints(W: number, H: number, inset: number, radius: number): Pt[] {
  const left = inset;
  const right = W - inset;
  const top = inset;
  const bottom = H - inset;
  const rr = Math.max(1, Math.min(radius, (right - left) / 2, (bottom - top) / 2));
  const density = 0.06; // 点/px（多いほど滑らか＆描き込み速度が均一）
  const pts: Pt[] = [];
  const push = (p: Pt) => {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.5) pts.push(p);
  };
  const edge = (a: Pt, b: Pt) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(2, Math.round(len * density));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
    }
  };
  const arc = (cx: number, cy: number, a0: number, a1: number) => {
    const n = Math.max(3, Math.round(Math.abs(a1 - a0) * rr * density));
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  };
  // 上辺 → 右上角 → 右辺 → 右下角 → 下辺 → 左下角 → 左辺 → 左上角
  edge([left + rr, top], [right - rr, top]);
  arc(right - rr, top + rr, -Math.PI / 2, 0);
  edge([right, top + rr], [right, bottom - rr]);
  arc(right - rr, bottom - rr, 0, Math.PI / 2);
  edge([right - rr, bottom], [left + rr, bottom]);
  arc(left + rr, bottom - rr, Math.PI / 2, Math.PI);
  edge([left, bottom - rr], [left, top + rr]);
  arc(left + rr, top + rr, Math.PI, Math.PI * 1.5);
  // 末尾が始点と重なるので落とす（開ループにする）
  if (pts.length > 1) {
    const f = pts[0];
    const l = pts[pts.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 0.5) pts.pop();
  }
  return pts;
}

export const OutlineStroke: React.FC<OutlineStrokeProps> = ({
  durationInFrames,
  variant = 0,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const dur = durationInFrames ?? cfg.durationInFrames;
  const { width, height } = cfg;
  const base = Math.min(width, height);

  const v = clamp01(variant);

  // --- variant によるジッター（決定論的） ---
  const hueShift = (v - 0.5) * 36; // 色相を ±18° 回して同族の別色に
  const insetJit = (hash(v, 1) - 0.5) * base * 0.03;
  const radiusJit = (hash(v, 2) - 0.5) * base * 0.02;
  const rotDeg = (v - 0.5) * 4 + (hash(v, 3) - 0.5) * 1.5; // ごく僅かな傾き
  const rollFrac = hash(v, 4); // 描き始め位置

  // 金 → 桃 → 金（継ぎ目で色が合うので閉ループがなめらか）
  const colorStops = useMemo<ColorStop[]>(
    () => [
      { offset: 0.0, color: hslToHex(46 + hueShift, 0.95, 0.62) },
      { offset: 0.5, color: hslToHex(330 + hueShift, 0.92, 0.66) },
      { offset: 1.0, color: hslToHex(46 + hueShift, 0.95, 0.62) },
    ],
    [hueShift],
  );

  const points = useMemo<Pt[]>(() => {
    const inset = base * 0.14 + insetJit;
    const radius = base * 0.07 + radiusJit;
    const loop = roundRectPoints(width, height, inset, radius);

    // 中心まわりに微回転
    const cx0 = width / 2;
    const cy0 = height / 2;
    const rad = (rotDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rotated: Pt[] = loop.map(([x, y]) => {
      const dx = x - cx0;
      const dy = y - cy0;
      return [cx0 + dx * cos - dy * sin, cy0 + dx * sin + dy * cos];
    });

    // 描き始め位置をずらす（周を回すだけ。色は index 依存なので継ぎ目は常に金で合う）
    const M = rotated.length;
    const off = M > 0 ? Math.floor(rollFrac * M) % M : 0;
    const rolled = [...rotated.slice(off), ...rotated.slice(0, off)];
    if (rolled.length > 0) rolled.push(rolled[0]); // 閉じる
    return rolled;
  }, [width, height, base, insetJit, radiusJit, rotDeg, rollFrac]);

  // --- タイムライン ---
  const t = dur <= 1 ? 1 : frame / (dur - 1);
  const finishAt = 0.7; // ここまでに一周描き切り、以降ホールド
  const progress = easeOutCubic(Math.min(1, t / finishAt));
  const appear = easeOutCubic(Math.min(1, t / 0.1)); // 立ち上がりのフェード
  // 描き切った直後に発光がふくらむ「弾け」
  const pop = Math.exp(-Math.pow((t - finishAt) / 0.1, 2));
  const glowEff = 1 + 0.7 * pop;

  const thickness = base * 0.006; // 上品な細めのネオン

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: opacity * appear }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <GlowStroke
          uid="outline-stroke"
          points={points}
          halfWidth={thickness}
          colorStops={colorStops}
          progress={progress}
          glow={glowEff}
          bloomRadius={Math.max(8, base * 0.013)}
          leadCore={progress < 0.995}
          leadCoreColor="#fff4e0"
        />
      </svg>
    </AbsoluteFill>
  );
};
