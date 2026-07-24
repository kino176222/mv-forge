import "./server-guard";
import fs from "node:fs";
import path from "node:path";
import { creditPresetSchema, type CreditPreset } from "../credit-presets";
import { migrateLegacyXpNames } from "../schema";

/**
 * 自作クレジットプリセットの永続化（プロジェクト横断・グローバル）。
 * style-packs-server と同方式: リポジトリ直下の credit-presets.user.json に保存する（gitignore）。
 * 一度作り込んだクレジットを別の曲でもワンクリックで差せる＝複利で効く、を成立させる土台。
 * dir 引数はテスト用（既定=process.cwd()）。
 */
const FILE_NAME = "credit-presets.user.json";
const fileFor = (dir?: string) => path.join(dir ?? process.cwd(), FILE_NAME);

export function loadUserCreditPresets(dir?: string): CreditPreset[] {
  try {
    const raw = migrateLegacyXpNames(JSON.parse(fs.readFileSync(fileFor(dir), "utf8")));
    if (!Array.isArray(raw)) return [];
    // 壊れた要素は握りつぶして読めるものだけ返す（1件破損で全滅させない）
    return raw.flatMap((p) => {
      const r = creditPresetSchema.safeParse(p);
      return r.success ? [r.data] : [];
    });
  } catch {
    return [];
  }
}

/** 同一idは上書き。保存後の全一覧を返す。 */
export function saveUserCreditPreset(preset: unknown, dir?: string): CreditPreset[] {
  const parsed = creditPresetSchema.parse(preset);
  const presets = loadUserCreditPresets(dir).filter((p) => p.id !== parsed.id);
  presets.push(parsed);
  fs.writeFileSync(fileFor(dir), JSON.stringify(presets, null, 2));
  return presets;
}

export function deleteUserCreditPreset(id: string, dir?: string): CreditPreset[] {
  const presets = loadUserCreditPresets(dir).filter((p) => p.id !== id);
  fs.writeFileSync(fileFor(dir), JSON.stringify(presets, null, 2));
  return presets;
}
