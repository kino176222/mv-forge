"use client";
import { PenLine } from "lucide-react";
import React from "react";
import { useEditor } from "@/lib/store";
import { FontSelect } from "./FontSelect";
import { StylePackSelect } from "./StylePackSelect";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";

/**
 * テロップの全体固定スタイル（貼り紙1枚方式）。
 * 縦/横・フォント・サイズ・色・縁取り・影・位置をプロジェクト全体で1回だけ決める。
 * 行ごとに変えるのはNon-Goal。
 */
export const StyleDialog: React.FC = () => {
  const project = useEditor((s) => s.project);
  const mutate = useEditor((s) => s.mutate);

  if (!project) return null;
  const ts = project.meta.textStyle;

  const posLabel =
    ts.orientation === "vertical" ? "横位置（右⇄左）" : "縦位置（下⇄上）";

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs">
          <PenLine className="size-3.5" /> テロップ様式
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>テロップ様式（作品全体で固定）</DialogTitle>
        </DialogHeader>
        <div className="min-w-0 space-y-3 text-sm">
          {/* プリセット（見た目の型）。ここは詳細調整の場。
              onApplied は渡さない＝推奨テーマは localStorage に入るが、AiPaneのテーマ表示は
              開き直しまで古いまま（この場では許容） */}
          <StylePackSelect />

          <div className="flex items-center gap-2">
            <span className="w-24 text-xs text-neutral-400">縦書き/横書き</span>
            <Select
              value={ts.orientation}
              onValueChange={(v) =>
                mutate((p) => {
                  p.meta.textStyle.orientation = v as "horizontal" | "vertical";
                })
              }
            >
              <SelectTrigger className="h-8 w-full min-w-0 flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="horizontal">横書き（下部センター）</SelectItem>
                <SelectItem value="vertical">縦書き（右側・右→左送り）</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* フォント一式（収録＋ローカル＋手入力＋プレビュー） */}
          <FontSelect />

          <div className="flex items-center gap-2">
            <span className="w-24 text-xs text-neutral-400">サイズ</span>
            <Slider
              className="flex-1"
              min={28}
              max={120}
              step={2}
              value={[ts.size]}
              onValueChange={([v]) =>
                mutate((p) => {
                  p.meta.textStyle.size = v;
                })
              }
            />
            <span className="w-10 text-right font-mono text-xs">{ts.size}px</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-24 text-xs text-neutral-400">文字色</span>
            <input
              type="color"
              value={ts.color}
              onChange={(e) =>
                mutate((p) => {
                  p.meta.textStyle.color = e.target.value;
                })
              }
              className="h-8 w-10 shrink-0 cursor-pointer rounded border border-neutral-800 bg-neutral-900 p-0"
            />
            <input
              type="text"
              value={ts.color}
              onChange={(e) =>
                mutate((p) => {
                  p.meta.textStyle.color = e.target.value;
                })
              }
              className="flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 font-mono text-[11px] text-neutral-200 focus:border-neutral-600 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="w-24 text-xs text-neutral-400">縁取り太さ</span>
            <Slider
              className="flex-1"
              min={0}
              max={10}
              step={1}
              value={[ts.strokeWidth]}
              onValueChange={([v]) =>
                mutate((p) => {
                  p.meta.textStyle.strokeWidth = v;
                })
              }
            />
            <span className="w-10 text-right font-mono text-xs">{ts.strokeWidth}px</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-24 text-xs text-neutral-400">縁色</span>
            <input
              type="color"
              value={ts.strokeColor}
              onChange={(e) =>
                mutate((p) => {
                  p.meta.textStyle.strokeColor = e.target.value;
                })
              }
              className="h-8 w-10 shrink-0 cursor-pointer rounded border border-neutral-800 bg-neutral-900 p-0"
            />
            <input
              type="text"
              value={ts.strokeColor}
              onChange={(e) =>
                mutate((p) => {
                  p.meta.textStyle.strokeColor = e.target.value;
                })
              }
              className="flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 font-mono text-[11px] text-neutral-200 focus:border-neutral-600 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="w-24 text-xs text-neutral-400">影の濃さ</span>
            <Slider
              className="flex-1"
              min={0}
              max={1}
              step={0.05}
              value={[ts.shadow]}
              onValueChange={([v]) =>
                mutate((p) => {
                  p.meta.textStyle.shadow = v;
                })
              }
            />
            <span className="w-10 text-right font-mono text-xs">{ts.shadow.toFixed(2)}</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-24 text-xs text-neutral-400">{posLabel}</span>
            <Slider
              className="flex-1"
              min={2}
              max={92}
              step={1}
              value={[ts.posY]}
              onValueChange={([v]) =>
                mutate((p) => {
                  p.meta.textStyle.posY = v;
                })
              }
            />
            <span className="w-10 text-right font-mono text-xs">{ts.posY}%</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-24 text-xs text-neutral-400">歌詞を表示</span>
            <Switch
              checked={project.meta.showLyrics}
              onCheckedChange={(v) =>
                mutate((p) => {
                  p.meta.showLyrics = v;
                })
              }
            />
            <span className="flex-1 text-[11px] text-neutral-500">
              OFF=歌詞なしMV（クレジット・オープニング・エンドカードは出続ける）
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-24 text-xs text-neutral-400">歌い終わりで消す</span>
            <Switch
              checked={project.meta.lyricAutoHide}
              onCheckedChange={(v) =>
                mutate((p) => {
                  p.meta.lyricAutoHide = v;
                })
              }
            />
            <span className="flex-1 text-[11px] text-neutral-500">
              最後の単語の歌い終わり+0.8秒でフェードアウト（単語タイミングがある行のみ。行の「表示時間」つまみが優先）
            </span>
          </div>

          <p className="text-[11px] text-neutral-500">
            位置スライダーは中央プレビューに即反映。プロローグ演出は専用位置で固定です。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
