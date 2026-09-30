import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServerFn } from "@tanstack/react-start";

const SCRIPT = path.join(process.cwd(), "scripts", "isolate_vocals.py");

export type IsolateResult =
  | { ok: true; wavBase64: string; ms: number; model: "htdemucs" }
  | { ok: false; error: string; ms: number; model: "htdemucs" };

export const isolateVocalStem = createServerFn({ method: "POST" })
  .validator((input: { wavBase64: string }) => input)
  .handler(async ({ data }): Promise<IsolateResult> => {
    const started = Date.now();
    const raw = data.wavBase64.replace(/^data:audio\/\w+;base64,/, "");
    if (!raw) return { ok: false, error: "Audio clip is empty.", ms: 0, model: "htdemucs" };
    if (raw.length > 20_000_000) {
      return { ok: false, error: "Snippet is too long to isolate. Shorten the window.", ms: 0, model: "htdemucs" };
    }
    const dir = await mkdtemp(path.join(tmpdir(), "aftercut-stem-"));
    const input = path.join(dir, "snippet.wav");
    const output = path.join(dir, "vocal.wav");
    try {
      await writeFile(input, Buffer.from(raw, "base64"));
      await runPython(input, output);
      const stem = await readFile(output);
      if (stem.byteLength < 1000) {
        return { ok: false, error: "Vocal stem came back empty.", ms: Date.now() - started, model: "htdemucs" };
      }
      return { ok: true, wavBase64: stem.toString("base64"), ms: Date.now() - started, model: "htdemucs" };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Vocal isolation failed.";
      return { ok: false, error: message.slice(0, 280), ms: Date.now() - started, model: "htdemucs" };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

function runPython(input: string, output: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("python3", [SCRIPT, input, output], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split("\n").pop() || `Vocal isolation failed (${code}).`));
    });
  });
}
