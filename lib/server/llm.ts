import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  AI_PROVIDER_LABELS,
  resolveAiModel,
  type AiProvider,
} from "../ai-models";
import { addCancelAction, isCancelRequested, JobCancelledError } from "./jobs-server";

/**
 * LLM呼び出しの統合レイヤ。モデルIDからプロバイダ（claude / codex / gemini）を
 * 自動判定し、各CLIをヘッドレスで叩いて「最終応答のテキストだけ」を返す。
 * 3CLIとも定額サブスクのログイン方式＝APIキー不要（追加コストゼロ）。
 */

export interface LlmOptions {
  /** 親ジョブのID。キャンセル連鎖（proc.kill）を登録する */
  jobId?: string;
  /** タイムアウト（既定10分） */
  timeoutMs?: number;
  /**
   * AIに見せるローカル画像の絶対パス（プロンプト本文に登場する順）。
   * claude=Readツールで読む / codex=-i で添付 / gemini=未対応（明示エラー）
   */
  images?: string[];
  /** stderrの進捗をジョブログ等へ流すコールバック（直近2000字） */
  onStderr?: (log: string) => void;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Geminiの実体はAntigravity CLI（agy）。
 * Googleが2026-06-18に個人アカウント（無料・AI Pro/Ultra）のGemini CLIを打ち切り、
 * サブスク枠での後継はagyのみ（APIキーは使わない方針）。認証はAntigravity IDEと共有。
 */
function agyCmd(): string {
  const local = path.join(os.homedir(), ".local", "bin", "agy");
  return fs.existsSync(local) ? local : "agy";
}

export async function callLLM(
  prompt: string,
  model: string,
  opts: LlmOptions = {},
): Promise<string> {
  const { provider, cliModel, effort } = resolveAiModel(model);
  const images = opts.images ?? [];
  if (images.length > 0 && provider === "gemini") {
    throw new Error(
      "Gemini CLIは画像入力に未対応です。ClaudeまたはCodexのモデルを選んでください",
    );
  }
  if (provider === "codex") return callCodex(prompt, cliModel, effort, images, opts);
  if (provider === "gemini") return callGemini(prompt, cliModel, opts);
  return callClaude(prompt, cliModel, opts);
}

async function callClaude(prompt: string, cliModel: string, opts: LlmOptions): Promise<string> {
  const args = ["-p", prompt, "--output-format", "json", "--allowedTools", "Read"];
  if (cliModel) args.push("--model", cliModel);
  const out = await runCli("claude", args, opts);
  // claude -p --output-format json は {result: "..."} のエンベロープで返す
  try {
    const envelope = JSON.parse(out);
    if (typeof envelope.result === "string") return envelope.result;
  } catch {
    /* エンベロープでなければ素のテキストとして返す */
  }
  return out;
}

async function callCodex(
  prompt: string,
  cliModel: string,
  effort: string | undefined,
  images: string[],
  opts: LlmOptions,
): Promise<string> {
  const lastMsgFile = path.join(
    os.tmpdir(),
    `mvforge-codex-${crypto.randomUUID()}.txt`,
  );
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--color",
    "never",
    // ユーザーのturn-ended通知フック（GUIアプリ起動等）が毎回発火しないよう無効化
    "-c",
    "notify=[]",
    "--output-last-message",
    lastMsgFile,
  ];
  if (cliModel) args.push("-m", cliModel);
  if (effort) args.push("-c", `model_reasoning_effort="${effort}"`);
  // -i <FILE>... は可変長で後続の位置引数（プロンプト）まで飲み込むため、=連結で1トークンにする
  for (const img of images) args.push(`--image=${img}`);
  // プロンプト本文はclaude前提で「Readツールで見ろ」と書かれていることがある。
  // codexでは同じ画像を添付済みなので、パスを読みに行かせない注記を前置する。
  const finalPrompt =
    images.length > 0
      ? `注: 本文中で「Readツールで見る」よう指示されている画像は、すべてこのメッセージに添付済み（本文に登場するパスと同じ順）。ファイルを読みに行かず、添付画像を見て判断すること。\n\n${prompt}`
      : prompt;
  args.push(finalPrompt);
  try {
    await runCli("codex", args, opts);
    const text = fs.existsSync(lastMsgFile) ? fs.readFileSync(lastMsgFile, "utf8").trim() : "";
    if (!text) throw new Error("codex CLIの応答が空でした");
    return text;
  } finally {
    fs.rmSync(lastMsgFile, { force: true });
  }
}

