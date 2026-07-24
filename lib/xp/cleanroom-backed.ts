/**
 * cleanroom 実装へ張替え済みの 拡張 素id 集合（純データ・Remotion非依存）。
 *
 * 正本は remotion/effects/xp/cleanroom-ids.json（scripts/extract-cleanroom-ids.mjs が
 * registry-components.ts の実配線から抽出）。統合バッチで張替えたら JSON を再抽出する。
 * bridge の配布フィルタ（XP=0 で cleanroom 実装だけを残す）が使う。
 */
import cleanroomIds from "@/remotion/effects/xp/cleanroom-ids.json";

export const CLEANROOM_BACKED_IDS: ReadonlySet<string> = new Set(
  Object.keys(cleanroomIds),
);

/** 素id / "xp-" prefix 付きid のどちらでも判定 */
export function isCleanroomBacked(id: string): boolean {
  return CLEANROOM_BACKED_IDS.has(id.startsWith("xp-") ? id.slice(3) : id);
}
