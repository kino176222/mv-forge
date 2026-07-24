import type { Project, StylePack } from "./schema";
import { mergeTextStyle } from "./schema";
import { lookPresetById } from "./look-presets";

/**
 * スタイルパック＝1曲を貫く「見た目の型」。フォント・色・ルックを1セットに束ねて
 * プロジェクトへ被せる。適用は meta.textStyle / project.look へ流し込むだけ＝適用後も
 * 既存つまみで微調整でき、行ごとの上書きは残る（非破壊）。
 * 動き（テーマ）と濃さ（suggestMode）は檻で縛らず、推奨初期値として持つだけ＝
 * 適用時の出発点を配り、後からユーザーが自由に変えられる。
 *
 * 内蔵パックは「型」の出発点。使うときに色等を微調整し、名前を付けて保存＝自作パック登録。
 */

export const STYLE_PACKS: StylePack[] = [
  {
    id: "cinema-mincho",
    name: "シネマ明朝",
    // バラード・切ない・文学的。寒色シネマルック＋細明朝、動きは静か。
    textStyle: { font: "shippori-mincho", color: "#f5f3ee", strokeColor: "#0a0a12", strokeWidth: 4, shadow: 0.7 },
    palette: ["#f5f3ee", "#8fa6c4", "#0a0a12"],
    lookPreset: "cinematic",
    recommendedTheme: "emo",
    recommendedMode: "simple",
  },
  {
    id: "neon-city",
    name: "ネオン都市",
    // 都会・夜・無機質。極細ゴシック＋にじみ、映画的な流れ。
    textStyle: { font: "noto-sans-jp-thin", color: "#eafcff", strokeColor: "#05010a", strokeWidth: 3, shadow: 0.5 },
    palette: ["#eafcff", "#ff4dd2", "#05010a"],
    lookPreset: "vhs",
    recommendedTheme: "cinema",
    recommendedMode: "standard",
  },
  {
    id: "retro-film",
    name: "レトロフィルム",
    // 回想・郷愁・大正浪漫。装飾明朝＋褪せた暖色フィルム、動きはふわっと。
    textStyle: { font: "kaisei-decol", color: "#fff4e0", strokeColor: "#3a2a12", strokeWidth: 4, shadow: 0.6 },
    palette: ["#fff4e0", "#d9a441", "#3a2a12"],
    lookPreset: "vintage",
    recommendedTheme: "emo",
    recommendedMode: "simple",
  },
  {
    id: "pop-band",
    name: "ポップバンド",
    // 青春・疾走・等身大。太ゴシック＋クリーン、動きは弾む・跳ねる。
    textStyle: { font: "rocknroll-one", color: "#ffffff", strokeColor: "#101010", strokeWidth: 6, shadow: 0.5 },
    palette: ["#ffffff", "#ff5252", "#101010"],
    lookPreset: "clean",
    recommendedTheme: "pop",
    recommendedMode: "rich",
  },
];

export const stylePackById = (id: string): StylePack | undefined =>
  STYLE_PACKS.find((p) => p.id === id);

/**
 * パックを適用（in-place）。immer の draft でもそのまま使えるよう、
 * clone するのは pack/preset（プレーンな値）だけで project 自体は触らない。
 * meta.textStyle にパックの textStyle を部分マージ、project.look に lookPreset を反映、
 * meta.stylePack に記録。lines は一切触らない（非破壊。出方の一貫はAI提案で埋める）。
 */
export function applyStylePackInPlace(project: Project, pack: StylePack): void {
  project.meta.textStyle = mergeTextStyle(project.meta.textStyle, pack.textStyle);
  project.meta.stylePack = structuredClone(pack);
  const preset = pack.lookPreset ? lookPresetById(pack.lookPreset) : undefined;
  if (preset) {
    project.look.preset = pack.lookPreset;
    project.look.effects = structuredClone(preset.effects);
  }
  // 濃さの推奨初期値を流し込む（project永続なのでlib層でOK。以後ユーザーが自由に変えられる）。
  // テーマ（recommendedTheme）の流し込みはUI層（localStorage）の責務なのでここではやらない。
  if (pack.recommendedMode) project.meta.suggestMode = pack.recommendedMode;
}

/** 純関数版（入力は変異しない）。テスト・非immer経路から使う。 */
export function applyStylePack(project: Project, pack: StylePack): Project {
  const next: Project = structuredClone(project);
  applyStylePackInPlace(next, pack);
  return next;
}

/**
 * 現在のプロジェクト設定を、名前を付けて「自作パック」としてスナップショット。
 * 見た目（フォント・色・look）＋動き/濃さの推奨初期値を1つに束ねる（登録の中身）。
 * currentThemeId は今選んでいるテーマid（UI層が持つ）。空でなければ recommendedTheme に焼く。
 */
export function packFromProject(
  project: Project,
  id: string,
  name: string,
  currentThemeId = "",
): StylePack {
  const ts = project.meta.textStyle;
  const active = project.meta.stylePack;
  return {
    id,
    name,
    textStyle: {
      font: ts.font,
      color: ts.color,
      strokeColor: ts.strokeColor,
      strokeWidth: ts.strokeWidth,
      shadow: ts.shadow,
    },
    palette: active?.palette ?? [ts.color, ts.strokeColor],
    lookPreset: project.look.preset,
    // 推奨初期値のスナップショット（檻ではない。適用先での出発点として保存）
    ...(currentThemeId ? { recommendedTheme: currentThemeId } : {}),
    recommendedMode: project.meta.suggestMode,
  };
}

/** パックを外す（見た目の型の記録を消す）。textStyle/look は残す＝見た目を戻すのは Undo。純関数。 */
export function removeStylePack(project: Project): Project {
  const next: Project = structuredClone(project);
  next.meta.stylePack = null;
  return next;
}
