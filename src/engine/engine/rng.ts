// Seeded LCG. Reproducible per session if seedLock set.

export function mkRng(seed: number): () => number {
  let s = (seed | 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

export function freshSeed(): number {
  return (Date.now() ^ ((Math.random() * 0xffffffff) | 0)) | 0;
}

/**
 * Fisher-Yates over a copy, then take the first `n`. Used for the boot-line pick
 * (hud/boot.ts); the native twin is `shuffledPrefix` in Core/LCG.swift.
 *
 * Deliberately not `[...pool].sort(() => rnd() - 0.5)`: a comparator that answers at
 * random breaks the transitivity every sort implementation assumes, so the result is
 * not a uniform permutation — in V8's TimSort the pool's leading entries survive near
 * the front measurably more often. `rnd()` is < 1, so `j` never exceeds `i`.
 */
export function shufflePick<T>(pool: readonly T[], n: number, rnd: () => number): T[] {
  const a = pool.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}
