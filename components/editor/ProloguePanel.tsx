"use client";
import React from "react";
import { RotateCcw } from "lucide-react";
import { useEditor } from "@/lib/store";
import { EffectPicker } from "./EffectPicker";
import { KnobRow } from "./KnobRow";
import { NarrationGen } from "./NarrationGen";
import { RecordVoiceChange } from "./RecordVoiceChange";
import { assetUrl } from "@/remotion/asset-url";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { titleCardSchema, type EffectInstance } from "@/lib/schema";
import { xpTitleMetaById } from "@/lib/xp/bridge";
import { xpTextSpecById } from "@/lib/xp/text-specs";
import { FONT_METAS } from "@/lib/fonts-meta";
import { XpTextSlotsForm } from "./XpTextSlotsForm";
import { XpTitlePicker } from "./XpTitlePicker";
import { CreditPresetBar } from "./CreditPresetBar";

const CAMERA_IDS = ["slow-zoom-in", "slow-zoom-out", "pan", "parallax"];

/**
 * プロローグ: 詩の朗読（持込音声）＋静止画＋任意字幕。
 * 字幕は均等割り＋連ごとオフセットの入替型（§3.5.3）。
 */
export const ProloguePanel: React.FC = () => {
  const project = useEditor((s) => s.project);
  const projectName = useEditor((s) => s.projectName);
  const assets = useEditor((s) => s.assets);
  const mutate = useEditor((s) => s.mutate);
  // 編集中はローカル下書きを表示する（即時正規化すると連区切りの空行が打てないため）
  const [stanzaDraft, setStanzaDraft] = React.useState<string | null>(null);
  const [titlePickerOpen, setTitlePickerOpen] = React.useState(false);
  if (!project) return null;
  const p = project.prologue;
  const oc = project.openingCard; // const に取り出す＝クロージャ内でも非null絞り込みが効く
  const camera = p.effects.find((e) => CAMERA_IDS.includes(e.id)) ?? null;
  const slot =
    p.subtitle.stanzas.length > 0 ? p.duration / p.subtitle.stanzas.length : 0;

  const setCamera = (v: EffectInstance | null) =>
    mutate((prj) => {
      const rest = prj.prologue.effects.filter((e) => !CAMERA_IDS.includes(e.id));
      prj.prologue.effects = v ? [v, ...rest] : rest;
    });

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4 text-sm">
      {/* オープニングタイトル: 曲頭にタイトルデザインを重ねる（プロローグとは独立） */}
      <div className="space-y-1.5 rounded border border-neutral-800 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-neutral-400">オープニングタイトル</span>
          {project.openingCard && (
            <button
              type="button"
              onClick={() =>
                mutate((prj) => {
                  prj.openingCard = null;
                })
              }
              className="text-[10px] text-neutral-500 hover:text-red-400"
            >
              外す
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setTitlePickerOpen(true)}
          className="flex w-full items-center justify-between rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-left text-xs transition hover:border-neutral-600"
        >
          <span className="truncate">
            {project.openingCard
              ? (xpTitleMetaById(project.openingCard.xpId)?.name ??
                project.openingCard.xpId)
              : "なし — クリックでタイトルデザインから選ぶ"}
          </span>
          <span className="shrink-0 text-neutral-500">一覧から選ぶ</span>
        </button>
        {/* 作り置き: プリセットから差す／今の設定を保存（プロジェクト横断） */}
        <CreditPresetBar
          current={oc}
          onApply={(card) =>
            mutate((prj) => {
              prj.openingCard = card;
            })
          }
        />
        {oc && (
          <Textarea
            className="h-12 text-xs"
            placeholder={`空なら曲名「${project.meta.title}」`}
            value={oc.text}
            onChange={(e) =>
              mutate((prj) => {
                if (prj.openingCard) prj.openingCard.text = e.target.value;
              })
            }
          />
        )}
        {/* 書式フォーム: credits名簿など複数スロット持ちのタイトルを選んだときだけ出す */}
        {oc &&
          (() => {
            const spec = xpTextSpecById(oc.xpId);
            if (!spec) return null;
            return (
              <XpTextSlotsForm
                spec={spec}
                value={oc.text}
                onChange={(v) =>
                  mutate((prj) => {
                    if (prj.openingCard) prj.openingCard.text = v;
                  })
                }
              />
            );
          })()}
        {/* つまみ: 行クレジット（DetailPanel）と同構成。既定値=従来挙動（曲頭から6秒） */}
        {oc && (
          <div className="space-y-1.5 border-t border-neutral-800 pt-1.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="w-16 shrink-0 text-neutral-400">フォント</span>
              <Select
                value={oc.font}
                onValueChange={(v) =>
                  mutate((prj) => {
                    if (prj.openingCard) prj.openingCard.font = v;
                  })
                }
              >
                <SelectTrigger className="h-6 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="design" className="text-xs">
                    デザイン既定
                  </SelectItem>
                  <SelectItem value="project" className="text-xs">
                    プロジェクトのフォント
                  </SelectItem>
                  {FONT_METAS.map((f) => (
                    <SelectItem key={f.id} value={f.id} className="text-xs">
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(
              [
                { key: "scale", label: "大きさ", min: 0.3, max: 2, step: 0.05, unit: "x" },
                { key: "offsetX", label: "横位置", min: -40, max: 40, step: 1, unit: "%" },
                { key: "offsetY", label: "縦位置", min: -40, max: 40, step: 1, unit: "%" },
                { key: "delay", label: "出だし遅れ", min: 0, max: 10, step: 0.1, unit: "s" },
                { key: "duration", label: "表示時間", min: 0, max: 15, step: 0.5, unit: "s" },
              ] as const
            ).map((k) => (
              <KnobRow
                key={k.key}
                label={k.label}
                min={k.min}
                max={k.max}
                step={k.step}
                unit={k.unit}
                value={oc[k.key]}
                display={
                  k.key === "duration"
                    ? (v) => (v === 0 ? "既定6s" : `${v}${k.unit}`)
                    : undefined
                }
                onChange={(v) =>
                  mutate((prj) => {
                    if (prj.openingCard) prj.openingCard[k.key] = v;
                  })
                }
              />
            ))}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() =>
                  mutate((prj) => {
                    if (!prj.openingCard) return;
                    prj.openingCard.scale = 1;
                    prj.openingCard.offsetX = 0;
                    prj.openingCard.offsetY = 0;
                    prj.openingCard.delay = 0;
                    prj.openingCard.duration = 0;
                  })
                }
                className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-neutral-300"
              >
                <RotateCcw className="size-3" />
                つまみを既定に戻す
              </button>
            </div>
          </div>
        )}
        <XpTitlePicker
          open={titlePickerOpen}
          selectedId={project.openingCard?.xpId ?? null}
          text={project.openingCard?.text.trim() || project.meta.title}
          onOpenChange={setTitlePickerOpen}
          onPick={(id) =>
            mutate((prj) => {
              prj.openingCard = titleCardSchema.parse({
                ...prj.openingCard,
                xpId: id,
                text: prj.openingCard?.text ?? "",
              });
            })
          }
        />
        <p className="text-[10px] text-neutral-600">
          曲の頭に重なります（表示時間の既定は6秒）。テキスト空欄なら曲名を表示。
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Switch
          id="prologue-on"
          checked={p.enabled}
          onCheckedChange={(v) =>
            mutate((prj) => {
              prj.prologue.enabled = v;
            })
          }
        />
        <Label htmlFor="prologue-on">プロローグ（詩の朗読）を入れる</Label>
      </div>

      {p.enabled && (
        <>
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-xs text-neutral-400">
              朗読音声（持込）
            </span>
            <Select
              value={p.audioFile ?? ""}
              onValueChange={(v) =>
                mutate((prj) => {
                  prj.prologue.audioFile = v;
                  prj.prologue.duration = 0; // 再計測
                })
              }
            >
              <SelectTrigger className="h-8 flex-1">
                <SelectValue placeholder="prologue.wav（RVC等で外部作成）" />
              </SelectTrigger>
              <SelectContent>
                {assets.audios.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="font-mono text-xs text-neutral-500">
              {p.duration > 0 ? `${p.duration.toFixed(1)}s` : "未計測"}
            </span>
          </div>

          <NarrationGen />

          <RecordVoiceChange />

          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-xs text-neutral-400">
              曲との重なり
            </span>
            <Slider
              className="flex-1"
              min={0}
              max={8}
              step={0.5}
              value={[p.overlapSec]}
              onValueChange={([v]) =>
                mutate((prj) => {
                  prj.prologue.overlapSec = v;
                })
              }
            />
            <span className="w-12 text-right font-mono text-xs">
              {p.overlapSec}s前
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-xs text-neutral-400">絵（1枚）</span>
            <Select
              value={p.image ?? ""}
              onValueChange={(v) =>
                mutate((prj) => {
                  prj.prologue.image = v;
                })
              }
            >
              <SelectTrigger className="h-8 flex-1">
                <SelectValue placeholder="画像を選択" />
              </SelectTrigger>
              <SelectContent>
                {assets.images.map((img) => (
                  <SelectItem key={img.file} value={img.file}>
                    <span className="flex items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={assetUrl("", projectName, img.file)}
                        alt=""
                        className="h-9 w-16 shrink-0 rounded border border-neutral-700 object-cover"
                      />
                      {img.file.replace(/^images\//, "")}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <div className="mb-1 text-xs text-neutral-400">カメラ</div>
            <EffectPicker
              category="camera"
              value={camera}
              previewImage={p.image ? assetUrl("", projectName, p.image) : null}
              onChange={setCamera}
            />
          </div>

          <div className="space-y-2 rounded border border-neutral-800 p-3">
            <div className="flex items-center gap-3">
              <Switch
                id="sub-on"
                checked={p.subtitle.enabled}
                onCheckedChange={(v) =>
                  mutate((prj) => {
                    prj.prologue.subtitle.enabled = v;
                  })
                }
              />
              <Label htmlFor="sub-on" className="text-xs">
                詩の字幕を出す（均等割り・入替型）
              </Label>
            </div>
            {p.subtitle.enabled && (
              <>
                <Textarea
                  className="h-40 text-xs"
                  placeholder={
                    "空行で連（表示の入替単位）を区切る\n連の中の改行は、そのまま字幕の2行表示になる"
                  }
                  value={
                    stanzaDraft ?? p.subtitle.stanzas.map((s) => s.text).join("\n\n")
                  }
                  onChange={(e) => {
                    setStanzaDraft(e.target.value);
                    mutate((prj) => {
                      const texts = e.target.value
                        .split(/\n{2,}/)
                        .map((t) => t.replace(/^\n+|\n+$/g, ""))
                        .filter((t) => t.trim() !== "");
                      prj.prologue.subtitle.stanzas = texts.map((text, i) => ({
                        text,
                        offset: prj.prologue.subtitle.stanzas[i]?.offset ?? 0,
                      }));
                    });
                  }}
                  onBlur={() => setStanzaDraft(null)}
                />
                {p.subtitle.stanzas.map((st, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-40 truncate text-neutral-400">
                      {i + 1}. {st.text.replace(/\n/g, " ⏎ ")}
                    </span>
                    <span className="font-mono text-neutral-500">
                      {(i * slot + st.offset).toFixed(1)}s〜
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-5 w-8 text-[10px]"
                      onClick={() =>
                        mutate((prj) => {
                          prj.prologue.subtitle.stanzas[i].offset -= 0.5;
                        })
                      }
                    >
                      -0.5
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-5 w-8 text-[10px]"
                      onClick={() =>
                        mutate((prj) => {
                          prj.prologue.subtitle.stanzas[i].offset += 0.5;
                        })
                      }
                    >
                      +0.5
                    </Button>
                  </div>
                ))}
                <p className="text-[10px] text-neutral-500">
                  均等割りが基準。朗読の「間」でズレる連だけオフセットで直す。
                </p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};
