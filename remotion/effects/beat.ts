/**
 * ビート同期の共通ヘルパー。
 * beats.json（曲内秒の配列）を合成に接続し、エフェクトが「直近ビートからの経過」で
 * 脈動・再発火できるようにする。クロックは Sequence ローカルフレームを曲内時間へ
 * 変換するためのオフセットを持つ（Remotionのフレームは常にSequence相対のため）。
 */

export interface BeatClock {
  /** 曲内秒のビート列（昇順） */
  beats: number[];
  /** 曲内秒の小節頭列（昇順）。プッシュイン等の小節同期カメラ用。無ければ拍から推定 */
  downbeats?: number[];
  /** Sequenceローカルフレーム + offsetFrames = 曲内フレーム */
  offsetFrames: number;
}

/** ローカルフレーム → 曲内秒 */
export function songTime(clock: BeatClock, localFrame: number, fps: number): number {
  return (localFrame + clock.offsetFrames) / fps;
}

/** t 以前で最も近いビートのindex（無ければ -1）。二分探索 */
export function lastBeatIndex(beats: number[], t: number): number {
  let lo = 0;
  let hi = beats.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= t) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return idx;
}

/**
 * ビート瞬間に1へ跳ね、指数減衰する 0..1 のパルス。
 * 揺れの強さ・グロウの明るさ・ズームのキメに掛けて使う。
 */
export function beatPulse(
  clock: BeatClock | null | undefined,
  localFrame: number,
  fps: number,
  decaySec = 0.28,
): number {
  if (!clock || clock.beats.length === 0) return 0;
  const t = songTime(clock, localFrame, fps);
  const idx = lastBeatIndex(clock.beats, t);
  if (idx < 0) return 0;
  return Math.exp(-(t - clock.beats[idx]) / decaySec);
}

/**
 * 直近K拍ぶんの「ビートindexと経過秒」。線の再発火など
 * ビートごとに1回演出を走らせたいエフェクト用。
 */
export function recentBeats(
  clock: BeatClock | null | undefined,
  localFrame: number,
  fps: number,
  k = 3,
): { index: number; elapsed: number }[] {
  if (!clock || clock.beats.length === 0) return [];
  const t = songTime(clock, localFrame, fps);
  const idx = lastBeatIndex(clock.beats, t);
  const out: { index: number; elapsed: number }[] = [];
  for (let i = idx; i >= 0 && out.length < k; i--) {
    out.push({ index: i, elapsed: t - clock.beats[i] });
  }
  return out;
}
