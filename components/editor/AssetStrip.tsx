"use client";
import React, { useEffect, useState } from "react";
import {
  FolderOpen,
  Mountain,
  Film,
  RefreshCw,
  Link2,
  Loader2,
  Scissors,
  Trash2,
  TriangleAlert,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Star,
  Grid2x2,
  Maximize2,
  X,
} from "lucide-react";
import { useEditor, type AssetImage } from "@/lib/store";
import { assetUrl } from "@/remotion/asset-url";
import { isVideoFile, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import type { VideoAsset } from "@/lib/server/projects-server";
import type { SubjectAsset } from "@/app/api/subjects/route";

type Tab = "all" | "image" | "video" | "char" | "fav";

/** 素材帯の置き場所。side（左端/プレビュー左右）は縦パネル、bottom は従来の横帯。 */
export type AssetPos = "far-left" | "pre-left" | "pre-right" | "bottom";
const POSITIONS: [AssetPos, string, string][] = [
  ["far-left", "左端", "一番左に置く"],
  ["pre-left", "ﾌﾟﾚ左", "プレビューの左に置く"],
  ["pre-right", "ﾌﾟﾚ右", "プレビューの右に置く"],
  ["bottom", "下", "下に横帯で置く（従来）"],
];

/** 素材置き場。タブで種類を絞り、動画は尺と系譜（元→続き→合体）が見える。
 *  歌詞行へD&Dで割り当て、クリックで拡大プレビュー＋「選択中の行に割り当て」。
 *  pos で置き場所を切替（side=縦パネル / bottom=横帯）、onPos でセレクタが親に通知。 */
export const AssetStrip: React.FC<{
  pos: AssetPos;
  onPos: (p: AssetPos) => void;
}> = ({ pos, onPos }) => {
  const vertical = pos !== "bottom"; // side配置は縦パネル
  const assets = useEditor((s) => s.assets);
  const projectName = useEditor((s) => s.projectName);
  const [preview, setPreview] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  // 素材帯の開閉。localStorage から復元（既定=展開）。lazy init で cascading render を回避。
  // AssetStrip は project ロード後のみ描画されるので SSR ハイドレーション不一致は起きない。
  const [collapsed, setCollapsed] = useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem("mvforge-assetstrip-collapsed") === "1",
  );
  // 画像お気に入り（プロジェクト別・localStorage永続）。プロジェクト切替は再マウントで復元。
  const [favs, setFavs] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem(`mvforge:favImages:${projectName}`);
      return new Set<string>(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  });
  // 縦パネルの「置き場所」セレクタの開閉（既定=閉）。localStorageで永続。
  const [posOpen, setPosOpen] = useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem("mvforge:assetPosOpen") === "1",
  );
  // 2段表示（横=2行 / 縦=2列）。localStorageで永続。
  const [rows2, setRows2] = useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem("mvforge:assetRows2") === "1",
  );
  // 全体プレビュー（移動・リサイズできる浮遊パネル）。位置/サイズはlocalStorage永続。
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryRect, setGalleryRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  }>(() => {
    const def = { x: 120, y: 90, w: 900, h: 640 };
    if (typeof window === "undefined") return def;
    try {
      const r = JSON.parse(
        window.localStorage.getItem("mvforge:galleryRect") ?? "null",
      );
      return r && typeof r.w === "number" ? r : def;
    } catch {
      return def;
    }
  });
  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(Math.max(v, lo), hi);
  const startGalleryMove = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return; // タブ/×はドラッグしない
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const { x, y } = galleryRect;
    let latest = galleryRect;
    const onMove = (ev: MouseEvent) => {
      setGalleryRect((r) => {
        latest = {
          ...r,
          x: clamp(x + ev.clientX - sx, 0, window.innerWidth - 120),
          y: clamp(y + ev.clientY - sy, 0, window.innerHeight - 48),
        };
        return latest;
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      localStorage.setItem("mvforge:galleryRect", JSON.stringify(latest));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const startGalleryResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const { w, h } = galleryRect;
    let latest = galleryRect;
    const onMove = (ev: MouseEvent) => {
      setGalleryRect((r) => {
        latest = {
          ...r,
          w: clamp(w + ev.clientX - sx, 360, window.innerWidth),
          h: clamp(h + ev.clientY - sy, 240, window.innerHeight),
        };
        return latest;
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      localStorage.setItem("mvforge:galleryRect", JSON.stringify(latest));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  // Escで閉じる（Radix Dialogをやめた分の代替）
  useEffect(() => {
    if (!galleryOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGalleryOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [galleryOpen]);
  const previewAsset = assets.images.find((i) => i.file === preview);
  // 🧑 キャラ素材（動画から抜いた透過クリップ）。背景素材とは別の棚＝D&D割り当てなし
  const [subjects, setSubjects] = useState<SubjectAsset[]>([]);
  const [charPreview, setCharPreview] = useState<SubjectAsset | null>(null);

  useEffect(() => {
    // タブを開いた時に取得（常時ポーリングはしない軽い版）。
    // setState は await 後なのでエフェクト同期更新にはならない
    if (tab !== "char" && tab !== "all") return;
    let alive = true;
    (async () => {
      const d = await fetch(
        `/api/subjects?project=${encodeURIComponent(projectName)}`,
        { cache: "no-store" },
      ).then((r) => r.json());
      if (alive && d.subjects) setSubjects(d.subjects);
    })();
    return () => {
      alive = false;
    };
  }, [tab, projectName]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("mvforge-assetstrip-collapsed", next ? "1" : "0");
      return next;
    });
  };
  const toggleFav = (file: string) => {
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      localStorage.setItem(
        `mvforge:favImages:${projectName}`,
        JSON.stringify([...next]),
      );
      return next;
    });
  };
  const togglePosOpen = () => {
    setPosOpen((o) => {
      const next = !o;
      localStorage.setItem("mvforge:assetPosOpen", next ? "1" : "0");
      return next;
    });
  };
  const toggleRows2 = () => {
    setRows2((r) => {
      const next = !r;
      localStorage.setItem("mvforge:assetRows2", next ? "1" : "0");
      return next;
    });
  };

  const deleteSubject = async (base: string) => {
    if (!confirm(`キャラ素材「${base}」を削除しますか？（元動画は残ります）`)) return;
    const res = await fetch(
      `/api/subjects?project=${encodeURIComponent(projectName)}&base=${encodeURIComponent(base)}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      setSubjects((prev) => prev.filter((s) => s.base !== base));
      toast.success(`キャラ素材「${base}」を削除しました`);
    } else {
      toast.error("削除に失敗しました");
    }
  };

  // 系譜: parent → 子（合体版）一覧
  const childrenOf = (file: string): VideoAsset[] =>
    assets.videos.filter((v) => v.parent === file);
  const videoOf = (file: string): VideoAsset | undefined =>
    assets.videos.find((v) => v.file === file);

  // Finderで images/ 等に足した素材を、リロード無しで反映する
  const reload = async () => {
    setReloading(true);
    try {
      const d = await fetch(
        `/api/assets?project=${encodeURIComponent(projectName)}`,
      ).then((r) => r.json());
      if (!d.error) useEditor.getState().setAssets(d);
    } finally {
      setReloading(false);
    }
  };

  /** プレビュー中の素材を、いま選択している歌詞行に割り当てる */
  const assignToSelected = (file: string) => {
    const s = useEditor.getState();
    const line = s.project?.lines[s.selectedLine];
    if (!line) return;
    s.setLineImage(s.selectedLine, file);
    toast.success(
      `行${s.selectedLine + 1}「${line.lyricText || "(無題)"}」に割り当てました`,
    );
    setPreview(null);
  };

  const fmtSec = (sec: number) => (sec > 0 ? `${sec.toFixed(1)}s` : "");
  const baseName = (f: string) => f.replace(/^videos\/(segments\/)?|^images\//, "");

  const showImages = tab === "all" || tab === "image" || tab === "fav";
  const showVideos = tab === "all" || tab === "video";
  const showChars = tab === "all" || tab === "char";
  // ★タブでは★のみ。常に★を先頭へ安定ソート（お気に入りソート）。
  const imagesToShow = [...assets.images]
    .filter((i) => tab !== "fav" || favs.has(i.file))
    .sort((a, b) => Number(favs.has(b.file)) - Number(favs.has(a.file)));

  // 本体のレイアウト: 縦/横 × 1段/2段。素材帯本体と全体プレビューで共用する部品も定義。
  const bodyCls = vertical
    ? rows2
      ? "grid min-h-0 flex-1 grid-cols-2 place-items-start content-start gap-2 overflow-y-auto px-2 pb-2"
      : "flex min-h-0 flex-1 flex-col items-start gap-2 overflow-y-auto px-2 pb-2"
    : rows2
      ? // auto-cols-max で列幅をサムネ実寸(w-28)に固定 → 潰れずに横スクロール発動
        "grid auto-cols-max grid-flow-col grid-rows-2 place-items-start content-start gap-2 overflow-x-auto px-3 pb-2"
      : "flex h-24 items-center gap-2 overflow-x-auto px-3 pb-2";

  // サムネ描画（素材帯本体と全体プレビューで共用。gallery=trueは縦横比そのまま） -----
  const mediaCls = (gallery: boolean, border: string) =>
    cn(
      "h-16 w-28 rounded border object-cover group-hover:border-amber-400",
      border,
      gallery && "h-28 w-auto max-w-[220px] object-contain bg-black/30",
    );
  const imageThumb = (img: AssetImage, gallery = false) => (
    <div
      key={img.file}
      draggable
      onDragStart={(e) =>
        e.dataTransfer.setData("text/mvforge-image", img.file)
      }
      onClick={() => setPreview(img.file)}
      className="group relative shrink-0 cursor-grab active:cursor-grabbing"
      title={`${img.file}（クリックで拡大）`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={assetUrl("", projectName, img.file)}
        alt={img.file}
        className={mediaCls(gallery, "border-neutral-700")}
      />
      {/* ★ワンクリック登録（拡大せずその場でトグル） */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleFav(img.file);
        }}
        title={favs.has(img.file) ? "お気に入り解除" : "お気に入り登録"}
        className={cn(
          "absolute right-1 top-1 rounded bg-black/60 p-0.5 transition-opacity",
          favs.has(img.file)
            ? "text-amber-400 opacity-100"
            : "text-neutral-300 opacity-0 hover:text-amber-300 group-hover:opacity-100",
        )}
      >
        <Star className={cn("size-3", favs.has(img.file) && "fill-amber-400")} />
      </button>
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-0.5 truncate rounded-b bg-black/70 px-1 text-[9px] text-neutral-300">
        <span className="truncate">{baseName(img.file)}</span>
        {img.hasDepth && (
          <Mountain className="size-2.5 shrink-0 text-emerald-400" />
        )}
      </div>
    </div>
  );
  const videoThumb = (
    v: { file: string; durationSec: number; parent: string | null },
    gallery = false,
  ) => {
    const kids = childrenOf(v.file);
    return (
      <div
        key={v.file}
        draggable
        onDragStart={(e) =>
          e.dataTransfer.setData("text/mvforge-image", v.file)
        }
        onClick={() => setPreview(v.file)}
        className="group relative shrink-0 cursor-grab active:cursor-grabbing"
        title={`${v.file}（クリックで再生・系譜）`}
      >
        <video
          src={assetUrl("", projectName, v.file)}
          muted
          preload="metadata"
          className={mediaCls(gallery, "border-sky-800")}
        />
        {kids.length > 0 && (
          <span className="absolute right-1 top-1 rounded-full border border-sky-700 bg-sky-950/90 px-1.5 text-[9px] text-sky-300">
            ＋延長{kids.length}
          </span>
        )}
        {v.parent && (
          <span className="absolute left-1 top-1 rounded-full border border-sky-700 bg-sky-950/90 p-0.5 text-sky-300">
            <Link2 className="size-2.5" />
          </span>
        )}
        <div className="absolute bottom-0 left-0 right-0 flex items-center gap-0.5 truncate rounded-b bg-black/70 px-1 text-[9px] text-sky-300">
          <Film className="size-2.5 shrink-0" />
          <span className="truncate">{baseName(v.file)}</span>
          <span className="ml-auto shrink-0 font-mono">
            {fmtSec(v.durationSec)}
          </span>
        </div>
      </div>
    );
  };
  const charThumb = (s: SubjectAsset, gallery = false) => (
    <div
      key={s.base}
      onClick={() => s.state === "done" && setCharPreview(s)}
      className={cn(
        "group relative shrink-0",
        s.state === "done" ? "cursor-pointer" : "cursor-default opacity-60",
      )}
      title={
        s.state === "done"
          ? `${s.base}（クリックで再生）`
          : s.state === "running"
            ? `${s.base}（生成中）`
            : `${s.base}（生成失敗）`
      }
    >
      {s.state === "done" ? (
        <video
          src={assetUrl("", projectName, `subjects/${s.base}/preview.mp4`)}
          muted
          preload="metadata"
          className={mediaCls(gallery, "border-emerald-800")}
        />
      ) : (
        <div className="flex h-16 w-28 items-center justify-center rounded border border-neutral-700 bg-neutral-900">
          {s.state === "running" ? (
            <Loader2 className="size-4 animate-spin text-neutral-500" />
          ) : (
            <TriangleAlert className="size-4 text-amber-500" />
          )}
        </div>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          void deleteSubject(s.base);
        }}
        title="このキャラ素材を削除"
        className="absolute right-1 top-1 rounded bg-black/70 p-0.5 text-neutral-400 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
      >
        <Trash2 className="size-3" />
      </button>
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-0.5 truncate rounded-b bg-black/70 px-1 text-[9px] text-emerald-300">
        <Scissors className="size-2.5 shrink-0" />
        <span className="truncate">{s.base}</span>
        {s.state === "done" && (
          <span className="ml-auto shrink-0 font-mono">
            {fmtSec(s.durationSec)}
          </span>
        )}
      </div>
    </div>
  );
  // 素材アイテム一式（本体・全体プレビューで共用。tabの絞り込みも反映）。
  // gallery=true は縦横比そのままの大きめサムネで一覧展開する。
  const renderItems = (gallery: boolean) => (
    <>
      {showImages && imagesToShow.map((img) => imageThumb(img, gallery))}
      {showVideos && assets.videos.map((v) => videoThumb(v, gallery))}
      {showChars && subjects.map((s) => charThumb(s, gallery))}
      {tab === "char" && subjects.length === 0 && (
        <div className="text-xs text-neutral-600">
          動画の行の「この動画からキャラを抜く」で作った透過キャラ素材が、ここに並びます
        </div>
      )}
      {tab === "fav" && imagesToShow.length === 0 && (
        <div className="text-xs text-neutral-600">
          ★お気に入りの画像がここに集まります（サムネ右上か拡大時の☆で登録）
        </div>
      )}
      {tab !== "char" &&
        tab !== "fav" &&
        assets.images.length === 0 &&
        assets.videos.length === 0 && (
          <div className="text-xs text-neutral-600">
            images/ フォルダに画像（png/jpg）を入れると、ここに並びます
          </div>
        )}
    </>
  );
  const assetItems = renderItems(false);

  // ヘッダー部品（縦/横で並べ方だけ変える。中身は共通） --------------------
  const viewBtns = (
    <div className="flex shrink-0 items-center gap-1">
      <button
        onClick={toggleRows2}
        title={rows2 ? "1段に戻す" : "2段で表示"}
        className={cn(
          "rounded p-0.5 transition-colors",
          rows2 ? "text-amber-300" : "text-neutral-500 hover:text-neutral-200",
        )}
      >
        <Grid2x2 className="size-3.5" />
      </button>
      <button
        onClick={() => setGalleryOpen(true)}
        title="全体プレビュー（一覧）"
        className="rounded p-0.5 text-neutral-500 transition-colors hover:text-neutral-200"
      >
        <Maximize2 className="size-3.5" />
      </button>
    </div>
  );
  const toggleBtn = (
    <button
      onClick={toggleCollapsed}
      title={collapsed ? "素材を開く" : "素材を畳む"}
      className="flex shrink-0 items-center gap-1 rounded p-0.5 font-medium text-neutral-400 transition-colors hover:text-neutral-200"
    >
      {collapsed ? (
        <ChevronUp className="size-3.5" />
      ) : (
        <ChevronDown className="size-3.5" />
      )}
      <FolderOpen className="size-3.5" /> 素材
    </button>
  );
  const reloadBtn = (
    <button
      onClick={reload}
      title="素材一覧を再読込（ウィンドウに戻った時も自動で更新されます）"
      className="shrink-0 rounded p-0.5 text-neutral-500 transition-colors hover:text-neutral-200"
    >
      <RefreshCw className={`size-3 ${reloading ? "animate-spin" : ""}`} />
    </button>
  );
  const typeTabs = (
    <div className={cn("flex gap-1", vertical && "flex-wrap")}>
      {(
        [
          ["all", `全部`],
          ["image", `画像${assets.images.length}`],
          ["video", `動画${assets.videos.length}`],
          ["char", `キャラ${subjects.length}`],
          ["fav", `★${favs.size}`],
        ] as [Tab, string][]
      ).map(([t, label]) => (
        <button
          key={t}
          onClick={() => setTab(t)}
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
            tab === t
              ? "border-amber-600/60 bg-amber-950/40 text-amber-300"
              : "border-neutral-800 text-neutral-500 hover:text-neutral-300",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
  const posSel = (
    <div className={cn("flex gap-1", vertical && "flex-wrap")}>
      {POSITIONS.map(([p, label, tip]) => (
        <button
          key={p}
          onClick={() => onPos(p)}
          title={tip}
          className={cn(
            "rounded border px-1.5 py-0.5 text-[10px] transition-colors",
            pos === p
              ? "border-amber-600/60 bg-amber-950/40 text-amber-300"
              : "border-neutral-800 text-neutral-500 hover:text-neutral-300",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div
      className={cn(
        "bg-neutral-950",
        vertical ? "flex h-full min-h-0 flex-col" : "border-t border-neutral-800",
      )}
    >
      {/* 常時表示ヘッダー（畳んでも見える）。縦パネルは行ごとに整列、横帯は一列 */}
      {vertical ? (
        <div className="flex flex-col gap-2 border-b border-neutral-800 px-2 py-2 text-xs text-neutral-500">
          <div className="flex items-center gap-1">
            {/* 縦置きは畳んでも列幅が残り無意味なので、畳むボタンは出さず常時表示（ラベルのみ） */}
            <span className="flex shrink-0 items-center gap-1 p-0.5 font-medium text-neutral-400">
              <FolderOpen className="size-3.5" /> 素材
            </span>
            <span className="ml-auto flex items-center gap-1">
              {viewBtns}
              {reloadBtn}
            </span>
          </div>
          {typeTabs}
          <div className="flex flex-col gap-1">
            <button
              onClick={togglePosOpen}
              title="素材帯の置き場所を選ぶ"
              className="flex items-center gap-0.5 text-[9px] uppercase tracking-wide text-neutral-600 transition-colors hover:text-neutral-400"
            >
              {posOpen ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              置き場所
            </button>
            {posOpen && posSel}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-500">
          {toggleBtn}
          {reloadBtn}
          {viewBtns}
          {typeTabs}
          <div className="ml-auto" title="素材帯の置き場所を選ぶ">
            {posSel}
          </div>
        </div>
      )}
      {/* サムネ本体。縦=常時表示（畳む概念なし）/ 横=畳めるので !collapsed の時だけ */}
      {(vertical || !collapsed) && <div className={bodyCls}>{assetItems}</div>}

      {/* 全体プレビュー: 移動・リサイズできる浮遊パネル（現在のタブ絞り込みを反映） */}
      {galleryOpen && (
        <div
          className="fixed z-50 flex flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-950 shadow-2xl"
          style={{
            left: galleryRect.x,
            top: galleryRect.y,
            width: galleryRect.w,
            height: galleryRect.h,
          }}
        >
          {/* ヘッダー（ドラッグで移動）。タブ・×はクリックのまま */}
          <div
            onMouseDown={startGalleryMove}
            className="flex cursor-move flex-wrap items-center gap-2 border-b border-neutral-800 px-3 py-2 text-sm text-neutral-300"
          >
            <FolderOpen className="size-4" /> 素材一覧
            {typeTabs}
            <span className="text-[10px] text-neutral-500">
              クリックで拡大 / ★で登録 ・ ヘッダーで移動・右下で拡縮
            </span>
            <button
              onClick={() => setGalleryOpen(false)}
              title="閉じる（Esc）"
              className="ml-auto rounded p-1 text-neutral-400 transition-colors hover:text-neutral-100"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="flex flex-1 flex-wrap content-start items-start gap-2 overflow-y-auto p-3">
            {renderItems(true)}
          </div>
          {/* 右下リサイズハンドル */}
          <div
            onMouseDown={startGalleryResize}
            title="ドラッグでサイズ変更"
            className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
            style={{
              background:
                "linear-gradient(135deg, transparent 50%, rgb(115 115 115) 50%)",
            }}
          />
        </div>
      )}

      {/* 🧑 キャラ素材の拡大プレビュー（行への割り当てボタンは無し＝背景と誤用させない） */}
      <Dialog open={charPreview !== null} onOpenChange={(o) => !o && setCharPreview(null)}>
        <DialogContent className="max-w-5xl border-neutral-800 bg-neutral-950 p-3">
          <DialogTitle className="flex items-center gap-2 text-sm font-normal text-neutral-300">
            <Scissors className="size-4 text-emerald-400" />
            <span className="font-mono">{charPreview?.base}</span>
            {charPreview && (
              <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px]">
                {charPreview.count}コマ / {fmtSec(charPreview.durationSec)}
              </span>
            )}
            <span className="text-[10px] text-neutral-500">
              透過キャラ素材（グレー背景は確認用の合成）
            </span>
          </DialogTitle>
          {charPreview && (
            <video
              src={assetUrl("", projectName, `subjects/${charPreview.base}/preview.mp4`)}
              controls
              autoPlay
              loop
              muted
              className="max-h-[66vh] w-full rounded object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* 拡大プレビュー＋（動画なら）系譜＋行への割り当て */}
      <Dialog open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-5xl border-neutral-800 bg-neutral-950 p-3">
          <DialogTitle className="flex items-center gap-2 text-sm font-normal text-neutral-300">
            <span className="font-mono">{preview}</span>
            {preview && videoOf(preview) && (
              <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px]">
                {fmtSec(videoOf(preview)!.durationSec)}
              </span>
            )}
            {previewAsset?.hasDepth && (
              <span className="flex items-center gap-1 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px]">
                <Mountain className="size-3 text-emerald-400" />
                深度マップあり（パララックス可）
              </span>
            )}
            <Button
              size="sm"
              className="ml-auto h-7 text-xs"
              onClick={() => preview && assignToSelected(preview)}
            >
              選択中の行に割り当て
            </Button>
          </DialogTitle>
          {preview && (
            <div className="relative">
              {isVideoFile(preview) ? (
                <video
                  src={assetUrl("", projectName, preview)}
                  controls
                  autoPlay
                  loop
                  muted
                  className="max-h-[66vh] w-full rounded object-contain"
                />
              ) : (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={assetUrl("", projectName, preview)}
                    alt={preview}
                    className="max-h-[66vh] w-full rounded object-contain"
                  />
                  {/* ☆お気に入りを画像の右上にオーバーレイ */}
                  <button
                    onClick={() => toggleFav(preview)}
                    title={favs.has(preview) ? "お気に入り解除" : "お気に入り登録"}
                    className={cn(
                      "absolute right-2 top-2 flex items-center gap-1 rounded-full border px-2 py-1 text-xs backdrop-blur transition-colors",
                      favs.has(preview)
                        ? "border-amber-500/70 bg-amber-950/70 text-amber-300"
                        : "border-neutral-600 bg-black/60 text-neutral-200 hover:text-amber-300",
                    )}
                  >
                    <Star
                      className={cn("size-4", favs.has(preview) && "fill-amber-400")}
                    />
                  </button>
                </>
              )}
            </div>
          )}
          {/* 🔗 系譜: 元→合体版の家族関係。クリックでそのままプレビュー切替 */}
          {preview &&
            (() => {
              const me = videoOf(preview);
              if (!me) return null;
              const root = me.parent ?? me.file;
              const family = [
                videoOf(root),
                ...childrenOf(root),
              ].filter(Boolean) as VideoAsset[];
              if (family.length <= 1) return null;
              return (
                <div className="rounded border border-sky-900 bg-sky-950/20 p-2">
                  <div className="mb-1.5 text-[11px] text-sky-300">
                    この動画の系譜（元 ─➤ 合体版）
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {family.map((f, i) => (
                      <React.Fragment key={f.file}>
                        {i > 0 && <span className="text-neutral-600">─➤</span>}
                        <button
                          onClick={() => setPreview(f.file)}
                          className={cn(
                            "rounded border px-2 py-1 text-left text-[11px] transition-colors",
                            f.file === preview
                              ? "border-amber-500 bg-amber-950/30 text-amber-200"
                              : "border-neutral-700 text-neutral-300 hover:border-neutral-500",
                          )}
                        >
                          <div className="font-mono">{baseName(f.file)}</div>
                          <div className="text-neutral-500">
                            {f.parent ? "合体版" : "元"} · {fmtSec(f.durationSec)}
                          </div>
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              );
            })()}
        </DialogContent>
      </Dialog>
    </div>
  );
};
