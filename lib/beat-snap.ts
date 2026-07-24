/**
 * 自動音ハメ（小節頭優先の量子化）の唯一の実装（案3）。
 * store.setLineOffsetSnapped / CutsBlock.snapToBeat / batch-apply の拍スナップは
 * すべてこの純関数に一本化する（磁石の効き幅・小節頭優先ロジックの重複を排す）。
 */

/** 昇順配列 arr の中で t に最も近い値を二分探索で返す。空配列は null。 */
function nearest(arr: number[], t: number): number | null {
  const n = arr.length;
  if (n === 0) return null;
  if (t <= arr[0]) return arr[0];
  if (t >= arr[n - 1]) return arr[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] === t) return arr[mid];
    if (arr[mid] < t) lo = mid + 1;
    else hi = mid - 1;
  }
  // ループ後: hi は t 未満の最大要素、lo は t 超の最小要素（両端は上で処理済み）
  const below = arr[hi];
  const above = arr[lo];
  // 同距離なら手前（小節頭・拍の頭側）を採る
  return t - below <= above - t ? below : above;
}

/**
 * 時刻 t を「小節頭優先」で最寄りの拍位置へ量子化する。
 * - 効き幅 width 内に downbeat があれば、多少遠くても最寄り downbeat へ（拍より優先）。
 * - 無ければ width 内の最寄り beat へ。
 * - どちらも無ければ t のまま（素通し）。
 * beats / downbeats は昇順前提。二分探索で最寄りを引く。
 */
export function snapToMusic(
  t: number,
  data: { beats: number[]; downbeats?: number[] },
  width = 0.35,
): number {
  const nd = nearest(data.downbeats ?? [], t);
  if (nd !== null && Math.abs(nd - t) <= width) return nd;
  const nb = nearest(data.beats, t);
  if (nb !== null && Math.abs(nb - t) <= width) return nb;
  return t;
}
