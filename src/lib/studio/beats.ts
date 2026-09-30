import type { AudioAnalysis, PacingId } from "./types";
import { setDecodedAudio } from "./audio-clip";

let sharedCtx: AudioContext | null = null;

function audioContext() {
  if (!sharedCtx || sharedCtx.state === "closed") sharedCtx = new AudioContext();
  return sharedCtx;
}

function yieldThread() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export async function analyzeAudio(buffer: ArrayBuffer, fromUrl: string | null = null): Promise<AudioAnalysis> {
  const ctx = audioContext();
  if (ctx.state === "suspended") {
    await Promise.race([
      ctx.resume().catch(() => undefined),
      new Promise<void>((resolve) => window.setTimeout(resolve, 400)),
    ]);
  }
  const audio = await ctx.decodeAudioData(buffer.slice(0));
  setDecodedAudio(audio, fromUrl);
  const data = audio.getChannelData(0);
  const sr = audio.sampleRate;
  const hop = 2048;
  const win = 2048;
  const energies: number[] = [];
  const vocal: number[] = [];

  let hp = 0;
  const hpA = Math.exp((-2 * Math.PI * 180) / sr);
  let windows = 0;

  for (let i = 0; i + win < data.length; i += hop) {
    let e = 0;
    let v = 0;
    for (let j = 0; j < win; j += 16) {
      const sample = data[i + j] ?? 0;
      e += sample * sample;
      hp = hpA * (hp + sample - (data[i + j - 1] ?? sample));
      v += hp * hp;
    }
    energies.push(e);
    vocal.push(v);
    if (++windows === 120) {
      windows = 0;
      await yieldThread();
    }
  }

  const flux: number[] = energies.map((e, i) => (i === 0 ? 0 : Math.max(0, e - (energies[i - 1] ?? 0))));
  const vflux: number[] = vocal.map((e, i) => (i === 0 ? 0 : Math.max(0, e - (vocal[i - 1] ?? 0))));
  const sorted = [...flux].sort((a, b) => a - b);
  const thresh = sorted[Math.floor(sorted.length * 0.78)] || 0;
  const vSorted = [...vflux].sort((a, b) => a - b);
  const vThresh = vSorted[Math.floor(vSorted.length * 0.7)] || 0;

  const minGap = Math.round((60 / 180) * (sr / hop));
  const beats: number[] = [];
  let last = -9999;
  flux.forEach((f, i) => {
    if (f >= thresh && i - last >= minGap) {
      beats.push((i * hop) / sr);
      last = i;
    }
  });

  const onsetGap = Math.round(0.08 * (sr / hop));
  const onsets: number[] = [];
  let lastOn = -9999;
  vflux.forEach((f, i) => {
    if (f >= vThresh && i - lastOn >= onsetGap) {
      onsets.push((i * hop) / sr);
      lastOn = i;
    }
  });

  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) {
    const d = beats[i] - beats[i - 1];
    if (d > 0.28 && d < 1.2) intervals.push(d);
  }
  const io = median(intervals) || 0.666;
  let bpm = Math.round(60 / io);
  if (bpm < 70) bpm *= 2;
  if (bpm > 160) bpm = Math.round(bpm / 2);
  bpm = Math.max(70, Math.min(160, bpm));

  let usedBeats = beats;
  if (usedBeats.length < 8) {
    const step = 60 / bpm;
    const offset = beats[0] ?? 0.05;
    usedBeats = [];
    for (let t = offset; t < audio.duration - 0.05; t += step) usedBeats.push(t);
  }

  return {
    duration: audio.duration,
    bpm,
    beats: usedBeats,
    onsets: onsets.length ? onsets : usedBeats,
    energy: downsample(energies, 480),
    energyHop: audio.duration / 480,
  };
}

function downsample(values: number[], n: number): number[] {
  if (values.length <= n) return values;
  const out: number[] = [];
  const step = values.length / n;
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * step);
    const b = Math.floor((i + 1) * step);
    let m = 0;
    const span = Math.max(1, b - a);
    for (let j = a; j < b; j++) m += values[j] ?? 0;
    out.push(m / span);
  }
  const mx = Math.max(...out, 1e-6);
  return out.map((v) => v / mx);
}

export function energyAt(analysis: AudioAnalysis, t: number): number {
  const i = Math.max(0, Math.min(analysis.energy.length - 1, Math.floor(t / analysis.energyHop)));
  return analysis.energy[i] ?? 0;
}

export function makeCuts(
  beats: number[],
  start: number,
  end: number,
  pacing: PacingId,
  energy: AudioAnalysis | null,
  seed: number,
): number[] {
  const inRange = beats.filter((b) => b >= start + 0.04 && b < end - 0.12);
  const cuts = [start];
  const mix = (n: number) => {
    let x = (seed + 1) >>> 0;
    x ^= Math.imul(n + 1, 0x9e3779b9);
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    return (x ^ (x >>> 16)) >>> 0;
  };
  const everySteady = 2 + (mix(1) % 3);
  const offset = mix(2) % everySteady;
  const loudAt = 0.42 + (mix(3) % 28) / 100;
  const downEvery = 2 + (mix(4) % 3);

  if (pacing === "steady") {
    inRange.forEach((b, i) => {
      if ((i + offset) % everySteady === 0) cuts.push(b);
    });
  } else if (pacing === "energy" && energy) {
    const denseEvery = 1 + (mix(5) % 2);
    const quietEvery = 2 + (mix(6) % 3);
    inRange.forEach((b, i) => {
      const e = energyAt(energy, b);
      const every = e > loudAt ? denseEvery : quietEvery;
      if ((i + (mix(7) % every)) % every === 0) cuts.push(b);
    });
  } else {
    inRange.forEach((b, i) => {
      const isDown = (i + offset) % downEvery === 0;
      const e = energy ? energyAt(energy, b) : 0.4;
      if (isDown || ((i + mix(8)) % 2 === 0 && e > loudAt)) cuts.push(b);
    });
  }

  if (cuts[cuts.length - 1] !== end) cuts.push(end);
  const cleaned: number[] = [];
  for (const c of cuts) {
    if (!cleaned.length || c - cleaned[cleaned.length - 1] > 0.22) cleaned.push(c);
  }
  if (cleaned.length === 2 && inRange.length) {
    const beat = inRange[mix(9) % inRange.length]!;
    if (beat - cleaned[0]! > 0.22 && cleaned[1]! - beat > 0.22) cleaned.splice(1, 0, beat);
  }
  return cleaned;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ds = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, "0")}.${ds}`;
}

export function formatPrecise(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${m}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

export function formatMs(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  return `${Math.round(seconds * 1000)} ms`;
}
