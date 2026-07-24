/**
 * 図鑑（UnifiedGallery）のフリーテキスト検索。
 * haystack = id + 名前 + code + パック + タグライン + 説明（従来フィールド＋id）。
 * id を含めるのは「ds-credits-8zln」のような直指定で1本を出せるようにするため。
 * 空クエリは true（呼び出し側が q.trim() でスキップする前提）。
 */
export interface GallerySearchable {
  id: string;
  name: string;
  code?: string | null;
  pack: string;
  sub?: string | null; // タグライン（拡張）
  description: string;
}

export function matchesGalleryQuery(item: GallerySearchable, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.id, item.name, item.code ?? "", item.pack, item.sub ?? "", item.description]
    .join(" ")
    .toLowerCase()
    .includes(q);
}
