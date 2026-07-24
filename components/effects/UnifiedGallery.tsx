"use client";
import { readXpFavorites } from "@/lib/xp/favorites";
import { BASE_PACK_LABEL, MVFORGE_DIST } from "@/lib/brand";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Star, X } from "lucide-react";
import { Player } from "@remotion/player";
import {
  XP_PORTS,
  type XpPort,
} from "@/remotion/effects/xp/registry";
import { EFFECTS, type EffectMeta } from "@/lib/effects-meta";
import {
  FxPreview,
  FX_PREVIEW_FRAMES,
  FX_PREVIEW_FPS,
} from "@/remotion/FxPreview";
import { cn } from "@/lib/utils";
import {
  xpCleanStatusOf,
  XP_CLEAN_STATUS_UI,
} from "@/lib/xp/clean-status";
import { isArchived } from "@/lib/xp/archived";
import { matchesGalleryQuery } from "@/lib/gallery-search";

/**
 * 統一図鑑: 自作部品（effects-meta 116+）と 拡張パック（560+）を1つのブラウズ体験に。
 * 検索・お気に入り・ホバー再生・ライトボックスのUXを全部品に適用する。
 * /effects と /xp は同じこのコンポーネントを初期フィルタ違いで表示する。
 */

export type GallerySource = "all" | "native" | "xp";

interface GalleryItem {
  id: string;
  name: string;
  sub: string | null; // tagline（拡張）
  code: string | null; // 元コード（拡張）/ id（native）
  pack: string; // 基本パック or 拡張パック名
  source: "native" | "xp";
  category: string; // 表示用カテゴリキー
  description: string;
  // プレビュー
  Comp: React.FC<Record<string, unknown>>;
  inputProps?: Record<string, unknown>;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
}

const NATIVE_CATEGORY_LABEL: Record<string, string> = {
  camera: "カメラ",
  overlay: "オーバーレイ",
  transition: "切り替え",
  lyric: "リリック",
  decor: "装飾",
  look: "ルック",
};
const XP_CATEGORY_LABEL: Record<string, string> = {
  transition: "切り替え",
  title: "タイトル",
  subtitle: "サブタイトル",
  effect: "エフェクト",
  background: "背景",
};
// 統一カテゴリの表示順
const CATEGORY_ORDER = [
  "カメラ",
  "切り替え",
  "オーバーレイ",
  "エフェクト",
  "リリック",
  "装飾",
  "タイトル",
  "サブタイトル",
  "背景",
  "ルック",
];

const FAV_KEY = "xp-gallery-favorites"; // 既存の星をそのまま引き継ぐ

// サムネ静止画（public/fx-posters/<safe>.jpg）。グリッドはこれだけ描画して軽くする。
// 動きは「クリックで拡大（ライトボックス）」でのみ Player を1枚だけ再生する。
const posterSafe = (id: string) => id.replace(/[^a-z0-9-]/gi, "_");
const posterUrl = (id: string) => `/fx-posters/${posterSafe(id)}.jpg`;

// 目視レビューの4判定（アーカイブ/クリーン化=公開可に/磨き/そのまま公開OK）
export type ReviewKey = "archive" | "clean" | "brushup" | "ok";
export type Decision = Partial<Record<ReviewKey, boolean>> & { note?: string };
const REVIEW_KINDS: { key: ReviewKey; label: string; on: string }[] = [
  { key: "archive", label: "アーカイブ", on: "border-rose-400 bg-rose-500/15 text-rose-300" },
  { key: "clean", label: "クリーン", on: "border-amber-400 bg-amber-500/15 text-amber-300" },
  { key: "brushup", label: "磨き", on: "border-violet-400 bg-violet-500/15 text-violet-300" },
  { key: "ok", label: "公開OK", on: "border-emerald-400 bg-emerald-500/15 text-emerald-300" },
];

function nativeToItem(e: EffectMeta): GalleryItem {
  return {
    id: e.id,
    name: e.name,
    sub: null,
    code: e.id,
    pack: BASE_PACK_LABEL,
    source: "native",
    category: NATIVE_CATEGORY_LABEL[e.category] ?? e.category,
    description: e.description,
    Comp: FxPreview as React.FC<Record<string, unknown>>,
    inputProps: { effectId: e.id },
    durationInFrames: FX_PREVIEW_FRAMES,
    fps: FX_PREVIEW_FPS,
    width: 640,
    height: 360,
  };
}

