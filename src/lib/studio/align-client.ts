import { getDecodedAudio } from "./audio-clip";
import type { AlignedWord } from "./align-lyrics";

export type AlignProgress = {
  stage: "loading" | "analyzing" | "aligning";
  progress: number | null;
  label: string;
};

export function extractSnippet(start: number, end: number): { samples: Float32Array; sampleRate: number } | null {
  const audio = getDecodedAudio();
  if (!audio) return null;
  const sampleRate = audio.sampleRate;
  const i0 = Math.max(0, Math.floor(start * sampleRate));
  const i1 = Math.min(audio.length, Math.ceil(Math.max(start + 0.4, end) * sampleRate));
  const length = Math.max(1, i1 - i0);
  const samples = new Float32Array(length);
  const channels = audio.numberOfChannels;
  for (let c = 0; c < channels; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < length; i++) samples[i] += (data[i0 + i] ?? 0) / channels;
  }
  return { samples, sampleRate };
}

export function alignSnippetInWorker(opts: {
  samples: Float32Array;
  sampleRate: number;
  text: string;
  startMs: number;
  endMs: number;
  onProgress?: (progress: AlignProgress) => void;
}): Promise<{ words: AlignedWord[]; draft: string; warning: string | null }> {
  return new Promise((resolve, reject) => {
    void import("./align.worker?worker")
      .then(({ default: WorkerCtor }) => {
        const worker = new WorkerCtor();
        const finish = () => worker.terminate();
        worker.onmessage = (event: MessageEvent) => {
          const data = event.data as
            | AlignProgress & { type: "progress" }
            | { type: "done"; words: AlignedWord[]; draft: string; warning: string | null }
            | { type: "error"; message: string };
          if (data.type === "progress") {
            opts.onProgress?.({ stage: data.stage, progress: data.progress, label: data.label });
            return;
          }
          finish();
          if (data.type === "error") reject(new Error(data.message));
          else resolve({ words: data.words, draft: data.draft, warning: data.warning });
        };
        worker.onerror = (event) => {
          finish();
          reject(new Error(event.message || "Sync failed"));
        };
        const samples = opts.samples;
        worker.postMessage(
          {
            samples,
            sampleRate: opts.sampleRate,
            text: opts.text,
            startMs: opts.startMs,
            endMs: opts.endMs,
          },
          [samples.buffer],
        );
      })
      .catch((err: unknown) => {
        reject(err instanceof Error ? err : new Error("Sync failed"));
      });
  });
}
