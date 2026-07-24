import { NextRequest, NextResponse } from "next/server";
import { startI2v, i2vJobs } from "@/lib/server/i2v-server";
import { getPersistedJob } from "@/lib/server/jobs-server";
import { I2V_MODELS } from "@/lib/ai-models";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

/** 🎬 i2v生成の開始。{project, image, prompt, model?, duration?, extendOf?} → {id} でポーリング
 *  extendOf 指定時は「その動画の続き」を最終コマから生成し、完了時に自動連結する */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    project: string;
    image?: string;
    prompt: string;
    model?: string;
    duration?: number;
    extendOf?: string;
    lineId?: string;
  };
  if (!body.project || !(body.image || body.extendOf) || !body.prompt?.trim()) {
    return NextResponse.json(
      { error: "project & (image | extendOf) & prompt required" },
      { status: 400 },
    );
  }
  const job = startI2v({
    projectName: body.project,
    image: body.image ?? "",
    prompt: body.prompt.trim(),
    model: body.model || I2V_MODELS[0].id,
    durationSec: body.duration === 10 ? 10 : 5,
    extendOf: body.extendOf,
    lineId: body.lineId,
  });
  return NextResponse.json({ id: job.id });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const project = req.nextUrl.searchParams.get("project");
  if (!id) return NextResponse.json({ jobs: [...i2vJobs().values()] });
  const job =
    i2vJobs().get(id) ??
    (project ? (getPersistedJob(project, id)?.payload ?? null) : null);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(job);
}
