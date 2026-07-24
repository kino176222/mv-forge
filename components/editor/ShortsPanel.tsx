"use client";
import React from "react";
import {
  Plus,
  Trash2,
  Copy,
  Play,
  AlertTriangle,
  Unlink,
  MessageSquarePlus,
  Music2,
  Megaphone,
  Type,
  RotateCcw,
  Sparkles,
  Loader2,
  ClipboardList,
  Check,
  Film,
} from "lucide-react";
import { useEditor } from "@/lib/store";
import { newLineId } from "@/lib/lrc";
import {
  SHORT_MAX_SEC,
  SHORT_TEXT_PRESETS,
  buildShortPostMemo,
  shortDurationSec,
  shortFrameRange,
  shortHookIssues,
  shortRangeIndexes,
  shotSeekFrame,
} from "@/lib/shorts";
import { proposalToShort, type ShortProposal } from "@/lib/shorts-suggest";
import type { Short, ShortText } from "@/lib/schema";
import { assetUrl } from "@/remotion/asset-url";
import { playerRef } from "@/lib/player-bridge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KnobRow } from "./KnobRow";
import { EffectPicker } from "./EffectPicker";
import { cn, isVideoFile } from "@/lib/utils";

/**
 * ショート（縦型9:16切り抜き）の編集パネル。
 * ショート＝lines[]を行id範囲で参照する「しおり」。素材は複製しない（本編修正が自動伝播）。
 * 選択中ショートは PlayerPanel が applyShortToProject 済みの縦プレビューに切り替わる。
 */

const TEXT_ROLE_META: Record<
  ShortText["role"],
  { label: string; icon: React.ReactNode }
> = {
  hook: { label: "掴み", icon: <MessageSquarePlus className="size-3" /> },
  title: { label: "曲名", icon: <Music2 className="size-3" /> },
  cta: { label: "CTA", icon: <Megaphone className="size-3" /> },
  free: { label: "自由", icon: <Type className="size-3" /> },
};

const TEXT_DEFAULTS: Record<ShortText["role"], string> = {
  hook: "",
  title: "",
  cta: "フルはプロフから",
  free: "",
};

