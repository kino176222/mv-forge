"use client";
import { Play, TriangleAlert, Lightbulb } from "lucide-react";
import React, { useEffect, useMemo, useRef } from "react";
import { useEditor } from "@/lib/store";
import { usePlayback, seekToFrame, playerRef } from "@/lib/player-bridge";
import { deriveSections, deriveTimeline, lineTime, toFrames } from "@/lib/sections";
import { effectById } from "@/lib/effects-meta";
import { formatTime } from "@/lib/lrc";
import { cn, isVideoFile } from "@/lib/utils";
import { assetUrl } from "@/remotion/asset-url";

/**
 * 左ペイン主役: 歌詞行の一覧表。
 * - 同じ絵の行は淡い色で区間色分け（image:nullをたどらず一目でわかる）
 * - 行クリック=選択＋頭出し
 * - 再生中は現在行がハイライトされ自動スクロールで追従
 * - 素材帯から画像をD&Dで割り当て
 */

const sectionColor = (i: number) =>
  `hsla(${(i * 53 + 210) % 360}, 45%, 55%, 0.10)`;

export const LinesTable: React.FC = () => {
  const project = useEditor((s) => s.project);
  const projectName = useEditor((s) => s.projectName);
  const assets = useEditor((s) => s.assets);
  const selectedLine = useEditor((s) => s.selectedLine);
  const selectLine = useEditor((s) => s.selectLine);
  const setLineImage = useEditor((s) => s.setLineImage);
  const frame = usePlayback((s) => s.frame);
  const playing = usePlayback((s) => s.playing);
  const containerRef = useRef<HTMLDivElement>(null);

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
  const sectionByLine = useMemo(() => {
    const map = new Map<number, number>();
    sections.forEach((s) => s.lineIndexes.forEach((li) => map.set(li, s.index)));
    return map;
  }, [sections]);

  const imageHashes = useMemo(() => {
    const m = new Map<string, string>();
    assets.images.forEach((img) => m.set(img.file, img.hash));
    return m;
  }, [assets]);

  // 現在再生中の行
  const currentLineIndex = useMemo(() => {
    if (!project || !timeline) return -1;
    const songSec = frame / timeline.fps - timeline.songStart;
    let cur = -1;
    project.lines.forEach((l, i) => {
      if (lineTime(l) <= songSec) cur = i;
    });
    return cur;
  }, [project, timeline, frame]);

  // 再生中は現在行を追いかける
  useEffect(() => {
    if (!playing || currentLineIndex < 0) return;
    const el = containerRef.current?.querySelector(
      `[data-line="${currentLineIndex}"]`,
    );
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentLineIndex, playing]);

  if (!project || !timeline) return null;

  // 行クリック＝その行の頭から再生。再生中に同じ行をもう一度クリック＝そこで停止
  // （トグル＝編集ソフトの標準作法。別の行をクリックした時は常にその行の頭から再生し直す）
  const seekLine = (i: number) => {
    if (playing && selectedLine === i) {
      playerRef.current?.pause();
      return;
    }
    selectLine(i);
    seekToFrame(toFrames(timeline.songStart + lineTime(project.lines[i]), timeline.fps));
    playerRef.current?.play();
  };

  return (
    <div ref={containerRef} className="h-full overflow-y-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-neutral-900 text-xs text-neutral-400">
          <tr>
            {/* 行番号（1始まり）。AIへの歌詞ダイジェストと同じ番号＝口頭修正で「14行目」と指せる */}
            <th className="w-7 px-1 py-1.5 text-right">#</th>
            <th className="w-8 px-1 py-1.5"></th>
            <th className="w-20 px-1 py-1.5 text-left">時刻</th>
            <th className="px-2 py-1.5 text-left">歌詞</th>
            <th className="w-14 px-1 py-1.5 text-left">画像</th>
            <th className="px-1 py-1.5 text-left">エフェクト</th>
            <th className="w-20 px-1 py-1.5 text-left">歌詞アニメ</th>
            <th className="w-10 px-1 py-1.5">AI</th>
          </tr>
        </thead>
        <tbody>
          {project.lines.map((line, i) => {
            const sec = sectionByLine.get(i) ?? 0;
            const isHead = line.image !== null;
            const s = line.aiSuggestion;
            // ⚠️スタンプ: 提案時の画像とファイル名 or 指紋(ハッシュ)が違う
            const stale =
              s?.forImage &&
              (line.image !== s.forImage.file ||
                (line.image && imageHashes.get(line.image) !== s.forImage.hash));
            const effectNames = line.effects
              .map((e) => effectById(e.id)?.name ?? e.id)
              .join("・");
            return (
              <tr
                key={line.id}
                data-line={i}
                onClick={() => seekLine(i)}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes("text/mvforge-image")) {
                    e.preventDefault();
                    e.currentTarget.classList.add("outline", "outline-amber-400");
                  }
                }}
                onDragLeave={(e) =>
                  e.currentTarget.classList.remove("outline", "outline-amber-400")
                }
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove("outline", "outline-amber-400");
                  const file = e.dataTransfer.getData("text/mvforge-image");
                  if (file) setLineImage(i, file);
                }}
                className={cn(
                  "cursor-pointer border-b border-neutral-800/60 transition-colors",
                  i === selectedLine && "bg-blue-500/20",
                  i === currentLineIndex && "text-amber-200",
                )}
                style={{
                  backgroundColor:
                    i === selectedLine ? undefined : sectionColor(sec),
                }}
              >
                <td className="px-1 text-right font-mono text-[10px] text-neutral-600">
                  {i + 1}
                </td>
                <td className="px-1 text-center text-neutral-500">
                  {i === currentLineIndex ? <Play className="inline size-3 fill-current" /> : ""}
                </td>
                <td className="px-1 font-mono text-xs text-neutral-400">
                  {formatTime(line.startTime)}
                  {line.offset !== 0 && (
                    <span className="ml-0.5 text-amber-400">
                      {line.offset > 0 ? "+" : ""}
                      {line.offset.toFixed(2)}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1">
                  {line.lyricText || (
                    <span className="italic text-neutral-500">
                      {line.source === "manual" ? "（マーカー）" : "（間奏）"}
                    </span>
                  )}
                </td>
                <td className="px-1 py-0.5">
                  {isHead && line.image ? (
                    isVideoFile(line.image) ? (
                      <video
                        src={assetUrl("", projectName, line.image)}
                        muted
                        preload="metadata"
                        className="h-8 w-12 rounded object-cover"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={assetUrl("", projectName, line.image)}
                        alt=""
                        className="h-8 w-12 rounded object-cover"
                      />
                    )
                  ) : (
                    <span className="text-xs text-neutral-600">
                      {isHead ? "—" : "↑〃"}
                    </span>
                  )}
                </td>
                <td className="px-1 text-xs text-neutral-300">
                  {isHead ? effectNames || <span className="text-neutral-600">—</span> : ""}
                </td>
                <td className="px-1 text-xs text-neutral-300">
                  {line.lyricAnim
                    ? (effectById(line.lyricAnim.id)?.name ?? line.lyricAnim.id)
                    : ""}
                </td>
                <td className="px-1 text-center text-xs">
                  {stale ? (
                    <TriangleAlert className="inline size-3.5 text-amber-400" />
                  ) : s ? (
                    <Lightbulb className="inline size-3.5 text-blue-300" />
                  ) : (
                    ""
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {project.lines.length === 0 && (
        <div className="p-8 text-center text-sm text-neutral-500">
          歌詞がまだありません。右上の「セットアップ」内の「LRC自動生成」タブで
          曲から歌詞タイミングを作るか、既存の .lrc を読み込んでください。
        </div>
      )}
    </div>
  );
};
