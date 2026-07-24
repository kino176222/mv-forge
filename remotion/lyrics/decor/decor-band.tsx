import React from "react";
import { AbsoluteFill, interpolate, Easing } from "remotion";
import { StrokedText } from "../StrokedText";
import type { DecorRenderer } from "./types";

/**
 * 座布団（帯）。形（四角/斜め/1文字タイル）とタイミング（先に敷く/あとから重なる）。
 * tile形状のみ「出方内蔵」の自己完結モード（タイルと文字が一体でポンポン出る）。
 */
export const decorBand: DecorRenderer = {
  standalone: (ctx) => {
    const dp = ctx.params;
    if (String(dp.shape ?? "rect") !== "tile") return null;
    const { frame, fps, text, textStyle, fontStyle, vertical } = ctx;
    const isWhite = String(dp.color) === "white";
    const bandOpacity = Number(dp.opacity ?? 0.8);
    const bg = isWhite
      ? `rgba(245,245,242,${bandOpacity})`
      : `rgba(10,10,12,${bandOpacity})`;
    const follow = String(dp.timing) === "follow";
    const tile = Math.round(textStyle.size * 1.3);
    const chars = [...text].filter((c) => c !== " ");
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div
          style={{ ...ctx.positioned, transform: ctx.baseTranslate, opacity: ctx.exit }}
        >
          {chars.map((ch, i) => {
            const start =
              (follow ? Math.round(0.4 * fps) : 0) + i * 3 + ctx.fxDelayFrames(i);
            const p = interpolate(frame, [start, start + 7], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const e = Easing.out(Easing.cubic)(p);
            // タイルはポンッと軽くオーバーシュートして着地（判子感）
            const pop = Easing.out(Easing.back(1.5))(p);
            // followモード: 文字が先に出て、タイルがあとから滑り込む
            const charE = follow
              ? Easing.out(Easing.cubic)(
                  interpolate(frame, [i * 2, i * 2 + 6], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  }),
                )
              : e;
            return (
              <span
                key={i}
                style={{
                  position: "relative",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: tile,
                  height: tile,
                  margin: vertical ? "2px 0" : "0 2px",
                  verticalAlign: "middle",
                  transform: `scale(${0.7 + 0.3 * Math.max(pop, charE)})${ctx.fxTransform(i)}`,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: bg,
                    opacity: e,
                    // 接地影: タイルが背景から浮く（単一平面の回避）
                    boxShadow: `0 3px 10px rgba(0,0,0,${0.35 * bandOpacity})`,
                  }}
                />
                <span
                  style={{
                    position: "relative",
                    ...fontStyle,
                    lineHeight: 1,
                    color: isWhite ? "#111111" : "#ffffff",
                    opacity: charE,
                  }}
                >
                  {ch}
                </span>
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    );
  },

  // 四角/斜めの座布団: 文字レイヤーの下に敷く独立レイヤー（leadは先、followはあとから重なる）
  layer: (ctx) => {
    const dp = ctx.params;
    const shape = String(dp.shape ?? "rect");
    if (shape === "tile") return null; // tileは standalone が処理
    const { frame, fps, text, textStyle, fontStyle, vertical } = ctx;
    const isWhite = String(dp.color) === "white";
    const bandOpacity = Number(dp.opacity ?? 0.8);
    const bg = isWhite
      ? `rgba(245,245,242,${bandOpacity})`
      : `rgba(10,10,12,${bandOpacity})`;
    const follow = String(dp.timing) === "follow";
    const startF = follow ? Math.round(0.45 * fps) : 0;
    const e = interpolate(frame, [startF, startF + Math.round(0.3 * fps)], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
    });
    const clip =
      shape === "slant" && !vertical
        ? "polygon(2.5% 0, 100% 0, 97.5% 100%, 0 100%)"
        : undefined;
    return (
      <div style={{ ...ctx.positioned, transform: ctx.baseTranslate, opacity: ctx.exit }}>
        <span
          style={{
            position: "relative",
            display: "inline-block",
            padding: vertical ? "0.6em 0.26em" : "0.26em 0.8em",
          }}
        >
          {/* 奥行き: 帯のわずかに外へにじむ残光層（白帯=淡い光輪 / 黒帯=接地影） */}
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: -6,
              background: isWhite
                ? `rgba(245,245,242,${0.3 * bandOpacity})`
                : `rgba(0,0,0,${0.45 * bandOpacity})`,
              clipPath: clip,
              filter: "blur(10px)",
              transform: vertical ? `scaleY(${e})` : `scaleX(${e})`,
              transformOrigin: vertical ? "top center" : "left center",
              opacity: 0.35 * e,
            }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              background: bg,
              clipPath: clip,
              transform: vertical ? `scaleY(${e})` : `scaleX(${e})`,
              transformOrigin: vertical ? "top center" : "left center",
              boxShadow: `0 2px 14px rgba(0,0,0,${0.3 * bandOpacity})`,
            }}
          />
          {/* 面の照り: 上からの光→下端の締まり（フラット塗りの回避。ごく薄く） */}
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.02) 45%, rgba(0,0,0,0.10))",
              clipPath: clip,
              transform: vertical ? `scaleY(${e})` : `scaleX(${e})`,
              transformOrigin: vertical ? "top center" : "left center",
              opacity: e,
            }}
          />
          {/* サイズ取り用の透明文字（実文字は出方レイヤーが描く） */}
          <span style={{ visibility: "hidden" }}>
            <StrokedText text={text} fontStyle={fontStyle} textStyle={textStyle} />
          </span>
        </span>
      </div>
    );
  },
};
