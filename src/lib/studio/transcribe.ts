import { blobToBase64, encodeClipWav, encodeLyricWav, ensureDecoded, type ClipPcm } from "./audio-clip";
import { alignWordsToBeats, groupByAuthoredLine, groupWordsIntoLines, parseLyricText, tokenizeLine, wordsFromStt } from "./lyrics";
import { applyColloquialFixes } from "./lyric-sense";
import { transcribeTrack } from "./transcribe.fn";
import { MIN_WORD_DUR, type AudioAnalysis, type LyricWord, type Region } from "./types";
import { anchorWords, lockWordsToSinging } from "./vocal-activity";
import { yieldToPaint } from "./yield";
import type { HeardWord } from "./align-lyrics";
import { prepareVocalStem } from "./vocal-stem";

export type TranscribeProgress = (msg: string) => void;

export async function transcribeRegion(
  region: Region,
  analysis: AudioAnalysis,
  opts: {
    audioUrl?: string | null;
    trackName?: string;
    fallbackText?: string;
    allowDemoFallback?: boolean;
    isolate?: boolean;
    onStatus?: TranscribeProgress;
  } = {},
): Promise<{ words: LyricWord[]; source: "stt" | "aligned"; warning: string | null }> {
  const empty = (warning: string) => ({
    words: [] as LyricWord[],
    source: "aligned" as const,
    warning,
  });

  opts.onStatus?.("Preparing the vocal…");
  await yieldToPaint();
  if (opts.audioUrl) {
    await ensureDecoded(opts.audioUrl);
    await yieldToPaint();
  }

  if (opts.allowDemoFallback && opts.fallbackText?.trim()) {
    opts.onStatus?.("Timing each word…");
    return demoFallback(opts.fallbackText, analysis, region);
  }

  if (opts.isolate !== false) {
    const stem = await prepareVocalStem({
      audioUrl: opts.audioUrl ?? null,
      region,
      isolate: true,
      onStatus: opts.onStatus,
    });
    if (!stem) return empty("Couldn’t read this clip. Try a shorter snippet, or drop the track again.");
    const heard = await listenCloud(stem.blob, opts.onStatus);
    if (heard.ok && (heard.words.length || heard.text.trim())) {
      opts.onStatus?.("Placing each word on the vocal…");
      const placed = await fromStt(heard.text, heard.words, stem.offset, analysis, region);
      return { ...placed, warning: joinWarning(stem.error, placed.warning) };
    }
    if (stem.error) {
      return empty(stem.error);
    }
    return empty(heard.ok ? "No vocals detected in the isolated stem." : heard.error);
  }

  opts.onStatus?.("Cleaning the vocal…");
  await yieldToPaint();
  let clip = await encodeLyricWav(region.start, region.end, "center");
  await yieldToPaint();
  if (!clip) clip = await encodeClipWav(region.start, region.end, false);
  opts.onStatus?.("Checking a second pass…");
  const isolated = await encodeLyricWav(region.start, region.end, "isolated");
  if (!clip && !isolated) return empty("Couldn’t read this clip. Try a shorter snippet, or drop the track again.");

  const takes = [clip, isolated].filter((item): item is NonNullable<typeof clip> => Boolean(item));
  const heard = await Promise.all(
    takes.map(async (take) => {
      try {
        const result = await listenCloud(take.blob, opts.onStatus);
        return { result, offset: take.offset };
      } catch (err) {
        console.warn("cloud transcribe failed", err);
        return null;
      }
    }),
  );
  const best = pickHeard(heard, region);
  if (best && (best.result.words.length || best.result.text.trim())) {
    opts.onStatus?.("Placing each word on the vocal…");
    return fromStt(best.result.text, best.result.words, best.offset, analysis, region);
  }

  const whisperClip = await encodeClipWav(region.start, region.end, true);
  const local = whisperClip ? await listenLocalFallback(whisperClip.pcm, opts.onStatus) : null;
  if (local && (local.words.length || local.text.trim())) {
    opts.onStatus?.("Placing each word on the vocal…");
    return fromStt(local.text, local.words, whisperClip?.offset ?? region.start, analysis, region);
  }

  if (opts.allowDemoFallback && opts.fallbackText?.trim()) {
    return demoFallback(opts.fallbackText, analysis, region);
  }

  const failed = heard.find((item) => item && !item.result.ok && !item.result.unavailable);
  if (failed && !failed.result.ok) {
    return empty(failed.result.error || "Couldn’t hear vocals in this clip. Paste the lyrics.");
  }
  return empty("No vocals detected in this clip. Paste the lyrics and they’ll lock to the waveform.");
}

