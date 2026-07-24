import "./server-guard";
/**
 * AIショート提案のサーバー層。歌詞＋行タイミング→claude CLI（MAX定額）→proposals JSON→検疫。
 * 適用はしない（適用はクライアントの store.addShort＝⌘Zで戻せる）。純ロジックは lib/shorts-suggest.ts。
 * 配管は repair-server と同型（ジョブ永続化・キャンセル・幻覚検疫）。
 */
import { loadProject } from "./projects-server";
import { callLLM, extractJson } from "./llm";
import { EFFECTS } from "../effects-meta";
import { XP_BRIDGED_EFFECTS } from "../xp/bridge";
import { XP_CURATED_LYRICS } from "../xp/curated";
import {
  persistJob,
  isCancelRequested,
  dropHandle,
  JobCancelledError,
} from "./jobs-server";
import {
  buildShortsSuggestPrompt,
  sanitizeShortProposals,
  type ShortProposal,
} from "../shorts-suggest";

export interface ShortsSuggestJob {
  id: string;
  phase: "running" | "done" | "error" | "cancelled";
  proposals: ShortProposal[];
  dropped: { summary: string; reason: string }[];
  error: string | null;
  startedAt: number;
  projectName: string;
}

type G = typeof globalThis & {
  __mvforgeShortsSuggestJobs?: Map<string, ShortsSuggestJob>;
};
const g = globalThis as G;
export function shortsSuggestJobs(): Map<string, ShortsSuggestJob> {
  if (!g.__mvforgeShortsSuggestJobs) g.__mvforgeShortsSuggestJobs = new Map();
  return g.__mvforgeShortsSuggestJobs;
}

export function startShortsSuggest(projectName: string, model: string): ShortsSuggestJob {
  const id = `shorts-suggest-${Date.now().toString(36)}`;
  const job: ShortsSuggestJob = {
    id,
    phase: "running",
    proposals: [],
    dropped: [],
    error: null,
    startedAt: Date.now(),
    projectName,
  };
  shortsSuggestJobs().set(id, job);
  const persist = () =>
    persistJob(projectName, "shorts-suggest", id, job, { request: { model } });
  persist();

  (async () => {
    try {
      const project = await loadProject(projectName);
      if (project.lines.length === 0) throw new Error("歌詞行がありません（先にLRCを取り込んでください）");
      // AIの手札: 自前の歌詞演出 全部 ＋ 拡張はcurated（ショート向けの質を担保しつつプロンプトを軽く）
      const all = [...EFFECTS, ...XP_BRIDGED_EFFECTS];
      const catalog = all
        .filter(
          (e) =>
            e.category === "lyric" &&
            (!e.id.startsWith("xp-") || XP_CURATED_LYRICS.includes(e.id)),
        )
        .map((e) => `${e.id}: ${e.name}`);
      // 検疫は全量セット（curated外でも実在すれば通す＝手札の絞りと実在検証は別物）
      const lyricAnimIds = new Set(
        all.filter((e) => e.category === "lyric").map((e) => e.id),
      );
      const prompt = buildShortsSuggestPrompt(project, catalog);
      const raw = await callLLM(prompt, model, { jobId: id });
      const parsed = extractJson<{ proposals: unknown[] }>(raw);
      const { proposals, dropped } = sanitizeShortProposals(parsed, project, lyricAnimIds);
      job.proposals = proposals;
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
