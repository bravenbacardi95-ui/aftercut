import { yieldToPaint } from "./yield.ts";

const TARGET_RATE = 16000;
const MAX_SECONDS = 45;

let decoded: AudioBuffer | null = null;
let decodedFrom: string | null = null;
let hydratePromise: Promise<AudioBuffer | null> | null = null;

export function getDecodedAudio(): AudioBuffer | null {
  return decoded;
}

export function setDecodedAudio(buffer: AudioBuffer | null, fromUrl: string | null = null) {
  decoded = buffer;
  decodedFrom = fromUrl;
  hydratePromise = null;
}

export type ClipPcm = {
  samples: Float32Array;
  sampleRate: number;
  offset: number;
  duration: number;
};

export async function ensureDecoded(audioUrl: string | null): Promise<AudioBuffer | null> {
  if (decoded && (!audioUrl || decodedFrom === audioUrl || !decodedFrom)) return decoded;
  if (!audioUrl) return decoded;
  if (hydratePromise && decodedFrom === audioUrl) return hydratePromise;
  decodedFrom = audioUrl;
  hydratePromise = (async () => {
    const res = await fetch(audioUrl);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const ctx = new AudioContext();
    try {
      const audio = await ctx.decodeAudioData(buf.slice(0));
      decoded = audio;
      decodedFrom = audioUrl;
      return audio;
    } finally {
      await ctx.close().catch(() => undefined);
    }
  })();
  try {
    return await hydratePromise;
  } catch (err) {
    console.warn("rehydrate audio failed", err);
    hydratePromise = null;
    return decoded;
  }
}

export async function getClipPcm(start: number, end: number, emphasizeVocals = false): Promise<ClipPcm | null> {
  const source = decoded;
  if (!source) return null;
  const t0 = Math.max(0, start);
  const t1 = Math.min(source.duration, Math.max(t0 + 0.4, end));
  const dur = Math.min(MAX_SECONDS, t1 - t0);
  const fromRate = source.sampleRate;
  const offsetFrames = Math.floor(t0 * fromRate);
  const mix = await mixDown(source, offsetFrames, Math.ceil(fromRate * dur));
  let samples = await resample(mix, fromRate, TARGET_RATE);
  if (emphasizeVocals) samples = await isolateVocals(samples, TARGET_RATE);
  else samples = await presence(normalize(samples, 0.92), TARGET_RATE);
  return { samples, sampleRate: TARGET_RATE, offset: t0, duration: dur };
}

export async function encodeClipWav(
  start: number,
  end: number,
  emphasizeVocals = false,
): Promise<{ blob: Blob; offset: number; pcm: ClipPcm } | null> {
  const pcm = await getClipPcm(start, end, emphasizeVocals);
  if (!pcm) return null;
  return { blob: pcmToWav(pcm.samples, pcm.sampleRate), offset: pcm.offset, pcm };
}

function mixDown(source: AudioBuffer, offsetFrames: number, length: number) {
  return walk(length, (mix, i) => {
    const channels = source.numberOfChannels;
    if (channels >= 2) {
      const left = source.getChannelData(0);
      const right = source.getChannelData(1);
      const idx = Math.min(left.length - 1, offsetFrames + i);
      mix[i] = ((left[idx] ?? 0) + (right[idx] ?? 0)) * 0.5;
      return;
    }
    const data = source.getChannelData(0);
    mix[i] = data[Math.min(data.length - 1, offsetFrames + i)] ?? 0;
  });
}

function resample(input: Float32Array, fromRate: number, toRate: number) {
  if (fromRate === toRate) return Promise.resolve(input);
  const outLen = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const ratio = fromRate / toRate;
  return walk(outLen, (out, i) => {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const frac = src - i0;
    out[i] = (input[i0] ?? 0) * (1 - frac) + (input[i1] ?? 0) * frac;
  });
}

const LYRIC_RATE = 24000;

