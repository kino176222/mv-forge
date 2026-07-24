import React, { useId } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { Look } from "@/lib/schema";
import { resolveParams } from "@/lib/effects-meta";
import { scaleLookParams } from "./look-scale";
import { FxStack } from "./FxStack";

/**
 * 全体ルック（映像編集ソフトの調整レイヤー相当）。project.look を絵に一律で被せる。
 * - 色（color-grade / look-aberration）: CSS filter ＋ SVG feColorMatrix。
 *   区間・歌詞など「掛ける範囲」ごとにこのラッパーを通す＝区間の lookOff で外せる。
 * - 質感（film-grain / cinescope / glitch-vhs）: FxStack を流用して絵の上に重ねる。
 *   colorOnly（歌詞用）では色調整だけ掛け、粒子等で文字を汚さない。
 * MVComposition と FxPreview の両方がここを通るので、パネルで見た質感＝本編＝mp4。
 */

/** FxStack に委譲する流用オーバーレイ（look スタック内で使えるもの） */
const LOOK_STACK_OVERLAY_IDS = ["film-grain", "cinescope", "glitch-vhs"];

const near = (v: number, target: number) => Math.abs(v - target) < 1e-4;

/** 色温度・ティント → feColorMatrix の20値（単純なRGBゲイン近似） */
function tempTintMatrix(temperature: number, tint: number): string {
  const t = temperature / 100; // 正=暖色（R↑B↓）
  const n = tint / 100; // 正=マゼンタ寄り（G↓）
  const r = 1 + 0.12 * t;
  const g = 1 - 0.1 * n;
  const b = 1 - 0.12 * t;
  return [
    [r, 0, 0, 0, 0],
    [0, g, 0, 0, 0],
    [0, 0, b, 0, 0],
    [0, 0, 0, 1, 0],
  ]
    .map((row) => row.map((v) => Number(v.toFixed(4))).join(" "))
    .join("  ");
}

/** チャンネル分離用の feColorMatrix 値（R/G/Bの1本だけ残す） */
const CHANNEL_MATRIX: Record<"r" | "g" | "b", string> = {
  r: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0",
  g: "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0",
  b: "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0",
};

/** 遠側フリンジの減光（screen合成なのでRGBを落とせば弱く重なる） */
const DIM_MATRIX = "0.45 0 0 0 0  0 0.45 0 0 0  0 0 0.45 0 0  0 0 0 1 0";

