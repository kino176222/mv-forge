import "./server-guard";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { projectDir } from "./projects-server";

/**
 * ジョブ（i2v/render/suggest/batch）のファイル永続化とキャンセルの共通基盤。
 * - 各 *-server.ts の in-memory Map は「ライブキャッシュ」としてそのまま残し、
 *   状態遷移点で persistJob() を呼んで <projectDir>/jobs.json に写す
 * - dev再起動で消えた running ジョブは bootId の不一致で検出（sweepOrphans）。
 *   i2v は fal 側の URL を永続化してあるので再ポーリングで課金済み結果を回収できる
 * - キャンセルハンドル（proc / cancelSignal / falのcancel_url）は永続化できないため
 *   globalThis 上のサイドテーブルで管理し、再起動で消えるのは仕様とする
 */

export type JobKind =
  | "i2v"
  | "render"
  | "suggest"
  | "batch"
  | "repair"
  | "shorts-suggest"
  | "oneshot";
export type JobState = "running" | "done" | "error" | "cancelled" | "interrupted";

export interface FalRef {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
  cancelUrl: string;
}

export interface JobRecord<P = unknown> {
  id: string;
  kind: JobKind;
  projectName: string;
  state: JobState;
  createdAt: number;
  updatedAt: number;
  /** 書き込んだサーバープロセスの識別子（孤児検出用） */
  bootId: string;
  /** 既存の I2vJob / RenderJob / SuggestJob / BatchJob をそのまま格納 */
  payload: P;
  /** i2vのみ: fal queue の各URL（再起動後の結果回収・キャンセルに必須） */
  fal?: FalRef;
  /** 開始リクエストの要約（復帰UIの表示用） */
  request?: Record<string, unknown>;
}

interface JobsFile {
  version: 1;
  jobs: JobRecord[];
}

/** キャンセルによる中断を error と区別するための例外 */
export class JobCancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "JobCancelledError";
  }
}

export interface JobHandle {
  cancelRequested: boolean;
  /** kind別のキャンセル実体: proc.kill / remotion cancel() / fal PUT。無ければフラグのみ */
  onCancel: (() => void | Promise<void>) | null;
  /**
   * onCancel（ジョブ所有者が1本だけ持つ）とは別の追加アクション置き場。
   * 親ジョブのハンドルを借りて走る補助プロセス（runClaude等）はこちらに積む。
   * onCancel を上書きすると親のキャンセル連鎖が失われるため、上書きは禁止。
   */
  cancelActions: Set<() => void | Promise<void>>;
}

type G = typeof globalThis & {
  __mvforgeBootId?: string;
  __mvforgeJobHandles?: Map<string, JobHandle>;
  __mvforgeJobsWriteQueue?: Map<string, Promise<void>>;
  __mvforgeJobsLastWrite?: Map<string, number>;
  __mvforgeI2vResumer?: (record: JobRecord) => void;
  __mvforgeBatchRescuer?: (record: JobRecord) => number;
  __mvforgeResumingIds?: Set<string>;
};
const g = globalThis as G;

/** HMRでモジュールが再評価されても変わらない、プロセス単位のID */
export function bootId(): string {
  if (!g.__mvforgeBootId) g.__mvforgeBootId = crypto.randomUUID();
  return g.__mvforgeBootId;
}

function handles(): Map<string, JobHandle> {
  if (!g.__mvforgeJobHandles) g.__mvforgeJobHandles = new Map();
  return g.__mvforgeJobHandles;
}

export function jobHandle(id: string): JobHandle {
  let h = handles().get(id);
  if (!h) {
    h = { cancelRequested: false, onCancel: null, cancelActions: new Set() };
    handles().set(id, h);
  }
  return h;
}

export function isCancelRequested(id: string): boolean {
  return handles().get(id)?.cancelRequested ?? false;
}

/** batch の retry 等、同一 jobId を再スタートする前に必ず呼ぶ（前回フラグの残留対策） */
export function clearCancel(id: string): void {
  const h = handles().get(id);
  if (h) h.cancelRequested = false;
}

export function dropHandle(id: string): void {
  handles().delete(id);
}

/**
 * ハンドルにキャンセルアクションを追加登録する（onCancel を上書きしない）。
 * 戻り値の disposer を処理完了時に呼んで登録を解除すること。
 */
export function addCancelAction(id: string, fn: () => void | Promise<void>): () => void {
  const h = jobHandle(id);
  h.cancelActions.add(fn);
  return () => h.cancelActions.delete(fn);
}

// ---- jobs.json の読み書き ----

const TERMINAL_STATES: JobState[] = ["done", "error", "cancelled", "interrupted"];
const KEEP_MAX = 50;
const KEEP_TERMINAL_MS = 7 * 24 * 60 * 60 * 1000;

