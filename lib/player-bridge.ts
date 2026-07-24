"use client";
import { create } from "zustand";
import type { PlayerRef } from "@remotion/player";

/** Playerへの橋渡し（Undo対象外の再生状態） */
export const playerRef: { current: PlayerRef | null } = { current: null };

interface PlaybackState {
  frame: number;
  playing: boolean;
  setFrame(f: number): void;
  setPlaying(v: boolean): void;
}

export const usePlayback = create<PlaybackState>((set) => ({
  frame: 0,
  playing: false,
  setFrame: (frame) => set({ frame }),
  setPlaying: (playing) => set({ playing }),
}));

export function seekToFrame(frame: number) {
  playerRef.current?.seekTo(Math.max(0, Math.round(frame)));
}

export function togglePlay() {
  playerRef.current?.toggle();
}

// 区間試聴の後始末（多重呼び出し時に前のリスナーを外す）
let rangeCleanup: (() => void) | null = null;

/** 指定フレーム区間だけを頭から再生し、区間末で自動停止する（「この部分だけ試聴」）。
    連打しても前の停止監視は解除して1つだけにする。既存の区間ループとは独立。 */
export function playRange(fromFrame: number, toFrame: number) {
  const p = playerRef.current;
  if (!p) return;
  rangeCleanup?.();
  const from = Math.max(0, Math.round(fromFrame));
  const to = Math.max(from + 1, Math.round(toFrame));
  const onFrame = (e: { detail: { frame: number } }) => {
    if (e.detail.frame >= to) {
      p.pause();
      rangeCleanup?.();
    }
  };
  p.addEventListener("frameupdate", onFrame);
  rangeCleanup = () => {
    p.removeEventListener("frameupdate", onFrame);
    rangeCleanup = null;
  };
  p.seekTo(from);
  p.play();
}
