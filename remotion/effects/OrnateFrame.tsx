import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";

/**
 * 画面全体の装飾フレーム（overlay）。
 * 角丸の細枠＋枠線上のダイヤ飾り＋上下中央のアクセント＋四隅のレース風オーナメント。
 * リリックビデオの「額装」ルック（アンティーク・エモ・文学系）向き。
 * 枠はstrokeドローで入場し、飾りは少し遅れてフェードイン。
 */
export const OrnateFrame: React.FC<{
  color: string; // "white" | "gold" | "color"
  hue: number;
  margin: number;
  radius: number;
  thickness: number;
  opacity: number;
  corners: string; // "lace" | "simple" | "off"
}> = ({ color, hue, margin, radius, thickness, opacity, corners }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const s = width / 1920; // 解像度非依存スケール

  const c =
    color === "gold"
      ? "hsl(45, 55%, 68%)"
      : color === "color"
        ? `hsl(${hue}, 80%, 65%)`
        : "#f0ead8"; // 象牙色

  const m = margin * s;
  const th = thickness * s;
  const r = Math.min(radius * s, (height - m * 2) / 2);

  // 枠線: strokeドローで左右対称に描かれる
  const draw = interpolate(frame, [0, Math.round(1.0 * fps)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.3, 0.6, 0.2, 1),
  });
  // 飾り: 枠に少し遅れてフェード
  const deco = interpolate(
    frame,
    [Math.round(0.4 * fps), Math.round(1.1 * fps)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // ダイヤ飾り（枠線上、角丸の始点=直線と曲線の境目に置く）
  const diamond = (cx: number, cy: number, size: number, key: string) => (
    <path
      key={key}
      d={`M${cx},${cy - size} L${cx + size * 0.6},${cy} L${cx},${cy + size} L${cx - size * 0.6},${cy} Z`}
      fill={c}
      opacity={deco}
    />
  );

  // 上下中央のアクセント（・ ・ ✦ ・ ・）
  const centerAccent = (cy: number, key: string) => {
    const d = 4.5 * s;
    const gap = 16 * s;
    return (
      <g key={key} opacity={deco}>
        {diamond(width / 2, cy, d * 1.6, `${key}-mid`)}
        {[1, 2].map((i) => (
          <React.Fragment key={i}>
            <circle cx={width / 2 - gap * i} cy={cy} r={d * 0.32} fill={c} />
            <circle cx={width / 2 + gap * i} cy={cy} r={d * 0.32} fill={c} />
          </React.Fragment>
        ))}
      </g>
    );
  };

  // 四隅のレース風オーナメント（左上を描いて残り3隅へミラー）
  const lace = corners !== "off" && (
    <g opacity={deco * 0.9}>
      {[
        `translate(0,0)`,
        `translate(${width},0) scale(-1,1)`,
        `translate(0,${height}) scale(1,-1)`,
        `translate(${width},${height}) scale(-1,-1)`,
      ].map((tf, i) => (
        <g key={i} transform={tf}>
          <g
            transform={`scale(${s})`}
            fill="none"
            stroke={c}
            strokeWidth={thickness * 0.9}
            strokeLinecap="round"
          >
            {/* 隅から内側へ流れる蔓（つる）カーブ */}
            <path d="M18,86 C50,80 74,58 82,20 M20,110 C64,102 96,72 106,26" />
            {corners === "lace" && (
              <>
                {/* 小さな渦巻きと葉 */}
                <path d="M52,74 C64,66 66,52 56,50 C48,48 46,60 56,62" />
                <path d="M34,96 C48,92 52,82 44,79 C37,77 34,86 42,88" />
                <path d="M78,40 C87,34 87,24 80,24 C74,24 74,32 80,33" />
              </>
            )}
          </g>
          {/* 蔓の先の点飾り */}
          <circle cx={84 * s} cy={16 * s} r={2.4 * s} fill={c} />
          <circle cx={108 * s} cy={22 * s} r={2 * s} fill={c} />
        </g>
      ))}
    </g>
  );

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {/* 角丸の枠線 */}
        <rect
          x={m}
          y={m}
          width={width - m * 2}
          height={height - m * 2}
          rx={r}
          fill="none"
          stroke={c}
          strokeWidth={th}
          pathLength={100}
          strokeDasharray={100}
          strokeDashoffset={100 - draw * 100}
          style={{ filter: `drop-shadow(0 0 ${6 * s}px rgba(0,0,0,0.5))` }}
        />
        {/* 枠線上のダイヤ（角丸の始点4箇所） */}
        {diamond(m + r, m, 7 * s, "d-tl")}
        {diamond(width - m - r, m, 7 * s, "d-tr")}
        {diamond(m + r, height - m, 7 * s, "d-bl")}
        {diamond(width - m - r, height - m, 7 * s, "d-br")}
        {/* 上下中央のアクセント */}
        {centerAccent(m, "acc-top")}
        {centerAccent(height - m, "acc-bottom")}
        {lace}
      </svg>
    </AbsoluteFill>
  );
};
