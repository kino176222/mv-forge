import React from "react";
import { hashRand } from "../../effects/rand";
import { DecorBox, decorEnter } from "./common";
import type { DecorRenderer } from "./types";

/** テープ・ステッカー系の装飾。紙もの・クラフトの手ざわり */

/** マスキングテープ: 半透明テープが両端をとめる。日記・スクラップブック感 */
export const decorTape: DecorRenderer = {
  layer: (ctx) => {
    const hue = Number(ctx.params.hue ?? 45);
    const op = Number(ctx.params.opacity ?? 0.7);
    const angle = Number(ctx.params.angle ?? 45);
    const e = decorEnter(ctx, 0.25, 0.05);
    const tape: React.CSSProperties = {
      position: "absolute",
      width: "1.9em",
      height: "0.62em",
      background: `hsla(${hue}, 75%, 62%, ${op})`,
      boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
      opacity: e,
    };
    // 縦書きは上端と下端、横書きは左上と右下をとめる
    const a: React.CSSProperties = ctx.vertical
      ? { top: "-0.28em", left: "50%", transform: `translateX(-50%) rotate(${angle}deg) scale(${e})` }
      : { top: "-0.28em", left: "-0.7em", transform: `rotate(-${angle}deg) scale(${e})` };
    const b: React.CSSProperties = ctx.vertical
      ? { bottom: "-0.28em", left: "50%", transform: `translateX(-50%) rotate(-${angle}deg) scale(${e})` }
      : { bottom: "-0.28em", right: "-0.7em", transform: `rotate(-${angle}deg) scale(${e})` };
    return (
      <DecorBox ctx={ctx} padding={ctx.vertical ? "0.35em 0.15em" : "0.15em 0.35em"}>
        <span aria-hidden style={{ ...tape, ...a }} />
        <span aria-hidden style={{ ...tape, ...b }} />
      </DecorBox>
    );
  },
};

/** 付箋: パステルの付箋紙。メモ・ひとりごと・かわいい小声 */
export const decorSticky: DecorRenderer = {
  layer: (ctx) => {
    const hue = Number(ctx.params.hue ?? 50);
    const rotate = Number(ctx.params.rotate ?? -2);
    const op = Number(ctx.params.opacity ?? 0.92);
    const e = decorEnter(ctx, 0.3);
    return (
      <DecorBox ctx={ctx} padding={ctx.vertical ? "0.7em 0.35em" : "0.35em 0.8em"}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background: `hsla(${hue}, 90%, 78%, ${op})`,
            transform: `rotate(${rotate}deg) scale(${0.85 + 0.15 * e})`,
            opacity: e,
            boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
            // 右下のめくれ
            clipPath:
              "polygon(0 0, 100% 0, 100% calc(100% - 0.45em), calc(100% - 0.45em) 100%, 0 100%)",
          }}
        />
        <span
          aria-hidden
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            width: "0.45em",
            height: "0.45em",
            background: `hsla(${hue}, 70%, 60%, ${op})`,
            transform: `rotate(${rotate}deg)`,
            opacity: e,
            clipPath: "polygon(0 0, 100% 0, 0 100%)",
          }}
        />
      </DecorBox>
    );
  },
};

/** ラベルタグ: 先端が尖った値札タグ＋穴。名づけ・ハッシュタグ的な一言に */
export const decorLabelTag: DecorRenderer = {
  layer: (ctx) => {
    const hue = Number(ctx.params.hue ?? 20);
    const op = Number(ctx.params.opacity ?? 0.9);
    const e = decorEnter(ctx, 0.3);
    // 横書き: 左端が尖る / 縦書き: 上端が尖る
    const clip = ctx.vertical
      ? "polygon(50% 0, 100% 0.9em, 100% 100%, 0 100%, 0 0.9em)"
      : "polygon(0.9em 0, 100% 0, 100% 100%, 0.9em 100%, 0 50%)";
    const hole: React.CSSProperties = ctx.vertical
      ? { top: "0.55em", left: "50%", transform: "translateX(-50%)" }
      : { left: "0.55em", top: "50%", transform: "translateY(-50%)" };
    return (
      <DecorBox
        ctx={ctx}
        padding={ctx.vertical ? "1.2em 0.3em 0.5em" : "0.3em 0.8em 0.3em 1.3em"}
      >
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background: `hsla(${hue}, 70%, 55%, ${op})`,
            clipPath: clip,
            transform: ctx.vertical ? `scaleY(${e})` : `scaleX(${e})`,
            transformOrigin: ctx.vertical ? "top center" : "left center",
          }}
        />
        <span
          aria-hidden
          style={{
            position: "absolute",
            width: "0.22em",
            height: "0.22em",
            borderRadius: "50%",
            background: "rgba(12,12,16,0.85)",
            opacity: e,
            ...hole,
          }}
        />
      </DecorBox>
    );
  },
};

