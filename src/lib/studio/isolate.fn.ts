import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServerFn } from "@tanstack/react-start";
import { isolateDaemon } from "./workers.server";
import { publicSpeechError, SPEECH_ENGINE_DOWN } from "./speech-error";

export type IsolateResult =
  | { ok: true; wavBase64: string; ms: number; model: "htdemucs" }
  | { ok: false; error: string; ms: number; model: "htdemucs" };

export const isolateVocalStem = createServerFn({ method: "POST" })
  .validator((input: { wavBase64: string }) => input)
  .handler(async ({ data }): Promise<IsolateResult> => {
    const started = Date.now();
    const raw = data.wavBase64.replace(/^data:audio\/\w+;base64,/, "");
    if (!raw) return { ok: false, error: "Audio clip is empty.", ms: 0, model: "htdemucs" };
    if (raw.length > 4_000_000) {
      return { ok: false, error: SPEECH_ENGINE_DOWN, ms: 0, model: "htdemucs" };
    }
    const dir = await mkdtemp(path.join(tmpdir(), "aftercut-stem-"));
    const input = path.join(dir, "snippet.wav");
    const output = path.join(dir, "vocal.wav");
    try {
      await writeFile(input, Buffer.from(raw, "base64"));
      const message = await isolateDaemon.request({ wav: input, out: output }, 180000);
      if (message.ok !== true) {
        const detail = typeof message.error === "string" ? message.error : "Vocal isolation failed.";
        return { ok: false, error: publicSpeechError(detail), ms: Date.now() - started, model: "htdemucs" };
      }
      const stem = await readFile(output);
      if (stem.byteLength < 1000) {
        return { ok: false, error: "Vocal stem came back empty.", ms: Date.now() - started, model: "htdemucs" };
      }
      return { ok: true, wavBase64: stem.toString("base64"), ms: Date.now() - started, model: "htdemucs" };
    } catch (err) {
      return { ok: false, error: publicSpeechError(err instanceof Error ? err.message : err), ms: Date.now() - started, model: "htdemucs" };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
