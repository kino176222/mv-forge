import React from "react";
import { hashRand } from "../../effects/rand";
import { DecorBox, decorEnter } from "./common";
import type { DecorRenderer } from "./types";

/** 座布団・帯系の装飾。すべて文字の下に敷くレイヤー型 */

/** グラデ座布団: 2色のグラデーションが文字方向に流れる帯 */
export const decorBandGrad: DecorRenderer = {
  layer: (ctx) => {
    const hue = Number(ctx.params.hue ?? 280);
    const hue2 = Number(ctx.params.hue2 ?? 340);
    const op = Number(ctx.params.opacity ?? 0.75);
    const e = decorEnter(ctx);
    const t = ctx.frame / ctx.fps;
    const grad = `linear-gradient(${ctx.vertical ? 180 : 90}deg, hsla(${hue}, 80%, 52%, ${op}), hsla(${hue2}, 80%, 52%, ${op}))`;
    const wipe: React.CSSProperties = {
      transform: ctx.vertical ? `scaleY(${e})` : `scaleX(${e})`,
      transformOrigin: ctx.vertical ? "top center" : "left center",
    };
    // 光輪はゆっくり呼吸（発光体の気配。振幅は控えめ）
    const breathe = 0.32 + 0.06 * Math.sin(t * 1.8);
    return (
      <DecorBox ctx={ctx} padding={ctx.vertical ? "0.6em 0.26em" : "0.26em 0.8em"}>
        {/* ぼけた光輪: 帯の外へにじむグラデ残光（奥行き＋加算light感） */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: -8,
            background: grad,
            borderRadius: 12,
            filter: "blur(14px)",
            opacity: breathe * e,
            ...wipe,
          }}
        />
        {/* シャープな芯 */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background: grad,
            borderRadius: 6,
            boxShadow: `0 2px 14px rgba(0,0,0,${0.3 * op})`,
            ...wipe,
          }}
        />
        {/* 面の照り: 上からの光でガラス質に（ごく薄く） */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0.03) 50%, rgba(0,0,0,0.08))",
            borderRadius: 6,
            opacity: e,
            ...wipe,
          }}
        />
      </DecorBox>
    );
  },
};

/** すりガラス: 背景をぼかす半透明パネル。写真の上でも歌詞が読める */
export const decorGlass: DecorRenderer = {
  layer: (ctx) => {
    const blur = Number(ctx.params.blur ?? 12);
    const light = String(ctx.params.tone) === "light";
    const radius = Number(ctx.params.radius ?? 16);
    const e = decorEnter(ctx, 0.4);
    return (
      <DecorBox ctx={ctx} padding={ctx.vertical ? "0.6em 0.3em" : "0.3em 0.9em"}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            backdropFilter: `blur(${blur}px)`,
            WebkitBackdropFilter: `blur(${blur}px)`,
            // 光沢（sheen）: 平坦な背景でもガラスの面が見えるように
            background: light
              ? "linear-gradient(165deg, rgba(255,255,255,0.38), rgba(255,255,255,0.16) 55%, rgba(255,255,255,0.28))"
              : "linear-gradient(165deg, rgba(255,255,255,0.18), rgba(255,255,255,0.05) 55%, rgba(255,255,255,0.12)), linear-gradient(rgba(16,16,24,0.45), rgba(16,16,24,0.45))",
            border: "1px solid rgba(255,255,255,0.35)",
            borderRadius: radius,
            opacity: e,
          }}
        />
      </DecorBox>
    );
  },
};

