"use client";
import React from "react";
import {
  Film,
  Play,
  Plus,
  Scissors,
  Trash2,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useEditor } from "@/lib/store";
import { snapToMusic } from "@/lib/beat-snap";
import { usePlayback, seekToFrame } from "@/lib/player-bridge";
import { deriveSectionCuts, type PlacedCut } from "@/lib/cuts";
import type { Cut } from "@/lib/schema";
import { newLineId } from "@/lib/lrc";
import { assetUrl } from "@/remotion/asset-url";
import { cn, isVideoFile } from "@/lib/utils";
import { VideoTrimControls } from "./VideoTrimControls";
import { KnobRow } from "./KnobRow";
import { CreditLane } from "./CreditLane";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * ✂️✂️ ショットセクション（区間頭の行のみ）。
 * 1行（区間）の中の絵を「ショット」として一本化して編集する。
 * - 1枚（cuts なし）＝枠なしインライン: 行の絵＋動画パラメータ＋フレーミング＋「＋ショット」。
 * - 2枚以上（cuts あり）＝アコーディオンのカード列: カット1も対等なカード#1として同じ操作で編集。
 * カット1は行と癒着（cuts[0].image=line.image・at=0）しているため、
 * カード#1の編集は行フィールドへ代理書き込み（フレーミングは line と cuts[0] を1操作で同期）する。
 * 並べ替えは「絵+トリムの中身だけ交換」＝atグリッド維持で音ハメが崩れない。
 */

/** 🖼 素材ピッカー: 画像＋動画のサムネ一覧をポップオーバーで出し、選んだファイルを返す。
    ＋ショット（新規追加）と各ショットの絵の差し替えで共用する。 */