function xpToItem(p: XpPort): GalleryItem {
  return {
    id: p.id,
    name: p.name,
    sub: p.tagline ?? null,
    code: p.code,
    pack: p.pack,
    source: "xp",
    category: XP_CATEGORY_LABEL[p.category] ?? p.category,
    description: p.description,
    Comp: p.Preview as React.FC<Record<string, unknown>>,
    durationInFrames: p.durationInFrames,
    fps: p.fps,
    width: p.width,
    height: p.height,
  };
}

function Lightbox({ item, onClose }: { item: GalleryItem; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${item.name} プレビュー`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm sm:p-8"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl"
      >
        <div className="relative aspect-video w-full bg-black">
          <Player
            component={item.Comp}
            inputProps={item.inputProps}
            durationInFrames={item.durationInFrames}
            fps={item.fps}
            compositionWidth={item.width}
            compositionHeight={item.height}
            style={{ width: "100%", height: "100%" }}
            loop
            autoPlay
            initiallyMuted
            numberOfSharedAudioTags={0}
            controls={false}
            clickToPlay={false}
          />
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="absolute right-3 top-3 rounded-full bg-neutral-950/70 p-2 text-neutral-200 backdrop-blur transition-colors hover:bg-neutral-800"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="space-y-2 p-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-lg font-semibold text-neutral-50">{item.name}</h3>
            {item.sub && (
              <span className="text-sm font-medium text-violet-300">{item.sub}</span>
            )}
            <span className="ml-auto shrink-0 font-mono text-xs text-neutral-500">
              {item.code}
            </span>
          </div>
          <p className="text-[13px] leading-relaxed text-neutral-300">
            <span className="mr-1.5 rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[11px] text-neutral-300">
              {item.pack}
            </span>
            {item.description}
          </p>
        </div>
      </div>
    </div>
  );
}

function Card({
  item,
  fav,
  onToggleFav,
  onOpen,
  reviewMode = false,
  decision,
  onDecision,
  onNote,
}: {
  item: GalleryItem;
  fav: boolean;
  onToggleFav: () => void;
  onOpen: () => void;
  reviewMode?: boolean;
  decision?: Decision;
  onDecision?: (key: ReviewKey, value: boolean) => void;
  onNote?: (note: string) => void;
}) {
  // 配布仕分けバッジ（拡張パックのみ・私用ビルド限定。緑=公開OK / 琥珀=作り直し / 赤=私用のみ）
  const status =
    !MVFORGE_DIST && item.source === "xp" ? xpCleanStatusOf(item.id) : undefined;
  const [noteDraft, setNoteDraft] = useState(decision?.note ?? "");
  useEffect(() => {
    setNoteDraft(decision?.note ?? "");
  }, [decision?.note]);
  const archived = !!decision?.archive;
  const reviewed = !!decision && Object.values(decision).some(Boolean);
  return (
    <div
      id={item.id}
      className={cn(
        "group scroll-mt-20 overflow-hidden rounded-xl border bg-neutral-900/50 transition-colors hover:border-violet-500",
        archived
          ? "border-rose-500/60 opacity-55"
          : reviewed
            ? "border-emerald-500/50"
            : "border-neutral-800",
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        aria-label={`${item.name} を拡大`}
        className="relative cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
      >
        <div className="relative aspect-video w-full overflow-hidden rounded bg-neutral-950">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={posterUrl(item.id)}
            alt={item.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            onError={(e) => {
              e.currentTarget.style.visibility = "hidden";
            }}
          />
          <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded bg-neutral-950/70 px-1.5 py-0.5 text-[9px] font-medium text-neutral-300 backdrop-blur">
            ▶ クリックで再生
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFav();
          }}
          aria-label="お気に入り"
          className={`absolute right-2 top-2 rounded-full bg-neutral-950/60 p-1.5 backdrop-blur transition-opacity ${
            fav ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          <Star
            className={`size-4 ${fav ? "fill-yellow-400 text-yellow-400" : "text-neutral-300"}`}
          />
        </button>
      </div>
      <div className="flex items-baseline justify-between gap-2 px-2.5 pt-1.5">
        <span className="truncate text-xs font-medium text-neutral-100">
          {item.name}
        </span>
        {status && (
          <span
            title={`配布仕分け: ${XP_CLEAN_STATUS_UI[status].label}`}
            className={cn(
              "flex shrink-0 items-center gap-1 text-[9px]",
              XP_CLEAN_STATUS_UI[status].textClass,
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                XP_CLEAN_STATUS_UI[status].dotClass,
              )}
            />
            {XP_CLEAN_STATUS_UI[status].label}
          </span>
        )}
        <span className="shrink-0 font-mono text-[10px] tracking-wide text-neutral-500">
          {item.code}
        </span>
      </div>
      {item.sub && (
        <p
          className="truncate px-2.5 pt-0.5 text-[11px] font-medium text-violet-300/90"
          title={item.sub}
        >
          {item.sub}
        </p>
      )}
      <p
        className="line-clamp-2 px-2.5 pb-2 pt-1 text-[10px] leading-snug text-neutral-400"
        title={item.description}
      >
        <span
          className={cn(
            "mr-1 rounded px-1 py-0.5 font-mono text-[9px]",
            item.source === "native"
              ? "bg-emerald-900/60 text-emerald-300"
              : "bg-neutral-800 text-neutral-300",
          )}
        >
          {item.pack}
        </span>
        {item.description}
      </p>
      {reviewMode && (
        <div className="flex flex-wrap gap-1 border-t border-neutral-800 px-2 py-1.5">
          {REVIEW_KINDS.map((k) => {
            const active = !!decision?.[k.key];
            return (
              <button
                key={k.key}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDecision?.(k.key, !active);
                }}
                aria-pressed={active}
                className={cn(
                  "rounded border px-1.5 py-0.5 text-[9px] font-semibold transition-colors",
                  active
                    ? k.on
                    : "border-neutral-700 text-neutral-500 hover:border-neutral-500",
                )}
              >
                {k.label}
              </button>
            );
          })}
          <input
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            onBlur={() => {
              if ((decision?.note ?? "") !== noteDraft) onNote?.(noteDraft);
            }}
            placeholder="コメント…"
            className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950/60 px-1.5 py-0.5 text-[10px] text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-sky-500"
          />
        </div>
      )}
    </div>
  );
}

