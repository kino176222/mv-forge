import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { projectDir } from "@/lib/server/projects-server";

export const dynamic = "force-dynamic";

/**
 * 動画→キャラ透過クリップ化。切り抜きは分〜十分オーダーでルートの600s上限を超えるため、
 * scripts/matte-video.mjs を detached プロセスで起動し、進捗は subjects/<base>/status.json に書かせる。
 * POST=起動 / GET=進捗ポーリング。
 */

function outDirOf(project: string, video: string) {
  const base = path.basename(video).replace(/\.[^.]+$/, "");
  return path.join(projectDir(project), "subjects", base);
}

/** POST {project, video, model?, stabilize?, maxWidth?} → 切り抜きジョブを起動 */
export async function POST(req: NextRequest) {
  const { project, video, model = "lite", stabilize = 3, maxWidth = 1280, keyEvery = 1 } =
    (await req.json()) as {
      project: string; video: string;
      model?: string; stabilize?: number; maxWidth?: number; keyEvery?: number;
    };
  if (!project || !video) {
    return NextResponse.json({ error: "project & video required" }, { status: 400 });
  }
  const outDir = outDirOf(project, video);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "status.json"),
    JSON.stringify({ state: "running", stage: "starting", updatedAt: Date.now() }, null, 1),
  );
  // cwd=リポジトリルートで node_modules を解決させる（scripts/ の1つ上）
  const cwd = process.cwd();
  const child = spawn(
    process.execPath,
    ["scripts/matte-video.mjs", project, video, String(model), String(stabilize), String(maxWidth), String(keyEvery)],
    { cwd, detached: true, stdio: "ignore" },
  );
  child.unref();
  return NextResponse.json({ ok: true, base: path.basename(video).replace(/\.[^.]+$/, "") });
}

/** GET ?project=&video= → status.json の中身を返す（進捗ポーリング用） */
export async function GET(req: NextRequest) {
  const project = req.nextUrl.searchParams.get("project");
  const video = req.nextUrl.searchParams.get("video");
  if (!project || !video) {
    return NextResponse.json({ error: "project & video required" }, { status: 400 });
  }
  const noStore = { headers: { "Cache-Control": "no-store" } };
  try {
    const s = fs.readFileSync(path.join(outDirOf(project, video), "status.json"), "utf8");
    return NextResponse.json(JSON.parse(s), noStore);
  } catch {
    return NextResponse.json({ state: "none" }, noStore);
  }
}
