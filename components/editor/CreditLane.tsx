"use client";
import React from "react";
import { Plus, Type } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { TitleCard } from "@/lib/schema";
import { cn } from "@/lib/utils";
import { CreditCardEditor } from "./CreditCardEditor";

/**
 * 🅣 テキストトラック（クレジットレーン）＝映像編集ソフトのタイトルトラック1本。
 * テキストは「トラック上のクリップ」：
 * - チップの位置と長さ＝実際の表示窓（出だし遅れ delay ＋ 表示時間 duration をそのまま描画）
 * - 左端ドラッグ＝出だし（イン点）／右端ドラッグ＝表示終わり（アウト点。区画末に吸着で「次まで」）
 * - 本体ドラッグ＝移動（長さ維持）／クリック＝ポップオーバー編集（スライダーと同じデータ）
 * - 空き区画クリック＝追加
 * データは従来の line.credit / cut.credit（titleCard）のまま＝レンダラー・AI・後方互換に影響なし。
 */

/** 空き区画クリック時の初期カード（アニメOP風の左流し字幕と同じデザイン） */
export const DEFAULT_CREDIT_CARD: TitleCard = {
  xpId: "sub-subtitle-05",
  text: "",
  font: "project",
  scale: 0.62,
  offsetX: -31,
  offsetY: 29,
  delay: 0,
  duration: 0,
  fadeIn: 0,
  fadeOut: 0,
  enterStyle: "fade",
  exitStyle: "fade",
  color: "",
  slotStyles: [],
};

export interface CreditLaneSegment {
  key: string;
  /** 区画の開始（行頭からの秒） */
  startSec: number;
  /** 区画の長さ（秒） */
  durationSec: number;
  title: string;
  credit: TitleCard | null;
  onChange: (card: TitleCard | null) => void;
}

const MIN_CLIP_SEC = 0.2;
/** 区画末へこの距離まで近づけたら「次まで（duration=0）」に吸着 */
const GLUE_SEC = 0.15;

