import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { hashRand } from "./rand";
import { recentBeats, type BeatClock } from "./beat";

/**
 * 線の演出: 細い光の線が「シュッ」と引かれて、しばらく残り、消える。
 * 区切り・スピード感・スタイリッシュな抜け感。
 * ビート同期時は拍のたびに1本ずつ新しい線が走る。
 * 磨き: 線をシャープな芯＋光輪の2層に分け、先端に走行中のグロー。
 *       線ごとに前後差（手前=太く柔らかい/奥=細く鋭い）、消灯はeaseInOut。
 */
export const LineSweep: React.FC<{
  count: number;
  angle: number;
  thickness: number;
  speed: number;
  beatSync?: boolean;
  beatClock?: BeatClock | null;
}> = ({ count, angle, thickness, speed, beatSync, beatClock }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const buildLine = (seed: number, localFrame: number) => {
    const y = 18 + hashRand(seed, 41) * 64; // 画面内の高さ(%)
    const drawFrames = Math.max(3, Math.round((0.45 * fps) / speed));
    const holdFrames = Math.round(1.4 * fps);
    const fadeFrames = Math.round(0.5 * fps);

    const draw = interpolate(localFrame, [0, drawFrames], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
    });
    const fade = interpolate(
      localFrame,
      [drawFrames + holdFrames, drawFrames + holdFrames + fadeFrames],
      [1, 0],
      {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.inOut(Easing.ease),
      },
    );
    const fromLeft = hashRand(seed, 42) > 0.5;
    // 前後差: 手前の線は太く柔らかく、奥の線は細く鋭い
    const depth = hashRand(seed, 43); // 0=奥 → 1=手前
    // 残光中のかすかな明滅（完全静止にしない）
    const shimmer =
      draw >= 1
        ? 0.92 + 0.08 * Math.sin((localFrame / fps) * Math.PI * 2 * 1.7 + seed)
        : 1;
    return { y, draw, fade, fromLeft, depth, shimmer };
  };

  const lines =
    beatSync && beatClock
      ? // 拍ごとに1本再発火（直近count拍ぶんを重ねる）
        recentBeats(beatClock, frame, fps, count).map((b) =>
          buildLine(b.index, Math.round(b.elapsed * fps)),
        )
      : Array.from({ length: count }, (_, i) =>
          buildLine(i, frame - Math.round((i * 0.35 * fps) / speed)),
        );

  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: "-15%",
          transform: `rotate(${angle}deg)`,
        }}
      >
        {lines.map((l, i) => {
          if (l.draw <= 0 || l.fade <= 0) return null;
          const th = thickness * (0.8 + l.depth * 0.7);
          const opacity = l.fade * l.shimmer;
          const side = l.fromLeft
            ? ({ left: 0 } as const)
            : ({ right: 0 } as const);
          const grad = l.fromLeft ? "90deg" : "270deg";
          const tipAt = `${l.draw * 100}%`;
          return (
            <React.Fragment key={i}>
              {/* 光輪: 太めのにじみ（手前ほど柔らかく広い） */}
              <div
                style={{
                  position: "absolute",
                  top: `${l.y}%`,
                  ...side,
                  width: `${l.draw * 100}%`,
                  height: th * (2.6 + l.depth * 1.8),
                  transform: "translateY(-40%)",
                  opacity: opacity * 0.55,
                  background: `linear-gradient(${grad}, transparent, rgba(255,250,235,0.55), rgba(255,244,214,0.35))`,
                  filter: `blur(${4 + l.depth * 5}px)`,
                  mixBlendMode: "screen",
                }}
              />
              {/* 芯: シャープな白い線 */}
              <div
                style={{
                  position: "absolute",
                  top: `${l.y}%`,
                  ...side,
                  width: `${l.draw * 100}%`,
                  height: th,
                  opacity,
                  background: `linear-gradient(${grad}, transparent, rgba(255,255,255,0.98), rgba(255,255,255,0.75))`,
                  boxShadow: "0 0 8px rgba(255,255,255,0.6)",
                  mixBlendMode: "screen",
                }}
              />
              {/* 先端グロー: 走行中だけ先頭が強く光る（引き終わると芯に溶ける） */}
              {l.draw < 1 && (
                <div
                  style={{
                    position: "absolute",
                    top: `${l.y}%`,
                    [l.fromLeft ? "left" : "right"]: tipAt,
                    width: th * 7,
                    height: th * 7,
                    transform: `translate(${l.fromLeft ? -50 : 50}%, -46%)`,
                    borderRadius: "50%",
                    opacity: opacity * (0.5 + 0.5 * l.draw),
                    background:
                      "radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(255,246,222,0.5) 40%, transparent 70%)",
                    filter: "blur(1px)",
                    mixBlendMode: "screen",
                  }}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
