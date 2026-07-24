import React from "react";
import { Composition, staticFile, AbsoluteFill, Img } from "remotion";
import type { CalculateMetadataFunction } from "remotion";
import { MVComposition, type MVProps } from "./MVComposition";
import { FxPreview, FX_PREVIEW_FRAMES, FX_PREVIEW_FPS } from "./FxPreview";
import { deriveTimeline, toFrames } from "@/lib/sections";
import { emptyProject, textStyleSchema } from "@/lib/schema";
import { LyricLine } from "./lyrics/LyricLine";
import { SectionContentShowcase } from "./Showcase";
import { XP_PORTS } from "./effects/xp/registry";

const calculateMetadata: CalculateMetadataFunction<MVProps> = async ({ props }) => {
  const timeline = deriveTimeline(props.project);
  return {
    durationInFrames: Math.max(30, toFrames(timeline.total, props.project.meta.fps)),
    fps: props.project.meta.fps,
    width: props.project.meta.width,
    height: props.project.meta.height,
  };
};

/** 縦書きテロップの焼きPOC（§3.5.2）: Studio/レンダで目視確認する用 */
const VerticalTextPOC: React.FC = () => {
  const style = textStyleSchema.parse({
    orientation: "vertical",
    font: "shippori-mincho",
    size: 60,
  });
  return (
    <AbsoluteFill style={{ background: "#101018" }}>
      <Img
        src={staticFile("showcase/sample.png")}
        style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }}
      />
      <LyricLine
        text={"触れられない名前が、\n胸をえぐった——縦書き十二字。"}
        anim={{ id: "lyric-fade", params: { inDuration: 0.3 } }}
        textStyle={style}
        durationInFrames={90}
      />
    </AbsoluteFill>
  );
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="MV"
        component={MVComposition}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          project: emptyProject("Studio Preview"),
          projectName: "sample-mv",
          assetBase: "http://localhost:3000",
        }}
        calculateMetadata={calculateMetadata}
      />
      {/* エフェクト図鑑のプレビュー（/effects と EffectPicker のミニプレビューが使う） */}
      <Composition
        id="FxPreview"
        component={FxPreview}
        durationInFrames={FX_PREVIEW_FRAMES}
        fps={FX_PREVIEW_FPS}
        width={640}
        height={360}
        defaultProps={{ effectId: "lyric-fade" }}
      />
      <Composition
        id="VerticalTextPOC"
        component={VerticalTextPOC}
        durationInFrames={90}
        fps={30}
        width={1920}
        height={1080}
      />
      {/* 拡張パック: レジストリから自動登録 (/xp 図鑑と対応) */}
      {XP_PORTS.map((p) => (
        <Composition
          key={p.id}
          id={`xp-${p.id}`}
          component={p.Preview}
          durationInFrames={p.durationInFrames}
          fps={p.fps}
          width={p.width}
          height={p.height}
        />
      ))}
      <Composition
        id="EffectShowcase"
        component={SectionContentShowcase}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ effectId: "light-streaks" }}
      />
    </>
  );
};
