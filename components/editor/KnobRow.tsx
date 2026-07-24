"use client";
import React from "react";
import { Minus, Plus } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { nudgeValue, parseKnobInput } from "@/lib/knob-math";

/**
 * 数値つまみの共通行: ラベル + −ボタン + スライダー + ＋ボタン + 値（クリックで直接入力）。
 * −/＋は1ステップ、Shift押しながらで10ステップ。
 * EffectPicker の number param と DetailPanel のクレジットつまみで共用。
 */
export const KnobRow: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** 値の表示を差し替える（例: duration 0 → 「行末」） */
  display?: (v: number) => string;
  onChange(v: number): void;
}> = ({ label, value, min, max, step, unit, display, onChange }) => {
  // null=表示モード / string=入力中のドラフト
  const [draft, setDraft] = React.useState<string | null>(null);

  const nudge = (dir: 1 | -1, shift: boolean) =>
    onChange(nudgeValue(value, step, dir, shift ? 10 : 1, min, max));
  const commit = () => {
    if (draft !== null) onChange(parseKnobInput(draft, value, min, max, step));
    setDraft(null);
  };

  const btnCls =
    "flex size-5 shrink-0 items-center justify-center rounded border border-neutral-800 text-neutral-400 transition-colors hover:border-neutral-600 hover:text-neutral-200";

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="w-16 shrink-0 text-neutral-400">{label}</span>
      <button
        type="button"
        className={btnCls}
        title="1ステップ減らす（Shiftで10ステップ）"
        onClick={(e) => nudge(-1, e.shiftKey)}
      >
        <Minus className="size-3" />
      </button>
      <Slider
        className="flex-1"
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
      />
      <button
        type="button"
        className={btnCls}
        title="1ステップ増やす（Shiftで10ステップ）"
        onClick={(e) => nudge(1, e.shiftKey)}
      >
        <Plus className="size-3" />
      </button>
      {draft !== null ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setDraft(null);
          }}
          className="w-14 shrink-0 rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 text-right font-mono text-xs text-neutral-200 focus:outline-none"
        />
      ) : (
        <button
          type="button"
          title="クリックで数値を直接入力"
          onClick={() => setDraft(String(value))}
          className="w-14 shrink-0 cursor-text rounded border border-transparent px-1 py-0.5 text-right font-mono text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-200"
        >
          {display ? display(value) : `${value}${unit ?? ""}`}
        </button>
      )}
    </div>
  );
};
