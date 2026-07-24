import type { OneshotMode } from "./types";

/**
 * コスト見積（純関数・クライアントからも使う）。
 * ⚠️ PRICE_TABLE は全て推定値。初回実行時に実測して較正する前提（仕様書§9）。
 * 較正までUIでは必ず「概算」と明示すること。
 */

export const PRICE_TABLE = {
  /** GPT Image 2 の1枚あたり（$） */
  imageUsd: 0.06,
  /** i2v モデル別の5秒あたり（$）。10秒は2倍で概算 */
  i2vPerFiveSecUsd: {
    "fal-ai/kling-video/v2.5-turbo/pro/image-to-video": 0.35,
    "fal-ai/bytedance/seedance/v1/lite/image-to-video": 0.2,
  } as Record<string, number>,
  /** 為替の既定値。env MVFORGE_USDJPY はサーバー側で上書き */
  usdJpyDefault: 155,
};

export function i2vUnitUsd(model: string): number {
  return PRICE_TABLE.i2vPerFiveSecUsd[model] ?? 0.35; // 未知モデルは高い方に倒す
}

export interface CostEstimate {
  imageCountMin: number;
  imageCountMax: number;
  clipCountMin: number;
  clipCountMax: number;
  minYen: number;
  maxYen: number;
}

/**
 * 実行前の概算レンジ（シーン計画前なので枚数・本数は曲長からの推定）。
 * - 画像: 曲長÷8〜6秒で1枚、25〜50にクランプ
 * - i2v: 梅=0 / 竹=サビ帯を曲の15〜30%と仮定して5秒クリップ換算 / 松=画像の7〜9割が order 0
 */
export function estimateCost(
  mode: OneshotMode,
  songDurationSec: number,
  i2vModel: string,
  usdJpy = PRICE_TABLE.usdJpyDefault,
): CostEstimate {
  const dur = Math.max(30, songDurationSec || 180);
  const clampImg = (n: number) => Math.min(50, Math.max(25, n));
  const imageCountMin = clampImg(Math.floor(dur / 8));
  const imageCountMax = clampImg(Math.ceil(dur / 6));

  let clipCountMin = 0;
  let clipCountMax = 0;
  if (mode === "take") {
    clipCountMin = Math.ceil((dur * 0.15) / 5);
    clipCountMax = Math.ceil((dur * 0.3) / 5);
  } else if (mode === "matsu") {
    clipCountMin = Math.round(imageCountMin * 0.7);
    clipCountMax = Math.round(imageCountMax * 0.9);
  }

  const unit = i2vUnitUsd(i2vModel);
  const minUsd = imageCountMin * PRICE_TABLE.imageUsd + clipCountMin * unit;
  const maxUsd = imageCountMax * PRICE_TABLE.imageUsd + clipCountMax * unit * 2; // 10秒クリップ混在の上振れ
  return {
    imageCountMin,
    imageCountMax,
    clipCountMin,
    clipCountMax,
    minYen: Math.round(minUsd * usdJpy),
    maxYen: Math.round(maxUsd * usdJpy),
  };
}

export interface PlanCost {
  imageUsd: number;
  i2vUsd: number;
  totalUsd: number;
  totalYen: number;
}

/** Step 3.5 の確定見積: シーン計画確定後、実際の枚数・i2v対象から算出 */
export function planCost(
  sceneCount: number,
  i2vTargets: { durationSec: 5 | 10 }[],
  i2vModel: string,
  usdJpy = PRICE_TABLE.usdJpyDefault,
): PlanCost {
  const unit = i2vUnitUsd(i2vModel);
  const imageUsd = sceneCount * PRICE_TABLE.imageUsd;
  const i2vUsd = i2vTargets.reduce(
    (sum, t) => sum + unit * (t.durationSec === 10 ? 2 : 1),
    0,
  );
  const totalUsd = imageUsd + i2vUsd;
  return { imageUsd, i2vUsd, totalUsd, totalYen: Math.round(totalUsd * usdJpy) };
}

/** コストゲートの上限（既定: 実行前見積maxの1.3倍。超過で confirm 待ちに停止） */
export function capYenOf(estimate: CostEstimate): number {
  return Math.round(estimate.maxYen * 1.3);
}
