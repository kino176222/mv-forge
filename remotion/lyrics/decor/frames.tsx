import React from "react";
import { interpolate, spring } from "remotion";
import { DecorBox, decorEnter } from "./common";
import type { DecorContext, DecorRenderer } from "./types";

/** フレーム・囲み系の装飾。文字の周囲を枠で囲む */

const frameColor = (ctx: DecorContext, defaultHue = 340): string => {
  const color = String(ctx.params.color ?? "white");
  const hue = Number(ctx.params.hue ?? defaultHue);
  return color === "color" ? `hsl(${hue}, 85%, 60%)` : "#f5f5f2";
};

/** ブラケット: ［ ］が行頭・行末を挟む。字幕・演出指示の記号感 */
export const decorBracket: DecorRenderer = {
  layer: (ctx) => {
    const w = Number(ctx.params.weight ?? 5);
    const size = Number(ctx.params.size ?? 0.7);
    const c = frameColor(ctx);
    const e = decorEnter(ctx, 0.3);
    const arm = `${size}em`;
    const off = "-0.45em";
    const common: React.CSSProperties = {
      position: "absolute",
      width: ctx.vertical ? arm : "0.5em",
      height: ctx.vertical ? "0.5em" : arm,
      borderColor: c,
      borderStyle: "solid",
      opacity: e,
      filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.4))",
    };
    // 縦書きは上下に「⌐ ⌐」、横書きは左右に「［ ］」
    const a: React.CSSProperties = ctx.vertical
      ? { top: off, left: "50%", transform: `translateX(-50%) scale(${e})`, borderWidth: `${w}px 0 0 ${w}px`, height: arm, width: arm }
      : { left: off, top: "50%", transform: `translateY(-50%) scale(${e})`, borderWidth: `${w}px 0 ${w}px ${w}px`, width: "0.35em" };
    const b: React.CSSProperties = ctx.vertical
      ? { bottom: off, left: "50%", transform: `translateX(-50%) scale(${e})`, borderWidth: `0 ${w}px ${w}px 0`, height: arm, width: arm }
      : { right: off, top: "50%", transform: `translateY(-50%) scale(${e})`, borderWidth: `${w}px ${w}px ${w}px 0`, width: "0.35em" };
    return (
      <DecorBox ctx={ctx} padding={ctx.vertical ? "0.5em 0.1em" : "0.1em 0.5em"}>
        <span aria-hidden style={{ ...common, ...a }} />
        <span aria-hidden style={{ ...common, ...b }} />
      </DecorBox>
    );
  },
};

/** ネオン枠: 発光する角丸ボーダー。サイバー・夜の街 */
export const decorNeonFrame: DecorRenderer = {
  layer: (ctx) => {
    const hue = Number(ctx.params.hue ?? 190);
    const th = Number(ctx.params.thickness ?? 2.5);
    const glow = Number(ctx.params.glow ?? 0.7);
    const e = decorEnter(ctx, 0.4);
    const c = `hsl(${hue}, 95%, 62%)`;
    return (
      <DecorBox ctx={ctx} padding={ctx.vertical ? "0.55em 0.3em" : "0.3em 0.7em"}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            border: `${th}px solid ${c}`,
            borderRadius: 10,
            opacity: e,
            boxShadow: `0 0 ${14 * glow}px ${c}, inset 0 0 ${10 * glow}px hsla(${hue}, 95%, 62%, 0.35)`,
          }}
        />
      </DecorBox>
    );
  },
};

/** 破線枠: 点線のボーダー。切り取り線・クラフト感 */
export const decorDashFrame: DecorRenderer = {
  layer: (ctx) => {
    const th = Number(ctx.params.thickness ?? 2.5);
    const c = frameColor(ctx);
    const e = decorEnter(ctx, 0.35);
    return (
      <DecorBox ctx={ctx} padding={ctx.vertical ? "0.55em 0.3em" : "0.3em 0.7em"}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            border: `${th}px dashed ${c}`,
            borderRadius: 6,
            opacity: e,
            filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.4))",
          }}
        />
      </DecorBox>
    );
  },
};

/** コーナーフレーム: 四隅だけのカギ枠。ファインダー・ドキュメンタリー感 */
export const decorCornerFrame: DecorRenderer = {
  layer: (ctx) => {
    const th = Number(ctx.params.thickness ?? 4);
    const size = Number(ctx.params.size ?? 0.65);
    const c = frameColor(ctx, 120);
    const e = decorEnter(ctx, 0.3);
    const arm = `${size}em`;
    const corners: React.CSSProperties[] = [
      { top: 0, left: 0, borderWidth: `${th}px 0 0 ${th}px` },
      { top: 0, right: 0, borderWidth: `${th}px ${th}px 0 0` },
      { bottom: 0, left: 0, borderWidth: `0 0 ${th}px ${th}px` },
      { bottom: 0, right: 0, borderWidth: `0 ${th}px ${th}px 0` },
    ];
    return (
      <DecorBox ctx={ctx} padding={ctx.vertical ? "0.55em 0.3em" : "0.3em 0.7em"}>
        {corners.map((pos, i) => (
          <span
            key={i}
            aria-hidden
            style={{
              position: "absolute",
              width: arm,
              height: arm,
              borderColor: c,
              borderStyle: "solid",
              opacity: e,
              filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.4))",
              ...pos,
            }}
          />
        ))}
      </DecorBox>
    );
  },
};

/** 丸スタンプ枠: 手押しの判子風だ円。認印・青春・部活ノリ */
export const decorStampCircle: DecorRenderer = {
  layer: (ctx) => {
    const hue = Number(ctx.params.hue ?? 5);
    const th = Number(ctx.params.thickness ?? 3.5);
    const rotate = Number(ctx.params.rotate ?? -6);
    const c = `hsla(${hue}, 80%, 55%, 0.9)`;
    // 判子はポンッと押される: springで押し込み→わずかに沈んで戻る反動
    const delayF = Math.round(0.12 * ctx.fps);
    const s = spring({
      frame: ctx.frame - delayF,
      fps: ctx.fps,
      config: { damping: 11, stiffness: 160, mass: 0.7 },
    });
    const vis = interpolate(ctx.frame, [delayF, delayF + 4], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const tf = `rotate(${rotate}deg) scale(${1.3 - 0.3 * s})`;
    return (
      <DecorBox ctx={ctx} padding={ctx.vertical ? "0.7em 0.45em" : "0.45em 0.9em"}>
        {/* インクの滲み: ひと回り太いぼけた同色の輪（押した瞬間ににじむ奥行き） */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: -th,
            border: `${th * 1.8}px solid hsla(${hue}, 80%, 52%, 0.55)`,
            borderRadius: "50%",
            filter: "blur(5px)",
            opacity: 0.4 * vis,
            transform: tf,
          }}
        />
        {/* シャープな芯: 判子の線 */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            border: `${th}px solid ${c}`,
            borderRadius: "50%",
            opacity: vis,
            transform: tf,
            boxShadow: `inset 0 0 6px hsla(${hue}, 80%, 55%, 0.25)`,
          }}
        />
      </DecorBox>
    );
  },
};
