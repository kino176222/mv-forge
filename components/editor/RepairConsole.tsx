"use client";
import { readXpFavorites } from "@/lib/xp/favorites";
import React, { useState } from "react";
import { useEditor } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Check, Clapperboard, Loader2, Palette, Wrench, Zap } from "lucide-react";
import { applyPatchesToLines, type RepairPatch } from "@/lib/repair";
import { I2V_MODELS } from "@/lib/ai-models";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * 口頭修正コンソール（赤入れ）: 自由文→AIが修正案リスト→選んで適用。
 * - 適用（無料）はチェックボックス経由で1回の⌘Zで丸ごと戻せる
 * - 課金系（needs-generation / needs-i2v）は明示ボタンのみで発火（並列OK）
 * AiPane から独立させた自己完結コンポーネント（親からは model だけ受け取る）。
 */
export const RepairConsole: React.FC<{ model: string }> = ({ model }) => {
  const project = useEditor((s) => s.project);
  const projectName = useEditor((s) => s.projectName);
  const setProject = useEditor((s) => s.setProject);
  const mutate = useEditor((s) => s.mutate);

  const [repairText, setRepairText] = useState("");
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairResult, setRepairResult] = useState<null | {
    patches: RepairPatch[];
    dropped: { summary: string; reason: string }[];
  }>(null);
  const [repairChecks, setRepairChecks] = useState<Set<number>>(new Set());
  // 生成中のパッチindex集合（複数同時に走らせられる）と、完了済みindex→生成ファイル名
  const [repairGenBusy, setRepairGenBusy] = useState<Set<number>>(new Set());
  const [repairGenDone, setRepairGenDone] = useState<Map<number, string>>(new Map());

  /** 口頭修正: 自由文→AIが修正案リスト（適用はしない。関所は下のチェックボックス） */
  const runRepair = async () => {
    if (!repairText.trim()) return;
    setRepairBusy(true);
    setRepairResult(null);
    try {
      const favorites: string[] = readXpFavorites();
      const start = await fetch("/api/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectName, instruction: repairText, model, favorites }),
      }).then((r) => r.json());
      if (start.error) throw new Error(start.error);
      for (;;) {
        await new Promise((r) => setTimeout(r, 4000));
        const job = await fetch(
          `/api/repair?id=${start.id}&project=${encodeURIComponent(projectName)}`,
        ).then((r) => r.json());
        if (job.phase === "done") {
          setRepairResult({ patches: job.patches ?? [], dropped: job.dropped ?? [] });
          setRepairGenDone(new Map()); // 前のリストの完了状態を持ち越さない
          // 既定で「適用できるもの」に全チェック（needs-generation / needs-i2v は課金ボタン経由）
          setRepairChecks(
            new Set(
              (job.patches ?? [])
                .map((p: RepairPatch, i: number) =>
                  p.kind === "needs-generation" || p.kind === "needs-i2v" ? -1 : i,
                )
                .filter((i: number) => i >= 0),
            ),
          );
          break;
        }
        if (job.phase === "error") throw new Error(job.error);
        if (job.phase === "cancelled") {
          toast.info("修正案の設計をキャンセルしました");
          return;
        }
      }
    } catch (e) {
      toast.error(`修正案の設計に失敗: ${e instanceof Error ? e.message : e}`);
    } finally {
      setRepairBusy(false);
    }
  };

  /** needs-generation の実行: 生成→差し替えまでサーバーで完結（課金はこのクリックのみ）。
   * 複数ボタンを続けて押せば並列に走る（サーバー側で保存だけ直列化して競合を防ぐ）。 */
  const generateAndSwap = async (index: number, lineNo: number, prompt: string) => {
    setRepairGenBusy((prev) => new Set(prev).add(index));
    try {
      const d = await fetch("/api/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectName, mode: "generate", lineNo, prompt }),
      }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setProject(d.project);
      // 素材帯にも反映
      const assets = await fetch(
        `/api/assets?project=${encodeURIComponent(projectName)}`,
      ).then((r) => r.json());
      if (!assets.error) useEditor.getState().setAssets(assets);
      // 項目は消さずに「✓差し替え済み」表示へ（indexを安定させ並列実行と齟齬を起こさない）
      setRepairGenDone((prev) => new Map(prev).set(index, String(d.file)));
      toast.success(`${lineNo}行目に生成画像を差し替えました（${d.file}）`);
    } catch (e) {
      toast.error(`生成に失敗: ${e instanceof Error ? e.message : e}`);
    } finally {
      setRepairGenBusy((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }
  };

  /** needs-i2v の実行: 既存のi2vパイプライン（/api/generate-video＝ジョブ永続化・キャンセル対応）で
   * 動画化→行へ割当。課金は明示クリックのみ。複数同時OK。 */
  const i2vAndSwap = async (
    index: number,
    p: Extract<RepairPatch, { kind: "needs-i2v" }>,
  ) => {
    setRepairGenBusy((prev) => new Set(prev).add(index));
    try {
      const modelId =
        I2V_MODELS.find((m) => m.id.includes(p.model))?.id ?? I2V_MODELS[0].id;
      const lineId = project?.lines[p.lineNo - 1]?.id;
      const start = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: projectName,
          image: p.sourceImage,
          prompt: p.motionPrompt,
          model: modelId,
          duration: p.duration,
          lineId,
        }),
      }).then((r) => r.json());
      if (start.error) throw new Error(start.error);
      // DetailPanelのpollJobと同じ流儀（ジョブ消失で無限ループしないガード付き）
      let misses = 0;
      for (;;) {
        await new Promise((r) => setTimeout(r, 5000));
        let job: { status?: string; file?: string; error?: string };
        try {
          job = await fetch(
            `/api/generate-video?id=${start.id}&project=${encodeURIComponent(projectName)}`,
          ).then((r) => r.json());
        } catch {
          job = {};
        }
        if (job.status === "cancelled" || job.status === "interrupted") {
          toast.info(
            job.status === "cancelled"
              ? `${p.lineNo}行目の動画化をキャンセルしました`
              : `${p.lineNo}行目の動画化が中断されました（ジョブ一覧から確認できます）`,
          );
          return;
        }
        if (job.status === "done") {
          const assets = await fetch(
            `/api/assets?project=${encodeURIComponent(projectName)}`,
          ).then((r) => r.json());
          if (!assets.error) useEditor.getState().setAssets(assets);
          // 動画を行に割当（生成元の静止画は作り直し用に保持）
          useEditor
            .getState()
            .updateLine(p.lineNo - 1, { image: job.file ?? null, i2vSource: p.sourceImage });
          setRepairGenDone((prev) => new Map(prev).set(index, String(job.file ?? "")));
          toast.success(`${p.lineNo}行目を動画化しました（${job.file}）`);
          return;
        }
        if (job.status === "error") throw new Error(job.error);
        if (!job.status || !["queued", "generating"].includes(job.status)) {
          misses += 1;
          if (misses >= 3) {
            throw new Error(
              "ジョブが見つかりません（サーバー再起動の可能性）。完成していれば videos/ に落ちているので素材帯を再読込してください",
            );
          }
        } else {
          misses = 0;
        }
      }
    } catch (e) {
      toast.error(`${p.lineNo}行目の動画化に失敗: ${e instanceof Error ? e.message : e}`);
    } finally {
      setRepairGenBusy((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }
  };

  /** 選ばれた修正案を適用（store.mutate＝1回の⌘Zで丸ごと戻せる） */
  const applyRepair = () => {
    if (!repairResult || !project) return;
    const selected = repairResult.patches.filter((_, i) => repairChecks.has(i));
    if (selected.length === 0) return;
    const result = applyPatchesToLines(project.lines, selected);
    mutate((p) => {
      p.lines = result.lines;
    });
    toast.success(
      `${result.applied}件を適用しました${
        result.skipped.length ? `（${result.skipped.length}件は生成が必要なため未適用）` : ""
      }。⌘Zで丸ごと戻せます`,
    );
    setRepairResult(null);
    setRepairGenDone(new Map());
    setRepairText("");
  };

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900/40 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-neutral-400">
        <Wrench className="size-3.5" /> 口頭修正（赤入れ）
      </div>
      <div className="space-y-1">
        <span className="block text-[10px] text-neutral-500">
          気になる所をバーッと書く（行番号は行テーブルの#と同じ）
        </span>
        <Textarea
          placeholder="例: 14行目の絵は暗すぎるので別のに。サビのテロップはもっと静かに。9行目のつなぎはカットでいい"
          className="min-h-14 text-xs"
          value={repairText}
          onChange={(e) => setRepairText(e.target.value)}
          disabled={repairBusy}
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        className="mt-1.5 h-6 w-full text-xs"
        disabled={
          repairBusy || repairGenBusy.size > 0 || !repairText.trim() || !project?.lines.length
        }
        onClick={runRepair}
      >
        {repairBusy ? <Loader2 className="size-3 animate-spin" /> : <Wrench className="size-3" />}
        {repairBusy
          ? "修正案を考え中…（1〜3分）"
          : repairGenBusy.size > 0
            ? `生成の完了待ち（${repairGenBusy.size}件走行中）`
            : "修正案を作る（まだ変更しない）"}
      </Button>

      {repairResult && (
        <div className="mt-2 space-y-1.5 text-xs">
          {repairResult.patches.length === 0 && (
            <p className="text-neutral-500">適用できる修正案がありませんでした。指示を具体的にしてみてください。</p>
          )}
          {repairResult.patches.map((p, i) => {
            const needsGen = p.kind === "needs-generation";
            const needsI2v = p.kind === "needs-i2v";
            const needsRun = needsGen || needsI2v; // 課金系（チェック適用の対象外）
            const genDoneFile = repairGenDone.get(i);
            const genBusy = repairGenBusy.has(i);
            return (
              <label
                key={i}
                className={cn(
                  "flex items-start gap-1.5 rounded border p-1.5",
                  needsRun
                    ? genDoneFile
                      ? "border-emerald-900/60 bg-emerald-950/20"
                      : "border-amber-900/60 bg-amber-950/20"
                    : "border-neutral-800 bg-neutral-900",
                )}
              >
                <input
                  type="checkbox"
                  className={cn("mt-0.5", genDoneFile ? "accent-emerald-500" : "accent-amber-400")}
                  disabled={needsRun}
                  checked={repairChecks.has(i) || !!genDoneFile}
                  onChange={(e) =>
                    setRepairChecks((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(i);
                      else next.delete(i);
                      return next;
                    })
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-neutral-200">{p.summary}</span>
                  {p.reason && <span className="block text-[10px] text-neutral-500">{p.reason}</span>}
                  {needsRun && genDoneFile && (
                    <span className="block text-[10px] text-emerald-400">
                      ✓ {p.lineNo}行目に{needsI2v ? "動画を" : ""}差し替え済み（{genDoneFile}）
                    </span>
                  )}
                  {needsGen && !genDoneFile && (
                    <span className="block text-[10px] text-amber-400">
                      生成が必要（チェック適用の対象外。下のボタンで生成→差し替え。複数同時に走らせてOK）
                    </span>
                  )}
                  {needsI2v && !genDoneFile && (
                    <span className="block text-[10px] text-amber-400">
                      動画生成が必要（チェック適用の対象外。下のボタンで動画化→差し替え。複数同時OK）
                    </span>
                  )}
                  {needsGen && !genDoneFile && p.kind === "needs-generation" && p.lineNo && p.prompt && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-1 h-6 w-full text-[10px]"
                      disabled={genBusy}
                      onClick={(e) => {
                        e.preventDefault();
                        generateAndSwap(i, p.lineNo!, p.prompt!);
                      }}
                    >
                      {genBusy ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Palette className="size-3" />
                      )}
                      {genBusy
                        ? "生成中…（2〜4分）"
                        : `生成して${p.lineNo}行目に差し替え（1枚 十数円）`}
                    </Button>
                  )}
                  {!genDoneFile && p.kind === "needs-i2v" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-1 h-6 w-full text-[10px]"
                      disabled={genBusy}
                      onClick={(e) => {
                        e.preventDefault();
                        i2vAndSwap(i, p);
                      }}
                    >
                      {genBusy ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Clapperboard className="size-3" />
                      )}
                      {genBusy
                        ? "動画生成中…（1〜5分）"
                        : `動画化して${p.lineNo}行目に差し替え（${p.duration}秒 数十円）`}
                    </Button>
                  )}
                </span>
              </label>
            );
          })}
          {repairResult.dropped.length > 0 && (
            <p className="text-[10px] text-neutral-600">
              {repairResult.dropped.length}件はAIの勘違い（存在しない行/素材/演出）のため除外:
              {repairResult.dropped.map((d) => ` ${d.summary}`).join(" /")}
            </p>
          )}
          {(() => {
            // 課金系（生成/動画化）の未実行分を1クリックで全部並列発火
            const pending = repairResult.patches
              .map((p, i) => ({ p, i }))
              .filter(
                ({ p, i }) =>
                  !repairGenDone.has(i) &&
                  !repairGenBusy.has(i) &&
                  ((p.kind === "needs-generation" && !!p.lineNo && !!p.prompt) ||
                    p.kind === "needs-i2v"),
              );
            if (pending.length < 2) return null;
            const nImg = pending.filter(({ p }) => p.kind === "needs-generation").length;
            const nVid = pending.length - nImg;
            const label = [
              nImg > 0 ? `画像${nImg}枚` : "",
              nVid > 0 ? `動画${nVid}本` : "",
            ]
              .filter(Boolean)
              .join("＋");
            return (
              <Button
                size="sm"
                variant="outline"
                className="h-6 w-full text-xs border-amber-900/60 text-amber-300"
                onClick={() =>
                  pending.forEach(({ p, i }) => {
                    if (p.kind === "needs-generation") generateAndSwap(i, p.lineNo!, p.prompt!);
                    else if (p.kind === "needs-i2v") i2vAndSwap(i, p);
                  })
                }
              >
                <Zap className="size-3" />
                生成系をまとめて実行（{label}・並列）
              </Button>
            );
          })()}
          {repairResult.patches.some(
            (p) => p.kind !== "needs-generation" && p.kind !== "needs-i2v",
          ) && (
            <Button size="sm" className="h-6 w-full text-xs" onClick={applyRepair} disabled={repairChecks.size === 0}>
              <Check className="size-3" />
              選んだ{repairChecks.size}件を適用（⌘Zで戻せる）
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-5 w-full text-[10px] text-neutral-500"
            onClick={() => {
              setRepairResult(null);
              setRepairGenDone(new Map());
            }}
          >
            閉じる
          </Button>
        </div>
      )}
    </div>
  );
};
