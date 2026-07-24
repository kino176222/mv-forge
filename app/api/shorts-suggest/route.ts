import { NextRequest, NextResponse } from "next/server";
import { shortsSuggestJobs, startShortsSuggest } from "@/lib/server/shorts-suggest-server";
import { getPersistedJob } from "@/lib/server/jobs-server";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

/**
 * AIショート提案。
 * POST {project, model?} → {id}（歌詞と行タイミングから2〜3案をドラフト）
 * GET  ?id=&project=     → ShortsSuggestJob（proposals/dropped/phase）
 * 適用はクライアント側のチェックボックス関所（store.addShort＝⌘Zで戻せる）。
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { project: string; model?: string };
  if (!body.project) {
    return NextResponse.json({ error: "project required" }, { status: 400 });
  }
  const job = startShortsSuggest(body.project, body.model ?? "");
  return NextResponse.json({ id: job.id });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const project = req.nextUrl.searchParams.get("project");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const job =
    shortsSuggestJobs().get(id) ??
    (project ? (getPersistedJob(project, id)?.payload ?? null) : null);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(job);
}
