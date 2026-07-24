import type { EffectInstance } from "./schema";

/**
 * 全体ルックのプリセット（mFilmLook相当の「1クリックでトーン一発」）。
 * 実体は look エフェクトのパラメータ詰め合わせ＝適用後も個別つまみで微調整できる
 * （ブラックボックスにしない）。params は上書き分だけ持ち、残りは resolveParams が
 * デフォルトで埋める。
 */

/** look スタックに入れてよいエフェクト（look カテゴリ＋流用可の overlay） */
export const LOOK_EFFECT_IDS = [
  "color-grade",
  "vignette",
  "look-aberration",
  "film-grain",
  "cinescope",
  "glitch-vhs",
];

export interface LookPreset {
  id: string;
  name: string;
  description: string;
  effects: EffectInstance[];
}

export const LOOK_PRESETS: LookPreset[] = [
  {
    id: "clean",
    name: "クリーン",
    description: "コントラストと彩度をほんの少し締めるだけ。素材の色をそのまま活かす。",
    effects: [
      { id: "color-grade", params: { contrast: 1.06, saturation: 1.08 } },
    ],
  },
  {
    id: "cinematic",
    name: "シネマティック",
    description: "寒色寄り＋締まったコントラスト＋薄ビネット。映画の標準色。",
    effects: [
      {
        id: "color-grade",
        params: { exposure: 0.98, contrast: 1.12, saturation: 1.05, temperature: -18 },
      },
      { id: "vignette", params: { amount: 0.3, size: 60 } },
      { id: "film-grain", params: { intensity: 0.08, size: 1.5 } },
    ],
  },
  {
    id: "cinema-scope",
    name: "シネスコ",
    description: "シネマティック＋黒帯レターボックス。一発で「映画の1カット」にする。",
    effects: [
      {
        id: "color-grade",
        params: { exposure: 0.98, contrast: 1.12, saturation: 1.05, temperature: -16 },
      },
      { id: "film-grain", params: { intensity: 0.1, size: 1.5 } },
      { id: "cinescope", params: {} },
    ],
  },
  {
    id: "vintage",
    name: "ヴィンテージフィルム",
    description: "暖色＋褪せた彩度＋強めのグレイン。古い8mmフィルム・回想・ノスタルジー。",
    effects: [
      {
        id: "color-grade",
        params: { exposure: 1.03, contrast: 0.92, saturation: 0.78, temperature: 28, tint: 6 },
      },
      { id: "film-grain", params: { intensity: 0.3, size: 2.5 } },
      { id: "vignette", params: { amount: 0.45, size: 50 } },
    ],
  },
  {
    id: "vhs",
    name: "VHS",
    description: "色にじみ＋走査線＋くすんだ彩度。90年代のビデオテープ・失われた記録。",
    effects: [
      { id: "color-grade", params: { saturation: 0.85, contrast: 1.05, temperature: 8 } },
      { id: "look-aberration", params: { amount: 3.5 } },
      { id: "glitch-vhs", params: { intensity: 0.3, jitter: 0.25 } },
    ],
  },
  {
    id: "noir",
    name: "ノワール",
    description: "ほぼモノクロ＋強コントラスト＋グレイン。白黒映画・喪失・張り詰めた場面。",
    effects: [
      { id: "color-grade", params: { exposure: 1.02, contrast: 1.25, saturation: 0.05 } },
      { id: "film-grain", params: { intensity: 0.25, size: 2 } },
      { id: "vignette", params: { amount: 0.5, size: 48 } },
    ],
  },
];

export const lookPresetById = (id: string): LookPreset | undefined =>
  LOOK_PRESETS.find((p) => p.id === id);
