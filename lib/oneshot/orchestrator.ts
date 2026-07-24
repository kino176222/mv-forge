import fs from "node:fs";
import path from "node:path";
import {
  batchJobs,
  startRun,
  confirmJob,
  applyJobToProject,
  type BatchJob,
  type Shot,
} from "../server/batch-gen-server";
import { startSuggest, suggestJobs, loadSongStructure, type SuggestJob } from "../server/suggest-server";
import { startI2v, i2vJobs, type I2vJob } from "../server/i2v-server";
import { generateDepth, depthFileOf } from "../server/depth-server";
import { generateLrcAuto } from "../server/lrc-server";
import { pendingFileRel, runPool } from "../batch-plan";
import {
  persistJob,
  jobHandle,
  isCancelRequested,
  dropHandle,
  requestCancel,
  JobCancelledError,
} from "../server/jobs-server";
import { loadProject, saveProject, projectDir } from "../server/projects-server";
import { adoptAllSuggestionsInPlace } from "../adopt-suggest";
import { preflightOneshot } from "./preflight";
import { runScenePlan } from "./scene-plan";
import { judgeImages, judgeVideo, appendAssetsCards } from "./judge";
import { selectI2vTargets, type I2vTarget } from "./i2v-select";
import { applyI2vResults } from "./apply-i2v";
import { estimateCost, planCost, capYenOf, i2vUnitUsd, PRICE_TABLE } from "./cost";
import { I2V_MODELS } from "../ai-models";
import {
  ONESHOT_STEPS,
  TONE_DIRECTIVES,
  type MetaphorLevel,
  type OneshotCheckpoint,
  type OneshotJob,
  type OneshotMode,
  type OneshotPhase,
  type OneshotTone,
  type PlannedScene,
} from "./types";

/**
 * 一発出しモードのオーケストレーター（既存部品を直列に繋ぐだけ。ゼロから作らない）。
 * preflight → lrc → scene-plan → cost-gate → images(+AI判定ループ) → apply
 *   → depth(竹) → i2v(+AI判定・松竹) → suggest → adopt → done
 * - 子ジョブは既存の fire-and-forget をそのまま起動し、in-memory Map を2秒ポーリングで完了待ち
 * - キャンセルは jobHandle(oneshotId).onCancel → 走行中の子ジョブ全部へ requestCancel を連鎖
 * - AI判定は「1回見て採否とタグを同時に書く」＝assets.json（目のカルテ）の書き手
 * - 途中再開（resumeOneshot）は未実装（Phase 3残）。再起動時は interrupted になり、
 *   走行中だったi2v子ジョブだけは既存 resumeI2v が課金済み結果を自動回収する
 */

export interface OneshotRequest {
  projectName: string;
  mode: OneshotMode;
  model?: string;
  i2vModel?: string;
  tone?: OneshotTone;
  /** 表現のさじ加減（直喩/バランス/詩的）。シーン設計プロンプトに効く */
  metaphor?: MetaphorLevel;
  /** 歌詞テキスト（あればLRC自動生成。無ければ既存 lines[] を使う） */
  lyricsText?: string;
  /** LRC用ボーカル音源（省略時は本編音源） */
  audioFile?: string;
  /** 演出方針（トーン指示と合成して meta.direction へ保存） */
  direction?: string;
}

