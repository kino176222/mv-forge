import React, { useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Fredoka";

const { fontFamily: roundFamily } = loadFont("normal", {
  weights: ["700"],
});

/**
 * KineticTitle02 — クリーンルーム再実装
 *
 * 太字ラウンド体のローワーケース1語が、左→右へ1文字ずつオーバーシュート付きで
 * 弾んで組み上がるキネティックタイトル。塗りはゴールド→ピンクの横グラデ
 * （文字インデックスで補間）。ホールド後は同じ左→右順で、文字が浮き上がりながら
 * 縮んでフェードアウトする。
 *
 * 機能記述「文字が左から順に弾んで組み上がる、ゴールドからピンクへのグラデの
 * キネティックタイトル」を出発点に、旧レンダリング（見た目のものさし）と
 * 同等の質感を白紙から構成したもの。
 */
export type KineticTitle06V7Props = {
  /** 表示する文言（1行想定・ローワーケース推奨） */
  text?: string;
  /** 演出全体の尺（フレーム）。イン→ホールド→アウトをこの中に収める。 */
  durationInFrames?: number;
  /** 文字サイズ(px) */
  fontSize?: number;
  /** フォント（既定は Fredoka） */
  fontFamily?: string;
  /** フォントウェイト */
  fontWeight?: number;
  /** グラデ開始色（左端の文字） */
  colorStart?: string;
  /** グラデ終了色（右端の文字） */
  colorEnd?: string;
  /** 字間(em) */
  letterSpacingEm?: number;
  /** 行の中心位置 X（0〜1、画面幅比） */
  posX?: number;
  /** 行の中心位置 Y（0〜1、画面高比） */
  posY?: number;
  /** 文字ごとの入場開始ずらし（フレーム） */
  enterStagger?: number;
  /** 1文字の入場バウンスにかける秒数 */
  enterSeconds?: number;
  /** 文字ごとの退場開始ずらし（フレーム） */
  exitStagger?: number;
  /** 1文字の退場シュリンクにかける秒数 */
  exitSeconds?: number;
  /** 全文字が消えてから尺末尾までの余白（フレーム） */
  exitTail?: number;
  /** 入場時の初期傾き(deg)。バウンスとともに0へ戻る */
  enterTiltDeg?: number;
  /** 退場時の傾き(deg) */
  exitTiltDeg?: number;
};

/** "#rrggbb" → [r,g,b] */
const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const v = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h,
    16
  );
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

/** 2色を t(0..1) で線形補間して css 色に */
const mixColor = (a: [number, number, number], b: [number, number, number], t: number): string => {
  const c = a.map((av, i) => Math.round(av + (b[i] - av) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
};

export const KineticTitle02: React.FC<KineticTitle06V7Props> = ({
  text = "restless",
  durationInFrames = 192,
  fontSize = 147,
  fontFamily = roundFamily,
  fontWeight = 700,
  colorStart = "#f6a821",
  colorEnd = "#f0568e",
  letterSpacingEm = 0.005,
  posX = 0.5,
  posY = 0.48,
  enterStagger = 2.2,
  enterSeconds = 0.62,
  exitStagger = 1.8,
  exitSeconds = 0.28,
  exitTail = 9,
  enterTiltDeg = -14,
  exitTiltDeg = 8,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const letters = useMemo(() => Array.from(text), [text]);
  const n = letters.length;

  const rgbStart = useMemo(() => hexToRgb(colorStart), [colorStart]);
  const rgbEnd = useMemo(() => hexToRgb(colorEnd), [colorEnd]);

  const enterDur = Math.max(1, Math.round(enterSeconds * fps));
  const exitDur = Math.max(1, Math.round(exitSeconds * fps));
  // 最後の文字が退場し終わってから exitTail 残るように逆算
  const exitStart = Math.max(
    0,
    durationInFrames - exitTail - exitDur - (n - 1) * exitStagger
  );

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: posX * width,
          top: posY * height,
          transform: "translate(-50%, -50%)",
          display: "flex",
          flexDirection: "row",
          alignItems: "baseline",
          whiteSpace: "pre",
          fontFamily,
          fontWeight,
          fontSize,
          lineHeight: 1,
          letterSpacing: `${letterSpacingEm}em`,
        }}
      >
        {letters.map((ch, i) => {
          const t = n > 1 ? i / (n - 1) : 0;
          const color = mixColor(rgbStart, rgbEnd, t);

          // --- 入場：左→右に弾んで組み上がる ---
          const enterFrom = i * enterStagger;
          const pop = spring({
            frame: frame - enterFrom,
            fps,
            durationInFrames: enterDur,
            config: { damping: 10.5, stiffness: 90, mass: 1 },
          });
          const enterOpacity = interpolate(
            frame - enterFrom,
            [0, enterDur * 0.85],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );
          const enterScale = interpolate(pop, [0, 1], [0.22, 1]);
          const enterTilt = interpolate(pop, [0, 1], [enterTiltDeg, 0]);

          // --- 退場：同じ左→右順で浮きながら縮んで抜ける ---
          const exitFrom = exitStart + i * exitStagger;
          const exitT = interpolate(frame, [exitFrom, exitFrom + exitDur], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          // ease-in で勢いよく抜ける
          const exitEase = exitT * exitT;
          const exitScale = 1 - exitEase;
          const exitOpacity = 1 - exitEase;
          const exitTilt = exitEase * exitTiltDeg;
          const exitLift = exitEase * fontSize * 0.18;

          const entering = exitT <= 0;
          const scale = entering ? enterScale : Math.max(0, exitScale);
          const opacity = Math.min(enterOpacity, exitOpacity);
          const tilt = entering ? enterTilt : exitTilt;

          if (opacity <= 0.001 || scale <= 0.001) {
            // レイアウト（他文字の位置）を保つため透明のまま置いておく
            return (
              <span key={i} style={{ visibility: "hidden" }}>
                {ch}
              </span>
            );
          }

          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                color,
                opacity,
                transform: `translateY(${-exitLift}px) scale(${scale}) rotate(${tilt}deg)`,
                // 小さい時はベースライン寄りに沈む（弾んで着地する感じ）
                transformOrigin: entering ? "50% 80%" : "50% 30%",
              }}
            >
              {ch}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export default KineticTitle02;
