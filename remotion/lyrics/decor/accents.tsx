import React from "react";
import { interpolate, Easing } from "remotion";
import { hashRand } from "../../effects/rand";
import { DecorBox, decorEnter } from "./common";
import type { DecorContext, DecorRenderer } from "./types";

/**
 * あしらい系の装飾。文字の周りに記号・粒子を散らして表情をつける。
 * 注意: DecorBox のラッパーは font-size を継承しない（16px基準になる）ので、
 * グリフや粒子の大きさは ctx.textStyle.size 基準の px で指定する。
 */

const accentColor = (ctx: DecorContext, defaultHue = 55): string => {
  const color = String(ctx.params.color ?? "white");
  const hue = Number(ctx.params.hue ?? defaultHue);
  return color === "color" ? `hsl(${hue}, 90%, 65%)` : "#f5f5f2";
};

/** 引用符: 大きな“ ”が行を挟む。詩・独白・借りてきた言葉 */
export const decorQuotes: DecorRenderer = {
  layer: (ctx) => {
    const size = Number(ctx.params.size ?? 1.3);
    const c = accentColor(ctx, 340);
    const e = decorEnter(ctx, 0.3);
    const common: React.CSSProperties = {
      position: "absolute",
      fontSize: size * ctx.textStyle.size,
      fontFamily: "Georgia, 'Times New Roman', serif",
      fontWeight: 700,
      color: c,
      lineHeight: 1,
      opacity: 0.9 * e,
      textShadow: "0 2px 8px rgba(0,0,0,0.5)",
    };
    const a: React.CSSProperties = ctx.vertical
      ? { top: "-0.55em", right: "-0.35em", transform: `scale(${e})` }
      : { top: "-0.55em", left: "-0.55em", transform: `scale(${e})` };
    const b: React.CSSProperties = ctx.vertical
      ? { bottom: "-0.55em", left: "-0.35em", transform: `scale(${e})` }
      : { bottom: "-0.55em", right: "-0.55em", transform: `scale(${e})` };
    return (
      <DecorBox ctx={ctx} padding="0.3em 0.4em">
        <span aria-hidden style={{ ...common, ...a }}>
          “
        </span>
        <span aria-hidden style={{ ...common, ...b }}>
          ”
        </span>
      </DecorBox>
    );
  },
};

/** キラキラ散らし: 文字の周りで小さな星がまたたく。夢・魔法・ときめき */
export const decorSparkles: DecorRenderer = {
  layer: (ctx) => {
    const count = Math.round(Number(ctx.params.count ?? 12));
    const size = Number(ctx.params.size ?? 0.3);
    const c = accentColor(ctx, 55);
    const enter = decorEnter(ctx, 0.4);
    const spread = ctx.textStyle.size * 0.9;
    return (
      <DecorBox ctx={ctx}>
        <span aria-hidden style={{ position: "absolute", inset: -spread }}>
          {Array.from({ length: count }, (_, i) => {
            const x = hashRand(i, 101) * 100;
            const y = hashRand(i, 103) * 100;
            const phase = hashRand(i, 107) * Math.PI * 2;
            const tw =
              0.35 + 0.65 * (0.5 + 0.5 * Math.sin((ctx.frame / ctx.fps) * 3.2 + phase));
            const s = 0.6 + 0.8 * hashRand(i, 109);
            return (
              <span
                key={i}
                style={{
                  position: "absolute",
                  left: `${x}%`,
                  top: `${y}%`,
                  fontSize: size * s * ctx.textStyle.size,
                  lineHeight: 1,
                  color: c,
                  opacity: tw * enter,
                  transform: `translate(-50%, -50%) rotate(${hashRand(i, 113) * 90}deg)`,
                  textShadow: `0 0 6px ${c}`,
                }}
              >
                ✦
              </span>
            );
          })}
        </span>
      </DecorBox>
    );
  },
};