function jobsFilePath(projectName: string): string {
  return path.join(projectDir(projectName), "jobs.json");
}

function readJobsFile(projectName: string): JobsFile {
  try {
    const raw = JSON.parse(fs.readFileSync(jobsFilePath(projectName), "utf8"));
    if (raw && Array.isArray(raw.jobs)) return { version: 1, jobs: raw.jobs };
  } catch {
    /* 無い・壊れている → 空から作り直す（ジョブ履歴は消えても致命でない） */
  }
  return { version: 1, jobs: [] };
}

function writeJobsFile(projectName: string, file: JobsFile): void {
  const target = jobsFilePath(projectName);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, target);
}

/** 終端7日超を削除し、running を残しつつ新しい順 KEEP_MAX 件に切り詰める */
function sweep(jobs: JobRecord[]): JobRecord[] {
  const now = Date.now();
  const kept = jobs.filter(
    (j) =>
      !TERMINAL_STATES.includes(j.state) || now - j.updatedAt < KEEP_TERMINAL_MS,
  );
  kept.sort((a, b) => b.createdAt - a.createdAt);
  if (kept.length <= KEEP_MAX) return kept;
  const running = kept.filter((j) => j.state === "running");
  const rest = kept.filter((j) => j.state !== "running").slice(0, KEEP_MAX - running.length);
  return [...running, ...rest].sort((a, b) => b.createdAt - a.createdAt);
}

/** 全書き込みをプロジェクト別 promise チェーンで直列化（read-modify-write は必ずこの中で行う） */
function enqueueWrite(projectName: string, mutate: (file: JobsFile) => void): void {
  if (!g.__mvforgeJobsWriteQueue) g.__mvforgeJobsWriteQueue = new Map();
  const prev = g.__mvforgeJobsWriteQueue.get(projectName) ?? Promise.resolve();
  const next = prev
    .then(() => {
      const file = readJobsFile(projectName);
      mutate(file);
      file.jobs = sweep(file.jobs);
      writeJobsFile(projectName, file);
    })
    .catch((e) => {
      console.error(`[jobs-server] jobs.json 書き込み失敗 (${projectName}):`, e);
    });
  g.__mvforgeJobsWriteQueue.set(projectName, next);
}

/** payload（kind別の status/phase）から正規化 state を導出する */
export function deriveState(kind: JobKind, payload: unknown): JobState {
  const p = payload as { status?: string; phase?: string };
  const s =
    kind === "batch" || kind === "repair" || kind === "shorts-suggest" || kind === "oneshot"
      ? (p.phase ?? "")
      : (p.status ?? "");
  if (["done", "error", "cancelled", "interrupted"].includes(s)) return s as JobState;
  // batch の ready はユーザー確認待ちだが「生きている」扱い（UI側でラベルを変える）
  return "running";
}

export interface PersistOpts {
  state?: JobState;
  fal?: FalRef;
  request?: Record<string, unknown>;
  /** render の onProgress 等、高頻度呼び出し用。前回書き込みからこのms未満ならスキップ */
  throttleMs?: number;
}

export function persistJob(
  projectName: string,
  kind: JobKind,
  id: string,
  payload: unknown,
  opts?: PersistOpts,
): void {
  if (opts?.throttleMs) {
    if (!g.__mvforgeJobsLastWrite) g.__mvforgeJobsLastWrite = new Map();
    const last = g.__mvforgeJobsLastWrite.get(id) ?? 0;
    if (Date.now() - last < opts.throttleMs) return;
  }
  if (!g.__mvforgeJobsLastWrite) g.__mvforgeJobsLastWrite = new Map();
  g.__mvforgeJobsLastWrite.set(id, Date.now());

  // fire-and-forget 内で mutate され続けるオブジェクトなので、この時点の姿を凍結する
  const snapshot = structuredClone(payload);
  const state = opts?.state ?? deriveState(kind, snapshot);
  const now = Date.now();
  enqueueWrite(projectName, (file) => {
    const existing = file.jobs.find((j) => j.id === id);
    if (existing) {
      existing.payload = snapshot;
      existing.state = state;
      existing.updatedAt = now;
      existing.bootId = bootId();
      if (opts?.fal) existing.fal = opts.fal;
      if (opts?.request) existing.request = opts.request;
    } else {
      file.jobs.push({
        id,
        kind,
        projectName,
        state,
        createdAt: now,
        updatedAt: now,
        bootId: bootId(),
        payload: snapshot,
        ...(opts?.fal ? { fal: opts.fal } : {}),
        ...(opts?.request ? { request: opts.request } : {}),
      });
    }
  });
}

export function listPersistedJobs(projectName: string): JobRecord[] {
  return readJobsFile(projectName).jobs;
}

