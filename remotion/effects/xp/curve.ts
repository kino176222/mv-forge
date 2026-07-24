export type CurvePoints = ReadonlyArray<readonly [number, number]>;

/** 区分線形補間。範囲外は端の値でクランプ */
export function sampleCurve(points: CurvePoints, t: number): number {
  if (points.length === 0) return 0;
  if (t <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [t1, v1] = points[i];
    if (t <= t1) {
      const [t0, v0] = points[i - 1];
      const p = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * p;
    }
  }
  return last[1];
}
