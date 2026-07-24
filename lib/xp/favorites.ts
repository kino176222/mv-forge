/**
 * 図鑑・ピッカー共通の「⭐お気に入り」読み取り。
 * 中身の素idが旧名なら現行idへ別名解決してから返す。
 * 書き込みは各コンポーネントが現行キーへ行う（初回保存で自然に移行完了）。
 */
import { resolveXpAliasId } from "./id-aliases";

export const XP_FAVORITES_KEY = "xp-gallery-favorites";

export function readXpFavorites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    let raw = window.localStorage.getItem(XP_FAVORITES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === "string")
      .map((id) => resolveXpAliasId(id));
  } catch {
    return [];
  }
}