/** 進行中の書き込みキューの完了を待つ（sweep直後のGETが古い内容を返さないように） */
export function flushJobWrites(projectName: string): Promise<void> {
  return g.__mvforgeJobsWriteQueue?.get(projectName) ?? Promise.resolve();
}

export function getPersistedJob(projectName: string, id: string): JobRecord | null {
  return readJobsFile(projectName).jobs.find((j) => j.id === id) ?? null;
}

// ---- キャンセル ----

export async function requestCancel(
  projectName: string,
  id: string,
): Promise<{ ok: boolean; message?: string }> {
  const h = handles().get(id);
  if (h) {
    h.cancelRequested = true;
    // onCancel（所有者の連鎖）と cancelActions（借用者のkill）は独立に全部実行する。
    // 1本の失敗で残りを取りこぼさないよう個別に握りつぶす
    for (const fn of [h.onCancel, ...h.cancelActions]) {
      if (!fn) continue;
      try {
        await fn();
      } catch {
        // fal が IN_PROGRESS 以降で 4xx を返す等。フラグは立っているので
        // 実行ループは次周で止まる。失敗自体は握りつぶす
      }
    }
    return { ok: true };
  }
  // ハンドル不在＝このプロセスに実体が無い（孤児 or 完了済み）。記録だけ整合させる
  const record = getPersistedJob(projectName, id);
  if (!record) return { ok: false, message: "ジョブが見つかりません" };
  if (record.state !== "running") {
    return { ok: false, message: `すでに終了しています（${record.state}）` };
  }
  markInterrupted(projectName, id, "キャンセル要求時に実行プロセスが見つかりませんでした");
  return { ok: true, message: "実行プロセスが見つからないため中断済みとして記録しました" };
}

function markInterrupted(projectName: string, id: string, reason: string): void {
  enqueueWrite(projectName, (file) => {
    const rec = file.jobs.find((j) => j.id === id);
    if (!rec || rec.state !== "running") return;
    rec.state = "interrupted";
    rec.updatedAt = Date.now();
    const p = rec.payload as { status?: string; phase?: string; error?: string | null };
    if (rec.kind === "batch" || rec.kind === "oneshot") p.phase = "interrupted";
    else p.status = "interrupted";
    p.error = reason;
  });
}

// ---- 孤児検出・回収 ----

/** i2v-server 側から復帰関数を登録する（jobs-server → i2v-server の import を作らない） */
export function registerI2vResumer(fn: (record: JobRecord) => void): void {
  g.__mvforgeI2vResumer = fn;
}

/**
 * batch-gen-server 側から「孤児batchの課金済みpending画像を素材帯へ昇格する」救出関数を
 * 登録する（同じくimport逆流を作らない）。返り値=昇格した枚数。
 */
export function registerBatchRescuer(fn: (record: JobRecord) => number): void {
  g.__mvforgeBatchRescuer = fn;
}

/**
 * 別プロセス（旧bootId）が残した running ジョブを検出する。
 * - i2v で fal URL があれば再ポーリングで回収（課金済み結果を捨てない）
 * - それ以外はプロセスごと死んでいるので interrupted に落とす
 * Next.js にサーバー起動フックは無いため、GET /api/jobs 等の読み込み時に遅延実行する。
 */
export function sweepOrphans(projectName: string): void {
  const records = listPersistedJobs(projectName);
  if (!g.__mvforgeResumingIds) g.__mvforgeResumingIds = new Set();
  for (const rec of records) {
    if (rec.state !== "running" || rec.bootId === bootId()) continue;
    if (rec.kind === "i2v" && rec.fal && g.__mvforgeI2vResumer) {
      if (g.__mvforgeResumingIds.has(rec.id)) continue;
      g.__mvforgeResumingIds.add(rec.id);
      // bootId を現行に付け替えて「このプロセスが引き取った」と宣言してから再ポーリング
      persistJob(projectName, "i2v", rec.id, rec.payload, { fal: rec.fal, request: rec.request });
      g.__mvforgeI2vResumer(rec);
    } else {
      // batch は生成済み pending/ が「課金済みなのにUI不可視」の孤児になるため、
      // interrupted に落とす前に素材帯へ機械昇格して救出する（AI判定なし・全採用側に倒す）
      let reason = "サーバー再起動により中断されました。もう一度実行してください";
      if (rec.kind === "batch" && g.__mvforgeBatchRescuer) {
        try {
          const n = g.__mvforgeBatchRescuer(rec);
          if (n > 0) {
            reason = `サーバー再起動により中断されました（課金済みの生成画像${n}枚は素材帯へ確定済み）`;
          }
        } catch {
          // 救出失敗でも中断の記録は行う（pending/ に実体は残っている）
        }
      }
      markInterrupted(projectName, rec.id, reason);
    }
  }
}
