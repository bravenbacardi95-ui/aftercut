import { getDecodedAudio, encodeMixWav, blobToBase64 } from "./audio-clip";
import { isolateVocalStem } from "./isolate.fn";
import { publicSpeechError } from "./speech-error";
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
    const mix = await encodeMixWav(opts.region.start, opts.region.end);
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
  const slice = await encodeMixWav(padStart, padEnd);
  if (!slice) return null;
  const wavBase64 = await blobToBase64(slice.blob);
  const result = await isolateVocalStem({ data: { wavBase64 } });
  if (!result.ok) {
    return {
      blob: new Blob([], { type: "audio/wav" }),
      offset: padStart,
      isolated: false,
      cached: false,
      error: publicSpeechError(result.error || "Vocal isolation failed."),
      ms: result.ms,
      url: "",
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

function base64ToBlob(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "audio/wav" });
}
