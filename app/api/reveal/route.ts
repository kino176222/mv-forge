import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { projectDir } from "@/lib/server/projects-server";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

/**
 * 書き出したファイルを開く／Finderで表示する（ローカル専用ツールなので許可）。
 * パスはプロジェクトフォルダ配下に限定してコマンド注入・任意ファイルopenを防ぐ。
 * {project, file(絶対パス), mode: "open" | "reveal"}
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    project: string;
    file: string;
    mode?: "open" | "reveal";
  };
  if (!body.project || !body.file) {
    return NextResponse.json({ error: "project & file required" }, { status: 400 });
  }
  let dir: string;
  try {
    dir = projectDir(body.project);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
  const abs = path.resolve(body.file);
  if (!abs.startsWith(dir + path.sep) || !fs.existsSync(abs)) {
    return NextResponse.json({ error: "invalid file" }, { status: 400 });
  }
  try {
    const args = body.mode === "reveal" ? ["-R", abs] : [abs];
    await execFileAsync("open", args);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
