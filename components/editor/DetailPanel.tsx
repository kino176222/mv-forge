"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "@/lib/store";
import { deriveSections, deriveTimeline, lineTime, toFrames } from "@/lib/sections";
import { snapToMusic } from "@/lib/beat-snap";
import { playRange, usePlayback } from "@/lib/player-bridge";
import { effectById, effectsByCategory, resolveParams } from "@/lib/effects-meta";
import { xpTextSpecById } from "@/lib/xp/text-specs";
import { supportsXpLineStyles } from "@/lib/xp/line-styles-support";
import { XpTextSlotsForm, XpLineColorRows } from "./XpTextSlotsForm";
import { CreditLane } from "./CreditLane";
import { KnobRow } from "./KnobRow";
import { CutsBlock } from "./CutsBlock";
import { I2V_MODELS, type MotionIdea } from "@/lib/ai-models";
import {
  mergeTextStyle,
  type EffectInstance,
  type LineTextStyle,
  type SlotStyle,
  type TextStyle,
} from "@/lib/schema";
import { FONT_METAS } from "@/lib/fonts-meta";
import { EffectPicker } from "./EffectPicker";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Clapperboard,
  Info,
  Lightbulb,
  Loader2,
  Merge,
  Minus,
  PenLine,
  Plus,
  RotateCcw,
  Scissors,
  SlidersHorizontal,
  Type,
  X,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, formatDurationJa, isVideoFile } from "@/lib/utils";
import { assetUrl } from "@/remotion/asset-url";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { EffectInstance as EffectInstanceType } from "@/lib/schema";

/**
 * 案A: エフェクト1スロット＝1行チップ。名前と主要パラメータを常時一覧でき、
 * クリックするとポップオーバーで既存の編集UI（プレビュー＋つまみ）が開く。
 * 縦積みスライダーでパネルが伸びてスクロール地獄になるのを防ぐ。
 */
