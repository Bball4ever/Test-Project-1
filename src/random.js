// A seeded random number generator ("mulberry32").
// Same seed → same sequence of numbers, every time. We use it so that a chalk
// stroke's rough texture looks identical every frame instead of flickering,
// and so test strokes are the same on every run.

export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
