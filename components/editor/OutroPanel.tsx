"use client";
import { Film, RotateCcw } from "lucide-react";
import React from "react";
import { useEditor } from "@/lib/store";
import { EffectPicker } from "./EffectPicker";
import { KnobRow } from "./KnobRow";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { EffectInstance, EndCard } from "@/lib/schema";
import { assetUrl } from "@/remotion/asset-url";
import { xpTitleMetaById } from "@/lib/xp/bridge";
import { xpTextSpecById } from "@/lib/xp/text-specs";
import { FONT_METAS } from "@/lib/fonts-meta";
import { XpTextSlotsForm } from "./XpTextSlotsForm";
import { XpTitlePicker } from "./XpTitlePicker";

const CAMERA_IDS = ["slow-zoom-in", "slow-zoom-out", "pan", "parallax"];

/** アウトロ: 1枚絵＋エフェクトで余韻 → 黒フェード */
export const OutroPanel: React.FC = () => {
  const project = useEditor((s) => s.project);
  const projectName = useEditor((s) => s.projectName);
  const assets = useEditor((s) => s.assets);
  const mutate = useEditor((s) => s.mutate);
  const [titlePickerOpen, setTitlePickerOpen] = React.useState(false);
  if (!project) return null;
  const o = project.outro;
  const camera = o.effects.find((e) => CAMERA_IDS.includes(e.id)) ?? null;

  const setCamera = (v: EffectInstance | null) =>
    mutate((prj) => {
      const rest = prj.outro.effects.filter((e) => !CAMERA_IDS.includes(e.id));
      prj.outro.effects = v ? [v, ...rest] : rest;
    });

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4 text-sm">
      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 text-xs text-neutral-400">余韻の長さ</span>
        <Slider
          className="flex-1"
          min={0}
          max={15}
          step={0.5}
          value={[o.duration]}
          onValueChange={([v]) =>
            mutate((prj) => {
              prj.outro.duration = v;
            })
          }
        />
        <span className="w-10 text-right font-mono text-xs">{o.duration}s</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 text-xs text-neutral-400">絵（1枚）</span>
        <Select
          value={o.image ?? ""}
          onValueChange={(v) =>
            mutate((prj) => {
              prj.outro.image = v;
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
            {assets.videos.map((v) => (
              <SelectItem key={v.file} value={v.file}>
                <span className="flex items-center gap-2">
                  <video
                    src={assetUrl("", projectName, v.file)}
                    muted
                    preload="metadata"
                    className="h-9 w-16 shrink-0 rounded border border-sky-800 object-cover"
                  />
                  <Film className="size-3 shrink-0 text-sky-400" />{" "}
                  {v.file.replace(/^videos\//, "")}
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
          previewImage={o.image ? assetUrl("", projectName, o.image) : null}
          onChange={setCamera}
        />
      </div>

      {/* 全体ルックの除外（ルック使用時のみ表示） */}
      {project.look.effects.length > 0 && (
        <div className="flex items-center gap-2">
          <Switch
            id="outro-look-off"
            checked={o.lookOff}
            onCheckedChange={(v) =>
              mutate((prj) => {
                prj.outro.lookOff = v;
              })
            }
          />
          <Label
            htmlFor="outro-look-off"
            className="text-[11px] text-neutral-400"
            title="全体ルック（色味・質感）をアウトロだけ外して素の画にします。エンドカードの文字には元々掛かりません"
          >
            アウトロはルックを外す
          </Label>
        </div>
      )}

      <div className="space-y-2 rounded border border-neutral-800 p-3">
        <div className="text-xs text-neutral-400">エンドカード</div>
        <Select
          value={o.endCard.preset}
          onValueChange={(v) =>
            mutate((prj) => {
              prj.outro.endCard.preset = v as EndCard["preset"];
            })
          }
        >
          <SelectTrigger className="h-8 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">自由テキスト（プリセットなし）</SelectItem>
            <SelectItem value="simple">
              シンプル — 曲名＋アーティスト名（映画タイトル風）
            </SelectItem>
            <SelectItem value="credits">
              クレジット — SONG / ARTIST / CREATED BY が順に浮かぶ
            </SelectItem>
            <SelectItem value="cinema">
              シネマ — 黒帯＋「CREATED BY ◯◯」がピント合焦
            </SelectItem>
            <SelectItem value="xp">
              タイトルデザイン — カタログ248本から選ぶ
            </SelectItem>
          </SelectContent>
        </Select>

        {/* タイトルデザイン: 一覧から選ぶ＋表示テキスト上書き */}
        {o.endCard.preset === "xp" && (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setTitlePickerOpen(true)}
              className="flex w-full items-center justify-between rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-left text-xs transition hover:border-neutral-600"
            >
              <span className="truncate">
                {o.endCard.xpId
                  ? (xpTitleMetaById(o.endCard.xpId)?.name ?? o.endCard.xpId)
                  : "タイトルを選ぶ…"}
              </span>
              <span className="shrink-0 text-neutral-500">一覧から選ぶ</span>
            </button>
            <textarea
              className="h-14 w-full rounded-md border border-input bg-transparent p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder={"空なら自動: 曲名・アーティスト・Created by を改行で連結"}
              value={o.endCard.xpText}
              onChange={(e) =>
                mutate((prj) => {
                  prj.outro.endCard.xpText = e.target.value;
                })
              }
            />
            {/* 書式フォーム: credits名簿など複数スロット持ちのタイトルを選んだときだけ出す */}
            {o.endCard.xpId &&
              (() => {
                const spec = xpTextSpecById(o.endCard.xpId);
                if (!spec) return null;
                return (
                  <XpTextSlotsForm
                    spec={spec}
                    value={o.endCard.xpText}
                    onChange={(v) =>
                      mutate((prj) => {
                        prj.outro.endCard.xpText = v;
                      })
                    }
                  />
                );
              })()}
            {/* つまみ: 行クレジット（DetailPanel）と同構成。既定値=従来挙動 */}
            <div className="space-y-1.5 border-t border-neutral-800 pt-1.5">
              <div className="flex items-center gap-2 text-xs">
                <span className="w-16 shrink-0 text-neutral-400">フォント</span>
                <Select
                  value={o.endCard.font}
                  onValueChange={(v) =>
                    mutate((prj) => {
                      prj.outro.endCard.font = v;
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
                  value={o.endCard[k.key]}
                  display={
                    k.key === "duration"
                      ? (v) => (v === 0 ? "既定" : `${v}${k.unit}`)
                      : undefined
                  }
                  onChange={(v) =>
                    mutate((prj) => {
                      prj.outro.endCard[k.key] = v;
                    })
                  }
                />
              ))}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() =>
                    mutate((prj) => {
                      prj.outro.endCard.scale = 1;
                      prj.outro.endCard.offsetX = 0;
                      prj.outro.endCard.offsetY = 0;
                      prj.outro.endCard.delay = 0;
                      prj.outro.endCard.duration = 0;
                    })
                  }
                  className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-neutral-300"
                >
                  <RotateCcw className="size-3" />
                  つまみを既定に戻す
                </button>
              </div>
              <p className="text-[10px] text-neutral-600">
                表示時間「既定」＝アウトロの間ずっと表示（退場演出は6秒目）。指定するとその秒数だけ出ます。
              </p>
            </div>
            <XpTitlePicker
              open={titlePickerOpen}
              selectedId={o.endCard.xpId}
              text={
                o.endCard.xpText.trim() ||
                (o.endCard.songTitle.trim() || project.meta.title)
              }
              onOpenChange={setTitlePickerOpen}
              onPick={(id) =>
                mutate((prj) => {
                  prj.outro.endCard.xpId = id;
                })
              }
            />
          </div>
        )}

        {o.endCard.preset !== "none" ? (
          <div className="space-y-1.5">
            {(
              [
                { key: "songTitle", label: "曲名", placeholder: `空なら「${project.meta.title}」` },
                { key: "artistName", label: "アーティスト", placeholder: "例: RAdio" },
                { key: "createdBy", label: "Created by", placeholder: "例: Kino" },
              ] as const
            ).map((f) => (
              <div key={f.key} className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-xs text-neutral-400">{f.label}</span>
                <Input
                  className="h-7 flex-1 text-xs"
                  placeholder={f.placeholder}
                  value={o.endCard[f.key]}
                  onChange={(e) =>
                    mutate((prj) => {
                      prj.outro.endCard[f.key] = e.target.value;
                    })
                  }
                />
              </div>
            ))}
            <p className="text-[10px] text-neutral-600">
              空欄の項目は表示されません（シネマは Created by → アーティスト → 曲名の順で主役を選びます）。
            </p>
          </div>
        ) : (
          <>
            <textarea
              className="h-16 w-full rounded-md border border-input bg-transparent p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="ご視聴ありがとうございました"
              value={o.text}
              onChange={(e) =>
                mutate((prj) => {
                  prj.outro.text = e.target.value;
                })
              }
            />
            {o.text.trim() !== "" && (
              <div>
                <div className="mb-1 text-xs text-neutral-400">文字の出方</div>
                <EffectPicker
                  category="lyric"
                  value={o.textAnim}
                  noneLabel="既定（ゆっくりフェード）"
                  onChange={(v) =>
                    mutate((prj) => {
                      prj.outro.textAnim = v;
                    })
                  }
                />
              </div>
            )}
          </>
        )}
      </div>
      <p className="text-[11px] text-neutral-500">
        アウトロの最後は自動で黒へフェードします（1.2秒）。
      </p>
    </div>
  );
};
