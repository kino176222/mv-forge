import "./server-guard";
import fs from "node:fs";
import path from "node:path";
import { migrateLegacyXpNames, mvThemeSchema } from "../schema";
import { themeById, type MvTheme } from "../themes";

/**
 * 自作テーマの永続化（プロジェクト横断・グローバル）。
 * リポジトリ直下の themes.user.json に保存する（gitignore）。
 * 組んだ手札セットを別の曲でも選べる＝複利で効く、を成立させる土台。
 * ※ lib/themes.ts はクライアントからも import されるため、fs 読みはこちらに置く。
 */
const FILE = path.join(process.cwd(), "themes.user.json");

export function loadUserThemes(): MvTheme[] {
  try {
    const raw = migrateLegacyXpNames(JSON.parse(fs.readFileSync(FILE, "utf8")));
    if (!Array.isArray(raw)) return [];
    // 壊れた要素は握りつぶして読めるものだけ返す（1件破損で全滅させない）
    return raw.flatMap((t) => {
      const r = mvThemeSchema.safeParse(t);
      return r.success ? [r.data as MvTheme] : [];
    });
  } catch {
    return [];
  }
}

/** 同一idは上書き。保存後の全一覧を返す。 */
export function saveUserTheme(theme: unknown): MvTheme[] {
  const parsed = mvThemeSchema.parse(theme) as MvTheme;
  const themes = loadUserThemes().filter((t) => t.id !== parsed.id);
  themes.push(parsed);
  fs.writeFileSync(FILE, JSON.stringify(themes, null, 2));
  return themes;
}

export function deleteUserTheme(id: string): MvTheme[] {
  const themes = loadUserThemes().filter((t) => t.id !== id);
  fs.writeFileSync(FILE, JSON.stringify(themes, null, 2));
  return themes;
}

/**
 * サーバ側テーマ解決: 内蔵テーマ（themeById）→ 見つからなければ themes.user.json から探す。
 * AI一括提案の手札クランプ（applySuggestionOutput 第5引数）を自作テーマでも効かせるための入口。
 */
export function resolveThemeWithUser(id: string | null | undefined): MvTheme | null {
  const builtin = themeById(id);
  if (builtin) return builtin;
  if (!id) return null;
  return loadUserThemes().find((t) => t.id === id) ?? null;
}
