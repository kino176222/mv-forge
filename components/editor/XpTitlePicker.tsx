"use client";

import { readXpFavorites } from "@/lib/xp/favorites";
import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { XP_TITLE_METAS } from "@/lib/xp/bridge";
import { MVFORGE_DIST } from "@/lib/brand";
import { XP_CURATED_OUTRO_TITLES } from "@/lib/xp/curated";
import {
  xpCleanStatusOf,
  XP_CLEAN_STATUS_UI,
} from "@/lib/xp/clean-status";
import { LazyPlayerCard } from "@/components/effects/LazyPlayerCard";
import {
  FxPreview,
  FX_PREVIEW_FRAMES,
  FX_PREVIEW_FPS,
} from "@/remotion/FxPreview";
import { cn } from "@/lib/utils";

/**
 * タイトルデザインの選択ダイアログ（タイトル/クレジットレーン共用）。
 * アウトロのエンドカード・オープニングタイトル・行クレジットの3口から呼ばれる。
 * 既定は curated 手札＋★（図鑑のお気に入り）を先頭に、検索とpackチップで全248本を絞り込める。
 * プレビューは実テキスト（曲名等）を流し込んだライブ再生。
 */

const FAVORITES_KEY = "xp-gallery-favorites";

const readFavorites = (): Set<string> => new Set(readXpFavorites());

export const XpTitlePicker: React.FC<{
  open: boolean;
  selectedId?: string | null;
  /** プレビューに流し込むテキスト（曲名・アーティスト名など） */
  text?: string;
  onOpenChange(open: boolean): void;
  onPick(id: string): void;
}> = ({ open, selectedId = null, text = "", onOpenChange, onPick }) => {
  const [query, setQuery] = React.useState("");
  const [pack, setPack] = React.useState<string | null>(null);
  const [all, setAll] = React.useState(false);
  // openのたびに読み直す（図鑑側で★を付けた直後にも反映される）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const favorites = React.useMemo(() => readFavorites(), [open]);

  const packs = React.useMemo(
    () => [...new Set(XP_TITLE_METAS.map((m) => m.pack))],
    [],
  );

  const items = React.useMemo(() => {
    const curated = new Set(XP_CURATED_OUTRO_TITLES);
    let list = XP_TITLE_METAS;
    if (!all && !query.trim() && !pack) {
      list = list.filter((m) => curated.has(m.id) || favorites.has(m.id));
    }
    if (pack) list = list.filter((m) => m.pack === pack);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.id.includes(q) ||
          (m.tagline ?? "").toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q),
      );
    }
    // ★お気に入り → curated → その他 の順
    return [...list].sort((a, b) => {
      const fa = favorites.has(a.id) ? 0 : curated.has(a.id) ? 1 : 2;
      const fb = favorites.has(b.id) ? 0 : curated.has(b.id) ? 1 : 2;
      return fa - fb;
    });
  }, [all, query, pack, favorites]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-5xl overflow-y-auto bg-neutral-950 text-neutral-100">
        <DialogHeader>
          <DialogTitle className="text-sm">
            タイトルデザインを選ぶ — クリックで適用（{items.length}本
            {all || query || pack ? ` / 全${XP_TITLE_METAS.length}本` : "＝手札"}）
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="名前・説明で検索"
            className="min-w-40 flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setPack(null)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px]",
              pack === null
                ? "border-amber-400 text-amber-300"
                : "border-neutral-700 text-neutral-400 hover:border-neutral-500",
            )}
          >
            全pack
          </button>
          {packs.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPack(pack === p ? null : p)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px]",
                pack === p
                  ? "border-amber-400 text-amber-300"
                  : "border-neutral-700 text-neutral-400 hover:border-neutral-500",
              )}
            >
              {p}
            </button>
          ))}
          {!all && !query && !pack && (
            <button
              type="button"
              onClick={() => setAll(true)}
              className="text-[10px] text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline"
            >
              全{XP_TITLE_METAS.length}本を表示
            </button>
          )}
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
          {items.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                onPick(m.id);
                onOpenChange(false);
              }}
              title={`${m.name}${m.tagline ? `（${m.tagline}）` : ""}`}
              className={cn(
                "group flex flex-col overflow-hidden rounded border text-left",
                selectedId === m.id
                  ? "border-amber-400 ring-1 ring-amber-400/40"
                  : "border-neutral-800 hover:border-neutral-600",
              )}
            >
              <LazyPlayerCard
                component={FxPreview as React.FC<Record<string, unknown>>}
                inputProps={{
                  effectId: "__xp-title__",
                  xpTitleId: m.id,
                  titleText: text,
                }}
                durationInFrames={FX_PREVIEW_FRAMES}
                fps={FX_PREVIEW_FPS}
                width={640}
                height={360}
                hoverToPlay
              />
              <span className="flex items-center gap-1 truncate px-1.5 py-1 text-[10px] text-neutral-300">
                {favorites.has(m.id) && <span className="shrink-0">★</span>}
                <span className="truncate">
                  {m.name}
                  {m.tagline ? `（${m.tagline}）` : ""}
                </span>
                {(() => {
                  // 配布仕分けバッジ（私用ビルド限定。緑=公開OK / 琥珀=作り直し / 赤=私用のみ）
                  const status = MVFORGE_DIST ? undefined : xpCleanStatusOf(m.id);
                  if (!status) return null;
                  const ui = XP_CLEAN_STATUS_UI[status];
                  return (
                    <span
                      title={`配布仕分け: ${ui.label}`}
                      className={cn(
                        "ml-auto flex shrink-0 items-center gap-1 text-[9px]",
                        ui.textClass,
                      )}
                    >
                      <span
                        className={cn("size-1.5 rounded-full", ui.dotClass)}
                      />
                      {ui.label}
                    </span>
                  );
                })()}
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