export const CreditLane: React.FC<{
  sectionSec: number;
  segments: CreditLaneSegment[];
  /** ビート吸着（省略時は0.05s丸めのみ） */
  snap?: (sec: number) => number;
}> = ({ sectionSec, segments, snap }) => {
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const laneRef = React.useRef<HTMLDivElement>(null);
  // ドラッグ直後の click でポップオーバーが開かないように抑止
  const draggedRef = React.useRef(false);

  /** ポインタ位置→区画秒（吸着なし。moveモードの掴み位置維持に使う） */
  const toSecRaw = React.useCallback(
    (clientX: number): number => {
      const rect = laneRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * sectionSec;
    },
    [sectionSec],
  );

  const toSec = React.useCallback(
    (clientX: number): number => {
      const raw = toSecRaw(clientX);
      const snapped = snap ? snap(raw) : raw;
      return Math.round(snapped * 100) / 100;
    },
    [toSecRaw, snap],
  );

  /** チップのドラッグ（mode: 左端=in / 右端=out / 本体=move） */
  const startDrag =
    (seg: CreditLaneSegment, mode: "in" | "out" | "move") =>
    (e: React.PointerEvent) => {
      const credit = seg.credit;
      if (!credit) return;
      e.preventDefault();
      e.stopPropagation();
      const pid = e.pointerId;
      const startX = e.clientX;
      const segEnd = seg.startSec + seg.durationSec;
      const origStart = seg.startSec + credit.delay;
      const origEnd = credit.duration > 0 ? origStart + credit.duration : segEnd;
      // move用: 掴んだ位置とイン点の距離。中心スナップだと掴んだ瞬間チップがジャンプする
      const grabOffset = toSecRaw(e.clientX) - origStart;
      let moved = false;

      const onMove = (ev: PointerEvent) => {
        // マルチタッチ・残留リスナー対策: このドラッグを始めた指以外は無視
        if (ev.pointerId !== pid) return;
        if (!moved && Math.abs(ev.clientX - startX) < 4) return;
        moved = true;
        draggedRef.current = true;
        const sec = toSec(ev.clientX);
        if (mode === "in") {
          // イン点: 右端は固定。delayを動かし、durationで右端を守る
          const newStart = Math.min(Math.max(seg.startSec, sec), origEnd - MIN_CLIP_SEC);
          const newDelay = Math.round((newStart - seg.startSec) * 100) / 100;
          const keepEnd = credit.duration > 0 || origEnd < segEnd - GLUE_SEC;
          seg.onChange({
            ...credit,
            delay: newDelay,
            duration: keepEnd
              ? Math.round((origEnd - newStart) * 100) / 100
              : 0,
          });
        } else if (mode === "out") {
          // アウト点: 区画末に近づけたら「次まで」に吸着（duration=0）
          const newEnd = Math.max(sec, origStart + MIN_CLIP_SEC);
          const glued = Math.abs(newEnd - segEnd) < GLUE_SEC;
          seg.onChange({
            ...credit,
            duration: glued ? 0 : Math.round((newEnd - origStart) * 100) / 100,
          });
        } else {
          // 移動: 長さ維持・掴んだ位置基準（吸着はイン点に効かせる＝音ハメの意図と一致）
          const rawStart = toSecRaw(ev.clientX) - grabOffset;
          const snappedStart = snap ? snap(rawStart) : rawStart;
          const newStart = Math.min(
            Math.max(seg.startSec, Math.round(snappedStart * 100) / 100),
            credit.duration > 0 ? sectionSec - MIN_CLIP_SEC : segEnd - MIN_CLIP_SEC,
          );
          seg.onChange({
            ...credit,
            delay: Math.round((newStart - seg.startSec) * 100) / 100,
          });
        }
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pid) return;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        // タッチはスクロール横取りで pointercancel になり pointerup が来ない（リスナー残留対策）
        window.removeEventListener("pointercancel", onUp);
        // click イベントはこの後に発火するので、次のtickで解除
        setTimeout(() => (draggedRef.current = false), 0);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    };

  return (
    <div
      ref={laneRef}
      className="touch-none relative h-7 select-none rounded border border-neutral-800 bg-neutral-950"
    >
      <Type className="pointer-events-none absolute left-1 top-1/2 z-10 size-3 -translate-y-1/2 text-neutral-600" />
      {segments.map((seg) => {
        const credit = seg.credit;
        const segEnd = seg.startSec + seg.durationSec;
        // チップの実表示窓（delay/durationをそのまま描画。表示上は区画内にクランプ）
        const clipStart = credit ? seg.startSec + credit.delay : seg.startSec;
        const clipEnd = credit
          ? credit.duration > 0
            ? Math.min(clipStart + credit.duration, sectionSec)
            : segEnd
          : segEnd;
        const overflow = Boolean(
          credit && credit.duration > 0 && clipStart + credit.duration > sectionSec,
        );
        return (
          <Popover
            key={seg.key}
            open={openKey === seg.key}
            onOpenChange={(o) => {
              if (o && draggedRef.current) return;
              setOpenKey(o ? seg.key : null);
            }}
          >
            {/* 空き地（区画全体）: クリックで追加。チップの下に敷く */}
            <PopoverTrigger asChild>
              <button
                type="button"
                style={{
                  left: `${(seg.startSec / sectionSec) * 100}%`,
                  width: `${(seg.durationSec / sectionSec) * 100}%`,
                }}
                title={credit ? seg.title : `${seg.title}: クリックでテキストを載せる`}
                className={cn(
                  "absolute inset-y-0.5 border-r border-neutral-800 text-left",
                  !credit && "text-neutral-600 hover:bg-neutral-800/60 hover:text-neutral-400",
                )}
              >
                {!credit && (
                  <span className="flex h-full items-center justify-center">
                    <Plus className="size-3" />
                  </span>
                )}
              </button>
            </PopoverTrigger>

            {/* クリップ本体: 位置と長さ＝実際の表示窓。ドラッグで移動、端でイン/アウト */}
            {credit && (
              <div
                style={{
                  left: `${(clipStart / sectionSec) * 100}%`,
                  width: `${(Math.max(clipEnd - clipStart, 0.1) / sectionSec) * 100}%`,
                  // 極小チップ対策: %幅が両端ハンドル（各10px）より細いと本体を掴めなくなる
                  minWidth: 28,
                }}
                className="absolute inset-y-0.5 z-10"
              >
                <div
                  role="button"
                  tabIndex={0}
                  onPointerDown={startDrag(seg, "move")}
                  onClick={() => {
                    if (!draggedRef.current) setOpenKey(seg.key);
                  }}
                  title={`${seg.title}: ${credit.text || "（文字未入力）"}\nドラッグ=移動 / 端=長さ / クリック=編集`}
                  className={cn(
                    "h-full cursor-grab overflow-hidden rounded-sm border text-left active:cursor-grabbing",
                    "border-amber-500/60 bg-amber-500/25 text-amber-100 hover:bg-amber-500/35",
                  )}
                >
                  <span className="block truncate px-2 font-mono text-[10px] leading-6">
                    {credit.text.trim() || "（文字未入力）"}
                    {credit.fadeIn > 0 && " ◖"}
                    {credit.fadeOut > 0 && " ◗"}
                    {overflow && " →"}
                  </span>
                </div>
                {/* イン点ハンドル */}
                <div
                  onPointerDown={startDrag(seg, "in")}
                  className="absolute inset-y-0 -left-1 w-2.5 cursor-ew-resize"
                  title="ドラッグ=出だし（イン点）"
                >
                  <div className="mx-auto h-full w-1 rounded bg-amber-400/90" />
                </div>
                {/* アウト点ハンドル */}
                <div
                  onPointerDown={startDrag(seg, "out")}
                  className="absolute inset-y-0 -right-1 w-2.5 cursor-ew-resize"
                  title="ドラッグ=表示終わり（アウト点）。区画の端まで戻すと「次まで」"
                >
                  <div className="mx-auto h-full w-1 rounded bg-amber-400/90" />
                </div>
              </div>
            )}

            <PopoverContent
              align="start"
              className="max-h-[70vh] w-96 overflow-y-auto p-2"
            >
              <p className="mb-1.5 text-[10px] text-neutral-500">{seg.title}</p>
              <CreditCardEditor
                value={credit ?? null}
                onChange={seg.onChange}
                previewText="CREDIT"
              />
              {!credit && (
                <button
                  type="button"
                  onClick={() => seg.onChange({ ...DEFAULT_CREDIT_CARD })}
                  className="mt-1.5 w-full rounded border border-dashed border-neutral-700 py-1 text-center text-[11px] text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
                >
                  ＋ 標準の字幕デザインでテキストを載せる
                </button>
              )}
            </PopoverContent>
          </Popover>
        );
      })}
    </div>
  );
};
