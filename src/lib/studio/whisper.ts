import type { ClipPcm } from "./audio-clip";

export type BrowserWord = { text: string; start: number; end: number; confidence?: number };

type StatusMsg = { type: "status"; message: string };
type DoneMsg =
  | { type: "done"; id: number; ok: true; text: string; words: BrowserWord[] }
  | { type: "done"; id: number; ok: false; error: string };
type WorkerMsg = StatusMsg | DoneMsg;

const HEAR_MS = 150_000;

let worker: Worker | null = null;
let seq = 0;
let onStatus: ((msg: string) => void) | null = null;
const pending = new Map<number, { resolve: (value: DoneMsg) => void; reject: (error: Error) => void; timer: number }>();

function dropWorker(reason: string) {
  const jobs = [...pending.values()];
  pending.clear();
  const current = worker;
  worker = null;
  for (const job of jobs) window.clearTimeout(job.timer);
  current?.terminate();
  const error = new Error(reason);
  for (const job of jobs) job.reject(error);
}

function spawn() {
  if (worker) return worker;
  const source = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  worker = source;
  source.onmessage = (ev: MessageEvent<WorkerMsg>) => {
    if (worker !== source) return;
    const data = ev.data;
    if (!data) return;
    if (data.type === "status") {
      onStatus?.(data.message);
      return;
    }
    const job = pending.get(data.id);
    if (!job) return;
    window.clearTimeout(job.timer);
    pending.delete(data.id);
    job.resolve(data);
  };
  source.onerror = (ev) => {
    if (worker !== source) return;
    dropWorker(ev.message || "The in-browser hearing model failed.");
  };
  return source;
}

function call(
  payload: { op: "warm" } | { op: "hear"; samples: Float32Array; duration: number },
  timeout: number,
  status?: (msg: string) => void,
  transfer?: Transferable[],
) {
  if (typeof window === "undefined") return Promise.reject(new Error("The hearing model runs in the browser."));
  onStatus = status ?? null;
  const id = ++seq;
  const source = spawn();
  return new Promise<DoneMsg>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      if (!pending.has(id)) return;
      dropWorker("The in-browser hearing model timed out.");
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    source.postMessage({ id, ...payload }, transfer ?? []);
  });
}

export function warmTranscriber(status?: (msg: string) => void) {
  if (typeof window === "undefined") return;
  void call({ op: "warm" }, 95_000, status).catch((err) => {
    console.warn("transcriber warm failed", err);
  });
}

export async function transcribeWithWhisper(pcm: ClipPcm, status?: (msg: string) => void) {
  const samples = new Float32Array(pcm.samples);
  const done = await call({ op: "hear", samples, duration: pcm.duration }, HEAR_MS, status, [samples.buffer]);
  if (!done.ok) throw new Error(done.error || "The in-browser hearing model failed.");
  return { text: done.text, words: done.words };
}
