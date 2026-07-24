import { NextRequest, NextResponse } from "next/server";
import {
  saveSnapshot,
  listSnapshots,
  restoreSnapshot,
  isValidSha,
  isValidProjectName,
} from "@/lib/server/snapshots-server";

export const dynamic = "force-dynamic";

/** 履歴一覧 */
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (!isValidProjectName(name)) {
    return NextResponse.json({ error: "invalid name" }, { status: 400 });
  }
  try {
    return NextResponse.json({ snapshots: listSnapshots(name) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** 現在を保存（ラベル付コミット） */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = body.name;
  if (!isValidProjectName(name)) {
    return NextResponse.json({ error: "invalid name" }, { status: 400 });
  }
  const label = typeof body.label === "string" ? body.label : "";
  try {
    const sha = saveSnapshot(name, label);
    return NextResponse.json({ ok: true, sha });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** 復元（復元前に自動退避してから checkout） */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = body.name;
  const sha = body.sha;
  if (!isValidProjectName(name)) {
    return NextResponse.json({ error: "invalid name" }, { status: 400 });
  }
  if (!isValidSha(sha)) {
    return NextResponse.json({ error: "invalid sha" }, { status: 400 });
  }
  try {
    restoreSnapshot(name, sha);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
