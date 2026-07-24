"use client";
import React from "react";
import { FxPreview, FX_PREVIEW_FRAMES, FX_PREVIEW_FPS } from "@/remotion/FxPreview";
import { LazyPlayerCard } from "./LazyPlayerCard";

/** 図鑑の1カード分のループプレビュー（遅延化は LazyPlayerCard が担う）。 */
export const FxCard: React.FC<{ effectId: string }> = ({ effectId }) => (
  <LazyPlayerCard
    component={FxPreview as React.FC<Record<string, unknown>>}
    inputProps={{ effectId }}
    durationInFrames={FX_PREVIEW_FRAMES}
    fps={FX_PREVIEW_FPS}
    width={640}
    height={360}
  />
);
