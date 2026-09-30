import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServerFn } from "@tanstack/react-start";
import { alignDaemon } from "./workers.server";

export type ForcedWord = {
  text: string;
  line: number;
  startMs: number;
  endMs: number;
  rawStartMs: number;
  confidence: number;
};

export type AlignFeed = {
  path: string;
  sampleRate: number;
  channels: number;
  sourceChannels: number;
  resampledFrom: number | null;
  isolated: boolean;
  snap: boolean;
  model: string;
  method: string;
  durationMs?: number;
};

export type ForcedAlignResult =
  | { ok: true; words: ForcedWord[]; warning: string | null; feed: AlignFeed }
  | { ok: false; error: string; words: ForcedWord[]; feed?: AlignFeed };

export const alignLyrics = createServerFn({ method: "POST" })
  .validator((input: { wavBase64: string; text: string; isolated: boolean; snap?: boolean }) => input)
  .handler(async ({ data }): Promise<ForcedAlignResult> => {
    const raw = data.wavBase64.replace(/^data:audio\/\w+;base64,/, "");
    if (!raw) return { ok: false, error: "Audio clip is empty.", words: [] };
    const dir = await mkdtemp(path.join(tmpdir(), "aftercut-align-"));
    const wav = path.join(dir, "stem.wav");
    try {
      await writeFile(wav, Buffer.from(raw, "base64"));
      const message = await alignDaemon.request(
        { wav, text: data.text, isolated: data.isolated, snap: Boolean(data.snap) },
        180000,
      );
      if (message.ok !== true) {
        return {
          ok: false,
          error: typeof message.error === "string" ? message.error : "Forced alignment failed.",
          words: [],
        };
      }
      return message as ForcedAlignResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Aligner is down.";
      return { ok: false, error: message, words: [] };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