export const ShortsPanel: React.FC = () => {
  const project = useEditor((s) => s.project);
  const projectName = useEditor((s) => s.projectName);
  const selectedShortId = useEditor((s) => s.selectedShortId);
  const selectShort = useEditor((s) => s.selectShort);
  const addShort = useEditor((s) => s.addShort);
  const updateShort = useEditor((s) => s.updateShort);
  const removeShort = useEditor((s) => s.removeShort);
  // フレーミング調整中の対象キー＝行id または カットid。
  // storeで持つ＝プレビュー直接ドラッグ(PlayerPanel)と選択を共有する（undo対象にしない）
  const framingKey = useEditor((s) => s.framingKey);
  const setFramingKey = useEditor((s) => s.setFramingKey);
  // 投稿メモコピーの完了表示（一時的）
  const [memoCopied, setMemoCopied] = React.useState(false);
  // AIショート提案（関所方式: 提案→チェックボックスで選んで採用。適用は⌘Zで戻せる）
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiProposals, setAiProposals] = React.useState<ShortProposal[] | null>(null);
  const [aiDropped, setAiDropped] = React.useState<{ summary: string; reason: string }[]>([]);
  const [aiChecked, setAiChecked] = React.useState<Set<number>>(new Set());
  const [aiError, setAiError] = React.useState<string | null>(null);

  if (!project) return null;
  const shorts = project.shorts;
  const short = shorts.find((s) => s.id === selectedShortId) ?? null;

  const newShort = (): Short => ({
    id: newLineId(),
    name: `ショート${shorts.length + 1}`,
    range: {
      startLineId: project.lines[0]?.id ?? "",
      endLineId: project.lines[project.lines.length - 1]?.id ?? "",
    },
    framingOverrides: {},
    fullFrame: false,
    lyricAnim: null,
    texts: [],
  });

  const up = (patch: Partial<Short>) => {
    if (short) updateShort(short.id, patch);
  };

  const playShort = (s: Short) => {
    const fr = shortFrameRange(project, s);
    const p = playerRef.current;
    if (!fr || !p) return;
    p.seekTo(fr[0]);
    p.play();
  };

  const addPresetText = (role: ShortText["role"]) => {
    if (!short) return;
    const preset =
      role === "free"
        ? { position: "top" as const, anchor: "start" as const, delay: 0, duration: null, role }
        : { ...SHORT_TEXT_PRESETS[role], role };
    const text: ShortText = {
      id: newLineId(),
      text: role === "title" ? project.meta.title : TEXT_DEFAULTS[role],
      ...preset,
    };
    up({ texts: [...short.texts, text] });
  };

  const updateText = (id: string, patch: Partial<ShortText>) => {
    if (!short) return;
    up({ texts: short.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  };

  const r = short ? shortRangeIndexes(project, short) : null;
  const dur = short ? shortDurationSec(project, short) : null;
  const broken = short !== null && r === null;
  // 冒頭3秒フックの健全性（フックの成否は「Viewed vs swiped away」で直接計測される）
  const hookIssues = short ? shortHookIssues(project, short) : [];

  const copyPostMemo = async () => {
    if (!short) return;
    await navigator.clipboard.writeText(buildShortPostMemo(project, short));
    setMemoCopied(true);
    setTimeout(() => setMemoCopied(false), 1500);
  };

  // フレーミング対象: 範囲内で絵を持つ行 ＋ 範囲頭を支配する区間頭（範囲外でも縦で映る）。
  // カット割り（cuts>1）の行は描画がカット単位なので、名簿もカットごとに分ける（key=カットid）
  // thumb=サムネに映す静止画（動画素材は i2vSource のポスター。無ければ null＝プレースホルダ）。
  // atSec=そのショットの区間頭からの秒（サムネクリックでプレビューを頭出しするのに使う）。
  const framingTargets: {
    index: number;
    key: string;
    thumb: string | null;
    // 動画素材のファイルパス（ポスター i2vSource が無いとき先頭フレームをサムネにする）
    videoSrc: string | null;
    isVideo: boolean;
    atSec: number;
    cutNo?: number;
    base: { frameScale: number; frameX: number; frameY: number };
  }[] = [];
  if (r) {
    let head = -1;
    for (let i = 0; i <= r.startIndex; i++) if (project.lines[i].image) head = i;
    for (let i = 0; i <= r.endIndex; i++) {
      const l = project.lines[i];
      if (!l.image) continue;
      if (!(i === head || (i >= r.startIndex && i <= r.endIndex))) continue;
      if (l.cuts.length > 1) {
        l.cuts.forEach((c, n) =>
          framingTargets.push({
            index: i,
            key: c.id,
            thumb: isVideoFile(c.image) ? c.i2vSource : c.image,
            videoSrc: isVideoFile(c.image) ? c.image : null,
            isVideo: isVideoFile(c.image),
            atSec: c.at,
            cutNo: n + 1,
            base: { frameScale: c.frameScale, frameX: c.frameX, frameY: c.frameY },
          }),
        );
      } else {
        framingTargets.push({
          index: i,
          key: l.id,
          thumb: isVideoFile(l.image) ? l.i2vSource : l.image,
          videoSrc: isVideoFile(l.image) ? l.image : null,
          isVideo: isVideoFile(l.image),
          atSec: 0,
          base: { frameScale: l.frameScale, frameX: l.frameX, frameY: l.frameY },
        });
      }
    }
  }
  const framingTarget = framingTargets.find((f) => f.key === framingKey) ?? null;
  const framingValue =
    short && framingTarget
      ? (short.framingOverrides[framingTarget.key] ?? framingTarget.base)
      : null;

  const setFraming = (patch: Partial<{ frameScale: number; frameX: number; frameY: number }>) => {
    if (!short || !framingTarget || !framingValue) return;
    up({
      framingOverrides: {
        ...short.framingOverrides,
        [framingTarget.key]: { ...framingValue, ...patch },
      },
    });
  };

  const lineLabel = (i: number) =>
    `${i + 1}. ${project.lines[i].lyricText || "（間奏）"}`;

  const runAiSuggest = async () => {
    setAiBusy(true);
    setAiError(null);
    setAiProposals(null);
    try {
      const model = localStorage.getItem("mvforge-suggest-model") ?? "";
      const d = await fetch("/api/shorts-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectName, model }),
      }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      const timer = setInterval(async () => {
        let j: {
          phase?: string;
          proposals?: ShortProposal[];
          dropped?: { summary: string; reason: string }[];
          error?: string | null;
        };
        try {
          j = await fetch(
            `/api/shorts-suggest?id=${d.id}&project=${encodeURIComponent(projectName)}`,
          ).then((r) => r.json());
        } catch {
          return;
        }
        if (j.phase === "done") {
          clearInterval(timer);
          setAiBusy(false);
          setAiProposals(j.proposals ?? []);
          setAiDropped(j.dropped ?? []);
          setAiChecked(new Set((j.proposals ?? []).map((_, i) => i)));
        } else if (j.phase === "error" || j.phase === "cancelled") {
          clearInterval(timer);
          setAiBusy(false);
          setAiError(j.error ?? "キャンセルされました");
        }
      }, 2000);
    } catch (e) {
      setAiBusy(false);
      setAiError(String(e instanceof Error ? e.message : e));
    }
  };

  const adoptAiProposals = () => {
    if (!aiProposals) return;
    aiProposals.forEach((p, i) => {
      if (aiChecked.has(i)) addShort(proposalToShort(p, newLineId));
    });
    setAiProposals(null);
    setAiDropped([]);
  };

  // テロップ上書きの実効値（スイッチON時のつまみ初期値）
  const overrideOn = short?.textStyleOverride !== undefined && short?.textStyleOverride !== null;
  const baseStyle = project.meta.textStyle;
  const ts = short?.textStyleOverride ?? {};

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4 text-sm">
      {/* ショート一覧 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-neutral-300">
            ショート（縦型9:16切り抜き）
          </span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              disabled={aiBusy || project.lines.length === 0}
              title="歌詞と行タイミングからサビ用・掴み用など2〜3案をドラフト（定額）"
              onClick={runAiSuggest}
            >
              {aiBusy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Sparkles className="size-3" />
              )}
              AI提案
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={() => addShort(newShort())}
            >
              <Plus className="size-3" /> 追加
            </Button>
          </div>
        </div>
        {aiError && (
          <p className="rounded border border-red-900/50 bg-red-950/30 p-2 text-[10px] text-red-400">
            {aiError}
          </p>
        )}
        {aiProposals && (
          <div className="space-y-1.5 rounded border border-primary/40 p-2">
            <span className="text-[10px] font-semibold text-primary">
              AI提案（チェックした案だけ採用されます）
            </span>
            {aiProposals.length === 0 && (
              <p className="text-[10px] text-neutral-500">有効な提案がありませんでした</p>
            )}
            {aiProposals.map((p, i) => (
              <label
                key={`${p.startLineId}-${i}`}
                className="flex cursor-pointer items-start gap-2 rounded border border-neutral-800 p-2 text-xs hover:border-neutral-600"
              >
                <input
                  type="checkbox"
                  checked={aiChecked.has(i)}
                  onChange={(e) => {
                    const next = new Set(aiChecked);
                    if (e.target.checked) next.add(i);
                    else next.delete(i);
                    setAiChecked(next);
                  }}
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="flex items-center gap-2">
                    <span className="font-semibold text-neutral-200">{p.name}</span>
                    <span className="font-mono text-[10px] text-neutral-500">
                      {p.startLine}〜{p.endLine}行目
                    </span>
                    {p.lyricAnim && (
                      <span className="rounded bg-neutral-800 px-1 text-[10px] text-neutral-400">
                        {p.lyricAnim}
                      </span>
                    )}
                  </span>
                  {p.reason && (
                    <span className="block text-[10px] text-neutral-500">{p.reason}</span>
                  )}
                  {(p.hook || p.cta) && (
                    <span className="block text-[10px] text-neutral-400">
                      {p.hook && <>掴み「{p.hook}」 </>}
                      {p.cta && <>CTA「{p.cta}」</>}
                    </span>
                  )}
                </span>
              </label>
            ))}
            {aiDropped.length > 0 && (
              <details className="text-[10px] text-neutral-500">
                <summary>検疫で除外・修正した項目（{aiDropped.length}）</summary>
                {aiDropped.map((d, i) => (
                  <p key={i}>
                    {d.summary}: {d.reason}
                  </p>
                ))}
              </details>
            )}
            <div className="flex gap-1.5">
              <Button
                size="sm"
                className="h-6 px-2 text-[10px]"
                disabled={aiChecked.size === 0}
                onClick={adoptAiProposals}
              >
                チェックした{aiChecked.size}案を採用
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                onClick={() => {
                  setAiProposals(null);
                  setAiDropped([]);
                }}
              >
                破棄
              </Button>
            </div>
          </div>
        )}
        {shorts.length === 0 && (
          <p className="rounded border border-dashed border-neutral-800 p-3 text-xs text-neutral-500">
            本編から切り抜く範囲を「しおり」として登録します。曲・絵・歌詞は複製しないので、
            本編を直せばショートにも反映されます。
          </p>
        )}
        {shorts.map((s) => {
          const d = shortDurationSec(project, s);
          const isBroken = shortRangeIndexes(project, s) === null;
          return (
            <button
              key={s.id}
              onClick={() => selectShort(s.id === selectedShortId ? null : s.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-xs transition-colors",
                s.id === selectedShortId
                  ? "border-primary bg-primary/10 text-neutral-100"
                  : "border-neutral-800 text-neutral-400 hover:border-neutral-600",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              {isBroken ? (
                <span className="flex items-center gap-1 text-red-400">
                  <Unlink className="size-3" /> 範囲切れ
                </span>
              ) : (
                <span className="font-mono text-neutral-500">{d ?? "?"}s</span>
              )}
              {d !== null && d > SHORT_MAX_SEC && (
                <span title={`${SHORT_MAX_SEC}秒超（Shorts/Reelsの上限に注意）`}>
                  <AlertTriangle className="size-3 text-amber-400" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {short && (
        <>
          {/* 名前・操作 */}
          <div className="flex items-center gap-2">
            <Input
              value={short.name}
              onChange={(e) => up({ name: e.target.value })}
              className="h-7 flex-1 text-xs"
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              title="複製"
              onClick={() =>
                addShort({
                  ...structuredClone(short),
                  id: newLineId(),
                  name: `${short.name}のコピー`,
                })
              }
            >
              <Copy className="size-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              title="投稿メモをコピー（キャプション案・Related Video設定手順・投稿後チェック）"
              onClick={copyPostMemo}
            >
              {memoCopied ? (
                <Check className="size-3.5 text-green-400" />
              ) : (
                <ClipboardList className="size-3.5" />
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-red-400 hover:text-red-300"
              title="削除"
              onClick={() => removeShort(short.id)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>

          {/* 範囲 */}
          <div className="space-y-2 rounded border border-neutral-800 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-300">範囲（歌詞行）</span>
              <div className="flex items-center gap-2">
                {broken && (
                  <span className="flex items-center gap-1 text-[10px] text-red-400">
                    <Unlink className="size-3" /> 行が見つかりません（範囲を選び直してください）
                  </span>
                )}
                {dur !== null && (
                  <span
                    className={cn(
                      "font-mono text-[10px]",
                      dur > SHORT_MAX_SEC ? "text-amber-400" : "text-neutral-500",
                    )}
                  >
                    {dur}s{dur > SHORT_MAX_SEC ? `（${SHORT_MAX_SEC}s超）` : ""}
                  </span>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  disabled={broken}
                  onClick={() => playShort(short)}
                >
                  <Play className="size-3" /> この範囲を試聴
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-xs text-neutral-400">開始</span>
              <Select
                value={short.range.startLineId}
                onValueChange={(v) => up({ range: { ...short.range, startLineId: v } })}
              >
                <SelectTrigger className="h-7 flex-1 text-xs">
                  <SelectValue placeholder="開始行" />
                </SelectTrigger>
                <SelectContent>
                  {project.lines.map((l, i) => (
                    <SelectItem key={l.id} value={l.id} className="text-xs">
                      {lineLabel(i)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-xs text-neutral-400">終了</span>
              <Select
                value={short.range.endLineId}
                onValueChange={(v) => up({ range: { ...short.range, endLineId: v } })}
              >
                <SelectTrigger className="h-7 flex-1 text-xs">
                  <SelectValue placeholder="終了行" />
                </SelectTrigger>
                <SelectContent>
                  {project.lines.map((l, i) => (
                    <SelectItem key={l.id} value={l.id} className="text-xs">
                      {lineLabel(i)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* 冒頭3秒フックの警告（スワイプ離脱に直結するため範囲のすぐ下に出す） */}
            {hookIssues.map((issue) => (
              <p
                key={issue}
                className="flex items-start gap-1.5 rounded border border-amber-900/50 bg-amber-950/30 p-1.5 text-[10px] text-amber-400"
              >
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                {issue}
              </p>
            ))}
          </div>

          {/* テロップ様式（ショート専用上書き） */}
          <div className="space-y-2 rounded border border-neutral-800 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-300">
                テロップ様式（ショート専用）
              </span>
              <Switch
                checked={overrideOn}
                onCheckedChange={(on) =>
                  up({
                    textStyleOverride: on
                      ? {
                          orientation: baseStyle.orientation,
                          size: Math.round(baseStyle.size * 1.4),
                          posY: baseStyle.posY,
                        }
                      : undefined,
                  })
                }
              />
            </div>
            {!overrideOn && (
              <p className="text-[10px] text-neutral-500">
                OFFでも縦型書き出しの文字サイズ自動補正（×1.4）は効きます
              </p>
            )}
            {overrideOn && (
              <>
                <div className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs text-neutral-400">向き</span>
                  <Select
                    value={ts.orientation ?? baseStyle.orientation}
                    onValueChange={(v) =>
                      up({
                        textStyleOverride: {
                          ...ts,
                          orientation: v as "horizontal" | "vertical",
                        },
                      })
                    }
                  >
                    <SelectTrigger className="h-7 flex-1 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="horizontal" className="text-xs">横書き</SelectItem>
                      <SelectItem value="vertical" className="text-xs">縦書き</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <KnobRow
                  label="サイズ"
                  value={ts.size ?? Math.round(baseStyle.size * 1.4)}
                  min={24}
                  max={160}
                  step={2}
                  onChange={(v) => up({ textStyleOverride: { ...ts, size: v } })}
                />
                <KnobRow
                  label="位置"
                  value={ts.posY ?? baseStyle.posY}
                  min={0}
                  max={100}
                  step={1}
                  unit="%"
                  onChange={(v) => up({ textStyleOverride: { ...ts, posY: v } })}
                />
              </>
            )}
          </div>

          {/* 歌詞演出（ショート専用差し替え） */}
          <div className="space-y-2 rounded border border-neutral-800 p-2.5">
            <span className="text-xs font-semibold text-neutral-300">
              歌詞演出（ショート専用）
            </span>
            <EffectPicker
              category="lyric"
              value={short.lyricAnim}
              allowNone
              noneLabel="本編のまま"
              onChange={(v) => up({ lyricAnim: v })}
            />
          </div>

          {/* フレーミング（縦で崩れる絵だけ寄せる。カット割り行はカットごと） */}
          <div className="space-y-2 rounded border border-neutral-800 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-300">
                フレーミング（縦で見切れる絵を寄せる）
              </span>
              {/* 全体見せ: 絵の全体を中央に見せ、余白は同じ絵のぼかしで埋める */}
              <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-neutral-400">
                全体見せ（ぼかし背景）
                <Switch
                  checked={short.fullFrame}
                  onCheckedChange={(on) => up({ fullFrame: on })}
                />
              </label>
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {framingTargets.map((f) => (
                <button
                  key={f.key}
                  onClick={() => {
                    const next = f.key === framingKey ? null : f.key;
                    setFramingKey(next);
                    // クリックしたショットの頭へプレビューを合わせる（今どのコマを直すか一目で分かる）
                    if (next) playerRef.current?.seekTo(shotSeekFrame(project, f.index, f.atSec));
                  }}
                  className={cn(
                    "relative shrink-0 overflow-hidden rounded border",
                    f.key === framingKey
                      ? "border-primary"
                      : "border-neutral-800 hover:border-neutral-600",
                  )}
                  title={
                    f.cutNo != null
                      ? `${lineLabel(f.index)}（カット${f.cutNo}）`
                      : lineLabel(f.index)
                  }
                >
                  {f.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={assetUrl("", projectName, f.thumb)}
                      alt=""
                      className="h-12 w-20 object-cover"
                    />
                  ) : f.videoSrc ? (
                    // ポスター(i2vSource)が無い動画は先頭フレーム(#t=0.1)を静止サムネにする
                    <video
                      src={`${assetUrl("", projectName, f.videoSrc)}#t=0.1`}
                      muted
                      playsInline
                      preload="metadata"
                      className="h-12 w-20 object-cover"
                    />
                  ) : (
                    // 素材が無い場合の代替（壊れアイコンにしない）
                    <div className="flex h-12 w-20 items-center justify-center bg-neutral-800 text-neutral-500">
                      <Film className="size-4" />
                    </div>
                  )}
                  {f.isVideo && (
                    <span className="absolute left-0.5 top-0.5 rounded bg-black/70 px-1 text-[9px] text-neutral-100">
                      ▶
                    </span>
                  )}
                  {f.cutNo != null && (
                    <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 text-[9px] text-neutral-100">
                      C{f.cutNo}
                    </span>
                  )}
                  {short.framingOverrides[f.key] && (
                    <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary" />
                  )}
                </button>
              ))}
              {framingTargets.length === 0 && (
                <p className="text-[10px] text-neutral-500">範囲内に絵のある行がありません</p>
              )}
            </div>
            {framingTarget && framingValue && (
              <div className="space-y-1.5">
                <KnobRow
                  label="拡大"
                  value={framingValue.frameScale}
                  min={1}
                  max={3}
                  step={0.05}
                  unit="x"
                  onChange={(v) => setFraming({ frameScale: v })}
                />
                <KnobRow
                  label="横"
                  value={framingValue.frameX}
                  min={-50}
                  max={50}
                  step={1}
                  unit="%"
                  onChange={(v) => setFraming({ frameX: v })}
                />
                <KnobRow
                  label="縦"
                  value={framingValue.frameY}
                  min={-50}
                  max={50}
                  step={1}
                  unit="%"
                  onChange={(v) => setFraming({ frameY: v })}
                />
                {short.framingOverrides[framingTarget.key] && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px] text-neutral-400"
                    onClick={() => {
                      const rest = { ...short.framingOverrides };
                      delete rest[framingTarget.key];
                      up({ framingOverrides: rest });
                    }}
                  >
                    <RotateCcw className="size-3" /> 本編の値に戻す
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* ショート専用テロップ（texts[]。本編には出ない独立レーン） */}
          <div className="space-y-2 rounded border border-neutral-800 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-300">
                ショート専用テロップ
              </span>
              <div className="flex gap-1">
                {(["hook", "title", "cta", "free"] as const).map((role) => (
                  <Button
                    key={role}
                    size="sm"
                    variant="outline"
                    className="h-6 px-1.5 text-[10px]"
                    onClick={() => addPresetText(role)}
                  >
                    <Plus className="size-3" />
                    {TEXT_ROLE_META[role].label}
                  </Button>
                ))}
              </div>
            </div>
            {short.texts.length === 0 && (
              <p className="text-[10px] text-neutral-500">
                掴みコピー（冒頭）・曲名の常設・CTA（末尾）をボタンで追加して文言だけ書き換えます
              </p>
            )}
            {short.texts.map((t) => (
              <div key={t.id} className="space-y-1.5 rounded border border-neutral-800/70 p-2">
                <div className="flex items-center gap-2">
                  <span className="flex w-14 shrink-0 items-center gap-1 text-[10px] text-neutral-400">
                    {TEXT_ROLE_META[t.role].icon}
                    {TEXT_ROLE_META[t.role].label}
                  </span>
                  <Input
                    value={t.text}
                    placeholder={t.role === "hook" ? "この曲、最後泣きます" : "テキスト"}
                    onChange={(e) => updateText(t.id, { text: e.target.value })}
                    className="h-7 flex-1 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-1.5 text-red-400 hover:text-red-300"
                    title="削除"
                    onClick={() => up({ texts: short.texts.filter((x) => x.id !== t.id) })}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-[10px] text-neutral-400">位置</span>
                  <Select
                    value={t.position}
                    onValueChange={(v) =>
                      updateText(t.id, { position: v as ShortText["position"] })
                    }
                  >
                    <SelectTrigger className="h-6 w-24 text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="top" className="text-xs">上部（大）</SelectItem>
                      <SelectItem value="topSmall" className="text-xs">上部（小）</SelectItem>
                      <SelectItem value="bottom" className="text-xs">下部</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={t.anchor}
                    onValueChange={(v) =>
                      updateText(t.id, { anchor: v as ShortText["anchor"] })
                    }
                  >
                    <SelectTrigger className="h-6 w-24 text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="start" className="text-xs">頭から</SelectItem>
                      <SelectItem value="end" className="text-xs">末尾から</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <KnobRow
                  label="ずらし"
                  value={t.delay}
                  min={0}
                  max={60}
                  step={0.5}
                  unit="s"
                  onChange={(v) => updateText(t.id, { delay: v })}
                />
                <KnobRow
                  label="表示時間"
                  value={t.duration ?? 0}
                  min={0}
                  max={60}
                  step={0.5}
                  display={(v) => (v === 0 ? "末尾まで" : `${v}s`)}
                  onChange={(v) => updateText(t.id, { duration: v === 0 ? null : v })}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
