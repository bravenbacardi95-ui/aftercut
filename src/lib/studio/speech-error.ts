export const SPEECH_ENGINE_DOWN =
  "The server speech engine isn't available here. Paste lyrics, or turn off Isolate vocals to use the in-browser model.";

export function engineDown(raw: unknown): boolean {
  const text = String(raw ?? "");
  return /ALIGNER_PYTHON|Set ALIGNER|python3 on PATH|does not exist|is down\b|payload too large|request entity too large|\b413\b|\b502\b|\b503\b|\b504\b|gateway|<!doctype|<html|failed to fetch|networkerror|load failed/i.test(
    text,
  );
}

export function publicSpeechError(raw: unknown): string {
  const text = String(raw ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
