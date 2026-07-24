import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowStroke, easeOutCubic, type Pt, type ColorStop } from "./lib/GlowStroke";

/**
 * PolylineStroke（クリーンルーム再実装）
 *
 * 鋭い角を持つジグザグの折れ線が画面を横切って一気に描かれる、稲妻/電気的な
 * 演出。シアン〜白のネオンで、序盤で走り切って以降ホールドし、僅かにフリッカ
 * （明滅）する。中央の幹から短い枝が分岐して電気的な質感を出す。加算ブルーム
 * で発光。背景は透明。約24f/24fps 想定だが durationInFrames に追従。
 *
 * variant(0..1) は種。色相の回転・ジグザグの本数/位置/角度の微ジッターを
 * 決定論的に与え、同族の別バリアントが少しずつ違って見えるようにする。
 */
export interface PolylineStrokeProps {
  durationInFrames?: number;
  /** 0..1 の種。色相回転とジグザグ形状のジッターを決める。 */
  variant?: number;
  opacity?: number;
}

/** HSL → "#rrggbb"（色相回転を色に落とすため） */
const hslToHex = (h: number, s: number, l: number): string => {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g] = [c, x];
  else if (hh < 120) [r, g] = [x, c];
  else if (hh < 180) [g, b] = [c, x];
  else if (hh < 240) [g, b] = [x, c];
  else if (hh < 300) [r, b] = [x, c];
  else [r, b] = [c, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
};

export const PolylineStroke: React.FC<PolylineStrokeProps> = ({
  durationInFrames,
  variant = 0,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const dur = durationInFrames ?? cfg.durationInFrames;
  const { width, height } = cfg;

  // variant を混ぜた決定論的擬似乱数（Math.random は使わない）
  const rnd = useMemo(() => {
    return (seed: number) => {
      const v = Math.sin(seed * 127.1 + 311.7 + variant * 97.3) * 43758.5453;
      return v - Math.floor(v);
    };
  }, [variant]);

  const t = dur <= 1 ? 1 : frame / (dur - 1);
  // 稲妻: 序盤で速く描き切り（〜35%）、以降ホールド
  const progress = easeOutCubic(Math.min(1, t / 0.35));
  // ネオンの微明滅（描き切った後もチリチリ光る）。控えめに。
  const flick = 0.88 + 0.12 * Math.sin(frame * 2.7 + variant * 11.3);

  // 長さ方向グラデ: 白寄りシアン → 明シアン → やや深いシアン。variant で色相回転。
  const stops = useMemo<ColorStop[]>(() => {
    const hue = 182 + (variant - 0.5) * 34; // ≒165..199（シアン帯を保つ）
    return [
      { offset: 0.0, color: hslToHex(hue - 6, 0.5, 0.93) },
      { offset: 0.5, color: hslToHex(hue, 1.0, 0.63) },
      { offset: 1.0, color: hslToHex(hue + 10, 0.92, 0.5) },
    ];
  }, [variant]);

  // 線の太さ（画面サイズに追従）
  const w = Math.max(3, Math.min(width, height) * 0.006);

  // 幹（ジグザグ）と枝（分岐）を決定論的に生成
  const { trunk, branches } = useMemo(() => {
    const n = 6 + Math.floor(rnd(1) * 4); // 6..9 の角
    const x0 = width * 0.08;
    const x1 = width * 0.92;
    const yMid = height * (0.44 + rnd(2) * 0.12); // 0.44..0.56
    const amp = height * 0.17;
    const slope = (rnd(4) - 0.5) * height * 0.12; // 全体の傾き

    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = x0 + (x1 - x0) * u + (rnd(i + 30) - 0.5) * width * 0.03;
      const env = Math.sin(u * Math.PI); // 端は 0・中央 1（両端を幹に寄せる）
      const sign = i % 2 === 0 ? -1 : 1;
      const jag = sign * amp * (0.35 + 0.65 * rnd(i + 3)) * (0.4 + 0.6 * env);
      const y = yMid + jag + slope * (u - 0.5);
      pts.push([x, y]);
    }

    // 枝: 幹の途中の頂点から短いジグザグが弾け出す（電気的な分岐）
    const nb = rnd(50) > 0.5 ? 2 : 1;
    const br: { pts: Pt[]; hw: number[]; delay: number }[] = [];
    for (let b = 0; b < nb; b++) {
      const fu = 0.32 + rnd(b + 60) * 0.36; // 分岐位置 0.32..0.68
      const idx = Math.max(1, Math.min(n - 1, Math.round(fu * n)));
      const start = pts[idx];
      const vsign = rnd(b + 61) < 0.5 ? 1 : -1;
      const base = vsign * (0.35 + rnd(b + 62) * 0.5); // 下（or上）へ傾く基準角
      const segLen = width * (0.045 + rnd(b + 63) * 0.03);
      const bpts: Pt[] = [start];
      let px = start[0];
      let py = start[1];
      for (let k = 1; k <= 3; k++) {
        const a = base + (rnd(b * 10 + k + 64) - 0.5) * 0.7; // 角ごとに折れる
        px += Math.cos(a) * segLen;
        py += Math.sin(a) * segLen;
        bpts.push([px, py]);
      }
      br.push({
        pts: bpts,
        hw: [w * 0.5, w * 0.4, w * 0.28, w * 0.14],
        delay: 0.35 * fu + 0.03, // 幹が分岐点を通過してから出る
      });
    }

    return { trunk: pts, branches: br };
  }, [width, height, w, rnd]);

  // 幹の先細り: 始点やや細 → 中盤太 → 先端で消える
  const trunkHw = useMemo(
    () => [w * 0.85, w, w * 0.9, w * 0.62, w * 0.38, w * 0.22],
    [w],
  );

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {/* 枝（幹より後に、細く弾ける） */}
        {branches.map((b, i) => {
          const local = Math.min(1, Math.max(0, (t - b.delay) / 0.18));
          if (local <= 0) return null;
          return (
            <GlowStroke
              key={`br-${i}`}
              uid={`polyline-br-${i}`}
              points={b.pts}
              halfWidth={b.hw}
              colorStops={stops}
              progress={easeOutCubic(local)}
              glow={0.85 * flick}
              bloomRadius={9}
            />
          );
        })}

        {/* 幹: ジグザグの稲妻本体。先端に白熱コアを走らせる。 */}
        <GlowStroke
          uid="polyline-trunk"
          points={trunk}
          halfWidth={trunkHw}
          colorStops={stops}
          progress={progress}
          glow={1.05 * flick}
          bloomRadius={12}
          leadCore
          leadCoreColor="#f2ffff"
        />
      </svg>
    </AbsoluteFill>
  );
};
