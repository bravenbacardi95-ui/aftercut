import { getDecodedAudio, pcmToWav, encodeClipWav, encodeLyricWav, blobToBase64 } from "./audio-clip";
import { isolateVocalStem } from "./isolate.fn";
import type { Region } from "./types";

const PAD = 0.5;

export type VocalStem = {
  blob: Blob;
  offset: number;
  isolated: boolean;
  cached: boolean;
  error: string | null;
  ms: number;
  url: string;
};

const cache = new Map<string, VocalStem>();

export function clearVocalStemCache() {
  for (const stem of cache.values()) URL.revokeObjectURL(stem.url);
  cache.clear();
}

export async function prepareVocalStem(opts: {
  audioUrl: string | null;
  region: Region;
  isolate: boolean;
  onStatus?: (label: string) => void;
}): Promise<VocalStem | null> {
  if (!opts.isolate) {
    opts.onStatus?.("Reading the full mix…");
    const mix = (await encodeLyricWav(opts.region.start, opts.region.end, "center")) ?? (await encodeClipWav(opts.region.start, opts.region.end, false));
    if (!mix) return null;
    return {
      blob: mix.blob,
      offset: mix.offset,
      isolated: false,
      cached: false,
      error: null,
      ms: 0,
      url: URL.createObjectURL(mix.blob),
    };
  }

  const audio = getDecodedAudio();
  if (!audio) return null;
  const padStart = Math.max(0, opts.region.start - PAD);
  const padEnd = Math.min(audio.duration, opts.region.end + PAD);
  const key = `${opts.audioUrl ?? "track"}|${padStart.toFixed(3)}|${padEnd.toFixed(3)}`;
  const saved = cache.get(key);
  if (saved) {
    opts.onStatus?.("Using the saved vocal stem");
    return { ...saved, cached: true, error: null };
  }

  opts.onStatus?.("Isolating vocals…");
  const slice = sliceMix(padStart, padEnd);
  if (!slice) return null;
  const wavBase64 = await blobToBase64(slice);
  const result = await isolateVocalStem({ data: { wavBase64 } });
  if (!result.ok) {
    opts.onStatus?.("Isolation failed. Using the full mix.");
    const mix = (await encodeLyricWav(opts.region.start, opts.region.end, "center")) ?? (await encodeClipWav(opts.region.start, opts.region.end, false));
    if (!mix) return null;
    return {
      blob: mix.blob,
      offset: mix.offset,
      isolated: false,
      cached: false,
      error: `Vocal isolation failed: ${result.error} Using the full mix.`,
      ms: result.ms,
      url: URL.createObjectURL(mix.blob),
    };
  }

  const blob = base64ToBlob(result.wavBase64);
  const stem: VocalStem = {
    blob,
    offset: padStart,
    isolated: true,
    cached: false,
    error: null,
    ms: result.ms,
    url: URL.createObjectURL(blob),
  };
  cache.set(key, stem);
  return stem;
}

function sliceMix(start: number, end: number): Blob | null {
  const audio = getDecodedAudio();
  if (!audio) return null;
  const rate = audio.sampleRate;
  const i0 = Math.max(0, Math.floor(start * rate));
  const i1 = Math.min(audio.length, Math.ceil(end * rate));
  const length = Math.max(1, i1 - i0);
  const mix = new Float32Array(length);
  const channels = audio.numberOfChannels;
  for (let c = 0; c < channels; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < length; i++) mix[i] += (data[i0 + i] ?? 0) / channels;
  }
  return pcmToWav(mix, rate);
}

function base64ToBlob(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "audio/wav" });
}
