import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { callLLM, extractJson } from "../server/llm";
import { projectDir, projectFile, findParentImage, probeDuration } from "../server/projects-server";

const execFileAsync = promisify(execFile);

/**
 * AI判定（④画像・⑤i2v）＝「目のカルテ」assets.json の書き手。
 * - 1回見て、採否とタグを同時に記録する（観察とカルテは同一工程。仕様書§4・§6）
 * - 判定はローカルの claude CLI（MAX定額・--allowedTools Read）＝追加コストゼロ
 * - 動画は直接見られないので、先頭・中間・末尾の代表フレームを抜いて静止画で検品する
 *   （「エモさ」は絵の段階で確定済み。動画判定は破綻検査に限定＝仕様書§7）
 */

export interface AssetVerdict {
  file: string;
  kind: "image" | "video";
  accept: boolean;
  tags: string[];
  reason: string;
  round: number;
  judgedAt: number;
}

interface AssetsFile {
  version: 1;
  updatedAt: number;
  verdicts: AssetVerdict[];
}

/** カルテへ追記（同一fileは最新で置き換え） */
export function appendAssetsCards(projectName: string, verdicts: AssetVerdict[]): void {
  const file = path.join(projectDir(projectName), "assets.json");
  let data: AssetsFile = { version: 1, updatedAt: Date.now(), verdicts: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw && Array.isArray(raw.verdicts)) data = raw;
  } catch {
    /* 無い・壊れている → 新規作成 */
  }
  const byFile = new Map(data.verdicts.map((v) => [v.file, v]));
  for (const v of verdicts) byFile.set(v.file, v);
  data.verdicts = [...byFile.values()];
  data.updatedAt = Date.now();
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/** 判定基準（グローバル既定。mv-plan.json の criteria が入る v2 でここが差し替え点になる） */
export const DEFAULT_CRITERIA = [
  "親画像とキャラクター・画風が一致している（別人・別画風は不採用）",
  "手・顔・体に破綻がない（指の本数・顔の崩れ・不自然な関節）",
  "画面内に文字化け・意味不明な文字列がない",
  "promptの意図した場面・構図になっている",
  // 2026-07-17 ナツヂカラ実運転のKinoフィードバックから昇格（💢マーク・記号の勝手な追加）
  "感情記号（怒りマーク・汗マーク・ハート等）や漫画的な記号が勝手に描き込まれていない",
];

const JUDGE_CHUNK = 12;

