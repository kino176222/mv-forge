"use client";
import { readXpFavorites } from "@/lib/xp/favorites";
import { MVFORGE_DIST } from "@/lib/brand";
import React from "react";
import {
  effectsByCategory,
  effectById,
  resolveParams,
  curatedXpEffectIds,
  type EffectCategory,
  type EffectMeta,
} from "@/lib/effects-meta";
import type { EffectInstance } from "@/lib/schema";
import {
  XP_BRIDGED_EFFECTS,
  isXpEffectId,
  xpPortIdFromEffectId,
} from "@/lib/xp/bridge";
import {
  xpCleanStatusOf,
  XP_CLEAN_STATUS_UI,
  type XpCleanStatus,
} from "@/lib/xp/clean-status";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Player } from "@remotion/player";
import { BookOpen, ChevronRight, RotateCcw, Star } from "lucide-react";
import { KnobRow } from "./KnobRow";
import { LazyPlayerCard } from "@/components/effects/LazyPlayerCard";
import {
  FxPreview,
  FX_PREVIEW_FRAMES,
  FX_PREVIEW_FPS,
} from "@/remotion/FxPreview";

/**
 * カテゴリ内の1候補＝1カード。待機時は代表フレームで静止し、
 * ホバー（フォーカス）で再生する（LazyPlayerCard が担当）。
 * ドロップダウンを1つずつ覗く手間を無くし、全候補を並べて見比べられる。
 */
const OptionCard: React.FC<{
  label: string;
  /** ホバーで出す効果説明（effects-metaのdescription。初見でも何の効果か分かるように） */
  description?: string;
  selected: boolean;
  onSelect(): void;
  effectId?: string;
  previewImage?: string | null;
  /** 動画行の実素材。渡すとグリッドのプレビューが実動画クリップで再生される（ダミー静止画にならない） */
  previewVideo?: string | null;
  /** 配布仕分けバッジ（拡張パックのみ。緑=公開OK / 琥珀=作り直し / 赤=私用のみ） */
  cleanStatus?: XpCleanStatus;
}> = ({
  label,
  description,
  selected,
  onSelect,
  effectId,
  previewImage = null,
  previewVideo = null,
  cleanStatus,
}) => (
  <button
    type="button"
    onClick={onSelect}
    title={description ? `${label}\n${description}` : label}
    className={cn(
      "group flex flex-col overflow-hidden rounded border text-left transition-colors",
      selected
        ? "border-amber-400 ring-1 ring-amber-400/40"
        : "border-neutral-800 hover:border-neutral-600",
    )}
  >
    {effectId ? (
      <LazyPlayerCard
        component={FxPreview as React.FC<Record<string, unknown>>}
        inputProps={{ effectId, imageUrl: previewImage, videoUrl: previewVideo }}
        durationInFrames={FX_PREVIEW_FRAMES}
        fps={FX_PREVIEW_FPS}
        width={640}
        height={360}
        hoverToPlay
      />
    ) : (
      <div className="flex aspect-video w-full items-center justify-center bg-neutral-900 text-[10px] text-neutral-500">
        プレビューなし
      </div>
    )}
    <span
      className={cn(
        "flex items-center gap-1 truncate px-1.5 py-1 text-[10px]",
        selected ? "text-amber-300" : "text-neutral-300",
      )}
    >
      {selected && <span className="shrink-0">✓</span>}
      <span className="truncate">{label}</span>
      {cleanStatus && (
        <span
          title={`配布仕分け: ${XP_CLEAN_STATUS_UI[cleanStatus].label}`}
          className={cn(
            "ml-auto flex shrink-0 items-center gap-1 text-[9px]",
            XP_CLEAN_STATUS_UI[cleanStatus].textClass,
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              XP_CLEAN_STATUS_UI[cleanStatus].dotClass,
            )}
          />
          {XP_CLEAN_STATUS_UI[cleanStatus].label}
        </span>
      )}
    </span>
  </button>
);

