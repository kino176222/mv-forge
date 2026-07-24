"use client";
import React from "react";
import { computeHoldPlan } from "@/lib/video-plan";
import { cn } from "@/lib/utils";

/**
 * ✂️ 動画トリム（in/out）コントロール。
 * 「5秒のi2vの良い2秒だけ使う」ためのデュアルハンドル。行直付け（Lv.1）と
 * 将来のカット単位（Lv.2）の両方で使えるよう、値はpropsで受けて onChange で返すだけ。
 * プレビューの<video>は [in,out] でループ再生し、切り出し結果を音なしで即確認できる。
 * 表示リタイム値は computeHoldPlan（レンダラーと同じ純関数）なので本番と数値一致する。
 */
export const VideoTrimControls: React.FC<{
  videoUrl: string;
  trimStart: number;
  trimEnd: number | null;
  /** 区間の尺（秒）。自動リタイム表示に使う（不明なら省略可） */
  sectionSec?: number | null;
  onChange(start: number, end: number | null): void;
}> = ({ videoUrl, trimStart, trimEnd, sectionSec = null, onChange }) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const barRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<"in" | "out" | null>(null);
  const [dur, setDur] = React.useState<number | null>(null);

  const start = Math.max(0, trimStart);
  const end = trimEnd ?? dur ?? null;
  const trimmed = start > 0.001 || (dur !== null && end !== null && end < dur - 0.001);

  // [in,out] ループ再生（キーフレーム精度なので±数フレームずれ得る。確定確認はプレビューで）
  React.useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      const e = trimEnd ?? v.duration;
      if (v.currentTime >= e - 0.03 || v.currentTime < start - 0.5) {
        v.currentTime = start;
      }
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [start, trimEnd]);

  const setFromPointer = (e: React.PointerEvent) => {
    const bar = barRef.current;
    if (!bar || dur === null || !dragRef.current) return;
    const r = bar.getBoundingClientRect();
    const sec = Math.min(dur, Math.max(0, ((e.clientX - r.left) / r.width) * dur));
    const minGap = 0.1;
    if (dragRef.current === "in") {
      const newStart = Math.min(sec, (end ?? dur) - minGap);
      onChange(Math.max(0, Math.round(newStart * 100) / 100), trimEnd);
    } else {
      const newEnd = Math.max(sec, start + minGap);
      onChange(start, newEnd >= dur - 0.02 ? null : Math.round(newEnd * 100) / 100);
    }
  };

  const clipSec = dur !== null ? (end ?? dur) - start : null;
  const plan =
    clipSec !== null && sectionSec ? computeHoldPlan(clipSec, sectionSec) : null;

  const pct = (sec: number) => (dur ? `${(sec / dur) * 100}%` : "0%");

  return (
    <div className="space-y-1.5">
      <video
        ref={videoRef}
        src={videoUrl}
        autoPlay
        loop
        muted
        playsInline
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        className="max-h-40 w-full rounded border border-neutral-800 object-contain"
      />
      {/* デュアルハンドルのトリムバー */}
      <div
        ref={barRef}
        className="relative h-6 cursor-col-resize touch-none rounded bg-neutral-900"
        onPointerDown={(e) => {
          if (dur === null) return;
          const r = e.currentTarget.getBoundingClientRect();
          const sec = ((e.clientX - r.left) / r.width) * dur;
          // 近い方のハンドルを掴む
          const dIn = Math.abs(sec - start);
          const dOut = Math.abs(sec - (end ?? dur));
          dragRef.current = dIn <= dOut ? "in" : "out";
          e.currentTarget.setPointerCapture(e.pointerId);
          setFromPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) setFromPointer(e);
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
      >
        {dur !== null && (
          <>
            {/* 使う範囲 */}
            <div
              className="absolute inset-y-0 rounded bg-amber-400/25"
              style={{ left: pct(start), width: pct((end ?? dur) - start) }}
            />
            {/* in/out ハンドル */}
            <div
              className="absolute inset-y-0 w-1 rounded bg-amber-400"
              style={{ left: pct(start) }}
              title={`IN ${start.toFixed(2)}s`}
            />
            <div
              className="absolute inset-y-0 w-1 -translate-x-full rounded bg-amber-400"
              style={{ left: pct(end ?? dur) }}
              title={`OUT ${(end ?? dur).toFixed(2)}s`}
            />
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-neutral-400">
        <button
          type="button"
          className="rounded border border-neutral-700 px-1.5 py-0.5 hover:border-neutral-500"
          onClick={() => {
            const v = videoRef.current;
            if (v) onChange(Math.round(v.currentTime * 100) / 100, trimEnd);
          }}
          title="再生中の現在位置をIN点にする"
        >
          ▶︎をINに
        </button>
        <button
          type="button"
          className="rounded border border-neutral-700 px-1.5 py-0.5 hover:border-neutral-500"
          onClick={() => {
            const v = videoRef.current;
            if (v && dur !== null) {
              const t = Math.round(v.currentTime * 100) / 100;
              onChange(start, t >= dur - 0.02 ? null : Math.max(t, start + 0.1));
            }
          }}
          title="再生中の現在位置をOUT点にする"
        >
          ▶︎をOUTに
        </button>
        <button
          type="button"
          className={cn(
            "rounded border border-neutral-700 px-1.5 py-0.5 hover:border-neutral-500",
            !trimmed && "opacity-40",
          )}
          onClick={() => onChange(0, null)}
          title="トリムを解除して全尺に戻す"
        >
          全尺に戻す
        </button>
        <span className="ml-auto font-mono">
          {dur !== null && clipSec !== null ? (
            <>
              切り出し {clipSec.toFixed(2)}s / 素材 {dur.toFixed(2)}s
              {plan && sectionSec
                ? ` → 区間 ${sectionSec.toFixed(2)}s（自動 ${plan.rate.toFixed(2)}x）`
                : ""}
            </>
          ) : (
            "読み込み中…"
          )}
        </span>
      </div>
    </div>
  );
};
