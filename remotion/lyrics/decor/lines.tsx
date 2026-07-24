import React from "react";
import { interpolate, Easing } from "remotion";
import { StrokedText } from "../StrokedText";
import { DecorBox, decorEnter } from "./common";
import type { DecorContext, DecorRenderer } from "./types";

/** 線・下線系の装飾。横書きは文字の下、縦書きは行の左に線を引く */

/** 線の色を params(color/hue) から決める共通ヘルパー */
const lineColor = (ctx: DecorContext, defaultHue = 340): string => {
  const color = String(ctx.params.color ?? "white");
  const hue = Number(ctx.params.hue ?? defaultHue);
  return color === "color" ? `hsl(${hue}, 85%, 60%)` : "#f5f5f2";
};

/** アンダーライン: 線が文字に沿ってスッと伸びる。強調の基本形 */
export const decorUnderline: DecorRenderer = {
  layer: (ctx) => {
    const th = Number(ctx.params.thickness ?? 4);
    const c = lineColor(ctx);
    const e = decorEnter(ctx, 0.35, 0.15);
    const pos: React.CSSProperties = ctx.vertical
      ? { top: 0, left: -th * 2.5, width: th, height: "100%", transform: `scaleY(${e})`, transformOrigin: "top center" }
      : { left: 0, bottom: -th * 2, height: th, width: "100%", transform: `scaleX(${e})`, transformOrigin: "left center" };
    // ぼけた光輪: 芯より一回り太い同色のにじみ（発光の裏打ち）
    const halo: React.CSSProperties = ctx.vertical
      ? { top: 0, left: -th * 2.5 - th * 0.6, width: th * 2.2, height: "100%", transform: `scaleY(${e})`, transformOrigin: "top center" }
      : { left: 0, bottom: -th * 2 - th * 0.6, height: th * 2.2, width: "100%", transform: `scaleX(${e})`, transformOrigin: "left center" };
    // 描いている間だけ先端に灯るペン先の光
    const drawing = e > 0.02 && e < 0.995;
    const tipSize = th * 3;
    const tipPos: React.CSSProperties = ctx.vertical
      ? { left: -th * 2.5 + th / 2 - tipSize / 2, top: `calc(${(e * 100).toFixed(2)}% - ${tipSize / 2}px)` }
      : { bottom: -th * 2 + th / 2 - tipSize / 2, left: `calc(${(e * 100).toFixed(2)}% - ${tipSize / 2}px)` };
    return (
      <DecorBox ctx={ctx}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            background: c,
            borderRadius: th,
            filter: "blur(5px)",
            opacity: 0.45,
            ...halo,
          }}
        />
        <span
          aria-hidden
          style={{
            position: "absolute",
            background: c,
            borderRadius: th / 2,
            boxShadow: `0 1px 6px rgba(0,0,0,0.35)`,
            ...pos,
          }}
        />
        {drawing && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              width: tipSize,
              height: tipSize,
              borderRadius: "50%",
              background: `radial-gradient(circle, rgba(255,255,255,0.95), ${c} 40%, transparent 70%)`,
              filter: "blur(1px)",
              opacity: 1 - e * 0.5,
              ...tipPos,
            }}
          />
        )}
      </DecorBox>
    );
  },
};

/**
 * 蛍光マーカー: 文字の下半分に半透明の太線。教科書に引くあのマーカー。
 * 行折返しでも各行に乗るよう、インライン背景 + box-decoration-break: clone で描く
 * （絶対配置ボックスだと複数行ブロック全体に効いてしまう）。
 */