/** 角丸ピル: カプセル形の座布団。ポップ・キュートな曲に */
export const decorPill: DecorRenderer = {
  layer: (ctx) => {
    const color = String(ctx.params.color ?? "black");
    const hue = Number(ctx.params.hue ?? 220);
    const op = Number(ctx.params.opacity ?? 0.85);
    const bg =
      color === "white"
        ? `rgba(245,245,242,${op})`
        : color === "color"
          ? `hsla(${hue}, 75%, 50%, ${op})`
          : `rgba(10,10,12,${op})`;
    const e = decorEnter(ctx, 0.3);
    return (
      <DecorBox ctx={ctx} padding={ctx.vertical ? "0.9em 0.3em" : "0.3em 1em"}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background: bg,
            borderRadius: 999,
            transform: `scale(${0.8 + 0.2 * e})`,
            opacity: e,
            boxShadow: `0 2px 16px rgba(0,0,0,${0.3 * op})`,
          }}
        />
      </DecorBox>
    );
  },
};

/** ブラシストローク帯: 端がガタついた手塗り風の帯。エモ・手書き感 */
export const decorBrush: DecorRenderer = {
  layer: (ctx) => {
    const color = String(ctx.params.color ?? "color");
    const hue = Number(ctx.params.hue ?? 0);
    const rough = Number(ctx.params.roughness ?? 8);
    const op = Number(ctx.params.opacity ?? 0.85);
    const bg =
      color === "white"
        ? `rgba(245,245,242,${op})`
        : color === "black"
          ? `rgba(12,12,14,${op})`
          : `hsla(${hue}, 70%, 45%, ${op})`;
    // ガタつきエッジ: 決定論的な乱数でポリゴンを作る（毎フレーム同じ形）
    const n = 12;
    const pts: string[] = [];
    if (ctx.vertical) {
      // 縦書き: 左右の辺をギザギザに
      for (let i = 0; i <= n; i++) {
        pts.push(`${rough * hashRand(i, 7)}% ${(i / n) * 100}%`);
      }
      for (let i = n; i >= 0; i--) {
        pts.push(`${100 - rough * hashRand(i, 17)}% ${(i / n) * 100}%`);
      }
    } else {
      // 横書き: 上下の辺をギザギザに
      for (let i = 0; i <= n; i++) {
        pts.push(`${(i / n) * 100}% ${rough * hashRand(i, 7)}%`);
      }
      for (let i = n; i >= 0; i--) {
        pts.push(`${(i / n) * 100}% ${100 - rough * hashRand(i, 17)}%`);
      }
    }
    const e = decorEnter(ctx);
    return (
      <DecorBox ctx={ctx} padding={ctx.vertical ? "0.7em 0.3em" : "0.3em 0.9em"}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background: bg,
            clipPath: `polygon(${pts.join(", ")})`,
            transform: `${ctx.vertical ? `scaleY(${e})` : `scaleX(${e})`}${ctx.vertical ? "" : " rotate(-0.8deg)"}`,
            transformOrigin: ctx.vertical ? "top center" : "left center",
          }}
        />
      </DecorBox>
    );
  },
};

/** 縞テクスチャ帯: ストライプ模様の帯。リズム感・ストリート感 */
export const decorStripe: DecorRenderer = {
  layer: (ctx) => {
    const color = String(ctx.params.color ?? "black");
    const hue = Number(ctx.params.hue ?? 320);
    const w = Number(ctx.params.width ?? 12);
    const op = 0.8;
    const [c1, c2] =
      color === "white"
        ? [`rgba(245,245,242,${op})`, `rgba(215,215,210,${op})`]
        : color === "color"
          ? [`hsla(${hue}, 75%, 48%, ${op})`, `hsla(${hue}, 75%, 34%, ${op})`]
          : [`rgba(12,12,14,${op})`, `rgba(42,42,48,${op})`];
    const e = decorEnter(ctx);
    return (
      <DecorBox ctx={ctx} padding={ctx.vertical ? "0.6em 0.26em" : "0.26em 0.8em"}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background: `repeating-linear-gradient(-45deg, ${c1} 0 ${w}px, ${c2} ${w}px ${w * 2}px)`,
            transform: ctx.vertical ? `scaleY(${e})` : `scaleX(${e})`,
            transformOrigin: ctx.vertical ? "top center" : "left center",
            boxShadow: `0 2px 14px rgba(0,0,0,${0.3 * op})`,
          }}
        />
      </DecorBox>
    );
  },
};
