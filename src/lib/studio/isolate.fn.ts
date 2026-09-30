import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServerFn } from "@tanstack/react-start";
import { pythonDaemon } from "./py-daemon";

const SCRIPT = path.join(process.cwd(), "scripts", "isolate_vocals.py");
const daemon = pythonDaemon({ key: "isolate", script: SCRIPT, label: "Vocal isolation" });

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
      const message = await daemon.request({ wav: input, out: output }, 180000);
      if (message.ok !== true) {
        const detail = typeof message.error === "string" ? message.error : "Vocal isolation failed.";
        return { ok: false, error: detail, ms: Date.now() - started, model: "htdemucs" };
      }
      const stem = await readFile(output);
      if (stem.byteLength < 1000) {
        return { ok: false, error: "Vocal stem came back empty.", ms: Date.now() - started, model: "htdemucs" };
      }
      return { ok: true, wavBase64: stem.toString("base64"), ms: Date.now() - started, model: "htdemucs" };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Vocal isolation is down.";
      return { ok: false, error: message.slice(0, 500), ms: Date.now() - started, model: "htdemucs" };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
