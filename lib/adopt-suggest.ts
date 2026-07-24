import type { EffectInstance, Project } from "./schema";

/**
 * AI提案（aiSuggestion 層）→ 決定値へのコピー規則の単一の真実。
 * - クライアント: store.adoptAllSuggestions（「全部採用」ボタン）
 * - サーバー: 一発出しモード Step 8（自動採用）
 * の両方がこれを呼ぶ（片方だけ直る二重管理事故の防止）。
 *
 * 規則:
 * - 画像: 提案があり、かつ行にまだ絵が無いときだけ入れる（手作業の配置は上書きしない）
 * - effects / transition / lyricAnim: 提案があれば決定値へコピー
 * - aiSuggestion 層自体は消さない（後から個別に revert できる）
 */
export function adoptAllSuggestionsInPlace(p: Project): void {
  p.lines.forEach((line) => {
    const s = line.aiSuggestion;
    if (!s) return;
    if (s.imageFile && !line.image) line.image = s.imageFile;
    if (s.effects.length > 0) line.effects = structuredClone(s.effects) as EffectInstance[];
    if (s.transition) line.transition = structuredClone(s.transition);
    if (s.lyricAnim) line.lyricAnim = structuredClone(s.lyricAnim);
  });
}
