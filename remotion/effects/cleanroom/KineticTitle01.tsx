import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";

// 旧既定は Inter（未ロード）→ Mac ローカル 'Helvetica Neue' フォールバック。
// Google Fonts から Inter を実際にロードし、配布ビルドでも同一の見た目にする。
const { fontFamily: INTER } = loadInter("normal", {
  weights: ["400", "600", "700"],
  subsets: ["latin", "latin-ext"],
});

/**
 * KineticTitle01 — クリーンルーム再実装
 *
 * 1文字ずつ弾けて現れるキネティックな見出しタイトル。
 * 各文字がランダムな順番で「小さく透けた状態 → オーバーシュート付きで
 * ポップイン」して1行の見出しが組み上がり、ホールドのあと、
 * 終端では1文字ずつ勢いよく膨らみながらフェードアウトして退場する。
 *
 * 機能記述「1文字ずつ弾けて現れるキネティックな見出しタイトル」を出発点に、
 * 旧レンダリング（見た目のものさし）と同等の質感を白紙から構成したもの。
 */
export type KineticTitle06G7Props = {
  /** 表示する文言。"\n" で複数行。 */
  text?: string;
  /** 演出全体の尺（フレーム）。イン→ホールド→アウトをこの中に収める。 */
  durationInFrames?: number;
  /** 文字サイズ(px) */
  fontSize?: number;
  /** 文字の太さ */
  fontWeight?: number | string;
  /** 文字色 */
  color?: string;
  /** フォント（既定は Inter 系サンセリフ） */
  fontFamily?: string;
  /** 字間(px) */
  letterSpacing?: number;
  /** 行間（fontSize に対する倍率） */
  lineHeight?: number;
  /** 行の中心位置 X（0〜1、画面幅比） */
  posX?: number;
  /** 行の中心位置 Y（0〜1、画面高比） */
  posY?: number;
  /** 最初の文字が弾け始めるまでの待ち（秒） */
  startDelaySeconds?: number;
  /** 全文字のポップインが収まるまでの窓（秒） */
  inSeconds?: number;
  /** 1文字のポップイン所要（秒） */
  charPopSeconds?: number;
  /** ポップイン開始時のスケール（0〜1） */
  popFromScale?: number;
  /** ポップインのオーバーシュート量（1.0で無し、大きいほど弾む） */
  overshoot?: number;
  /** 全文字の退場が収まる窓（秒）。尺の末尾から確保する */
  outSeconds?: number;
  /** 1文字の退場所要（秒） */
  charExitSeconds?: number;
  /** 退場時に膨らむ最大スケール */
  exitScale?: number;
  /** 文字の出現/退場順を変えるシード */
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
const easeInQuad = (t: number) => t * t;

/** 終端でオーバーシュートしてから収束するイージング（戻り係数は強度から算出） */
const easeOutBack = (t: number, intensity: number) => {
  const c1 = intensity;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
};

/** 空白以外の文字へランダムな順番を割り当てる（seed 固定で決定的） */
const shuffleOrder = (visibleGlobals: number[], seed: number) => {
  const rng = makeRandom(seed);
  const shuffled = [...visibleGlobals];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const orderOf = new Map<number, number>();
  shuffled.forEach((globalIndex, order) => orderOf.set(globalIndex, order));
  return orderOf;
};

export const KineticTitle01: React.FC<KineticTitle06G7Props> = ({
  text = "almost here",
  durationInFrames = 192,
  fontSize = 140,
  fontWeight = 600,
  color = "#ffffff",
  fontFamily = `'${INTER}', sans-serif`,
  letterSpacing = 0,
  lineHeight = 1.15,
  posX = 0.5,
  posY = 0.485,
  startDelaySeconds = 0.2,
  inSeconds = 1.0,
  charPopSeconds = 0.3,
  popFromScale = 0.25,
  overshoot = 1.7,
  outSeconds = 1.15,
  charExitSeconds = 0.34,
  exitScale = 1.45,
  seed = 6,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const lines = useMemo(
    () => text.split("\n").filter((l) => l.length > 0),
    [text]
  );

  // 空白以外の文字のグローバル添字を集め、イン/アウトそれぞれ別の順番を振る
  const { enterOrder, exitOrder, visibleCount } = useMemo(() => {
    const visibles: number[] = [];
    let global = 0;
    for (const line of lines) {
      for (const ch of Array.from(line)) {
        if (ch.trim().length > 0) visibles.push(global);
        global += 1;
      }
    }
    return {
      enterOrder: shuffleOrder(visibles, seed * 7919 + 31),
      exitOrder: shuffleOrder(visibles, seed * 104729 + 7),
      visibleCount: visibles.length,
    };
  }, [lines, seed]);

  const startDelay = Math.round(startDelaySeconds * fps);
  const inFrames = Math.max(1, Math.round(inSeconds * fps));
  const popFrames = Math.max(1, Math.round(charPopSeconds * fps));
  const outFrames = Math.max(1, Math.round(outSeconds * fps));
  const exitCharFrames = Math.max(1, Math.round(charExitSeconds * fps));

  // イン：全員が inFrames 内に着地するよう開始をずらす
  const enterSpan = Math.max(0, inFrames - popFrames);
  const enterStagger = visibleCount > 1 ? enterSpan / (visibleCount - 1) : 0;

  // アウト：尺の末尾 outFrames を退場窓にして、1文字ずつ順番に消す
  const exitWindowStart = durationInFrames - outFrames;
  const exitSpan = Math.max(0, outFrames - exitCharFrames);
  const exitStagger = visibleCount > 1 ? exitSpan / (visibleCount - 1) : 0;

  let globalIndex = 0;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: posX * width,
          top: posY * height,
          transform: "translate(-50%, -50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          fontFamily,
          fontSize,
          fontWeight,
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

              // ポップイン：小さく透けた状態から、オーバーシュート付きで実寸へ
              const inOrder = enterOrder.get(myGlobal) ?? 0;
              const inStart = startDelay + inOrder * enterStagger;
              const inP = clamp01((frame - inStart) / popFrames);
              const popEase = easeOutBack(inP, overshoot);
              let scale = popFromScale + (1 - popFromScale) * popEase;
              // 透け→白へは着地よりひと足早く満ちる（弾けた瞬間はまだ薄い）
              let opacity = clamp01(inP / 0.65);

              // 退場：勢いよく膨らみながらフェードアウト
              const outOrder = exitOrder.get(myGlobal) ?? 0;
              const outStart = exitWindowStart + outOrder * exitStagger;
              const outP = clamp01((frame - outStart) / exitCharFrames);
              if (outP > 0) {
                // 膨らみは後半に勢いがつき、明るさは先に落ち始める
                scale *= 1 + (exitScale - 1) * Math.pow(outP, 1.6);
                opacity *= 1 - easeInQuad(outP);
              }

              return (
                <span
                  key={chIdx}
                  style={{
                    display: "inline-block",
                    transform: `scale(${scale})`,
                    transformOrigin: "center 60%",
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

export default KineticTitle01;
