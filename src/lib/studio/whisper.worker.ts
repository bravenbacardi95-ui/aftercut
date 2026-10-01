import mjsUrl from "../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url";
import wasmUrl from "../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url";

type BrowserWord = { text: string; start: number; end: number };
type AsrOutput = {
  text?: string;
  chunks?: { text?: string; timestamp?: [number, number] | number[] }[];
};
type AsrPipe = (audio: Float32Array, opts: Record<string, unknown>) => Promise<AsrOutput>;
type InMsg =
  | { id: number; op: "warm" }
  | { id: number; op: "hear"; samples: Float32Array; duration: number };

const MODEL = "onnx-community/whisper-base.en";
const FALLBACK = "onnx-community/whisper-tiny.en";
const LOAD_MS = 90_000;
const INFER_MS = 45_000;

let pipePromise: Promise<AsrPipe> | null = null;
let queue: Promise<void> = Promise.resolve();

function assetUrl(href: string) {
  if (/^https?:/i.test(href)) return href;
  return new URL(href, self.location.origin).href;
}

function postStatus(message: string) {
  self.postMessage({ type: "status", message });
}

function postDone(id: number, body: { ok: true; text: string; words: BrowserWord[] } | { ok: false; error: string }) {
  self.postMessage({ type: "done", id, ...body });
}

function deadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

async function configureOrt() {
  const paths = { mjs: assetUrl(mjsUrl), wasm: assetUrl(wasmUrl) };
  const ort = (await import("onnxruntime-web/webgpu")) as {
    env?: { wasm?: { wasmPaths?: { mjs: string; wasm: string }; numThreads?: number; proxy?: boolean } };
  };
  const wasm = ort.env?.wasm;
  if (!wasm) throw new Error("The in-browser hearing model failed to start.");
  (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("onnxruntime")] = ort;
  wasm.wasmPaths = paths;
  wasm.numThreads = 1;
  wasm.proxy = false;
  return paths;
}

async function loadPipeline(): Promise<AsrPipe> {
  if (!pipePromise) pipePromise = buildPipeline();
  return pipePromise;
}

async function buildPipeline(): Promise<AsrPipe> {
  postStatus("Loading the hearing model…");
  const paths = await configureOrt();
  const mod = await import("@huggingface/transformers");
  const env = mod.env as {
    allowLocalModels?: boolean;
    useBrowserCache?: boolean;
    backends?: { onnx?: { wasm?: { wasmPaths?: { mjs: string; wasm: string }; numThreads?: number; proxy?: boolean } } };
  };
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = paths;
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.proxy = false;
  }
  const progress = (ev: { status?: string; progress?: number }) => {
    if (ev.status === "progress" && typeof ev.progress === "number") {
      postStatus(`Loading the hearing model ${Math.max(0, Math.min(100, Math.round(ev.progress)))}%`);
    } else if (ev.status === "ready" || ev.status === "initiate") {
      postStatus("Loading the hearing model…");
    }
  };
  const opts = { dtype: "q8" as const, device: "wasm" as const, progress_callback: progress };
  const timeout = "The in-browser hearing model timed out.";
  try {
    return (await deadline(
      mod.pipeline("automatic-speech-recognition", MODEL, opts) as Promise<AsrPipe>,
      LOAD_MS,
      timeout,
    )) as AsrPipe;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/timed out/i.test(message)) throw err;
    postStatus("Loading a smaller hearing model…");
    return (await deadline(
      mod.pipeline("automatic-speech-recognition", FALLBACK, opts) as Promise<AsrPipe>,
      LOAD_MS,
      timeout,
    )) as AsrPipe;
  }
}

function wordsFromChunks(chunks: NonNullable<AsrOutput["chunks"]>): BrowserWord[] {
  const words: BrowserWord[] = [];
  for (const chunk of chunks) {
    const start = Number(chunk.timestamp?.[0] ?? 0);
    const end = Number(chunk.timestamp?.[1] ?? start);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const tokens = String(chunk.text ?? "")
      .replace(/^[\s,.;:!?]+|[\s,.;:!?]+$/g, "")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => /[\p{L}\p{N}]/u.test(token));
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

function explodeText(text: string, duration: number): BrowserWord[] {
  const tokens = text
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => /[\p{L}\p{N}]/u.test(token));
  if (!tokens.length) return [];
  const span = Math.max(0.08 * tokens.length, duration);
  return tokens.map((token, i) => ({
    text: token,
    start: (i / tokens.length) * span,
    end: ((i + 1) / tokens.length) * span,
  }));
}

async function hear(samples: Float32Array, duration: number) {
  const transcriber = await loadPipeline();
  postStatus("Hearing the vocal…");
  const chunkOpts: Record<string, unknown> = duration > 28 ? { chunk_length_s: 20, stride_length_s: 4 } : {};
  let output: AsrOutput;
  try {
    output = await deadline(transcriber(samples, { return_timestamps: "word", ...chunkOpts }), INFER_MS, "The in-browser hearing model timed out.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/timed out/i.test(message) || !/attention|timestamp|word|language|task/i.test(message)) throw err;
    output = await deadline(transcriber(samples, { return_timestamps: true, ...chunkOpts }), INFER_MS, "The in-browser hearing model timed out.");
  }
  const words = wordsFromChunks(output.chunks ?? []);
  const text = (output.text ?? words.map((word) => word.text).join(" ")).replace(/\s+/g, " ").trim();
  if (!words.length && text) return { text, words: explodeText(text, duration) };
  return { text, words };
}

self.onmessage = (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  if (!msg || typeof msg.id !== "number") return;
  queue = queue
    .then(async () => {
      if (msg.op === "warm") {
        await loadPipeline();
        postDone(msg.id, { ok: true, text: "", words: [] });
        return;
      }
      const heard = await hear(msg.samples, msg.duration);
      postDone(msg.id, { ok: true, text: heard.text, words: heard.words });
    })
    .catch((err: unknown) => {
      pipePromise = null;
      postDone(msg.id, { ok: false, error: err instanceof Error ? err.message : String(err) });
    });
};
