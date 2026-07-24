import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowStroke, easeOutCubic, type Pt, type ColorStop } from "./lib/GlowStroke";

/**
 * FrayedOutlineStroke（クリーンルーム再実装）
 *
 * 角丸の枠を一筆でぐるりと描くネオン。ただし輪郭に手でちぎった様な
 * ほつれ（法線方向のジッター＋まばらな飛び出し）を与え、ややラフに光らせる。
 * 色はティール→紫。描き切ったところで軽く弾け、要所からほつれ糸が跳ねる。
 * 加算ブルームで発光。背景は透明。約24f/24fps 想定だが durationInFrames に追従。
 *
 * variant(0..1) は種。色相の回転・寸法/回転/ほつれのジッターを決定論的に振り、
 * 同族の別バリアントが少しずつ違って見えるようにする（Math.random は使わない）。
 */
export interface FrayedOutlineStrokeProps {
  durationInFrames?: number;
  variant?: number;
  opacity?: number;
}

/** 決定論的な擬似乱数（seed から） */
const rnd = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** HSL → "#rrggbb" */
const hslToHex = (h: number, s: number, l: number): string => {
  const hh = (((h % 360) + 360) % 360) / 360;
  const ss = s / 100;
  const ll = l / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh * 6) % 2) - 1));
  const m = ll - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  const seg = Math.floor(hh * 6);
  if (seg === 0) [r, g, b] = [c, x, 0];
  else if (seg === 1) [r, g, b] = [x, c, 0];
  else if (seg === 2) [r, g, b] = [0, c, x];
  else if (seg === 3) [r, g, b] = [0, x, c];
  else if (seg === 4) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
};

