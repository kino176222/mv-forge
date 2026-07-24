/**
 * 全体ルックのマスターつまみ（look.intensity）によるパラメータ一括スケール。
 * k=1 で設定値そのまま、k=0 で「素の画」＝中立値。中立値の無いキー
 * （vignette.size や cinescope.ratio など構造的なつまみ）はスケールしない。
 * 純ロジック（React非依存）: テストとUIプレビューからも使う。
 */

type Params = Record<string, number | string>;

/** k=0 のときに一致すべき「効果ゼロ」の値 */
export const NEUTRAL_LOOK_PARAMS: Record<string, Record<string, number>> = {
  "color-grade": {
    exposure: 1,
    contrast: 1,
    saturation: 1,
    temperature: 0,
    tint: 0,
    hue: 0,
  },
  vignette: { amount: 0 },
  "look-aberration": { amount: 0 },
  "film-grain": { intensity: 0 },
  "glitch-vhs": { intensity: 0, jitter: 0 },
  // cinescope は黒帯＝構造なのでスケールしない（入れる/入れないで選ぶ）
};

export function scaleLookParams(id: string, params: Params, k: number): Params {
  if (k >= 1) return params;
  const neutral = NEUTRAL_LOOK_PARAMS[id];
  if (!neutral) return params;
  const out: Params = { ...params };
  for (const [key, base] of Object.entries(neutral)) {
    const v = Number(params[key]);
    if (Number.isNaN(v)) continue;
    out[key] = base + (v - base) * Math.max(0, k);
  }
  return out;
}
