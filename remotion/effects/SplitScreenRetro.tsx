import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

const TEMPLATE_FPS = 24;
const INTRO: Array<{ h: number; cy: number } | null> = [
  { h: 0.12, cy: 0.28 },
  null,
  { h: 0.55, cy: 0.72 },
  null,
  null,
  null,
  { h: 0.1, cy: 0.4 },
  null,
];

const NOISE_URI =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2"/><feColorMatrix type="saturate" values="0"/></filter><rect width="240" height="240" filter="url(#n)"/></svg>`,
  );

export interface PanelRect {
  /** 中心x/y・幅・高さ (画面に対する 0〜1 の割合) */
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** デフォルト = 実機プレビューと同じ全幅レターボックス帯 */
const LETTERBOX: PanelRect = { cx: 0.5, cy: 0.5, w: 1, h: 0.45 };

export const SplitScreenRetro: React.FC<{
  rect?: PanelRect;
  durationInFrames: number;
  children: React.ReactNode;
  /** 中身のスローズーム倍率 (終端時)。1で無効 */
  contentZoom?: number;
  /** Modeリグの装飾 (Bad TV走査線・ノイズ・ぼかし背景) を有効化 */
  retro?: boolean;
  delayFrames?: number;
}> = ({
  rect = LETTERBOX,
  durationInFrames,
  children,
  contentZoom = 1.12,
  retro = false,
  delayFrames = 0,
}) => {
  const frame = useCurrentFrame() - delayFrames;
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const tEnd = durationInFrames / fps;
  if (t < 0) return null;

  // ---- 入り/出の振り付け (テンプレのフレーム単位で参照) ----
  const introIdx = Math.floor(t * TEMPLATE_FPS);
  const outroIdx = Math.floor((tEnd - t) * TEMPLATE_FPS); // 終端からの逆算
  let state: { h: number; cy: number; settling: boolean } | null = null;

  if (introIdx < INTRO.length) {
    const s = INTRO[introIdx];
    if (!s) return null;
    state = { ...s, settling: false };
  } else if (outroIdx < INTRO.length) {
    const s = INTRO[outroIdx];
    if (!s) return null;
    state = { ...s, settling: false };
  } else if (outroIdx < 0) {
    return null;
  }

  const settled = state === null;
  const h = (settled ? rect.h : state!.h * (rect.h / LETTERBOX.h)) as number;
  const cy = settled ? rect.cy : state!.cy;
  const w = rect.w;
  const cx = rect.cx;

  const panel: React.CSSProperties = {
    position: "absolute",
    left: (cx - w / 2) * width,
    top: (cy - h / 2) * height,
    width: w * width,
    height: h * height,
    overflow: "hidden",
  };

  // ---- 中身 ----
  // 点滅中: フルフレームを帯の高さに縦潰し (squash)。
  // 確定後: マスク窓 (フルフレームの該当領域を見せる) + スローズーム。
  const zoom = interpolate(t, [0, tEnd], [1, contentZoom]);
  const content: React.CSSProperties = {
    position: "absolute",
    left: -((cx - w / 2) * width),
    top: -((cy - h / 2) * height),
    width,
    height,
    transform: `scale(${zoom})`,
  };

  return (
    <AbsoluteFill>
      {/* retro時のみ: ぼかし背景 (デフォルトは黒ベタ) */}
      {retro && settled && (
        <AbsoluteFill style={{ overflow: "hidden", background: "#000" }}>
          <AbsoluteFill
            style={{
              transform: "scale(1.3, 1.5)",
              filter: "blur(50px) brightness(0.75) saturate(1.1)",
            }}
          >
            {children}
          </AbsoluteFill>
        </AbsoluteFill>
      )}

      <div style={panel}>
        {settled ? (
          <div style={content}>{children}</div>
        ) : (
          // squash: フルフレーム(width×height)を帯サイズに縦圧縮
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width,
              height,
              transform: `scaleY(${h})`,
              transformOrigin: "top left",
            }}
          >
            {children}
          </div>
        )}

        {retro && (
          <>
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "repeating-linear-gradient(0deg, rgba(0,0,0,0.07) 0 2px, transparent 2px 4px)",
                mixBlendMode: "multiply",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage: `url("${NOISE_URI}")`,
                backgroundSize: "240px 240px",
                backgroundPosition: `${(frame % 7) * 37}px ${(frame % 5) * 53}px`,
                opacity: 0.07,
                mixBlendMode: "overlay",
              }}
            />
          </>
        )}
      </div>
    </AbsoluteFill>
  );
};
