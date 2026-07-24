import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Img,
  continueRender,
  delayRender,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { hashRand } from "./rand";

/**
 * 深度マップ → data URI（デコード済み）のモジュールキャッシュ。
 * CSSのmask-imageはRemotionのロード待ち対象外＆asset配信がno-cacheのため、
 * URL参照だとスクリーンショット時に間に合わず全面マスクアウトされる。
 * data URI化＋img.decode()待ちで「必ず手元にある」状態にしてから使う。
 */
const maskCache = new Map<string, Promise<string>>();
function loadMaskAsDataUri(src: string): Promise<string> {
  let p = maskCache.get(src);
  if (!p) {
    p = (async () => {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`depth mask fetch failed: ${res.status}`);
      const blob = await res.blob();
      const dataUri = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.onerror = () => reject(new Error("mask read failed"));
        fr.readAsDataURL(blob);
      });
      const img = new Image();
      img.src = dataUri;
      await img.decode();
      return dataUri;
    })();
    maskCache.set(src, p);
    p.catch(() => maskCache.delete(src));
  }
  return p;
}

/**
 * 被写体グリッチ: 深度マップ（明るい=手前）を輝度マスクに使い、
 * キャラクター（手前の被写体）の周りだけを周期的にバグらせる。
 * 背景は無傷なので「この子だけ壊れていく」演出になる。
 * images/<名前>.depth.png が必要（パララックスと同じ下ごしらえ）。
 */
export const GlitchSubject: React.FC<{
  src: string;
  depthSrc: string;
  intensity: number; // 0-1
  interval: number; // 発作間隔(s)
  rgbShift: number; // px
}> = ({ src, depthSrc, intensity, interval, rgbShift }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [maskUri, setMaskUri] = useState<string | null>(null);
  const [handle] = useState(() => delayRender(`depth mask: ${depthSrc}`));
  useEffect(() => {
    let alive = true;
    loadMaskAsDataUri(depthSrc)
      .then((uri) => {
        if (alive) setMaskUri(uri);
      })
      .catch(() => {
        // 深度マップが無い場合は演出をスキップ（レンダリング自体は止めない）
      })
      .finally(() => continueRender(handle));
    return () => {
      alive = false;
    };
  }, [depthSrc, handle]);

  const intervalFrames = Math.max(2, Math.round(interval * fps));
  const burstFrames = Math.max(2, Math.round(0.18 * fps));
  const inBurst = frame % intervalFrames < burstFrames;
  if (!inBurst || !maskUri) return null;

  const cycle = Math.floor(frame / intervalFrames);
  // 一撃→非線形減衰＋フレーム揺らぎ（発作が等強度で点滅しない）
  const burstT = (frame % intervalFrames) / burstFrames;
  const env = Math.pow(1 - burstT, 0.6) * (0.8 + 0.4 * hashRand(frame, 96));
  const slices = 5;
  // 深度マップの明部（=手前の被写体）だけを見せるマスク
  const mask: React.CSSProperties = {
    maskImage: `url(${maskUri})`,
    maskMode: "luminance",
    maskSize: "100% 100%",
  };
  const imgEl = (
    <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
  );

  return (
    <AbsoluteFill style={{ ...mask, pointerEvents: "none" }}>
      {/* 発光フラッシュ: 被写体が光りながら壊れる（芯は下のスライスが持つ光輪層） */}
      <AbsoluteFill
        style={{
          filter: "brightness(1.7) saturate(1.8) blur(6px)",
          opacity: 0.4 * intensity * env,
          mixBlendMode: "screen",
        }}
      >
        {imgEl}
      </AbsoluteFill>
      {/* RGB分離した2枚（キャラの輪郭が赤青にブレる）。にじませて光輪化＋上下の視差 */}
      <AbsoluteFill
        style={{
          transform: `translate(${-rgbShift * intensity * env}px, ${-1.4 * env}px)`,
          filter: "saturate(3) hue-rotate(-55deg) blur(1px)",
          opacity: 0.6,
          mixBlendMode: "screen",
        }}
      >
        {imgEl}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          transform: `translate(${rgbShift * intensity * env}px, ${1.4 * env}px)`,
          filter: "saturate(3) hue-rotate(135deg) blur(1px)",
          opacity: 0.6,
          mixBlendMode: "screen",
        }}
      >
        {imgEl}
      </AbsoluteFill>
      {/* 横スライスのズレ（体が段違いに割れる）。一部は手前に浮く（拡大＋ボケ） */}
      {Array.from({ length: slices }, (_, i) => {
        const top = (i / slices) * 100;
        const dx =
          (hashRand(frame * 7 + cycle, 91 + i) - 0.5) * 110 * intensity * (0.5 + 0.5 * env);
        const near = hashRand(cycle, 97 + i) < 0.4;
        return (
          <AbsoluteFill
            key={i}
            style={{
              clipPath: `inset(${top}% 0 ${100 - top - 100 / slices}% 0)`,
              transform: near
                ? `translateX(${dx}px) scale(${1 + 0.02 * env})`
                : `translateX(${dx}px)`,
              filter: near ? "blur(0.8px) brightness(1.12)" : "contrast(1.06)",
            }}
          >
            {imgEl}
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};
