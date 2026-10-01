import { createServerFn } from "@tanstack/react-start";

export type SttWord = { text: string; start: number; end: number; confidence?: number };

export type TranscribeResult =
  | { ok: true; text: string; words: SttWord[]; duration: number }
  | { ok: false; error: string; unavailable?: boolean };

type SttResponse = {
  text?: string;
  duration?: number;
  words?: { text?: string; word?: string; start?: number; end?: number; confidence?: number }[];
  chunks?: { text?: string; timestamp?: [number, number] | number[] }[];
  error?: string | { message?: string };
};

export async function cloudTranscript(wavBase64: string, filename = "clip.wav"): Promise<TranscribeResult> {
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "Transcription is unavailable.", unavailable: true };
  }

  const raw = wavBase64.replace(/^data:audio\/\w+;base64,/, "");
  if (!raw) return { ok: false, error: "Audio clip is empty." };
  if (raw.length > 14_000_000) return { ok: false, error: "Audio clip is too large to transcribe." };

  let blob: Blob;
  try {
    const binary =
      typeof Buffer !== "undefined"
        ? Buffer.from(raw, "base64")
        : Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    const copy = new Uint8Array(binary.byteLength);
    copy.set(binary);
    blob = new Blob([copy], { type: "audio/wav" });
  } catch {
    return { ok: false, error: "Could not read that audio clip." };
  }

  const run = async () => {
    const form = new FormData();
    form.append("model", "grok-voice-transcribe-2.0");
    form.append("language", "en");
    form.append("filler_words", "true");
    form.append("vad_threshold", "0.12");
    form.append("file", blob, filename || "clip.wav");
    return fetch("https://api.x.ai/v1/stt", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(75_000),
    });
  };

  let res: Response;
  try {
    res = await run();
    if (!res.ok && res.status >= 500) res = await run();
  } catch {
    return { ok: false, error: "Transcription failed to connect.", unavailable: true };
  }

  const bodyText = await res.text();
  if (!res.ok) {
    let detail = `Transcription failed (${res.status}).`;
    try {
      const parsed = JSON.parse(bodyText) as SttResponse;
      const msg = typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
      if (msg) detail = msg;
    } catch {
      if (bodyText && bodyText.length < 280 && !/<html|<!doctype/i.test(bodyText)) detail = bodyText;
    }
    return { ok: false, error: detail, unavailable: res.status === 413 || res.status >= 500 };
  }

  let body: SttResponse;
  try {
    body = JSON.parse(bodyText) as SttResponse;
  } catch {
    return { ok: false, error: "Transcription returned an unreadable result." };
  }

  const words = parseSttWords(body);
  return {
    ok: true,
    text: (body.text ?? words.map((w) => w.text).join(" ")).trim(),
    words,
    duration: Number(body.duration ?? 0),
  };
}

export const transcribeTrack = createServerFn({ method: "POST" })
  .validator((input: { wavBase64: string; filename: string; hint?: string }) => input)
  .handler(async ({ data }): Promise<TranscribeResult> => cloudTranscript(data.wavBase64, data.filename));

function parseSttWords(body: SttResponse): SttWord[] {
  const words: SttWord[] = [];
  for (const w of body.words ?? []) {
    const text = String(w.text ?? w.word ?? "").trim();
    const start = Number(w.start ?? 0);
    const end = Number(w.end ?? w.start ?? 0);
    if (text && Number.isFinite(start) && Number.isFinite(end)) {
      words.push({
        text,
        start,
        end: Math.max(end, start),
        confidence: Number.isFinite(Number(w.confidence)) ? Number(w.confidence) : undefined,
      });
    }
  }
  if (words.length) return words;
  for (const c of body.chunks ?? []) {
    const text = String(c.text ?? "").trim();
    const start = Number(c.timestamp?.[0] ?? 0);
    const end = Number(c.timestamp?.[1] ?? start);
    if (text && Number.isFinite(start) && Number.isFinite(end)) {
      words.push({ text, start, end: Math.max(end, start) });
    }
  }
  return words;
}
