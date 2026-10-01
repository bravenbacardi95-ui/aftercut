import { speechEngineStatus } from "./transcribe-stem.fn";

const TTL_MS = 15_000;
let cached: { at: number; ready: boolean } | null = null;

async function probe(): Promise<{ ok: boolean; failed: boolean }> {
  try {
    const result = await speechEngineStatus({ data: {} });
    return { ok: Boolean(result?.ready), failed: false };
  } catch {
    return { ok: false, failed: true };
  }
}

export async function speechEngineReady(force = false): Promise<boolean> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.ready;
  let result = await probe();
  if (result.failed) result = await probe();
  if (result.ok) cached = { at: Date.now(), ready: true };
  else cached = null;
  return result.ok;
}