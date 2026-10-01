import { speechEngineStatus } from "./transcribe-stem.fn";

const TTL_MS = 15_000;
let cached: { at: number; ready: boolean } | null = null;

export async function speechEngineReady(force = false): Promise<boolean> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.ready;
  try {
    const result = await speechEngineStatus({ data: {} });
    const ready = Boolean(result?.ready);
    cached = { at: Date.now(), ready };
    return ready;
  } catch {
    cached = { at: Date.now(), ready: false };
    return false;
  }
}
