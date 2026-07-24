/**
 * 拡張テロップの「行（\n）単位の色」対応可否。
 *
 * 対応の実体は cleanroom 家族部品（SubtitleFamilyCR / LowerThirdFamilyCR /
 * TitleGlitchFamilyCR）の lineStyles prop。家族CRへ {...p} で橋渡しされる
 * ポートはすべて対応する。個別実装のうち SubtitleSink01 だけは自前の
 * lineStyles を持つので対応。
 *
 * 下のNOリストは「個別実装で行単位色を持たない」cleanroom テキストの素id
 * （1行前提・文字カスケード等、行の概念が設計に無いもの）。
 * 新しい個別CRを足すときは remotion/effects/xp/cleanroom-adapters.tsx の
 * 個別セクションと突き合わせてここも更新する。
 */

/** mlv-subtitle のうち個別CR実装（家族CRでない）11本 */
import { resolveXpAliasId } from "@/lib/xp/id-aliases";

const NO_LINE_STYLE_MLV = new Set([
  "sub-subtitle-06",
  "sub-subtitle-10",
  "sub-subtitle-13",
  "sub-subtitle-14",
  "sub-subtitle-19",
  "sub-subtitle-23",
  "sub-subtitle-30",
  "sub-subtitle-36",
  "sub-subtitle-39",
  "sub-subtitle-44",
]);

/** title-glitch のうち個別CR実装（家族CRでない）4本 */
const NO_LINE_STYLE_TITLE_GLITCH = new Set([
  "title-signal-glitch-05",
  "title-signal-glitch-16",
  "title-signal-glitch-17",
  "title-signal-glitch-25",
]);

/** ds-* で家族CR（Subtitle/LowerThird）へマップ済みの15本＋自前lineStyles持ちの2897 */
const YES_LINE_STYLE_DS = new Set([
  "title-basic-movements",
  "sub-clean-callout-01",
  "sub-clean-callout-02",
  "sub-credits-01",
  "sub-credits-02",
  "sub-description-01",
  "sub-description-02",
  "sub-description-03",
  "sub-description-04",
  "sub-details",
  "title-music-video-title",
  "sub-retro-music-video-lower3rd",
  "title-retro-music-video-title",
  "sub-subtitle-03",
  "sub-subtitle-05",
  "sub-subtitle-01",
]);

/** 素id / xp- 接頭辞付きのどちらでも判定できる（旧idは別名解決してから判定） */
export function supportsXpLineStyles(id: string): boolean {
  const bare = resolveXpAliasId(id.startsWith("xp-") ? id.slice(3) : id);
  if (bare.startsWith("title-signal-glitch-")) {
    return !NO_LINE_STYLE_TITLE_GLITCH.has(bare);
  }
  if (bare.startsWith("sub-")) {
    return !NO_LINE_STYLE_MLV.has(bare);
  }
  // 残るtitle系は行スタイル対応を個別に確認済みのものだけ（cinematic/kinetic等の
  // 個別実装は全体色のみ対応が混在するため、YESリスト方式）
  return YES_LINE_STYLE_DS.has(bare);
}