async function callGemini(prompt: string, cliModel: string, opts: LlmOptions): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const args = ["-p", prompt, `--print-timeout=${Math.ceil(timeoutMs / 1000)}s`];
  if (cliModel) args.push("--model", cliModel);
  try {
    const out = await runCli(agyCmd(), args, opts);
    const text = out.trim();
    if (!text) throw new Error("agy CLIの応答が空でした");
    return text;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/auth|login|credential|sign in|ENOENT/i.test(msg)) {
      throw new Error(
        `${msg} ／ Antigravity CLI（agy）が未インストールか未ログインの可能性があります。` +
          `インストール: curl -fsSL https://antigravity.google/cli/install.sh | bash ／ ログインは Antigravity IDE と共有されます`,
      );
    }
    throw e;
  }
}

/** spawn共通部: タイムアウト・キャンセル連鎖・stderr転送 */
function runCli(
  cmd: string,
  args: string[],
  opts: LlmOptions & { env?: NodeJS.ProcessEnv },
): Promise<string> {
  const { jobId, timeoutMs = DEFAULT_TIMEOUT_MS, onStderr } = opts;
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      env: opts.env ?? { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const disposeCancel = jobId
      ? addCancelAction(jobId, () => {
          proc.kill();
        })
      : null;
    let out = "";
    let err = "";
    proc.stdout.on("data", (c) => (out += c));
    proc.stderr.on("data", (c) => {
      err += c;
      onStderr?.(err.slice(-2000));
    });
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`${cmd} CLI timeout (${Math.round(timeoutMs / 60000)}min)`));
    }, timeoutMs);
    proc.on("error", (e) => {
      clearTimeout(timer);
      disposeCancel?.();
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      disposeCancel?.();
      if (jobId && isCancelRequested(jobId)) return reject(new JobCancelledError());
      if (code !== 0) return reject(new Error(`${cmd} exit ${code}: ${err.slice(-400)}`));
      resolve(out);
    });
  });
}

/** AI応答からJSON本体を取り出す（コードフェンス・前後の説明文を許容） */
export function extractJson<T>(text: string): T {
  let inner = text;
  // 旧claude形式のエンベロープが素通しで来ても剥がせるようにしておく
  try {
    const envelope = JSON.parse(text);
    if (typeof envelope.result === "string") inner = envelope.result;
  } catch {
    /* fallthrough */
  }
  const fence = inner.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : inner;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AI応答からJSONを抽出できませんでした");
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

/**
 * インストール済みAIプロバイダの検出（60秒キャッシュ）。
 * --version が通る＝インストール済み。認証切れは実行時にエラーメッセージで案内する。
 */
type G = typeof globalThis & {
  __mvforgeAiProviders?: { at: number; result: Record<AiProvider, boolean> };
};
const g = globalThis as G;

export async function detectAiProviders(): Promise<Record<AiProvider, boolean>> {
  const cached = g.__mvforgeAiProviders;
  if (cached && Date.now() - cached.at < 60_000) return cached.result;
  const check = (cmd: string) =>
    new Promise<boolean>((resolve) => {
      const proc = spawn(cmd, ["--version"], { stdio: ["ignore", "ignore", "ignore"] });
      const timer = setTimeout(() => {
        proc.kill();
        resolve(false);
      }, 8000);
      proc.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    });
  const [claude, codex, gemini] = await Promise.all([
    check("claude"),
    check("codex"),
    check(agyCmd()),
  ]);
  const result = { claude, codex, gemini };
  g.__mvforgeAiProviders = { at: Date.now(), result };
  return result;
}

export function providerLabel(provider: AiProvider): string {
  return AI_PROVIDER_LABELS[provider];
}
