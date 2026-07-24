import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { projectDir, projectFile } from "@/lib/server/projects-server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);
const PARENT_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]); // findParentImage が検出する拡張子

/** ファイル名をプロジェクト直下の安全な名前に落とす（パス区切り・先頭ドットを除去） */
function sanitize(filename: string): string {
  const base = path.basename(filename).replace(/^\.+/, "");
  return base.replace(/[\\/:*?"<>|]/g, "_");
}

/** 同名が既にあれば song.wav → song-2.wav → song-3.wav と空きを探す（上書きしない） */
function uniquePath(dir: string, filename: string): string {
  const ext = path.extname(filename);
  const stem = filename.slice(0, -ext.length || undefined);
  let candidate = filename;
  for (let i = 2; fs.existsSync(path.join(dir, candidate)); i++) {
    candidate = `${stem}-${i}${ext}`;
  }
  return path.join(dir, candidate);
}

/** 既存の親画像を parent_prev_* に退避する（上書きで失わない・素材帯に残って再利用できる） */
function retireOldParents(dir: string): string[] {
  const stamp = new Date().toISOString().slice(5, 19).replace(/[-:T]/g, "");
  const retired: string[] = [];
  for (const f of ["parent.png", "parent.jpg", "parent.jpeg", "parent.webp"]) {
    const old = path.join(dir, f);
    if (!fs.existsSync(old)) continue;
    const dest = uniquePath(dir, `parent_prev_${stamp}${path.extname(f)}`);
    fs.renameSync(old, dest);
    retired.push(path.basename(dest));
  }
  return retired;
}

/**
 * 素材のアップロード。multipart { project, file, as? } を受けて projects/<name>/ 直下に保存。
 * - as 省略（音源）: song.mp3 等として保存（listAssets が音声として拾う場所）
 * - as="parent": parent.<ext> として保存（一式生成の基準画像）。既存の親画像は
 *   parent_prev_* に退避して素材として残す（画像を失わない）
 * - as="parent" ＋ fromFile: プロジェクト内の既存素材（images/xxx.png 等）を親に昇格
 *   （素材帯→親画像カードへの画面内D&D用。ファイル本体は複製するので元素材はそのまま残る）
 * Finderでフォルダに置く従来手順のUI版。
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const project = form.get("project");
  const file = form.get("file");
  const as = form.get("as");
  const fromFile = form.get("fromFile");

  if (typeof project !== "string" || !project) {
    return NextResponse.json({ error: "project required" }, { status: 400 });
  }
  let dir: string;
  try {
    dir = projectDir(project);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
  if (!fs.existsSync(dir)) {
    return NextResponse.json({ error: `project not found: ${project}` }, { status: 400 });
  }

  // 画面内D&D: プロジェクト内素材を親画像に昇格（アップロード不要・複製コピー）
  if (as === "parent" && typeof fromFile === "string" && fromFile) {
    const ext = path.extname(fromFile).toLowerCase();
    if (!PARENT_EXT.has(ext)) {
      return NextResponse.json(
        { error: `親画像は画像ファイル（${[...PARENT_EXT].join(" / ")}）のみ対応です: ${fromFile}` },
        { status: 400 },
      );
    }
    let srcAbs: string;
    try {
      srcAbs = projectFile(project, fromFile); // パストラバーサル対策込み
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 400 });
    }
    if (!fs.existsSync(srcAbs)) {
      return NextResponse.json({ error: `素材が見つかりません: ${fromFile}` }, { status: 400 });
    }
    const retired = retireOldParents(dir);
    try {
      fs.copyFileSync(srcAbs, path.join(dir, `parent${ext}`));
    } catch (e) {
      return NextResponse.json(
        { error: `保存に失敗しました: ${String(e).slice(-300)}` },
        { status: 500 },
      );
    }
    return NextResponse.json({ file: `parent${ext}`, retired });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "project & file required" }, { status: 400 });
  }

  const name = sanitize(file.name);
  const ext = path.extname(name).toLowerCase();

  if (as === "parent") {
    if (!name || !PARENT_EXT.has(ext)) {
      return NextResponse.json(
        { error: `親画像は画像ファイル（${[...PARENT_EXT].join(" / ")}）のみ対応です: ${file.name}` },
        { status: 400 },
      );
    }
    // 既存の親画像を退避（上書きで失わない・素材帯に残って再利用できる）
    const retired = retireOldParents(dir);
    try {
      fs.writeFileSync(path.join(dir, `parent${ext}`), Buffer.from(await file.arrayBuffer()));
    } catch (e) {
      return NextResponse.json(
        { error: `保存に失敗しました: ${String(e).slice(-300)}` },
        { status: 500 },
      );
    }
    return NextResponse.json({ file: `parent${ext}`, retired });
  }

  if (!name || !AUDIO_EXT.has(ext)) {
    return NextResponse.json(
      { error: `音声ファイル（${[...AUDIO_EXT].join(" / ")}）のみ対応です: ${file.name}` },
      { status: 400 },
    );
  }

  const abs = uniquePath(dir, name);
  try {
    fs.writeFileSync(abs, Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    return NextResponse.json(
      { error: `保存に失敗しました: ${String(e).slice(-300)}` },
      { status: 500 },
    );
  }
  return NextResponse.json({ file: path.basename(abs) });
}
