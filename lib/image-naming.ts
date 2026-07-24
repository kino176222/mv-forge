/**
 * 生成画像の命名規則（純関数層・fs禁止）。
 * 規則（2026-07-06 Kino承認）:
 *   行あて       L03_蛍光灯の下で見上げる.png   … Lは行番号（1始まり・ゼロ埋め2桁）
 *   カット割り   L03c2_ドラムに吸い込まれる.png … c2=その行の2カット目（order1）
 *   自由素材     free_夜明けの螺旋階段.png
 *   衝突         _v2, _v3 … を自動付与
 * スラッグは日本語OK（プロジェクトフォルダ名が日本語で実証済み）。
 * ファイル名のL番号は「生まれた時の行」のラベル。参照の実体は project.json 側が持つので
 * 後から行がズレても壊れない（名前は目印に徹する）。
 */

/** ファイル名スラッグの浄化: 文字・数字だけ残す（日本語OK）。空白・記号・パス文字は除去 */
export function sanitizeSlug(raw: string | undefined | null, max = 14): string {
  if (!raw) return "";
  const cleaned = raw
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]/gu, ""); // 空白・句読点・/\:*?"<>|. 等を一掃
  return Array.from(cleaned).slice(0, max).join("");
}

/** 行番号のゼロ埋め（2桁。100行超はそのまま3桁） */
export function padLineNo(no: number): string {
  return String(Math.max(1, Math.floor(no))).padStart(2, "0");
}

/**
 * ベース名（拡張子なし）を組み立てる。
 * lineNo なし=自由素材（free_）。order は batch の assign.order（0=行の絵、1+=カット割り）。
 */
export function imageBaseName(opts: {
  lineNo?: number;
  order?: number;
  slug: string;
}): string {
  const slug = opts.slug || "場面";
  if (opts.lineNo === undefined) return `free_${slug}`;
  const cut = (opts.order ?? 0) >= 1 ? `c${(opts.order ?? 0) + 1}` : "";
  return `L${padLineNo(opts.lineNo)}${cut}_${slug}`;
}

/** taken と重複しないベース名にする（_v2, _v3…）。採用した名前は taken に追加する */
export function uniqueBaseName(base: string, taken: Set<string>): string {
  let name = base;
  for (let v = 2; taken.has(name.normalize("NFC")); v += 1) name = `${base}_v${v}`;
  taken.add(name.normalize("NFC"));
  return name;
}

/**
 * プラン直後のショット群にファイル名を機械的に振り直す（AIに番号を任せない）。
 * - AIのfilename（日本語場面名）はスラッグとしてだけ使い、L番号/c番号/free_はここで前置
 * - 既存素材（existingBases=拡張子なし）とバッチ内の重複は _v2 で回避
 */
export function renameShots<
  T extends { filename: string; purpose?: string; assign?: { lineId: string; order: number } },
>(shots: T[], lineNoById: Map<string, number>, existingBases: Iterable<string>): T[] {
  const taken = new Set(
    Array.from(existingBases, (b) => b.normalize("NFC")),
  );
  return shots.map((shot) => {
    const slug =
      sanitizeSlug(shot.filename) || sanitizeSlug(shot.purpose) || "場面";
    const lineNo = shot.assign ? lineNoById.get(shot.assign.lineId) : undefined;
    const base = imageBaseName({ lineNo, order: shot.assign?.order, slug });
    return { ...shot, filename: uniqueBaseName(base, taken) };
  });
}

/** 新規則のベース名か（L03_ / L03c2_ / free_）。旧gen_系との分岐に使う */
export function isStructuredBaseName(name: string): boolean {
  return /^(L\d{2,}(c\d+)?_|free_)/.test(name);
}