/**
 * カテゴリ内のエフェクト選択＋つまみ（params）の共通UI。
 * 候補は「一覧グリッド＋各自ライブプレビュー」で見比べて選ぶ。
 * 注視点（originX/originY）を持つ効果（カメラ）だけ、選択後に大プレビューを出して
 * クリックで寄り先を直接指定できる。右上の本アイコンからエフェクト図鑑（/effects#id）へ飛べる。
 */
export const EffectPicker: React.FC<{
  category: EffectCategory;
  value: EffectInstance | null;
  allowNone?: boolean;
  noneLabel?: string;
  /** 実素材でプレビューする（選択中の行の画像URL）。無ければサンプル画像 */
  previewImage?: string | null;
  /** 動画行の実素材URL。大プレビューが動画ループ再生になり、動き系の確認ができる */
  previewVideo?: string | null;
  /** 大プレビューの尺（フレーム）。実際の区間長を渡すとパス移動の速度感が本番と一致する */
  previewDurationInFrames?: number;
  onChange(v: EffectInstance | null): void;
}> = ({
  category,
  value,
  allowNone = true,
  noneLabel = "なし",
  previewImage = null,
  previewVideo = null,
  previewDurationInFrames,
  onChange,
}) => {
  const options = effectsByCategory(category);
  // 拡張パック（transition / overlay / lyric）は「通常(自前)」と1つの⭐棚に統合して見せる。
  // 既定＝⭐（curated手札∪お気に入り）のみ。出所（通常/拡張）はフィルタchipに降格し、
  // 全量（transition144 / overlay238 / subtitle77）は「全N本から探す」の検索専用に格下げする。
  const isXpCategory =
    category === "transition" || category === "overlay" || category === "lyric";
  // 出所フィルタ: すべて / 通常(自前) / 拡張パック。既定は「すべて」（通常+⭐拡張を一枚のグリッドに）
  const [sourceFilter, setSourceFilter] =
    React.useState<"all" | "native" | "xp">("all");
  const [xpFavOnly, setXpFavOnly] = React.useState(false);
  // 配布仕分け（docs/xp-triage.md）で「そのまま=公開OK」のものだけに絞る
  const [xpPublishOnly, setXpPublishOnly] = React.useState(false);
  // 図鑑（全量）格下げ: 「全N本から探す」検索モード。既定は⭐棚（false）
  const [browseAll, setBrowseAll] = React.useState(false);
  const [xpQuery, setXpQuery] = React.useState("");
  // 図鑑（UnifiedGallery）で付けた星をそのまま共有（素id で保存されている）。
  // lazy初期化で読む（effect内setStateのカスケード再描画を避ける = UnifiedGalleryと同流儀）
  const [xpFavs] = React.useState<Set<string>>(
    () => new Set(readXpFavorites()), // 旧キー・旧idからの引き継ぎ込み
  );
  const xpPool = React.useMemo(
    () =>
      isXpCategory
        ? XP_BRIDGED_EFFECTS.filter((e) => e.category === category)
        : [],
    [isXpCategory, category],
  );
  // ⭐棚の単一ソース（effectCatalogForAI と共有）: curated∪お気に入り。prefix付き id の集合。
  const shelfSet = React.useMemo(
    () => curatedXpEffectIds([...xpFavs]),
    [xpFavs],
  );
  // 統合グリッドの表示要素。source で通常/拡張を区別し、拡張だけ公開可否バッジを出す。
  const shelfItems = React.useMemo<
    { effect: EffectMeta; source: "native" | "xp" }[]
  >(() => {
    const nativeItems = options.map((e) => ({
      effect: e,
      source: "native" as const,
    }));
    if (!isXpCategory) return nativeItems;

    const isFav = (e: EffectMeta) => xpFavs.has(xpPortIdFromEffectId(e.id));
    // 拡張側の母集合: 検索(全量) or お気に入りのみ or ⭐手札(curated∪fav)
    let xpList = browseAll
      ? xpPool
      : xpFavOnly
        ? xpPool.filter(isFav)
        : xpPool.filter((e) => shelfSet.has(e.id));
    if (xpPublishOnly) {
      xpList = xpList.filter((e) => xpCleanStatusOf(e.id) === "publish");
    }
    const q = xpQuery.trim().toLowerCase();
    if (browseAll && q) {
      xpList = xpList.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.id.includes(q) ||
          e.description.toLowerCase().includes(q),
      );
    }
    // ★お気に入りを先頭に寄せる（星＝最優先の手札）
    const xpItems = [...xpList]
      .sort((a, b) => (isFav(a) ? 0 : 1) - (isFav(b) ? 0 : 1))
      .map((e) => ({ effect: e, source: "xp" as const }));

    // 出所フィルタ chip
    if (sourceFilter === "native") return nativeItems;
    if (sourceFilter === "xp") return xpItems;
    // すべて: 通常＋拡張。ただし「全量検索」「お気に入りだけ」は拡張文脈なので通常は隠す
    const nativeShown = browseAll || xpFavOnly ? [] : nativeItems;
    return [...nativeShown, ...xpItems];
  }, [
    options,
    isXpCategory,
    xpPool,
    shelfSet,
    xpFavs,
    sourceFilter,
    xpFavOnly,
    xpPublishOnly,
    browseAll,
    xpQuery,
  ]);
  const meta = value ? effectById(value.id) : null;
  const params = value ? resolveParams(value.id, value.params) : {};
  // originX/Y を持つ効果（カメラ=注視点、レンズフレア=光源）だけ、選択後に大プレビュー＋マーカーを出す
  const hasFocusPoint = !!meta?.params.some((p) => p.key === "originX");
  // フレア一覧（階層UI）: レンズフレア選択直後とプリセット欄クリックで開く

  const select = (id: string | null) => {
    onChange(id === null ? null : { id, params: resolveParams(id, undefined) });
  };

  // パスモード（レンズフレア）: 始点/終点/曲げの3ハンドルをドラッグで指定
  const isPath = value?.id === "lens-flare" && String(params.motion) === "path";
  const dragTarget = React.useRef<"origin" | "dest" | "bend" | null>(null);
  const hOrigin = { x: Number(params.originX ?? 50), y: Number(params.originY ?? 50) };
  const hDest = { x: Number(params.destX ?? 30), y: Number(params.destY ?? 40) };
  const mid = { x: (hOrigin.x + hDest.x) / 2, y: (hOrigin.y + hDest.y) / 2 };
  const hBend = { x: mid.x + Number(params.bendX ?? 0), y: mid.y + Number(params.bendY ?? 0) };
  // 曲線の制御点（曲げハンドルは「曲線が通る点」なので C = 2M - 中点）
  const ctrl = { x: 2 * hBend.x - mid.x, y: 2 * hBend.y - mid.y };

  // プレビュー上のクリック/ドラッグで位置を直接指定
  const setPoint = (e: React.PointerEvent<HTMLDivElement>, first = false) => {
    if (!value) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
    const y = Math.round(Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)));
    if (!isPath) {
      onChange({ ...value, params: { ...params, originX: x, originY: y } });
      return;
    }
    // パス: 押した瞬間に最寄りのハンドルを掴み、ドラッグ中はそれを動かし続ける
    if (first) {
      const d2 = (h: { x: number; y: number }) => (h.x - x) ** 2 + (h.y - y) ** 2;
      const candidates: Array<["origin" | "dest" | "bend", number]> = [
        ["origin", d2(hOrigin)],
        ["dest", d2(hDest)],
        ["bend", d2(hBend)],
      ];
      candidates.sort((a, b) => a[1] - b[1]);
      dragTarget.current = candidates[0][0];
    }
    const t = dragTarget.current;
    if (t === "origin") {
      onChange({ ...value, params: { ...params, originX: x, originY: y } });
    } else if (t === "dest") {
      onChange({ ...value, params: { ...params, destX: x, destY: y } });
    } else if (t === "bend") {
      const clamp = (v: number) => Math.min(60, Math.max(-60, Math.round(v)));
      onChange({
        ...value,
        params: { ...params, bendX: clamp(x - mid.x), bendY: clamp(y - mid.y) },
      });
    }
  };

  return (
    <div className="space-y-1.5">
      {/* ⭐棚: 既定は「Kinoが⭐した手札（curated∪お気に入り）」だけ。基本(自作)と拡張を1つの
          グリッドに統合し、出所はフィルタchipに降格。全量(144等)は「全N本から探す」検索専用へ格下げ。 */}
      {isXpCategory && xpPool.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* 出所フィルタ chip（すべて / 基本 / 拡張）— 私用ビルド限定 */}
          {!MVFORGE_DIST && (
          <div className="flex items-center gap-0.5 rounded bg-neutral-900 p-0.5">
            {(
              [
                ["all", "すべて"],
                ["native", "基本"],
                ["xp", "拡張"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSourceFilter(key)}
                aria-pressed={sourceFilter === key}
                title={
                  key === "native"
                    ? "基本パック（自作エフェクト）だけ表示"
                    : key === "xp"
                      ? "拡張パックだけ表示"
                      : "基本＋拡張をまとめて表示"
                }
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] transition-colors",
                  sourceFilter === key
                    ? "bg-neutral-700 text-neutral-100"
                    : "text-neutral-500 hover:text-neutral-300",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          )}
          <button
            type="button"
            onClick={() => setXpFavOnly((v) => !v)}
            aria-pressed={xpFavOnly}
            title="図鑑で星を付けたものだけ表示"
            className={cn(
              "flex items-center gap-0.5 text-[10px]",
              xpFavOnly
                ? "text-yellow-300"
                : "text-neutral-500 hover:text-neutral-300",
            )}
          >
            <Star
              className={cn(
                "size-3",
                xpFavOnly && "fill-yellow-400 text-yellow-400",
              )}
            />
            お気に入り
          </button>
          {!MVFORGE_DIST && (
          <button
            type="button"
            onClick={() => setXpPublishOnly((v) => !v)}
            aria-pressed={xpPublishOnly}
            title="配布仕分けで「公開OK」のものだけ表示（docs/xp-triage.md）"
            className={cn(
              "flex items-center gap-1 text-[10px]",
              xpPublishOnly
                ? "text-emerald-300"
                : "text-neutral-500 hover:text-neutral-300",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                xpPublishOnly ? "bg-emerald-400" : "bg-neutral-600",
              )}
            />
            公開OKだけ
          </button>
          )}
          <button
            type="button"
            onClick={() => {
              setBrowseAll((v) => !v);
              setXpQuery("");
            }}
            title="⭐手札から外れたものも含め、拡張全量を検索して探す（図鑑）"
            className="ml-auto text-[10px] text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline"
          >
            {browseAll ? "⭐手札に戻る" : `全${xpPool.length}本から探す`}
          </button>
        </div>
      )}
      {isXpCategory && browseAll && (
        <input
          type="search"
          value={xpQuery}
          onChange={(e) => setXpQuery(e.target.value)}
          placeholder="名前・説明で検索（例: フィルム / zoom / グリッチ）"
          className="w-full rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
        />
      )}
      {/* 候補を一覧＋プレビューで並べて選ぶ（ドロップダウンを1つずつ覗く手間を排除）。
          列数はコンテナ幅に自動追従（狭い＝2列／広い＝3列以上）。 */}
      <div
        className={cn(
          "grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1.5 overflow-y-auto pr-0.5",
          // 位置指定プレビュー付き（カメラ/フレア）を選択中は候補一覧を低くし、プレビューとつまみを見えるようにする
          hasFocusPoint && value ? "max-h-[26vh]" : "max-h-[60vh]",
        )}
      >
        {allowNone && !browseAll && (
          <OptionCard
            label={noneLabel}
            selected={!value}
            onSelect={() => select(null)}
          />
        )}
        {shelfItems.map(({ effect: e, source }) => (
          <OptionCard
            key={e.id}
            label={e.name}
            description={e.description}
            selected={value?.id === e.id}
            onSelect={() => select(e.id)}
            effectId={e.id}
            previewImage={previewImage}
            previewVideo={previewVideo}
            cleanStatus={
              !MVFORGE_DIST && source === "xp" ? xpCleanStatusOf(e.id) : undefined
            }
          />
        ))}
        {shelfItems.length === 0 && (
          <div className="col-span-full py-4 text-center text-[11px] text-neutral-500">
            該当なし（フィルタを緩めるか「全{xpPool.length}本から探す」で検索してください）
          </div>
        )}
      </div>
      {isXpCategory && (
        <div className="text-right text-[10px] text-neutral-500">
          {shelfItems.length}本を表示
          {browseAll ? ` / 全${xpPool.length}本を検索中` : "（⭐手札）"}
        </div>
      )}
      <a
        href={
          value && !MVFORGE_DIST && isXpEffectId(value.id)
            ? "/xp"
            : value
              ? `/effects#${value.id}`
              : "/effects"
        }
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-neutral-300"
      >
        <BookOpen className="size-3" />
        エフェクト図鑑で詳しく見る
      </a>

      {/* 注視点（カメラ）: 選択後に大プレビューを出し、クリックで寄り先を直接指定 */}
      {hasFocusPoint && value && (
        <div className="relative overflow-hidden rounded border border-neutral-800 bg-neutral-950">
          <Player
            component={FxPreview}
            inputProps={{
              effectId: value.id,
              params: params as Record<string, number | string>,
              imageUrl: previewImage,
              videoUrl: previewVideo,
            }}
            durationInFrames={previewDurationInFrames ?? FX_PREVIEW_FRAMES}
            fps={FX_PREVIEW_FPS}
            compositionWidth={640}
            compositionHeight={360}
            style={{ width: "100%" }}
            loop
            autoPlay
            // FxPreviewは音声を含まない。autoplayポリシー対策（FxCardと同じ）
            initiallyMuted
            numberOfSharedAudioTags={0}
            controls={false}
            clickToPlay={false}
          />
          {/* 🎯 位置指定: クリック/ドラッグで直接指定（カメラ=寄り先、フレア=光源。スライダーは微調整用） */}
          <div
            className="absolute inset-0 cursor-crosshair"
            title={
              value.id === "lens-flare"
                ? "クリック／ドラッグで光源の位置を指定"
                : "クリック／ドラッグで注視点（ズームの寄り先）を指定"
            }
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setPoint(e, true);
            }}
            onPointerMove={(e) => {
              if (e.buttons & 1) setPoint(e);
            }}
            onPointerUp={() => {
              dragTarget.current = null;
            }}
          >
            {/* パス: A→B の曲線と3ハンドル（始点=琥珀 / 終点=緑 / 曲げ=白） */}
            {isPath && (
              <svg
                className="pointer-events-none absolute inset-0 size-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <path
                  d={`M ${hOrigin.x} ${hOrigin.y} Q ${ctrl.x} ${ctrl.y} ${hDest.x} ${hDest.y}`}
                  fill="none"
                  stroke="rgba(255,255,255,0.55)"
                  strokeWidth="0.5"
                  strokeDasharray="2 1.6"
                />
              </svg>
            )}
            {isPath && (
              <>
                <div
                  className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-emerald-400 bg-emerald-400/25 shadow-[0_0_6px_rgba(52,211,153,0.8)]"
                  style={{ left: `${hDest.x}%`, top: `${hDest.y}%` }}
                  title="終点"
                />
                <div
                  className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/90 bg-white/30"
                  style={{ left: `${hBend.x}%`, top: `${hBend.y}%` }}
                  title="曲げハンドル"
                />
              </>
            )}
            <div
              className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-400 bg-amber-400/25 shadow-[0_0_6px_rgba(251,191,36,0.8)]"
              style={{
                left: `${Number(params.originX ?? 50)}%`,
                top: `${Number(params.originY ?? 50)}%`,
              }}
            />
          </div>
        </div>
      )}


      {meta &&
        value &&
        meta.params.map((p) => {
          // パスの終点/曲げはプレビュー上のドラッグで指定する（スライダーは出さない）
          if (
            value.id === "lens-flare" &&
            ["destX", "destY", "bendX", "bendY"].includes(p.key)
          ) {
            return null;
          }
          if (p.type === "enum") {
            return (
              <div key={p.key} className="flex items-center gap-2 text-xs">
                <span className="w-16 shrink-0 text-neutral-400">{p.label}</span>
                <Select
                  value={String(params[p.key])}
                  onValueChange={(v) =>
                    onChange({ ...value, params: { ...params, [p.key]: v } })
                  }
                >
                  <SelectTrigger className="h-6 flex-1 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {p.options?.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-xs">
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          }
          if (p.type === "color") {
            const hex = String(params[p.key] ?? p.default);
            // 空文字=「デザイン既定」の番兵値（拡張テロップの color 等）。
            // <input type="color"> は空を受けられないので白で表示し、テキスト欄で判別する
            const isDesignDefault = p.default === "" && hex === "";
            const pickerValue = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#ffffff";
            return (
              <div key={p.key} className="flex items-center gap-2 text-xs">
                <span className="w-16 shrink-0 text-neutral-400">{p.label}</span>
                <input
                  type="color"
                  value={pickerValue}
                  onChange={(e) =>
                    onChange({ ...value, params: { ...params, [p.key]: e.target.value } })
                  }
                  className="h-6 w-8 shrink-0 cursor-pointer rounded border border-neutral-800 bg-neutral-900 p-0"
                />
                <input
                  type="text"
                  value={hex}
                  placeholder={p.default === "" ? "デザイン既定" : undefined}
                  onChange={(e) =>
                    onChange({ ...value, params: { ...params, [p.key]: e.target.value } })
                  }
                  className="flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 font-mono text-[11px] text-neutral-200 focus:border-neutral-600 focus:outline-none"
                />
                {p.default === "" && !isDesignDefault && (
                  <button
                    type="button"
                    title="デザイン既定の色に戻す"
                    onClick={() =>
                      onChange({ ...value, params: { ...params, [p.key]: "" } })
                    }
                    className="shrink-0 text-[10px] text-neutral-500 hover:text-neutral-300"
                  >
                    既定
                  </button>
                )}
              </div>
            );
          }
          if (p.type === "number") {
            return (
              <KnobRow
                key={p.key}
                label={p.label}
                min={p.min ?? 0}
                max={p.max ?? 100}
                step={p.step ?? 1}
                unit={p.unit}
                value={Number(params[p.key])}
                display={
                  // 歌詞/テロップの表示時間: 0=行末まで（拡張・自前どちらの歌詞演出でも）
                  p.key === "duration" &&
                  (isXpEffectId(value.id) || meta?.category === "lyric") &&
                  p.min === 0
                    ? (v) => (v === 0 ? "行末" : `${v}${p.unit ?? ""}`)
                    : undefined
                }
                onChange={(v) =>
                  onChange({ ...value, params: { ...params, [p.key]: v } })
                }
              />
            );
          }
          return null; // boolean は差し込み口のみ（実装保留）
        })}
      {/* 数値つまみの一括リセット（enum/色/プリセット選択は保持） */}
      {meta && value && meta.params.some((q) => q.type === "number") && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              const def = resolveParams(value.id, undefined);
              const next = { ...params };
              for (const q of meta.params) {
                if (q.type === "number") next[q.key] = def[q.key];
              }
              onChange({ ...value, params: next });
            }}
            className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-neutral-300"
          >
            <RotateCcw className="size-3" />
            つまみを既定に戻す
          </button>
        </div>
      )}
    </div>
  );
};
