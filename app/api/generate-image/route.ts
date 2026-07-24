import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { projectDir, findParentImage } from "@/lib/server/projects-server";
import { sanitizeSlug, imageBaseName, uniqueBaseName } from "@/lib/image-naming";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 🎨不足素材の画像生成。
 * きの兄ぃの ai-image-generator スキル（fal.ai / GPT Image 2）をそのまま呼ぶ。
 * FAL_KEY は Vault ルートの .env をスクリプト側が自動で読む。
 * ※本体思想（B型合成エンジン）の例外として、オーナー判断で搭載した機能。
 */

let SKILL_SCRIPT: string | null = process.env.MVFORGE_IMAGE_GEN_SCRIPT ?? null;

export async function POST(req: NextRequest) {
  const { project, prompt, useParent, refImage } = (await req.json()) as {
    project: string;
    prompt: string;
    useParent?: boolean; // 既定true: parent.pngがあればI2I参照
    refImage?: string; // D&Dで指定したプロジェクト相対の参照画像（あれば parent より優先）
  };
  if (!project || !prompt?.trim()) {
    return NextResponse.json({ error: "project & prompt required" }, { status: 400 });
  }
  if (!SKILL_SCRIPT || !fs.existsSync(SKILL_SCRIPT)) {
    return NextResponse.json(
      {
        error:
          "画像生成は未設定です（環境変数 MVFORGE_IMAGE_GEN_SCRIPT で生成スクリプトを指定してください。外部で生成した画像を images/ に入れる運用でも使えます）",
      },
      { status: 501 },
    );
  }

  const imagesDir = path.join(projectDir(project), "images");
  fs.mkdirSync(imagesDir, { recursive: true });
  // 命名規則: 自由素材は free_<プロンプト由来スラッグ>.png（バッチ/口頭修正と同じ体系）。
  // 既存 images/ の basename と衝突したら _v2, _v3… を付与。書けば素材帯に自動で載る。
  const taken = new Set(
    fs
      .readdirSync(imagesDir)
      .map((f) => f.replace(/\.[^.]+$/, "").normalize("NFC")),
  );
  const slug = sanitizeSlug(prompt) || "自由生成";
  const base = uniqueBaseName(imageBaseName({ slug }), taken);
  const filename = `${base}.png`;
  const outPath = path.join(imagesDir, filename);

  // D&Dで渡された参照画像を優先（「この絵を修正して」の意図を尊重）。
  // トラバーサル防御: プロジェクトフォルダ配下かつ実在するファイルのみ許可。
  let droppedRef: string | null = null;
  if (refImage?.trim()) {
    const dir = projectDir(project);
    const abs = path.resolve(dir, refImage);
    const within = abs === dir || abs.startsWith(dir + path.sep);
    if (within && fs.existsSync(abs)) droppedRef = abs;
  }
  const parent =
    droppedRef ?? (useParent === false ? null : findParentImage(project));
  const args = [
    SKILL_SCRIPT,
    "--prompt",
    prompt,
    "--output",
    outPath,
    "--aspect_ratio",
    "16:9",
  ];
  if (parent) args.push("--ref_image", parent);

  const result = await new Promise<{ code: number; log: string }>((resolve) => {
    const proc = spawn("python3", args, {
      env: { ...process.env, PYTHONUTF8: "1" },
    });
    let log = "";
    proc.stdout.on("data", (c) => (log += c));
    proc.stderr.on("data", (c) => (log += c));
    const timer = setTimeout(() => {
      proc.kill();
      resolve({ code: -1, log: log + "\n(timeout 240s)" });
    }, 240_000);
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, log });
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, log: String(e) });
    });
  });

  if (result.code !== 0 || !fs.existsSync(outPath)) {
    return NextResponse.json(
      { error: `生成に失敗しました: ${result.log.slice(-400)}` },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, file: `images/${filename}` });
}
