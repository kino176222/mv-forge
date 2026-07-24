/**
 * プッシュイン（小節同期カメラ）の窓計算＋パン方向ベクトルの純関数。
 * Camera.tsx とテストの両方から使う。Date/乱数を使わない完全な決定論。
 *
 * 「区間の頭または最後で、小節にそろえた決まった長さだけグッと寄って止まる」を
 * 実現するために、ビート情報（downbeats=小節頭 / beats=拍）から
 *   - 1小節の秒数（barSec）
 *   - 寄る長さ（durSec）
 *   - 発火・到達のタイミング（startSec）
 * を区間相対秒で返す。
 */

export interface PushInWindowInput {
  /** 区間の長さ（秒） */
  sectionDurSec: number;
  /** 区間頭の曲内秒 */
  sectionStartSongSec: number;
  /** 小節頭（曲内秒・昇順） */
  downbeats?: number[];
  /** ビート（曲内秒・昇順） */
  beats?: number[];
  /** head=区間の頭で寄る / tail=区間の最後で寄る（次へのため） */
  timing: "head" | "tail";
  /** 寄る長さ（小節数） */
  bars: number;
}

/** 区間相対秒での寄りの窓 */
export interface PushInWindow {
  startSec: number;
  durSec: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 昇順ソートして中央値（偶数個は中央2つの平均）。空は0 */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  const mid = n >> 1;
  return n % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 隣接要素の差（間隔）の配列 */
function adjacentIntervals(arr: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < arr.length; i++) out.push(arr[i] - arr[i - 1]);
  return out;
}

/**
 * 1小節の秒数。
 *   downbeats≥2 → 隣接間隔の中央値
 *   なければ beats≥2 → 隣接間隔の中央値×4
 *   それも無ければ 2.0
 * 最後に 0.8〜6.0 へ clamp。
 */
export function barSecOf(downbeats?: number[], beats?: number[]): number {
  let barSec = 2.0;
  if (downbeats && downbeats.length >= 2) {
    barSec = median(adjacentIntervals(downbeats));
  } else if (beats && beats.length >= 2) {
    barSec = median(adjacentIntervals(beats)) * 4;
  }
  return clamp(barSec, 0.8, 6.0);
}

/**
 * プッシュインの窓（区間相対秒）を求める。
 * head: 区間開始以降で最初のdownbeatを発火点に。ただし2小節以内に無ければ区間頭(0)発火。
 *       start+durが区間を超えるならstartを前へ詰める（最小0）。
 * tail: 区間内最後のdownbeat（sectionEnd+0.05まで許容）に寄りきる。無ければ区間末尾。
 *       start=max(0, 到達点−dur)、dur=到達点−start（「次の区間頭ぴったりに寄りきる＝ため」）。
 */
export function pushInWindow(input: PushInWindowInput): PushInWindow {
  const { sectionDurSec, sectionStartSongSec, downbeats, beats, timing, bars } =
    input;
  const barSec = barSecOf(downbeats, beats);
  const durSec = clamp(bars * barSec, 0.4, Math.max(0.4, sectionDurSec));
  const sectionEndSong = sectionStartSongSec + sectionDurSec;
  const db = downbeats ?? [];

  if (timing === "tail") {
    // 区間内（sectionEnd+0.05まで許容）の最後のdownbeat。無ければ区間末尾。
    let found: number | null = null;
    for (const d of db) {
      if (d >= sectionStartSongSec && d <= sectionEndSong + 0.05) {
        if (found === null || d > found) found = d;
      }
    }
    const reach = found !== null ? found - sectionStartSongSec : sectionDurSec;
    const startSec = Math.max(0, reach - durSec);
    return { startSec, durSec: reach - startSec };
  }

  // head: 区間開始以降で最初（最小）のdownbeat
  let firstRel: number | null = null;
  for (const d of db) {
    if (d >= sectionStartSongSec) {
      const rel = d - sectionStartSongSec;
      if (firstRel === null || rel < firstRel) firstRel = rel;
    }
  }
  // 2小節以内にあればそこで発火、無ければ区間頭発火
  let startSec = firstRel !== null && firstRel <= 2 * barSec ? firstRel : 0;
  // 区間超過なら前へ詰める
  if (startSec + durSec > sectionDurSec) {
    startSec = Math.max(0, sectionDurSec - durSec);
  }
  return { startSec, durSec };
}

/**
 * パンの方向ベクトル（単位）。
 * left→{x:-1,y:0} / right→{x:1,y:0} / up→{x:0,y:-1} / down→{x:0,y:1} / 不明→left扱い。
 * 画面座標系なので up は y 負（上へ）、down は y 正（下へ）。
 */
export function panVector(direction: string): { x: number; y: number } {
  switch (direction) {
    case "right":
      return { x: 1, y: 0 };
    case "up":
      return { x: 0, y: -1 };
    case "down":
      return { x: 0, y: 1 };
    case "left":
    default:
      return { x: -1, y: 0 };
  }
}
