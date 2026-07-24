/**
 * アーカイブ済みエフェクトid（図鑑・エディタピッカー・AI提案から恒久除外）。
 * 機械生成: scripts/apply-fx-review.mjs が fx-review.json から生成。手で編集しない。
 * 定義 = 明示archive ∪ (clean-status=private かつ clean指定なし)。
 * ファイル本体は残す（復元可能）。除外は7箇所の isArchived() ガードで効かせる。
 */

const XP_PREFIX = "xp-";

export const ARCHIVED_EFFECT_IDS: ReadonlySet<string> = new Set([]);

/** 素id / "xp-" 接頭辞付き のどちらでもアーカイブ判定する */
export function isArchived(id: string | undefined | null): boolean {
  if (!id) return false;
  const bare = id.startsWith(XP_PREFIX) ? id.slice(XP_PREFIX.length) : id;
  return ARCHIVED_EFFECT_IDS.has(bare) || ARCHIVED_EFFECT_IDS.has(id);
}
