/**
 * ブラウザの queryLocalFonts() 結果を、テロップ様式のフォント選択UI用に
 * 整理する純関数群（Remotion非依存・DOM非依存＝テスト可能）。
 *
 * ねらい: Morisawa 等でアクティベート済みの書体を、検索せずとも
 * ドロップダウンに「見える」状態で並べる。判定はあくまで並び順のためで、
 * 外れた書体も「その他」に必ず載る（＝一覧から消えない）。
 */

// Morisawa 製品の命名規則（A-OTF / A P-OTF / G-OTF / A-SK / A-CID …）。
// スクショの実書体名（A P-OTF A1明朝, A-OTF UD新ゴ, G-OTF 筆順, A-SK けんじ隷書）で確認済み。
const MORISAWA_PREFIX = /^(A-?OTF|A\s?P-?OTF|AP-?OTF|G-?OTF|A-?SK|A-?CID|MO-|RoG)/i;
// プレフィックスが化けても拾えるよう、Morisawa 定番の書体名キーワードも補助的に判定。
const MORISAWA_KEYWORD =
  /(秀英|翠流|ラピス|新ゴ|リュウミン|じゅん|太ミン|見出|中ゴ|太ゴ|タイポス|A1明朝|ゴシックMB)/;

export function isMorisawaLike(family: string): boolean {
  return MORISAWA_PREFIX.test(family) || MORISAWA_KEYWORD.test(family);
}

export interface OrganizedFonts {
  morisawa: string[];
  others: string[];
}

/** 重複除去 → ja ソート → Morisawa/その他 に分離。全書体が必ずどちらかに入る。 */
export function organizeLocalFonts(families: string[]): OrganizedFonts {
  const uniq = [...new Set(families.filter((f) => f && f.trim()))];
  uniq.sort((a, b) => a.localeCompare(b, "ja"));
  return {
    morisawa: uniq.filter(isMorisawaLike),
    others: uniq.filter((f) => !isMorisawaLike(f)),
  };
}

/** localStorage に退避した一覧の復元（壊れた入力でも落ちず []）。 */
export function parseFontCache(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

export const LOCAL_FONTS_CACHE_KEY = "mvforge:localFonts";
