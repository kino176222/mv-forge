import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowStroke, easeOutCubic, type Pt, type ColorStop } from "./lib/GlowStroke";

/**
 * BouncingStroke（クリーンルーム再実装）
 *
 * 左→右へ一気に描かれる発光ストローク。見えない基準線でボールのように
 * 数回バウンドし、上下の反射は減衰していく。色はネオンのシアン→ライム。
 * 各着地点では通過した瞬間に小さな接地フラッシュが弾ける。加算ブルームで
 * 発光。背景は透明。約24f/24fps 想定だが durationInFrames に追従。
 *
 * variant(0..1) は決定論的な種。色相の回転・バウンド本数・基準線の傾き/
 * 位置の微ジッターに使い、同族の別バリアントを少しずつ違って見せる。
 */
export interface BouncingStrokeProps {
  durationInFrames?: number;
  /** 0..1 のバリアント種（色相回転・本数・位置ジッターに使用） */
  variant?: number;
  opacity?: number;
}

/** HSL(度,%,%) → #rrggbb（GlowStroke は hex を要求するため） */
const hslToHex = (h: number, s: number, l: number): string => {
  const hh = ((h % 360) + 360) % 360;
  const ss = s / 100;
  const ll = l / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g] = [c, x];
  else if (hh < 120) [r, g] = [x, c];
  else if (hh < 180) [g, b] = [c, x];
  else if (hh < 240) [g, b] = [x, c];
  else if (hh < 300) [r, b] = [x, c];
  else [r, b] = [c, x];
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
};

export const BouncingStroke: React.FC<BouncingStrokeProps> = ({
  durationInFrames,
  variant = 0,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const dur = durationInFrames ?? cfg.durationInFrames;
  const { width, height } = cfg;

  const t = dur <= 1 ? 1 : frame / (dur - 1);
  // 0.72 までに描き切り、以降ホールド（描かれて残る）
  const progress = easeOutCubic(Math.min(1, t / 0.72));

  // variant 由来の決定論的擬似乱数
  const rnd = useMemo(() => {
    return (seed: number) => {
      const x = Math.sin((seed + variant * 97.13) * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
  }, [variant]);

  // 色相を variant で ±20 度ほど回してネオンのシアン→ライムを作る
  const colorStops = useMemo<ColorStop[]>(() => {
    const shift = (variant - 0.5) * 40;
    return [
      { offset: 0.0, color: hslToHex(184 + shift, 100, 62) }, // シアン
      { offset: 0.5, color: hslToHex(150 + shift, 95, 58) }, // ターコイズ〜緑
      { offset: 1.0, color: hslToHex(95 + shift, 100, 56) }, // ライム
    ];
  }, [variant]);

  const leadCoreColor = useMemo(
    () => hslToHex(120 + (variant - 0.5) * 30, 100, 88),
    [variant],
  );

  // バウンド本数（3〜4）と基準線の傾き・位置のジッター
  const nb = 3 + Math.floor(rnd(1) * 2);
  const decay = 0.52 + rnd(2) * 0.08; // 反射の減衰率

  const { points, contacts } = useMemo(() => {
    const N = 64;
    const x0 = width * (0.13 + rnd(3) * 0.03);
    const x1 = width * (0.87 - rnd(4) * 0.03);
    const yBase = height * (0.6 + (rnd(5) - 0.5) * 0.08);
    const tilt = (rnd(6) - 0.5) * height * 0.1; // 基準線の全体傾き
    const amp = height * (0.16 + rnd(7) * 0.04); // 初弾の跳ね上がり

    const baselineY = (u: number) => yBase + tilt * (u - 0.5);

    const pts: Pt[] = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const phase = u * nb;
      const k = Math.min(nb - 1, Math.floor(phase));
      const local = phase - k;
      const arch = 4 * local * (1 - local); // 0..1（放物線の弧）
      const h = amp * Math.pow(decay, k);
      const x = x0 + (x1 - x0) * u;
      const y = baselineY(u) - h * arch; // 上へ（画面上方向は負）
      pts.push([x, y]);
    }

    // 内側の着地点（フラッシュ用）。u と減衰インデックスを保持
    const cs: { u: number; x: number; y: number; level: number }[] = [];
    for (let k = 1; k < nb; k++) {
      const u = k / nb;
      cs.push({
        u,
        x: x0 + (x1 - x0) * u,
        y: baselineY(u),
        level: Math.pow(decay, k),
      });
    }
    return { points: pts, contacts: cs };
  }, [width, height, nb, decay, rnd]);

  // 先細り: 描き始めやや太 → 中盤 → 先端は細く尖る
  const thickness = Math.max(5, height * 0.007);
  const halfWidth = useMemo(
    () => [
      thickness * 0.9,
      thickness,
      thickness * 0.85,
      thickness * 0.55,
      thickness * 0.32,
    ],
    [thickness],
  );

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="bounce-flash" x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation={thickness * 1.6} />
          </filter>
        </defs>

        {/* 接地フラッシュ: 先端が通過した瞬間に弾け、すぐ収まる */}
        <g style={{ mixBlendMode: "screen" }}>
          {contacts.map((c, i) => {
            const d = progress - c.u;
            if (d < 0) return null;
            const pop = Math.max(0, 1 - d / 0.14); // 通過直後のスパイク
            const glow = (pop * 0.75 + 0.12) * c.level;
            if (glow <= 0.01) return null;
            const r = thickness * (1.6 + pop * 2.2) * (0.7 + c.level * 0.6);
            return (
              <g key={i}>
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={r * 1.8}
                  fill={leadCoreColor}
                  opacity={glow * 0.5}
                  filter="url(#bounce-flash)"
                />
                <circle cx={c.x} cy={c.y} r={r * 0.55} fill={leadCoreColor} opacity={glow} />
              </g>
            );
          })}
        </g>

        {/* 本体ストローク（テーパー＋長さ方向グラデ＋加算グロー＋先端コア） */}
        <GlowStroke
          uid="bouncing-stroke"
          points={points}
          halfWidth={halfWidth}
          colorStops={colorStops}
          progress={progress}
          glow={1}
          bloomRadius={12}
          leadCore
          leadCoreColor={leadCoreColor}
        />
      </svg>
    </AbsoluteFill>
  );
};
