/**
 * 2.5Dパララックスのカメラ計算（DepthFlow公式のカメラモデルに準拠）。
 * ParallaxLayer.tsx とテストの両方から使う純関数。Date/乱数を使わない完全な決定論。
 *
 * DepthFlow のモデル（depth.tremeschin.com/docs/camera/ の実数値ベース）:
 *   - steady   … 動かない深度面（不動面）。公式帯 0.30〜0.35。ここでは 0.35 固定。
 *   - height   … 視差の強さ（0=フラット）。offset の視覚変化はこれに比例。
 *   - isometric… エッジ引き伸ばし（stretchy regions）の緩和ノブ。公式推奨 0.5〜0.6。
 *                振幅を上げたら iso も連動して上げるのがガード仕様。
 *
 * 破綻ガードの要点: 現行シェーダは |uv+off| が [0,1] を超えると clamp がエッジを
 * 引き伸ばして「スメア」を起こしていた。ここでは深度依存の遠近スケール（height/iso）を
 * 入れたうえで、全画素のサンプル uv が必ず [0.001,0.999] に収まる最小 zoom を式で導出する。
 */

export interface ParallaxFrameInput {
  /** 経過秒 */
  tSec: number;
  /** 0..1（区間内進捗） */
  progress: number;
  /** 立体感ノブ（0.2..3、effects-meta と同範囲） */
  intensity: number;
  /** "sway" | "left" | "right" | "push" */
  direction: string;
}

export interface ParallaxUniforms {
  /** uShift（横） */
  sx: number;
  /** uShift（縦） */
  sy: number;
  /** uZoom（ベース拡大） */
  zoom: number;
  /** uHeight（視差の強さ） */
  height: number;
  /** uSteady（不動の深度面） */
  steady: number;
  /** uIso（0..1） */
  isometric: number;
}

/** 不動の深度面（DepthFlow公式帯 0.30〜0.35 の上端）。現行ハードコード 0.4 を置換 */
export const PARALLAX_STEADY = 0.35;

/** 視差の強さ = HEIGHT_COEF × intensity（現行 amp と同係数＝既定の見た目の連続性を保つ） */
const HEIGHT_COEF = 0.018;

/**
 * d∈[0,1] での |d − steady| の最大値 = max(steady, 1−steady) = max(0.35, 0.65) = 0.65。
 * offset 項と深度スケールの偏差、両方の保守的上界に使う。
 */
const MAX_DEV = 0.65;

/**
 * 端 c=±0.5 で許すサンプル偏差の設計目標。
 * clamp は [0.001,0.999] なので契約上の限界は 0.499 だが、浮動小数の余白として
 * それより手前に置く（＝わずかに zoom を大きめに取り、契約 |…|≤0.499 を確実に満たす）。
 */
const SAFE_TARGET = 0.495;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * isometric連動ガード: 振幅（intensity）が上がるほど iso を上げてエッジ引き伸ばしを緩和。
 * iso = clamp(0.5 + (intensity − 1) × 0.05, 0.5, 0.6)（リサーチ A1 の仕様）。
 *   intensity 1 → 0.5、intensity 3 → 0.6、範囲外は clamp。
 */
export function isometricOf(intensity: number): number {
  return clamp(0.5 + (intensity - 1) * 0.05, 0.5, 0.6);
}

/**
 * その設定で取りうる |shift|（各成分）の最大値。
 *   sway  : sx=sin(t*0.9)*amp（最大 amp）, sy=cos(t*0.6)*amp*0.45（最大 amp*0.45）→ 成分最大 amp
 *   left  : sx=(progress−0.5)*2*amp（progress∈[0,1] で |sx|≤amp）→ amp
 *   right : 同上 → amp
 *   push  : sx=sin(t*0.7)*amp*0.4 → amp*0.4
 * 未知の direction は movement=0 なので amp を返しても保守的に安全。
 */
export function maxShiftOf(intensity: number, direction: string): number {
  const amp = HEIGHT_COEF * intensity;
  return direction === "push" ? amp * 0.4 : amp;
}

/**
 * 破綻ガードの本体: 端 c=±0.5 のサンプル uv が必ず [0.001,0.999] に収まる最小 zoom。
 *
 * サンプル座標（1軸）は
 *   sample = c / pz + shift·(d−steady)      （pz = zoom · g(d)）
 *   g(d)   = 1 + height·(d−steady)·(1−iso)   （深度依存の遠近スケール）
 * その中心(0.5)からの偏差 |sample| を、全 d∈[0,1]・全フレームで SAFE_TARGET 以下にしたい。
 *
 * 保守的上界:
 *   |c/pz|          ≤ 0.5 / (zoom · minScale)      minScale = min_d g(d) の下界
 *   |shift·(d−steady)| ≤ maxShiftOf · MAX_DEV      = maxOff
 * ここで minScale = 1 − height·MAX_DEV·(1−iso)（真の下限 1−height·steady·(1−iso) より小さい安全側）。
 *
 *   0.5 / (zoom · minScale) + maxOff ≤ SAFE_TARGET
 *   ⇒ zoom ≥ 0.5 / (minScale · (SAFE_TARGET − maxOff))
 * その等号（＝最小 zoom）を返す。minScale<1 かつ (SAFE_TARGET−maxOff)<0.5 なので常に zoom>1。
 */
export function safeZoom(intensity: number, direction: string): number {
  const height = HEIGHT_COEF * intensity;
  const iso = isometricOf(intensity);
  const k = 1 - iso;
  const minScale = 1 - height * MAX_DEV * k;
  const maxOff = maxShiftOf(intensity, direction) * MAX_DEV;
  return 0.5 / (minScale * (SAFE_TARGET - maxOff));
}

/**
 * 毎フレームの uniforms を決定論的に返す。
 * 動きの式は現行を踏襲（係数は不変）。zoom だけ safeZoom で安全側に再導出する。
 */
export function parallaxUniforms(input: ParallaxFrameInput): ParallaxUniforms {
  const { tSec, progress, intensity, direction } = input;
  const height = HEIGHT_COEF * intensity; // = 現行 amp
  const amp = height;
  const iso = isometricOf(intensity);
  let sx = 0;
  let sy = 0;
  let zoom = safeZoom(intensity, direction);
  if (direction === "sway") {
    sx = Math.sin(tSec * 0.9) * amp;
    sy = Math.cos(tSec * 0.6) * amp * 0.45;
  } else if (direction === "left") {
    sx = (progress - 0.5) * 2 * amp;
  } else if (direction === "right") {
    sx = -(progress - 0.5) * 2 * amp;
  } else if (direction === "push") {
    sx = Math.sin(tSec * 0.7) * amp * 0.4;
    zoom += progress * 0.05;
  }
  return { sx, sy, zoom, height, steady: PARALLAX_STEADY, isometric: iso };
}
