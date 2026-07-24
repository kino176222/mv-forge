/**
 * 画面揺れ（shake）オフセットの純関数。Wrappers.tsx の Shake とテストの SSOT。
 *
 * mode:
 *  - "shake": 手持ちカメラの微振動〜地震級。3つの非整数倍サイン波mixで機械的でない揺れ。
 *  - "drift": 手ブレドリフト。低周波でゆっくり漂うドキュメンタリー的な没入モード。
 * 不明な mode は "shake" 扱い。決定論（Date/Math.random不使用）。
 */

export interface ShakeInput {
  mode: string; // "shake" | "drift"
  frame: number;
  fps: number;
  speed: number; // 1..15（既存ノブ）
  intensity: number; // px（既存ノブ）
  /** beatSync時の beatPulse 値（0..1）。非同期時は 1 */
  pulse: number;
}

export interface ShakeOffset {
  dx: number;
  dy: number;
  rot: number;
  scale: number;
}

export function shakeOffset(input: ShakeInput): ShakeOffset {
  const { mode, frame, fps, speed, intensity, pulse } = input;
  const amp = intensity * pulse;
  // 端が見えないよう揺れ幅ぶんスケール（両モード共通・pulseに依らず intensity 基準）
  const scale = 1 + (intensity * 2.5) / 1080;

  if (mode === "drift") {
    // 低周波の漂い。speed 8 で td ≈ 1x
    const td = (frame / fps) * speed * 0.12;
    const dx = (Math.sin(td * 0.9) * 0.6 + Math.sin(td * 2.3 + 2.0) * 0.4) * amp;
    const dy =
      (Math.cos(td * 0.7 + 1.0) * 0.6 + Math.cos(td * 1.7 + 3.0) * 0.4) * amp * 0.7;
    const rot = Math.sin(td * 0.5 + 0.7) * amp * 0.015;
    return { dx, dy, rot, scale };
  }

  // mode "shake"（不明modeもここ）: 現行 Wrappers 12-41行の式をそのまま踏襲
  const t = (frame / fps) * speed;
  const dx =
    (Math.sin(t * 6.3) * 0.5 + Math.sin(t * 11.7 + 2) * 0.3 + Math.sin(t * 19.1 + 5) * 0.2) *
    amp;
  const dy =
    (Math.cos(t * 5.7 + 1) * 0.5 + Math.cos(t * 13.3 + 3) * 0.3 + Math.cos(t * 17.9) * 0.2) *
    amp;
  const rot = Math.sin(t * 4.1 + 0.7) * amp * 0.02;
  return { dx, dy, rot, scale };
}
