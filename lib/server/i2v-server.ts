import "./server-guard";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { projectDir, projectFile } from "./projects-server";
import { extractLastFrame } from "./video-concat-server";
import {
  persistJob,
  jobHandle,
  isCancelRequested,
  dropHandle,
  registerI2vResumer,
  JobCancelledError,
  type FalRef,
  type JobRecord,
} from "./jobs-server";

/**
 * 🎬 i2v（画像→動画）生成。fal.ai の queue API を直接叩く。
 * generate-image と同じ「キーはVaultに一元管理」の思想（FAL_KEYを共用）。
 * 生成は1〜5分かかるため、render/suggest と同じジョブ＋ポーリング方式。
 * 従量課金のため、falの各URLを jobs.json に永続化し、dev再起動後も結果を回収する。
 */

export interface I2vJob {
  id: string;
  status: "queued" | "generating" | "done" | "error" | "cancelled" | "interrupted";
  /** 完成した動画のプロジェクト相対パス（videos/i2v_xxx.mp4） */
  file: string | null;
  /** 生成元の画像（UI側で行への自動割り当てに使う） */
  sourceImage: string;
  /** 🔗 延長生成: この動画の続き。完了時は「セグメント」だけ保存し、連結はユーザー確認後 */
  extendOf?: string | null;
  /** どの歌詞行からの依頼か（行を離れて戻ったとき進捗UIを復元するため） */
  lineId?: string | null;
  error: string | null;
  startedAt: number;
  projectName: string;
}

type JobsGlobal = typeof globalThis & { __mvforgeI2vJobs?: Map<string, I2vJob> };
const g = globalThis as JobsGlobal;

export function i2vJobs(): Map<string, I2vJob> {
  if (!g.__mvforgeI2vJobs) g.__mvforgeI2vJobs = new Map();
  return g.__mvforgeI2vJobs;
}

const QUEUE_BASE = "https://queue.fal.run";
const POLL_INTERVAL_MS = 5000;
const TIMEOUT_MS = 12 * 60 * 1000; // Kling Proの10秒生成は5分超えがある

/** キーの追加読み込み元（無ければ環境変数のみ） */
let VAULT_ENV: string | null = process.env.MVFORGE_VAULT_ENV ?? null;

