import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServerFn } from "@tanstack/react-start";

const SCRIPT = path.join(process.cwd(), "scripts", "align_lyrics.py");

export type ForcedWord = {
  text: string;
  line: number;
  startMs: number;
  endMs: number;
  confidence: number;
};

export type AlignFeed = {
  path: string;
  sampleRate: number;
  channels: number;
  sourceChannels: number;
  resampledFrom: number | null;
  isolated: boolean;
  model: string;
  method: string;
};

export type ForcedAlignResult =
  | { ok: true; words: ForcedWord[]; warning: string | null; feed: AlignFeed }
  | { ok: false; error: string; words: ForcedWord[]; feed?: AlignFeed };

type Pending = {
  resolve: (value: ForcedAlignResult & { id?: string }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let child: ChildProcessWithoutNullStreams | null = null;
let ready = false;
let buffer = "";
let nextId = 1;
const pending = new Map<string, Pending>();

function dropChild(error: Error) {
  ready = false;
  const current = child;
  child = null;
  current?.kill();
  for (const [id, job] of pending) {
    clearTimeout(job.timer);
    job.reject(error);
    pending.delete(id);
  }
}

function ensureAligner() {
  if (child) return;
  buffer = "";
  ready = false;
  child = spawn("python3", ["-u", SCRIPT, "--serve"], { stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => {
    buffer += String(chunk);
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
      if (!line) continue;
      let message: { ready?: boolean; id?: string } & ForcedAlignResult;
      try {
        message = JSON.parse(line) as { ready?: boolean; id?: string } & ForcedAlignResult;
      } catch {
        continue;
      }
      if (message.ready) {
        ready = true;
        continue;
      }
      if (!message.id) continue;
      const job = pending.get(message.id);
      if (!job) continue;
      clearTimeout(job.timer);
      pending.delete(message.id);
      job.resolve(message);
    }
  });
  child.stderr.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) console.info(text);
  });
  child.on("exit", () => {
    dropChild(new Error("The aligner stopped."));
  });
  child.on("error", (err) => dropChild(err));
}

function ask(wav: string, text: string, isolated: boolean) {
  ensureAligner();
  const id = String(nextId++);
  return new Promise<ForcedAlignResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Forced alignment timed out."));
    }, 180000);
    pending.set(id, {
      resolve: (value) => resolve(value),
      reject,
      timer,
    });
    const send = () => {
      if (!pending.has(id)) return;
      if (!child || !ready) {
        setTimeout(send, 50);
        return;
      }
      child.stdin.write(JSON.stringify({ id, wav, text, isolated }) + "\n");
    };
    send();
  });
}

export const alignLyrics = createServerFn({ method: "POST" })
  .validator((input: { wavBase64: string; text: string; isolated: boolean }) => input)
  .handler(async ({ data }): Promise<ForcedAlignResult> => {
    const raw = data.wavBase64.replace(/^data:audio\/\w+;base64,/, "");
    if (!raw) return { ok: false, error: "Audio clip is empty.", words: [] };
    const dir = await mkdtemp(path.join(tmpdir(), "aftercut-align-"));
    const wav = path.join(dir, "stem.wav");
    try {
      await writeFile(wav, Buffer.from(raw, "base64"));
      return await ask(wav, data.text, data.isolated);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Forced alignment failed.", words: [] };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
