/**
 * 🎬 動画区間の「動き出し」計画（hold モードの心臓部）。
 *
 * 原則: 「できるだけ早く動き出す。ただし区間の最後まで動きが持つ範囲で」（末尾アンカー）
 *   - 実効尺（最大2倍スローまで許容）が区間以上 → 頭から動く（冒頭が動画で始まる）
 *   - 足りない → 動き出し ＝ 区間末 − 実効尺。手前はポスター（生成元静止画）で待機
 * これにより「動きが歌詞の前に尽きて静止画になる」ことも「頭が静止画で間延びする」
 * ことも、素材の尺が許す限り同時に防げる。
 */

/** これ以上遅くするとコマ送り感（ジャダー）が出る下限。品質の壁として維持する */
export const MIN_VIDEO_RATE = 0.5;

export interface HoldPlan {
  /** 再生速度（0.5〜1.0） */
  rate: number;
  /** リタイム後にクリップが持つ長さ（秒） */
  effectiveSec: number;
  /** 区間頭から動き出しまでの待機（秒）。0なら頭から動く */
  leadInSec: number;
}

export function computeHoldPlan(clipSec: number, sectionSec: number): HoldPlan {
  // 区間に合わせて減速（等速より速くはしない・下限より遅くもしない）
  const rate = Math.min(1, Math.max(MIN_VIDEO_RATE, clipSec / sectionSec));
  const effectiveSec = clipSec / rate;
  const leadInSec = Math.max(0, sectionSec - effectiveSec);
  return { rate, effectiveSec, leadInSec };
}
