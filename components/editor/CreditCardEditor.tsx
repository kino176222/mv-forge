"use client";
import React from "react";
import { RotateCcw } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { titleCardSchema, type TitleCard, type SlotStyle } from "@/lib/schema";
import { FONT_METAS } from "@/lib/fonts-meta";
import { xpTitleMetaById } from "@/lib/xp/bridge";
import { xpTextSpecById } from "@/lib/xp/text-specs";
import { supportsXpLineStyles } from "@/lib/xp/line-styles-support";
import { CreditPresetBar } from "./CreditPresetBar";
import { XpTitlePicker } from "./XpTitlePicker";
import { XpTextSlotsForm, XpLineColorRows } from "./XpTextSlotsForm";

/**
 * 🎬 クレジットカード編集（共通部品）。
 * オープニング/行クレジット/ショットクレジットの titleCard を1つのUIで編集する
 * 「編集口はどこでも同じ」の単一の真実。レーンのポップオーバーからも DetailPanel からも使う。
 * つまみはスライダー（直感操作）＝2026-07-17 Kino要望。
 */

/** ラベル＋スライダー＋数値の1行（クレジット用の直感つまみ） */
const SliderRow: React.FC<{
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  value: number;
  display?: (v: number) => string;
  onChange: (v: number) => void;
}> = ({ label, min, max, step, unit, value, display, onChange }) => (
  <div className="flex items-center gap-2 text-xs">
    <span className="w-16 shrink-0 text-neutral-400">{label}</span>
    <Slider
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={(v: number[]) => onChange(v[0] ?? value)}
      className="flex-1"
    />
    <span className="w-12 shrink-0 text-right font-mono text-[10px] text-neutral-400">
      {display ? display(value) : `${value}${unit}`}
    </span>
  </div>
);

