const KEY = "aftercut-lyric-hints";

function norm(text: string) {
  return text.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "").trim();
}

export function loadHints(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveHint(from: string, to: string) {
  const a = from.trim();
  const b = to.trim();
  if (!a || !b || norm(a) === norm(b)) return;
  if (a.split(/\s+/).length > 4 || b.split(/\s+/).length > 4) return;
  try {
    const next = { ...loadHints(), [norm(a)]: b };
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function applyHints<T extends { text: string }>(words: T[]): T[] {
  const hints = loadHints();
  if (!Object.keys(hints).length) return words;
  return words.map((w) => {
    const mapped = hints[norm(w.text)];
    return mapped ? { ...w, text: mapped } : w;
  });
}

export function clearHints() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

clearHints();
