/**
 * 決定論的な擬似乱数。
 * Remotionではフレームごとの決定性が命なので Math.random() は使わない。
 */
export function hashRand(...seeds: number[]): number {
  let h = 2166136261;
  for (const s of seeds) {
    h ^= Math.floor(s * 1000);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967295;
}
