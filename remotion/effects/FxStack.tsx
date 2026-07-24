import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import type { EffectInstance } from "@/lib/schema";
import { resolveParams } from "@/lib/effects-meta";
import { isXpEffectId, xpPortIdFromEffectId } from "@/lib/xp/bridge";
import {
  XP_OVERLAY_COMPONENTS,
  XP_GENERATOR_COMPONENTS,
} from "./xp/registry-components";
import { FilmGrain } from "./FilmGrain";
import { LightStreaks } from "./LightStreaks";
import { LightLeakFx } from "./LightLeakFx";
import { Glitch } from "./Glitch";
import { Shake, GlitchRGB, GlitchVHS } from "./Wrappers";
import { GlitchBlocks, GlitchSmear, GlitchWave } from "./GlitchExtra";
import { RainDrops } from "./RainDrops";
import { LineSweep } from "./LineSweep";
import { Particles, BokehOrbs, Cinescope } from "./Ambient";
import { OrnateFrame } from "./OrnateFrame";
import { LensFlare, PRESETS as FLARE_PRESETS } from "./LensFlare";
import type { BeatClock } from "./beat";

/* preset slug ("dusk-ember") -> プリセット名 ("Dusk Ember")。effects-meta の enum 値と対応 */
const FLARE_SLUG_TO_NAME = Object.fromEntries(
  Object.keys(FLARE_PRESETS).map((n) => [
    n.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    n,
  ]),
) as Record<string, string>;

/** 上に重ねる型のオーバーレイ（描画順は配列順） */
const LAYER_OVERLAY_IDS = [
  "film-grain",
  "light-streaks",
  "light-leak",
  "lens-flare",
  "line-sweep",
  "rain-drops",
  "particles",
  "bokeh-orbs",
  "ornate-frame", // 額装は他オーバーレイの上に描く
];

/**
 * オーバーレイ適用チェーン（camera・画像・glitch-subject 以外の全エフェクト）。
 * SectionContent（本編）と FxPreview（図鑑）の両方から使い、見た目の同一性を保証する。
 * children には「camera 適用済みの絵」を渡す。
 */
