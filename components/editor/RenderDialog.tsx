"use client";
import React, { useMemo, useState } from "react";
import { useEditor } from "@/lib/store";
import { usePlayback } from "@/lib/player-bridge";
import {
  deriveSections,
  deriveTimeline,
  toFrames,
} from "@/lib/sections";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RENDER_PRESETS, type RenderPresetId } from "@/lib/render-presets";
import { SHORT_MAX_SEC, shortDurationSec, shortRangeIndexes } from "@/lib/shorts";
import {
  Camera,
  Clapperboard,
  FolderOpen,
  Loader2,
  Play,
  Scissors,
  Smartphone,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { formatDurationJa } from "@/lib/utils";

interface JobView {
  id: string;
  label: string;
  progress: number;
  status: string;
  outFile: string | null;
  error: string | null;
  /** ポーリング時に計算した残り時間表示（レンダー中にDate.nowを呼ばないため） */
  eta: string;
}

/** 残り時間の推定: レンダ開始からの経過 × (1-p)/p */
function computeEta(
  status: string,
  progress: number,
  renderStartedAt: number | null,
): string {
  if (status === "queued") return "順番待ち";
  if (status === "bundling") return "準備中…";
  if (!renderStartedAt || progress <= 0.02) return "残り時間を計測中…";
  const elapsed = (Date.now() - renderStartedAt) / 1000;
  return `残り約${formatDurationJa((elapsed * (1 - progress)) / progress)}`;
}

const KNOWN_STATUSES = [
  "queued",
  "bundling",
  "rendering",
  "done",
  "error",
  "cancelled",
  "interrupted",
];

/**
 * 書き出し。全体／選択区間だけ／ドラフト画質（試し刷り）＋現在フレームのサムネ書き出し。
 * 試行回数が量産ツールの生命線なので、区間書き出しを一等地に置く。
 */
export const RenderDialog: React.FC = () => {
  const project = useEditor((s) => s.project);
  const projectName = useEditor((s) => s.projectName);
  const selected = useEditor((s) => s.selectedLine);
  const currentFrame = usePlayback((s) => s.frame);
  const [draft, setDraft] = useState(false);
  const [preset, setPreset] = useState<RenderPresetId>("youtube");
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [stillBusy, setStillBusy] = useState(false);

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
  const selectedSection = sections.find((s) => s.lineIndexes.includes(selected));

  const startRender = async (
    frameRange: [number, number] | null,
    label: string,
    opts: { shortId?: string; presetOverride?: RenderPresetId } = {},
  ) => {
    // ショートは常に縦型プリセット（ダイアログの選択に依らない）
    const usePreset = opts.presetOverride ?? preset;
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: projectName,
          frameRange,
          draft,
          label,
          preset: usePreset,
          shortId: opts.shortId ?? null,
        }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      const job: JobView = {
        id: d.id,
        label: `${label}${usePreset !== "youtube" ? `・${RENDER_PRESETS[usePreset].label}` : ""}${draft ? "（ドラフト）" : ""}`,
        progress: 0,
        status: "queued",
        outFile: null,
        error: null,
        eta: "順番待ち",
      };
      setJobs((js) => [job, ...js]);
      poll(d.id);
      toast.info("書き出しを開始しました（初回はバンドル作成で少し待ちます）");
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    }
  };

  const poll = (id: string) => {
    let misses = 0;
    const timer = setInterval(async () => {
      let d: Partial<JobView> & { error?: string | null };
      try {
        d = await fetch(
          `/api/render?id=${id}&project=${encodeURIComponent(projectName)}`,
        ).then((r) => r.json());
      } catch {
        d = {};
      }
      // ジョブ消失（devサーバー再起動等）で進捗バーが固まったままにしない
      if (!d.status || !KNOWN_STATUSES.includes(d.status)) {
        misses += 1;
        if (misses >= 3) {
          clearInterval(timer);
          setJobs((js) =>
            js.map((j) =>
              j.id === id
                ? { ...j, status: "error", error: "ジョブが見つかりません（サーバー再起動の可能性）" }
                : j,
            ),
          );
        }
        return;
      }
      misses = 0;
      setJobs((js) =>
        js.map((j) =>
          j.id === id
            ? {
                ...j,
                progress: d.progress ?? 0,
                status: d.status!,
                outFile: d.outFile ?? null,
                error: d.error ?? null,
                eta: computeEta(
                  d.status!,
                  d.progress ?? 0,
                  (d as { renderStartedAt?: number | null }).renderStartedAt ?? null,
                ),
              }
            : j,
        ),
      );
      if (d.status === "done") {
        clearInterval(timer);
        toast.success(`書き出し完了: ${d.outFile?.split("/").pop()}`);
      }
      if (d.status === "error") {
        clearInterval(timer);
        toast.error("書き出しに失敗しました（ダイアログ内にエラー表示）");
      }
      if (d.status === "cancelled" || d.status === "interrupted") {
        clearInterval(timer);
        toast.info(d.status === "cancelled" ? "書き出しをキャンセルしました" : "書き出しが中断されました");
      }
    }, 2000);
  };

  const reveal = async (file: string, mode: "open" | "reveal") => {
    const d = await fetch("/api/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: projectName, file, mode }),
    }).then((r) => r.json());
    if (d.error) toast.error(d.error);
  };

  const exportStill = async () => {
    setStillBusy(true);
    try {
      const d = await fetch("/api/still", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectName, frame: currentFrame }),
      }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      toast.success(`サムネイルを書き出しました: ${d.file.split("/").pop()}`, {
        action: { label: "Finderで表示", onClick: () => reveal(d.file, "reveal") },
      });
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setStillBusy(false);
    }
  };

  if (!project || !timeline) return null;
  const fps = project.meta.fps;
  const presetDef = RENDER_PRESETS[preset];
  const outWidth = presetDef.width ?? project.meta.width;
  const outHeight = presetDef.height ?? project.meta.height;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" className="h-7 text-xs">
          <Upload className="size-3.5" /> 書き出し
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            mp4書き出し（{outWidth}×{outHeight} / {fps}fps）
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-neutral-400">プリセット</span>
            <Select value={preset} onValueChange={(v) => setPreset(v as RenderPresetId)}>
              <SelectTrigger className="h-8 flex-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(RENDER_PRESETS).map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-[11px] text-neutral-500">{presetDef.description}</p>
          <div className="flex items-center gap-2">
            <Switch id="draft" checked={draft} onCheckedChange={setDraft} />
            <Label htmlFor="draft" className="text-xs">
              ドラフト画質（解像度1/2の試し刷り。確認はこれで十分）
            </Label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => startRender(null, "full")}>
              <Clapperboard className="size-3.5" /> 全体を書き出し
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!selectedSection}
              onClick={() => {
                if (!selectedSection) return;
                const from = toFrames(
                  timeline.songStart + selectedSection.start,
                  fps,
                );
                const to = toFrames(timeline.songStart + selectedSection.end, fps) - 1;
                startRender([from, Math.max(from + 1, to)], `section${selectedSection.index + 1}`);
              }}
            >
              <Scissors className="size-3.5" /> 選択区間だけ
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={stillBusy}
              title="プレビューの現在フレームを、テロップ・エフェクト込みの高解像度PNGで保存（YouTubeサムネ用）"
              onClick={exportStill}
            >
              {stillBusy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Camera className="size-3.5" />
              )}
              このフレームを画像で
            </Button>
          </div>
          {/* ショート書き出し（縦型9:16固定。定義はショートタブで） */}
          {project.shorts.length > 0 && (
            <div className="space-y-1.5 rounded border border-neutral-800 p-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-neutral-300">
                  ショート（縦型9:16）
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-6 text-[10px]"
                  title="全ショートを順番に書き出します（1件ずつ直列実行）"
                  onClick={() => {
                    for (const s of project.shorts) {
                      if (shortRangeIndexes(project, s) === null) continue;
                      void startRender(null, s.name, {
                        shortId: s.id,
                        presetOverride: "vertical",
                      });
                    }
                  }}
                >
                  <Smartphone className="size-3" /> 全ショート一括
                </Button>
              </div>
              {project.shorts.map((s) => {
                const d = shortDurationSec(project, s);
                const broken = shortRangeIndexes(project, s) === null;
                return (
                  <div key={s.id} className="flex items-center gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    {broken ? (
                      <span className="text-[10px] text-red-400">範囲切れ</span>
                    ) : (
                      <span
                        className={`font-mono text-[10px] ${d !== null && d > SHORT_MAX_SEC ? "text-amber-400" : "text-neutral-500"}`}
                      >
                        {d}s{d !== null && d > SHORT_MAX_SEC ? "（60s超）" : ""}
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px]"
                      disabled={broken}
                      onClick={() =>
                        startRender(null, s.name, {
                          shortId: s.id,
                          presetOverride: "vertical",
                        })
                      }
                    >
                      <Smartphone className="size-3" /> 書き出し
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="max-h-52 space-y-1.5 overflow-y-auto">
            {jobs.map((j) => (
              <div key={j.id} className="rounded border border-neutral-800 p-2 text-xs">
                <div className="flex justify-between">
                  <span>{j.label}</span>
                  <span className="text-neutral-400">
                    {j.status === "done"
                      ? "完了"
                      : j.status === "error"
                        ? "失敗"
                        : j.status === "cancelled"
                          ? "キャンセル済み"
                          : j.status === "interrupted"
                            ? "中断"
                            : `${Math.round(j.progress * 100)}% ・ ${j.eta}`}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-neutral-800">
                  <div
                    className={`h-full transition-all ${j.status === "error" ? "bg-red-500" : "bg-blue-500"}`}
                    style={{ width: `${Math.round(j.progress * 100)}%` }}
                  />
                </div>
                {j.outFile && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px]"
                      onClick={() => reveal(j.outFile!, "open")}
                    >
                      <Play className="size-3" /> 開く
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px]"
                      onClick={() => reveal(j.outFile!, "reveal")}
                    >
                      <FolderOpen className="size-3" /> Finderで表示
                    </Button>
                    <span className="min-w-0 truncate font-mono text-[10px] text-neutral-500">
                      {j.outFile.split("/").pop()}
                    </span>
                  </div>
                )}
                {j.error && (
                  <div className="mt-1 break-all font-mono text-[10px] text-red-400">
                    {j.error.slice(0, 400)}
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-neutral-500">
            出力先: プロジェクトフォルダの exports/ 。プレビューと同じ設計図を
            そのまま焼くので、見たままが出ます。書き出しは1件ずつ順番に実行されます。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
