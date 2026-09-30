export function downsampleEnergy(energy: number[], bars: number): number[] {
  if (!energy.length) return [];
  if (energy.length <= bars) return energy;
  const out = new Float32Array(bars);
  const counts = new Uint16Array(bars);
  const last = bars - 1;
  for (let i = 0; i < energy.length; i++) {
    const idx = Math.min(last, Math.floor((i / energy.length) * bars));
    out[idx] += energy[i] ?? 0;
    counts[idx] += 1;
  }
  const result: number[] = new Array(bars);
  let peak = 1e-6;
  for (let i = 0; i < bars; i++) {
    const v = counts[i] ? out[i] / counts[i] : 0;
    result[i] = v;
    if (v > peak) peak = v;
  }
  for (let i = 0; i < bars; i++) result[i] = Math.min(1, result[i] / peak);
  return result;
}