const EffectSlotRow: React.FC<{
  label: string;
  value: EffectInstanceType | null;
  noneLabel?: string;
  /** ×＝なしに戻す。渡すと値ありのとき行末にインラインの×を出す（ポップオーバーを開かず一発でクリア） */
  onClear?: () => void;
  clearTitle?: string;
  children: React.ReactNode;
}> = ({ label, value, noneLabel = "なし", onClear, clearTitle = "なしに戻す", children }) => {
  const meta = value ? effectById(value.id) : null;
  const params = value ? resolveParams(value.id, value.params) : {};
  const summary = meta?.params
    .filter((p) => p.type === "number" || p.type === "enum")
    .map((p) => `${params[p.key]}${p.type === "number" ? (p.unit ?? "") : ""}`)
    .join(" · ");
  // ON（効果あり）＝実線＋明るい左バーで浮かせる／空（既定・なし）＝破線で沈める。
  // 左バーは常に2px確保（空は透明）＝どちらもラベル左端が揃う（整列を崩さない）。
  const active = !!value;
  return (
    <div className="flex items-center gap-1">
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex h-8 min-w-0 flex-1 items-center gap-2 rounded border border-l-2 px-2 text-xs transition-colors",
            active
              ? "border-neutral-700 border-l-neutral-300 hover:border-l-neutral-100"
              : "border-dashed border-neutral-800 border-l-transparent hover:border-neutral-600",
          )}
        >
          <span
            className={cn(
              "w-14 shrink-0 text-left",
              active ? "text-neutral-300" : "text-neutral-500",
            )}
          >
            {label}
          </span>
          <span
            className={cn(
              "truncate",
              active ? "text-neutral-100" : "text-neutral-600",
            )}
          >
            {meta?.name ?? noneLabel}
          </span>
          {summary && (
            <span
              className={cn(
                "ml-auto shrink-0 font-mono text-[10px]",
                active ? "text-neutral-400" : "text-neutral-600",
              )}
            >
              {summary}
            </span>
          )}
          <SlidersHorizontal
            className={cn(
              "size-3 shrink-0",
              active ? "text-neutral-500" : "text-neutral-700",
              !summary && "ml-auto",
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="start"
        collisionPadding={12}
        // 大プレビュー付きの効果（フレア等）でつまみが画面外に落ちないよう、ポップオーバー自体をスクロール可能にする
        className="max-h-[calc(100vh-24px)] w-[min(92vw,34rem)] overflow-y-auto border-neutral-800 bg-neutral-950 p-2"
      >
        {children}
      </PopoverContent>
    </Popover>
      {onClear && active && (
        <button
          type="button"
          title={clearTitle}
          onClick={onClear}
          className="flex size-6 shrink-0 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-red-400"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
};

/** 演出の「島」見出し。ヘアライン＋強めのラベルでカテゴリの入口を作る（集合の法則）。
 *  右肩に任意のアクション（＋オーバーレイ等）を対象の島へ近接配置できる。 */
const EffectGroupHeader: React.FC<{
  title: string;
  action?: React.ReactNode;
}> = ({ title, action }) => (
  <div className="mb-1.5 flex items-center gap-2 border-t border-neutral-800 pt-2">
    <span className="text-[11px] font-medium tracking-wide text-neutral-300">
      {title}
    </span>
    <span className="h-px flex-1 bg-neutral-800/60" />
    {action}
  </div>
);

const CAMERA_IDS = ["slow-zoom-in", "slow-zoom-out", "pan", "punch-zoom", "push-in", "parallax"];
// ＋オーバーレイの初期値候補（ネイティブのみ）。行内の分類には使わない：
// effects[] の「カメラ以外＝オーバーレイ」は除外方式で判定する（拡張パック xp-* を取りこぼさないため）
const OVERLAY_IDS = effectsByCategory("overlay").map((e) => e.id);

/** 1文字ぶんの微調整スライダー群 */
type CharFxRowDef = {
  key: "delay" | "dx" | "dy" | "rotate" | "scale";
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
};

/** 文字ごと微調整の1行。−/＋ボタン＋スライダーに加え、Shift+ホイールで刻める。
 *  ReactのwheelはpassiveでpreventDefaultできないため、refでnative listenerを張る。 */
const CharFxRow: React.FC<{
  r: CharFxRowDef;
  value: number;
  onSet: (v: number) => void;
  onNudge: (dir: 1 | -1) => void;
}> = ({ r, value, onSet, onNudge }) => {
  const ref = useRef<HTMLDivElement>(null);
  const nudgeRef = useRef(onNudge);
  useEffect(() => {
    nudgeRef.current = onNudge;
  }, [onNudge]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.shiftKey) return; // Shift押下時だけ値を動かす（通常のパネルスクロールは邪魔しない）
      e.preventDefault();
      const delta =
        Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      nudgeRef.current(delta < 0 ? 1 : -1); // 上/左スクロール=増, 下/右=減
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);
  return (
    <div
      ref={ref}
      className="flex items-center gap-1.5 text-xs"
      title="Shift+ホイールで微調整"
    >
      <span className="w-12 shrink-0 text-neutral-400">{r.label}</span>
      <Button
        size="icon"
        variant="ghost"
        className="size-6 shrink-0 text-neutral-400 hover:text-neutral-100 disabled:opacity-30"
        disabled={value <= r.min}
        onClick={() => onNudge(-1)}
        aria-label={`${r.label}を減らす`}
      >
        <Minus className="size-3.5" />
      </Button>
      <Slider
        className="flex-1"
        min={r.min}
        max={r.max}
        step={r.step}
        value={[value]}
        onValueChange={([v]) => onSet(v)}
      />
      <Button
        size="icon"
        variant="ghost"
        className="size-6 shrink-0 text-neutral-400 hover:text-neutral-100 disabled:opacity-30"
        disabled={value >= r.max}
        onClick={() => onNudge(1)}
        aria-label={`${r.label}を増やす`}
      >
        <Plus className="size-3.5" />
      </Button>
      <span className="w-12 shrink-0 text-right font-mono text-neutral-400">
        {value}
        {r.unit}
      </span>
    </div>
  );
};

const CharFxSliders: React.FC<{ lineIndex: number; charIndex: number }> = ({
  lineIndex,
  charIndex,
}) => {
  const project = useEditor((s) => s.project);
  const mutate = useEditor((s) => s.mutate);
  const line = project?.lines[lineIndex];
  if (!line) return null;
  const fx = line.charFx.find((f) => f.i === charIndex) ?? {
    i: charIndex,
    delay: 0,
    dx: 0,
    dy: 0,
    rotate: 0,
    scale: 1,
  };

  const setFx = (patch: Partial<typeof fx>) =>
    mutate((p) => {
      const l = p.lines[lineIndex];
      const next = { ...fx, ...patch };
      const rest = l.charFx.filter((f) => f.i !== charIndex);
      const isDefault =
        next.delay === 0 && next.dx === 0 && next.dy === 0 && next.rotate === 0 && next.scale === 1;
      l.charFx = isDefault ? rest : [...rest, next].sort((a, b) => a.i - b.i);
    });

  const rows: CharFxRowDef[] = [
    // 遅れは前後どちらも可（−で早め出し・＋で遅らせ）。歌クロックの上に加算される。
    { key: "delay", label: "遅れ", min: -0.5, max: 2, step: 0.05, unit: "s" },
    { key: "dx", label: "X移動", min: -150, max: 150, step: 5, unit: "px" },
    { key: "dy", label: "Y移動", min: -150, max: 150, step: 5, unit: "px" },
    { key: "rotate", label: "回転", min: -180, max: 180, step: 5, unit: "°" },
    { key: "scale", label: "大きさ", min: 0.4, max: 2.5, step: 0.1, unit: "x" },
  ];

  // ＋/−ボタン: step ぶん刻んで min/max にクランプ（浮動小数の桁ノイズも丸める）
  const nudge = (r: (typeof rows)[number], dir: 1 | -1) => {
    const raw = fx[r.key] + dir * r.step;
    const clamped = Math.min(r.max, Math.max(r.min, raw));
    setFx({ [r.key]: Number(clamped.toFixed(4)) });
  };

  return (
    <div className="space-y-1.5 rounded bg-neutral-900/60 p-2">
      <div className="text-[10px] text-neutral-400">
        「{[...line.lyricText][charIndex]}」（{charIndex + 1}文字目）の調整
      </div>
      {rows.map((r) => (
        <CharFxRow
          key={r.key}
          r={r}
          value={fx[r.key]}
          onSet={(v) => setFx({ [r.key]: v })}
          onNudge={(dir) => nudge(r, dir)}
        />
      ))}
      <Button
        size="sm"
        variant="ghost"
        className="h-5 w-full text-[10px] text-neutral-500"
        onClick={() => setFx({ delay: 0, dx: 0, dy: 0, rotate: 0, scale: 1 })}
      >
        この文字をリセット
      </Button>
    </div>
  );
};

/** 🅰️ この行だけテロップ様式を上書き（行単位キネティックタイポ）。
 *  「テロップ様式」(StyleDialog)と同じ項目構成（向き/フォント/サイズ/色/縁/影/位置）を
 *  行スコープで再利用。動かした項目だけが line.textStyle に保存され、
 *  未設定の項目は薄い表示＝全体値（meta.textStyle）にフォールバックする。 */
const LineStyleOverrideBlock: React.FC<{ lineIndex: number }> = ({
  lineIndex,
}) => {
  const project = useEditor((s) => s.project);
  const mutate = useEditor((s) => s.mutate);
  const [open, setOpen] = useState(false);
  const line = project?.lines[lineIndex];
  if (!project || !line) return null;

  const base = project.meta.textStyle;
  const ov: LineTextStyle = line.textStyle ?? {};
  const eff = mergeTextStyle(base, ov);
  const overridden = (k: keyof TextStyle) => ov[k] !== undefined;
  const count = (Object.keys(ov) as (keyof TextStyle)[]).filter(overridden)
    .length;

  const setOv = (key: keyof TextStyle, value: string | number | undefined) =>
    mutate((p) => {
      const next: LineTextStyle = { ...(p.lines[lineIndex].textStyle ?? {}) };
      if (value === undefined) delete next[key];
      else (next as Record<string, string | number>)[key] = value;
      p.lines[lineIndex].textStyle =
        Object.keys(next).length > 0 ? next : undefined;
    });

  const fontLabel = (id: string) =>
    FONT_METAS.find((f) => f.id === id)?.label ??
    (id.startsWith("system:") ? id.slice("system:".length) : id);

  // 上書き中の項目にだけ出る「全体値に戻す」ボタン（未上書きは透明＝整列維持）
  const resetBtn = (k: keyof TextStyle) => (
    <button
      type="button"
      title="全体値に戻す"
      onClick={() => setOv(k, undefined)}
      className={cn(
        "shrink-0 text-neutral-500 transition-colors hover:text-neutral-200",
        !overridden(k) && "pointer-events-none opacity-0",
      )}
    >
      <RotateCcw className="size-3" />
    </button>
  );

  return (
    <div className="rounded border border-neutral-800 p-2">
      <button
        className="flex w-full items-center justify-between text-xs text-neutral-400 hover:text-neutral-200"
        onClick={() => setOpen(!open)}
      >
        <span className="flex items-center gap-1.5">
          <PenLine className="size-3.5" />
          この行だけスタイル上書き
          {count > 0 && `（${count}項目上書き中）`}
        </span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {/* 向き */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="w-16 shrink-0 text-neutral-400">向き</span>
            <Select
              value={ov.orientation ?? "__global__"}
              onValueChange={(v) =>
                setOv("orientation", v === "__global__" ? undefined : v)
              }
            >
              <SelectTrigger
                className={cn(
                  "h-6 min-w-0 flex-1 text-xs",
                  !overridden("orientation") && "text-neutral-500",
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__global__" className="text-xs">
                  全体に従う（
                  {base.orientation === "vertical" ? "縦書き" : "横書き"}）
                </SelectItem>
                <SelectItem value="horizontal" className="text-xs">
                  横書き（下部センター）
                </SelectItem>
                <SelectItem value="vertical" className="text-xs">
                  縦書き（右側・右→左送り）
                </SelectItem>
              </SelectContent>
            </Select>
            {resetBtn("orientation")}
          </div>

          {/* フォント */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="w-16 shrink-0 text-neutral-400">フォント</span>
            <Select
              value={ov.font ?? "__global__"}
              onValueChange={(v) =>
                setOv("font", v === "__global__" ? undefined : v)
              }
            >
              <SelectTrigger
                className={cn(
                  "h-6 min-w-0 flex-1 text-xs",
                  !overridden("font") && "text-neutral-500",
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__global__" className="text-xs">
                  全体に従う（{fontLabel(base.font)}）
                </SelectItem>
                {FONT_METAS.map((f) => (
                  <SelectItem key={f.id} value={f.id} className="text-xs">
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {resetBtn("font")}
          </div>

          {/* 数値つまみ（サイズ/縁取り/影/位置）: StyleDialogと同レンジ */}
          {(
            [
              { key: "size", label: "サイズ", min: 28, max: 120, step: 2, unit: "px" },
              { key: "strokeWidth", label: "縁取り", min: 0, max: 10, step: 1, unit: "px" },
              { key: "shadow", label: "影の濃さ", min: 0, max: 1, step: 0.05, unit: "" },
              {
                key: "posY",
                label: eff.orientation === "vertical" ? "横位置" : "縦位置",
                min: 2,
                max: 92,
                step: 1,
                unit: "%",
              },
            ] as const
          ).map((r) => (
            <div key={r.key} className="flex items-center gap-1.5">
              <div
                className={cn(
                  "min-w-0 flex-1",
                  !overridden(r.key) && "opacity-60",
                )}
              >
                <KnobRow
                  label={r.label}
                  min={r.min}
                  max={r.max}
                  step={r.step}
                  unit={r.unit}
                  value={Number(eff[r.key])}
                  onChange={(v) => setOv(r.key, v)}
                />
              </div>
              {resetBtn(r.key)}
            </div>
          ))}

          {/* 色（文字色/縁色）: StyleDialogと同じカラーピッカー＋HEX入力 */}
          {(
            [
              { key: "color", label: "文字色" },
              { key: "strokeColor", label: "縁色" },
            ] as const
          ).map((r) => (
            <div key={r.key} className="flex items-center gap-1.5 text-xs">
              <span className="w-16 shrink-0 text-neutral-400">{r.label}</span>
              <input
                type="color"
                value={String(eff[r.key])}
                onChange={(e) => setOv(r.key, e.target.value)}
                className={cn(
                  "h-6 w-9 shrink-0 cursor-pointer rounded border border-neutral-800 bg-neutral-900 p-0",
                  !overridden(r.key) && "opacity-60",
                )}
              />
              <input
                type="text"
                value={String(eff[r.key])}
                onChange={(e) => setOv(r.key, e.target.value)}
                className={cn(
                  "min-w-0 flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-0.5 font-mono text-[11px] focus:border-neutral-600 focus:outline-none",
                  overridden(r.key) ? "text-neutral-200" : "text-neutral-500",
                )}
              />
              {resetBtn(r.key)}
            </div>
          ))}

          {count > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-5 w-full text-[10px] text-neutral-500"
              onClick={() =>
                mutate((p) => {
                  p.lines[lineIndex].textStyle = undefined;
                })
              }
            >
              この行の上書きを全て解除（全体の様式に戻す）
            </Button>
          )}
          <p className="text-[10px] text-neutral-600">
            動かした項目だけがこの行の上書きになります。薄い表示＝全体の「テロップ様式」に従う（全体を変えると追従）。
          </p>
        </div>
      )}
    </div>
  );
};

const INTENSITY_LABEL: Record<MotionIdea["intensity"], string> = {
  subtle: "控えめ",
  medium: "普通",
  bold: "大胆",
};

/** 🎬 区間の絵をi2vで動画化するブロック（fal.ai。生成1〜5分）。
 *  mode="regenerate" は既に動画が割り当たっている行での「作り直し」。
 *  mode="extend" は最終コマから続きを生成→セグメントをプレビュー確認→連結。
 *  ジョブは行IDつきでサーバーに残るので、行を離れて戻っても進捗・結果が復元される。 */
const I2vBlock: React.FC<{
  lineIndex: number;
  lineId: string;
  image: string;
  lineText: string;
  mode?: "generate" | "regenerate" | "extend";
  extendOf?: string;
}> = ({ lineIndex, lineId, image, lineText, mode = "generate", extendOf }) => {
  const projectName = useEditor((s) => s.projectName);
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(I2V_MODELS[0].id);
  const [duration, setDuration] = useState<5 | 10>(5);
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<MotionIdea[] | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0); // 生成の経過時間表示
  // 🔍 延長のセグメント（未連結）。プレビューして「採用=連結」or「使わない」を選ぶ
  const [segmentFile, setSegmentFile] = useState<string | null>(null);
  const [concatBusy, setConcatBusy] = useState(false);
  const resumedFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  // 行に戻ってきたとき、進行中/未処理のジョブを復元する（進捗バーが消えない）
  React.useEffect(() => {
    const key = `${lineId}:${mode}`;
    if (resumedFor.current === key) return;
    resumedFor.current = key;
    (async () => {
      try {
        const d = await fetch(
          `/api/jobs?project=${encodeURIComponent(projectName)}`,
        ).then((r) => r.json());
        const jobs = (d.jobs ?? []) as {
          id: string;
          kind: string;
          payload?: {
            status?: string;
            file?: string | null;
            lineId?: string | null;
            extendOf?: string | null;
            startedAt?: number;
          };
        }[];
        // この行×このモードの最新ジョブ
        const mine = jobs
          .filter(
            (j) =>
              j.kind === "i2v" &&
              j.payload?.lineId === lineId &&
              !!j.payload?.extendOf === (mode === "extend"),
          )
          .at(-1);
        if (!mine?.payload) return;
        const st = mine.payload.status;
        if (st === "queued" || st === "generating") {
          setOpen(true);
          setBusy(true);
          setElapsedSec(
            Math.max(0, Math.floor((Date.now() - (mine.payload.startedAt ?? Date.now())) / 1000)),
          );
          pollJob(mine.id);
        } else if (
          st === "done" &&
          mode === "extend" &&
          mine.payload.file?.startsWith("videos/segments/")
        ) {
          // 生成済みだが未連結のセグメント → 確認UIを出す
          setOpen(true);
          setSegmentFile(mine.payload.file);
        }
      } catch {
        /* ジョブ一覧が取れなくても本体機能には影響なし */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineId, mode, projectName]);

  const suggest = async () => {
    setSuggestBusy(true);
    try {
      const d = await fetch("/api/i2v-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectName, image, lineText }),
      }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setIdeas(d.ideas);
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setSuggestBusy(false);
    }
  };

  /** ジョブ完了までポーリング（run直後と、行に戻ってきた時の復帰の両方から呼ぶ） */
  const pollJob = async (jobId: string) => {
    try {
      let misses = 0;
      for (;;) {
        await new Promise((r) => setTimeout(r, 5000));
        let job: { status?: string; file?: string; error?: string };
        try {
          job = await fetch(
            `/api/generate-video?id=${jobId}&project=${encodeURIComponent(projectName)}`,
          ).then((r) => r.json());
        } catch {
          job = {};
        }
        if (job.status === "cancelled" || job.status === "interrupted") {
          toast.info(
            job.status === "cancelled"
              ? "動画化をキャンセルしました"
              : "動画化が中断されました（ジョブ一覧から確認できます）",
          );
          break;
        }
        if (job.status === "done") {
          const assets = await fetch(
            `/api/assets?project=${encodeURIComponent(projectName)}`,
          ).then((r) => r.json());
          if (!assets.error) useEditor.getState().setAssets(assets);
          if (mode === "extend") {
            // 延長: まだ連結しない。セグメントをプレビューして採否を決めてもらう
            setSegmentFile(job.file ?? null);
            toast.success(
              "続きが生成できました — プレビューを確認して「採用（連結）」を押してください",
            );
          } else {
            // 動画を割り当てつつ、生成元の静止画を覚えておく（作り直し・後戻り用）
            useEditor
              .getState()
              .updateLine(lineIndex, { image: job.file ?? null, i2vSource: image });
            toast.success(`動画化完了: ${job.file} — この行に割り当てました`);
          }
          break;
        }
        if (job.status === "error") throw new Error(job.error);
        // ジョブ消失（devサーバー再起動等）で無限ループしない
        if (!job.status || !["queued", "generating"].includes(job.status)) {
          misses += 1;
          if (misses >= 3) {
            throw new Error(
              "ジョブが見つかりません（サーバー再起動の可能性）。完成していれば videos/ に落ちているので素材帯を再読込してください",
            );
          }
        } else {
          misses = 0;
        }
      }
    } catch (e) {
      toast.error(`動画化に失敗: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!prompt.trim()) {
      toast.error("動きの指示を入力してください");
      return;
    }
    setBusy(true);
    setElapsedSec(0);
    setSegmentFile(null);
    try {
      const start = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "extend"
            ? { project: projectName, prompt, model, duration, extendOf, lineId }
            : { project: projectName, image, prompt, model, duration, lineId },
        ),
      }).then((r) => r.json());
      if (start.error) throw new Error(start.error);
      await pollJob(start.id);
    } catch (e) {
      toast.error(`動画化の開始に失敗: ${e instanceof Error ? e.message : e}`);
      setBusy(false);
    }
  };

  /** 🔗 セグメント採用: 親動画と連結して行に割り当て（i2vSourceは維持） */
  const adoptSegment = async () => {
    if (!segmentFile || !extendOf) return;
    setConcatBusy(true);
    try {
      const d = await fetch("/api/concat-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: projectName,
          parent: extendOf,
          segment: segmentFile,
        }),
      }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      const assets = await fetch(
        `/api/assets?project=${encodeURIComponent(projectName)}`,
      ).then((r) => r.json());
      if (!assets.error) useEditor.getState().setAssets(assets);
      useEditor.getState().updateLine(lineIndex, { image: d.file });
      setSegmentFile(null);
      toast.success(`連結完了: ${d.file} — この行に割り当てました`);
    } catch (e) {
      toast.error(`連結に失敗: ${e instanceof Error ? e.message : e}`);
    } finally {
      setConcatBusy(false);
    }
  };

  return (
    <div className="rounded border border-neutral-800 p-2">
      <button
        className="flex w-full items-center justify-between text-xs text-neutral-400 hover:text-neutral-200"
        onClick={() => setOpen(!open)}
      >
        <span className="flex items-center gap-1.5">
          <Clapperboard className="size-3.5" />
          {mode === "extend"
            ? "続きを延長生成（最終コマから連結）"
            : mode === "regenerate"
              ? "動画を作り直す（i2v）"
              : "この絵を動画化（i2v）"}
        </span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <textarea
            className="h-16 w-full rounded-md border border-input bg-transparent p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="動きの指示（例: カメラはゆっくり寄る。髪と光が風に揺れる。表情は変えない）"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy}
          />
          {/* 💡 AIレコメンド: 画像＋歌詞から動きを3案（控えめ/普通/大胆）。元絵が無い延長では出せない */}
          {image !== "" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-full text-xs text-neutral-400"
            disabled={busy || suggestBusy}
            onClick={suggest}
          >
            {suggestBusy ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                AIがこの絵を見て考え中…（目安1分）
              </>
            ) : (
              <>
                <Lightbulb className="size-3" /> AIにおすすめの動きを聞く
              </>
            )}
          </Button>
          )}
          {ideas && (
            <div className="space-y-1">
              {ideas.map((idea, i) => (
                <button
                  key={i}
                  className={cn(
                    "w-full rounded border p-1.5 text-left text-[11px] transition-colors",
                    prompt === idea.prompt
                      ? "border-primary bg-primary/15"
                      : "border-neutral-800 hover:border-neutral-600",
                  )}
                  disabled={busy}
                  onClick={() => setPrompt(idea.prompt)}
                >
                  <div className="flex items-center gap-1.5 text-neutral-200">
                    <span className="rounded bg-neutral-800 px-1 text-[9px] text-neutral-400">
                      {INTENSITY_LABEL[idea.intensity] ?? idea.intensity}
                    </span>
                    {idea.label}
                  </div>
                  <div className="mt-0.5 text-neutral-500">{idea.reason}</div>
                </button>
              ))}
              <p className="text-[10px] text-neutral-600">
                クリックで採用（上の欄に入ります。手直しOK）
              </p>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Select value={model} onValueChange={setModel} disabled={busy}>
              <SelectTrigger className="h-7 flex-1 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {I2V_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(duration)}
              onValueChange={(v) => setDuration(v === "10" ? 10 : 5)}
              disabled={busy}
            >
              <SelectTrigger className="h-7 w-20 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5" className="text-xs">5秒</SelectItem>
                <SelectItem value="10" className="text-xs">10秒</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-full text-xs"
            disabled={busy}
            onClick={run}
          >
            {busy ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                生成中… 経過{formatDurationJa(elapsedSec)}
                （目安1〜5分。完了でこの行に自動割り当て）
              </>
            ) : mode === "extend" ? (
              "続きを生成して連結する"
            ) : mode === "regenerate" ? (
              "作り直す（新しい動画に差し替え）"
            ) : (
              "動画を生成する"
            )}
          </Button>
          {busy && (
            <div className="h-1 w-full overflow-hidden rounded bg-neutral-800">
              <div className="h-full w-1/3 animate-[i2v-slide_1.6s_ease-in-out_infinite] rounded bg-primary/70" />
              <style>{`@keyframes i2v-slide { 0% { margin-left: -33% } 100% { margin-left: 100% } }`}</style>
            </div>
          )}
          {/* 🔍 生成済みセグメントの確認: 見てから連結を決める（課金済み・何度でも見られる） */}
          {mode === "extend" && segmentFile && (
            <div className="space-y-1.5 rounded border border-sky-900 bg-sky-950/30 p-2">
              <div className="text-[11px] text-sky-300">
                続き（未連結）のプレビュー — 気に入ったら採用してください
              </div>
              <video
                key={segmentFile}
                src={assetUrl("", projectName, segmentFile)}
                controls
                autoPlay
                loop
                muted
                playsInline
                className="max-h-40 w-full rounded object-contain"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="h-7 flex-1 text-xs"
                  disabled={concatBusy}
                  onClick={adoptSegment}
                >
                  {concatBusy ? (
                    <>
                      <Loader2 className="size-3 animate-spin" /> 連結中…
                    </>
                  ) : (
                    "採用する（連結してこの行に割り当て）"
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-neutral-400"
                  disabled={concatBusy}
                  onClick={() => setSegmentFile(null)}
                  title="ファイルは videos/segments/ に残ります（課金済みなので消しません）"
                >
                  使わない
                </Button>
              </div>
            </div>
          )}
          <p className="text-[10px] text-neutral-600">
            {mode === "extend"
              ? "最終コマを元絵に続きを生成し、自動で1本に連結します（継ぎ目は同一画＝シームレス）。世代を重ねると画が少しずつ流れるので2〜3回までが目安。"
              : "区間に合わせて自動でリタイム（尺を伸縮）し、1本の連続した動きとして敷きます。音声は使いません（曲が主役）。"}
          </p>
        </div>
      )}
    </div>
  );
};

/** 🧑 動画→キャラ透過クリップ化（BiRefNet毎フレーム切り抜き＋時間安定化）。
 *  切り抜きは分オーダーなので detached ジョブ→status.jsonをポーリング。
 *  ここは①素材化のみ。合成（キャラレイヤー）は別途。 */
const SubjectVideoBlock: React.FC<{ projectName: string; video: string }> = ({
  projectName,
  video,
}) => {
  const [model, setModel] = useState<"lite" | "full">("lite");
  const [stabilize, setStabilize] = useState(3);
  const [keyEvery, setKeyEvery] = useState(1);
  const [status, setStatus] = useState<{
    state?: string; stage?: string; done?: number; total?: number; error?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = React.useCallback(async () => {
    // no-store 必須: これが無いとブラウザが status GET をキャッシュして 0% で固まる
    const s = await fetch(
      `/api/subject-video?project=${encodeURIComponent(projectName)}&video=${encodeURIComponent(video)}`,
      { cache: "no-store" },
    ).then((r) => r.json());
    setStatus(s);
    if (s.state === "done" || s.state === "error") {
      setBusy(false);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
  }, [projectName, video]);

  React.useEffect(() => {
    // 初回に現在の状態を取得。進行中ならポーリングを自動再開（リロード/行移動後も復帰）。
    // setStateは await 後なのでエフェクト同期更新にはならない。
    let alive = true;
    (async () => {
      const s = await fetch(
        `/api/subject-video?project=${encodeURIComponent(projectName)}&video=${encodeURIComponent(video)}`,
        { cache: "no-store" },
      ).then((r) => r.json());
      if (!alive) return;
      setStatus(s);
      if (s.state === "running" && !pollRef.current) {
        pollRef.current = setInterval(poll, 2000);
      }
    })();
    return () => {
      alive = false;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [projectName, video, poll]);

  const start = async () => {
    setBusy(true);
    await fetch("/api/subject-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: projectName, video, model, stabilize, keyEvery }),
    });
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(poll, 2000);
  };

  const done = status?.state === "done";
  const running = busy || status?.state === "running";
  const pct = status?.total ? Math.round(((status.done ?? 0) / status.total) * 100) : 0;

  return (
    <div className="space-y-1.5 rounded border border-neutral-800 p-2">
      <div className="flex items-center gap-2 text-xs text-neutral-300">
        <Scissors className="size-3.5 text-emerald-400" />
        この動画からキャラを抜く
        {done && <span className="ml-auto text-[11px] text-emerald-400">✓ 抜き済み</span>}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-neutral-400">
        <span>精度</span>
        <Select value={model} onValueChange={(v) => setModel(v as "lite" | "full")}>
          <SelectTrigger className="h-6 w-28 text-[11px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="lite">lite（速い）</SelectItem>
            <SelectItem value="full">フル（キレイ・重い）</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-1">安定化</span>
        <Select value={String(stabilize)} onValueChange={(v) => setStabilize(Number(v))}>
          <SelectTrigger className="h-6 w-16 text-[11px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">なし</SelectItem>
            <SelectItem value="3">標準</SelectItem>
            <SelectItem value="5">強</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-neutral-400">
        <span>速度</span>
        <Select value={String(keyEvery)} onValueChange={(v) => setKeyEvery(Number(v))}>
          <SelectTrigger className="h-6 w-40 text-[11px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">高品質（等倍・全コマ）</SelectItem>
            <SelectItem value="2">2倍速（間引き補間）</SelectItem>
            <SelectItem value="3">3倍速（間引き補間）</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {running ? (
        <div className="flex items-center gap-2 text-[11px] text-sky-300">
          <Loader2 className="size-3 animate-spin" />
          {status?.stage ?? "起動中"}…{" "}
          {status?.total ? `${status.done}/${status.total}（${pct}%）` : ""}
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="h-6 w-full text-xs"
          onClick={start}
        >
          {done ? "抜き直す" : "キャラを抜く（数分〜）"}
        </Button>
      )}
      {status?.state === "error" && (
        <div className="text-[11px] text-red-400">
          失敗: {String(status.error).slice(0, 120)}
        </div>
      )}
    </div>
  );
};

/** 中央下: 選択中の行（＝シーン）の詳細設定 */
export const DetailPanel: React.FC = () => {
  const project = useEditor((s) => s.project);
  const projectName = useEditor((s) => s.projectName);
  const assets = useEditor((s) => s.assets);
  const selected = useEditor((s) => s.selectedLine);
  const updateLine = useEditor((s) => s.updateLine);
  const setLineOffsetSnapped = useEditor((s) => s.setLineOffsetSnapped);
  const adoptSuggestion = useEditor((s) => s.adoptSuggestion);
  const removeLine = useEditor((s) => s.removeLine);
  const splitLine = useEditor((s) => s.splitLine);
  const mergeLine = useEditor((s) => s.mergeLine);
  const beats = useEditor((s) => s.beats);
  const songStructure = useEditor((s) => s.songStructure);
  const [depthBusy, setDepthBusy] = useState(false);
  const [subjectBusy, setSubjectBusy] = useState(false);
  const [charIdx, setCharIdx] = useState<number | null>(null);
  const [showCharFx, setShowCharFx] = useState(false);

  const timeline = useMemo(
    () => (project ? deriveTimeline(project) : null),
    [project],
  );
  const sections = useMemo(
    () =>
      project && timeline
        ? deriveSections(project.lines, timeline.songDuration)
        : [],
    [project, timeline],
  );

  // 🔊 この区間だけ試聴: 区間頭から再生し、区間末で自動停止（音ハメ確認用）
  const auditionSection = () => {
    if (!project || !timeline) return;
    const sec = sections.find((s) => s.lineIndexes.includes(selected));
    if (!sec) return;
    const fps = project.meta.fps;
    playRange(
      toFrames(timeline.songStart + sec.start, fps),
      toFrames(timeline.songStart + sec.end, fps),
    );
  };

  if (!project || !project.lines[selected]) {
    return (
      <div className="p-4 text-sm text-neutral-500">
        行を選択すると、ここで演出を調整できます。
      </div>
    );
  }

  const line = project.lines[selected];
  const isHead = sections.some((s) => s.headLineIndex === selected);
  const camera = line.effects.find((e) => CAMERA_IDS.includes(e.id)) ?? null;
  // オーバーレイ＝「カメラ以外の全部」（除外方式）。包含リスト方式だと
  // 拡張ブリッジ効果（xp-*。AI提案採用やピッカーで入る）が編集行から漏れて
  // 「表示は残るのに変更・削除できない」＋setOverlayの再構築で無言消去が起きる。
  const overlays = line.effects.filter((e) => !CAMERA_IDS.includes(e.id));
  const suggestion = line.aiSuggestion;
  const imageAsset = assets.images.find((img) => img.file === line.image);
  const lineIsVideo = !!line.image && isVideoFile(line.image);
  // i2vで(再)生成するときの元静止画。動画行なら覚えた i2vSource、静止画行ならその絵。
  const i2vSourceImage = lineIsVideo ? line.i2vSource : line.image;
  // エフェクトプレビューに使う実素材（動画行はポスター静止画で代用。無ければサンプル）
  const previewImageUrl = i2vSourceImage
    ? assetUrl("", projectName, i2vSourceImage)
    : null;
  // 動画行はプレビューで実動画をループ再生（フレアのパス移動等を映像と一緒に確認できる）
  const previewVideoUrl =
    lineIsVideo && line.image ? assetUrl("", projectName, line.image) : null;
  // 区間の実尺（次の行の開始まで）。プレビュー尺に使うとパスの速度感が本番と一致する
  const nextStart = project.lines[selected + 1]?.startTime;
  const lineDurSec =
    nextStart != null ? Math.max(0.5, nextStart - line.startTime) : 4;
  const previewDurationInFrames = Math.min(600, Math.round(lineDurSec * 30));

  const setCamera = (v: EffectInstance | null) => {
    const rest = line.effects.filter((e) => !CAMERA_IDS.includes(e.id));
    updateLine(selected, { effects: v ? [v, ...rest] : rest });
  };
  const setOverlay = (index: number, v: EffectInstance | null) => {
    const nextOverlays = [...overlays];
    if (v) nextOverlays[index] = v;
    else nextOverlays.splice(index, 1);
    updateLine(selected, {
      effects: [...(camera ? [camera] : []), ...nextOverlays],
    });
  };
  const addOverlay = () => {
    const unused = OVERLAY_IDS.find((id) => !overlays.some((o) => o.id === id));
    if (!unused) return;
    setOverlay(overlays.length, { id: unused, params: {} });
  };

  const nudge = (d: number) =>
    setLineOffsetSnapped(selected, Math.round((line.offset + d) * 100) / 100);

  // 行の分割: 再生ヘッド位置（この行の範囲内にクランプ）で2行に割る。
  // 単語タイミングがあれば splitLineAt が単語の頭にスナップする。
  // frame は購読せずクリック時に読む（再生中のDetailPanel毎フレーム再描画を避ける）。
  const splitAtPlayhead = () => {
    if (!timeline) return;
    const songSec =
      usePlayback.getState().frame / project.meta.fps - timeline.songStart;
    const start = lineTime(line);
    const end = nextStart != null ? nextStart : start + lineDurSec;
    splitLine(selected, Math.min(Math.max(songSec, start + 0.01), end - 0.01));
  };

  // 行の結合: 次の行を取り込む。次の行が持っていた区間の頭情報（画像・演出等）は外れる
  const mergeWithNext = () => {
    const next = project.lines[selected + 1];
    if (!next) return;
    mergeLine(selected);
    if (next.image || next.effects.length > 0) {
      toast.info("結合しました。次の行が持っていた画像・演出は外れました（⌘Zで戻せます）");
    }
  };

  const generateDepth = async () => {
    if (!line.image) return;
    setDepthBusy(true);
    try {
      const res = await fetch("/api/depth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectName, image: line.image }),
      });
      const d = await res.json();
      if (d.error) alert(`深度マップ生成に失敗: ${d.error}`);
      else {
        // 資産一覧を取り直してhasDepthを反映
        const a = await fetch(`/api/assets?project=${encodeURIComponent(projectName)}`).then((r) => r.json());
        useEditor.getState().setAssets(a);
      }
    } finally {
      setDepthBusy(false);
    }
  };

  const generateSubject = async () => {
    if (!line.image) return;
    setSubjectBusy(true);
    try {
      const res = await fetch("/api/subject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectName, image: line.image }),
      });
      const d = await res.json();
      if (d.error) alert(`人物切り抜きの生成に失敗: ${d.error}`);
      else {
        // 資産一覧を取り直してhasSubjectを反映
        const a = await fetch(`/api/assets?project=${encodeURIComponent(projectName)}`).then((r) => r.json());
        useEditor.getState().setAssets(a);
      }
    } finally {
      setSubjectBusy(false);
    }
  };

  return (
    <div className="space-y-3 overflow-y-auto p-3 text-sm">
      <div className="flex items-center gap-2">
        <textarea
          rows={Math.max(1, line.lyricText.split("\n").length)}
          className="flex-1 resize-none rounded-md border border-transparent bg-transparent px-2 py-1.5 font-medium text-neutral-200 outline-none transition-colors hover:border-neutral-700 focus-visible:border-input focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="（間奏／マーカー行）— 歌詞を入力できます"
          value={line.lyricText}
          onChange={(e) => updateLine(selected, { lyricText: e.target.value })}
          title="歌詞を編集（タイミングは変わりません）。Enterで改行＝そのまま画面でも改行されます"
        />
        {/* この行だけ歌詞を出さない（テキストは保持＝いつでも戻せる）。全体OFFはテロップ様式 */}
        {line.lyricText.trim() !== "" && (
          <Button
            size="sm"
            variant="ghost"
            className={cn(
              "h-6 shrink-0 gap-1 px-1.5 text-xs",
              line.showLyric ? "text-neutral-400" : "text-amber-400",
            )}
            title={
              line.showLyric
                ? "この行の歌詞テロップを非表示にする（テキストは残る＝いつでも戻せる）"
                : "この行の歌詞テロップは非表示中。クリックで表示に戻す"
            }
            onClick={() => updateLine(selected, { showLyric: !line.showLyric })}
          >
            {line.showLyric ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
            テロップ{line.showLyric ? "オン" : "オフ"}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 shrink-0 gap-1 px-1.5 text-xs text-neutral-400"
          disabled={[...line.lyricText].length < 2}
          title="再生ヘッドの位置でこの行を2行に分割（単語タイミングがあれば単語の頭にスナップ）。再生中は Sキーでも切れます"
          onClick={splitAtPlayhead}
        >
          <Scissors className="size-3.5" />
          分割
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 shrink-0 gap-1 px-1.5 text-xs text-neutral-400"
          disabled={!project.lines[selected + 1]}
          title="次の行と結合（文字タイミングは引き継ぐ。次の行の画像・演出など区間の頭情報は外れます）"
          onClick={mergeWithNext}
        >
          <Merge className="size-3.5" />
          結合
        </Button>
        {line.source === "manual" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 text-xs text-red-400"
            onClick={() => removeLine(selected)}
          >
            マーカー削除
          </Button>
        )}
      </div>

      {/* 拡張テロップの書式フォーム: 選択中の歌詞演出が複数スロット持ちのときだけ出す。
          値の実体は上の歌詞欄と同じ lyricText（規約の区切りで組み立てる）。
          行単位の色（lyricSlotStyles）は対応テンプレ（家族CR系）のときだけスウォッチを出す */}
      {(() => {
        if (!line.lyricAnim) return null;
        const spec = xpTextSpecById(line.lyricAnim.id);
        const lineColors = supportsXpLineStyles(line.lyricAnim.id);
        const setSlotStyles = (s: SlotStyle[]) =>
          updateLine(selected, { lyricSlotStyles: s });
        if (spec) {
          return (
            <div className="rounded border border-neutral-800 bg-neutral-950/60 p-2">
              <div className="mb-1 text-[11px] font-medium text-neutral-400">
                テロップの書式（{effectById(line.lyricAnim.id)?.name ?? line.lyricAnim.id}）
              </div>
              <XpTextSlotsForm
                spec={spec}
                value={line.lyricText}
                onChange={(v) => updateLine(selected, { lyricText: v })}
                slotStyles={lineColors ? line.lyricSlotStyles : undefined}
                onSlotStylesChange={lineColors ? setSlotStyles : undefined}
              />
            </div>
          );
        }
        // スロット定義が無い拡張テロップ: 現在の行数ぶんの色スウォッチ（行数はテキスト依存）
        if (lineColors && line.lyricText.includes("\n")) {
          return (
            <div className="rounded border border-neutral-800 bg-neutral-950/60 p-2">
              <XpLineColorRows
                text={line.lyricText}
                styles={line.lyricSlotStyles}
                onChange={setSlotStyles}
              />
            </div>
          );
        }
        return null;
      })()}

      {/* オフセット（スナップ&オフセット方式） */}
      <div className="flex items-center gap-1.5">
        <span className="flex w-20 items-center gap-1 text-xs text-neutral-400">
          オフセット
          <TooltipProvider>
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <Info className="size-3 cursor-help text-neutral-500" />
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="w-72 space-y-2 p-3 text-xs leading-relaxed"
              >
                <p>
                  この行の<b className="font-semibold text-background">頭（表示開始）</b>
                  を前後にずらします。
                </p>
                <div className="space-y-1.5">
                  <div className="flex items-start gap-2">
                    <span className="mt-px w-4 shrink-0 text-center font-mono font-bold text-emerald-600">
                      ＋
                    </span>
                    <span>頭を後ろへ ― 前の絵が伸び、自分は遅く出る</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="mt-px w-4 shrink-0 text-center font-mono font-bold text-sky-600">
                      −
                    </span>
                    <span>頭を前へ ― 前の絵が縮み、自分は早く出る</span>
                  </div>
                </div>
                <p className="border-t border-background/15 pt-1.5 text-background/70">
                  動くのは隣り合う2クリップだけ。後ろの行には波及しません。
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </span>
        <Button size="sm" variant="outline" className="h-6 w-9 text-xs" onClick={() => nudge(-0.5)}>
          -0.5
        </Button>
        <Button size="sm" variant="outline" className="h-6 w-9 text-xs" onClick={() => nudge(-0.05)}>
          -0.05
        </Button>
        <span className="w-16 text-center font-mono text-xs">
          {line.offset >= 0 ? "+" : ""}
          {line.offset.toFixed(2)}s
        </span>
        <Button size="sm" variant="outline" className="h-6 w-9 text-xs" onClick={() => nudge(0.05)}>
          +0.05
        </Button>
        <Button size="sm" variant="outline" className="h-6 w-9 text-xs" onClick={() => nudge(0.5)}>
          +0.5
        </Button>
        {line.offset !== 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs text-neutral-400"
            onClick={() => updateLine(selected, { offset: 0 })}
          >
            0に戻す
          </Button>
        )}
      </div>

      {/* ✂️✂️ ショット: 区間の絵を「ショット」として一本化編集（区間頭＝画像あり）。
          単数＝枠なしインライン／複数＝アコーディオン。継続行（画像なし）は継続表示のみ */}
      {line.image ? (
        (() => {
          const sec = sections.find((s) => s.lineIndexes.includes(selected));
          const fps = project.meta.fps;
          const startF =
            sec && timeline ? toFrames(timeline.songStart + sec.start, fps) : 0;
          const endF =
            sec && timeline ? toFrames(timeline.songStart + sec.end, fps) : 0;
          return (
            <CutsBlock
              lineIndex={selected}
              sectionSec={sec ? sec.end - sec.start : 8}
              sectionStartFrame={startF}
              sectionEndFrame={endF}
              onAudition={auditionSection}
            />
          );
        })()
      ) : (
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-xs text-neutral-400">画像</span>
          <span className="text-xs text-neutral-500">
            なし（直前の絵を継続中）。下の素材帯からD&Dで割り当て
          </span>
        </div>
      )}

      {/* 🎬 動画化 / 作り直し。動画行でも消えず、元絵に戻せる（可逆） */}
      {i2vSourceImage && (
        <I2vBlock
          lineIndex={selected}
          lineId={line.id}
          image={i2vSourceImage}
          lineText={line.lyricText}
          mode={lineIsVideo ? "regenerate" : "generate"}
        />
      )}
      {/* 🔗 延長生成: 最終コマから続きを生成→プレビュー確認→連結（動画が短くて区間が余るとき） */}
      {lineIsVideo && line.image && (
        <I2vBlock
          lineIndex={selected}
          lineId={line.id}
          image={line.i2vSource ?? ""}
          lineText={line.lyricText}
          mode="extend"
          extendOf={line.image}
        />
      )}
      {lineIsVideo && line.i2vSource && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-full text-xs text-neutral-400"
          onClick={() =>
            updateLine(selected, { image: line.i2vSource, i2vSource: null })
          }
        >
          元の静止画に戻す
        </Button>
      )}
      {lineIsVideo && !line.i2vSource && (
        <div className="rounded bg-amber-950/50 p-2 text-[11px] text-amber-300">
          この動画は生成元の静止画が不明です（旧版で作成）。作り直すには、素材帯から元の静止画をこの行にD&Dで割り当て直してください。
        </div>
      )}
      {/* 🧑 ①素材化: 動画→キャラ透過クリップ（合成=キャラレイヤーは別途） */}
      {lineIsVideo && line.image && (
        <SubjectVideoBlock projectName={projectName} video={line.image} />
      )}


      {isHead && (
        <>
          {/* エフェクト一覧（案A）: 1スロット=1行チップ。クリックで浮かぶ編集UI。
              「映像の演出」島＝この区間の絵に掛かるもの（カメラ・重ね・切替・ルック除外）。 */}
          <div className="space-y-1">
            <EffectGroupHeader
              title="映像の演出"
              action={
                overlays.length < 3 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 shrink-0 text-xs"
                    onClick={addOverlay}
                    title="絵の上に光や質感を足すレイヤー（重ね）を追加します。最大3枚。各行のドロップダウンで効果を変更、「（削除）」で外せます"
                  >
                    ＋オーバーレイ
                  </Button>
                )
              }
            />
            <EffectSlotRow
              label="カメラ"
              value={camera}
              onClear={() => setCamera(null)}
            >
              {lineIsVideo && (
                <p className="mb-1.5 text-[10px] text-neutral-500">
                  動画のループの上から、区間全体を貫く連続の動きで掛かります
                </p>
              )}
              <EffectPicker
                category="camera"
                value={camera}
                previewImage={previewImageUrl}
                previewVideo={previewVideoUrl}
                previewDurationInFrames={previewDurationInFrames}
                onChange={setCamera}
              />
            </EffectSlotRow>
            {lineIsVideo && camera?.id === "parallax" && (
              <div className="rounded bg-amber-950/50 p-2 text-xs text-amber-300">
                パララックスは深度マップ前提なので動画素材には効きません（スローズーム等を選んでください）。
              </div>
            )}
            {!lineIsVideo && camera?.id === "parallax" && line.image && !imageAsset?.hasDepth && (
              <div className="flex items-center gap-2 rounded bg-amber-950/50 p-2 text-xs text-amber-300">
                この画像の深度マップが未生成です（無いと静止画のまま）
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs"
                  disabled={depthBusy}
                  onClick={generateDepth}
                >
                  {depthBusy ? "生成中…（初回はモデルDL）" : "深度マップを生成"}
                </Button>
              </div>
            )}
            {overlays.map((o, i) => (
              <EffectSlotRow
                // keyは位置固定（idを混ぜると効果変更でチップが作り直され、開いているポップオーバーが閉じる）
                key={i}
                label={`重ね${i + 1}`}
                value={o}
                onClear={() => setOverlay(i, null)}
                clearTitle="この重ねを外す"
              >
                <EffectPicker
                  category="overlay"
                  value={o}
                  noneLabel="（削除）"
                  previewImage={previewImageUrl}
                  previewVideo={previewVideoUrl}
                  previewDurationInFrames={previewDurationInFrames}
                  onChange={(v) => setOverlay(i, v)}
                />
              </EffectSlotRow>
            ))}
            {/* 被写体グリッチは深度マップ必須（パララックスと同じ下ごしらえ） */}
            {overlays.some((o) => o.id === "glitch-subject") &&
              line.image &&
              (isVideoFile(line.image) ? (
                <div className="rounded bg-amber-950/50 p-2 text-xs text-amber-300">
                  被写体グリッチは動画素材には効きません（静止画専用）
                </div>
              ) : (
                !imageAsset?.hasDepth && (
                  <div className="flex items-center gap-2 rounded bg-amber-950/50 p-2 text-xs text-amber-300">
                    被写体グリッチには深度マップが必要です
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-xs"
                      disabled={depthBusy}
                      onClick={generateDepth}
                    >
                      {depthBusy ? "生成中…（初回はモデルDL）" : "深度マップを生成"}
                    </Button>
                  </div>
                )
              ))}
            <EffectSlotRow
              label="切替"
              value={line.transition}
              noneLabel="既定（クロスフェード0.8s）"
              onClear={() => updateLine(selected, { transition: null })}
              clearTitle="既定のクロスフェードに戻す"
            >
              <EffectPicker
                category="transition"
                value={line.transition}
                noneLabel="既定（クロスフェード0.8s）"
                previewImage={previewImageUrl}
                onChange={(v) => updateLine(selected, { transition: v })}
              />
            </EffectSlotRow>
            {/* 全体ルックの区間除外（ルック使用時のみ表示）。スロットではなく“修飾”なので字下げして格下げ。 */}
            {project.look.effects.length > 0 && (
              <div className="flex items-center gap-2 pl-2 pt-0.5">
                <Switch
                  id="look-off"
                  checked={line.lookOff}
                  onCheckedChange={(v) => updateLine(selected, { lookOff: v })}
                />
                <Label
                  htmlFor="look-off"
                  className="text-[11px] text-neutral-400"
                  title="全体ルック（色味・質感）をこの区間だけ外して素の画にします。回想明けや色が主役の場面に"
                >
                  この区間はルックを外す
                </Label>
              </div>
            )}
          </div>
        </>
      )}

      {/* 歌詞まわりも同じ1行チップで一覧（歌詞がある行だけ）。
          「歌詞の演出」島＝文字に掛かるもの（歌詞アニメ・装飾）。頭行でも見出しを必ず出す。 */}
      {line.lyricText.trim() !== "" && (
        <div className="space-y-1 pt-1">
          <EffectGroupHeader title="歌詞の演出" />
          <EffectSlotRow
            label="歌詞"
            value={line.lyricAnim}
            noneLabel="既定（フェード）"
            onClear={() => updateLine(selected, { lyricAnim: null })}
            clearTitle="既定のフェードに戻す"
          >
            <EffectPicker
              category="lyric"
              value={line.lyricAnim}
              noneLabel="既定（フェード）"
              onChange={(v) => updateLine(selected, { lyricAnim: v })}
            />
            <div className="mt-1.5 flex items-center gap-2">
              <Switch
                id="behind-subject"
                checked={line.behindSubject}
                onCheckedChange={(v) => updateLine(selected, { behindSubject: v })}
              />
              <Label
                htmlFor="behind-subject"
                className="text-[11px] text-neutral-400"
                title="人物切り抜き(subject.png)があれば完全に後ろへ、無ければ深度マップ(depth.png)で簡易的に後ろへ。動画素材の区間では無効"
              >
                被写体の後ろに置く
              </Label>
            </div>
            {line.behindSubject && line.image && !isVideoFile(line.image) && (
              <div className="mt-1.5 flex items-center gap-2 rounded bg-neutral-900 p-2 text-[11px] text-neutral-400">
                {imageAsset?.hasSubject ? (
                  <span className="text-emerald-400">
                    ✓ 切り抜き済み（文字が完全に後ろに回ります）
                  </span>
                ) : (
                  <>
                    <span>切り抜き未生成だと深度マップで簡易表示（文字が透けることあり）</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 shrink-0 text-xs"
                      disabled={subjectBusy}
                      onClick={generateSubject}
                    >
                      {subjectBusy ? "生成中…（初回はモデルDL）" : "人物を切り抜く"}
                    </Button>
                  </>
                )}
              </div>
            )}
          </EffectSlotRow>
          <EffectSlotRow
            label="装飾"
            value={line.lyricDecor}
            onClear={() => updateLine(selected, { lyricDecor: null })}
          >
            <EffectPicker
              category="decor"
              value={line.lyricDecor}
              noneLabel="なし"
              onChange={(v) => updateLine(selected, { lyricDecor: v })}
            />
          </EffectSlotRow>
          {/* 🅰️ 行ごとテロップ様式の上書き（向き/フォント/サイズ/色/縁/影/位置） */}
          <LineStyleOverrideBlock lineIndex={selected} />
        </div>
      )}


      {/* 🅣 テキスト（クレジット）: 絵を持つ行は上のショットタイムラインのレーンで編集する。
          絵の無い行（継続・前奏/間奏マーカー）はここで行全体に載せる＝どこの行でも同じ操作 */}
      {!line.image &&
        (() => {
          // この行の時間窓（レンダラーの行クレジットと同じ推定: 次の行まで／最終行は+8s上限）
          const startAbs = line.startTime + line.offset;
          const next = project.lines[selected + 1];
          const endAbs = next
            ? next.startTime + next.offset
            : Math.min(startAbs + 8, project.meta.songDuration);
          const laneSec = Math.max(1, endAbs - startAbs);
          // ビート吸着（CutsBlockのsnapToBeatと同じ変換。行頭からの秒⇔曲内秒）
          const snapToBeat = (sec: number): number => {
            if (beats.length === 0) return sec;
            const snapped = snapToMusic(
              startAbs + sec,
              { beats, downbeats: songStructure?.downbeats },
              0.35,
            );
            if (snapped === startAbs + sec) return sec;
            return Math.max(0, Math.round((snapped - startAbs) * 100) / 100);
          };
          return (
            <div className="space-y-1.5 rounded border border-neutral-800 p-2">
              <span className="text-xs text-neutral-400">テキスト（クレジット）</span>
              <CreditLane
                sectionSec={laneSec}
                snap={snapToBeat}
                segments={[
                  {
                    key: `line-${line.id}`,
                    startSec: 0,
                    durationSec: laneSec,
                    title: "この行のテキスト",
                    credit: line.credit,
                    onChange: (card) => updateLine(selected, { credit: card }),
                  },
                ]}
              />
            </div>
          );
        })()}

      {/* 🔡 文字ごと微調整（上級）: 文字を選んで遅れ・位置・回転・大きさを個別制御 */}
      {line.lyricText.trim() !== "" && (
        <div className="rounded border border-neutral-800 p-2">
          <button
            className="flex w-full items-center justify-between text-xs text-neutral-400 hover:text-neutral-200"
            onClick={() => setShowCharFx(!showCharFx)}
          >
            <span className="flex items-center gap-1.5">
              <Type className="size-3.5" />
              文字ごと微調整{line.charFx.length > 0 && `（${line.charFx.length}字調整中）`}
            </span>
            <span>{showCharFx ? "▲" : "▼"}</span>
          </button>
          {showCharFx && (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-1">
                {[...line.lyricText].map((ch, i) => {
                  const has = line.charFx.some((f) => f.i === i);
                  return (
                    <button
                      key={i}
                      onClick={() => setCharIdx(charIdx === i ? null : i)}
                      className={cn(
                        "h-7 min-w-7 rounded border px-1 text-sm transition-colors",
                        charIdx === i
                          ? "border-primary bg-primary/20 text-primary"
                          : has
                            ? "border-amber-700 bg-amber-950/40 text-amber-200"
                            : "border-neutral-700 text-neutral-300 hover:border-neutral-500",
                      )}
                    >
                      {ch === " " ? "␣" : ch}
                    </button>
                  );
                })}
              </div>
              {charIdx !== null && (
                <CharFxSliders
                  lineIndex={selected}
                  charIndex={charIdx}
                />
              )}
              {line.charFx.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 w-full text-[10px] text-neutral-500"
                  onClick={() => updateLine(selected, { charFx: [] })}
                >
                  全ての微調整をリセット
                </Button>
              )}
              <p className="text-[10px] text-neutral-600">
                −/＋ボタンか Shift+ホイールで微調整（遅れは−で早め出し）。
                対応アニメ: フェード/スライド/一文字ずつ/書かれていく/バウンス/3Dフリップ/ゆらぎ
                （デカ文字・黒場系では無効）
              </p>
            </div>
          )}
        </div>
      )}

      {/* AI提案（決定値とは別枠。いつでも戻せる） */}
      {suggestion && (
        <div className="rounded border border-blue-900/60 bg-blue-950/30 p-2">
          <div className="mb-1 flex items-center gap-2 text-xs text-blue-300">
            <Lightbulb className="size-3.5" /> AI参謀の提案
            {suggestion.createdAt && (
              <span className="text-neutral-500">
                {suggestion.createdAt.slice(0, 16).replace("T", " ")}
              </span>
            )}
          </div>
          {suggestion.reason && (
            <p className="mb-1.5 text-xs text-neutral-300">{suggestion.reason}</p>
          )}
          <div className="mb-1.5 text-xs text-neutral-400">
            {[
              ...suggestion.effects.map((e) => effectById(e.id)?.name ?? e.id),
              suggestion.transition ? (effectById(suggestion.transition.id)?.name ?? "") : null,
              suggestion.lyricAnim ? `歌詞:${effectById(suggestion.lyricAnim.id)?.name}` : null,
              suggestion.imageFile ? `画像:${suggestion.imageFile}` : null,
            ]
              .filter(Boolean)
              .join(" / ") || "（提案なし）"}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs"
            onClick={() => adoptSuggestion(selected)}
          >
            この提案を採用（AI案に戻す）
          </Button>
        </div>
      )}
    </div>
  );
};
