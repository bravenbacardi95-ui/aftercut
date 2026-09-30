import path from "node:path";
import { pythonDaemon } from "./py-daemon";

const alignScript = path.join(process.cwd(), "scripts", "align_lyrics.py");
const isolateScript = path.join(process.cwd(), "scripts", "isolate_vocals.py");

export const alignDaemon = pythonDaemon({
  key: "align",
  script: alignScript,
  label: "Aligner",
  timeoutMessage: "Sync timed out, try a shorter snippet",
});

export const isolateDaemon = pythonDaemon({
  key: "isolate",
  script: isolateScript,
  label: "Vocal isolation",
  timeoutMessage: "Vocal isolation timed out. Try a shorter snippet.",
});

/** Spawn both resident workers. Model load happens in the child, so this does not block on it. */
export function bootLyricWorkers() {
  const alignError = alignDaemon.start();
  if (alignError) console.error(`[align] not started: ${alignError}`);
  const isolateError = isolateDaemon.start();
  if (isolateError) console.error(`[isolate] not started: ${isolateError}`);
}
