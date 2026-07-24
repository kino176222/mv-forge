import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";
import { resolveParams } from "@/lib/effects-meta";
import type { EffectInstance } from "@/lib/schema";
import { beatPulse, type BeatClock } from "./beat";
import { pushInWindow, panVector } from "./camera-math";

/**
 * cameraカテゴリ: 絵そのものを動かすラッパー。
 * 区間ごとに1個。区間の頭から終わりまでを1つの動きで通す（行ごとに再始動しない）。
 */
export const CameraEffect: React.FC<{
  instance: EffectInstance | null;
  durationInFrames: number;
  beatClock?: BeatClock | null;
  children: React.ReactNode;
}> = ({ instance, durationInFrames, beatClock, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!instance || instance.id === "parallax") {
    // parallax は ParallaxLayer 側で処理（画像そのものを差し替えるため）
    return <AbsoluteFill>{children}</AbsoluteFill>;
  }
  const p = resolveParams(instance.id, instance.params);
  const t = interpolate(frame, [0, Math.max(1, durationInFrames)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.3, 0, 0.7, 1),
  });

  // 注視点＝ズームの不動点（既定は中央）。「顔に寄る」等の画作りはここで決まる
  const hasOrigin = [
    "slow-zoom-in",
    "slow-zoom-out",
    "punch-zoom",
    "push-in",
  ].includes(instance.id);
  const origin = hasOrigin
    ? `${Number(p.originX ?? 50)}% ${Number(p.originY ?? 50)}%`
    : "center center";

  let transform = "";
  if (instance.id === "punch-zoom") {
    // 頭で一気に寄って、その後ほんのわずかに寄り続ける（完全静止は死ぬため）
    const punchFrames = Math.max(2, Math.round(Number(p.duration) * fps));
    const amount = Number(p.amount);
    const punch = interpolate(frame, [0, punchFrames], [1, amount], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });
    const drift = 1 + t * 0.02;
    // ビート同期: 拍のたびに小さくグッと寄る（キメの鼓動）
    const bump =
      p.beatSync === "beat"
        ? 1 + (amount - 1) * 0.18 * beatPulse(beatClock, frame, fps, 0.18)
        : 1;
    transform = `scale(${punch * drift * bump})`;
  } else if (instance.id === "slow-zoom-in") {
    const amount = Number(p.amount);
    transform = `scale(${1 + (amount - 1) * t})`;
  } else if (instance.id === "slow-zoom-out") {
    const amount = Number(p.amount);
    transform = `scale(${amount - (amount - 1) * t})`;
  } else if (instance.id === "push-in") {
    // 小節にそろえた決まった長さでグッと寄り、寄った位置で止まる。
    // 発火・到達のタイミングと寄る長さは pushInWindow が決定論で返す。
    const amount = Number(p.amount);
    const sectionStartSongSec = beatClock ? beatClock.offsetFrames / fps : 0;
    const win = pushInWindow({
      sectionDurSec: Math.max(0.1, durationInFrames / fps),
      sectionStartSongSec,
      downbeats: beatClock?.downbeats,
      beats: beatClock?.beats,
      timing: (p.timing as "head" | "tail") ?? "head",
      bars: Number(p.bars),
    });
    const startF = Math.round(win.startSec * fps);
    const durF = Math.max(2, Math.round(win.durSec * fps));
    const prog = spring({
      frame: Math.max(0, frame - startF),
      fps,
      durationInFrames: durF,
      config: { damping: 200 },
    });
    transform = `scale(${1 + (amount - 1) * prog})`;
  } else if (instance.id === "pan") {
    const amount = Number(p.amount); // %
    const v = panVector(String(p.direction));
    // 端が見えないように移動量ぶんスケールを確保（left/right/up/down共通のガード式）
    const scale = 1 + (amount * 2) / 100 + 0.02;
    if (v.y === 0) {
      // 横パン: left/right の出力は現行と完全一致（ピクセル回帰ゼロ）
      const x = interpolate(t, [0, 1], [amount * v.x * -1, amount * v.x]);
      transform = `scale(${scale}) translateX(${x / 2}%)`;
    } else {
      // ティルト（上下パン）: translateY で同型
      const y = interpolate(t, [0, 1], [amount * v.y * -1, amount * v.y]);
      transform = `scale(${scale}) translateY(${y / 2}%)`;
    }
  }

  return (
    <AbsoluteFill style={{ transform, transformOrigin: origin }}>
      {children}
    </AbsoluteFill>
  );
};
