import { NextRequest, NextResponse } from "next/server";
import { batchJobs, startPlan, startRun, rejectImages, applyJobToProject, confirmJob, type BatchJob } from "@/lib/server/batch-gen-server";
import { getPersistedJob } from "@/lib/server/jobs-server";
import { MAX_SHOTS_PER_BATCH } from "@/lib/batch-plan";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

/**
 * 親画像から一式生成。
 * {project, mode:"plan", model?, count?}  → ショットリスト設計を開始（count=枚数指定、省略でおまかせ）
 * {project, mode:"run", jobId}            → 確認済みリストを一括生成
 * {project, mode:"retry", jobId}          → 失敗したショットだけ再生成（再課金の最小化）
 * {project, mode:"reject", files}         → レビューで不採用の画像を rejected/ へ退避
 * {project, mode:"confirm", jobId, files, apply?} → レビュー確定（採用をpending→images昇格・不採用退避・apply=trueで行へ適用まで）
 * {project, mode:"apply", jobId}          → 採用画像を assign に従って行/cuts へ割付（行へ適用）
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    project: string;
    mode: "plan" | "run" | "retry" | "reject" | "confirm" | "apply";
    model?: string;
    jobId?: string;
    count?: number;
    files?: string[];
    apply?: boolean;
  };
  if (!body.project) {
    return NextResponse.json({ error: "project required" }, { status: 400 });
  }
  if (body.mode === "plan") {
    const count = Math.max(0, Math.min(MAX_SHOTS_PER_BATCH, Math.floor(body.count ?? 0)));
    const job = startPlan(body.project, body.model ?? "", count);
    return NextResponse.json({ id: job.id });
  }
  if (body.mode === "run" && body.jobId) {
    const job = startRun(body.project, body.jobId);
    if (!job) return NextResponse.json({ error: "job not ready" }, { status: 400 });
    return NextResponse.json({ id: job.id });
  }
  if (body.mode === "retry" && body.jobId) {
    const prev = batchJobs().get(body.jobId);
    if (!prev || prev.failed.length === 0) {
      return NextResponse.json({ error: "再生成する失敗ショットがありません" }, { status: 400 });
    }
    const failedNames = new Set(prev.failed.map((f) => f.filename));
    const retryShots = prev.shots.filter((s) => failedNames.has(s.filename));
    const job = startRun(body.project, body.jobId, retryShots);
    if (!job) return NextResponse.json({ error: "job not ready" }, { status: 400 });
    return NextResponse.json({ id: job.id });
  }
  if (body.mode === "confirm" && body.jobId) {
    const job =
      batchJobs().get(body.jobId) ??
      ((getPersistedJob(body.project, body.jobId)?.payload ?? null) as BatchJob | null);
    if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
    try {
      const counts = confirmJob(body.project, job, body.files ?? []);
      if (body.apply) {
        const result = await applyJobToProject(body.project, job);
        return NextResponse.json({ ...counts, ...result });
      }
      return NextResponse.json(counts);
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }
  if (body.mode === "apply" && body.jobId) {
    const job =
      batchJobs().get(body.jobId) ??
      ((getPersistedJob(body.project, body.jobId)?.payload ?? null) as BatchJob | null);
    if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
    try {
      const result = await applyJobToProject(body.project, job);
      return NextResponse.json(result);
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }
  if (body.mode === "reject" && Array.isArray(body.files)) {
    try {
      const moved = rejectImages(body.project, body.files);
      return NextResponse.json({ ok: true, moved });
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 400 });
    }
  }
  return NextResponse.json({ error: "invalid mode" }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const project = req.nextUrl.searchParams.get("project");
  if (!id) return NextResponse.json({ jobs: [...batchJobs().values()] });
  const job =
    batchJobs().get(id) ??
    (project ? (getPersistedJob(project, id)?.payload ?? null) : null);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(job);
}
