import React from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { Project, ShortText, TextStyle } from "@/lib/schema";
import { resolveShortTextWindow, SHORT_TEXT_BOTTOM_PCT } from "@/lib/shorts";
import { toFrames } from "@/lib/sections";
import { fontById } from "./fonts";
import { StrokedText } from "./lyrics/StrokedText";

/**
 * ショート専用テロップ（掴みコピー/曲名常設/CTA）。
 * applyShortToProject が焼き込んだ project.shortOverlay がある時だけ描画される＝
 * 本編レンダには一切影響しない。歌詞レーンとは独立（向きは常に横書き＝可読性優先）。
 */

const POSITION_META: Record<
  ShortText["position"],
  { sizeMul: number; edge: React.CSSProperties }
> = {
  top: { sizeMul: 1.0, edge: { top: "8%" } },
  topSmall: { sizeMul: 0.45, edge: { top: "3.5%" } },
  // bottom（CTA）はプラットフォームUI帯（キャプション・投稿ボタン）の外に置く
  bottom: { sizeMul: 0.75, edge: { bottom: `${SHORT_TEXT_BOTTOM_PCT}%` } },
};

/** 全角≈1em・半角≈0.6em の見積もりで、長い行は縮めて画面内に収める（LyricLineと同流儀） */
const estLongestEm = (text: string): number => {
  let longest = 0.01;
  for (const line of text.split("\n")) {
    let em = 0;
    for (const ch of line) {
      const cp = ch.codePointAt(0) ?? 0;
      em += (cp < 0x2000 ? 0.6 : 1) + 0.06;
    }
    longest = Math.max(longest, em);
  }
  return longest;
};

const ShortTextItem: React.FC<{ t: ShortText; textStyle: TextStyle }> = ({
  t,
  textStyle,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width } = useVideoConfig();
  const fadeF = Math.max(1, Math.round(0.3 * fps));
  const opacity = interpolate(
    frame,
    [0, fadeF, Math.max(fadeF + 1, durationInFrames - fadeF), durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  // 登場時にわずかに沈み込みから浮き上がる（掴みの視線誘導。常設topSmallは動かさない）
  const rise =
    t.position === "topSmall"
      ? 0
      : interpolate(frame, [0, fadeF], [12, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

  const meta = POSITION_META[t.position];
  const font = fontById(textStyle.font);
  const baseSize = textStyle.size * meta.sizeMul;
  const fontSize = Math.min(baseSize, (width * 0.9) / estLongestEm(t.text));
  const scaled: TextStyle = {
    ...textStyle,
    size: fontSize,
    strokeWidth: Math.max(1, Math.round(textStyle.strokeWidth * meta.sizeMul)),
  };
  const fontStyle: React.CSSProperties = {
    fontFamily: font.family,
    fontWeight: t.position === "top" ? Math.min(900, font.weight + 200) : font.weight,
    fontSize,
    lineHeight: 1.4,
    letterSpacing: "0.06em",
    whiteSpace: "pre",
    textAlign: "center",
  };

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <span
        style={{
          position: "absolute",
          left: "50%",
          ...meta.edge,
          transform: `translateX(-50%) translateY(${rise}px)`,
          display: "inline-block",
        }}
      >
        <StrokedText text={t.text} fontStyle={fontStyle} textStyle={scaled} />
      </span>
    </AbsoluteFill>
  );
};

export const ShortTextsOverlay: React.FC<{
  overlay: NonNullable<Project["shortOverlay"]>;
  textStyle: TextStyle;
}> = ({ overlay, textStyle }) => {
  const { fps } = useVideoConfig();
  const rangeDur = overlay.endSec - overlay.startSec;
  return (
    <>
      {overlay.texts
        .filter((t) => t.text.trim() !== "")
        .map((t) => {
          const win = resolveShortTextWindow(t, rangeDur);
          const fromF = toFrames(overlay.startSec + win.fromSec, fps);
          const durF = Math.max(
            1,
            toFrames(overlay.startSec + win.toSec, fps) - fromF,
          );
          return (
            <Sequence key={t.id} from={fromF} durationInFrames={durF}>
              <ShortTextItem t={t} textStyle={textStyle} />
            </Sequence>
          );
        })}
    </>
  );
};
