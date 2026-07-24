import React from "react";
import { interpolate, Easing } from "remotion";
import { StrokedText } from "../StrokedText";
import type { DecorContext } from "./types";

/**
 * 装飾の共通土台。行と同じ位置に「文字サイズの透明スペーサー」を置き、
 * その周りに children（装飾ビジュアル）を absolute で重ねる。
 * 実文字は出方レイヤーが上に描くので、ここでは visibility:hidden のサイズ取りだけ。
 */
export const DecorBox: React.FC<{
  ctx: DecorContext;
  /** 文字の周囲にどれだけ装飾をはみ出させるか */
  padding?: string;
  children: React.ReactNode;
  /** スペーサーspanへの追加スタイル（回転など） */
  boxStyle?: React.CSSProperties;
  opacity?: number;
}> = ({ ctx, padding, children, boxStyle, opacity = 1 }) => (
  <div
    style={{
      ...ctx.positioned,
      transform: ctx.baseTranslate,
      opacity: ctx.exit * opacity,
    }}
  >
    <span
      style={{
        position: "relative",
        display: "inline-block",
        padding,
        ...boxStyle,
      }}
    >
      {children}
      <span style={{ visibility: "hidden" }}>
        <StrokedText
          text={ctx.text}
          fontStyle={ctx.fontStyle}
          textStyle={ctx.textStyle}
        />
      </span>
    </span>
  </div>
);

/** 入場イージング（既定0.3秒でスッと入る）。startSec で遅らせ可 */
export const decorEnter = (
  ctx: DecorContext,
  durSec = 0.3,
  startSec = 0,
): number => {
  const startF = Math.round(startSec * ctx.fps);
  return interpolate(
    ctx.frame,
    [startF, startF + Math.max(1, Math.round(durSec * ctx.fps))],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
    },
  );
};
