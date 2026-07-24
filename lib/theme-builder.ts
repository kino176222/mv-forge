import type { EffectInstance, Project } from "./schema";
import type { MvTheme } from "./themes";
import { effectById } from "./effects-meta";

/**
 * ThemeBuilderDialog のロジック（純関数）。UIから切り離してテスト可能にする。
 * - buildUserTheme: 選んだ手札から MvTheme を組み、defaults を自動導出する
 * - usedEffectIdsByCategory: いまの曲で使われている演出idをカテゴリ別に集める（プリフィル用）
 */

export interface ThemeBuilderInput {
  id: string;
  name: string;
  description?: string;
  policy?: string;
  picks: {
    camera: string[];
    overlay: string[];
    transition: string[];
    lyric: string[];
  };
}

/** id を素のインスタンス（params 空＝描画時に既定値で埋まる）にする */
const inst = (id: string): EffectInstance => ({ id, params: {} });

/** 手札が空のときにテーマへ入れる定型の方針文 */
export const DEFAULT_THEME_POLICY =
  "選んだ手札の中で統一感を最優先。強い演出はサビ・見せ場だけに。";

/**
 * 選んだ手札から自作テーマを組む。
 * defaults 自動導出:
 *  - transition = 切替選択の先頭を params 空でインスタンス化
 *  - cameras    = カメラ選択の先頭2つ
 *  - overlays   = 重ね選択の先頭1つ（空なら []）
 *  - lyricAnim  = 歌詞選択の先頭
 * バリデーション: lyric≥1 と transition≥1 は必須（満たさなければ throw）。
 */
export function buildUserTheme(input: ThemeBuilderInput): MvTheme {
  const { picks } = input;
  const name = input.name.trim();
  if (!name) throw new Error("テーマ名を入力してください");
  if (picks.transition.length < 1)
    throw new Error("切替（トランジション）を1つ以上選んでください");
  if (picks.lyric.length < 1)
    throw new Error("歌詞演出を1つ以上選んでください");

  const policy = input.policy?.trim() ? input.policy.trim() : DEFAULT_THEME_POLICY;

  return {
    id: input.id,
    name,
    description: input.description?.trim() ?? "",
    palette: {
      camera: [...picks.camera],
      overlay: [...picks.overlay],
      transition: [...picks.transition],
      lyric: [...picks.lyric],
    },
    policy,
    defaults: {
      transition: inst(picks.transition[0]),
      cameras: picks.camera.slice(0, 2).map(inst),
      overlays: picks.overlay.slice(0, 1).map(inst),
      lyricAnim: inst(picks.lyric[0]),
    },
  };
}

/**
 * プロジェクトで現在使われている演出idをカテゴリ別に集める（重複排除・出現順）。
 * - line.effects[]: camera / overlay が混在 → effectById(id).category で振り分け
 * - line.transition: transition
 * - line.lyricAnim:  lyric
 * カテゴリ判定は effects-meta の定義に一任する（未知idは無視）。
 */
export function usedEffectIdsByCategory(project: Project): {
  camera: string[];
  overlay: string[];
  transition: string[];
  lyric: string[];
} {
  const sets = {
    camera: new Set<string>(),
    overlay: new Set<string>(),
    transition: new Set<string>(),
    lyric: new Set<string>(),
  };
  const add = (id: string | undefined | null) => {
    if (!id) return;
    const cat = effectById(id)?.category;
    if (cat === "camera") sets.camera.add(id);
    else if (cat === "overlay") sets.overlay.add(id);
    else if (cat === "transition") sets.transition.add(id);
    else if (cat === "lyric") sets.lyric.add(id);
  };
  for (const line of project.lines) {
    for (const e of line.effects) add(e.id);
    add(line.transition?.id);
    add(line.lyricAnim?.id);
  }
  return {
    camera: [...sets.camera],
    overlay: [...sets.overlay],
    transition: [...sets.transition],
    lyric: [...sets.lyric],
  };
}
