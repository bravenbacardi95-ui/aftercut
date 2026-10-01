export const SPEECH_ENGINE_DOWN =
  "Sync needs the server speech engine, which isn't available here. Turn off Isolate vocals to transcribe in the browser.";

export const SPEECH_TIMEOUT = "The server timed out, try again.";

export function serverTimedOut(raw: unknown): boolean {
  const text = String(raw ?? "");
  return /\b504\b|gateway time-?out/i.test(text);
}

export function engineDown(raw: unknown): boolean {
  if (serverTimedOut(raw)) return false;
  const text = String(raw ?? "");
  return /ALIGNER_PYTHON|Set ALIGNER|python3 on PATH|does not exist|is down\b|payload too large|request entity too large|\b413\b|\b502\b|\b503\b|gateway|<!doctype|<html|failed to fetch|networkerror|load failed/i.test(
    text,
  );
}

export function publicSpeechError(raw: unknown): string {
  const text = String(raw ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (serverTimedOut(text)) return SPEECH_TIMEOUT;
  if (!text || engineDown(text)) return SPEECH_ENGINE_DOWN;
  return text.slice(0, 240);
}

export function browserSpeechError(raw: unknown): string {
  const text = String(raw ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (text || "The in-browser hearing model failed.").slice(0, 240);
}
