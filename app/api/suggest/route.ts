import { NextRequest, NextResponse } from "next/server";
import { startSuggest, suggestJobs } from "@/lib/server/suggest-server";
import { getPersistedJob } from "@/lib/server/jobs-server";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

/** AI一括提案の開始。{project, draft?, model?, theme?} draft=画像割り当ても提案 / theme=手札を絞る大きな流れ */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    project: string;
    draft?: boolean;
    model?: string;
    theme?: string;
    favorites?: string[];
  };
  if (!body.project) {
    return NextResponse.json({ error: "project required" }, { status: 400 });
  }
  const job = startSuggest(
    body.project,
    body.draft ?? false,
    body.model ?? "",
    body.theme ?? "",
    Array.isArray(body.favorites) ? body.favorites.filter((f) => typeof f === "string") : [],
  );
  return NextResponse.json({ id: job.id });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const project = req.nextUrl.searchParams.get("project");
  if (!id) return NextResponse.json({ jobs: [...suggestJobs().values()] });
  const job =
    suggestJobs().get(id) ??
    (project ? (getPersistedJob(project, id)?.payload ?? null) : null);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(job);
}
