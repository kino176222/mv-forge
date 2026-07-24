"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { Repeat, Smartphone } from "lucide-react";
import { MVComposition } from "@/remotion/MVComposition";
import { deriveSections, deriveTimeline, toFrames } from "@/lib/sections";
import {
  applyShortToProject,
  applyFramingDrag,
  applyFramingWheel,
  resolveFramingBase,
  SHORT_SAFE_ZONES,
} from "@/lib/shorts";
import { useEditor } from "@/lib/store";
import { playerRef, usePlayback } from "@/lib/player-bridge";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * プレビュー窓。書き出しと同一のコンポジションをそのまま再生する
 * （プレビュー＝完成品の保証。なんちゃってプレビューは作らない）。
 */
export const PlayerPanel: React.FC = () => {
  const project = useEditor((s) => s.project);
  const projectName = useEditor((s) => s.projectName);
  const beats = useEditor((s) => s.beats);
  const songStructure = useEditor((s) => s.songStructure);
  const selected = useEditor((s) => s.selectedLine);
  const tab = useEditor((s) => s.tab);
  const selectedShortId = useEditor((s) => s.selectedShortId);
  const localRef = useRef<PlayerRef>(null);
  const setFrame = usePlayback((s) => s.setFrame);
  const setPlaying = usePlayback((s) => s.setPlaying);
  // フレーミング直接操作: 選択キーはShortsPanelとstore共有。更新は updateShort（undo単位）
  const framingKey = useEditor((s) => s.framingKey);
  const updateShort = useEditor((s) => s.updateShort);
  // ドラッグ中の作業値（closureのstale回避のためrefで保持）
  const frameDrag = useRef<{
    lastX: number;
    lastY: number;
    val: { frameScale: number; frameX: number; frameY: number };
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  // 区間ループ: 選択行の属する区間だけを回して詰め作業を高速化
  const [loopSection, setLoopSection] = useState(false);
  // UIゾーンガイド（ショート編集時のみ）: プラットフォームUIに被る領域の目安。書き出しには乗らない
  // （プロジェクト読込前はガイド自体が出ないため、lazy初期化でもhydration差異は起きない）
  const [safeGuide, setSafeGuide] = useState(
    () =>
      typeof window === "undefined" ||
      localStorage.getItem("mvforge-shorts-safe-guide") !== "off",
  );

  const timeline = useMemo(
    () => (project ? deriveTimeline(project) : null),
    [project],
  );
  const sections = useMemo(
    () =>
      project && timeline
        ? deriveSections(project.lines, timeline.songDuration)
        : [],
    [project, timeline],
  );
  const currentSection = sections.find((s) => s.lineIndexes.includes(selected));

  // ショートタブ中は縦合成した project でプレビュー（書き出しと同じ applyShortToProject 経路＝
  // 縦プレビューで見た文字サイズ・フレーミング・texts がそのまま完成品になる）
  const composedShort = useMemo(() => {
    if (tab !== "shorts" || !project) return null;
    const short = project.shorts.find((s) => s.id === selectedShortId);
    if (!short) return null;
    return applyShortToProject(project, short, "vertical");
  }, [tab, project, selectedShortId]);

  const loopRange = useMemo((): [number, number] | null => {
    if (!loopSection || !currentSection || !timeline || !project) return null;
    const fps = project.meta.fps;
    const from = toFrames(timeline.songStart + currentSection.start, fps);
    const to = Math.max(
      from + 1,
      toFrames(timeline.songStart + currentSection.end, fps) - 1,
    );
    return [from, to];
  }, [loopSection, currentSection, timeline, project]);

  useEffect(() => {
    playerRef.current = localRef.current;
    const p = localRef.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
    };
  }, [setFrame, setPlaying, project]);

  // プレビューの高さはドラッグで可変（詳細設定が潰れないように）
  const [height, setHeight] = useState(360);
  useEffect(() => {
    const saved = Number(localStorage.getItem("mvforge-player-height"));
    if (saved > 150) setHeight(saved);
  }, []);

  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = height;
      const onMove = (ev: PointerEvent) => {
        const h = Math.min(
          Math.round(window.innerHeight * 0.72),
          Math.max(180, startH + (ev.clientY - startY)),
        );
        setHeight(h);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setHeight((h) => {
          localStorage.setItem("mvforge-player-height", String(h));
          return h;
        });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [height],
  );

  if (!project || !timeline) return null;

  // 表示するproject: ショート編集中は縦合成版、それ以外は本編そのまま
  const viewProject = composedShort?.project ?? project;
  const shortRange = composedShort?.frameRange ?? null;

  // プレビュー直接ドラッグ: 選択中フレーミング対象を掴んで位置(ドラッグ)・拡大(ホイール)。
  // 全体見せ時はクロップしないので無効。framingKey は ShortsPanel と store 共有。
  const short = project.shorts.find((s) => s.id === selectedShortId) ?? null;
  const framingActive =
    shortRange !== null && !!framingKey && !!short && !short.fullFrame;
  const framingCur =
    short && framingKey
      ? (short.framingOverrides[framingKey] ?? resolveFramingBase(project, framingKey))
      : null;

  const onFrameDragStart = (e: React.PointerEvent) => {
    if (!framingActive || !framingCur || !short || !framingKey) return;
    e.preventDefault();
    frameDrag.current = { lastX: e.clientX, lastY: e.clientY, val: { ...framingCur } };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onFrameDragMove = (e: React.PointerEvent) => {
    const ds = frameDrag.current;
    if (!ds || !short || !framingKey) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const d = applyFramingDrag(
      ds.val,
      e.clientX - ds.lastX,
      e.clientY - ds.lastY,
      rect.width,
      rect.height,
    );
    ds.val = { ...ds.val, ...d };
    ds.lastX = e.clientX;
    ds.lastY = e.clientY;
    updateShort(short.id, {
      framingOverrides: { ...short.framingOverrides, [framingKey]: ds.val },
    });
  };
  const onFrameDragEnd = (e: React.PointerEvent) => {
    frameDrag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onFrameWheel = (e: React.WheelEvent) => {
    if (!framingActive || !short || !framingKey) return;
    const cur = short.framingOverrides[framingKey] ?? resolveFramingBase(project, framingKey);
    if (!cur) return;
    const frameScale = applyFramingWheel(cur.frameScale, e.deltaY);
    updateShort(short.id, {
      framingOverrides: { ...short.framingOverrides, [framingKey]: { ...cur, frameScale } },
    });
  };

  return (
    <div className="shrink-0">
      <div className="relative flex justify-center bg-black" style={{ height }}>
        <div
          className="relative"
          style={{
            height: "100%",
            // 16:9ハードコード撤去: metaから算出（ショート中は自動で9:16になる）
            aspectRatio: `${viewProject.meta.width} / ${viewProject.meta.height}`,
            maxWidth: "100%",
          }}
        >
          <Player
            ref={localRef}
            component={MVComposition}
            inputProps={{
              project: viewProject,
              projectName,
              assetBase: "",
              beats,
              downbeats: songStructure?.downbeats ?? [],
            }}
            durationInFrames={Math.max(30, toFrames(timeline.total, viewProject.meta.fps))}
            fps={viewProject.meta.fps}
            compositionWidth={viewProject.meta.width}
            compositionHeight={viewProject.meta.height}
            style={{ width: "100%", height: "100%" }}
            controls
            showVolumeControls
            doubleClickToFullscreen
            spaceKeyToPlayOrPause={false}
            acknowledgeRemotionLicense
            inFrame={shortRange?.[0] ?? loopRange?.[0] ?? null}
            outFrame={shortRange?.[1] ?? loopRange?.[1] ?? null}
            loop={shortRange !== null || loopRange !== null}
          />
          {/* UIゾーンガイド（ショート編集時のみの目安表示。書き出しには一切乗らない）。
              固定pxの公式値は存在しないため保守的な近似（lib/shorts.ts SHORT_SAFE_ZONES） */}
          {shortRange !== null && safeGuide && (
            <div className="pointer-events-none absolute inset-0">
              <div
                className="absolute inset-x-0 top-0 border-b border-dashed border-red-400/50 bg-red-500/10"
                style={{ height: `${SHORT_SAFE_ZONES.topPct}%` }}
              />
              <div
                className="absolute inset-x-0 bottom-0 border-t border-dashed border-red-400/50 bg-red-500/10"
                style={{ height: `${SHORT_SAFE_ZONES.bottomPct}%` }}
              />
              <div
                className="absolute right-0 border-l border-dashed border-red-400/50 bg-red-500/10"
                style={{
                  top: `${SHORT_SAFE_ZONES.topPct}%`,
                  bottom: `${SHORT_SAFE_ZONES.bottomPct}%`,
                  width: `${SHORT_SAFE_ZONES.rightPct}%`,
                }}
              />
            </div>
          )}
          {/* プレビュー直接ドラッグ: フレーミング対象を掴んで位置・ホイールで拡大（全体見せ時は無効）。
              下部はRemotionの操作バーに席を譲るため空ける */}
          {framingActive && (
            <div
              onPointerDown={onFrameDragStart}
              onPointerMove={onFrameDragMove}
              onPointerUp={onFrameDragEnd}
              onPointerCancel={onFrameDragEnd}
              onWheel={onFrameWheel}
              className={cn(
                "absolute inset-x-0 top-0 bottom-11 z-10 touch-none",
                dragging ? "cursor-grabbing" : "cursor-grab",
              )}
            >
              <span className="pointer-events-none absolute left-1/2 top-9 -translate-x-1/2 whitespace-nowrap rounded bg-black/70 px-2 py-0.5 text-[10px] text-neutral-100">
                ドラッグで位置 / ホイールで拡大
              </span>
            </div>
          )}
          {/* 再生/シーク/時間/音量/全画面は下部のネイティブ操作バーに一本化（自作再生ボタンは撤去）。
              フレーミング中はドラッグ層が中央クリック再生を奪うが、下部バーの再生は席を空けてあるので使える。 */}
        </div>
        {/* UIゾーンガイドトグル（ショート編集時のみ表示）。ホバーで意味を説明 */}
        {shortRange !== null && (
          <TooltipProvider>
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    setSafeGuide((v) => {
                      localStorage.setItem("mvforge-shorts-safe-guide", v ? "off" : "on");
                      return !v;
                    });
                  }}
                  className={cn(
                    "absolute right-2 top-2 flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition-colors",
                    safeGuide
                      ? "border-primary bg-primary/20 text-primary"
                      : "border-neutral-700 bg-black/60 text-neutral-400 hover:text-neutral-200",
                  )}
                >
                  <Smartphone className="size-3" /> UIゾーン
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="w-64 space-y-1.5 p-3 text-xs leading-relaxed">
                <p className="font-semibold">投稿アプリのUIに隠れる場所の目安を赤帯で表示します。</p>
                <p className="text-background/70">
                  Shorts/TikTok/Reelsでは右にボタン列、下にキャプション、上に検索が重なります。
                  歌詞・顔・CTAは<b className="font-semibold text-background">赤帯の外</b>に置くのが安全です。
                </p>
                <p className="border-t border-background/15 pt-1.5 text-background/70">
                  編集画面だけの目安で、<b className="font-semibold text-background">書き出しには乗りません</b>。
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {/* 区間ループトグル（選択行の区間だけを回す。ショート中は範囲ループ優先＝UIゾーンに席を譲る） */}
        {shortRange === null && (
        <button
          onClick={() => setLoopSection((v) => !v)}
          disabled={!currentSection || shortRange !== null}
          title={
            currentSection
              ? `選択行の区間（${Math.round(currentSection.start)}s〜${Math.round(currentSection.end)}s）をループ`
              : "行を選択すると区間ループできます"
          }
          className={cn(
            "absolute right-2 top-2 flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition-colors",
            loopSection
              ? "border-primary bg-primary/20 text-primary"
              : "border-neutral-700 bg-black/60 text-neutral-400 hover:text-neutral-200",
          )}
        >
          <Repeat className="size-3" /> 区間ループ
        </button>
        )}
      </div>
      {/* リサイズハンドル: ドラッグで高さ調整 / ダブルクリックで既定に戻す */}
      <div
        onPointerDown={onDragStart}
        onDoubleClick={() => {
          setHeight(360);
          localStorage.setItem("mvforge-player-height", "360");
        }}
        title="ドラッグでプレビューの大きさを変更（ダブルクリックで戻す）"
        className="group flex h-2.5 cursor-row-resize items-center justify-center bg-neutral-900 transition-colors hover:bg-primary/30"
      >
        <div className="h-1 w-16 rounded-full bg-neutral-600 group-hover:bg-primary" />
      </div>
    </div>
  );
};