export const decorMarker: DecorRenderer = {
  layer: (ctx) => {
    const hue = Number(ctx.params.hue ?? 55);
    const op = Number(ctx.params.opacity ?? 0.55);
    const coverage = Number(ctx.params.coverage ?? 0.5);
    // マーカーを「引く」筆致: 行頭から行末へワイプで現れる（線形フェードの置換）
    const draw = interpolate(
      ctx.frame,
      [Math.round(0.1 * ctx.fps), Math.round(0.55 * ctx.fps)],
      [0, 1],
      {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.cubic),
      },
    );
    const fade = interpolate(
      ctx.frame,
      [Math.round(0.1 * ctx.fps), Math.round(0.25 * ctx.fps)],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    const c = `hsla(${hue}, 95%, 60%, ${op})`;
    const soft = `hsla(${hue}, 95%, 62%, ${op * 0.35})`;
    // 横書き: 各行の下寄り / 縦書き: 各列の右寄りに帯
    const from = (1 - coverage) * 88;
    const softFrom = Math.max(0, from - 6);
    // 芯の帯＋一回り広い淡い帯を重ねる＝インクの滲み（エッジが柔らかく光る）
    const grad = ctx.vertical
      ? `linear-gradient(to left, transparent ${from}%, ${c} ${from}% 94%, transparent 94%), linear-gradient(to left, transparent ${softFrom}%, ${soft} ${softFrom}% 97%, transparent 97%)`
      : `linear-gradient(180deg, transparent ${from}%, ${c} ${from}% 92%, transparent 92%), linear-gradient(180deg, transparent ${softFrom}%, ${soft} ${softFrom}% 96%, transparent 96%)`;
    return (
      <div
        style={{
          ...ctx.positioned,
          transform: ctx.baseTranslate,
          opacity: fade * ctx.exit,
          clipPath: ctx.vertical
            ? `inset(0 0 ${(100 - draw * 100).toFixed(2)}% 0)`
            : `inset(0 ${(100 - draw * 100).toFixed(2)}% 0 0)`,
        }}
      >
        <span
          aria-hidden
          style={{
            background: grad,
            WebkitBoxDecorationBreak: "clone",
            boxDecorationBreak: "clone",
          }}
        >
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
  },
};

/** 点線下線: ドット状の下線。かわいい・メモ書き感 */
export const decorUnderlineDash: DecorRenderer = {
  layer: (ctx) => {
    const th = Number(ctx.params.thickness ?? 5);
    const dash = Number(ctx.params.dash ?? 10);
    const c = lineColor(ctx);
    const e = decorEnter(ctx, 0.35, 0.15);
    const grad = ctx.vertical
      ? `repeating-linear-gradient(180deg, ${c} 0 ${dash}px, transparent ${dash}px ${dash * 2}px)`
      : `repeating-linear-gradient(90deg, ${c} 0 ${dash}px, transparent ${dash}px ${dash * 2}px)`;
    const pos: React.CSSProperties = ctx.vertical
      ? { top: 0, left: -th * 2.5, width: th, height: "100%", transform: `scaleY(${e})`, transformOrigin: "top center" }
      : { left: 0, bottom: -th * 2, height: th, width: "100%", transform: `scaleX(${e})`, transformOrigin: "left center" };
    return (
      <DecorBox ctx={ctx}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            background: grad,
            filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.4))",
            ...pos,
          }}
        />
      </DecorBox>
    );
  },
};

/** サイドライン: 行頭にアクセントの縦棒（縦書きは行の上に横棒）。引用・語りの行に */
export const decorSideline: DecorRenderer = {
  layer: (ctx) => {
    const th = Number(ctx.params.thickness ?? 6);
    const c = lineColor(ctx, 200);
    const glow = Number(ctx.params.glow ?? 0.4);
    const e = decorEnter(ctx, 0.3);
    const pos: React.CSSProperties = ctx.vertical
      ? {
          left: 0,
          top: -th * 2.2,
          width: "100%",
          height: th,
          transform: `scaleX(${e})`,
          transformOrigin: "left center",
        }
      : {
          left: `-${th * 2.5}px`,
          top: "0.1em",
          bottom: "0.1em",
          width: th,
          transform: `scaleY(${e})`,
          transformOrigin: "top center",
        };
    return (
      <DecorBox ctx={ctx}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            background: c,
            borderRadius: th / 2,
            boxShadow: glow > 0 ? `0 0 ${12 * glow}px ${c}` : undefined,
            ...pos,
          }}
        />
      </DecorBox>
    );
  },
};

/** 二重線: 文字の上下（縦書きは左右）を細線で挟む。見出し・格言の風格 */
export const decorDoubleLine: DecorRenderer = {
  layer: (ctx) => {
    const th = Number(ctx.params.thickness ?? 2);
    const gap = Number(ctx.params.gap ?? 10);
    const c = lineColor(ctx);
    const e = decorEnter(ctx, 0.35, 0.1);
    const mk = (side: "a" | "b"): React.CSSProperties =>
      ctx.vertical
        ? {
            top: 0,
            height: "100%",
            width: th,
            [side === "a" ? "left" : "right"]: -gap,
            transform: `scaleY(${e})`,
            transformOrigin: "top center",
          }
        : {
            left: 0,
            width: "100%",
            height: th,
            [side === "a" ? "top" : "bottom"]: -gap,
            transform: `scaleX(${e})`,
            transformOrigin: side === "a" ? "right center" : "left center",
          };
    return (
      <DecorBox ctx={ctx}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            background: c,
            boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
            ...mk("a"),
          }}
        />
        <span
          aria-hidden
          style={{
            position: "absolute",
            background: c,
            boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
            ...mk("b"),
          }}
        />
      </DecorBox>
    );
  },
};
