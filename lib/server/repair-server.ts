import "./server-guard";
/**
 * 口頭修正コンソールのサーバー層。自由文指示→claude CLI（MAX定額）→patches JSON→検疫。
 * 適用はしない（適用はクライアントの store.mutate＝⌘Zで戻せる）。純ロジックは lib/repair.ts。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadProject, saveProject, listAssets, projectDir, findParentImage } from "./projects-server";
import { SKILL_SCRIPT } from "./batch-gen-server";
import { callLLM, extractJson } from "./llm";
import { EFFECTS, effectCatalogForAI } from "../effects-meta";
import { XP_BRIDGED_EFFECTS } from "../xp/bridge";
import {
  sanitizePatches,
  buildRepairPrompt,
  applyPatchesToLines,
  effectiveLineImages,
  type RepairPatch,
  type RepairContext,
} from "../repair";
import { persistJob, isCancelRequested, dropHandle, JobCancelledError } from "./jobs-server";
import { sanitizeSlug, imageBaseName, uniqueBaseName } from "../image-naming";

export interface RepairJob {
  id: string;
  phase: "running" | "done" | "error" | "cancelled";
  instruction: string;
  patches: RepairPatch[];
  dropped: { summary: string; reason: string }[];
  error: string | null;
  startedAt: number;
  projectName: string;
}

type G = typeof globalThis & {
  __mvforgeRepairJobs?: Map<string, RepairJob>;
  __mvforgeRepairSaveChain?: Promise<unknown>;
};
const g = globalThis as G;
export function repairJobs(): Map<string, RepairJob> {
  if (!g.__mvforgeRepairJobs) g.__mvforgeRepairJobs = new Map();
  return g.__mvforgeRepairJobs;
}

/** project.json の読み→書きを直列化する軽ロック（並列生成の同時保存で片方が消えるのを防ぐ） */
function withSaveLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = g.__mvforgeRepairSaveChain ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  g.__mvforgeRepairSaveChain = next;
  return next;
}

/** 検疫用の実在idセット（AIの幻覚をここで落とす） */
export function buildRepairContext(
  lineCount: number,
  images: string[],
  lineImages?: (string | null)[],
): RepairContext {
  const all = [...EFFECTS, ...XP_BRIDGED_EFFECTS];
  const byCat = (pred: (cat: string) => boolean) =>
    new Set(all.filter((e) => pred(e.category)).map((e) => e.id));
  return {
    lineCount,
    images: new Set(images),
    lineImages,
    lyricAnimIds: byCat((c) => c === "lyric"),
    transitionIds: byCat((c) => c === "transition"),
    // decor/look は口頭コンソールv1の対象外（lookは作品で1回決めるもの）
    effectIds: byCat((c) => !["lyric", "transition", "decor", "look"].includes(c)),
  };
}

/**
 * needs-generation パッチの実行: 親画像参照で1枚生成 → その行の image に差し替えて保存。
 * 課金はこの関数の呼び出し（＝UIの明示クリック）のみ。保存は loadProject 直前再読込の流儀
 * （applyJobToProject と同じ。ユーザーのUI編集を巻き戻さない）。
 */
