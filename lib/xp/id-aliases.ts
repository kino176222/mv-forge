/** 配布版: 旧IDを持つ既存プロジェクトが無いため別名解決は恒等写像 */
export const XP_ID_ALIASES: Record<string, string> = {};
export function resolveXpAliasId(id: string): string {
  return XP_ID_ALIASES[id] ?? id;
}
