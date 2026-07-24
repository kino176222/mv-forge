import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import {
  listProjects,
  projectDir,
  projectFromTemplate,
  saveProject,
} from "@/lib/server/projects-server";
import { emptyProject } from "@/lib/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ projects: listProjects() });
}

/** 新規プロジェクト作成: フォルダ＋images/＋雛形project.json。template指定で様式を複製 */
export async function POST(req: NextRequest) {
  const { name, title, template } = (await req.json()) as {
    name: string;
    title?: string;
    template?: string; // 既存プロジェクト名。指定するとフォント・エンドカード等の様式を引き継ぐ
  };
  const dir = projectDir(name);
  if (fs.existsSync(path.join(dir, "project.json"))) {
    return NextResponse.json({ error: "already exists" }, { status: 409 });
  }
  let project = emptyProject(title ?? name);
  if (template) {
    try {
      project = await projectFromTemplate(template, title ?? name);
    } catch (e) {
      return NextResponse.json(
        { error: `雛形の読み込みに失敗: ${e instanceof Error ? e.message : e}` },
        { status: 400 },
      );
    }
  }
  fs.mkdirSync(path.join(dir, "images"), { recursive: true });
  fs.mkdirSync(path.join(dir, "exports"), { recursive: true });
  saveProject(name, project);
  return NextResponse.json({ ok: true, name });
}