export const CreditCardEditor: React.FC<{
  value: TitleCard | null;
  onChange: (card: TitleCard | null) => void;
  /** 図鑑プレビューに流すテキスト（未入力時のダミー） */
  previewText?: string;
}> = ({ value, onChange, previewText = "CREDIT" }) => {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const patch = (p: Partial<TitleCard>) => {
    if (!value) return;
    onChange({ ...value, ...p });
  };

  return (
    <div className="space-y-1.5">
      {/* デザイン選択（タイトルデザイン図鑑） */}
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="flex w-full items-center justify-between rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-left text-xs transition hover:border-neutral-600"
      >
        <span className="truncate">
          {value
            ? (xpTitleMetaById(value.xpId)?.name ?? value.xpId)
            : "なし — タイトル/クレジットを重ねる"}
        </span>
        <span className="shrink-0 text-neutral-500">デザインを選ぶ</span>
      </button>

      {/* 作り置き: プリセットから差す／今の設定を保存（プロジェクト横断） */}
      <CreditPresetBar current={value} onApply={(card) => onChange(card)} />

      {value && (
        <>
          <textarea
            rows={Math.max(1, value.text.split("\n").length)}
            value={value.text}
            onChange={(e) => patch({ text: e.target.value })}
            placeholder="表示テキスト（必須。例: Created by Kino。Enterで改行）"
            className="w-full resize-none rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
          />

          {/* 書式フォーム: credits名簿など複数スロット持ちのタイトルのときだけ */}
          {(() => {
            const spec = xpTextSpecById(value.xpId);
            const lineColors = supportsXpLineStyles(value.xpId);
            const setSlotStyles = (s: SlotStyle[]) => patch({ slotStyles: s });
            if (spec) {
              return (
                <XpTextSlotsForm
                  spec={spec}
                  value={value.text}
                  onChange={(v) => patch({ text: v })}
                  slotStyles={lineColors ? value.slotStyles : undefined}
                  onSlotStylesChange={lineColors ? setSlotStyles : undefined}
                />
              );
            }
            if (lineColors && value.text.includes("\n")) {
              return (
                <XpLineColorRows
                  text={value.text}
                  styles={value.slotStyles}
                  onChange={setSlotStyles}
                />
              );
            }
            return null;
          })()}

          {/* フォント・文字色 */}
          <div className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0 text-neutral-400">フォント</span>
            <Select value={value.font} onValueChange={(v) => patch({ font: v })}>
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
          <div className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0 text-neutral-400">文字色</span>
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(value.color) ? value.color : "#ffffff"}
              onChange={(e) => patch({ color: e.target.value })}
              className="h-6 w-8 shrink-0 cursor-pointer rounded border border-neutral-800 bg-neutral-900 p-0"
            />
            <span className="flex-1 truncate font-mono text-[11px] text-neutral-500">
              {value.color || "デザイン既定"}
            </span>
            {value.color && (
              <button
                type="button"
                title="デザイン既定の色に戻す"
                onClick={() => patch({ color: "" })}
                className="shrink-0 text-[10px] text-neutral-500 hover:text-neutral-300"
              >
                既定
              </button>
            )}
          </div>

          {/* 位置・大きさ・タイミング（スライダー＝直感操作） */}
          <div className="space-y-1.5 border-t border-neutral-800 pt-1.5">
            <SliderRow label="大きさ" min={0.3} max={2} step={0.05} unit="x" value={value.scale} onChange={(v) => patch({ scale: v })} />
            <SliderRow label="横位置" min={-40} max={40} step={1} unit="%" value={value.offsetX} onChange={(v) => patch({ offsetX: v })} />
            <SliderRow label="縦位置" min={-40} max={40} step={1} unit="%" value={value.offsetY} onChange={(v) => patch({ offsetY: v })} />
            <SliderRow label="出だし遅れ" min={0} max={10} step={0.1} unit="s" value={value.delay} onChange={(v) => patch({ delay: Math.round(v * 10) / 10 })} />
            <SliderRow
              label="表示時間"
              min={0}
              max={15}
              step={0.5}
              unit="s"
              value={value.duration}
              display={(v) => (v === 0 ? "次まで" : `${v}s`)}
              onChange={(v) => patch({ duration: v })}
            />
            <div className="flex items-center gap-2 text-xs">
              <span className="w-16 shrink-0 text-neutral-400">入り方</span>
              <Select
                value={value.enterStyle}
                onValueChange={(v) => patch({ enterStyle: v as TitleCard["enterStyle"] })}
              >
                <SelectTrigger className="h-6 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fade" className="text-xs">フェード（ふわっ）</SelectItem>
                  <SelectItem value="rise" className="text-xs">下からふわっ</SelectItem>
                  <SelectItem value="fall" className="text-xs">上からすっ</SelectItem>
                  <SelectItem value="blur" className="text-xs">ぼかしから現れる</SelectItem>
                  <SelectItem value="pop" className="text-xs">ポップ（少し拡大しながら）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <SliderRow
              label="入りの長さ"
              min={0}
              max={3}
              step={0.1}
              unit="s"
              value={value.fadeIn}
              display={(v) => (v === 0 ? "なし" : `${v}s`)}
              onChange={(v) => patch({ fadeIn: Math.round(v * 10) / 10 })}
            />
            <div className="flex items-center gap-2 text-xs">
              <span className="w-16 shrink-0 text-neutral-400">抜き方</span>
              <Select
                value={value.exitStyle}
                onValueChange={(v) => patch({ exitStyle: v as TitleCard["exitStyle"] })}
              >
                <SelectTrigger className="h-6 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fade" className="text-xs">フェード（すっ）</SelectItem>
                  <SelectItem value="rise" className="text-xs">下へ抜ける</SelectItem>
                  <SelectItem value="fall" className="text-xs">上へ抜ける</SelectItem>
                  <SelectItem value="blur" className="text-xs">ぼけて消える</SelectItem>
                  <SelectItem value="pop" className="text-xs">縮みながら消える</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <SliderRow
              label="抜きの長さ"
              min={0}
              max={3}
              step={0.1}
              unit="s"
              value={value.fadeOut}
              display={(v) => (v === 0 ? "なし" : `${v}s`)}
              onChange={(v) => patch({ fadeOut: Math.round(v * 10) / 10 })}
            />
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() =>
                  patch({
                    scale: 1,
                    offsetX: 0,
                    offsetY: 0,
                    delay: 0,
                    duration: 0,
                    fadeIn: 0,
                    fadeOut: 0,
                  })
                }
                className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-neutral-300"
              >
                <RotateCcw className="size-3" />
                つまみを既定に戻す
              </button>
              <button
                type="button"
                onClick={() => onChange(null)}
                className="text-[10px] text-neutral-500 hover:text-red-400"
              >
                このクレジットを外す
              </button>
            </div>
          </div>
        </>
      )}

      <XpTitlePicker
        open={pickerOpen}
        selectedId={value?.xpId ?? null}
        text={value?.text || previewText}
        onOpenChange={setPickerOpen}
        onPick={(id) =>
          onChange(
            titleCardSchema.parse({
              ...value,
              xpId: id,
              text: value?.text ?? "",
            }),
          )
        }
      />
    </div>
  );
};
