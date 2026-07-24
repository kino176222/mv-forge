import { NextRequest, NextResponse } from "next/server";
import { repairJobs, startRepair, generateAndAssign } from "@/lib/server/repair-server";
import { getPersistedJob } from "@/lib/server/jobs-server";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

/**
 * 口頭修正コンソール（赤入れ）。
 * POST {project, instruction, model?, favorites?}      → {id}（修正案の設計を開始）
 * POST {project, mode:"generate", lineNo, prompt}      → 生成して差し替えまで（課金。UIの明示クリックのみ）
 * GET  ?id=&project=                                   → RepairJob（patches/dropped/phase）
 * 通常パッチの適用はクライアント側（store.mutate＝⌘Zで戻せる）。
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    project: string;
    mode?: "generate";
    lineNo?: number;
    prompt?: string;
    instruction?: string;
    model?: string;
    favorites?: string[];
  };
  if (!body.project) return NextResponse.json({ error: "project required" }, { status: 400 });
  if (body.mode === "generate") {
    if (typeof body.lineNo !== "number" || !body.prompt?.trim()) {
      return NextResponse.json({ error: "lineNo と prompt が必要です" }, { status: 400 });
    }
    try {
      const r = await generateAndAssign(body.project, body.lineNo, body.prompt.trim());
      return NextResponse.json(r);
    } catch (e) {
      return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
    }
  }
  const instruction = (body.instruction ?? "").trim();
  if (!instruction) return NextResponse.json({ error: "修正指示が空です" }, { status: 400 });
  const job = startRepair(body.project, instruction, body.model ?? "", body.favorites ?? []);
  return NextResponse.json({ id: job.id });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const project = req.nextUrl.searchParams.get("project");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const job =
    repairJobs().get(id) ?? (project ? (getPersistedJob(project, id)?.payload ?? null) : null);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(job);
}
