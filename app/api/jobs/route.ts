import { NextRequest, NextResponse } from "next/server";
import {
  listPersistedJobs,
  sweepOrphans,
  requestCancel,
  flushJobWrites,
} from "@/lib/server/jobs-server";
// i2v の resumeI2v を registerI2vResumer で登録させる（sweepOrphans が回収に使う）
import "@/lib/server/i2v-server";
// batch の pending救出を registerBatchRescuer で登録させる（同上。課金済み画像を孤児にしない）
import "@/lib/server/batch-gen-server";

export const dynamic = "force-dynamic";

/**
 * ジョブ横断API（i2v/render/suggest/batch 共通）。
 * GET    ?project=name        → 孤児回収を実行した上で jobs.json の全レコードを返す
 * DELETE ?project=name&id=xxx → キャンセル要求（i2v=fal PUT / render=cancelSignal / CLI系=proc.kill）
 */
export async function GET(req: NextRequest) {
  const project = req.nextUrl.searchParams.get("project");
  if (!project) {
    return NextResponse.json({ error: "project required" }, { status: 400 });
  }
  try {
    sweepOrphans(project);
    await flushJobWrites(project);
    return NextResponse.json({ jobs: listPersistedJobs(project) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const project = req.nextUrl.searchParams.get("project");
  const id = req.nextUrl.searchParams.get("id");
  if (!project || !id) {
    return NextResponse.json({ error: "project & id required" }, { status: 400 });
  }
  try {
    const result = await requestCancel(project, id);
    return NextResponse.json(result, { status: result.ok ? 200 : 404 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
