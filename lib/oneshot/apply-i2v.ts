import type { Line } from "../schema";

/**
 * i2v結果の行への書き戻し（純関数）。
 * - line.image を videos/*.mp4 に差し替え、i2vSource に元静止画を残す（可逆・AI参謀の目にも使う）
 * - videoLoop は schema の既定 "pingpong"（i2v-server が .pp.mp4 を自動生成済み）
 * - 対象行の image が元静止画と一致しない場合はスキップ（走行中の手編集を上書きしない）
 */
export interface I2vApplyItem {
  lineId: string;
  videoFile: string;
  sourceImage: string;
}

export function applyI2vResults(
  lines: Line[],
  results: I2vApplyItem[],
): { lines: Line[]; applied: number; skipped: string[] } {
  const byLineId = new Map(results.map((r) => [r.lineId, r]));
  let applied = 0;
  const skipped: string[] = [];
  const next = lines.map((line) => {
    const r = byLineId.get(line.id);
    if (!r) return line;
    if (line.image !== r.sourceImage) {
      skipped.push(r.videoFile);
      return line;
    }
    applied++;
    const updated = { ...line, image: r.videoFile, i2vSource: r.sourceImage };
    // カット1の絵は line.image と同期している不変条件（cuts[0].image = line.image）
    if (updated.cuts.length > 0 && updated.cuts[0].image === r.sourceImage) {
      updated.cuts = updated.cuts.map((c, i) =>
        i === 0 ? { ...c, image: r.videoFile, i2vSource: r.sourceImage } : c,
      );
    }
    return updated;
  });
  return { lines: next, applied, skipped };
}
