"use client";
import { Palette, Plus, Trash2 } from "lucide-react";
import React from "react";
import { Player } from "@remotion/player";
import { useEditor } from "@/lib/store";
import { isVideoFile } from "@/lib/utils";
import { effectById, resolveParams } from "@/lib/effects-meta";
import { LOOK_EFFECT_IDS, LOOK_PRESETS } from "@/lib/look-presets";
import { assetUrl } from "@/remotion/asset-url";
import {
  FxPreview,
  FX_PREVIEW_FRAMES,
  FX_PREVIEW_FPS,
} from "@/remotion/FxPreview";
import { LazyPlayerCard } from "@/components/effects/LazyPlayerCard";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

/**
 * 全体ルック（mFilmLook相当）: 作品全体の色味・質感を1箇所で決める。
 * 基本の体験は「プリセットカードを1クリック → 強さスライダー1本」の判断2回。
 * 詳細つまみ（モジュールごとのパラメータ）は下に畳んで普段は触らない。
 * 除外は 区間側の「ルックを外す」トグル と ここの「歌詞にも適用」で行う。
 */
export const LookDialog: React.FC = () => {
  const project = useEditor((s) => s.project);
  const projectName = useEditor((s) => s.projectName);
  const mutate = useEditor((s) => s.mutate);
  if (!project) return null;
  const look = project.look;
  const active = look.effects.length > 0;

  // プレビューは本編の最初の静止画（無ければサンプル画像）
  const firstImage =
    project.lines.find((l) => l.image && !isVideoFile(l.image))?.image ?? null;
  const previewImage = firstImage ? assetUrl("", projectName, firstImage) : null;

  const applyPreset = (presetId: string | null) =>
    mutate((p) => {
      if (!presetId) {
        p.look.effects = [];
        p.look.preset = "";
        return;
      }
      const preset = LOOK_PRESETS.find((x) => x.id === presetId);
      if (!preset) return;
      // 全キーをresolveして保存＝適用後そのまま個別つまみで微調整できる
      p.look.effects = preset.effects.map((e) => ({
        id: e.id,
        params: resolveParams(e.id, e.params),
      }));
      p.look.preset = presetId;
    });

  const addModule = (id: string) =>
    mutate((p) => {
      if (p.look.effects.some((e) => e.id === id)) return;
      p.look.effects.push({ id, params: resolveParams(id, undefined) });
    });

  const addableIds = LOOK_EFFECT_IDS.filter(
    (id) => !look.effects.some((e) => e.id === id),
  );

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs">
          <Palette className="size-3.5" /> 全体ルック
          {active && (
            <span className="ml-0.5 inline-block size-1.5 rounded-full bg-amber-400" />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>全体ルック（作品全体の色味・質感）</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {/* プリセット: 1クリックでトーン一発。カードはライブプレビュー */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1.5">
            <PresetCard
              label="なし"
              selected={!active}
              effectId="__look:none__"
              previewImage={previewImage}
              onSelect={() => applyPreset(null)}
            />
            {LOOK_PRESETS.map((preset) => (
              <PresetCard
                key={preset.id}
                label={preset.name}
                title={preset.description}
                selected={active && look.preset === preset.id}
                effectId={`__look:${preset.id}__`}
                previewImage={previewImage}
                onSelect={() => applyPreset(preset.id)}
              />
            ))}
          </div>

          {active && (
            <>
              {/* 編集中ルックのライブプレビュー（強さ・つまみが即反映） */}
              <div className="overflow-hidden rounded border border-neutral-800 bg-neutral-950">
                <Player
                  component={FxPreview}
                  inputProps={{
                    effectId: "__look-live__",
                    look,
                    imageUrl: previewImage,
                  }}
                  durationInFrames={FX_PREVIEW_FRAMES}
                  fps={FX_PREVIEW_FPS}
                  compositionWidth={640}
                  compositionHeight={360}
                  style={{ width: "100%" }}
                  loop
                  autoPlay
                  initiallyMuted
                  numberOfSharedAudioTags={0}
                  controls={false}
                  clickToPlay={false}
                />
              </div>

              {/* マスターつまみ: 効き全体を1本でスケール（微調整の9割はこれで済む） */}
              <div className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-xs text-neutral-400">強さ</span>
                <Slider
                  className="flex-1"
                  min={0}
                  max={100}
                  step={5}
                  value={[Math.round(look.intensity * 100)]}
                  onValueChange={([v]) =>
                    mutate((p) => {
                      p.look.intensity = v / 100;
                    })
                  }
                />
                <span className="w-12 shrink-0 text-right font-mono text-xs">
                  {Math.round(look.intensity * 100)}%
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="look-lyrics"
                  checked={look.applyToLyrics}
                  onCheckedChange={(v) =>
                    mutate((p) => {
                      p.look.applyToLyrics = v;
                    })
                  }
                />
                <Label
                  htmlFor="look-lyrics"
                  className="text-[11px] text-neutral-400"
                  title="オンでも色調整だけ。グレインやビネットは常に絵だけに掛かり、文字は汚しません"
                >
                  歌詞にも適用（色調整のみ）
                </Label>
              </div>

              {/* 詳細つまみ: モジュールごと。普段は触らない */}
              <details className="rounded border border-neutral-800 p-2">
                <summary className="cursor-pointer text-xs text-neutral-400">
                  詳細つまみ（モジュールごとの調整）
                </summary>
                <div className="mt-2 space-y-3">
                  {look.effects.map((inst, i) => {
                    const meta = effectById(inst.id);
                    if (!meta) return null;
                    const params = resolveParams(inst.id, inst.params);
                    return (
                      <div key={inst.id} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-neutral-300">
                            {meta.name}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 px-1.5 text-[10px] text-neutral-500"
                            title="このモジュールを外す"
                            onClick={() =>
                              mutate((p) => {
                                p.look.effects.splice(i, 1);
                              })
                            }
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        </div>
                        {meta.params.map((pd) => {
                          if (pd.type !== "number") return null;
                          const num = Number(params[pd.key]);
                          return (
                            <div key={pd.key} className="flex items-center gap-2 text-xs">
                              <span className="w-20 shrink-0 text-neutral-400">
                                {pd.label}
                              </span>
                              <Slider
                                className="flex-1"
                                min={pd.min}
                                max={pd.max}
                                step={pd.step}
                                value={[num]}
                                onValueChange={([v]) =>
                                  mutate((p) => {
                                    p.look.effects[i] = {
                                      ...p.look.effects[i],
                                      params: { ...params, [pd.key]: v },
                                    };
                                  })
                                }
                              />
                              <span className="w-14 shrink-0 text-right font-mono text-neutral-400">
                                {num}
                                {pd.unit}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                  {addableIds.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Plus className="size-3 text-neutral-500" />
                      <Select value="" onValueChange={addModule}>
                        <SelectTrigger className="h-7 flex-1 text-xs">
                          <SelectValue placeholder="モジュールを追加…" />
                        </SelectTrigger>
                        <SelectContent>
                          {addableIds.map((id) => (
                            <SelectItem key={id} value={id} className="text-xs">
                              {effectById(id)?.name ?? id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </details>
            </>
          )}

          <p className="text-[11px] leading-relaxed text-neutral-500">
            作品全体に1枚だけ掛かる調整レイヤーです（映像編集ソフトの調整レイヤー相当）。
            特定の区間だけ外したいときは、その区間の詳細パネルで「この区間はルックを外す」をオンに。
            エンドカードの文字には掛かりません。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const PresetCard: React.FC<{
  label: string;
  title?: string;
  selected: boolean;
  effectId: string;
  previewImage: string | null;
  onSelect(): void;
}> = ({ label, title, selected, effectId, previewImage, onSelect }) => (
  <button
    type="button"
    onClick={onSelect}
    title={title ?? label}
    className={cn(
      "group flex flex-col overflow-hidden rounded border text-left transition-colors",
      selected
        ? "border-amber-400 ring-1 ring-amber-400/40"
        : "border-neutral-800 hover:border-neutral-600",
    )}
  >
    <LazyPlayerCard
      component={FxPreview as React.FC<Record<string, unknown>>}
      inputProps={{ effectId, imageUrl: previewImage }}
      durationInFrames={FX_PREVIEW_FRAMES}
      fps={FX_PREVIEW_FPS}
      width={640}
      height={360}
      hoverToPlay
    />
    <span
      className={cn(
        "flex items-center gap-1 truncate px-1.5 py-1 text-[10px]",
        selected ? "text-amber-300" : "text-neutral-300",
      )}
    >
      {selected && <span className="shrink-0">✓</span>}
      <span className="truncate">{label}</span>
    </span>
  </button>
);