export function loadFalKey(): string | null {
  if (process.env.FAL_KEY) return process.env.FAL_KEY.trim();
  if (!VAULT_ENV) return null;
  try {
    const text = fs.readFileSync(VAULT_ENV, "utf8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (t.startsWith("FAL_KEY=")) {
        const val = t.slice("FAL_KEY=".length).trim().replace(/^["']|["']$/g, "");
        if (val) return val;
      }
    }
  } catch {
    /* .env なし → null */
  }
  return null;
}

const IMG_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function toDataUri(abs: string): string {
  const mime = IMG_MIME[path.extname(abs).toLowerCase()] ?? "image/png";
  return `data:${mime};base64,${fs.readFileSync(abs).toString("base64")}`;
}

/** モデルごとの入力スキーマの差を吸収する */
function buildInput(
  model: string,
  imageDataUri: string,
  prompt: string,
  durationSec: 5 | 10,
): Record<string, unknown> {
  if (model.includes("seedance")) {
    return {
      prompt,
      image_url: imageDataUri,
      duration: String(durationSec),
      resolution: "1080p", // MVは1080p書き出しなので720pだと甘くなる
    };
  }
  // Kling 系
  return {
    prompt,
    image_url: imageDataUri,
    duration: String(durationSec),
    negative_prompt: "blur, distort, low quality, text, watermark",
    cfg_scale: 0.5,
  };
}

async function falJson(
  url: string,
  key: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`fal応答がJSONではありません (${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    throw new Error(`fal APIエラー (${res.status}): ${text.slice(0, 300)}`);
  }
  return json;
}

export interface I2vRequest {
  projectName: string;
  /** プロジェクト相対パス（images/xx.png）。extendOf 指定時は無視される（最終コマを使う） */
  image: string;
  /** 動きの指示（英語推奨だが日本語でも通る） */
  prompt: string;
  model: string;
  durationSec: 5 | 10;
  /** 🔗 この動画の続きとして生成（セグメント保存まで。連結はユーザー確認後） */
  extendOf?: string;
  /** 依頼元の歌詞行ID（進捗UIの復元用） */
  lineId?: string;
}

/**
 * 完了までポーリング → 動画DL → videos/ へ保存。
 * startI2v（新規）と resumeI2v（再起動後の回収）の共通部分。
 * 一時的な通信エラー1回で「課金済みの結果」を捨てないよう、連続5回まではリトライ継続。
 */
async function pollAndDownload(
  job: I2vJob,
  fal: FalRef,
  key: string,
  deadline: number,
): Promise<void> {
  let consecutiveFailures = 0;
  for (;;) {
    if (isCancelRequested(job.id)) throw new JobCancelledError();
    if (Date.now() > deadline) {
      throw new Error(
        `生成がタイムアウトしました（12分）。fal側では完了している可能性があります: ${fal.responseUrl}`,
      );
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    let st: Record<string, unknown>;
    try {
      st = await falJson(fal.statusUrl, key);
      consecutiveFailures = 0;
    } catch (e) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 5) {
        throw new Error(
          `状態確認に連続失敗: ${e instanceof Error ? e.message : e}（結果はfal側に残っています: ${fal.responseUrl}）`,
        );
      }
      continue;
    }
    const s = String(st.status ?? "");
    if (s === "COMPLETED") break;
    if (s === "FAILED" || s === "ERROR" || s === "CANCELLED") {
      throw new Error(`fal側で生成に失敗: ${JSON.stringify(st).slice(0, 300)}`);
    }
  }

  const result = await falJson(fal.responseUrl, key);
  const video = result.video as { url?: string } | undefined;
  const videoUrl = video?.url ?? (result.video_url as string | undefined);
  if (!videoUrl) {
    throw new Error(`動画URLが取得できません: ${JSON.stringify(result).slice(0, 300)}`);
  }

  // ダウンロードして videos/ へ保存
  const dl = await fetch(videoUrl);
  if (!dl.ok) throw new Error(`動画ダウンロードに失敗 (${dl.status})`);
  const buf = Buffer.from(await dl.arrayBuffer());
  const videosDir = path.join(projectDir(job.projectName), "videos");
  fs.mkdirSync(videosDir, { recursive: true });
  const stamp = new Date().toISOString().slice(5, 19).replace(/[-:T]/g, "");

  if (job.extendOf) {
    // 🔗 延長生成: セグメントだけ保存して終了。連結はユーザーがプレビューで
    // 確認してから /api/concat-video で行う（品質ガチャの結果を見てから決められる）
    const segDir = path.join(videosDir, "segments");
    fs.mkdirSync(segDir, { recursive: true });
    const segFile = `seg_${stamp}.mp4`;
    fs.writeFileSync(path.join(segDir, segFile), buf);
    job.file = `videos/segments/${segFile}`;
    job.status = "done";
    return;
  }

  const finalFile = `i2v_${stamp}.mp4`;
  fs.writeFileSync(path.join(videosDir, finalFile), buf);

  // 🔁 ピンポン版（順→逆の回文動画）も焼いておく。往復繋ぎ（静止しない既定）や
  // ループが必要なとき、レンダラーはこれを敷く＝「頭にパッと戻る」瞬間が存在しない。
  // 失敗しても本体は使えるので非致命（クロスフェードループにフォールバックされる）。
  try {
    await makePingPong(path.join(videosDir, finalFile));
  } catch (e) {
    console.warn(`[i2v] ピンポン版の生成に失敗（クロスフェードで代替されます）: ${e}`);
  }

  job.file = `videos/${finalFile}`;
  job.status = "done";
}

/** 順再生＋逆再生を連結した回文mp4（xxx.mp4 → xxx.pp.mp4）を生成する */
export function makePingPong(mp4Path: string): Promise<void> {
  const out = mp4Path.replace(/\.mp4$/i, ".pp.mp4");
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      [
        "-y",
        "-i", mp4Path,
        "-filter_complex",
        // 末尾フレームの重複を避けるため逆再生側は先頭1フレームを落とす
        "[0:v]split[a][b];[b]reverse,trim=start_frame=1[r];[a][r]concat=n=2:v=1[v]",
        "-map", "[v]",
        "-an",
        "-c:v", "libx264",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        out,
      ],
      { timeout: 120_000 },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

/** fal のキャンセル（PUT）。IN_PROGRESS 以降は 4xx が返るが、ポーリング側のフラグで止まる */
function registerCancelHandle(job: I2vJob, fal: FalRef, key: string): void {
  jobHandle(job.id).onCancel = async () => {
    await falJson(fal.cancelUrl, key, { method: "PUT" });
  };
}

function finishJob(job: I2vJob, e: unknown): void {
  if (e instanceof JobCancelledError || isCancelRequested(job.id)) {
    job.status = "cancelled";
    job.error =
      "キャンセルしました。fal側で生成が進んでいた場合は課金される可能性があります";
  } else {
    job.status = "error";
    job.error = e instanceof Error ? e.message : String(e);
  }
}

export function startI2v(reqParams: I2vRequest): I2vJob {
  const id = `i2v-${Date.now().toString(36)}`;
  const job: I2vJob = {
    id,
    status: "queued",
    file: null,
    sourceImage: reqParams.image,
    extendOf: reqParams.extendOf ?? null,
    lineId: reqParams.lineId ?? null,
    error: null,
    startedAt: Date.now(),
    projectName: reqParams.projectName,
  };
  i2vJobs().set(id, job);
  const request = {
    image: reqParams.image,
    prompt: reqParams.prompt,
    model: reqParams.model,
    durationSec: reqParams.durationSec,
    extendOf: reqParams.extendOf ?? null,
    lineId: reqParams.lineId ?? null,
  };
  persistJob(reqParams.projectName, "i2v", id, job, { request });

  (async () => {
    let fal: FalRef | undefined;
    try {
      const key = loadFalKey();
      if (!key) {
        throw new Error(`FAL_KEY が見つかりません（環境変数 or ${VAULT_ENV}）`);
      }
      let abs: string;
      if (reqParams.extendOf) {
        // 🔗 延長: 親動画の最終コマを抜き出して元絵にする（つなぎ目が同一画になる）
        const parentAbs = projectFile(reqParams.projectName, reqParams.extendOf);
        if (!fs.existsSync(parentAbs)) {
          throw new Error(`延長元の動画がありません: ${reqParams.extendOf}`);
        }
        const extDir = path.join(projectDir(reqParams.projectName), "images", "i2v-ext");
        fs.mkdirSync(extDir, { recursive: true });
        abs = path.join(extDir, `src_${id}.png`);
        await extractLastFrame(parentAbs, abs);
        job.sourceImage = `images/i2v-ext/src_${id}.png`;
      } else {
        abs = projectFile(reqParams.projectName, reqParams.image);
        if (!fs.existsSync(abs)) throw new Error(`画像がありません: ${reqParams.image}`);
      }

      job.status = "generating";
      const input = buildInput(
        reqParams.model,
        toDataUri(abs),
        reqParams.prompt,
        reqParams.durationSec,
      );
      const submitted = await falJson(`${QUEUE_BASE}/${reqParams.model}`, key, {
        method: "POST",
        body: JSON.stringify(input),
      });
      const statusUrl = String(submitted.status_url ?? "");
      const responseUrl = String(submitted.response_url ?? "");
      if (!statusUrl || !responseUrl) {
        throw new Error(`fal queueの応答が不正です: ${JSON.stringify(submitted).slice(0, 300)}`);
      }
      fal = {
        requestId: String(submitted.request_id ?? ""),
        statusUrl,
        responseUrl,
        cancelUrl: String(submitted.cancel_url ?? ""),
      };
      // 課金が発生した瞬間に fal のURLを永続化（再起動しても結果を回収できるように）
      persistJob(reqParams.projectName, "i2v", id, job, { fal, request });
      if (fal.cancelUrl) registerCancelHandle(job, fal, key);

      await pollAndDownload(job, fal, key, Date.now() + TIMEOUT_MS);
    } catch (e) {
      finishJob(job, e);
    } finally {
      persistJob(reqParams.projectName, "i2v", id, job, fal ? { fal, request } : { request });
      dropHandle(id);
    }
  })();

  return job;
}

/**
 * dev再起動で孤児になった running ジョブの回収。
 * jobs.json に残した fal のURLから再ポーリングし、課金済みの結果をダウンロードする。
 * sweepOrphans（jobs-server）から registerI2vResumer 経由で呼ばれる。
 */
function resumeI2v(record: JobRecord): void {
  const payload = record.payload as I2vJob;
  const fal = record.fal;
  if (!fal) return;
  const job: I2vJob = {
    ...payload,
    id: record.id,
    status: "generating",
    projectName: record.projectName,
  };
  i2vJobs().set(job.id, job);

  (async () => {
    try {
      const key = loadFalKey();
      if (!key) {
        throw new Error(`FAL_KEY が見つかりません（環境変数 or ${VAULT_ENV}）`);
      }
      if (fal.cancelUrl) registerCancelHandle(job, fal, key);
      // 作成から時間が経っていても、回収のために最低3分は粘る
      const deadline = Math.max(record.createdAt + TIMEOUT_MS, Date.now() + 3 * 60 * 1000);
      await pollAndDownload(job, fal, key, deadline);
    } catch (e) {
      finishJob(job, e);
    } finally {
      persistJob(record.projectName, "i2v", job.id, job, {
        fal,
        request: record.request,
      });
      dropHandle(job.id);
    }
  })();
}

registerI2vResumer(resumeI2v);
