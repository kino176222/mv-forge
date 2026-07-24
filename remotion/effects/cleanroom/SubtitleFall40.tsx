import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/SquarePeg";

const { fontFamily: squarePegFamily } = loadFont();

/**
 * SubtitleFall40 — クリーンルーム再実装
 *
 * 白い手書きスクリプト体の字幕。文字ごとにランダム順でふわりと舞い降り、
 * 揃ったあとゆったり漂い、最後は行全体が傾きながら左下へ流れ去る。
 *
 * 機能記述「白い文字が舞い降りてきて、流れ去っていく字幕」を出発点に、
 * 旧レンダリング（見た目のものさし）と同等の質感を白紙から構成したもの。
 */
export type SubtitleFall40Props = {
  /** 表示する文言。"\n" で複数行。 */
  text?: string;
  /** 演出全体の尺（フレーム）。イン→ホールド→アウトをこの中に収める。 */
  durationInFrames?: number;
  /** 文字サイズ(px) */
  fontSize?: number;
  /** 文字色 */
  color?: string;
  /** フォント（既定は Square Peg） */
  fontFamily?: string;
  /** 字間(px) */
  letterSpacing?: number;
  /** 行間（fontSize に対する倍率） */
  lineHeight?: number;
  /** 行の中心位置 X（0〜1、画面幅比） */
  posX?: number;
  /** 行の中心位置 Y（0〜1、画面高比） */
  posY?: number;
  /** 舞い降り（イン）に使う秒数 */
  inSeconds?: number;
  /** 流れ去り（アウト）に使う秒数 */
  outSeconds?: number;
  /** 1文字が落ち始めてから着地するまでの秒数 */
  charFallSeconds?: number;
  /** 1文字が透けから実体になるまでの秒数（着地後もじわっと白くなる） */
  charFadeSeconds?: number;
  /** 落下開始位置の高さ(px) */
  fallDistance?: number;
  /** 着地後にゆらゆら漂う振幅(px)。0で無効 */
  driftAmplitude?: number;
  /** アウトで左へ流れる距離(px) */
  exitDriftX?: number;
  /** アウトで下へ沈む距離(px) */
  exitDriftY?: number;
  /** アウトでの行の傾き(deg) */
  exitRotateDeg?: number;
  /** 文字の出現順を変えるシード */
  seed?: number;
};

/** 決定的な擬似乱数（seed 固定で毎フレーム同じ並びを返す） */
const makeRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInQuad = (t: number) => t * t;

export const SubtitleFall40: React.FC<SubtitleFall40Props> = ({
  text = "The quiet glow",
  durationInFrames = 96,
  fontSize = 270,
  color = "#ffffff",
  fontFamily = `'${squarePegFamily}', 'Square Peg', cursive`,
  letterSpacing = 2,
  lineHeight = 1.15,
  posX = 0.5,
  posY = 0.5,
  inSeconds = 1.6,
  outSeconds = 1.25,
  charFallSeconds = 0.6,
  charFadeSeconds = 1.3,
  fallDistance = 280,
  driftAmplitude = 4,
  exitDriftX = 1500,
  exitDriftY = 130,
  exitRotateDeg = 9,
  seed = 40,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const lines = useMemo(() => text.split("\n").filter((l) => l.length > 0), [text]);

  // 空白以外の文字へランダムな出現順を割り当てる（seed 固定で決定的）
  const appearanceOrder = useMemo(() => {
    const indices: number[] = [];
    let global = 0;
    for (const line of lines) {
      for (const ch of Array.from(line)) {
        if (ch.trim().length > 0) indices.push(global);
        global += 1;
      }
    }
    const rng = makeRandom(seed * 7919 + 17);
    const shuffled = [...indices];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const orderOf = new Map<number, number>();
    shuffled.forEach((globalIndex, order) => orderOf.set(globalIndex, order));
    return orderOf;
  }, [lines, seed]);

  const visibleCount = appearanceOrder.size;
  const inFrames = Math.round(inSeconds * fps);
  const outFrames = Math.round(outSeconds * fps);
  const fallFrames = Math.max(1, Math.round(charFallSeconds * fps));
  const fadeFrames = Math.max(1, Math.round(charFadeSeconds * fps));
  // 最後の文字が inFrames 内に着地し切るよう、開始をずらす幅を計算
  const staggerSpan = Math.max(0, inFrames - fallFrames);
  const stagger = visibleCount > 1 ? staggerSpan / (visibleCount - 1) : 0;

  // アウト：行全体が傾きながら左下へ流れ、終盤でフェードアウト
  const outStart = durationInFrames - outFrames;
  const outT = clamp01((frame - outStart) / Math.max(1, outFrames));
  const exitX = -exitDriftX * Math.pow(outT, 2.5);
  const exitY = exitDriftY * easeInQuad(outT);
  const exitRot = exitRotateDeg * easeOutCubic(outT);
  const exitOpacity = outT < 0.6 ? 1 : 1 - easeInQuad((outT - 0.6) / 0.4);

  let globalIndex = 0;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: posX * width,
          top: posY * height,
          transform: `translate(-50%, -50%) translate(${exitX}px, ${exitY}px) rotate(${exitRot}deg)`,
          opacity: exitOpacity,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          fontFamily,
          fontSize,
          color,
          letterSpacing,
          lineHeight,
          whiteSpace: "pre",
        }}
      >
        {lines.map((line, lineIdx) => (
          <div key={lineIdx} style={{ display: "flex" }}>
            {Array.from(line).map((ch, chIdx) => {
              const myGlobal = globalIndex;
              globalIndex += 1;
              if (ch.trim().length === 0) {
                return <span key={chIdx}>{ch}</span>;
              }
              const order = appearanceOrder.get(myGlobal) ?? 0;
              const start = order * stagger;
              const p = clamp01((frame - start) / fallFrames);
              const eased = easeOutCubic(p);
              // 舞い降り：上から落ちつつ縦に伸びた残像風のストレッチが戻る
              const fallY = -(1 - eased) * fallDistance;
              const stretch = 1 + (1 - eased) * 1.4;
              // ふわっと現れる：着地よりゆっくり、透けから白へじわっと満ちる
              const fadeP = clamp01((frame - start) / fadeFrames);
              const opacity = easeOutCubic(fadeP);
              // 着地後のゆったりした漂い
              const settled = p >= 1 ? 1 : eased;
              const bob =
                driftAmplitude > 0
                  ? Math.sin((frame / fps) * 1.6 * Math.PI + myGlobal * 1.3) *
                    driftAmplitude *
                    settled
                  : 0;
              return (
                <span
                  key={chIdx}
                  style={{
                    display: "inline-block",
                    transform: `translateY(${fallY + bob}px) scaleY(${stretch})`,
                    transformOrigin: "center 80%",
                    opacity,
                  }}
                >
                  {ch}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export default SubtitleFall40;
