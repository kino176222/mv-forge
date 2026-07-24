"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";

/**
 * ビューポートに入ったときだけ Remotion Player をマウントする汎用カード。
 * 図鑑系ページの共通機構（数十個並べても固まらないための遅延化）。
 * FxCard（MV部品図鑑）と XpCard（拡張エフェクト図鑑）が共用する。
 *
 * hoverToPlay=true のときは、待機中は代表フレーム(尺の約45%)で静止し、
 * カーソルを合わせた（またはフォーカスした）ときだけ再生する。
 * 数十枚が一斉に動いて見づらくなるのを防ぐ。
 */
export const LazyPlayerCard: React.FC<{
  component: React.FC<Record<string, unknown>>;
  inputProps?: Record<string, unknown>;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  hoverToPlay?: boolean;
}> = ({
  component,
  inputProps = {},
  durationInFrames,
  fps,
  width,
  height,
  hoverToPlay = false,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const playerRef = useRef<PlayerRef>(null);
  const hoveringRef = useRef(false);
  const [visible, setVisible] = useState(false);
  // 待機時に見せる代表フレーム（尺の約45%地点＝多くの効果でピーク付近）
  const posterFrame = Math.min(
    durationInFrames - 1,
    Math.max(0, Math.floor(durationInFrames * 0.45)),
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const play = useCallback(() => {
    hoveringRef.current = true;
    if (hoverToPlay) playerRef.current?.play();
  }, [hoverToPlay]);

  const stop = useCallback(() => {
    hoveringRef.current = false;
    if (!hoverToPlay) return;
    playerRef.current?.pause();
    playerRef.current?.seekTo(posterFrame);
  }, [hoverToPlay, posterFrame]);

  // Player は initialFrame を渡すと勝手に再生を始めることがある。
  // ホバー中でない限り再生させない番人: play イベントで即座に止める。
  useEffect(() => {
    if (!visible || !hoverToPlay) return;
    const player = playerRef.current;
    if (!player) return;
    const enforceIdle = () => {
      if (!hoveringRef.current) {
        player.pause();
        player.seekTo(posterFrame);
      }
    };
    enforceIdle();
    player.addEventListener("play", enforceIdle);
    return () => player.removeEventListener("play", enforceIdle);
  }, [visible, hoverToPlay, posterFrame]);

  return (
    <div
      ref={ref}
      onMouseEnter={play}
      onMouseLeave={stop}
      onFocus={play}
      onBlur={stop}
      className="relative aspect-video w-full overflow-hidden rounded bg-neutral-950"
    >
      {visible ? (
        <Player
          ref={playerRef}
          component={component}
          inputProps={inputProps}
          durationInFrames={durationInFrames}
          fps={fps}
          compositionWidth={width}
          compositionHeight={height}
          initialFrame={hoverToPlay ? posterFrame : 0}
          style={{ width: "100%", height: "100%" }}
          loop
          autoPlay={!hoverToPlay}
          // プレビューは音声を含まない。音声系を切らないとブラウザの
          // autoplayポリシー（AudioContext）にブロックされ全カードが静止する
          initiallyMuted
          numberOfSharedAudioTags={0}
          controls={false}
          clickToPlay={false}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-[10px] text-neutral-700">
          scroll to preview
        </div>
      )}
      {hoverToPlay && visible && (
        <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded bg-neutral-950/70 px-1.5 py-0.5 text-[9px] font-medium text-neutral-300 backdrop-blur transition-opacity group-hover:opacity-0">
          ▶ hover
        </span>
      )}
    </div>
  );
};