export const UnifiedGallery: React.FC<{ initialSource?: GallerySource }> = ({
  initialSource = "all",
}) => {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<GallerySource>(initialSource);
  const [category, setCategory] = useState<string | null>(null);
  const [favOnly, setFavOnly] = useState(false);
  const [favs, setFavs] = useState<Set<string>>(
    () => new Set(readXpFavorites()), // 旧キー・旧idからの引き継ぎ込み
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const closeLightbox = useCallback(() => setOpenId(null), []);

  // 一度に描く枚数の上限（762枚を全部DOM化するとPlayerが大量マウントされ固まる）
  const PAGE = 96;
  const [visibleCount, setVisibleCount] = useState(PAGE);

  // --- 目視レビュー（台帳は /api/fx-review = fx-review.json に保存） ---
  const [reviewMode, setReviewMode] = useState(false);
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  useEffect(() => {
    if (MVFORGE_DIST) return; // 配布ビルドにレビュー台帳は無い
    let alive = true;
    fetch("/api/fx-review")
      .then((r) => r.json())
      .then((d) => {
        if (alive && d?.decisions) setDecisions(d.decisions as Record<string, Decision>);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const setDecision = useCallback((id: string, key: ReviewKey, value: boolean) => {
    setDecisions((prev) => {
      const cur: Decision = { ...(prev[id] ?? {}) };
      if (value) cur[key] = true;
      else delete cur[key];
      const next = { ...prev };
      if (Object.keys(cur).length) next[id] = cur;
      else delete next[id];
      fetch("/api/fx-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision: cur }),
      }).catch(() => {});
      return next;
    });
  }, []);
  const setNote = useCallback((id: string, note: string) => {
    setDecisions((prev) => {
      const cur: Decision = { ...(prev[id] ?? {}) };
      const t = note.trim();
      if (t) cur.note = t;
      else delete cur.note;
      const next = { ...prev };
      if (Object.keys(cur).length) next[id] = cur;
      else delete next[id];
      fetch("/api/fx-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision: cur }),
      }).catch(() => {});
      return next;
    });
  }, []);
  const reviewCounts = useMemo(() => {
    const c = { total: 0, archive: 0, clean: 0, brushup: 0, ok: 0 };
    for (const d of Object.values(decisions)) {
      c.total++;
      if (d.archive) c.archive++;
      if (d.clean) c.clean++;
      if (d.brushup) c.brushup++;
      if (d.ok) c.ok++;
    }
    return c;
  }, [decisions]);

  const all = useMemo(
    () =>
      [...EFFECTS.map(nativeToItem), ...XP_PORTS.map(xpToItem)].filter(
        (i) => !isArchived(i.id),
      ),
    [],
  );
  const openItem = openId ? (all.find((i) => i.id === openId) ?? null) : null;

  const toggleFav = (id: string) => {
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const filtered = useMemo(() => {
    let list = all;
    if (source !== "all") list = list.filter((i) => i.source === source);
    if (category) list = list.filter((i) => i.category === category);
    if (favOnly) list = list.filter((i) => favs.has(i.id));
    if (unreviewedOnly) list = list.filter((i) => !decisions[i.id]);
    if (query.trim()) {
      list = list.filter((i) => matchesGalleryQuery(i, query));
    }
    return list;
  }, [
    all,
    source,
    category,
    query,
    favOnly,
    favs,
    unreviewedOnly,
    decisions,
  ]);

  // フィルタ/検索が変わったら表示枚数を初期化（先頭から見直す）
  useEffect(() => {
    setVisibleCount(PAGE);
  }, [source, category, query, favOnly, unreviewedOnly]);

  const categories = useMemo(() => {
    const present = new Set(
      (source === "all" ? all : all.filter((i) => i.source === source)).map(
        (i) => i.category,
      ),
    );
    return CATEGORY_ORDER.filter((c) => present.has(c));
  }, [all, source]);

  const favorites = filtered.filter((i) => favs.has(i.id));

  return (
    <div className="space-y-8">
      {/* 検索 + フィルタ */}
      <div className="space-y-3">
        <div className="mx-auto flex max-w-md items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900 px-4 py-2.5">
          <Search className="size-4 shrink-0 text-neutral-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search（名前 / コード / パック / 説明）"
            className="w-full bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
          />
          <span className="shrink-0 font-mono text-[10px] text-neutral-600">
            {filtered.length}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {/* 出所（自作/拡張）区分は私用ビルド限定。配布ではカテゴリ軸に一本化 */}
          {!MVFORGE_DIST &&
            (
              [
                ["all", `すべて（${all.length}）`],
                ["native", BASE_PACK_LABEL],
                ["xp", "拡張パック"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setSource(key);
                  setCategory(null);
                }}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px]",
                  source === key
                    ? "border-violet-400 bg-violet-500/10 text-violet-300"
                    : "border-neutral-700 text-neutral-400 hover:border-neutral-500",
                )}
              >
                {label}
              </button>
            ))}
          <button
            type="button"
            onClick={() => setFavOnly((v) => !v)}
            aria-pressed={favOnly}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px]",
              favOnly
                ? "border-yellow-400 bg-yellow-500/10 text-yellow-300"
                : "border-neutral-700 text-neutral-400 hover:border-neutral-500",
            )}
          >
            <Star
              className={cn("size-3", favOnly && "fill-yellow-400 text-yellow-400")}
            />
            お気に入りだけ
          </button>
          <span className="mx-1 h-4 w-px bg-neutral-800" />
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(category === c ? null : c)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px]",
                category === c
                  ? "border-amber-400 bg-amber-500/10 text-amber-300"
                  : "border-neutral-700 text-neutral-400 hover:border-neutral-500",
              )}
            >
              {c}
            </button>
          ))}
          {/* 採点フィルタ（C/B/A・private&C）は2026-07-21撤去。品質仕分け大工事の完了により
              役目を終えた（データ=lib/fx-score-data.tsは温存。再び使う時はgit履歴から復元） */}
          {!MVFORGE_DIST && (
          <>
          <span className="mx-1 h-4 w-px bg-neutral-800" />
          <button
            type="button"
            onClick={() => setReviewMode((v) => !v)}
            aria-pressed={reviewMode}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
              reviewMode
                ? "border-sky-400 bg-sky-500/10 text-sky-300"
                : "border-neutral-700 text-neutral-400 hover:border-neutral-500",
            )}
          >
            レビュー{reviewMode ? "中" : ""}
          </button>
          {reviewMode && (
            <button
              type="button"
              onClick={() => setUnreviewedOnly((v) => !v)}
              aria-pressed={unreviewedOnly}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px]",
                unreviewedOnly
                  ? "border-sky-400 bg-sky-500/10 text-sky-300"
                  : "border-neutral-700 text-neutral-400 hover:border-neutral-500",
              )}
            >
              未レビューだけ
            </button>
          )}
          </>
          )}
        </div>
        {reviewMode && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-neutral-400">
            <span>
              レビュー済{" "}
              <span className="font-mono text-neutral-200">{reviewCounts.total}</span>
              {" / "}
              {all.length}
            </span>
            <span className="text-rose-300">アーカイブ {reviewCounts.archive}</span>
            <span className="text-amber-300">クリーン {reviewCounts.clean}</span>
            <span className="text-violet-300">磨き {reviewCounts.brushup}</span>
            <span className="text-emerald-300">公開OK {reviewCounts.ok}</span>
          </div>
        )}
      </div>

      {!favOnly && favorites.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-neutral-400">
            <Star className="size-3.5 fill-yellow-400 text-yellow-400" />
            お気に入り
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {favorites.map((i) => (
              <Card
                key={i.id}
                item={i}
                fav
                onToggleFav={() => toggleFav(i.id)}
                onOpen={() => setOpenId(i.id)}
                reviewMode={reviewMode}
                decision={decisions[i.id]}
                onDecision={(k, v) => setDecision(i.id, k, v)}
              onNote={(note) => setNote(i.id, note)}
              />
            ))}
          </div>
        </section>
      )}

      {CATEGORY_ORDER.map((cat) => {
          const items = filtered
            .slice(0, visibleCount)
            .filter((i) => i.category === cat);
          if (items.length === 0) return null;
          const catTotal = filtered.filter((i) => i.category === cat).length;
          return (
            <section key={cat}>
              <h2 className="mb-3 text-xs font-semibold tracking-wide text-neutral-400">
                {cat}
                <span className="ml-2 text-neutral-600">
                  {items.length < catTotal ? `${items.length}/${catTotal}` : catTotal}
                </span>
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {items.map((i) => (
                  <Card
                    key={i.id}
                    item={i}
                    fav={favs.has(i.id)}
                    onToggleFav={() => toggleFav(i.id)}
                    onOpen={() => setOpenId(i.id)}
                    reviewMode={reviewMode}
                    decision={decisions[i.id]}
                    onDecision={(k, v) => setDecision(i.id, k, v)}
                  onNote={(note) => setNote(i.id, note)}
                  />
                ))}
              </div>
            </section>
          );
        })}

      {(() => {
        const total = filtered.length;
        if (visibleCount >= total) return null;
        return (
          <div className="flex flex-col items-center gap-2 py-4">
            <button
              type="button"
              onClick={() => setVisibleCount((c) => c + PAGE)}
              className="rounded-full border border-violet-500/60 bg-violet-500/10 px-5 py-2 text-sm font-medium text-violet-200 hover:bg-violet-500/20"
            >
              もっと見る（+{Math.min(PAGE, total - visibleCount)} / 残り{total - visibleCount}）
            </button>
            <button
              type="button"
              onClick={() => setVisibleCount(total)}
              className="text-[11px] text-neutral-500 hover:text-neutral-300"
            >
              全部表示（重い）
            </button>
          </div>
        );
      })()}

      {filtered.length === 0 && (
        <p className="py-16 text-center text-sm text-neutral-500">
          「{query}」に一致する部品はありません
        </p>
      )}

      {openItem && <Lightbox item={openItem} onClose={closeLightbox} />}
    </div>
  );
};
