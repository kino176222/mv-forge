"use client";
import React, { useEffect, useRef, useState } from "react";
import { useEditor } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  Bot,
  Clapperboard,
  Images,
  Loader2,
  Rocket,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { formatDurationJa } from "@/lib/utils";

/**
 * 走行中ジョブの復帰トレイ。
 * リロードしても、jobs.json に永続化されたジョブ（i2v/render/suggest/batch）を
 * ここで拾い直して進捗表示・キャンセルできる。走行中ジョブが無ければ何も描画しない。
 * 各機能パネル（RenderDialog等）のポーリングとは独立（自分が開始したジョブはそちらが担当）。
 */

type JobKind = "i2v" | "render" | "suggest" | "batch" | "repair" | "oneshot";

interface TrayJob {
  id: string;
  kind: JobKind;
  state: "running" | "done" | "error" | "cancelled" | "interrupted";
  createdAt: number;
  updatedAt: number;
  payload: {
    status?: string;
    phase?: string;
    progress?: number;
    done?: number;
    total?: number;
    file?: string | null;
    outFile?: string | null;
    sourceImage?: string;
    stepLabel?: string;
    error?: string | null;
  };
  request?: Record<string, unknown>;
}

const KIND_META: Record<JobKind, { label: string; Icon: React.ElementType }> = {
  i2v: { label: "動画化", Icon: Clapperboard },
  render: { label: "書き出し", Icon: Upload },
  suggest: { label: "AI提案", Icon: Bot },
  batch: { label: "一式生成", Icon: Images },
  repair: { label: "赤入れ", Icon: Wrench },
  oneshot: { label: "一発出し", Icon: Rocket },
};

function progressText(j: TrayJob): string {
  if (j.kind === "render" && typeof j.payload.progress === "number") {
    return `${Math.round(j.payload.progress * 100)}%`;
  }
  if (j.kind === "batch") {
    if (j.payload.phase === "ready") return "ショットリスト確認待ち";
    if (typeof j.payload.done === "number" && j.payload.total) {
      return `${j.payload.done}/${j.payload.total}枚`;
    }
    return "設計中";
  }
  if (j.kind === "oneshot") {
    const step = j.payload.stepLabel ?? "";
    if (typeof j.payload.done === "number" && j.payload.total) {
      return `${step} ${j.payload.done}/${j.payload.total}`;
    }
    return step;
  }
  return "";
}

export const JobsTray: React.FC = () => {
  const projectName = useEditor((s) => s.projectName);
  const setAssets = useEditor((s) => s.setAssets);
  const setProject = useEditor((s) => s.setProject);
  const [jobs, setJobs] = useState<TrayJob[]>([]);
  const [now, setNow] = useState(() => Date.now());
  // 完了時の副作用（素材再取得・toast）は「マウント時点で走っていたジョブ」だけに出す。
  // このセッションで開始したジョブは開始元コンポーネントが自前で完了処理するため二重になる
  const resumedIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!projectName) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const d = await fetch(
          `/api/jobs?project=${encodeURIComponent(projectName)}`,
        ).then((r) => r.json());
        if (stopped) return;
        const list: TrayJob[] = Array.isArray(d.jobs) ? d.jobs : [];
        if (resumedIds.current === null) {
          resumedIds.current = new Set(
            list.filter((j) => j.state === "running").map((j) => j.id),
          );
        }
        setJobs((prev) => {
          // 復帰対象ジョブの running→終端 遷移を検知して副作用を出す
          for (const j of list) {
            const before = prev.find((p) => p.id === j.id);
            const wasRunning = before?.state === "running";
            if (!wasRunning || j.state === "running") continue;
            if (!resumedIds.current?.has(j.id)) continue;
            if (j.state === "done") {
              if (j.kind === "i2v") {
                fetch(`/api/assets?project=${encodeURIComponent(projectName)}`)
                  .then((r) => r.json())
                  .then((assets) => {
                    if (!assets.error) setAssets(assets);
                  });
                toast.success(
                  `動画化が完了しています: ${j.payload.file ?? ""}（元画像: ${j.payload.sourceImage ?? "?"}）。素材帯から行へ割り当ててください`,
                );
              } else if (j.kind === "suggest") {
                fetch(`/api/project?name=${encodeURIComponent(projectName)}`)
                  .then((r) => r.json())
                  .then((fresh) => {
                    if (fresh.project) setProject(fresh.project);
                  });
                toast.success("AI一括提案が届いています。各行の提案欄から採用できます");
              } else if (j.kind === "oneshot") {
                fetch(`/api/project?name=${encodeURIComponent(projectName)}`)
                  .then((r) => r.json())
                  .then((fresh) => {
                    if (fresh.project) setProject(fresh.project);
                  });
                fetch(`/api/assets?project=${encodeURIComponent(projectName)}`)
                  .then((r) => r.json())
                  .then((assets) => {
                    if (!assets.error) setAssets(assets);
                  });
                toast.success("一発出しが完了しています。プレビューで完成ドラフトを確認してください");
              } else if (j.kind === "render") {
                toast.success(`書き出しが完了しています: ${j.payload.outFile?.split("/").pop() ?? ""}`);
              }
            } else if (j.state === "error") {
              toast.error(`${KIND_META[j.kind].label}が失敗しました: ${j.payload.error ?? ""}`);
            }
          }
          return list;
        });
        setNow(Date.now());
        const anyRunning = list.some((j) => j.state === "running");
        if (anyRunning && !stopped) timer = setTimeout(tick, 4000);
      } catch {
        if (!stopped) timer = setTimeout(tick, 8000);
      }
    };
    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectName]);

  const cancel = async (j: TrayJob) => {
    const d = await fetch(
      `/api/jobs?project=${encodeURIComponent(projectName)}&id=${encodeURIComponent(j.id)}`,
      { method: "DELETE" },
    ).then((r) => r.json());
    if (d.ok) {
      toast.info(
        `${KIND_META[j.kind].label}をキャンセルしました${d.message ? `（${d.message}）` : ""}`,
      );
      setJobs((prev) =>
        prev.map((p) => (p.id === j.id ? { ...p, state: "cancelled" } : p)),
      );
    } else {
      toast.error(d.message ?? d.error ?? "キャンセルに失敗しました");
    }
  };

  // 中断（interrupted）はここでは出さない。中断の事実は発行元UI
  // （ParentBatchCard / RenderDialog / AiPane / DetailPanel）が自前で表示する
  const visible = jobs.filter((j) => j.state === "running");
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-neutral-800 bg-neutral-900/60 px-3 py-1.5 text-xs">
      {visible.map((j) => {
        const { label, Icon } = KIND_META[j.kind];
        return (
          <div
            key={j.id}
            className="flex items-center gap-1.5 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-neutral-300"
          >
            <Loader2 className="size-3 animate-spin" />
            <Icon className="size-3" />
            <span>{label}</span>
            <span className="text-[10px] text-neutral-500">
              {progressText(j)} ・ {formatDurationJa((now - j.createdAt) / 1000)}経過
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-4 w-4 p-0 text-neutral-500 hover:text-neutral-200"
              title="キャンセル"
              onClick={() => cancel(j)}
            >
              <X className="size-3" />
            </Button>
          </div>
        );
      })}
    </div>
  );
};
