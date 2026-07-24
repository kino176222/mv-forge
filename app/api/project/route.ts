import { NextRequest, NextResponse } from "next/server";
import { loadProject, saveProject } from "@/lib/server/projects-server";
import { projectSchema } from "@/lib/schema";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  try {
    const project = await loadProject(name);
    return NextResponse.json({ project });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 404 });
  }
}

/** 自動保存の受け口。古いタブによる上書き事故を防ぐ楽観ロック付き */
export async function PUT(req: NextRequest) {
  const body = await req.json();
  const name = body.name as string;
  const parsed = projectSchema.safeParse(body.project);
  if (!name || !parsed.success) {
    return NextResponse.json(
      { error: parsed.success ? "name required" : parsed.error.message },
      { status: 400 },
    );
  }
  // loadedAt（クライアントが最後に読み込んだ時刻）よりファイルが新しければ拒否
  const loadedAt = typeof body.loadedAt === "number" ? body.loadedAt : null;
  if (loadedAt !== null) {
    const { default: fs } = await import("node:fs");
    const { projectDir } = await import("@/lib/server/projects-server");
    const path = `${projectDir(name)}/project.json`;
    if (fs.existsSync(path) && fs.statSync(path).mtimeMs > loadedAt + 2000) {
      return NextResponse.json(
        { error: "conflict", conflict: true },
        { status: 409 },
      );
    }
  }
  saveProject(name, parsed.data);
  return NextResponse.json({ ok: true, savedAt: Date.now() });
}