async function listenCloud(blob: Blob, onStatus?: TranscribeProgress) {
  const wavBase64 = await blobToBase64(blob);
  onStatus?.("Hearing the vocal…");
  return transcribeTrack({
    data: {
      wavBase64,
      filename: "clip.wav",
    },
  });
}

export async function hearSnippetWords(
  region: Region,
  audioUrl: string | null,
  onStatus?: TranscribeProgress,
  isolate = true,
): Promise<{ words: HeardWord[]; warning: string | null }> {
  onStatus?.(isolate ? "Isolating vocals…" : "Hearing the vocal…");
  if (audioUrl) await ensureDecoded(audioUrl);
  const stem = await prepareVocalStem({ audioUrl, region, isolate, onStatus });
  if (!stem) return { words: [], warning: "Couldn’t read this clip. Drop the track again." };
  try {
    const result = await listenCloud(stem.blob, onStatus);
    if (!result.ok) return { words: [], warning: joinWarning(stem.error, result.error) };
    const startMs = Math.round(region.start * 1000);
    const endMs = Math.round(region.end * 1000);
    const words = result.words
      .map((word) => ({
        text: word.text,
        startMs: Math.round((word.start + stem.offset) * 1000),
        endMs: Math.round((Math.max(word.end, word.start + 0.04) + stem.offset) * 1000),
      }))
      .filter((word) => word.text.trim() && word.endMs > word.startMs && word.endMs > startMs && word.startMs < endMs);
    const heard = words.length ? null : "No word timings came back from the vocal.";
    return { words, warning: joinWarning(stem.error, heard) };
  } catch (err) {
    return { words: [], warning: joinWarning(stem.error, err instanceof Error ? err.message : "Couldn’t hear the vocal.") };
  }
}

function joinWarning(left: string | null | undefined, right: string | null | undefined) {
  return [left, right].filter((item): item is string => Boolean(item && item.trim())).join(" ") || null;
}

function pickHeard(
  heard: Array<{ result: Awaited<ReturnType<typeof listenCloud>>; offset: number } | null>,
  region: Region,
) {
  let best: { result: Awaited<ReturnType<typeof listenCloud>> & { ok: true }; offset: number } | null = null;
  let bestScore = 0;
  for (const item of heard) {
    if (!item?.result.ok) continue;
    const score = transcriptScore(item.result.words, item.result.text, region);
    if (!best || score > bestScore) {
      best = { result: item.result, offset: item.offset };
      bestScore = score;
    }
  }
  return best;
}

