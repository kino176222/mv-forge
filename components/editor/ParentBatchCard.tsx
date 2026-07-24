"use client";
import React, { useEffect, useRef, useState } from "react";
import { useEditor } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Clapperboard, Palette, RotateCcw, Check, X, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn, formatDurationJa } from "@/lib/utils";
import { assetUrl } from "@/remotion/asset-url";
import type { Shot } from "@/lib/server/batch-gen-server";
import { coverageOf, DEFAULT_GEN_CONCURRENCY, shotFileRel } from "@/lib/batch-plan";

interface JobView {
  id: string;
  phase: string;
  shots: Shot[];
  done: number;
  total: number;
  generated: string[];
  failed: { filename: string; log: string }[];
  error: string | null;
  genStartedAt: number | null;
  /** ポーリング時に計算した残り時間表示（レンダー中にDate.nowを呼ばないため） */
  eta?: string;
}

/** 残り時間の推定: これまでの1枚あたり平均 × 残り枚数 */
function computeEta(j: JobView): string {
  if (!j.genStartedAt || j.done === 0) return "残り時間を計測中…";
  const avg = (Date.now() - j.genStartedAt) / j.done;
  return `残り約${formatDurationJa(((j.total - j.done) * avg) / 1000)}`;
}

const KNOWN_PHASES = [
  "planning",
  "ready",
  "generating",
  "done",
  "error",
  "cancelled",
  "interrupted",
];
const TERMINAL_PHASES = ["ready", "done", "error", "cancelled", "interrupted"];

/**
 * 親画像から一式生成（親画像理論）。
 * parent.png を基準に、参謀がショットリストを設計 → 確認 → I2Iで一括生成
 * → レビュー（採用/不採用）で選別。不採用は rejected/ へ退避（復元可能）。
 */