/** ドット散らし: 色つきの丸がポップに散る。楽しい・跳ねる曲に */
export const decorDots: DecorRenderer = {
  layer: (ctx) => {
    const count = Math.round(Number(ctx.params.count ?? 14));
    const size = Number(ctx.params.size ?? 0.16);
    const hue = Number(ctx.params.hue ?? 320);
    const rainbow = String(ctx.params.palette) === "rainbow";
    const spread = ctx.textStyle.size * 0.8;
    return (
      <DecorBox ctx={ctx}>
        <span aria-hidden style={{ position: "absolute", inset: -spread }}>
          {Array.from({ length: count }, (_, i) => {
            const x = hashRand(i, 121) * 100;
            const y = hashRand(i, 123) * 100;
            const h = rainbow ? Math.round(hashRand(i, 127) * 360) : hue;
            const startF = Math.round(hashRand(i, 129) * 0.5 * ctx.fps);
            const e = interpolate(ctx.frame, [startF, startF + 8], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.back(2.2)),
            });
            const s = 0.6 + 0.8 * hashRand(i, 131);
            return (
              <span
                key={i}
                style={{
                  position: "absolute",
                  left: `${x}%`,
                  top: `${y}%`,
                  width: size * s * ctx.textStyle.size,
                  height: size * s * ctx.textStyle.size,
                  borderRadius: "50%",
                  background: `hsla(${h}, 85%, 62%, 0.9)`,
                  transform: `translate(-50%, -50%) scale(${e})`,
                  boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                }}
              />
            );
          })}
        </span>
      </DecorBox>
    );
  },
};

/** 山括弧強調: ≫ ≪ が両側から迫る。漫画の集中線的なツッコミ・キメ */
export const decorAngleEmphasis: DecorRenderer = {
  layer: (ctx) => {
    const size = Number(ctx.params.size ?? 0.8);
    const c = accentColor(ctx, 0);
    const e = decorEnter(ctx, 0.25);
    // 息づかい: 文字へ向かってわずかに迫り続ける
    const push = Math.sin((ctx.frame / ctx.fps) * 4.5) * 0.08 + 0.08;
    const common: React.CSSProperties = {
      position: "absolute",
      fontSize: size * ctx.textStyle.size,
      fontWeight: 900,
      lineHeight: 1,
      color: c,
      opacity: 0.95 * e,
      textShadow: "0 2px 8px rgba(0,0,0,0.5)",
    };
    const a: React.CSSProperties = ctx.vertical
      ? {
          top: "-0.9em",
          left: "50%",
          transform: `translateX(-50%) translateY(${push}em) rotate(90deg) scale(${e})`,
        }
      : {
          left: "-1.1em",
          top: "50%",
          transform: `translateY(-50%) translateX(${push}em) scale(${e})`,
        };
    const b: React.CSSProperties = ctx.vertical
      ? {
          bottom: "-0.9em",
          left: "50%",
          transform: `translateX(-50%) translateY(${-push}em) rotate(90deg) scale(${e})`,
        }
      : {
          right: "-1.1em",
          top: "50%",
          transform: `translateY(-50%) translateX(${-push}em) scale(${e})`,
        };
    return (
      <DecorBox ctx={ctx} padding={ctx.vertical ? "0.4em 0.1em" : "0.1em 0.4em"}>
        <span aria-hidden style={{ ...common, ...a }}>
          ≫
        </span>
        <span aria-hidden style={{ ...common, ...b }}>
          ≪
        </span>
      </DecorBox>
    );
  },
};

/** 米印・花あしらい: ❋ が両端で咲く。和・レトロ・歌集の飾り */
export const decorFlourish: DecorRenderer = {
  layer: (ctx) => {
    const size = Number(ctx.params.size ?? 0.9);
    const c = accentColor(ctx, 350);
    const spin = String(ctx.params.spin ?? "on") === "on";
    const e = decorEnter(ctx, 0.35);
    const rot = spin ? (ctx.frame / ctx.fps) * 24 : 0;
    const common: React.CSSProperties = {
      position: "absolute",
      fontSize: size * ctx.textStyle.size,
      lineHeight: 1,
      color: c,
      opacity: 0.9 * e,
      textShadow: "0 2px 8px rgba(0,0,0,0.5)",
    };
    const a: React.CSSProperties = ctx.vertical
      ? { top: "-1.1em", left: "50%", transform: `translateX(-50%) rotate(${rot}deg) scale(${e})` }
      : { left: "-1.3em", top: "50%", transform: `translateY(-50%) rotate(${rot}deg) scale(${e})` };
    const b: React.CSSProperties = ctx.vertical
      ? { bottom: "-1.1em", left: "50%", transform: `translateX(-50%) rotate(${-rot}deg) scale(${e})` }
      : { right: "-1.3em", top: "50%", transform: `translateY(-50%) rotate(${-rot}deg) scale(${e})` };
    return (
      <DecorBox ctx={ctx} padding={ctx.vertical ? "0.5em 0.1em" : "0.1em 0.5em"}>
        <span aria-hidden style={{ ...common, ...a }}>
          ❋
        </span>
        <span aria-hidden style={{ ...common, ...b }}>
          ❋
        </span>
      </DecorBox>
    );
  },
};
