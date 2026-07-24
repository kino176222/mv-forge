import { NextRequest, NextResponse } from "next/server";
import { jobs, startRender } from "@/lib/server/render-server";
import { getPersistedJob } from "@/lib/server/jobs-server";
import { renderPreset } from "@/lib/render-presets";

export const dynamic = "force-dynamic";

/** 書き出し開始。{project, frameRange?, draft?, label?, preset?, shortId?} */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    project: string;
    frameRange?: [number, number] | null;
    draft?: boolean;
    label?: string;
    preset?: string;
    shortId?: string | null;
  };
  if (!body.project) {
    return NextResponse.json({ error: "project required" }, { status: 400 });
  }
  const job = startRender({
    projectName: body.project,
    assetBase: req.nextUrl.origin,
    frameRange: body.frameRange ?? null,
    draft: body.draft ?? false,
    label: body.label,
    preset: renderPreset(body.preset).id,
    shortId: body.shortId ?? null,
  });
  return NextResponse.json({ id: job.id });
}

/** 進捗ポーリング。?id=render-xxx&project=name（projectはjobs.jsonフォールバック用） */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const project = req.nextUrl.searchParams.get("project");
  if (!id) {
    // 一覧（デバッグ用）
    return NextResponse.json({ jobs: [...jobs().values()] });
  }
  const job =
    jobs().get(id) ??
    (project ? (getPersistedJob(project, id)?.payload ?? null) : null);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(job);
}
