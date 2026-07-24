import "./server-guard";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadProject, saveProject, projectDir, projectFile, findParentImage, listAssets } from "./projects-server";
import { applyShotsToLines, type ApplyResult } from "../batch-apply";
import {
  coverageOf,
  buildLyricsDigest,
  planCountRule,
  runPool,
  resolveGenConcurrency,
  shotFileRel,
  pendingFileRel,
} from "../batch-plan";
import { renameShots } from "../image-naming";

// 命名の単一の真実は batch-plan（純関数層）へ移動。既存importの互換のため再export
export { shotFileRel, pendingFileRel } from "../batch-plan";
import {
  persistJob,
  jobHandle,
  isCancelRequested,
  clearCancel,
  dropHandle,
  registerBatchRescuer,
  JobCancelledError,
  type JobRecord,
} from "./jobs-server";
import { callLLM, extractJson } from "./llm";

// 旧runClaude/extractJsonのimport互換（実体は llm.ts へ移動）
export { callLLM, extractJson } from "./llm";

/**
 * 🎬親画像から一式生成（親画像理論）:
 * 1) plan: AI参謀が親画像と歌詞を見て「ショットリスト」（何枚・どんな絵か）を設計
 * 2) run:  ユーザー確認後、fal.ai（I2I・親画像参照）で一括生成 → 素材帯へ
 * 生成物は「候補」として届くだけ。配役・採用は人間（またはドラフト）が決める。
 */

export let SKILL_SCRIPT: string | null =
  process.env.MVFORGE_IMAGE_GEN_SCRIPT ?? null;

export interface Shot {
  filename: string; // 拡張子なしのヒント（例: scene01_night_room）
  prompt: string;
  purpose: string; // どの歌詞・場面のためか（日本語）
  /** 割付先（「行へ適用」で使う）。order 0=行のメイン画像、1+=カット割り用。無し=自由素材 */
  assign?: { lineId: string; order: number };
}

export interface BatchJob {
  id: string;
  phase:
    | "planning"
    | "ready"
    | "generating"
    | "done"
    | "error"
    | "cancelled"
    | "interrupted";
  shots: Shot[];
  done: number;
  total: number;
  generated: string[]; // images/xxx.png
  /** 失敗したショット（「失敗分だけ再生成」用に配列で蓄積） */
  failed: { filename: string; log: string }[];
  error: string | null;
  startedAt: number;
  /** 生成フェーズの開始時刻（残り時間の推定用） */
  genStartedAt: number | null;
  projectName: string;
}

type G = typeof globalThis & { __mvforgeBatchJobs?: Map<string, BatchJob> };
const g = globalThis as G;
export function batchJobs(): Map<string, BatchJob> {
  if (!g.__mvforgeBatchJobs) g.__mvforgeBatchJobs = new Map();
  return g.__mvforgeBatchJobs;
}

/**
 * AIが出したショットリストの検疫＋命名（startPlan と一発出しモードで共用する純関数）。
 * - prompt/filename の無いショットを落とす
 * - assign の lineId 実在チェック・order 正規化（不正な assign は自由素材に降格）
 * - 命名規則の適用: L行番号/c番号/free_ を機械的に前置、既存素材・バッチ内重複は _v2 回避
 */