export async function generateAndAssign(
  projectName: string,
  lineNo: number,
  prompt: string,
): Promise<{ file: string; project: Awaited<ReturnType<typeof loadProject>>; applied: number }> {
  const parent = findParentImage(projectName);
  // 命名規則: L07_歌詞冒頭.png（歌詞から機械生成）。既存・並列生成との衝突は _v2 で回避
  const current = await loadProject(projectName);
  const slug =
    sanitizeSlug(current.lines[lineNo - 1]?.lyricText, 12) || "差し替え";
  const dir = projectDir(projectName);
  fs.mkdirSync(path.join(dir, "images"), { recursive: true });
  const taken = new Set(
    fs
      .readdirSync(path.join(dir, "images"))
      .map((f) => f.replace(/\.[^.]+$/, "").normalize("NFC")),
  );
  const base = uniqueBaseName(imageBaseName({ lineNo, slug }), taken);
  const rel = `images/${base}.png`;
  const outPath = path.join(dir, rel);

  // 画風アンカーの保険: AIプロンプトに画風指定が無くても親の画風に寄せる
  // （2026-07-06実運転の教訓: 抽象指示だと参照画像があっても実写調に飛ぶ。
  //   2026-07-17の教訓: "anime illustration"の一般語は逆に汎用アニメ塗りへ引っ張る毒→撤去）
  const styled = /same art style/i.test(prompt)
    ? prompt
    : `${prompt}. CRITICAL: reproduce EXACTLY the same art style as the reference image - same line quality, same shading technique, same flat color palette. Do not upgrade or modernize the art style.`;
  if (!SKILL_SCRIPT) {
    throw new Error(
      "画像生成は未設定です（環境変数 MVFORGE_IMAGE_GEN_SCRIPT で生成スクリプトを指定してください）",
    );
  }
  const args = [SKILL_SCRIPT, "--prompt", styled, "--output", outPath, "--aspect_ratio", "16:9"];
  if (parent) args.push("--ref_image", parent);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("python3", args, { env: { ...process.env, PYTHONUTF8: "1" } });
    let log = "";
    proc.stdout.on("data", (c) => (log += c));
    proc.stderr.on("data", (c) => (log += c));
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("画像生成がタイムアウトしました (240s)"));
    }, 240_000);
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || !fs.existsSync(outPath)) {
        return reject(new Error(`画像生成に失敗: ${log.slice(-300)}`));
      }
      resolve();
    });
  });

  // 並列生成がほぼ同時に終わっても差し替えが消えないよう、読み→書きは直列化する
  return withSaveLock(async () => {
    const fresh = await loadProject(projectName);
    const { lines, applied } = applyPatchesToLines(fresh.lines, [
      { kind: "image", lineNo, image: rel, summary: `${lineNo}行目へ生成画像を差し替え` },
    ]);
    fresh.lines = lines;
    saveProject(projectName, fresh);
    return { file: rel, project: fresh, applied };
  });
}

/**
 * oneshot.json（一括生成のチェックポイント）から 行番号→元の生成プロンプト を引く。
 * 単発再生成の背景ドリフト対策: 元プロンプトの世界観・スタイル語彙を赤入れAIに正本として渡す。
 * 一発出しを使っていないプロジェクトでは null（従来どおりの動き）。
 */
function loadScenePrompts(
  projectName: string,
  lines: { id: string }[],
): Record<number, string> | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(projectDir(projectName), "oneshot.json"), "utf8"),
    );
    const scenes = Array.isArray(raw?.scenes) ? raw.scenes : [];
    const noByLineId = new Map(lines.map((l, i) => [l.id, i + 1]));
    const out: Record<number, string> = {};
    for (const s of scenes) {
      const no = s?.assign?.lineId ? noByLineId.get(s.assign.lineId) : undefined;
      if (no && s.assign.order === 0 && typeof s.prompt === "string" && !(no in out)) {
        out[no] = s.prompt;
      }
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

export function startRepair(
  projectName: string,
  instruction: string,
  model: string,
  favorites: string[] = [],
): RepairJob {
  const id = `repair-${Date.now().toString(36)}`;
  const job: RepairJob = {
    id,
    phase: "running",
    instruction,
    patches: [],
    dropped: [],
    error: null,
    startedAt: Date.now(),
    projectName,
  };
  repairJobs().set(id, job);
  const persist = () => persistJob(projectName, "repair", id, job, { request: { model } });
  persist();

  (async () => {
    try {
      const project = await loadProject(projectName);
      const assets = listAssets(projectName).images.map((i) => i.file);
      const prompt = buildRepairPrompt(
        project,
        instruction,
        assets,
        effectCatalogForAI(undefined, favorites),
        loadScenePrompts(projectName, project.lines),
      );
      const raw = await callLLM(prompt, model, { jobId: id });
      const parsed = extractJson<{ patches: unknown[] }>(raw);
      const ctx = buildRepairContext(
        project.lines.length,
        assets,
        effectiveLineImages(project.lines),
      );
      const { patches, dropped } = sanitizePatches(parsed, ctx);
      job.patches = patches;
      job.dropped = dropped;
      job.phase = "done";
    } catch (e) {
      if (e instanceof JobCancelledError || isCancelRequested(id)) {
        job.phase = "cancelled";
      } else {
        job.phase = "error";
        job.error = e instanceof Error ? e.message : String(e);
      }
    } finally {
      persist();
      dropHandle(id);
    }
  })();

  return job;
}
