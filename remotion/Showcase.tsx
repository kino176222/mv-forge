import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { resolveParams, effectById } from "@/lib/effects-meta";
import { CameraEffect } from "./effects/Camera";
import { FilmGrain } from "./effects/FilmGrain";
import { LightStreaks } from "./effects/LightStreaks";
import { LightLeakFx } from "./effects/LightLeakFx";
import { Glitch } from "./effects/Glitch";

/**
 * エフェクト工房（旧 effect-showcase-v2.html の後継）。
 * Remotion Studio でエフェクトを1個ずつ質感調整するためのコンポジション。
 * ここで決めた params の値を lib/effects-meta.ts の default に写す（Q5の新定義）。
 */
export const SectionContentShowcase: React.FC<{ effectId: string }> = ({
  effectId,
}) => {
  const meta = effectById(effectId);
  const p = resolveParams(effectId, undefined);
  const img = (
    <Img
      src={staticFile("showcase/sample.png")}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  );

  let content: React.ReactNode;
  if (meta?.category === "camera" && effectId !== "parallax") {
    content = (
      <CameraEffect instance={{ id: effectId, params: p }} durationInFrames={150}>
        {img}
      </CameraEffect>
    );
  } else if (effectId === "film-grain") {
    content = (
      <>
        {img}
        <FilmGrain intensity={Number(p.intensity)} size={Number(p.size)} />
      </>
    );
  } else if (effectId === "light-streaks") {
    content = (
      <>
        {img}
        <LightStreaks
          speed={Number(p.speed)}
          intensity={Number(p.intensity)}
          angle={Number(p.angle)}
        />
      </>
    );
  } else if (effectId === "light-leak") {
    content = (
      <>
        {img}
        <LightLeakFx
          intensity={Number(p.intensity)}
          hue={Number(p.hue)}
          drift={Number(p.drift)}
        />
      </>
    );
  } else if (effectId === "glitch") {
    content = (
      <Glitch
        intensity={Number(p.intensity)}
        interval={Number(p.interval)}
        rgbShift={Number(p.rgbShift)}
      >
        {img}
      </Glitch>
    );
  } else {
    content = img;
  }

  return <AbsoluteFill style={{ background: "#000" }}>{content}</AbsoluteFill>;
};
