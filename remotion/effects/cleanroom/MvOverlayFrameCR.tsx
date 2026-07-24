import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";

const { fontFamily: INTER } = loadInter("normal", {
  weights: ["700", "800"],
  subsets: ["latin", "latin-ext"],
});

/**
 * MvOverlayFrameCR — 下の映像(children)を活かしたまま上に上質な装飾を重ねる
 * オーバーレイ家族部品。クリーンルーム実装（機能記述と旧レンダの見た目のみを根拠に
 * 白紙から作成）。music-video-module / retro-module / feel-the-beat / drop-zones /
 * 「素材の上に枠・粒状・光・ラベルを乗せる」系
 * オーバーレイ群を1本で賄う。children を必ず全面描画するので、本編タイムラインで
 * 下のクリップが隠れない（オーバーレイの契約を守る）。
 *
 * variant(0..1) → 5プリセット:
 *   0.0 FRAME    シネマ枠＋四隅ティック＋周辺減光（上品なフレーミング）
 *   0.25 GRAIN   走査線＋粒状＋上下レターボックス（レトロ質感）
 *   0.5 BLOOM    中央〜斜めの柔らかい光芒＋ブルーム（レンズ光）
 *   0.75 LABEL   下部にラベルバー＋タイムコード風メタ（モジュールUI）
 *   1.0 BRACKET  角括弧フレーム＋走る輝線（ミニマルな囲み）
 * すべて children の上のレイヤーで、intensity(0..1) で強度を調整。決定論的。
 */
export type MvOverlayFrameProps = {
  children?: React.ReactNode;
  durationInFrames: number;
  intensity?: number;
  variant?: number;
  color?: string;
  label?: string;
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const MvOverlayFrameCR: React.FC<MvOverlayFrameProps> = ({
  children,
  durationInFrames,
  intensity = 1,
  variant = 0,
  color = "#ffffff",
  label = "SOUND VISION",
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const preset = Math.round(clamp(variant, 0, 1) * 4); // 0..4
  const dur = Math.max(1, durationInFrames);
  const k = clamp(intensity, 0, 1.5);

  // 入退場の全体不透明度（装飾レイヤーのみ。children は常時フル表示）
  const appear = interpolate(frame, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const leave = interpolate(frame, [dur - 10, dur - 1], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const deco = appear * leave;

  const pulse = 0.5 + 0.5 * Math.sin((frame / dur) * Math.PI * 8); // ビート的明滅
  const m = Math.round(Math.min(width, height) * 0.05);

  let overlay: React.ReactNode = null;
  if (preset === 0) {
    // FRAME
    overlay = (
      <>
        <AbsoluteFill style={{ boxShadow: `inset 0 0 ${height * 0.35}px rgba(0,0,0,${0.55 * k})` }} />
        <div style={{ position: "absolute", inset: m, border: `2px solid ${color}`, opacity: 0.85 * deco }} />
        {[[m, m], [width - m, m], [m, height - m], [width - m, height - m]].map(([x, y], i) => (
          <div key={i} style={{ position: "absolute", left: x - 12, top: y - 12, width: 24, height: 24, borderLeft: `3px solid ${color}`, borderTop: `3px solid ${color}`, opacity: deco }} />
        ))}
      </>
    );
  } else if (preset === 1) {
    // GRAIN + scanlines + letterbox
    overlay = (
      <>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: height * 0.08, background: "#000", opacity: deco }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: height * 0.08, background: "#000", opacity: deco }} />
        <AbsoluteFill style={{ backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0px, rgba(0,0,0,0.18) 1px, transparent 2px, transparent 3px)", opacity: 0.6 * deco * k }} />
        <AbsoluteFill style={{ background: `radial-gradient(circle at ${30 + 40 * pulse}% 40%, rgba(255,255,255,${0.05 * k}), transparent 60%)`, mixBlendMode: "overlay", opacity: deco }} />
      </>
    );
  } else if (preset === 2) {
    // BLOOM / flare
    const cx = interpolate(frame, [0, dur], [0.3, 0.72]) * width;
    const cy = height * 0.4;
    overlay = (
      <>
        <AbsoluteFill style={{ background: `radial-gradient(circle at ${cx}px ${cy}px, rgba(255,255,255,${0.6 * k}) 0%, rgba(255,240,210,${0.25 * k}) 12%, transparent 40%)`, mixBlendMode: "screen", opacity: deco }} />
        <div style={{ position: "absolute", left: cx - 2, top: 0, width: 4, height: "100%", background: `linear-gradient(rgba(255,255,255,0), rgba(255,255,255,${0.35 * k}), rgba(255,255,255,0))`, filter: "blur(3px)", mixBlendMode: "screen", opacity: deco }} />
        <div style={{ position: "absolute", left: 0, top: cy - 2, width: "100%", height: 4, background: `linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,${0.3 * k}), rgba(255,255,255,0))`, filter: "blur(3px)", mixBlendMode: "screen", opacity: deco }} />
      </>
    );
  } else if (preset === 3) {
    // LABEL bar + meta
    overlay = (
      <>
        <AbsoluteFill style={{ boxShadow: `inset 0 0 ${height * 0.3}px rgba(0,0,0,${0.4 * k})` }} />
        <div style={{ position: "absolute", left: m, bottom: m, display: "flex", alignItems: "center", gap: 14, opacity: deco }}>
          <div style={{ width: 12 + 8 * pulse, height: 12 + 8 * pulse, background: color, borderRadius: 2 }} />
          <span style={{ fontFamily: INTER, fontWeight: 800, fontSize: height * 0.045, color, letterSpacing: 2 }}>{label}</span>
        </div>
        <span style={{ position: "absolute", right: m, top: m, fontFamily: INTER, fontWeight: 700, fontSize: height * 0.03, color, opacity: 0.7 * deco, letterSpacing: 3 }}>
          {String(Math.floor(frame / 30)).padStart(2, "0")}:{String(frame % 30).padStart(2, "0")}
        </span>
      </>
    );
  } else {
    // BRACKET + running highlight
    const bx = interpolate(frame % 60, [0, 60], [0, width]);
    overlay = (
      <>
        {["left", "right"].map((side, i) => (
          <div key={i} style={{ position: "absolute", top: height * 0.2, bottom: height * 0.2, [side]: m, width: width * 0.03, borderTop: `3px solid ${color}`, borderBottom: `3px solid ${color}`, [side === "left" ? "borderLeft" : "borderRight"]: `3px solid ${color}`, opacity: deco }} />
        ))}
        <div style={{ position: "absolute", left: bx - 60, top: 0, width: 120, height: "100%", background: `linear-gradient(90deg, transparent, rgba(255,255,255,${0.12 * k}), transparent)`, mixBlendMode: "screen", opacity: deco }} />
      </>
    );
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill>{children}</AbsoluteFill>
      {overlay}
    </AbsoluteFill>
  );
};