export function quarantineShots(
  shots: Shot[],
  lines: { id: string }[],
  existingImageFiles: string[],
): Shot[] {
  const validLineIds = new Set(lines.map((l) => l.id));
  const quarantined = (shots ?? [])
    .filter((s) => s.prompt && s.filename)
    .map((s) => {
      const a = s.assign;
      if (!a || typeof a.lineId !== "string" || !validLineIds.has(a.lineId) || typeof a.order !== "number") {
        return { filename: s.filename, prompt: s.prompt, purpose: s.purpose };
      }
      return { ...s, assign: { lineId: a.lineId, order: Math.max(0, Math.floor(a.order)) } };
    });
  const lineNoById = new Map(lines.map((l, i) => [l.id, i + 1]));
  return renameShots(
    quarantined,
    lineNoById,
    existingImageFiles.map((f) => f.replace(/^images\//, "").replace(/\.[^.]+$/, "")),
  );
}

/** 1) ショットリスト設計。count=0 はおまかせ＝不足分の自動見積もり（[絵なし]の全行＋カット割り、上限は batch-plan.MAX_SHOTS_PER_BATCH） */
export function startPlan(projectName: string, model: string, count = 0): BatchJob {
  const id = `batch-${Date.now().toString(36)}`;
  const job: BatchJob = {
    id,
    phase: "planning",
    shots: [],
    done: 0,
    total: 0,
    generated: [],
    failed: [],
    error: null,
    startedAt: Date.now(),
    genStartedAt: null,
    projectName,
  };
  batchJobs().set(id, job);
  const persist = () => persistJob(projectName, "batch", id, job, {
    request: { model, count },
  });
  persist();

  (async () => {
    try {
      const parent = findParentImage(projectName);
      if (!parent) {
        throw new Error(
          "親画像がありません。プロジェクトフォルダ直下に parent.png（キャラ・世界観の基準になる1枚）を置いてください。",
        );
      }
      const project = await loadProject(projectName);
      const existing = listAssets(projectName).images.map((i) => i.file);

      // 行単位で列挙する（区間単位だと絵が未割付のプロジェクト=全曲1区間になり、
      // AIが全ショットを1行に積む事故が起きる。2026-07-06の実運転で確認済み）
      const coverage = coverageOf(project.lines);
      const lyricsDigest = buildLyricsDigest(project.lines);

      const prompt = `あなたはMVの絵コンテ設計者です。親画像（キャラクターと世界観の基準）を必ずReadツールで見てから、この曲のMVに必要な画像のショットリストを設計してください。

# 親画像（必ずReadで見ること）
${parent}

# 曲: ${project.meta.title}
${project.meta.direction.trim() ? `# 演出方針（ユーザー指定。最優先で尊重すること）
${project.meta.direction.trim()}

` : ""}# 歌詞の流れ（行ごと: 行番号 | lineId [時刻] [配役マーク] 歌詞。lineId は割付先の指定に使う）
${lyricsDigest}

# 絵の配役状況
${coverage.covered}/${coverage.total}行に絵あり。[絵なし]は${coverage.uncoveredIds.length}行。

# 既にある素材（重複する構図は避ける）
${existing.join(", ") || "なし"}

# ルール
- ${planCountRule(count, coverage.uncoveredIds.length)}
- 各ショットのpromptは英語。親画像と同じキャラクター・画風を保つ前提で書く（"same girl as reference, same art style" 等を含める）
- キャラが登場しない情景・小物カットも2〜4枚混ぜる（曲の呼吸をつくる）
- 構図は多様に: クローズアップ／引き／後ろ姿／小物／空など
- filenameは日本語の短い場面名（4〜12文字。例: 蛍光灯の下で見上げる）。空白・記号は入れない。行番号は書かない（システムが付ける）
- 各ショットに assign を付ける: lineId=上の一覧のid、order=0で「その行から絵が切り替わる」。**基本は order 0 を別々の行に散らして**曲の流れに沿って絵を変えていく（Aメロ/Bメロ/サビの頭、歌詞の転換点、間奏など）
- **サビや見せ場に限り**、同じ行に order 1,2,… で同一シーンの寄り/引き/背中バリエーションを追加してよい（1行の中のカット割りに使われる）。同じ lineId に order 0 は1枚だけ
- どの行にも属さない自由素材は assign を省略してよい

# 出力形式（このJSONだけを出力）
{"shots": [{"filename": "夜の窓辺にたたずむ", "prompt": "...", "purpose": "Aメロ「〜」の場面", "assign": {"lineId": "line-xxx", "order": 0}}]}`;

      const raw = await callLLM(prompt, model, { jobId: id, images: [parent] });
      const parsed = extractJson<{ shots: Shot[] }>(raw);
      job.shots = quarantineShots(parsed.shots ?? [], project.lines, existing);
      job.total = job.shots.length;
      job.phase = "ready";
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

/**
 * 3) レビューで不採用にした画像を rejected/ へ退避する。
 * 削除はしない（気が変わったら手で images/ に戻せる）。深度マップも道連れ。
 */
export function rejectImages(projectName: string, files: string[]): string[] {
  const rejectedDir = path.join(projectDir(projectName), "rejected");
  fs.mkdirSync(rejectedDir, { recursive: true });
  const moved: string[] = [];
  for (const file of files) {
    const targets = [file, file.replace(/\.[^.]+$/, ".depth.png")];
    for (const t of targets) {
      const abs = projectFile(projectName, t); // パストラバーサル対策込み
      if (!fs.existsSync(abs)) continue;
      let dest = path.join(rejectedDir, path.basename(abs));
      if (fs.existsSync(dest)) {
        dest = path.join(
          rejectedDir,
          `${Date.now().toString(36)}_${path.basename(abs)}`,
        );
      }
      fs.renameSync(abs, dest);
      if (t === file) moved.push(file);
    }
  }
  return moved;
}

/**
 * 2) 一括生成（親画像をI2I参照、並列数は MVFORGE_GEN_CONCURRENCY、既定6）。
 * onlyShots指定時はそのサブセットだけを再生成（「失敗分だけ再生成」＝再課金の最小化）。
 */
export function startRun(
  projectName: string,
  jobId: string,
  onlyShots?: Shot[],
): BatchJob | null {
  const job = batchJobs().get(jobId);
  if (!job || !["ready", "done"].includes(job.phase)) return null;
  const genScript = SKILL_SCRIPT; // クロージャ内でのnull絞り込み用に固定
  if (!genScript) {
    job.phase = "error";
    job.error =
      "画像生成は未設定です（環境変数 MVFORGE_IMAGE_GEN_SCRIPT で生成スクリプトを指定してください）";
    persistJob(projectName, "batch", jobId, job);
    return job;
  }
  const targets = onlyShots && onlyShots.length > 0 ? onlyShots : job.shots;
  // run→cancel→retry の流れで前回のキャンセルフラグが残ると即中断されるため必ずクリア
  clearCancel(jobId);
  job.phase = "generating";
  job.done = 0;
  job.total = targets.length;
  job.failed = [];
  job.error = null;
  job.genStartedAt = Date.now();
  const persist = () => persistJob(projectName, "batch", jobId, job);
  persist();

  (async () => {
    try {
      const parent = findParentImage(projectName);
      // 生成先はステージング（pending/）。確定するまで素材帯・タイムラインに出さない
      fs.mkdirSync(path.join(projectDir(projectName), "pending"), { recursive: true });

      // 並列生成: 走行中プロセスをSetで持ち、キャンセルは全プロセスに効かせる
      const procs = new Set<ReturnType<typeof spawn>>();
      jobHandle(jobId).onCancel = () => {
        for (const p of procs) p.kill();
      };

      await runPool(
        targets,
        resolveGenConcurrency(process.env.MVFORGE_GEN_CONCURRENCY),
        async (shot) => {
          const rel = pendingFileRel(shot);
          const outPath = path.join(projectDir(projectName), rel);
          const args = [
            genScript,
            "--prompt",
            shot.prompt,
            "--output",
            outPath,
            "--aspect_ratio",
            "16:9",
          ];
          if (parent) args.push("--ref_image", parent);

          await new Promise<void>((resolve) => {
            const proc = spawn("python3", args, {
              env: { ...process.env, PYTHONUTF8: "1" },
            });
            procs.add(proc);
            let log = "";
            proc.stdout.on("data", (c) => (log += c));
            proc.stderr.on("data", (c) => (log += c));
            const timer = setTimeout(() => {
              proc.kill();
              job.failed.push({ filename: shot.filename, log: "timeout (240s)" });
              resolve();
            }, 240_000);
            proc.on("close", (code) => {
              clearTimeout(timer);
              procs.delete(proc);
              // キャンセルで殺された分は failed に積まない（再生成対象ではない）
              if (isCancelRequested(jobId)) return resolve();
              if (code !== 0 || !fs.existsSync(outPath)) {
                // 1枚の失敗で全体を止めない（配列に蓄積して「失敗分だけ再生成」に使う）
                job.failed.push({ filename: shot.filename, log: log.slice(-300) });
                return resolve();
              }
              // 旧仕様ジョブのretryではimages/直下の旧エントリが残るので置き換える（確定時の二重計上防止）
              job.generated = job.generated.filter(
                (f) => f !== rel && f !== shotFileRel(shot),
              );
              job.generated.push(rel);
              resolve();
            });
            proc.on("error", (e) => {
              clearTimeout(timer);
              procs.delete(proc);
              job.failed.push({ filename: shot.filename, log: String(e) });
              resolve();
            });
          });
          job.done += 1;
          persist(); // 1枚数十秒間隔なのでスロットル不要
        },
        // キャンセル: 新規起動を打ち切る（走行中の分は上のonCancelで殺される）
        () => isCancelRequested(jobId),
      );
      // キャンセル時も生成済み分（generated）は素材として残る
      job.phase = isCancelRequested(jobId) ? "cancelled" : "done";
    } catch (e) {
      job.phase = "error";
      job.error = e instanceof Error ? e.message : String(e);
    } finally {
      persist();
      dropHandle(jobId);
    }
  })();

  return job;
}

/**
 * レビュー確定の実体: 採用は pending/ → images/ へ昇格、不採用は rejected/ へ退避。
 * 旧仕様（images/直下に生成済み）の採用は据え置き。再実行（二度押し・リロード後）でも安全。
 * 返り値 adopted は images/ 相対パス＝適用（applyJobToProject）がそのまま使える形。
 */
export function confirmGeneratedOnDisk(
  projectName: string,
  generated: string[],
  rejected: Set<string>,
): { adopted: string[]; rejectedMoved: string[] } {
  const dir = projectDir(projectName);
  fs.mkdirSync(path.join(dir, "images"), { recursive: true });
  const adopted: string[] = [];
  const rejectedMoved: string[] = [];
  for (const rel of generated) {
    if (rejected.has(rel)) {
      // rejectImages が衝突回避（別名退避）と .depth.png の道連れを面倒みる
      rejectedMoved.push(...rejectImages(projectName, [rel]));
      continue;
    }
    const abs = projectFile(projectName, rel); // パストラバーサル対策込み
    const target = `images/${rel.split("/").pop()}`;
    if (rel.startsWith("pending/")) {
      if (fs.existsSync(abs)) fs.renameSync(abs, path.join(dir, target));
      if (fs.existsSync(path.join(dir, target))) adopted.push(target); // 昇格済み再実行もここで拾う
    } else if (fs.existsSync(abs)) {
      adopted.push(rel); // 旧仕様: 生成時からimages/直下
    }
  }
  return { adopted, rejectedMoved };
}

/**
 * 再起動で孤児化した batch の課金済み pending/ 画像を素材帯へ機械昇格する（AI判定なし・全採用）。
 * sweepOrphans（jobs-server）から registerBatchRescuer 経由で呼ばれる。
 * confirmGeneratedOnDisk は再実行安全なので、同じ記録を複数回掃いても壊れない。
 */
function rescueInterruptedBatch(record: JobRecord): number {
  const payload = record.payload as Pick<BatchJob, "generated"> | undefined;
  const generated = (payload?.generated ?? []).filter((f) => f.startsWith("pending/"));
  if (generated.length === 0) return 0;
  const { adopted } = confirmGeneratedOnDisk(record.projectName, generated, new Set());
  return adopted.length;
}
registerBatchRescuer(rescueInterruptedBatch);

/** レビュー確定（API用）: ディスク移動＋job.generatedをimages/パスへ更新して永続化 */
export function confirmJob(
  projectName: string,
  job: BatchJob,
  rejectedFiles: string[],
): { adopted: number; rejected: number } {
  const { adopted, rejectedMoved } = confirmGeneratedOnDisk(
    projectName,
    job.generated,
    new Set(rejectedFiles),
  );
  job.generated = adopted;
  persistJob(projectName, "batch", job.id, job);
  return { adopted: adopted.length, rejected: rejectedMoved.length };
}

/**
 * 4) 「行へ適用」: レビュー後に現存する生成画像（rejectedは実体が無いので自然に除外）を
 * assign に従って行の image / cuts[] へ割付けて保存する。
 * ルールと不変条件は lib/batch-apply.ts（純関数・テスト済み）を参照。
 */
export async function applyJobToProject(
  projectName: string,
  job: BatchJob,
): Promise<{ project: Awaited<ReturnType<typeof loadProject>> } & Omit<ApplyResult, "lines">> {
  const dir = projectDir(projectName);
  const shots = job.shots
    .filter((s) => s.assign)
    .map((s) => ({ file: shotFileRel(s), assign: s.assign! }))
    .filter(
      (s) =>
        job.generated.includes(s.file) && fs.existsSync(path.join(dir, s.file)),
    );
  let beats: number[] = [];
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(dir, "beats.json"), "utf8"),
    ) as { beats?: number[] };
    beats = parsed.beats ?? [];
  } catch {
    /* ビート未検出でも適用は可能（スナップ無しの等分になる） */
  }
  // 適用直前に再ロード（ユーザーのUI編集を巻き戻さない・/api/lrcと同じ流儀）
  const fresh = await loadProject(projectName);
  const { lines, applied, cutsCreated, skipped } = applyShotsToLines(
    fresh.lines,
    shots,
    beats,
    fresh.meta.songDuration,
  );
  fresh.lines = lines;
  saveProject(projectName, fresh);
  return { project: fresh, applied, cutsCreated, skipped };
}
