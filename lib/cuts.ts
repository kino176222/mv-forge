import type { Cut, Line } from "./schema";

/**
 * ✂️✂️ カット割りの導出層（平屋の原則: lines[] から毎回導出、独立データ無し）。
 *
 * Lv.1（行直付けトリム）と Lv.2（cuts[] カット列）を、レンダラー/UIが単一の
 * 「配置済みカット列」として扱えるよう正規化する。
 * - cuts が空 → 行直付けフィールド（image・videoTrim系・videoLoop等）から単一カットを合成
 *   ＝ Lv.1 は Lv.2 の縮退形。出荷済みトリムがそのままカット割りの部品になる。
 * - cuts あり → at 昇順に区間へ配置し、区間からはみ出すカットは落とす（防御）。
 */

export interface PlacedCut {
  cut: Cut;
  /** 区間頭からの開始秒（クランプ済み） */
  startSec: number;
  /** このカットの表示尺（次カットの at まで。最終カットは区間末まで） */
  durationSec: number;
}

/** 区間頭行 + 区間尺 → 配置済みカット列。必ず1件以上返る（image無し行は呼ばない前提） */
export function deriveSectionCuts(head: Line, sectionSec: number): PlacedCut[] {
  if (!head.image) return [];
  if (head.cuts.length === 0) {
    return [
      {
        cut: {
          id: `${head.id}-cut0`,
          image: head.image,
          i2vSource: head.i2vSource,
          at: 0,
          trimStart: head.videoTrimStart,
          trimEnd: head.videoTrimEnd,
          videoLoop: head.videoLoop,
          videoRate: head.videoRate,
          videoAnchor: head.videoAnchor,
          frameScale: head.frameScale,
          frameX: head.frameX,
          frameY: head.frameY,
          credit: null, // 1枚のときのショットクレジットは行クレジット（line.credit）を使う
        },
        startSec: 0,
        durationSec: sectionSec,
      },
    ];
  }
  // at 昇順・区間内のみ・at重複は後勝ちで1/30秒ずらす（防御的正規化）
  const sorted = [...head.cuts].sort((a, b) => a.at - b.at);
  const placed: PlacedCut[] = [];
  for (const cut of sorted) {
    const startSec = Math.max(0, cut.at);
    if (startSec >= sectionSec) continue; // 区間縮小ではみ出したカットは描画しない
    const prev = placed[placed.length - 1];
    if (prev && startSec <= prev.startSec) continue; // at重複/逆行は無視
    placed.push({ cut, startSec, durationSec: 0 });
  }
  if (placed.length === 0) return deriveSectionCuts({ ...head, cuts: [] }, sectionSec);
  // 尺を確定（次カットの開始まで／最終は区間末まで）
  for (let i = 0; i < placed.length; i++) {
    const next = placed[i + 1];
    placed[i].durationSec = (next ? next.startSec : sectionSec) - placed[i].startSec;
  }
  return placed;
}
