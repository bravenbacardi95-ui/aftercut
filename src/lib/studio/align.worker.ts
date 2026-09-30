import { alignPastedLyrics, type HeardWord } from "./align-lyrics";

type Job = {
  samples: Float32Array;
  sampleRate: number;
  text: string;
  startMs: number;
  endMs: number;
};

type AsrOutput = {
  text?: string;
  chunks?: { text?: string; timestamp?: [number, number] | number[] }[];
};

type ProgressEv = { status?: string; progress?: number };

type AsrPipe = (audio: Float32Array, opts: Record<string, unknown>) => Promise<AsrOutput>;

const MODEL = "onnx-community/whisper-small.en";
const FALLBACK = "onnx-community/whisper-base.en";
let pipePromise: Promise<AsrPipe> | null = null;

function postProgress(stage: "loading" | "analyzing" | "aligning", progress: number | null, label: string) {
  self.postMessage({ type: "progress", stage, progress, label });
}

self.onmessage = (event: MessageEvent<Job>) => {
  void run(event.data).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : "Sync failed";
    self.postMessage({ type: "error", message });
  });
};

async function run(job: Job) {
  postProgress("loading", 0, "Loading model…");
  const pipe = await loadPipe();
  postProgress("analyzing", null, "Analyzing the snippet");
  const audio = resample(job.samples, job.sampleRate, 16000);
  const output = await pipe(audio, {
    return_timestamps: "word",
    language: "english",
    task: "transcribe",
  });
  postProgress("aligning", null, "Aligning your lyrics");
  const heard = heardFromChunks(output.chunks ?? [], job.startMs);
  const result = alignPastedLyrics(job.text, heard, job.endMs, job.startMs);
  self.postMessage({ type: "done", words: result.words, draft: result.draft, warning: result.warning });
}

async function loadPipe(): Promise<AsrPipe> {
  if (!pipePromise) pipePromise = createPipe();
  return pipePromise;
}

async function createPipe(): Promise<AsrPipe> {
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
  const progress_callback = (ev: ProgressEv) => {
    if (ev.status === "progress" && typeof ev.progress === "number") {
      postProgress("loading", Math.max(0, Math.min(100, ev.progress)), `Loading model ${Math.round(ev.progress)}%`);
    } else if (ev.status === "initiate" || ev.status === "download" || ev.status === "ready") {
      postProgress("loading", null, "Loading model…");
    }
  };
  const opts = { dtype: "q8" as const, device: "wasm" as const, progress_callback };
  try {
    return (await mod.pipeline("automatic-speech-recognition", MODEL, opts)) as unknown as AsrPipe;
  } catch (err) {
    console.warn("whisper small failed, trying base", err);
    pipePromise = null;
    return (await mod.pipeline("automatic-speech-recognition", FALLBACK, opts)) as unknown as AsrPipe;
  }
}

function heardFromChunks(chunks: NonNullable<AsrOutput["chunks"]>, offsetMs: number): HeardWord[] {
  const words: HeardWord[] = [];
  for (const chunk of chunks) {
    const start = Number(chunk.timestamp?.[0] ?? 0);
    const end = Number(chunk.timestamp?.[1] ?? start);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const parts = String(chunk.text ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) continue;
    if (parts.length === 1) {
      words.push({ text: parts[0]!, startMs: offsetMs + Math.round(start * 1000), endMs: offsetMs + Math.round(Math.max(end, start + 0.04) * 1000) });
      continue;
    }
    const span = Math.max(0.04 * parts.length, end - start);
    const weights = parts.map((part) => Math.max(1, part.length));
    const total = weights.reduce((sum, n) => sum + n, 0);
    let cursor = 0;
    parts.forEach((part, index) => {
      const share = (weights[index] ?? 1) / total;
      const wordStart = start + cursor * span;
      cursor += share;
      words.push({
        text: part,
        startMs: offsetMs + Math.round(wordStart * 1000),
        endMs: offsetMs + Math.round((start + cursor * span) * 1000),
      });
    });
  }
  return words;
}

function resample(input: Float32Array, fromRate: number, toRate: number) {
  if (fromRate === toRate) return input;
  const outLen = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(outLen);
  const ratio = fromRate / toRate;
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const frac = src - i0;
    out[i] = (input[i0] ?? 0) * (1 - frac) + (input[i1] ?? 0) * frac;
  }
  return out;
}