export function buildImageJudgePrompt(
  parent: string,
  direction: string,
  criteria: string[],
  items: { path: string; file: string; prompt: string; purpose: string }[],
): string {
  return `あなたはMV用生成画像の品質検品者です。まず親画像（キャラクターと画風の基準）をReadで見て、次に各候補画像をReadで見て、採用/不採用を判定してください。

# 親画像（必ず最初にReadで見ること）
${parent}
${direction.trim() ? `\n# 作品の演出方針\n${direction.trim()}\n` : ""}
# 判定基準（1つでも明確に違反していたら不採用）
${criteria.map((c) => `- ${c}`).join("\n")}
- 迷ったら採用（過剰に落とさない。作品はドラフトであり人間が最後に見る）

# 候補画像（それぞれ必ずReadで見ること）
${items.map((it) => `- file: ${it.file}\n  path: ${it.path}\n  意図: ${it.purpose || it.prompt}`).join("\n")}

# 出力形式（このJSONだけを出力。fileは上の一覧の値をそのまま使う）
{"verdicts": [{"file": "...", "accept": true, "tags": ["顔アップ", "夕暮れ"], "reason": "判定理由を短く"}]}`;
}

/**
 * 画像の一括AI判定。chunkごとに claude を呼び、検疫して返す。
 * 判定が返らなかったファイルは「採用」に倒す（判定失敗で素材を失わない安全側）。
 */
export async function judgeImages(
  projectName: string,
  model: string,
  jobId: string,
  items: { rel: string; prompt: string; purpose: string }[],
  round: number,
): Promise<AssetVerdict[]> {
  const parent = findParentImage(projectName);
  if (!parent || items.length === 0) {
    return items.map((it) => ({
      file: it.rel,
      kind: "image" as const,
      accept: true,
      tags: [],
      reason: parent ? "" : "親画像なしのため判定スキップ（全採用）",
      round,
      judgedAt: Date.now(),
    }));
  }
  const direction = await loadDirection(projectName);
  const out: AssetVerdict[] = [];
  for (let i = 0; i < items.length; i += JUDGE_CHUNK) {
    const chunk = items.slice(i, i + JUDGE_CHUNK);
    const prompt = buildImageJudgePrompt(
      parent,
      direction,
      DEFAULT_CRITERIA,
      chunk.map((it) => ({
        path: projectFile(projectName, it.rel),
        file: it.rel,
        prompt: it.prompt,
        purpose: it.purpose,
      })),
    );
    const valid = new Set(chunk.map((it) => it.rel));
    let verdicts: { file: string; accept?: boolean; tags?: string[]; reason?: string }[] = [];
    try {
      const raw = await callLLM(prompt, model, {
        jobId,
        images: [parent, ...chunk.map((it) => projectFile(projectName, it.rel))],
      });
      verdicts = extractJson<{ verdicts?: typeof verdicts }>(raw).verdicts ?? [];
    } catch {
      /* 判定失敗はチャンクごと採用に倒す（下のフォールバックで拾う） */
    }
    const byFile = new Map(verdicts.filter((v) => valid.has(v.file)).map((v) => [v.file, v]));
    for (const it of chunk) {
      const v = byFile.get(it.rel);
      out.push({
        file: it.rel,
        kind: "image",
        accept: v ? v.accept !== false : true,
        tags: Array.isArray(v?.tags) ? v.tags.filter((t) => typeof t === "string").slice(0, 8) : [],
        reason: typeof v?.reason === "string" ? v.reason : v ? "" : "判定が返らなかったため採用",
        round,
        judgedAt: Date.now(),
      });
    }
  }
  return out;
}

async function loadDirection(projectName: string): Promise<string> {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(projectDir(projectName), "project.json"), "utf8"),
    );
    return typeof raw?.meta?.direction === "string" ? raw.meta.direction : "";
  } catch {
    return "";
  }
}

/** 動画から先頭・中間・末尾の代表フレームを抜く（判定後に呼び出し側が破棄） */
export async function extractJudgeFrames(
  projectName: string,
  videoRel: string,
): Promise<string[]> {
  const abs = projectFile(projectName, videoRel);
  const dur = await probeDuration(projectName, videoRel);
  const times = dur > 0.5 ? [0.05, dur / 2, Math.max(0.1, dur - 0.4)] : [0.05];
  const outDir = path.join(projectDir(projectName), "pending", "judge");
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.basename(videoRel).replace(/\.[^.]+$/, "");
  const frames: string[] = [];
  for (let i = 0; i < times.length; i++) {
    const out = path.join(outDir, `${base}_f${i}.png`);
    await execFileAsync(
      "ffmpeg",
      ["-y", "-ss", String(times[i]), "-i", abs, "-frames:v", "1", out],
      { timeout: 60_000 },
    );
    frames.push(out);
  }
  return frames;
}

/**
 * i2v動画のAI判定（破綻検査）: 元静止画と代表フレームを見比べて、
 * キャラ崩壊・溶け・意図しないモーフィングが無いかだけを見る。
 */
export async function judgeVideo(
  projectName: string,
  model: string,
  jobId: string,
  videoRel: string,
  sourceImageRel: string,
  motionPrompt: string,
  round: number,
): Promise<AssetVerdict> {
  let frames: string[] = [];
  try {
    frames = await extractJudgeFrames(projectName, videoRel);
  } catch {
    return {
      file: videoRel,
      kind: "video",
      accept: true,
      tags: [],
      reason: "フレーム抽出に失敗したため採用（人間がゲート2で確認）",
      round,
      judgedAt: Date.now(),
    };
  }
  try {
    const prompt = `あなたはMV用i2v動画の品質検品者です。元静止画と、動画から抜いた代表フレーム（時系列順）をReadで見比べて、採用/不採用を判定してください。

# 元静止画（採用済みの正）
${projectFile(projectName, sourceImageRel)}

# 動画の代表フレーム（先頭→中間→末尾の順。必ず全部Readで見ること）
${frames.map((f, i) => `${i + 1}. ${f}`).join("\n")}

# 動きの指示（参考）
${motionPrompt || "（指定なし）"}

# 判定基準（動画は「壊れ物検査」に限定。エモさは元静止画で確定済み）
- 元静止画からキャラクター・画風が崩れていない（顔が溶ける・別人化は不採用）
- 手足・体の破綻、不自然なモーフィングがない
- 元静止画に無い火・爆発・煙・発光・感情記号（💢等）が発生していたら不採用（i2vの典型的な暴走）
- ボール・メガホン等の小物が物理的に不自然な動き・軌道をしていたら不採用
- 末尾フレームだけ崩れている場合も不採用（=再生成対象）
- 迷ったら採用

# 出力形式（このJSONだけを出力）
{"accept": true, "tags": ["ゆっくりズーム"], "reason": "短く"}`;
    const raw = await callLLM(prompt, model, {
      jobId,
      images: [projectFile(projectName, sourceImageRel), ...frames],
    });
    const v = extractJson<{ accept?: boolean; tags?: string[]; reason?: string }>(raw);
    return {
      file: videoRel,
      kind: "video",
      accept: v.accept !== false,
      tags: Array.isArray(v.tags) ? v.tags.filter((t) => typeof t === "string").slice(0, 8) : [],
      reason: typeof v.reason === "string" ? v.reason : "",
      round,
      judgedAt: Date.now(),
    };
  } catch {
    return {
      file: videoRel,
      kind: "video",
      accept: true,
      tags: [],
      reason: "判定が返らなかったため採用（人間がゲート2で確認）",
      round,
      judgedAt: Date.now(),
    };
  } finally {
    for (const f of frames) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* 消せなくても致命でない */
      }
    }
  }
}
