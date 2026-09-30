import type { SttWord } from "./transcribe.fn";
import type { ClipPcm } from "./audio-clip";

type AsrOutput = {
  text?: string;
  chunks?: { text?: string; timestamp?: [number, number] | number[] }[];
};

type ProgressEv = {
  status?: string;
  progress?: number;
  file?: string;
};

type AsrPipe = {
  (audio: Float32Array, opts: Record<string, unknown>): Promise<AsrOutput>;
};

let pipePromise: Promise<AsrPipe> | null = null;
const MODEL = "onnx-community/whisper-small.en";
const FALLBACK_MODEL = "onnx-community/whisper-base.en";

export function warmTranscriber(onStatus?: (msg: string) => void) {
  if (typeof window === "undefined") return;
  void getPipeline(onStatus).catch((err) => {
    console.warn("transcriber warm failed", err);
    pipePromise = null;
  });
}

async function getPipeline(onStatus?: (msg: string) => void): Promise<AsrPipe> {
  if (typeof window === "undefined") {
    throw new Error("Transcriber runs in the browser.");
  }
  if (!pipePromise) {
    pipePromise = loadPipeline(onStatus);
  }
  return pipePromise;
}

async function loadPipeline(onStatus?: (msg: string) => void): Promise<AsrPipe> {
  onStatus?.("Loading the hearing model…");
  const mod = await import("@huggingface/transformers");
  const env = mod.env as {
    allowLocalModels?: boolean;
    useBrowserCache?: boolean;
    backends?: { onnx?: { wasm?: { numThreads?: number; proxy?: boolean } } };
  };
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.proxy = false;
  }

  const progress = (ev: ProgressEv) => {
    if (ev.status === "progress" && typeof ev.progress === "number") {
      onStatus?.(`Loading the hearing model ${Math.max(0, Math.min(100, Math.round(ev.progress)))}%`);
    } else if (ev.status === "ready" || ev.status === "initiate") {
      onStatus?.("Loading the hearing model…");
    }
  };

  const opts = { dtype: "q8" as const, device: "wasm" as const, progress_callback: progress };

  try {
    return (await mod.pipeline("automatic-speech-recognition", MODEL, opts)) as unknown as AsrPipe;
  } catch (err) {
    console.warn("whisper base failed, trying tiny", err);
    pipePromise = null;
    return (await mod.pipeline("automatic-speech-recognition", FALLBACK_MODEL, opts)) as unknown as AsrPipe;
  }
}

export async function transcribeWithWhisper(
  pcm: ClipPcm,
  onStatus?: (msg: string) => void,
): Promise<{ text: string; words: SttWord[] }> {
  const transcriber = await getPipeline(onStatus);
  onStatus?.("Hearing the vocal…");
  const chunkOpts: Record<string, unknown> =
    pcm.duration > 28 ? { chunk_length_s: 20, stride_length_s: 4 } : {};

  let output: AsrOutput;
  try {
    output = await transcriber(pcm.samples, { return_timestamps: "word", ...chunkOpts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/attention|timestamp|word|language|task/i.test(msg)) throw err;
    output = await transcriber(pcm.samples, { return_timestamps: true, ...chunkOpts });
  }

  const words = wordsFromChunks(output.chunks ?? []);
  const text = (output.text ?? words.map((w) => w.text).join(" ")).replace(/\s+/g, " ").trim();
  if (!words.length && text) {
    return { text, words: explodeText(text, pcm.duration) };
  }
  return { text, words };
}

function explodeText(text: string, duration: number): SttWord[] {
  const tokens = text
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => /[\p{L}\p{N}]/u.test(t));
  if (!tokens.length) return [];
  const span = Math.max(0.08 * tokens.length, duration);
  return tokens.map((token, i) => ({
    text: token,
    start: (i / tokens.length) * span,
    end: ((i + 1) / tokens.length) * span,
  }));
}

function wordsFromChunks(chunks: NonNullable<AsrOutput["chunks"]>): SttWord[] {
  const words: SttWord[] = [];
  for (const chunk of chunks) {
    const start = Number(chunk.timestamp?.[0] ?? 0);
    const end = Number(chunk.timestamp?.[1] ?? start);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const tokens = String(chunk.text ?? "")
      .replace(/^[\s,.;:!?]+|[\s,.;:!?]+$/g, "")
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => /[\p{L}\p{N}]/u.test(t));
    if (!tokens.length) continue;
    const weights = tokens.map((token) => Math.max(1, [...token].length));
    const total = weights.reduce((sum, n) => sum + n, 0);
    const span = Math.max(0.08 * tokens.length, Math.max(0.05, end - start));
    let cursor = 0;
    tokens.forEach((token, i) => {
      const share = (weights[i] ?? 1) / total;
      const wordStart = Math.max(0, start + cursor * span);
      cursor += share;
      words.push({
        text: token,
        start: wordStart,
        end: Math.max(wordStart + 0.05, start + cursor * span),
      });
    });
  }
  return words;
}
