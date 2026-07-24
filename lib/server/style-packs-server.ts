import "./server-guard";
import fs from "node:fs";
import path from "node:path";
import { migrateLegacyXpNames, stylePackSchema, type StylePack } from "../schema";

/**
 * 自作スタイルパックの永続化（プロジェクト横断・グローバル）。
 * リポジトリ直下の style-packs.user.json に保存する（gitignore）。
 * 登録した檻を別の曲でも選べる＝複利で効く、を成立させる土台。
 */
const FILE = path.join(process.cwd(), "style-packs.user.json");

export function loadUserPacks(): StylePack[] {
  try {
    const raw = migrateLegacyXpNames(JSON.parse(fs.readFileSync(FILE, "utf8")));
    if (!Array.isArray(raw)) return [];
    // 壊れた要素は握りつぶして読めるものだけ返す（1件破損で全滅させない）
    return raw.flatMap((p) => {
      const r = stylePackSchema.safeParse(p);
      return r.success ? [r.data] : [];
    });
  } catch {
    return [];
  }
}

/** 同一idは上書き。保存後の全一覧を返す。 */
export function saveUserPack(pack: unknown): StylePack[] {
  const parsed = stylePackSchema.parse(pack);
  const packs = loadUserPacks().filter((p) => p.id !== parsed.id);
  packs.push(parsed);
  fs.writeFileSync(FILE, JSON.stringify(packs, null, 2));
  return packs;
}

export function deleteUserPack(id: string): StylePack[] {
  const packs = loadUserPacks().filter((p) => p.id !== id);
  fs.writeFileSync(FILE, JSON.stringify(packs, null, 2));
  return packs;
}
