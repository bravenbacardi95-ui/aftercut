import { blobToBase64, encodeMixWav, ensureDecoded } from "./audio-clip";
import { alignWordsToBeats, groupByAuthoredLine, groupWordsIntoLines, nextWordId, parseLyricText, tokenizeLine, wordsFromStt } from "./lyrics";
import { applyColloquialFixes } from "./lyric-sense";
import { browserSpeechError, engineDown, publicSpeechError, serverTimedOut, SPEECH_ENGINE_DOWN, SPEECH_TIMEOUT } from "./speech-error";
import { speechEngineReady } from "./speech-engine";
import { transcribeStem, type StemWord } from "./transcribe-stem.fn";
import { MIN_WORD_DUR, type AudioAnalysis, type LyricWord, type Region } from "./types";
import { anchorWords, lockWordsToSinging } from "./vocal-activity";
import { yieldToPaint } from "./yield";
import { prepareVocalStem } from "./vocal-stem";

export type TranscribeProgress = (msg: string) => void;

export async function transcribeRegion(
  region: Region,
  analysis: AudioAnalysis,
  opts: {
    audioUrl?: string | null;
    trackName?: string;
    isolate?: boolean;
    shift?: number;
    onStatus?: TranscribeProgress;
  } = {},
): Promise<{ words: LyricWord[]; source: "stt" | "aligned"; warning: string | null }> {
  const empty = (warning: string) => ({
    words: [] as LyricWord[],
    source: "aligned" as const,
    warning,
  });
  const isolate = opts.isolate !== false;
  const shift = opts.shift ?? 0;

  opts.onStatus?.("Preparing the vocal…");
  await yieldToPaint();
  if (opts.audioUrl) {
    await ensureDecoded(opts.audioUrl);
    await yieldToPaint();
  }

  if (isolate) {
    if (!(await speechEngineReady())) return empty(SPEECH_ENGINE_DOWN);
    const stem = await prepareVocalStem({
      audioUrl: opts.audioUrl ?? null,
      region,
      isolate: true,
      onStatus: opts.onStatus,
    });
    if (!stem) return empty("Couldn’t read this clip. Try a shorter snippet, or drop the track again.");
    if (!stem.isolated) return empty(publicSpeechError(stem.error ?? "Vocal isolation failed. The full mix was not used."));
    const wavBase64 = await blobToBase64(stem.blob);
    const heard = await askStem(wavBase64, opts.onStatus);
    if (!heard.ok) return empty(publicSpeechError(heard.error));
    if (!heard.words.length) return empty("No speech heard in this clip.");
    return { words: mapAlignedWords(heard.words, stem.offset, shift), source: "stt", warning: null };
  }

  const mix = await encodeMixWav(region.start, region.end);
  if (!mix) return empty("Couldn’t read this clip. Try a shorter snippet, or drop the track again.");
  if (await speechEngineReady()) {
    const wavBase64 = await blobToBase64(mix.blob);
    let heard: Awaited<ReturnType<typeof transcribeStem>> | null = null;
    try {
      heard = await askStem(wavBase64, opts.onStatus);
    } catch (err) {
      if (serverTimedOut(err) || !engineDown(err)) return empty(publicSpeechError(err));
      heard = { ok: false, error: SPEECH_ENGINE_DOWN, unavailable: true };
    }
    if (heard.ok && heard.words.length) {
      return { words: mapAlignedWords(heard.words, mix.offset, shift), source: "stt", warning: null };
    }
    if (!heard.ok && (serverTimedOut(heard.error) || heard.error === SPEECH_TIMEOUT || (!heard.unavailable && !engineDown(heard.error)))) {
      return empty(publicSpeechError(heard.error));
    }
    if (heard.ok) return empty("No speech heard in this clip.");
  }

  try {
    opts.onStatus?.("Loading the hearing model…");
    const { transcribeWithWhisper } = await import("./whisper");
    const local = await transcribeWithWhisper(mix.pcm, opts.onStatus);
    if (local.words.length || local.text.trim()) {
      opts.onStatus?.("Placing each word on the vocal…");
      return fromStt(local.text, local.words, mix.offset, analysis, region);
    }
  } catch (err) {
    return empty(browserSpeechError(err));
  }
  return empty("No vocals detected in this clip. Paste the lyrics and they’ll lock to the waveform.");
}

async function askStem(wavBase64: string, onStatus?: TranscribeProgress) {
  onStatus?.("Hearing the vocal…");
  return transcribeStem({ data: { wavBase64 } });
}

function mapAlignedWords(words: StemWord[], offsetSec: number, shift: number): LyricWord[] {
  const offsetMs = Math.round(offsetSec * 1000);
  return words.map((word) => ({
    id: nextWordId(),
    text: word.text,
    start: (word.startMs + offsetMs) / 1000 + shift,
    end: Math.max((word.startMs + offsetMs) / 1000 + 0.04, (word.endMs + offsetMs) / 1000) + shift,
    line: word.line,
    confidence: word.confidence,
    lowConfidence: word.confidence < 0.5,
  }));
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
  const flat = lyrics.flatMap((line) => line.words);
  return {
    words: flat,
    lyrics,
    lyricDraft: lyrics.map((line) => line.text).join("\n"),
  };
}