export const FrayedOutlineStroke: React.FC<FrayedOutlineStrokeProps> = ({
  durationInFrames,
  variant = 0,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const dur = durationInFrames ?? cfg.durationInFrames;
  const { width, height } = cfg;

  const v = Math.min(1, Math.max(0, variant));
  const vseed = v * 1000 + 1;
  const minDim = Math.min(width, height);

  const t = dur <= 1 ? 1 : frame / (dur - 1);
  // 0.72 までにぐるり描き切り、以降ホールド
  const progress = easeOutCubic(Math.min(1, t / 0.72));
  // 描き込み初動のフェードイン（硬いポップ回避）
  const env = easeOutCubic(Math.min(1, t / 0.12));
  // 描き切り地点での発光の弾け（ガウシアンパルス）
  const flash = Math.exp(-Math.pow((t - 0.72) / 0.1, 2));

  // 色相を variant で微回転（ティール→紫）
  const hueShift = (v - 0.5) * 36;
  const colorStops = useMemo<ColorStop[]>(
    () => [
      { offset: 0.0, color: hslToHex(174 + hueShift, 88, 60) },
      { offset: 0.5, color: hslToHex(196 + hueShift, 82, 60) },
      { offset: 0.75, color: hslToHex(258 + hueShift, 80, 64) },
      { offset: 1.0, color: hslToHex(276 + hueShift, 78, 66) },
    ],
    [hueShift],
  );
  const threadColor = hslToHex(184 + hueShift, 85, 66);

  // ネオン線の基準太さ（画面に対して細めの上品な幅）
  const thickness = Math.max(4, minDim * 0.006);

  const { pts, widths, basePts, baseNorms } = useMemo(() => {
    // ── 角丸枠の寸法（variant で微ジッター）──
    const cx = width * 0.5;
    const cy = height * 0.52;
    const halfW = width * 0.3 * (0.96 + v * 0.08);
    const halfH = height * 0.34 * (0.96 + (1 - v) * 0.08);
    const r = Math.min(minDim * 0.12, halfW * 0.9, halfH * 0.9);
    const rot = (v - 0.5) * 0.1; // 全体を ±約2.9° 回す
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const step = minDim * 0.011;

    const x0 = cx - halfW;
    const x1 = cx + halfW;
    const y0 = cy - halfH;
    const y1 = cy + halfH;

    // 中心線と外向き法線を、枠を1周する点列として生成
    const bp: Pt[] = [];
    const bn: Pt[] = [];
    const pushLine = (ax: number, ay: number, bx: number, by: number, nx: number, ny: number) => {
      const len = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(2, Math.round(len / step));
      for (let k = 0; k < steps; k++) {
        const u = k / steps;
        bp.push([ax + (bx - ax) * u, ay + (by - ay) * u]);
        bn.push([nx, ny]);
      }
    };
    const pushArc = (ccx: number, ccy: number, a0: number, a1: number) => {
      const steps = Math.max(3, Math.round((r * Math.abs(a1 - a0)) / step));
      for (let k = 0; k < steps; k++) {
        const a = a0 + (a1 - a0) * (k / steps);
        const nx = Math.cos(a);
        const ny = Math.sin(a);
        bp.push([ccx + r * nx, ccy + r * ny]);
        bn.push([nx, ny]);
      }
    };

    const HALF_PI = Math.PI / 2;
    pushLine(x0 + r, y0, x1 - r, y0, 0, -1); // 上辺
    pushArc(x1 - r, y0 + r, -HALF_PI, 0); // 右上角
    pushLine(x1, y0 + r, x1, y1 - r, 1, 0); // 右辺
    pushArc(x1 - r, y1 - r, 0, HALF_PI); // 右下角
    pushLine(x1 - r, y1, x0 + r, y1, 0, 1); // 下辺
    pushArc(x0 + r, y1 - r, HALF_PI, Math.PI); // 左下角
    pushLine(x0, y1 - r, x0, y0 + r, -1, 0); // 左辺
    pushArc(x0 + r, y0 + r, Math.PI, Math.PI * 1.5); // 左上角

    // 全体を中心まわりに回転
    for (let i = 0; i < bp.length; i++) {
      const dx = bp[i][0] - cx;
      const dy = bp[i][1] - cy;
      bp[i] = [cx + dx * cosR - dy * sinR, cy + dx * sinR + dy * cosR];
      const nx = bn[i][0];
      const ny = bn[i][1];
      bn[i] = [nx * cosR - ny * sinR, nx * sinR + ny * cosR];
    }

    // ── ほつれジッターを法線方向に付与 ──
    const total = bp.length;
    const ph1 = v * 6.28;
    const ph2 = v * 3.1 + 1.7;
    const ph3 = v * 9.4;
    const wobbleAmp = minDim * 0.007;
    const teethAmp = minDim * 0.003;
    const spikeAmp = minDim * 0.013;

    const jp: Pt[] = [];
    const jw: number[] = [];
    for (let i = 0; i < total; i++) {
      const s = i / total; // 周回パラメータ（整数周波数なので周期的）
      const wobble =
        Math.sin(2 * Math.PI * 3 * s + ph1) * 0.55 +
        Math.sin(2 * Math.PI * 7 * s + ph2) * 0.3 +
        Math.sin(2 * Math.PI * 13 * s + ph3) * 0.18;
      const teeth = (rnd(i + vseed) - 0.5) * 2;
      // まばらに外へ飛び出す（手でちぎった様な棘）
      const spike = rnd(i * 2.3 + vseed) > 0.88 ? rnd(i * 5.1 + vseed) * spikeAmp : 0;
      const off = wobble * wobbleAmp + teeth * teethAmp + spike;
      jp.push([bp[i][0] + bn[i][0] * off, bp[i][1] + bn[i][1] * off]);
      // ラフな太さムラ
      const wmul = 0.75 + 0.45 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 6 * s + ph1)) + (rnd(i + vseed * 1.7) - 0.5) * 0.2;
      jw.push(thickness * Math.max(0.4, wmul));
    }

    return { pts: jp, widths: jw, basePts: bp, baseNorms: bn };
  }, [width, height, minDim, v, vseed, thickness]);

  // ── ほつれ糸（要所から外へ跳ねる短い光条）──
  const threads = useMemo(() => {
    const total = basePts.length;
    const count = 3 + Math.floor(v * 4);
    const out: { pts: Pt[]; hw: number[]; delay: number }[] = [];
    for (let j = 0; j < count; j++) {
      const sFrac = (j + 0.5) / count + (rnd(j + vseed) - 0.5) * 0.12;
      const idx = ((Math.floor(sFrac * total) % total) + total) % total;
      const p = basePts[idx];
      const n = baseNorms[idx];
      const tan: Pt = [-n[1], n[0]];
      const len = minDim * (0.02 + rnd(j + vseed * 2) * 0.03);
      const lean = (rnd(j + vseed * 3) - 0.5) * 0.6;
      const mid: Pt = [
        p[0] + n[0] * len * 0.5 + tan[0] * len * lean * 0.5,
        p[1] + n[1] * len * 0.5 + tan[1] * len * lean * 0.5,
      ];
      const end: Pt = [p[0] + n[0] * len + tan[0] * len * lean, p[1] + n[1] * len + tan[1] * len * lean];
      out.push({
        pts: [p, mid, end],
        hw: [thickness * 0.55, thickness * 0.3, thickness * 0.06],
        delay: Math.max(0, Math.min(0.72, sFrac * 0.72)),
      });
    }
    return out;
  }, [basePts, baseNorms, minDim, thickness, v, vseed]);

  const glowNow = 1 + 0.4 * flash;
  const vid = Math.round(v * 1000);

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: opacity * env }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {/* 角丸枠の本体（ほつれ輪郭を一筆で描く） */}
        <GlowStroke
          uid={`frayed-${vid}-o`}
          points={pts}
          halfWidth={widths}
          colorStops={colorStops}
          progress={progress}
          glow={glowNow}
          bloomRadius={13}
          leadCore
          leadCoreColor="#eafffb"
        />

        {/* ほつれ糸: 描き込みが通過するタイミングで跳ねる */}
        {threads.map((th, i) => {
          const local = Math.min(1, Math.max(0, (t - th.delay) / 0.18));
          const tp = easeOutCubic(local);
          if (tp <= 0) return null;
          return (
            <GlowStroke
              key={i}
              uid={`frayed-${vid}-t${i}`}
              points={th.pts}
              halfWidth={th.hw}
              colorStops={[
                { offset: 0, color: threadColor },
                { offset: 1, color: threadColor },
              ]}
              progress={tp}
              glow={glowNow}
              bloomRadius={9}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
