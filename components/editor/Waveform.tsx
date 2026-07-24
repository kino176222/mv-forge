"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "@/lib/store";
import { usePlayback, seekToFrame } from "@/lib/player-bridge";
import { deriveTimeline, lineTime, toFrames } from "@/lib/sections";
import { Button } from "@/components/ui/button";

/**
 * 波形ストリップ（曲の見取り図）。
 * クリックで頭出し。区間の切替点・ビート・再生ヘッドを重ねて表示する。
 * 間奏の切替点打ち ＝「波形を見て、ダブルクリックでマーカー行を打つ」。
 */

/** beats.json v2 ペイロード → store の songStructure。旧形式（拡張なし）は null。 */
export function toSongStructure(d: {
  bpm?: number;
  downbeats?: number[];
  sections?: { start: number; end: number; level: string; kind?: string }[];
}): { bpm?: number; downbeats: number[]; sections: { start: number; end: number; level: string; kind?: string }[] } | null {
  if (!d.downbeats && !d.sections) return null;
  return {
    bpm: d.bpm,
    downbeats: d.downbeats ?? [],
    sections: d.sections ?? [],
  };
}
export const Waveform: React.FC = () => {
  const project = useEditor((s) => s.project);
  const projectName = useEditor((s) => s.projectName);
  const beats = useEditor((s) => s.beats);
  const setBeats = useEditor((s) => s.setBeats);
  const songStructure = useEditor((s) => s.songStructure);
  const setSongStructure = useEditor((s) => s.setSongStructure);
  const addMarkerLine = useEditor((s) => s.addMarkerLine);
  const frame = usePlayback((s) => s.frame);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [duration, setDuration] = useState(0);
  const [detecting, setDetecting] = useState(false);

  const timeline = useMemo(
    () => (project ? deriveTimeline(project) : null),
    [project],
  );

  useEffect(() => {
    if (!project || !projectName) return;
    fetch(
      `/api/waveform?project=${encodeURIComponent(projectName)}&file=${encodeURIComponent(project.meta.songFile)}`,
    )
      .then((r) => r.json())
      .then((d) => {
        if (d.peaks) {
          setPeaks(d.peaks);
          setDuration(d.duration);
        }
      })
      .catch(() => {});
    fetch(`/api/beats?project=${encodeURIComponent(projectName)}`)
      .then((r) => r.json())
      .then((d) => {
        setBeats(d.beats ?? []);
        setSongStructure(toSongStructure(d));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectName, project?.meta.songFile]);

  // 描画（canvasのbacking storeを実寸×DPRに合わせてから描く＝拡大ボケを防ぐ）
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !project || !timeline || duration <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = (canvas.width = Math.round(canvas.clientWidth * dpr));
    const H = (canvas.height = Math.round(canvas.clientHeight * dpr));
    ctx.clearRect(0, 0, W, H);

    // 波形
    ctx.fillStyle = "rgba(140,160,255,0.55)";
    const n = peaks.length;
    for (let i = 0; i < n; i++) {
      const x = (i / n) * W;
      const h = Math.max(2, peaks[i] * H * 0.92);
      ctx.fillRect(x, (H - h) / 2, Math.max(1, W / n - 1), h);
    }

    // ビート（下側の小さなティック）
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    for (const b of beats) {
      const x = (b / duration) * W;
      ctx.fillRect(x, H - 10, 2, 10);
    }

    // 区間の切替点（画像を持つ行）
    for (const line of project.lines) {
      if (line.image === null) continue;
      const x = (lineTime(line) / duration) * W;
      ctx.fillStyle = "rgba(255,200,80,0.9)";
      ctx.fillRect(x, 0, 3, H);
    }

    // 再生ヘッド（動画時間→曲時間へ変換）
    const songSec = frame / timeline.fps - timeline.songStart;
    if (songSec >= 0 && songSec <= duration) {
      const x = (songSec / duration) * W;
      ctx.fillStyle = "rgba(255,80,80,0.98)";
      ctx.fillRect(x - 2, 0, 4, H);
    }
  }, [peaks, beats, project, timeline, frame, duration]);

  // データ/再生ヘッド変化で再描画
  useEffect(() => {
    draw();
  }, [draw]);

  // カラム幅の変化（配置切替・AIペイン開閉・スプリッタ・ウィンドウ）に追従して再描画。
  // これが無いと backing store が古い幅のまま拡大され、切替点の線がボケる。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  const songSecFromEvent = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      return ratio * duration;
    },
    [duration],
  );

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!timeline) return;
    const sec = songSecFromEvent(e);
    seekToFrame(toFrames(timeline.songStart + sec, timeline.fps));
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const sec = songSecFromEvent(e);
    addMarkerLine(Math.round(sec * 100) / 100);
  };

  const detectBeats = async () => {
    if (!project) return;
    setDetecting(true);
    try {
      const res = await fetch("/api/beats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectName, file: project.meta.songFile }),
      });
      const d = await res.json();
      if (d.beats) {
        setBeats(d.beats);
        setSongStructure(toSongStructure(d));
      }
    } finally {
      setDetecting(false);
    }
  };

  // サビ/ブレイク帯（波形の上に薄く重ねる。pointer-events-noneでクリックは canvas へ素通し）
  const bands =
    duration > 0
      ? (songStructure?.sections ?? []).filter((s) => s.kind === "chorus" || s.kind === "break")
      : [];

  return (
    <div className="shrink-0 border-y border-neutral-800 bg-neutral-950 px-2 py-1">
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="h-24 w-full cursor-crosshair"
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          title="クリック=頭出し / ダブルクリック=マーカー行を打つ（間奏の切替点）"
        />
        {/* サビ=薄い琥珀 / ブレイク=薄い青。音の起伏の見取り図 */}
        {bands.map((s, i) => (
          <div
            key={`band-${i}`}
            style={{
              left: `${(s.start / duration) * 100}%`,
              width: `${((s.end - s.start) / duration) * 100}%`,
            }}
            className={`pointer-events-none absolute inset-y-0 ${
              s.kind === "chorus" ? "bg-amber-400/15" : "bg-sky-400/15"
            }`}
            title={s.kind === "chorus" ? "サビ" : "ブレイク"}
          />
        ))}
        {/* BPM バッジ（v2で bpm が取れたときだけ） */}
        {songStructure?.bpm ? (
          <span className="pointer-events-none absolute right-1 top-1 rounded bg-black/50 px-1 font-mono text-[10px] text-neutral-300">
            ♩={Math.round(songStructure.bpm)}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-3 py-1 text-xs text-neutral-400">
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-yellow-400" />
          切替点 ⋮ビート ｜ クリック=頭出し・Wクリック=マーカー・S=再生位置で分割
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs"
            onClick={detectBeats}
            disabled={detecting}
            title="拍・小節頭・サビを実測します。カット切替の磁石（小節頭優先）とAIレコメンドの強弱判断に使われます"
          >
            {detecting ? "検出中…" : beats.length > 0 ? `ビート再検出(${beats.length})` : "ビート検出"}
          </Button>
        </div>
      </div>
    </div>
  );
};