type G = typeof globalThis & { __mvforgeOneshotJobs?: Map<string, OneshotJob> };
const g = globalThis as G;
export function oneshotJobs(): Map<string, OneshotJob> {
  if (!g.__mvforgeOneshotJobs) g.__mvforgeOneshotJobs = new Map();
  return g.__mvforgeOneshotJobs;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setStep(job: OneshotJob, phase: OneshotPhase): void {
  job.phase = phase;
  const idx = ONESHOT_STEPS.findIndex((s) => s.phase === phase);
  if (idx >= 0) {
    job.stepIndex = idx;
    job.stepLabel = ONESHOT_STEPS[idx].label;
  }
  job.done = 0;
  job.total = 0;
}

function checkCancel(id: string): void {
  if (isCancelRequested(id)) throw new JobCancelledError();
}

function writeCheckpoint(projectName: string, cp: OneshotCheckpoint): void {
  fs.writeFileSync(
    path.join(projectDir(projectName), "oneshot.json"),
    JSON.stringify(cp, null, 2) + "\n",
    "utf8",
  );
}

/** 合成BatchJob: シーン計画を既存の一括生成パイプラインへそのまま流すための器 */
function makeBatchJob(projectName: string, shots: Shot[]): BatchJob {
  return {
    id: `batch-${Date.now().toString(36)}`,
    phase: "ready",
    shots,
    done: 0,
    total: shots.length,
    generated: [],
    failed: [],
    error: null,
    startedAt: Date.now(),
    genStartedAt: null,
    projectName,
  };
}

async function waitForBatch(
  oneshotId: string,
  batchId: string,
  onTick: (b: BatchJob) => void,
): Promise<BatchJob> {
  for (;;) {
    checkCancel(oneshotId);
    const b = batchJobs().get(batchId);
    if (!b) throw new Error("一括生成ジョブが見つかりません（サーバー再起動の可能性）");
    onTick(b);
    if (b.phase === "done") return b;
    if (b.phase === "error") throw new Error(`画像生成に失敗しました: ${b.error ?? ""}`);
    if (b.phase === "cancelled" || b.phase === "interrupted") throw new JobCancelledError();
    await sleep(2000);
  }
}

async function waitForSuggest(oneshotId: string, suggestId: string): Promise<SuggestJob> {
  for (;;) {
    checkCancel(oneshotId);
    const s = suggestJobs().get(suggestId);
    if (!s) throw new Error("演出提案ジョブが見つかりません（サーバー再起動の可能性）");
    if (s.status === "done") return s;
    if (s.status === "error") throw new Error(`演出提案に失敗しました: ${s.error ?? ""}`);
    if (s.status === "cancelled" || s.status === "interrupted") throw new JobCancelledError();
    await sleep(2000);
  }
}

async function waitForI2v(oneshotId: string, i2vId: string): Promise<I2vJob> {
  for (;;) {
    if (isCancelRequested(oneshotId)) throw new JobCancelledError();
    const j = i2vJobs().get(i2vId);
    if (!j) throw new Error("i2vジョブが見つかりません");
    if (j.status === "done") return j;
    if (j.status === "error") throw new Error(j.error ?? "i2v失敗");
    if (j.status === "cancelled" || j.status === "interrupted") throw new JobCancelledError();
    await sleep(3000);
  }
}

/** Step 3.5 コストゲートの承認（UIの「承認して続行」から呼ばれる） */
export function confirmCost(id: string): boolean {
  const job = oneshotJobs().get(id);
  if (!job || job.phase !== "cost-gate") return false;
  job.costConfirmed = true;
  return true;
}

const TERMINAL_PHASES: OneshotPhase[] = ["done", "error", "cancelled", "interrupted"];

/** 同一プロジェクトで走行中（非終端）の一発出しジョブ（多重起動ガード用） */
export function runningOneshotFor(projectName: string): OneshotJob | null {
  for (const j of oneshotJobs().values()) {
    if (j.projectName === projectName && !TERMINAL_PHASES.includes(j.phase)) return j;
  }
  return null;
}

export function startOneshot(req: OneshotRequest): OneshotJob {
  // 多重起動ガード: 同一プロジェクトに2本走ると費用2倍＋saveProjectの交錯で編集が消える
  const running = runningOneshotFor(req.projectName);
  if (running) {
    throw new Error(
      `このプロジェクトでは一発出しが実行中です（${running.stepLabel}）。完了かキャンセルを待ってください`,
    );
  }
  const id = `oneshot-${Date.now().toString(36)}`;
  const i2vModel = req.i2vModel?.trim() || I2V_MODELS[0].id;
  const tone: OneshotTone = req.tone ?? "calm";
  const metaphor: MetaphorLevel = req.metaphor ?? "balanced";
  const usdJpy = Number(process.env.MVFORGE_USDJPY ?? PRICE_TABLE.usdJpyDefault);
  const job: OneshotJob = {
    id,
    projectName: req.projectName,
    mode: req.mode,
    model: req.model ?? "",
    i2vModel,
    phase: "preflight",
    stepIndex: 0,
    stepLabel: ONESHOT_STEPS[0].label,
    done: 0,
    total: 0,
    childJobId: null,
    planSummary: "",
    planCount: 0,
    planYen: null,
    capYen: null,
    costConfirmed: false,
    spentUsd: 0,
    rejectedImages: [],
    failedImages: [],
    i2vRejected: [],
    error: null,
    startedAt: Date.now(),
  };
  oneshotJobs().set(id, job);
  const persist = () =>
    persistJob(req.projectName, "oneshot", id, job, {
      request: { mode: req.mode, model: req.model ?? "", i2vModel, tone, metaphor },
    });
  persist();

  // キャンセル: 走行中の子ジョブ全部へ連鎖（batch/suggest=proc.kill、i2v=fal PUT が既存実装で効く）
  const children = new Set<string>();
  jobHandle(id).onCancel = () => {
    if (job.childJobId) void requestCancel(req.projectName, job.childJobId);
    for (const c of children) void requestCancel(req.projectName, c);
  };

  (async () => {
    try {
      // ---- Step 0 preflight ----
      setStep(job, "preflight");
      persist();
      const problems = await preflightOneshot({
        projectName: req.projectName,
        lyricsText: req.lyricsText,
        model: req.model ?? "",
      });
      if (problems.length) throw new Error(problems.join(" ／ "));

      // 演出方針＝ユーザー指定＋トーン指示を合成して保存（scene-plan と suggest の両方が読む）
      {
        const p = await loadProject(req.projectName);
        // 指定なしなら既存の方針を引き継ぐ（空directionで過去に書いた方針を消さない）。
        // 前回oneshotが書いたトーン指示行は重複防止のため取り除いてから合成する
        const toneLines = new Set(Object.values(TONE_DIRECTIVES).map((s) => s.trim()));
        const existing = (p.meta.direction ?? "")
          .split("\n")
          .filter((l) => l.trim() && !toneLines.has(l.trim()))
          .join("\n");
        const parts = [req.direction?.trim() || existing, TONE_DIRECTIVES[tone]].filter(Boolean);
        p.meta.direction = parts.join("\n");
        saveProject(req.projectName, p);
      }
      checkCancel(id);

      // ---- Step 1-2 lrc（歌詞テキストがあれば自動生成＝beats.json 解析込み） ----
      if (req.lyricsText?.trim()) {
        setStep(job, "lrc");
        persist();
        const p = await loadProject(req.projectName);
        await generateLrcAuto(
          req.projectName,
          req.audioFile?.trim() || p.meta.songFile,
          req.lyricsText,
          false,
        );
      }
      checkCancel(id);

      // ---- Step 3 scene-plan（★頭脳） ----
      setStep(job, "scene-plan");
      persist();
      const plan = await runScenePlan(req.projectName, job.model, req.mode, id, metaphor);
      if (plan.scenes.length === 0) {
        throw new Error("シーン計画が空でした（AIの出力を確認してください）");
      }
      job.planSummary = plan.summary;
      job.planCount = plan.scenes.length;
      writeCheckpoint(req.projectName, {
        version: 1,
        mode: req.mode,
        createdAt: Date.now(),
        summary: plan.summary,
        scenes: plan.scenes,
        steps: { "scene-plan": true },
      });
      persist();
      checkCancel(id);

      // ---- Step 3.5 cost-gate（確定見積が上限超過なら承認待ちで停止） ----
      {
        const proj = await loadProject(req.projectName);
        const est = estimateCost(req.mode, proj.meta.songDuration, i2vModel, usdJpy);
        job.capYen = capYenOf(est);
        const order0 = plan.scenes.filter((s) => s.assign?.order === 0).length;
        const approxClips =
          req.mode === "ume" ? 0 : req.mode === "matsu" ? order0 : Math.min(order0, 8);
        const pc = planCost(
          plan.scenes.length,
          Array.from({ length: approxClips }, () => ({ durationSec: 5 as const })),
          i2vModel,
          usdJpy,
        );
        job.planYen = pc.totalYen;
        if (pc.totalYen > job.capYen) {
          setStep(job, "cost-gate");
          persist();
          // 承認待ちの無期限スピン防止: ダイアログを見失ったまま放置されたら中止に倒す
          const gateStart = Date.now();
          while (!job.costConfirmed) {
            checkCancel(id);
            if (Date.now() - gateStart > 60 * 60 * 1000) {
              throw new Error(
                "コスト承認待ちが1時間を超えたため中止しました（課金前です。もう一度実行してください）",
              );
            }
            await sleep(1000);
          }
        }
      }
      checkCancel(id);

      // ---- Step 4 images ＋ AI判定ループ（不採用のみ再生成・最大2周） ----
      setStep(job, "images");
      const batch = makeBatchJob(req.projectName, plan.scenes);
      batchJobs().set(batch.id, batch);
      job.childJobId = batch.id;
      persist();
      persistJob(req.projectName, "batch", batch.id, batch, {
        request: { via: "oneshot", oneshotId: id },
      });
      const shotByPending = new Map(plan.scenes.map((s) => [pendingFileRel(s), s]));

      startRun(req.projectName, batch.id);
      let b = await waitForBatch(id, batch.id, (x) => {
        job.done = x.done;
        job.total = x.total;
        persist();
      });
      job.spentUsd += (batch.total - b.failed.length) * PRICE_TABLE.imageUsd;

      let toJudge = b.generated
        .filter((f) => f.startsWith("pending/"))
        .map((rel) => {
          const s = shotByPending.get(rel);
          return { rel, prompt: s?.prompt ?? "", purpose: s?.purpose ?? "" };
        });
      const finalRejects = new Set<string>();
      for (let round = 1; ; round++) {
        job.stepLabel = `画像のAI判定（${round}周目）`;
        persist();
        const verdicts = await judgeImages(req.projectName, job.model, id, toJudge, round);
        appendAssetsCards(req.projectName, verdicts);
        const rejects = verdicts.filter((v) => !v.accept);
        for (const v of verdicts) {
          if (v.accept) finalRejects.delete(v.file);
        }
        if (rejects.length === 0 || round >= 3) {
          rejects.forEach((v) => finalRejects.add(v.file));
          break;
        }
        // 不採用分だけ再生成（同名pendingを上書き）→ 新しい絵だけ再判定
        const retryShots = rejects
          .map((v) => shotByPending.get(v.file))
          .filter((s): s is PlannedScene => Boolean(s));
        rejects.forEach((v) => finalRejects.add(v.file));
        // 実行中コストガード: 再生成ループも承認額（capYen）の外に出さない
        if (
          job.capYen &&
          (job.spentUsd + retryShots.length * PRICE_TABLE.imageUsd) * usdJpy > job.capYen
        ) {
          job.stepLabel = `コスト上限のため再生成を見送り（${retryShots.length}枚は不採用のまま）`;
          break;
        }
        job.stepLabel = `不採用${retryShots.length}枚を再生成（${round}周目）`;
        checkCancel(id);
        startRun(req.projectName, batch.id, retryShots);
        b = await waitForBatch(id, batch.id, (x) => {
          job.done = x.done;
          job.total = x.total;
          persist();
        });
        job.spentUsd += (retryShots.length - b.failed.length) * PRICE_TABLE.imageUsd;
        toJudge = retryShots
          .map((s) => pendingFileRel(s))
          .filter((rel) => b.generated.includes(rel))
          .map((rel) => {
            const s = shotByPending.get(rel);
            return { rel, prompt: s?.prompt ?? "", purpose: s?.purpose ?? "" };
          });
        if (toJudge.length === 0) break;
      }
      job.failedImages = b.failed.map((f) => f.filename);
      job.rejectedImages = [...finalRejects];
      job.childJobId = null;

      // ---- Step 4.5 confirm + apply（AI判定の結果を反映して確定→行へ割付） ----
      setStep(job, "apply");
      persist();
      confirmJob(req.projectName, b, [...finalRejects]);
      await applyJobToProject(req.projectName, b);
      checkCancel(id);

      // ---- Step 6 の対象選定（適用後の実際の行の絵から） ----
      const freshAfterApply = await loadProject(req.projectName);
      const struct = loadSongStructure(req.projectName);
      const targets = selectI2vTargets(req.mode, plan.scenes, freshAfterApply, struct);

      // ---- Step 5 depth（竹のみ: i2v対象外のシーンにパララックスの下地を作る） ----
      if (req.mode === "take") {
        setStep(job, "depth");
        const i2vImages = new Set(targets.map((t) => t.image));
        const depthTargets = plan.scenes
          .filter((s) => s.assign?.order === 0)
          .map((s) => `images/${pendingFileRel(s).split("/").pop()}`)
          .filter((f) => !i2vImages.has(f))
          .filter((f) => fs.existsSync(path.join(projectDir(req.projectName), f)))
          .filter(
            (f) => !fs.existsSync(path.join(projectDir(req.projectName), depthFileOf(f))),
          );
        job.total = depthTargets.length;
        persist();
        for (const f of depthTargets) {
          checkCancel(id);
          try {
            await generateDepth(req.projectName, f);
          } catch {
            /* 深度は演出の下地。失敗しても本編は成立する */
          }
          job.done++;
          persist();
        }
      }
      checkCancel(id);

      // ---- Step 6 i2v ＋ AI判定（不採用は1回だけ再生成。それでもダメなら静止画のまま） ----
      const i2vResults: { lineId: string; videoFile: string; sourceImage: string }[] = [];
      if (targets.length > 0) {
        setStep(job, "i2v");
        job.total = targets.length;
        persist();
        const clipUsd = (t: I2vTarget) => i2vUnitUsd(i2vModel) * (t.durationSec === 10 ? 2 : 1);
        await runPool(
          targets,
          3,
          async (t) => {
            // 実行中コストガード: 上限に達したら新規クリップを見送る（静止画のまま＝成立する）
            if (job.capYen && (job.spentUsd + clipUsd(t)) * usdJpy > job.capYen) {
              job.i2vRejected.push(`${t.image}（コスト上限で見送り）`);
              job.done++;
              persist();
              return;
            }
            let accepted: string | null = null;
            for (let round = 1; round <= 2 && !accepted; round++) {
              if (isCancelRequested(id)) return;
              // 2周目（不採用の作り直し）も承認額の外に出さない。
              // 1周目の走行中に並列分の実費が積み上がるため、周回ごとに再チェックする
              if (
                round > 1 &&
                job.capYen &&
                (job.spentUsd + clipUsd(t)) * usdJpy > job.capYen
              ) {
                break;
              }
              const ij = startI2v({
                projectName: req.projectName,
                image: t.image,
                prompt: t.motionPrompt,
                model: i2vModel,
                durationSec: t.durationSec,
                lineId: t.lineId,
              });
              children.add(ij.id);
              try {
                const doneJob = await waitForI2v(id, ij.id);
                job.spentUsd += clipUsd(t);
                if (!doneJob.file) continue;
                const verdict = await judgeVideo(
                  req.projectName,
                  job.model,
                  id,
                  doneJob.file,
                  t.image,
                  t.motionPrompt,
                  round,
                );
                appendAssetsCards(req.projectName, [verdict]);
                if (verdict.accept) accepted = doneJob.file;
              } catch (e) {
                if (e instanceof JobCancelledError) return;
                /* 1本の失敗で全体を止めない（静止画のまま続行） */
              } finally {
                children.delete(ij.id);
              }
            }
            if (accepted) {
              i2vResults.push({ lineId: t.lineId, videoFile: accepted, sourceImage: t.image });
            } else {
              job.i2vRejected.push(t.image);
            }
            job.done++;
            persist();
          },
          () => isCancelRequested(id),
        );
        checkCancel(id);

        // 書き戻し（保存直前に再ロード＝走行中の手編集を巻き戻さない流儀）
        if (i2vResults.length > 0) {
          const fresh2 = await loadProject(req.projectName);
          const { lines } = applyI2vResults(fresh2.lines, i2vResults);
          fresh2.lines = lines;
          saveProject(req.projectName, fresh2);
        }
      }
      checkCancel(id);

      // ---- Step 7 suggest（draft=true: 未配役の行への絵の提案も出す） ----
      setStep(job, "suggest");
      const sj = startSuggest(req.projectName, true, job.model);
      job.childJobId = sj.id;
      persist();
      await waitForSuggest(id, sj.id);
      job.childJobId = null;
      checkCancel(id);

      // ---- Step 8 adopt（自動採用＝モード選択時の包括承認。aiSuggestion 層は残る） ----
      setStep(job, "adopt");
      persist();
      const fresh = await loadProject(req.projectName);
      adoptAllSuggestionsInPlace(fresh);
      saveProject(req.projectName, fresh);

      job.phase = "done";
      job.stepLabel = "完了";
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
