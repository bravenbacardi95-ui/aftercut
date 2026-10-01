import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServerFn } from "@tanstack/react-start";
import { resolveAlignerPython } from "./py-daemon";
import { engineDown, publicSpeechError, SPEECH_ENGINE_DOWN } from "./speech-error";
import { cloudTranscript } from "./transcribe.fn";
import { alignDaemon, transcribeDaemon } from "./workers.server";

export type StemWord = {
  text: string;
  line: number;
  startMs: number;
  endMs: number;
  confidence: number;
};

export type TranscribeStemResult =
  | { ok: true; text: string; words: StemWord[]; asrMs: number; alignMs: number }
  | { ok: false; error: string; unavailable?: boolean };

const MAX_B64 = 4_000_000;

export const speechEngineStatus = createServerFn({ method: "POST" })
  .validator((input: { ping?: boolean }) => input ?? {})
  .handler(async (): Promise<{ ready: boolean }> => {
    const resolved = resolveAlignerPython();
    return { ready: !("error" in resolved) };
  });

export const transcribeStem = createServerFn({ method: "POST" })
  .validator((input: { wavBase64: string }) => input)
  .handler(async ({ data }): Promise<TranscribeStemResult> => {
    const raw = data.wavBase64.replace(/^data:audio\/\w+;base64,/, "");
    if (!raw) return { ok: false, error: "Audio clip is empty." };
    if (raw.length > MAX_B64) return { ok: false, error: SPEECH_ENGINE_DOWN, unavailable: true };
    if ("error" in resolveAlignerPython()) return { ok: false, error: SPEECH_ENGINE_DOWN, unavailable: true };

    const dir = await mkdtemp(path.join(tmpdir(), "aftercut-hear-"));
    const wav = path.join(dir, "stem.wav");
    try {
      await writeFile(wav, Buffer.from(raw, "base64"));
      const heard = await fromDaemon(wav);
      if (heard !== "fallback") return heard;
      return await fromCloud(wav, raw);
    } catch (err) {
      return { ok: false, error: publicSpeechError(err), unavailable: engineDown(err) };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function asWords(value: unknown): StemWord[] {
  if (!Array.isArray(value)) return [];
  const words: StemWord[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const word = item as Record<string, unknown>;
    const text = String(word.text ?? "").trim();
    if (!text) continue;
    const startMs = Number(word.startMs ?? 0);
    const endMs = Number(word.endMs ?? startMs);
    const confidence = Number(word.confidence ?? 0);
    const line = Number(word.line ?? 0);
    words.push({
      text,
      line: Number.isFinite(line) ? line : 0,
      startMs: Number.isFinite(startMs) ? Math.round(startMs) : 0,
      endMs: Number.isFinite(endMs) ? Math.round(endMs) : 0,
      confidence: Number.isFinite(confidence) ? confidence : 0,
    });
  }
  return words;
}

async function fromDaemon(wav: string): Promise<TranscribeStemResult | "fallback"> {
  try {
    const message = await transcribeDaemon.request({ wav }, 180_000);
    if (message.ok === true) {
      const words = asWords(message.words);
      if (!words.length) return { ok: false, error: "No speech heard in this clip." };
      const text = String(message.text ?? "").trim() || words.map((word) => word.text).join(" ");
      return { ok: true, text, words, asrMs: num(message.asrMs), alignMs: num(message.alignMs) };
    }
    const error = typeof message.error === "string" ? message.error : "Transcription failed.";
    if (/no speech|forced alignment/i.test(error)) return { ok: false, error: publicSpeechError(error) };
    if (process.env.XAI_API_KEY?.trim()) return "fallback";
    return { ok: false, error: publicSpeechError(error), unavailable: engineDown(error) };
  } catch (err) {
    if (process.env.XAI_API_KEY?.trim() && !engineDown(err)) {
      const text = err instanceof Error ? err.message : String(err);
      if (/no speech|forced alignment/i.test(text)) return { ok: false, error: publicSpeechError(text) };
    }
    if (process.env.XAI_API_KEY?.trim()) return "fallback";
    return { ok: false, error: publicSpeechError(err), unavailable: true };
  }
}

async function fromCloud(wav: string, raw: string): Promise<TranscribeStemResult> {
  const heard = await cloudTranscript(raw, "stem.wav");
  if (!heard.ok) {
    return { ok: false, error: publicSpeechError(heard.error), unavailable: Boolean(heard.unavailable) || engineDown(heard.error) };
  }
  const text = heard.text.trim();
  if (!text) return { ok: false, error: "No speech heard in this clip." };
  try {
    const aligned = await alignDaemon.request({ wav, text, isolated: true, snap: false }, 180_000);
    if (aligned.ok !== true) {
      const error = typeof aligned.error === "string" ? aligned.error : "Forced alignment failed.";
      return { ok: false, error: publicSpeechError(error), unavailable: engineDown(error) };
    }
    const words = asWords(aligned.words);
    if (!words.length) return { ok: false, error: "Forced alignment failed." };
    return { ok: true, text, words, asrMs: 0, alignMs: 0 };
  } catch (err) {
    return { ok: false, error: publicSpeechError(err), unavailable: engineDown(err) };
  }
}
