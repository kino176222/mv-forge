import React from "react";
import { DecorBox, decorEnter } from "./common";
import type { DecorRenderer } from "./types";

/** 発光・影系の装飾。文字の背後に光や影を足して立体感・空気感を出す */

/** 背後グロー: 文字の後ろにふわっと光だまり。夜景・ネオンの空気 */
export const decorGlowPad: DecorRenderer = {
  layer: (ctx) => {
    const hue = Number(ctx.params.hue ?? 320);
    const size = Number(ctx.params.size ?? 1);
    const intensity = Number(ctx.params.intensity ?? 0.6);
    const e = decorEnter(ctx, 0.5);
    const t = ctx.frame / ctx.fps;
    // 光だまりの呼吸（振幅は控えめ。静かな明滅）
    const breathe = 0.93 + 0.07 * Math.sin(t * 2.1);
    // 入場時にふわっと膨らむ
    const bloom = 0.9 + 0.1 * e;
    return (
      <DecorBox ctx={ctx}>
        {/* ぼけた光輪: 外周へ大きくにじむ（加算light感） */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: `-${1.6 * size}em`,
            background: `radial-gradient(ellipse 62% 72% at 50% 50%, hsla(${hue}, 90%, 60%, ${intensity * 0.5 * e * breathe}), transparent 72%)`,
            filter: "blur(16px)",
            transform: `scale(${bloom})`,
            mixBlendMode: "screen",
          }}
        />
        {/* シャープ寄りの芯: 中心の明るい光だまり */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: `-${1.2 * size}em`,
            background: `radial-gradient(ellipse 38% 46% at 50% 50%, hsla(${hue}, 95%, 68%, ${intensity * 0.85 * e * breathe}), transparent 68%)`,
            filter: "blur(4px)",
            transform: `scale(${bloom})`,
            mixBlendMode: "screen",
          }}
        />
      </DecorBox>
    );
  },
};

/** ロングシャドウ: 斜めに長く伸びる影。フラットデザイン・タイトルの風格 */
export const decorLongShadow: DecorRenderer = {
  layer: (ctx) => {
    const len = Number(ctx.params.length ?? 18);
    const left = String(ctx.params.direction) === "left";
    const op = Number(ctx.params.opacity ?? 0.55);
    const e = decorEnter(ctx, 0.35);
    const steps = Math.max(3, Math.ceil(len / 2));
    const sx = left ? -1 : 1;
    return (
      <DecorBox ctx={ctx}>
        {Array.from({ length: steps }, (_, k) => {
          const i = steps - k; // 遠い影から描く
          const fade = 1 - (i / steps) * 0.6;
          return (
            <span
              key={i}
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                transform: `translate(${i * 2 * sx * e}px, ${i * 2 * e}px)`,
                ...ctx.fontStyle,
                color: `rgba(8,8,12,${op * fade})`,
              }}
            >
              {ctx.text}
            </span>
          );
        })}
      </DecorBox>
    );
  },
};

/** 背後スポットライト: 上から差す光の中に歌詞が立つ。ステージ・独白 */
export const decorSpotlight: DecorRenderer = {
  layer: (ctx) => {
    const hue = Number(ctx.params.hue ?? 45);
    const intensity = Number(ctx.params.intensity ?? 0.45);
    const spread = Number(ctx.params.spread ?? 1.4);
    const e = decorEnter(ctx, 0.6);
    const t = ctx.frame / ctx.fps;
    // 光のゆらめき: 光軸がゆっくり揺れ、明るさがかすかに揺れる（静止の回避）
    const sway = Math.sin(t * 0.7) * 1.8;
    const flick = 0.94 + 0.06 * Math.sin(t * 3.1 + 1.3);
    const cx = 50 + sway;
    return (
      <DecorBox ctx={ctx}>
        {/* ぼけた光輪: 広く柔らかい光斑 */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: `-${1.6 * spread}em -${1.1 * spread}em`,
            background: `radial-gradient(ellipse 58% 88% at ${cx.toFixed(2)}% 16%, hsla(${hue}, 70%, 80%, ${intensity * 0.75 * e * flick}), hsla(${hue}, 70%, 75%, ${intensity * 0.3 * e * flick}) 45%, transparent 72%)`,
            filter: "blur(8px)",
          }}
        />
        {/* シャープ寄りの芯: 光源直下の明るいビーム */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: `-${1.6 * spread}em -${1.1 * spread}em`,
            background: `radial-gradient(ellipse 28% 68% at ${cx.toFixed(2)}% 10%, hsla(${hue}, 75%, 88%, ${intensity * 0.6 * e * flick}), transparent 62%)`,
            filter: "blur(2px)",
            mixBlendMode: "screen",
          }}
        />
      </DecorBox>
    );
  },
};

/** 光彩リング: 文字の背後で光の輪がゆっくり脈打つ。神聖・クライマックス */
export const decorHaloRing: DecorRenderer = {
  layer: (ctx) => {
    const hue = Number(ctx.params.hue ?? 190);
    const size = Number(ctx.params.size ?? 1.8);
    const pulse = Number(ctx.params.pulse ?? 0.5);
    const e = decorEnter(ctx, 0.5);
    const beat = 1 + Math.sin((ctx.frame / ctx.fps) * 2.4) * pulse * 0.12;
    const c = `hsla(${hue}, 95%, 65%, ${0.85 * e})`;
    return (
      <DecorBox ctx={ctx}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: `${size}em`,
            height: `${size}em`,
            transform: `translate(-50%, -50%) scale(${beat})`,
            border: `3px solid ${c}`,
            borderRadius: "50%",
            boxShadow: `0 0 18px ${c}, inset 0 0 12px hsla(${hue}, 95%, 65%, ${0.3 * e})`,
          }}
        />
      </DecorBox>
    );
  },
};

/** 色収差ふち: 文字の背後に赤/青の残像を敷く。ローファイ・グリッチの気配 */
export const decorChromaEdge: DecorRenderer = {
  layer: (ctx) => {
    const shift = Number(ctx.params.shift ?? 6);
    const op = Number(ctx.params.opacity ?? 0.7);
    const e = decorEnter(ctx, 0.3);
    const copies: Array<[number, string]> = [
      [-shift, `rgba(255,60,90,${op})`],
      [shift, `rgba(60,170,255,${op})`],
    ];
    return (
      <DecorBox ctx={ctx}>
        {copies.map(([dx, color], i) => (
          <span
            key={i}
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              transform: ctx.vertical
                ? `translateY(${dx * e}px)`
                : `translateX(${dx * e}px)`,
              ...ctx.fontStyle,
              color,
            }}
          >
            {ctx.text}
          </span>
        ))}
      </DecorBox>
    );
  },
};
