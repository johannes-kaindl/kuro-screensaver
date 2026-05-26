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
