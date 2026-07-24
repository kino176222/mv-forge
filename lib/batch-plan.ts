/**
 * 🎬 ショット設計の「見積もり頭脳」＋汎用並列プール（純関数層・fs/spawn禁止）。
 * 不足の定義はここに一本化する: 不足 ＝ image が null の行。
 * プランナーへの枚数指示・歌詞ダイジェスト・カバレッジ表示はすべてこの層から導出する。
 */
import { isStructuredBaseName } from "./image-naming";

/** 1バッチの生成上限。fal.aiの課金とレビュー疲れのバランス点（Kino承認済み） */
export const MAX_SHOTS_PER_BATCH = 50;

/** バッチ生成の同時実行数の既定値。env MVFORGE_GEN_CONCURRENCY で上書き可（resolveGenConcurrency） */
export const DEFAULT_GEN_CONCURRENCY = 6;

/**
 * 同時実行数の解決。1〜12にクランプ（上限はfal.aiのアカウント同時数の保護。
 * 超過してもfailedに溜まって「失敗分だけ再生成」で拾えるが、無駄打ちを防ぐ）
 */
export function resolveGenConcurrency(raw: string | undefined): number {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n)) return DEFAULT_GEN_CONCURRENCY;
  return Math.max(1, Math.min(12, Math.floor(n)));
}

export interface PlanLine {
  id: string;
  image: string | null;
  lyricText: string;
  startTime: number;
  offset: number;
}

export interface Coverage {
  covered: number;
  total: number;
  /** 時系列順（lines配列順）の未配役行ID */
  uncoveredIds: string[];
}

/** 絵の配役状況。「不足」の単一の真実 */
export function coverageOf(lines: Pick<PlanLine, "id" | "image">[]): Coverage {
  const uncoveredIds = lines.filter((l) => !l.image).map((l) => l.id);
  return {
    covered: lines.length - uncoveredIds.length,
    total: lines.length,
    uncoveredIds,
  };
}

/**
 * プランナーに渡す歌詞ダイジェスト（行単位）。
 * 行番号は画面の行テーブルと同じ1始まり（口頭修正コンソールでも同じ番号で指せるようにする）。
 */
export function buildLyricsDigest(lines: PlanLine[]): string {
  return lines
    .map((l, i) => {
      const t = Math.round(Math.max(0, l.startTime + l.offset));
      const mark = l.image ? "[絵あり]" : "[絵なし]";
      return `- ${i + 1} | lineId:${l.id} [${t}s] ${mark} ${l.lyricText || "（間奏・アウトロ）"}`;
    })
    .join("\n");
}

/** プランナープロンプトの枚数ルール1行を組み立てる */
export function planCountRule(count: number, uncovered: number): string {
  if (count > 0) {
    return `ちょうど${count}枚にする（厳守）。[絵なし]の行を優先して埋め、曲の構成（Aメロ/Bメロ/サビ/ラスサビ/アウトロ）を意識して配分する`;
  }
  if (uncovered === 0) {
    return `全行に絵が付いているので、サビ・見せ場のカット割り（order 1+）と差し替え候補を中心に8〜14枚`;
  }
  const base = `[絵なし]の行（${uncovered}行）すべてに order 0 を1枚ずつ割り当てる。さらにサビ・見せ場の行には order 1〜3 のカット割りを追加してよい。合計は最大${MAX_SHOTS_PER_BATCH}枚`;
  if (uncovered >= MAX_SHOTS_PER_BATCH) {
    return `${base}。${MAX_SHOTS_PER_BATCH}枚で埋まらない分は、時系列の早い[絵なし]行から優先して埋める（残りは次のバッチで生成する）`;
  }
  return base;
}

/**
 * shot.filename → 生成ファイルの相対パス（命名の単一の真実。クライアントの表示にも使う）。
 * 新規則（L03_日本語スラッグ / free_〜、lib/image-naming.tsで命名済み）はそのまま、
 * 旧ジョブの英語スラッグは従来どおり gen_ を前置する（永続化済みジョブの後方互換）。
 */
export function shotFileRel(shot: { filename: string }): string {
  const safe =
    shot.filename
      .normalize("NFC")
      .replace(/[^\p{L}\p{N}_-]/gu, "")
      .slice(0, 60) || "shot";
  return isStructuredBaseName(safe)
    ? `images/${safe}.png`
    : `images/gen_${safe}.png`;
}

/**
 * 生成直後の置き場（ステージング）。確定するまで素材帯に出さないための隔離フォルダ。
 * listAssets は images/assets/videos しか走査しないので、置くだけで隔離される。
 */
export function pendingFileRel(shot: { filename: string }): string {
  return `pending/${shotFileRel(shot).split("/").pop()}`;
}

/**
 * 汎用並列プール。limit件ずつ同時実行し、全件の完了を待つ。
 * - shouldStop() が true を返したら以降の新規起動をやめる（走行中の分は待つ）
 * - worker の例外は握りつぶして次へ進む（1枚の失敗で全体を止めない。失敗の記録はworker側の責務）
 */
export async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop?: () => boolean,
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      if (shouldStop?.()) return;
      const i = next++;
      try {
        await worker(items[i], i);
      } catch {
        /* 1件の失敗で他レーンを止めない */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
}