const AssetPickerPopover: React.FC<{
  projectName: string;
  images: { file: string }[];
  videos: { file: string }[];
  onPick: (file: string) => void;
  trigger: React.ReactNode;
  align?: "start" | "center" | "end";
}> = ({ projectName, images, videos, onPick, trigger, align = "end" }) => {
  const [open, setOpen] = React.useState(false);
  const pick = (file: string) => {
    onPick(file);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className="w-72 p-2">
        {images.length + videos.length === 0 ? (
          <p className="p-2 text-[11px] text-neutral-500">
            素材がありません。左の素材帯に画像/動画を追加してください。
          </p>
        ) : (
          <div className="grid max-h-64 grid-cols-3 gap-1.5 overflow-y-auto">
            {images.map((img) => (
              <button
                key={img.file}
                type="button"
                onClick={() => pick(img.file)}
                title={img.file.replace(/^images\//, "")}
                className="aspect-video overflow-hidden rounded border border-neutral-700 hover:border-amber-400"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={assetUrl("", projectName, img.file)}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
            {videos.map((v) => (
              <button
                key={v.file}
                type="button"
                onClick={() => pick(v.file)}
                title={v.file.replace(/^videos\//, "")}
                className="relative flex aspect-video items-center justify-center rounded border border-sky-700 hover:border-amber-400"
              >
                <Film className="size-4 text-sky-400" />
                <span className="absolute inset-x-0 bottom-0 truncate px-0.5 text-[8px] text-neutral-400">
                  {v.file.replace(/^videos\//, "")}
                </span>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

/** ▮ 再生ヘッド: 現在フレームを区間内の相対位置に変換して縦線で表示（音ハメ用）。
    30fpsで更新されるので購読はこの小部品だけに閉じ込め、バー全体の再レンダーを避ける。 */
const Playhead: React.FC<{ startFrame: number; endFrame: number }> = ({
  startFrame,
  endFrame,
}) => {
  const frame = usePlayback((s) => s.frame);
  if (endFrame <= startFrame) return null;
  const ratio = (frame - startFrame) / (endFrame - startFrame);
  if (ratio < 0 || ratio > 1) return null;
  return (
    <div
      style={{ left: `${ratio * 100}%` }}
      className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-red-500"
    />
  );
};

/** 🎚 タイムライン: 各ショットを尺比例の幅で横に並べ（サムネ入り＝見た目と時間が一致）、
    境界（カット2以降の開始）をドラッグで調整する。ビート目盛りを薄く重ねて音ハメを視覚化。
    再生ヘッドが走る。ドラッグ値はビート吸着＋隣を越えないクランプで確定。 */
const ShotTimeBar: React.FC<{
  projectName: string;
  placed: PlacedCut[];
  sectionSec: number;
  beatMarks: number[];
  downbeatMarks: number[];
  openId: string | undefined;
  startFrame: number;
  endFrame: number;
  snap: (sec: number) => number;
  onSelect: (id: string) => void;
  onSetAt: (cutId: string, sec: number) => void;
  /** クリック位置に再生ヘッドを頭出し（戻す/飛ばす） */
  onSeek?: (sec: number) => void;
}> = ({
  projectName,
  placed,
  sectionSec,
  beatMarks,
  downbeatMarks,
  openId,
  startFrame,
  endFrame,
  snap,
  onSelect,
  onSetAt,
  onSeek,
}) => {
  const barRef = React.useRef<HTMLDivElement>(null);

  // 境界ハンドルのドラッグ: 開始/終了を掴んだ時点で確定し、同一関数で add/remove する
  const startDrag = (cutId: string, idx: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const prev = placed[idx - 1];
    const next = placed[idx + 1];
    const lo = (prev ? prev.startSec : 0) + 0.1;
    const hi = (next ? next.startSec : sectionSec) - 0.1;
    const onMove = (ev: PointerEvent) => {
      const ratio = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      const sec = Math.min(hi, Math.max(lo, snap(ratio * sectionSec)));
      onSetAt(cutId, sec);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={barRef}
      className="relative h-16 select-none overflow-hidden rounded border border-neutral-800 bg-neutral-900"
    >
      {/* セグメント（尺比例・サムネ入り）: クリックでそのカードを開く */}
      {placed.map((pc, i) => (
        <button
          key={pc.cut.id}
          type="button"
          onClick={(e) => {
            onSelect(pc.cut.id);
            // クリック位置に頭出し（再生ヘッドをここへ戻す/飛ばす）
            if (onSeek && barRef.current) {
              const rect = barRef.current.getBoundingClientRect();
              const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
              onSeek(ratio * sectionSec);
            }
          }}
          style={{
            left: `${(pc.startSec / sectionSec) * 100}%`,
            width: `${(pc.durationSec / sectionSec) * 100}%`,
          }}
          className={cn(
            "absolute inset-y-0 overflow-hidden border-r border-neutral-700 text-left",
            pc.cut.id === openId
              ? "outline outline-2 -outline-offset-2 outline-amber-400"
              : "hover:brightness-110",
          )}
          title={`${i + 1}: ${pc.startSec.toFixed(2)}s〜（${pc.durationSec.toFixed(2)}s間）\nクリック=選択＋その位置に頭出し`}
        >
          {isVideoFile(pc.cut.image) ? (
            <span className="flex h-full w-full items-center justify-center bg-sky-950/60">
              <Film className="size-4 text-sky-400" />
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={assetUrl("", projectName, pc.cut.image)}
              alt=""
              draggable={false}
              className="h-full w-full object-cover"
            />
          )}
          <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 font-mono text-[9px] text-white">
            {i + 1} · {pc.startSec.toFixed(1)}s
          </span>
          {/* クレジット付きショットの目印 */}
          {pc.cut.credit?.text.trim() ? (
            <span
              className="absolute right-0 top-0 rounded-bl bg-amber-500/90 px-1 font-mono text-[8px] text-black"
              title={`クレジット: ${pc.cut.credit.text}`}
            >
              C
            </span>
          ) : null}
        </button>
      ))}
      {/* ビート目盛り（音ハメの目安）: 通常拍は薄く短く */}
      {beatMarks.map((s, i) => (
        <div
          key={`beat-${i}`}
          style={{ left: `${(s / sectionSec) * 100}%` }}
          className="pointer-events-none absolute inset-y-1 w-px bg-white/20"
        />
      ))}
      {/* 小節頭（downbeat）は明るく・全高で強調（音ハメの主軸） */}
      {downbeatMarks.map((s, i) => (
        <div
          key={`down-${i}`}
          style={{ left: `${(s / sectionSec) * 100}%` }}
          className="pointer-events-none absolute inset-y-0 w-px bg-amber-300/60"
        />
      ))}
      {/* 境界ハンドル: カット2以降の開始をドラッグ（cut1は0固定でハンドル無し） */}
      {placed.map((pc, i) =>
        i === 0 ? null : (
          <div
            key={`handle-${pc.cut.id}`}
            onPointerDown={startDrag(pc.cut.id, i)}
            style={{ left: `${(pc.startSec / sectionSec) * 100}%` }}
            className="absolute inset-y-0 z-10 -ml-2 w-4 cursor-ew-resize"
            title="ドラッグで開始秒を調整（ビート吸着）"
          >
            <div className="mx-auto h-full w-0.5 bg-amber-400" />
          </div>
        ),
      )}
      {/* 再生ヘッド（再生中に区間内を走る） */}
      <Playhead startFrame={startFrame} endFrame={endFrame} />
    </div>
  );
};

// フレーミング（拡大して一部を使う）の3本つまみ定義。行/カット共通で使う
const FRAMING_KEYS = [
  { key: "frameScale", label: "拡大率", min: 1, max: 3, step: 0.05, unit: "x" },
  { key: "frameX", label: "横位置", min: -40, max: 40, step: 1, unit: "%" },
  { key: "frameY", label: "縦位置", min: -40, max: 40, step: 1, unit: "%" },
] as const;
type FramingKey = (typeof FRAMING_KEYS)[number]["key"];

export const CutsBlock: React.FC<{
  lineIndex: number;
  sectionSec: number;
  sectionStartFrame?: number;
  sectionEndFrame?: number;
  onAudition?: () => void;
}> = ({
  lineIndex,
  sectionSec,
  sectionStartFrame = 0,
  sectionEndFrame = 0,
  onAudition,
}) => {
  const project = useEditor((s) => s.project);
  const projectName = useEditor((s) => s.projectName);
  const assets = useEditor((s) => s.assets);
  const beats = useEditor((s) => s.beats);
  const songStructure = useEditor((s) => s.songStructure);
  const updateLine = useEditor((s) => s.updateLine);
  const setLineImage = useEditor((s) => s.setLineImage);
  const addCut = useEditor((s) => s.addCut);
  const updateCut = useEditor((s) => s.updateCut);
  const removeCut = useEditor((s) => s.removeCut);
  const swapCutMedia = useEditor((s) => s.swapCutMedia);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [framingOpen, setFramingOpen] = React.useState(false);
  const line = project?.lines[lineIndex];
  if (!line || !line.image) return null;

  // 素材帯からのD&D受け口（LinesTable と同じ text/mvforge-image を読む）。
  // 落とした先のショットに絵を割り当てる（cut1=行の絵、cut2+=そのカット）。
  const dropHandlers = (assign: (file: string) => void) => ({
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes("text/mvforge-image")) {
        e.preventDefault();
        e.currentTarget.classList.add("outline", "outline-amber-400");
      }
    },
    onDragLeave: (e: React.DragEvent) =>
      e.currentTarget.classList.remove("outline", "outline-amber-400"),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.currentTarget.classList.remove("outline", "outline-amber-400");
      const file = e.dataTransfer.getData("text/mvforge-image");
      if (file) assign(file);
    },
  });

  const placed = deriveSectionCuts(line, sectionSec);
  const multi = line.cuts.length > 1;
  const lineIsVideo = isVideoFile(line.image);

  // 追加位置: 最終カットの区間を半分に割る（後からナッジ/吸着で合わせる）
  const nextAt = () => {
    const last = placed[placed.length - 1];
    return Math.round((last.startSec + last.durationSec / 2) * 100) / 100;
  };

  const snapToBeat = (sec: number): number => {
    if (beats.length === 0) return sec;
    // 区間頭からの秒→曲内秒に直して小節頭優先で吸着（磁石幅0.35s・beat-snapに一本化）
    const lineStart = line.startTime + line.offset;
    const snapped = snapToMusic(
      lineStart + sec,
      { beats, downbeats: songStructure?.downbeats },
      0.35,
    );
    if (snapped === lineStart + sec) return sec; // 吸着せず＝素通し
    return Math.max(0, Math.round((snapped - lineStart) * 100) / 100);
  };

  // ＋ショット: 選んだ絵で新ショットを追加（最後のカットを半分に割る）。single→multiの変身も兼ねる
  const addShotWith = (file: string) => {
    const at = nextAt();
    const id = newLineId();
    addCut(lineIndex, {
      id,
      image: file,
      i2vSource: null,
      at,
      trimStart: 0,
      trimEnd: null,
      videoLoop: "pingpong",
      videoRate: null,
      videoAnchor: "head",
      frameScale: 1,
      frameX: 0,
      frameY: 0,
      credit: null,
    });
    setSelectedId(id);
  };

  // ⧉ 分割: 対象ショットを「同じ絵」で半分に割る。静止画は継ぎ目ゼロなので、
  // 「1枚の絵の上でテキストを1→2→3と順番に出す」ための時間の器づくりに使う
  const splitShot = (pc: { cut: Cut; startSec: number; durationSec: number }) => {
    const id = newLineId();
    addCut(lineIndex, {
      ...pc.cut,
      id,
      at: Math.round((pc.startSec + pc.durationSec / 2) * 100) / 100,
      credit: null, // テキストは新区画に付け直す（複製しない）
    });
    setSelectedId(id);
  };

  // ＋ショットは素材ピッカーを開き、選んだ絵で追加する
  const addShotButton = (
    <AssetPickerPopover
      projectName={projectName}
      images={assets.images}
      videos={assets.videos}
      onPick={addShotWith}
      trigger={
        <button
          type="button"
          className="flex items-center gap-1 rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:border-neutral-500"
          title="素材を選んで新しいショットを追加"
        >
          <Plus className="size-3" />＋ショット
        </button>
      }
    />
  );

  // 🔊 この区間だけ試聴（区間頭から再生→区間末で自動停止）。繰り返し確認は右上の「区間ループ」で
  const auditionButton = onAudition ? (
    <button
      type="button"
      onClick={onAudition}
      className="flex items-center gap-1 rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:border-neutral-500"
      title="この区間だけを頭から再生（区間末で自動停止）"
    >
      <Play className="size-3" />試聴
    </button>
  ) : null;

  // 🔍 フレーミング編集ブロック（行/カット共通）。カット1は行フィールドへ同期する
  const framingBlock = (opts: {
    read: (key: FramingKey) => number;
    write: (key: FramingKey, v: number) => void;
    reset: () => void;
  }) => {
    const dirty =
      opts.read("frameScale") !== 1 ||
      opts.read("frameX") !== 0 ||
      opts.read("frameY") !== 0;
    return (
      <div className="space-y-1 rounded border border-neutral-800 p-2">
        <div className="flex items-center justify-between text-xs text-neutral-400">
          <button
            type="button"
            onClick={() => setFramingOpen((o) => !o)}
            className="flex items-center gap-1 hover:text-neutral-200"
          >
            {framingOpen ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            <span>フレーミング（拡大して一部を使う）</span>
            {dirty && !framingOpen && (
              <span className="rounded bg-amber-500/20 px-1 text-[9px] text-amber-300">
                調整中
              </span>
            )}
          </button>
          {dirty && (
            <Button size="sm" variant="ghost" className="h-5 text-xs" onClick={opts.reset}>
              リセット
            </Button>
          )}
        </div>
        {framingOpen && (
          <>
            {FRAMING_KEYS.map((k) => (
              <KnobRow
                key={k.key}
                label={k.label}
                min={k.min}
                max={k.max}
                step={k.step}
                unit={k.unit}
                value={opts.read(k.key)}
                onChange={(v) => opts.write(k.key, v)}
              />
            ))}
            <p className="text-[10px] text-neutral-500">
              位置をずらした分は黒が出ないよう自動で追い拡大されます。回転・シェイク系で端の黒が気になるときは拡大率を上げてください
            </p>
          </>
        )}
      </div>
    );
  };

  // ビート目盛り（曲内秒→区間頭からの相対秒）。single/multi共通でタイムバーの音ハメ目安に使う。
  // 小節頭（downbeat）は別レイヤーで明るく/長く、通常拍は薄くの2階層。
  const lineStartSec = line.startTime + line.offset;
  const inSectionRange = (s: number) => s > 0.01 && s < sectionSec - 0.01;
  const beatMarksAll = beats.map((b) => b - lineStartSec).filter(inSectionRange);
  const downbeatMarksAll = (songStructure?.downbeats ?? [])
    .map((b) => b - lineStartSec)
    .filter(inSectionRange);
  const seekInSection = (sec: number) => {
    const fps = project?.meta.fps ?? 30;
    seekToFrame(Math.round(sectionStartFrame + sec * fps));
  };

  // 🅣 行クレジットの区画長＝レンダラーの表示窓と同じ「次の行まで」（継続行含む。最終行は+8s上限）。
  // 区間末（次の絵まで）にすると、1枚の絵に複数行が乗る区間で「チップ＝実際の表示窓」の契約が破れ、
  // レーンでは区間末まで見えるのに実レンダは次の行で消える（duration=0の意味のズレ）
  const nextLine = project?.lines[lineIndex + 1];
  const lineCreditWindowSec = Math.min(
    Math.max(
      (nextLine
        ? nextLine.startTime + nextLine.offset
        : Math.min(lineStartSec + 8, project?.meta.songDuration ?? lineStartSec + 8)) -
        lineStartSec,
      0.2,
    ),
    sectionSec,
  );

  // ---- single（1枚）: multiと同じ「ミニ編集画面」（テキストレーン＋タイムライン＋試聴） ----
  if (!multi) {
    return (
      <div
        className="space-y-1.5 rounded"
        {...dropHandlers((f) => setLineImage(lineIndex, f))}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs text-neutral-400">ショット（1カット）</span>
          <span className="flex items-center gap-1">
            {auditionButton}
            <button
              type="button"
              onClick={() => placed[0] && splitShot(placed[0])}
              className="flex items-center gap-1 rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:border-neutral-500"
              title="同じ絵のまま2つに分割（1枚の絵の上でテキストを順番に出したい時に）"
            >
              <Scissors className="size-3" />
              分割
            </button>
            {addShotButton}
          </span>
        </div>

        {/* 🅣 テキストトラック: 1枚の行は行全体で1区画（行クレジットに載る。窓=次の行まで） */}
        <CreditLane
          sectionSec={sectionSec}
          snap={snapToBeat}
          segments={[
            {
              key: `line-${line.id}`,
              startSec: 0,
              durationSec: lineCreditWindowSec,
              title: "この行のテキスト",
              credit: line.credit,
              onChange: (card) => updateLine(lineIndex, { credit: card }),
            },
          ]}
        />

        {/* 🎚 タイムライン: 1カットでも同じ画面（再生ヘッド・ビート目盛り・クリック頭出し） */}
        <ShotTimeBar
          projectName={projectName}
          placed={placed}
          sectionSec={sectionSec}
          beatMarks={beatMarksAll}
          downbeatMarks={downbeatMarksAll}
          openId={undefined}
          startFrame={sectionStartFrame}
          endFrame={sectionEndFrame}
          snap={snapToBeat}
          onSelect={() => {}}
          onSetAt={() => {}}
          onSeek={seekInSection}
        />

        {/* 画像／動画（区間の絵）。実素材をインラインで見せる。素材帯からD&D or「差し替え」で変更 */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-neutral-400">
              {lineIsVideo ? "動画" : "画像"}
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-1 truncate font-mono text-xs">
              {lineIsVideo && <Film className="size-3 shrink-0 text-sky-400" />}
              <span className="truncate">{line.image}</span>
            </span>
            <AssetPickerPopover
              projectName={projectName}
              images={assets.images}
              videos={assets.videos}
              onPick={(f) => setLineImage(lineIndex, f)}
              trigger={
                <Button size="sm" variant="ghost" className="h-6 text-xs text-neutral-300">
                  差し替え
                </Button>
              }
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs text-neutral-400"
              onClick={() => setLineImage(lineIndex, null)}
              title="この行の絵を外して前の絵を継続する"
            >
              外す
            </Button>
          </div>
          {lineIsVideo ? (
            <>
              {/* ✂️ トリム付きプレビュー: in/out で「良い部分だけ」使う。
                  確定の見た目確認はメインプレビュー（レンダラーと同一計算） */}
              <VideoTrimControls
                key={line.image}
                videoUrl={assetUrl("", projectName, line.image)}
                trimStart={line.videoTrimStart}
                trimEnd={line.videoTrimEnd}
                sectionSec={sectionSec}
                onChange={(s, e) =>
                  updateLine(lineIndex, { videoTrimStart: s, videoTrimEnd: e })
                }
              />
              {/* 区間が動画より長いときの延ばし方。pingpong=静止しない（既定）/ hold=静止 */}
              <div className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 text-neutral-400">延ばし方</span>
                <Select
                  value={line.videoLoop}
                  onValueChange={(v) =>
                    updateLine(lineIndex, {
                      videoLoop: v === "hold" ? "hold" : "pingpong",
                    })
                  }
                >
                  <SelectTrigger className="h-7 flex-1 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pingpong" className="text-xs">
                      往復で繋ぐ（既定・静止しない）— 髪揺れ・雨など環境系に最適
                    </SelectItem>
                    <SelectItem value="hold" className="text-xs">
                      最後のコマで静止（ズームは続く）— カメラが動く素材で折り返しが目立つとき
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* 倍速の手動指定（自動=区間に合わせてリタイム） */}
              <div className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 text-neutral-400">倍速</span>
                <Select
                  value={line.videoRate === null ? "auto" : String(line.videoRate)}
                  onValueChange={(v) =>
                    updateLine(lineIndex, {
                      videoRate: v === "auto" ? null : Number(v),
                    })
                  }
                >
                  <SelectTrigger className="h-7 flex-1 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto" className="text-xs">
                      自動（区間に合わせてリタイム）
                    </SelectItem>
                    {[0.3, 0.4, 0.5, 0.65, 0.75, 0.85, 1, 1.25, 1.5, 2].map((r) => (
                      <SelectItem key={r} value={String(r)} className="text-xs">
                        {r}x{r < 0.5 ? "（コマ送り感に注意）" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* 動き出し（holdのみ）: 頭から動画スタート（既定）or 終わりから逆算 */}
              {line.videoLoop === "hold" && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 text-neutral-400">動き出し</span>
                  <Select
                    value={line.videoAnchor}
                    onValueChange={(v) =>
                      updateLine(lineIndex, {
                        videoAnchor: v === "end" ? "end" : "head",
                      })
                    }
                  >
                    <SelectTrigger className="h-7 flex-1 text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="head" className="text-xs">
                        頭から動画スタート（既定）— 足りない分は延長生成で
                      </SelectItem>
                      <SelectItem value="end" className="text-xs">
                        終わりから逆算 — 歌詞の瞬間に動きを残す（手前は静止画）
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          ) : (
            // 画像行は静止画で、上のメインプレビューと重複するため確認用の小さめ枠に留める
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={assetUrl("", projectName, line.image)}
              alt={line.image}
              className="max-h-24 w-full rounded border border-neutral-800 object-contain"
            />
          )}
        </div>

        {/* 🔍 フレーミング */}
        {framingBlock({
          read: (k) => line[k],
          write: (k, v) => updateLine(lineIndex, { [k]: v }),
          reset: () =>
            updateLine(lineIndex, { frameScale: 1, frameX: 0, frameY: 0 }),
        })}

      </div>
    );
  }

  // ---- multi（2枚以上）: アコーディオンのカード列 ----
  // 開くカード: 選択中（他行のIDが残っていたら先頭へフォールバック）。常に1枚だけ開く
  const openCut = placed.find((p) => p.cut.id === selectedId) ?? placed[0];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-400">ショット（{placed.length}カット）</span>
        <span className="flex items-center gap-1">
          {auditionButton}
          {addShotButton}
        </span>
      </div>

      {/* 🅣 行全体のテキスト（存在するときだけ表示）: 複数ショット行に残る行クレジット。
          見えない幽霊データにしない＝ここから編集・削除できる */}
      {line.credit && (
        <CreditLane
          sectionSec={sectionSec}
          snap={snapToBeat}
          segments={[
            {
              key: `line-${line.id}`,
              startSec: 0,
              durationSec: lineCreditWindowSec,
              title: "行全体のテキスト",
              credit: line.credit,
              onChange: (card) => updateLine(lineIndex, { credit: card }),
            },
          ]}
        />
      )}

      {/* 🅣 テキストトラック: ショットごとの区画（下の映像トラックと幅が揃う）。
          チップ＝クリップ: ドラッグ=移動・端=イン/アウト・クリック=編集 */}
      <CreditLane
        sectionSec={sectionSec}
        snap={snapToBeat}
        segments={placed.map((pc, i) => ({
          key: pc.cut.id,
          startSec: pc.startSec,
          durationSec: pc.durationSec,
          title: `ショット${i + 1}のテキスト`,
          credit: pc.cut.credit,
          onChange: (card) => updateCut(lineIndex, pc.cut.id, { credit: card }),
        }))}
      />

      {/* 🎚 タイムライン: サムネ＝尺比例（見た目と時間が一致）。境界をドラッグして音ハメ調整。目盛り＝ビート */}
      <ShotTimeBar
        projectName={projectName}
        placed={placed}
        sectionSec={sectionSec}
        beatMarks={beatMarksAll}
        downbeatMarks={downbeatMarksAll}
        openId={openCut?.cut.id}
        startFrame={sectionStartFrame}
        endFrame={sectionEndFrame}
        snap={snapToBeat}
        onSelect={setSelectedId}
        onSetAt={(cutId, sec) => updateCut(lineIndex, cutId, { at: sec })}
        onSeek={seekInSection}
      />

      {placed.map((pc, i) => {
        const isFirst = i === 0;
        const isOpen = openCut?.cut.id === pc.cut.id;
        const cutIsVideo = isVideoFile(pc.cut.image);
        return (
          <div
            key={pc.cut.id}
            {...dropHandlers((f) =>
              isFirst
                ? setLineImage(lineIndex, f)
                : updateCut(lineIndex, pc.cut.id, {
                    image: f,
                    trimStart: 0,
                    trimEnd: null,
                  }),
            )}
            className={cn(
              "rounded border",
              isOpen ? "border-amber-500/60" : "border-neutral-800",
            )}
          >
            {/* カード見出し: サムネ + 番号:開始秒 + ▲▼ + 🗑 + 開閉 */}
            <button
              type="button"
              onClick={() => setSelectedId(pc.cut.id)}
              className="flex w-full items-center gap-1.5 px-1.5 py-1 text-left"
            >
              {cutIsVideo ? (
                <Film className="size-3 shrink-0 text-sky-400" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={assetUrl("", projectName, pc.cut.image)}
                  alt=""
                  className="h-5 w-8 shrink-0 rounded-sm object-cover"
                />
              )}
              <span
                className={cn(
                  "font-mono text-[10px]",
                  isOpen ? "text-amber-300" : "text-neutral-400",
                )}
              >
                {i + 1}: {pc.startSec.toFixed(1)}s
              </span>
              <span className="ml-auto flex items-center gap-0.5">
                <span
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "rounded border border-neutral-700 p-0.5 text-neutral-400 hover:border-neutral-500",
                    isFirst && "pointer-events-none opacity-30",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    swapCutMedia(lineIndex, pc.cut.id, "left");
                  }}
                  title="上のショットと中身を交換（タイミングは動かない）"
                >
                  <ArrowUp className="size-3" />
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "rounded border border-neutral-700 p-0.5 text-neutral-400 hover:border-neutral-500",
                    i === placed.length - 1 && "pointer-events-none opacity-30",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    swapCutMedia(lineIndex, pc.cut.id, "right");
                  }}
                  title="下のショットと中身を交換"
                >
                  <ArrowDown className="size-3" />
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  className="rounded border border-neutral-700 p-0.5 text-neutral-400 hover:border-neutral-500"
                  onClick={(e) => {
                    e.stopPropagation();
                    splitShot(pc);
                  }}
                  title="同じ絵のまま2つに分割（テキストを順番に出す器を増やす）"
                >
                  <Scissors className="size-3" />
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  className="rounded border border-neutral-700 p-0.5 text-neutral-400 hover:border-red-700 hover:text-red-400"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeCut(lineIndex, pc.cut.id);
                  }}
                  title="このショットを削除（時間は前のショットに併合）"
                >
                  <Trash2 className="size-3" />
                </span>
                {isOpen ? (
                  <ChevronDown className="size-3.5 text-neutral-500" />
                ) : (
                  <ChevronRight className="size-3.5 text-neutral-500" />
                )}
              </span>
            </button>

            {/* 展開カード: 絵の差し替え / 開始秒 / フレーミング / 動画パラメータ */}
            {isOpen && (
              <div className="space-y-1.5 border-t border-neutral-800 p-2">
                {/* 絵の差し替え: サムネピッカー（素材帯からのD&Dでも差し替え可） */}
                <AssetPickerPopover
                  projectName={projectName}
                  images={assets.images}
                  videos={assets.videos}
                  align="start"
                  onPick={(f) =>
                    updateCut(lineIndex, pc.cut.id, {
                      image: f,
                      trimStart: 0,
                      trimEnd: null,
                    })
                  }
                  trigger={
                    <button
                      type="button"
                      className="flex h-7 w-full items-center gap-1.5 rounded border border-neutral-700 px-2 text-left text-xs hover:border-neutral-500"
                      title="絵を差し替え"
                    >
                      {cutIsVideo && <Film className="size-3 shrink-0 text-sky-400" />}
                      <span className="truncate">
                        {pc.cut.image.replace(/^(images|videos)\//, "")}
                      </span>
                      <ChevronDown className="ml-auto size-3 shrink-0 text-neutral-500" />
                    </button>
                  }
                />

                {/* 開始秒: カット1は0固定、それ以外はナッジ+ビート吸着 */}
                {isFirst ? (
                  <p className="text-[10px] text-neutral-500">開始 0.00s（先頭ショット固定）</p>
                ) : (
                  <div className="flex items-center gap-1 text-[10px] text-neutral-400">
                    <span className="w-14 shrink-0">開始</span>
                    {[-0.5, -0.05, 0.05, 0.5].map((d) => (
                      <button
                        key={d}
                        type="button"
                        className="rounded border border-neutral-700 px-1 py-0.5 font-mono hover:border-neutral-500"
                        onClick={() =>
                          updateCut(lineIndex, pc.cut.id, {
                            at: snapToBeat(
                              Math.max(
                                0.1,
                                Math.min(sectionSec - 0.1, pc.cut.at + d),
                              ),
                            ),
                          })
                        }
                      >
                        {d > 0 ? `+${d}` : d}
                      </button>
                    ))}
                    <span className="ml-auto font-mono">
                      {pc.startSec.toFixed(2)}s（{pc.durationSec.toFixed(2)}s間）
                    </span>
                  </div>
                )}

                {/* 🔍 フレーミング: カット1は行フィールドへ同期（cuts[0]と line を1操作で更新） */}
                {framingBlock({
                  read: (k) => pc.cut[k],
                  write: (k, v) =>
                    isFirst
                      ? updateLine(lineIndex, {
                          [k]: v,
                          cuts: line.cuts.map((c, idx) =>
                            idx === 0 ? { ...c, [k]: v } : c,
                          ),
                        })
                      : updateCut(lineIndex, pc.cut.id, { [k]: v }),
                  reset: () =>
                    isFirst
                      ? updateLine(lineIndex, {
                          frameScale: 1,
                          frameX: 0,
                          frameY: 0,
                          cuts: line.cuts.map((c, idx) =>
                            idx === 0
                              ? { ...c, frameScale: 1, frameX: 0, frameY: 0 }
                              : c,
                          ),
                        })
                      : updateCut(lineIndex, pc.cut.id, {
                          frameScale: 1,
                          frameX: 0,
                          frameY: 0,
                        }),
                })}

                {/* 動画カット: トリム+延ばし方 */}
                {cutIsVideo && (
                  <>
                    <VideoTrimControls
                      key={pc.cut.id + pc.cut.image}
                      videoUrl={assetUrl("", projectName, pc.cut.image)}
                      trimStart={pc.cut.trimStart}
                      trimEnd={pc.cut.trimEnd}
                      sectionSec={pc.durationSec}
                      onChange={(s, e) =>
                        updateCut(lineIndex, pc.cut.id, {
                          trimStart: s,
                          trimEnd: e,
                        })
                      }
                    />
                    <div className="flex items-center gap-2 text-[10px] text-neutral-400">
                      <span className="w-14 shrink-0">延ばし方</span>
                      <Select
                        value={pc.cut.videoLoop}
                        onValueChange={(v) =>
                          updateCut(lineIndex, pc.cut.id, {
                            videoLoop: v === "hold" ? "hold" : "pingpong",
                          })
                        }
                      >
                        <SelectTrigger className="h-6 flex-1 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pingpong">往復（静止しない）</SelectItem>
                          <SelectItem value="hold">最後のコマで静止</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      <p className="text-[10px] text-neutral-600">
        ショット間はハードカット（瞬間で切替）。重ね／切替は行全体に効きます。確認はメインプレビューの区間ループで。
      </p>
    </div>
  );
};