/** 切り抜き新聞: 破いた紙の上に歌詞が乗る。回想・報道・不穏な告白 */
export const decorNewspaper: DecorRenderer = {
  layer: (ctx) => {
    const rotate = Number(ctx.params.rotate ?? -1.5);
    const aging = Number(ctx.params.aging ?? 0.5);
    const e = decorEnter(ctx, 0.35);
    // 破り取ったギザギザの縁（決定論的乱数、毎フレーム同じ形）
    const n = 16;
    const pts: string[] = [];
    const jag = 4.5;
    if (ctx.vertical) {
      for (let i = 0; i <= n; i++) pts.push(`${jag * hashRand(i, 23)}% ${(i / n) * 100}%`);
      for (let i = n; i >= 0; i--) pts.push(`${100 - jag * hashRand(i, 29)}% ${(i / n) * 100}%`);
    } else {
      for (let i = 0; i <= n; i++) pts.push(`${(i / n) * 100}% ${jag * hashRand(i, 23)}%`);
      for (let i = n; i >= 0; i--) pts.push(`${(i / n) * 100}% ${100 - jag * hashRand(i, 29)}%`);
    }
    // 経年で黄ばむ紙色
    const paper = `hsl(46, ${Math.round(18 + aging * 30)}%, ${Math.round(88 - aging * 8)}%)`;
    return (
      <DecorBox ctx={ctx} padding={ctx.vertical ? "0.7em 0.4em" : "0.4em 0.9em"}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(100deg, ${paper}, hsl(46, ${Math.round(14 + aging * 24)}%, ${Math.round(82 - aging * 8)}%))`,
            clipPath: `polygon(${pts.join(", ")})`,
            transform: `rotate(${rotate}deg)`,
            opacity: e,
            boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
          }}
        />
        {/* 新聞らしい罫線の気配 */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: "12% 6%",
            background: ctx.vertical
              ? "repeating-linear-gradient(90deg, rgba(40,36,30,0.16) 0 1px, transparent 1px 9px)"
              : "repeating-linear-gradient(180deg, rgba(40,36,30,0.16) 0 1px, transparent 1px 9px)",
            clipPath: `polygon(${pts.join(", ")})`,
            transform: `rotate(${rotate}deg)`,
            opacity: e,
          }}
        />
      </DecorBox>
    );
  },
};

/** シール白ふち: ダイカットステッカーの白ふち。ポップ・ストリート */
export const decorStickerWhite: DecorRenderer = {
  layer: (ctx) => {
    const border = Number(ctx.params.border ?? 10);
    const radius = Number(ctx.params.radius ?? 18);
    const op = Number(ctx.params.opacity ?? 0.95);
    const e = decorEnter(ctx, 0.25, 0.05);
    return (
      <DecorBox ctx={ctx} padding={ctx.vertical ? "0.5em 0.24em" : "0.24em 0.6em"}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: -border,
            background: `rgba(250,250,248,${op})`,
            borderRadius: radius + border,
            transform: `scale(${0.85 + 0.15 * e}) rotate(-1deg)`,
            opacity: e,
            boxShadow: "0 5px 16px rgba(0,0,0,0.45)",
          }}
        />
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(24,22,30,0.9)",
            borderRadius: radius,
            transform: `scale(${0.85 + 0.15 * e}) rotate(-1deg)`,
            opacity: e,
          }}
        />
      </DecorBox>
    );
  },
};