export const ParentBatchCard: React.FC<{ model: string }> = ({ model }) => {
  const projectName = useEditor((s) => s.projectName);
  const assets = useEditor((s) => s.assets);
  const projectLines = useEditor((s) => s.project?.lines);
  // 不足の単一の真実（lib/batch-plan）: 適用のたびにここが減っていくのがループの進捗
  const coverage = coverageOf(projectLines ?? []);
  const [job, setJob] = useState<JobView | null>(null);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0); // 0 = おまかせ（8〜14枚）
  const [rejects, setRejects] = useState<Set<string>>(new Set());
  // 拡大採点ライトボックス（job.generated のインデックス。null=閉）
  const [zoom, setZoom] = useState<number | null>(null);
  const [parentDragging, setParentDragging] = useState(false);
  const [parentVer, setParentVer] = useState(0); // 差し替え後にサムネを更新
  const parentInputRef = useRef<HTMLInputElement>(null);

  // 親画像はプロジェクト直下の parent.<ext>（素材一覧のルート走査に載る）
  const parentFile = assets.images.find((i) => /^parent\.(png|jpe?g|webp)$/i.test(i.file))?.file;

  // ジョブ進行中は親画像の差し替えを封印（バッチ途中で画風の基準が変わるのを防ぐ）。表示は常時。
  const parentLocked =
    !!job && ["planning", "ready", "generating"].includes(job.phase);

  const uploadParent = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("project", projectName);
      form.append("file", file);
      form.append("as", "parent");
      const d = await fetch("/api/assets/upload", { method: "POST", body: form }).then((r) =>
        r.json(),
      );
      if (d.error) throw new Error(d.error);
      toast.success(
        d.retired?.length
          ? `親画像を差し替えました（前の親画像は ${d.retired.join(", ")} として素材に残っています）`
          : `親画像を設定しました（${d.file}）`,
      );
      setParentVer((v) => v + 1);
      await refreshAssets();
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const refreshAssets = async () => {
    const assets = await fetch(
      `/api/assets?project=${encodeURIComponent(projectName)}`,
    ).then((r) => r.json());
    if (!assets.error) useEditor.getState().setAssets(assets);
  };

  /** 画面内D&D: 素材帯の既存画像を親画像に昇格（アップロード不要・元素材は残る） */
  const promoteAssetToParent = async (rel: string) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("project", projectName);
      form.append("as", "parent");
      form.append("fromFile", rel);
      const d = await fetch("/api/assets/upload", { method: "POST", body: form }).then((r) =>
        r.json(),
      );
      if (d.error) throw new Error(d.error);
      toast.success(
        d.retired?.length
          ? `親画像を差し替えました（前の親画像は ${d.retired.join(", ")} として素材に残っています）`
          : `親画像を設定しました（${d.file}）`,
      );
      setParentVer((v) => v + 1);
      await refreshAssets();
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  // リロード後の復帰: jobs.json から直近の一式生成ジョブを拾って表示を再構築する
  const rehydrated = useRef(false);
  useEffect(() => {
    if (rehydrated.current || !projectName) return;
    rehydrated.current = true;
    (async () => {
      try {
        const d = await fetch(
          `/api/jobs?project=${encodeURIComponent(projectName)}`,
        ).then((r) => r.json());
        if (!Array.isArray(d.jobs)) return;
        const latest = (d.jobs as { kind: string; state: string; payload: JobView }[])
          .filter((j) => j.kind === "batch")
          .find((j) => j.state === "running");
        if (!latest?.payload?.id) return;
        setJob({ ...latest.payload, eta: computeEta(latest.payload) });
        if (["planning", "generating"].includes(latest.payload.phase)) {
          setBusy(true);
          try {
            const done = await poll(latest.payload.id);
            if (done.phase === "done" || done.phase === "generating") await refreshAssets();
          } finally {
            setBusy(false);
          }
        }
      } catch {
        /* 復帰は best-effort。失敗しても通常フローに影響しない */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectName]);

  const poll = async (id: string): Promise<JobView> => {
    let misses = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, 4000));
      let d: JobView & { error?: string };
      try {
        d = await fetch(
          `/api/batch-generate?id=${id}&project=${encodeURIComponent(projectName)}`,
        ).then((r) => r.json());
      } catch {
        d = { error: "network" } as JobView & { error: string };
      }
      // ジョブ消失（devサーバー再起動等）や未知の応答で無限ループしない
      if (!d || !KNOWN_PHASES.includes(d.phase)) {
        misses += 1;
        if (misses >= 3) {
          throw new Error(
            "ジョブが見つかりません（サーバー再起動の可能性）。生成済みの画像は素材帯の再読込で確認できます",
          );
        }
        continue;
      }
      misses = 0;
      setJob({ ...d, eta: computeEta(d) });
      if (TERMINAL_PHASES.includes(d.phase)) return d;
    }
  };

  const plan = async () => {
    setBusy(true);
    try {
      const start = await fetch("/api/batch-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectName, mode: "plan", model, count }),
      }).then((r) => r.json());
      if (start.error) throw new Error(start.error);
      setJob({
        id: start.id,
        phase: "planning",
        shots: [],
        done: 0,
        total: 0,
        generated: [],
        failed: [],
        error: null,
        genStartedAt: null,
      });
      const d = await poll(start.id);
      if (d.phase === "error") toast.error(d.error ?? "計画に失敗しました");
      else if (d.phase === "cancelled" || d.phase === "interrupted")
        toast.info("ショットリスト設計を中断しました");
      else toast.success(`ショットリスト ${d.shots.length}枚分が届きました。内容を確認して生成へ`);
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
      setJob(null);
    } finally {
      setBusy(false);
    }
  };

  const run = async (mode: "run" | "retry") => {
    if (!job) return;
    setBusy(true);
    try {
      const res = await fetch("/api/batch-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectName, mode, jobId: job.id }),
      }).then((r) => r.json());
      if (res.error) throw new Error(res.error);
      const d = await poll(job.id);
      // 素材帯を更新（レビュー中もプレビューで確認できるように）
      await refreshAssets();
      if (d.phase === "done") {
        setRejects(new Set());
        const failedNote =
          d.failed.length > 0 ? `（${d.failed.length}枚失敗 → 下から再生成できます）` : "";
        toast.success(
          `${d.generated.length}枚を生成しました${failedNote}。下でレビューして採用を確定してください`,
        );
      } else if (d.phase === "cancelled" || d.phase === "interrupted") {
        toast.info(
          `生成を${d.phase === "cancelled" ? "キャンセル" : "中断"}しました（生成済み${d.generated.length}枚は素材帯に残っています）`,
        );
      } else {
        toast.error(d.error ?? "生成に失敗しました");
      }
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * レビュー確定: 採用を pending/ → images/ へ昇格（ここで初めて素材帯に出る）、
   * 不採用は rejected/ へ退避。applyAfter=そのまま行へ適用まで1リクエストで行う
   */
  const confirmReview = async (applyAfter: boolean) => {
    if (!job) return;
    setBusy(true);
    try {
      const d = await fetch("/api/batch-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: projectName,
          mode: "confirm",
          jobId: job.id,
          files: [...rejects],
          apply: applyAfter,
        }),
      }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      await refreshAssets(); // 採用分がここで素材帯に現れる
      let applyNote = "";
      if (applyAfter && d.project) {
        useEditor.getState().setProject(d.project);
        applyNote = `。行へ適用: 画像${d.applied}枚・カット${d.cutsCreated}個${
          d.skipped?.length ? `・スキップ${d.skipped.length}件（手作業のある行は触りません）` : ""
        }`;
      }
      toast.success(
        (d.rejected > 0
          ? `${d.adopted}枚を採用して素材帯へ。不採用${d.rejected}枚は rejected/ に退避しました（復元可能）`
          : `${d.adopted}枚を全部採用して素材帯へ入れました`) + applyNote,
      );
      setJob(null);
      setRejects(new Set());
      setZoom(null);
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const toggleReject = (file: string) => {
    setRejects((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  /** 生成ファイル名（basename）→ ショットのpurpose（ライトボックスの説明表示用） */
  const purposeOf = (file: string): string => {
    const base = file.split("/").pop();
    return job?.shots.find((s) => shotFileRel(s).split("/").pop() === base)?.purpose ?? "";
  };

  // ライトボックスのキーボード採点: ←→=移動 / X=不採用にして次へ / Enter=採用のまま次へ / Esc=閉じる
  useEffect(() => {
    if (zoom === null || !job) return;
    const last = job.generated.length - 1;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoom(null);
      else if (e.key === "ArrowRight") setZoom((z) => Math.min((z ?? 0) + 1, last));
      else if (e.key === "ArrowLeft") setZoom((z) => Math.max((z ?? 0) - 1, 0));
      else if (e.key.toLowerCase() === "x") {
        const file = job.generated[zoom];
        if (file) toggleReject(file);
        if (zoom < last) setZoom(zoom + 1);
      } else if (e.key === "Enter") {
        const file = job.generated[zoom];
        if (file && rejects.has(file)) toggleReject(file); // 採用に戻す
        if (zoom < last) setZoom(zoom + 1);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom, job, rejects]);

  /** レビュー用サムネグリッド（生成中も届いた分から採点できる）。クリック=拡大、角の×=即不採用 */
  const reviewGrid =
    job && job.generated.length > 0 ? (
      <div className="mb-1.5 grid max-h-56 grid-cols-3 gap-1 overflow-y-auto">
        {job.generated.map((file, idx) => {
          const rejected = rejects.has(file);
          return (
            <div
              key={file}
              className={cn(
                "group relative overflow-hidden rounded border",
                rejected
                  ? "border-red-800 opacity-40"
                  : "border-neutral-700 hover:border-amber-400",
              )}
            >
              <button
                onClick={() => setZoom(idx)}
                className="block w-full"
                title={`${file}（クリックで拡大採点）`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={assetUrl("", projectName, file)}
                  alt={file}
                  className="aspect-video w-full object-cover"
                />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleReject(file);
                }}
                title={rejected ? "採用に戻す" : "不採用にする"}
                className={cn(
                  "absolute right-0.5 top-0.5 rounded bg-black/60 p-0.5",
                  rejected ? "text-red-400" : "text-neutral-300 opacity-0 group-hover:opacity-100",
                )}
              >
                <X className="size-3.5" />
              </button>
              {rejected && (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-red-400">
                  <X className="size-6" />
                </span>
              )}
            </div>
          );
        })}
      </div>
    ) : null;

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900/40 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-neutral-400">
        <Clapperboard className="size-3.5" /> 親画像から一式生成
      </div>

      {/* 親画像は常時表示（ジョブ進行中は差し替えのみ不可） */}
      <div
        role="button"
        tabIndex={parentLocked ? -1 : 0}
        onClick={() => !parentLocked && parentInputRef.current?.click()}
        onKeyDown={(e) =>
          !parentLocked && e.key === "Enter" && parentInputRef.current?.click()
        }
        onDragOver={(e) => {
          if (parentLocked) return;
          e.preventDefault();
          setParentDragging(true);
        }}
        onDragLeave={() => setParentDragging(false)}
        onDrop={(e) => {
          if (parentLocked) return;
          e.preventDefault();
          setParentDragging(false);
          // 画面内D&D（素材帯からのドラッグ）: ファイルではなく参照が来るので昇格APIへ
          const rel = e.dataTransfer.getData("text/mvforge-image");
          if (rel) {
            if (!/\.(png|jpe?g|webp)$/i.test(rel)) {
              toast.error("親画像にできるのは png / jpg / webp の画像だけです（動画は不可）");
              return;
            }
            promoteAssetToParent(rel);
            return;
          }
          const f = Array.from(e.dataTransfer.files).find((f) =>
            /\.(png|jpe?g|webp)$/i.test(f.name),
          );
          if (!f) {
            toast.error("親画像は png / jpg / webp のみ対応です");
            return;
          }
          uploadParent(f);
        }}
        className={cn(
          "mb-1.5 flex items-center gap-2 rounded border border-dashed p-1.5 transition-colors",
          parentLocked
            ? "cursor-default border-neutral-800 opacity-80"
            : parentDragging
              ? "cursor-pointer border-primary bg-primary/10"
              : "cursor-pointer border-neutral-700 hover:border-neutral-500",
        )}
        title={
          parentLocked
            ? "ジョブ進行中は親画像を差し替えられません（完了・キャンセル後に差し替え可）"
            : "親画像（キャラ・世界観の基準1枚）をドラッグ&ドロップ／クリックで選択。差し替えても前の親画像は素材に残ります"
        }
      >
        {parentFile ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${assetUrl("", projectName, parentFile)}&v=${parentVer}`}
              alt={parentFile}
              className="h-10 w-[71px] shrink-0 rounded object-cover"
            />
            <span className="text-[10px] leading-relaxed text-neutral-400">
              親画像: {parentFile}
              <br />
              {parentLocked
                ? "ジョブ進行中は差し替え不可"
                : "D&Dで差し替え（前の親は素材に残る）"}
            </span>
          </>
        ) : (
          <span className="py-2 text-[11px] text-neutral-500">
            {parentLocked
              ? "親画像なし（ジョブ進行中は設定できません）"
              : "親画像（キャラ・世界観の基準1枚）をここにD&D／クリックで選択"}
          </span>
        )}
      </div>
      <input
        ref={parentInputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          uploadParent(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {!job && (
        <>
          <p className="mb-1.5 text-[11px] leading-relaxed text-neutral-500">
            参謀が絵コンテを設計し、確認後に親画像そっくりの画風で一括生成します。
          </p>
          {coverage.total > 0 && (
            <p className="mb-1.5 rounded bg-neutral-900 px-1.5 py-1 text-[11px] text-neutral-400">
              絵の配役: {coverage.covered}/{coverage.total}行
              {coverage.uncoveredIds.length > 0
                ? `（未配役 ${coverage.uncoveredIds.length}行）`
                : "（全行に絵あり）"}
            </p>
          )}
          <div className="mb-1.5 flex items-center gap-2">
            <span className="shrink-0 text-[10px] text-neutral-500">枚数</span>
            <Select
              value={String(count)}
              onValueChange={(v) => setCount(Number(v))}
              disabled={busy}
            >
              <SelectTrigger className="h-6 min-w-0 flex-1 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0" className="text-xs">おまかせ（不足分を自動見積もり）</SelectItem>
                {[4, 6, 8, 10, 12, 14, 16, 20, 30, 40, 50].map((n) => (
                  <SelectItem key={n} value={String(n)} className="text-xs">
                    {n}枚
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" variant="outline" className="h-6 w-full text-xs" disabled={busy} onClick={plan}>
            {busy ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Clapperboard className="size-3" />
            )}
            ショットリストを設計（数分）
          </Button>
        </>
      )}

      {job?.phase === "planning" && (
        <p className="flex items-center gap-2 text-xs text-neutral-400">
          <Loader2 className="size-3 animate-spin" /> 参謀が親画像と歌詞から絵コンテを設計中…（目安2〜5分）
        </p>
      )}

      {job?.phase === "ready" && (
        <>
          <p className="mb-1.5 rounded bg-neutral-900 px-1.5 py-1 text-[11px] text-neutral-400">
            見積もり {job.shots.length}枚 ＝ 行あて
            {job.shots.filter((s) => s.assign?.order === 0).length}・カット割り
            {job.shots.filter((s) => (s.assign?.order ?? 0) > 0).length}・自由素材
            {job.shots.filter((s) => !s.assign).length}
            {coverage.uncoveredIds.length > job.shots.filter((s) => s.assign?.order === 0).length &&
              "（今回で埋まらない行は次のバッチで）"}
          </p>
          <div className="mb-1.5 max-h-44 space-y-1 overflow-y-auto">
            {job.shots.map((s, i) => (
              <div key={i} className="rounded bg-neutral-900 p-1.5 text-[10px]">
                <div className="text-neutral-300">
                  {i + 1}. {s.purpose}
                </div>
                <div className="truncate text-neutral-500">{s.prompt}</div>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            className="h-auto min-h-6 w-full whitespace-normal py-1 text-xs leading-snug"
            disabled={busy}
            onClick={() => run("run")}
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Palette className="size-3" />}
            {job.shots.length}枚を生成（目安
            {Math.max(1, Math.ceil((job.shots.length * 0.8) / DEFAULT_GEN_CONCURRENCY))}分・1枚 十数円）
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="mt-1 h-5 w-full text-[10px] text-neutral-500"
            disabled={busy}
            onClick={() => setJob(null)}
          >
            やり直す
          </Button>
        </>
      )}

      {job?.phase === "generating" && (
        <div className="text-xs text-neutral-300">
          <div className="mb-1 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Loader2 className="size-3 animate-spin" />
              生成中… {job.done}/{job.total}
            </span>
            <span className="text-[10px] text-neutral-500">{job.eta}</span>
          </div>
          <div className="mb-1.5 h-1.5 overflow-hidden rounded bg-neutral-800">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${job.total ? Math.round((job.done / job.total) * 100) : 0}%` }}
            />
          </div>
          {/* 届いた分から先に採点できる（素材帯にはまだ出ていない） */}
          {reviewGrid}
        </div>
      )}

      {/* レビュー: 拡大採点→確定（キャンセル/中断でも生成済み分は救済できる） */}
      {job &&
        (job.phase === "done" ||
          ((job.phase === "cancelled" || job.phase === "interrupted") &&
            job.generated.length > 0)) && (
        <div className="text-xs text-neutral-300">
          <div className="mb-1.5">
            {job.phase === "done"
              ? `${job.generated.length}枚が届きました。`
              : `中断しましたが、生成済み${job.generated.length}枚を採点できます。`}
            <b>クリックで拡大採点</b>
            （角の×で即不採用）。採用分は確定した時に初めて素材帯へ入ります。
          </div>
          {job.phase === "done" && job.failed.length > 0 && (
            <div className="mb-1.5 rounded border border-amber-900/60 bg-amber-950/30 p-1.5">
              <div className="mb-1 text-[10px] text-amber-300">
                {job.failed.length}枚が失敗: {job.failed.map((f) => f.filename).join(", ")}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-5 w-full text-[10px]"
                disabled={busy}
                onClick={() => run("retry")}
              >
                <RotateCcw className="size-3" /> 失敗分だけ再生成（成功済みは課金しない）
              </Button>
            </div>
          )}
          {reviewGrid}
          {job.shots.some((s) => s.assign) ? (
            <>
              <Button size="sm" className="h-6 w-full text-xs" disabled={busy} onClick={() => confirmReview(true)}>
                {busy ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <>
                    <Check className="size-3" />
                    採用{job.generated.length - rejects.size}枚で確定して行へ適用（拍スナップ）
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 h-5 w-full text-[10px] text-neutral-500"
                disabled={busy}
                onClick={() => confirmReview(false)}
              >
                採用のみ（行への割付は自分でやる）
              </Button>
            </>
          ) : (
            <Button size="sm" className="h-6 w-full text-xs" disabled={busy} onClick={() => confirmReview(false)}>
              {busy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <>
                  <Check className="size-3" />
                  {rejects.size > 0
                    ? `採用${job.generated.length - rejects.size}枚で確定（不採用${rejects.size}枚を除外）`
                    : "全部採用で確定"}
                </>
              )}
            </Button>
          )}
          {(job.phase === "cancelled" || job.phase === "interrupted") && (
            <Button
              size="sm"
              variant="ghost"
              className="mt-1 h-5 w-full text-[10px] text-neutral-500"
              disabled={busy}
              onClick={() => setJob(null)}
            >
              確定せず閉じる（保留のまま。次のバッチで同名なら上書き）
            </Button>
          )}
        </div>
      )}

      {job?.phase === "error" && (
        <div className="text-xs text-red-400">
          {job.error}
          <Button
            size="sm"
            variant="ghost"
            className="mt-1 h-5 w-full text-[10px] text-neutral-500"
            onClick={() => setJob(null)}
          >
            閉じる
          </Button>
        </div>
      )}

      {(job?.phase === "cancelled" || job?.phase === "interrupted") &&
        job.generated.length === 0 && (
        <div className="text-xs text-amber-400">
          {job.phase === "cancelled" ? "キャンセルしました" : "サーバー再起動により中断されました"}
          <Button
            size="sm"
            variant="ghost"
            className="mt-1 h-5 w-full text-[10px] text-neutral-500"
            onClick={() => setJob(null)}
          >
            閉じる
          </Button>
        </div>
      )}

      {/* 拡大採点ライトボックス: ←→=移動 / X=不採用にして次へ / Enter=採用のまま次へ / Esc=閉じる */}
      {zoom !== null && job && job.generated[zoom] && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/95"
          onClick={() => setZoom(null)}
        >
          <div className="flex items-center justify-between px-4 py-2 text-xs text-neutral-400">
            <span>
              {zoom + 1} / {job.generated.length}
              {purposeOf(job.generated[zoom]) && `　${purposeOf(job.generated[zoom])}`}
            </span>
            <span className="text-neutral-500">← → 移動 / X 不採用にして次へ / Enter 採用のまま次へ / Esc 閉じる</span>
          </div>
          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-14 pb-4"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setZoom(Math.max(zoom - 1, 0))}
              disabled={zoom === 0}
              className="absolute left-2 rounded p-2 text-neutral-400 hover:text-white disabled:opacity-20"
              title="前へ（←）"
            >
              <ChevronLeft className="size-8" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={assetUrl("", projectName, job.generated[zoom])}
              alt={job.generated[zoom]}
              className={cn(
                "max-h-full max-w-full rounded object-contain",
                rejects.has(job.generated[zoom]) && "opacity-40",
              )}
            />
            {rejects.has(job.generated[zoom]) && (
              <X className="pointer-events-none absolute size-24 text-red-500" />
            )}
            <button
              onClick={() => setZoom(Math.min(zoom + 1, job.generated.length - 1))}
              disabled={zoom === job.generated.length - 1}
              className="absolute right-2 rounded p-2 text-neutral-400 hover:text-white disabled:opacity-20"
              title="次へ（→）"
            >
              <ChevronRight className="size-8" />
            </button>
          </div>
          <div
            className="flex items-center justify-center gap-2 pb-4"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              size="sm"
              variant={rejects.has(job.generated[zoom]) ? "secondary" : "destructive"}
              className="h-7 text-xs"
              onClick={() => {
                toggleReject(job.generated[zoom]);
                if (zoom < job.generated.length - 1) setZoom(zoom + 1);
              }}
            >
              <X className="size-3.5" />
              {rejects.has(job.generated[zoom]) ? "採用に戻す" : "不採用にして次へ"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-xs"
              onClick={() =>
                zoom < job.generated.length - 1 ? setZoom(zoom + 1) : setZoom(null)
              }
            >
              <Check className="size-3.5" />
              採用のまま次へ
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setZoom(null)}>
              閉じる
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