function transcriptScore(
  words: { text: string; start: number; end: number; confidence?: number }[],
  text: string,
  region: Region,
) {
  const tokens = words.length
    ? words.map((word) => word.text.toLowerCase().replace(/[^a-z0-9']/g, "")).filter(Boolean)
    : text.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return tokens.length;
  const unique = new Set(tokens).size;
  const diversity = unique / tokens.length;
  if (diversity < 0.34 && tokens.length > 6) return 0.4;
  const span = words.length ? Math.max(...words.map((word) => word.end)) - Math.min(...words.map((word) => word.start)) : 0;
  const cover = span > 0 ? Math.min(1, span / Math.max(0.4, region.end - region.start)) : 0.25;
  const conf =
    words.reduce((sum, word) => sum + (typeof word.confidence === "number" ? word.confidence : 0.65), 0) /
    Math.max(1, words.length);
  return tokens.length * (0.4 + diversity) * (0.35 + cover) * Math.max(0.2, conf);
}

async function listenLocalFallback(pcm: ClipPcm, onStatus?: TranscribeProgress) {
  try {
    const { transcribeWithWhisper } = await import("./whisper");
    return await transcribeWithWhisper(pcm, onStatus);
  } catch (err) {
    console.warn("whisper transcribe failed", err);
    return null;
  }
}

function demoFallback(text: string, analysis: AudioAnalysis, region: Region) {
  return {
    words: lockWordsToSinging(alignFallback(text, analysis, region), region),
    source: "aligned" as const,
    warning: "Demo vocals were timed to the rhythm so you can still edit the bubbles.",
  };
}

async function fromStt(
  text: string,
  raw: { text: string; start: number; end: number }[],
  offset: number,
  analysis: AudioAnalysis,
  region: Region,
): Promise<{ words: LyricWord[]; source: "stt" | "aligned"; warning: string | null }> {
  if (raw.length) {
    const placed = await anchorWords(placeHeardWords(raw, offset, region), region);
    return { words: applyColloquialFixes(placed), source: "stt", warning: null };
  }
  if (text.trim()) {
    return {
      words: applyColloquialFixes(lockWordsToSinging(alignFallback(text, analysis, region), region)),
      source: "stt",
      warning: null,
    };
  }
  return {
    words: [],
    source: "aligned",
    warning: "No vocals detected in this clip. Paste the lyrics and they’ll lock to the waveform.",
  };
}

function alignFallback(text: string, analysis: AudioAnalysis, region: Region): LyricWord[] {
  const lines = parseLyricText(text);
  const tokens = lines.flatMap((line, i) => tokenizeLine(line).map((t) => ({ text: t, line: i })));
  const anchors = (analysis.onsets.length >= tokens.length ? analysis.onsets : analysis.beats).filter(
    (t) => t >= region.start && t < region.end,
  );
  return alignWordsToBeats(tokens, anchors, region.start, region.end);
}

function placeHeardWords(
  raw: { text: string; start: number; end: number }[],
  offset: number,
  region: Region,
): LyricWord[] {
  const span = Math.max(0.4, region.end - region.start);
  const maxRaw = raw.reduce((m, w) => Math.max(m, w.end, w.start), 0);
  const scales = maxRaw > span * 4 ? [0.001, 0.01, 1] : [1];
  let best: LyricWord[] = [];
  let bestScore = -Infinity;
  for (const scale of scales) {
    for (const base of [offset, 0]) {
      const words = wordsFromStt(
        raw.map((w) => ({ text: w.text, start: w.start * scale, end: Math.max(w.end, w.start) * scale })),
        base,
      );
      const score = scorePlacement(words, region);
      if (score > bestScore) {
        bestScore = score;
        best = words;
      }
    }
  }
  const clipped = best
    .filter((w) => w.end > region.start + 0.01 && w.start < region.end - 0.01)
    .map((w) => {
      const start = Math.max(region.start, w.start);
      const end = Math.min(region.end, Math.max(w.end, start + MIN_WORD_DUR));
      return { ...w, start, end };
    });
  return unoverlap(clipped);
}

function unoverlap(words: LyricWord[]): LyricWord[] {
  const sorted = [...words].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.start < prev.end) {
      sorted[i - 1] = { ...prev, end: Math.max(prev.start + MIN_WORD_DUR, Math.min(prev.end, cur.start)) };
    }
  }
  return sorted.filter((word) => word.end > word.start + 0.02);
}

function scorePlacement(words: { start: number; end: number }[], region: Region) {
  if (!words.length) return -1e9;
  let inside = 0;
  for (const w of words) {
    if (w.start >= region.start - 0.25 && w.start < region.end && w.end > w.start) inside += 1;
  }
  const span = words[words.length - 1]!.end - words[0]!.start;
  const need = Math.max(0.2, region.end - region.start);
  const coverage = Math.max(0, Math.min(1, span / need));
  const buckets = new Set(words.map((w) => Math.round(w.start * 10)));
  const spread = buckets.size / words.length;
  return inside * 4 + spread * 3 + coverage * 2 - (words.length - inside) * 6;
}


export function commitWords(words: LyricWord[], mode: "heard" | "authored" = "heard") {
  const sorted = [...words].sort((a, b) => a.start - b.start || a.line - b.line);
  const lyrics = mode === "authored" ? groupByAuthoredLine(sorted) : groupWordsIntoLines(sorted);
  return {
    words: mode === "authored" ? lyrics.flatMap((line) => line.words) : sorted,
    lyrics,
    lyricDraft: lyrics.map((line) => line.text).join("\n"),
  };
}
