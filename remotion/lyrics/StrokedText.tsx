import React from "react";
import type { TextStyle } from "@/lib/schema";

/** 縁取り2枚重ね（下: ストローク / 上: 本体）。LyricLine と decor 部品の共通部品 */
export const StrokedText: React.FC<{
  text: string;
  fontStyle: React.CSSProperties;
  textStyle: TextStyle;
  extraShadow?: string;
  fillColor?: string;
}> = ({ text, fontStyle, textStyle, extraShadow, fillColor }) => {
  const shadowAlpha = textStyle.shadow;
  const baseShadow = `0 2px ${textStyle.size * 0.18}px rgba(0,0,0,${shadowAlpha}), 0 0 ${textStyle.size * 0.5}px rgba(0,0,0,${shadowAlpha * 0.6})`;
  return (
    <>
      <span
        aria-hidden
        style={{
          ...fontStyle,
          position: "absolute",
          inset: 0,
          color: "transparent",
          WebkitTextStroke: `${textStyle.strokeWidth}px ${textStyle.strokeColor}`,
          textShadow: extraShadow ? `${baseShadow}, ${extraShadow}` : baseShadow,
        }}
      >
        {text}
      </span>
      <span
        style={{
          ...fontStyle,
          position: "relative",
          color: fillColor ?? textStyle.color,
          textShadow: extraShadow,
        }}
      >
        {text}
      </span>
    </>
  );
};
