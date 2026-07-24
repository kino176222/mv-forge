import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { projectDir } from "@/lib/server/projects-server";

export const dynamic = "force-dynamic";

/**
 * キャラ素材（動画から抜いた透過クリップ = projects/<name>/subjects/<base>/）の一覧と削除。
 * 一覧は素材帯の「キャラ」タブが読む。生成は /api/subject-video、配信は /api/asset。
 */

/** base はフォルダ名1階層のみ許可（パストラバーサル防止） */
function safeSubjectDir(project: string, base: string): string | null {
  if (!/^[\w.-]+$/.test(base)) return null; // スラッシュ・.. を含む名前を拒否
  const dir = path.join(projectDir(project), "subjects", base);
  return dir;
}

export interface SubjectAsset {
  base: string;
  count: number;
  fps: number;
  durationSec: number;
  /** 生成途中/失敗は一覧に出すが選択不可にする用 */
  state: "done" | "running" | "error";
}

/** GET ?project= → subjects一覧（manifest が無いものは status.json から状態だけ返す） */
export async function GET(req: NextRequest) {
  const project = req.nextUrl.searchParams.get("project");
  if (!project) {
    return NextResponse.json({ error: "project required" }, { status: 400 });
  }
  const root = path.join(projectDir(project), "subjects");
  const subjects: SubjectAsset[] = [];
  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      try {
        const manifest = JSON.parse(
          fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
        ) as { fps: number; count: number };
        subjects.push({
          base: entry.name,
          count: manifest.count,
          fps: manifest.fps,
          durationSec: manifest.count / manifest.fps,
          state: "done",
        });
      } catch {
        // manifest 無し = 生成途中か失敗。status.json から状態を拾う
        let state: SubjectAsset["state"] = "running";
        try {
          const s = JSON.parse(
            fs.readFileSync(path.join(dir, "status.json"), "utf8"),
          ) as { state?: string };
          state = s.state === "error" ? "error" : "running";
        } catch {
          state = "error";
        }
        subjects.push({ base: entry.name, count: 0, fps: 0, durationSec: 0, state });
      }
    }
  }
  subjects.sort((a, b) => a.base.localeCompare(b.base));
  return NextResponse.json(
    { subjects },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** DELETE ?project=&base= → subjects/<base>/ を丸ごと削除 */
export async function DELETE(req: NextRequest) {
  const project = req.nextUrl.searchParams.get("project");
  const base = req.nextUrl.searchParams.get("base");
  if (!project || !base) {
    return NextResponse.json({ error: "project & base required" }, { status: 400 });
  }
  const dir = safeSubjectDir(project, base);
  if (!dir) return NextResponse.json({ error: "invalid base" }, { status: 400 });
  if (!fs.existsSync(dir)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return NextResponse.json({ ok: true });
}