const Vignette: React.FC<{ amount: number; size: number }> = ({ amount, size }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse at center, transparent ${size}%, rgba(0,0,0,${amount.toFixed(3)}) 130%)`,
      pointerEvents: "none",
    }}
  />
);

export const LookLayer: React.FC<{
  look: Look | null | undefined;
  /** 区間の lookOff（この範囲だけルックを外す） */
  off?: boolean;
  /** 歌詞用: 色調整のみ（粒子・ビネット・色収差は掛けない＝文字を汚さない） */
  colorOnly?: boolean;
  children: React.ReactNode;
}> = ({ look, off, colorOnly = false, children }) => {
  // useId は ":" を含む（例 «r1»）ので url(#…) で安全な形に落とす
  const filterId = `lookfx-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!look || off || look.effects.length === 0 || look.intensity <= 0) {
    return <>{children}</>;
  }

  const k = Math.min(1, look.intensity);
  const scaled = look.effects.map((e) => ({
    id: e.id,
    params: scaleLookParams(e.id, resolveParams(e.id, e.params), k),
  }));
  const grade = scaled.find((e) => e.id === "color-grade")?.params;
  const aberrationBase = colorOnly
    ? 0
    : Number(scaled.find((e) => e.id === "look-aberration")?.params.amount ?? 0);
  // 微揺れ: レンズの呼吸。ズレ幅が±10%ほど非線形に揺らぎ、縦にもわずかに漏れる
  const tSec = frame / fps;
  const aberration =
    aberrationBase * (1 + 0.07 * Math.sin(tSec * 1.9) + 0.04 * Math.sin(tSec * 4.3));
  const abDy = aberrationBase * 0.16 * Math.sin(tSec * 2.6);
  const vignette = colorOnly ? null : scaled.find((e) => e.id === "vignette")?.params;
  const overlayFx = colorOnly
    ? []
    : scaled.filter((e) => LOOK_STACK_OVERLAY_IDS.includes(e.id));

  // ---- CSS filter チェーン（中立値のつまみは足さない） ----
  const exposure = Number(grade?.exposure ?? 1);
  const contrast = Number(grade?.contrast ?? 1);
  const saturation = Number(grade?.saturation ?? 1);
  const hue = Number(grade?.hue ?? 0);
  const temperature = Number(grade?.temperature ?? 0);
  const tint = Number(grade?.tint ?? 0);
  const needsSvg = !near(temperature, 0) || !near(tint, 0) || aberrationBase > 0.01;

  const filters: string[] = [];
  if (needsSvg) filters.push(`url(#${filterId})`);
  if (!near(exposure, 1)) filters.push(`brightness(${exposure.toFixed(3)})`);
  if (!near(contrast, 1)) filters.push(`contrast(${contrast.toFixed(3)})`);
  if (!near(saturation, 1)) filters.push(`saturate(${saturation.toFixed(3)})`);
  if (!near(hue, 0)) filters.push(`hue-rotate(${hue.toFixed(1)}deg)`);

  const hasTempTint = !near(temperature, 0) || !near(tint, 0);
  const graphIn = hasTempTint ? "tempd" : "SourceGraphic";
  const vigAmount = Number(vignette?.amount ?? 0);

  const inner = overlayFx.length > 0 ? (
    <FxStack effects={overlayFx}>{children}</FxStack>
  ) : (
    children
  );

  return (
    <AbsoluteFill>
      {needsSvg && (
        <svg aria-hidden style={{ position: "absolute", width: 0, height: 0 }}>
          <defs>
            <filter id={filterId} colorInterpolationFilters="sRGB">
              {hasTempTint && (
                <feColorMatrix
                  in="SourceGraphic"
                  type="matrix"
                  values={tempTintMatrix(temperature, tint)}
                  result="tempd"
                />
              )}
              {aberrationBase > 0.01 ? (
                <>
                  {/* RGBに分けて左右へずらし、screenで戻す＝レンズの色ズレ。
                      G=シャープな芯、R/B=近側フリンジ（薄ぼかし）＋遠側フリンジ
                      （2倍ズレ・大ぼかし・減光）の2層で、にじみに前後の奥行きを出す */}
                  <feColorMatrix in={graphIn} type="matrix" values={CHANNEL_MATRIX.r} result="chR" />
                  <feColorMatrix in={graphIn} type="matrix" values={CHANNEL_MATRIX.g} result="chG" />
                  <feColorMatrix in={graphIn} type="matrix" values={CHANNEL_MATRIX.b} result="chB" />
                  <feOffset in="chR" dx={aberration.toFixed(2)} dy={abDy.toFixed(2)} result="chR2" />
                  <feGaussianBlur in="chR2" stdDeviation={(aberration * 0.28).toFixed(2)} result="chR2b" />
                  <feOffset in="chB" dx={(-aberration).toFixed(2)} dy={(-abDy).toFixed(2)} result="chB2" />
                  <feGaussianBlur in="chB2" stdDeviation={(aberration * 0.28).toFixed(2)} result="chB2b" />
                  <feOffset in="chR" dx={(aberration * 2.1).toFixed(2)} dy={(abDy * 2).toFixed(2)} result="chR3" />
                  <feGaussianBlur in="chR3" stdDeviation={(aberration * 0.85).toFixed(2)} result="chR3b" />
                  <feColorMatrix in="chR3b" type="matrix" values={DIM_MATRIX} result="chR3d" />
                  <feOffset in="chB" dx={(-aberration * 2.1).toFixed(2)} dy={(-abDy * 2).toFixed(2)} result="chB3" />
                  <feGaussianBlur in="chB3" stdDeviation={(aberration * 0.85).toFixed(2)} result="chB3b" />
                  <feColorMatrix in="chB3b" type="matrix" values={DIM_MATRIX} result="chB3d" />
                  <feBlend in="chR2b" in2="chG" mode="screen" result="chRG" />
                  <feBlend in="chRG" in2="chB2b" mode="screen" result="chRGB" />
                  {/* 遠側は lighten（=maxで重なる）: 全面の色被りを起こさず、
                      ズレて露出した縁だけがにじむ */}
                  <feBlend in="chRGB" in2="chR3d" mode="lighten" result="chRGBr" />
                  <feBlend in="chRGBr" in2="chB3d" mode="lighten" />
                </>
              ) : (
                // tempd を最終出力にする（アイデンティティのオフセット）
                <feOffset in={graphIn} dx="0" dy="0" />
              )}
            </filter>
          </defs>
        </svg>
      )}
      <AbsoluteFill style={{ filter: filters.length > 0 ? filters.join(" ") : undefined }}>
        {inner}
      </AbsoluteFill>
      {/* ビネットは色調整の外＝純粋な黒落とし。シネスコ帯の上でも黒同士で干渉しない */}
      {vignette && vigAmount > 0.001 && (
        <Vignette amount={vigAmount} size={Number(vignette.size ?? 55)} />
      )}
    </AbsoluteFill>
  );
};