export async function getLyricPcm(start: number, end: number, mode: "center" | "isolated" = "center"): Promise<ClipPcm | null> {
  const source = decoded;
  if (!source) return null;
  const t0 = Math.max(0, start);
  const t1 = Math.min(source.duration, Math.max(t0 + 0.4, end));
  const dur = Math.min(MAX_SECONDS, t1 - t0);
  const fromRate = source.sampleRate;
  const offsetFrames = Math.floor(t0 * fromRate);
  const mix = await mixDown(source, offsetFrames, Math.ceil(fromRate * dur));
  let samples = await resample(mix, fromRate, LYRIC_RATE);
  samples = mode === "isolated" ? await isolateVocals(samples, LYRIC_RATE) : await lyricFocus(samples, LYRIC_RATE);
  return { samples, sampleRate: LYRIC_RATE, offset: t0, duration: dur };
}

export async function encodeLyricWav(
  start: number,
  end: number,
  mode: "center" | "isolated" = "center",
): Promise<{ blob: Blob; offset: number; pcm: ClipPcm } | null> {
  const pcm = await getLyricPcm(start, end, mode);
  if (!pcm) return null;
  return { blob: pcmToWav(pcm.samples, pcm.sampleRate), offset: pcm.offset, pcm };
}

async function lyricFocus(samples: Float32Array, sr: number): Promise<Float32Array> {
  const hp = await onePoleHighpass(samples, sr, 80);
  const band = await onePoleLowpass(hp, sr, 11000);
  return normalize(band, 0.92);
}

async function presence(samples: Float32Array, sr: number): Promise<Float32Array> {
  const hp = await onePoleHighpass(samples, sr, 180);
  const shaped = await onePoleLowpass(hp, sr, 7500);
  const out = await walk(samples.length, (buf, i) => {
    buf[i] = samples[i]! * 0.72 + shaped[i]! * 0.55;
  });
  return normalize(out, 0.94);
}

async function isolateVocals(samples: Float32Array, sr: number): Promise<Float32Array> {
  const hp = await onePoleHighpass(samples, sr, 120);
  const bp = await onePoleLowpass(hp, sr, 6800);
  return normalize(await compress(bp), 0.95);
}

async function onePoleHighpass(samples: Float32Array, sr: number, cutoff: number): Promise<Float32Array> {
  const rc = 1 / (2 * Math.PI * cutoff);
  const dt = 1 / sr;
  const a = rc / (rc + dt);
  let prevY = 0;
  let prevX = 0;
  return walk(samples.length, (out, i) => {
    const x = samples[i] ?? 0;
    prevY = a * (prevY + x - prevX);
    prevX = x;
    out[i] = prevY;
  });
}

async function onePoleLowpass(samples: Float32Array, sr: number, cutoff: number): Promise<Float32Array> {
  const rc = 1 / (2 * Math.PI * cutoff);
  const dt = 1 / sr;
  const a = dt / (rc + dt);
  let prev = 0;
  return walk(samples.length, (out, i) => {
    prev = prev + a * ((samples[i] ?? 0) - prev);
    out[i] = prev;
  });
}

async function walk(length: number, fill: (out: Float32Array, index: number) => void) {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    if ((i & 32767) === 0 && i) await yieldToPaint();
    fill(out, i);
  }
  return out;
}

async function compress(samples: Float32Array): Promise<Float32Array> {
  const out = new Float32Array(samples.length);
  let env = 0;
  const attack = 0.03;
  const release = 0.12;
  for (let i = 0; i < samples.length; i++) {
    if ((i & 32767) === 0 && i) await yieldToPaint();
    const x = samples[i] ?? 0;
    const abs = Math.abs(x);
    env += (abs > env ? attack : release) * (abs - env);
    const g = env > 0.18 ? 0.18 / env : 1;
    out[i] = x * (0.55 + 0.45 * g);
  }
  return out;
}

function normalize(samples: Float32Array, target: number): Float32Array {
  let peak = 1e-6;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i] ?? 0));
  const g = Math.min(6, target / peak);
  if (Math.abs(g - 1) < 0.02) return samples;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = Math.max(-1, Math.min(1, (samples[i] ?? 0) * g));
  }
  return out;
}

export function pcmToWav(samples: Float32Array, sampleRate: number): Blob {
  const n = samples.length;
  const bytes = new ArrayBuffer(44 + n * 2);
  const view = new DataView(bytes);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, n * 2, true);
  let offset = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([bytes], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not encode audio"));
    reader.readAsDataURL(blob);
  });
}