export const FxStack: React.FC<{
  effects: EffectInstance[];
  beatClock?: BeatClock | null;
  children: React.ReactNode;
  /** 背景の静止画URL。渡すと水滴(rain-drops)がGPUで背景を本物のレンズとして屈折する */
  bgSrc?: string;
}> = ({ effects, beatClock, children, bgSrc }) => {
  const { durationInFrames: xpDur } = useVideoConfig();
  const overlays = effects.filter((e) => LAYER_OVERLAY_IDS.includes(e.id));
  const find = (id: string) => effects.find((e) => e.id === id);
  const glitch = find("glitch");
  const glitchRgb = find("glitch-rgb");
  const glitchVhs = find("glitch-vhs");
  const glitchBlocks = find("glitch-blocks");
  const glitchSmear = find("glitch-smear");
  const glitchWave = find("glitch-wave");
  const shake = find("shake");
  const cinescope = find("cinescope");

  let base: React.ReactNode = children;

  if (glitchVhs) {
    const p = resolveParams("glitch-vhs", glitchVhs.params);
    base = (
      <GlitchVHS intensity={Number(p.intensity)} jitter={Number(p.jitter)}>
        {base}
      </GlitchVHS>
    );
  }
  if (glitchWave) {
    const p = resolveParams("glitch-wave", glitchWave.params);
    base = (
      <GlitchWave
        amplitude={Number(p.amplitude)}
        speed={Number(p.speed)}
        wavelength={Number(p.wavelength)}
      >
        {base}
      </GlitchWave>
    );
  }
  if (glitchSmear) {
    const p = resolveParams("glitch-smear", glitchSmear.params);
    base = (
      <GlitchSmear
        amount={Number(p.amount)}
        strength={Number(p.strength)}
        refresh={Number(p.refresh)}
        opacity={Number(p.opacity ?? 0.75)}
        boost={Number(p.boost ?? 1.6)}
      >
        {base}
      </GlitchSmear>
    );
  }
  if (glitchBlocks) {
    const p = resolveParams("glitch-blocks", glitchBlocks.params);
    base = (
      <GlitchBlocks
        intensity={Number(p.intensity)}
        interval={Number(p.interval)}
        blocks={Number(p.blocks)}
      >
        {base}
      </GlitchBlocks>
    );
  }
  if (glitchRgb) {
    const p = resolveParams("glitch-rgb", glitchRgb.params);
    base = (
      <GlitchRGB shift={Number(p.shift)} wobble={Number(p.wobble)}>
        {base}
      </GlitchRGB>
    );
  }
  if (glitch) {
    const p = resolveParams("glitch", glitch.params);
    base = (
      <Glitch
        intensity={Number(p.intensity)}
        interval={Number(p.interval)}
        rgbShift={Number(p.rgbShift)}
      >
        {base}
      </Glitch>
    );
  }
  if (shake) {
    const p = resolveParams("shake", shake.params);
    base = (
      <Shake
        intensity={Number(p.intensity)}
        speed={Number(p.speed)}
        mode={String(p.mode)}
        beatSync={p.beatSync === "beat"}
        beatClock={beatClock}
      >
        {base}
      </Shake>
    );
  }

  const overlayNodes = overlays.map((o, i) => {
    const p = resolveParams(o.id, o.params);
    if (o.id === "film-grain")
      return (
        <FilmGrain key={i} intensity={Number(p.intensity)} size={Number(p.size)} />
      );
    if (o.id === "light-streaks")
      return (
        <LightStreaks
          key={i}
          speed={Number(p.speed)}
          intensity={Number(p.intensity)}
          angle={Number(p.angle)}
        />
      );
    if (o.id === "light-leak")
      return (
        <LightLeakFx
          key={i}
          intensity={Number(p.intensity)}
          hue={Number(p.hue)}
          drift={Number(p.drift)}
        />
      );
    if (o.id === "lens-flare") {
      // 光学系つまみ: 負値=「プリセット値のまま」なので渡さない（LensFlare側でプリセットにフォールバック）
      const opt = (v: unknown) => (Number(v) < 0 ? undefined : Number(v));
      return (
        <LensFlare
          key={i}
          preset={FLARE_SLUG_TO_NAME[String(p.preset)] ?? "Dusk Ember"}
          lightX={Number(p.originX) / 100}
          lightY={Number(p.originY) / 100}
          intensity={Number(p.intensity)}
          anamorphic={opt(p.anamorphic)}
          ghosts={opt(p.ghosts)}
          halo={opt(p.halo)}
          chromatic={opt(p.chromatic)}
          dirt={opt(p.dirt)}
          flicker={opt(p.flicker)}
          motion={p.motion as "none" | "drift" | "sweep" | "path"}
          motionAmount={Number(p.motionAmount) / 100}
          motionSpeed={Number(p.motionSpeed)}
          destX={Number(p.destX) / 100}
          destY={Number(p.destY) / 100}
          bendX={Number(p.bendX) / 100}
          bendY={Number(p.bendY) / 100}
        />
      );
    }
    if (o.id === "line-sweep")
      return (
        <LineSweep
          key={i}
          count={Number(p.count)}
          angle={Number(p.angle)}
          thickness={Number(p.thickness)}
          speed={Number(p.speed)}
          beatSync={p.beatSync === "beat"}
          beatClock={beatClock}
        />
      );
    if (o.id === "rain-drops")
      return (
        <RainDrops
          key={i}
          count={Number(p.count)}
          size={Number(p.size)}
          drip={Number(p.drip)}
          blur={Number(p.blur)}
          refract={Number(p.refract)}
          bright={Number(p.bright)}
          bgSrc={bgSrc}
        />
      );
    if (o.id === "particles")
      return (
        <Particles
          key={i}
          type={String(p.type)}
          count={Number(p.count)}
          size={Number(p.size)}
          speed={Number(p.speed)}
          beatSync={p.beatSync === "beat"}
          beatClock={beatClock}
        />
      );
    if (o.id === "bokeh-orbs")
      return (
        <BokehOrbs
          key={i}
          count={Number(p.count)}
          size={Number(p.size)}
          hue={Number(p.hue)}
          intensity={Number(p.intensity)}
        />
      );
    if (o.id === "ornate-frame")
      return (
        <OrnateFrame
          key={i}
          color={String(p.color)}
          hue={Number(p.hue)}
          margin={Number(p.margin)}
          radius={Number(p.radius)}
          thickness={Number(p.thickness)}
          opacity={Number(p.opacity)}
          corners={String(p.corners)}
        />
      );
    return null;
  });

  let inner: React.ReactNode = (
    <>
      {base}
      {overlayNodes}
    </>
  );

  // 拡張パックオーバーレイ（category=overlay 経由。id解決は lib/xp-bridge → effectById）。
  // 既存 overlayNodes の後・cinescope/Look の前に重ねる。2系統ある:
  //   wrapper型 (children有) = 絵を包んで上に効果を描く   → <Ov>{content}</Ov>
  //   generator型 (children無) = 透明背景の粒子/線/光を上に置く → 兄弟として重ねる
  // durationInFrames は Sequence 相対（区間頭で立ち上がり、以降ホールド）。
  // opacity つまみは v1 では層全体の不透明度に反映（本格的な強さ制御は Phase2）。
  const xpFx = effects.filter((e) => isXpEffectId(e.id));
  for (const e of xpFx) {
    const bare = xpPortIdFromEffectId(e.id);
    const Ov = XP_OVERLAY_COMPONENTS[bare];
    const Gen = XP_GENERATOR_COMPONENTS[bare];
    if (!Ov && !Gen) continue; // 未登録（生成器スキップ分等）は passthrough
    const rp = resolveParams(e.id, e.params);
    const op = Number(rp.opacity) / 100;
    // 基調色の差し替え（対応ポートのみ。空=デザイン既定=渡さない）
    const tint = String(rp.tint ?? "") || undefined;
    if (Ov) {
      const content: React.ReactNode = inner;
      inner =
        op >= 1 ? (
          <Ov durationInFrames={xpDur} tint={tint}>{content}</Ov>
        ) : (
          <AbsoluteFill style={{ opacity: op }}>
            <Ov durationInFrames={xpDur} tint={tint}>{content}</Ov>
          </AbsoluteFill>
        );
    } else if (Gen) {
      const content: React.ReactNode = inner;
      inner = (
        <>
          {content}
          <AbsoluteFill style={op < 1 ? { opacity: op } : undefined}>
            <Gen durationInFrames={xpDur} />
          </AbsoluteFill>
        </>
      );
    }
  }

  // シネスコープは帯がオーバーレイも覆うよう最外殻に置く
  if (cinescope) {
    const p = resolveParams("cinescope", cinescope.params);
    inner = (
      <Cinescope
        ratio={Number(p.ratio)}
        vignette={Number(p.vignette)}
        weave={Number(p.weave)}
      >
        {inner}
      </Cinescope>
    );
  }

  return <AbsoluteFill>{inner}</AbsoluteFill>;
};
