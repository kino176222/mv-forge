import type { Project, Short, ShortText } from "./schema";
import { SHORT_TEXT_PRESETS } from "./shorts";

/**
 * AIショート提案の純ロジック層（プロンプト組み立てと幻覚検疫）。
 * サーバー層は lib/shorts-suggest-server.ts。適用はクライアント（store.addShort＝⌘Zで戻せる）。
 */

export interface ShortProposal {
  name: string;
  /** 1始まりの行番号（UI表示用） */
  startLine: number;
  endLine: number;
  /** 検疫済みの行id（適用時はこちらを使う＝行の増減に強い） */
  startLineId: string;
  endLineId: string;
  reason: string;
  /** 検疫済みの歌詞演出id。null=本編のまま */
  lyricAnim: string | null;
  hook: string;
  cta: string;
}

export function buildShortsSuggestPrompt(
  project: Project,
  lyricCatalog: string[],
): string {
  const rows = project.lines.map((l, i) => {
    const t = Math.round((l.startTime + l.offset) * 10) / 10;
    return `- ${i + 1} | [${t}s] ${l.lyricText || "（間奏）"}`;
  });
  return `あなたはSNSショート動画（Reels/Shorts/TikTok）の編集者です。
以下の曲のMVから宣伝用ショート（縦型9:16）を切り抜く設計をしてください。

曲名: ${project.meta.title}
演出方針: ${project.meta.direction || "（指定なし）"}
歌詞（行番号 | [曲内秒] 歌詞）:
${rows.join("\n")}

要件:
- 2〜3案。サビ・イントロの掴み・落ちサビなど、狙いの違う複数フックを提案する
- 冒頭3秒以内にフック（サビ頭・印象的なフレーズ）が来るよう開始行を選ぶ。間奏・前置き始まりは避ける
  （フィード表示直後にスワイプされたかが計測される。フックが遅い曲は開始行を後ろへずらす）
- 各案 15〜45秒目安（60秒以内厳守）。範囲は行番号で指定（startLine〜endLine。endLine行の終わりまで含む）
- hook = 冒頭2〜3秒に出す掴みコピー1行（見た人が続きを見たくなる一言。誇張しすぎない）
- cta = 末尾に出す誘導1行（例「フルはプロフから」）
- lyricAnim = ショート向けの歌詞演出を下のカタログから1つ（本編のままで良ければ null）

歌詞演出カタログ（id: 名前）:
${lyricCatalog.join("\n")}

出力は次のJSONだけ（説明文なし）:
{"proposals":[{"name":"サビ用","startLine":12,"endLine":18,"reason":"なぜこの範囲か","lyricAnim":"lyric-mega","hook":"この曲、最後泣きます","cta":"フルはプロフから"}]}`;
}

/**
 * AI出力の検疫: 行番号の実在・範囲の妥当性・歌詞演出idの実在を機械検証し、
 * 通らないものは理由付きで dropped に落とす（実在しない行id/演出idを絶対に通さない）。
 */
export function sanitizeShortProposals(
  parsed: unknown,
  project: Pick<Project, "lines">,
  lyricAnimIds: Set<string>,
): { proposals: ShortProposal[]; dropped: { summary: string; reason: string }[] } {
  const dropped: { summary: string; reason: string }[] = [];
  const proposals: ShortProposal[] = [];
  const arr = (parsed as { proposals?: unknown[] } | null)?.proposals;
  if (!Array.isArray(arr)) {
    return {
      proposals: [],
      dropped: [{ summary: "提案なし", reason: "AI出力に proposals 配列がありません" }],
    };
  }
  for (const raw of arr.slice(0, 6)) {
    const p = (raw ?? {}) as Record<string, unknown>;
    const name =
      typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 24) : "ショート";
    const s = Number(p.startLine);
    const e = Number(p.endLine);
    if (
      !Number.isInteger(s) ||
      !Number.isInteger(e) ||
      s < 1 ||
      e < s ||
      e > project.lines.length
    ) {
      dropped.push({
        summary: name,
        reason: `行番号が不正です（${String(p.startLine)}〜${String(p.endLine)} / 全${project.lines.length}行）`,
      });
      continue;
    }
    let lyricAnim = typeof p.lyricAnim === "string" && p.lyricAnim ? p.lyricAnim : null;
    if (lyricAnim && !lyricAnimIds.has(lyricAnim)) {
      dropped.push({
        summary: name,
        reason: `存在しない歌詞演出id「${lyricAnim}」→ 本編のままに変更`,
      });
      lyricAnim = null;
    }
    proposals.push({
      name,
      startLine: s,
      endLine: e,
      startLineId: project.lines[s - 1].id,
      endLineId: project.lines[e - 1].id,
      reason: typeof p.reason === "string" ? p.reason.slice(0, 200) : "",
      lyricAnim,
      hook: typeof p.hook === "string" ? p.hook.trim().slice(0, 40) : "",
      cta: typeof p.cta === "string" ? p.cta.trim().slice(0, 40) : "",
    });
    if (proposals.length >= 3) break;
  }
  return { proposals, dropped };
}

/** 採用した提案 → Short 実体（hook/cta はプリセット既定のタイミングで texts に組み立て） */
export function proposalToShort(p: ShortProposal, newId: () => string): Short {
  const texts: ShortText[] = [];
  if (p.hook) texts.push({ id: newId(), text: p.hook, ...SHORT_TEXT_PRESETS.hook });
  if (p.cta) texts.push({ id: newId(), text: p.cta, ...SHORT_TEXT_PRESETS.cta });
  return {
    id: newId(),
    name: p.name,
    range: { startLineId: p.startLineId, endLineId: p.endLineId },
    framingOverrides: {},
    fullFrame: false,
    lyricAnim: p.lyricAnim ? { id: p.lyricAnim, params: {} } : null,
    texts,
  };
}
