import { createServerFn } from "@tanstack/react-start";

export type PolishWord = { text: string; from: number; to: number };

export type PolishResult =
  | { ok: true; words: PolishWord[]; lyric: string }
  | { ok: false; error: string; unavailable?: boolean };

export const polishLyrics = createServerFn({ method: "POST" })
  .validator((input: { trackName?: string; words: { text: string }[]; hints?: { from: string; to: string }[] }) => input)
  .handler(async ({ data }): Promise<PolishResult> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "Sense pass unavailable.", unavailable: true };
    if (!data.words.length) return { ok: true, words: [], lyric: "" };

    const numbered = data.words
      .slice(0, 220)
      .map((w, i) => `${i}:${w.text}`)
      .join(" ");
    const asLine = data.words.map((w) => w.text).join(" ");
    const hintBlock = (data.hints ?? []).map((h) => `"${h.from}" → "${h.to}"`).join("; ");

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0,
        max_tokens: 2500,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You repair sung lyrics from noisy ASR. Output only what this clip's vocalist sang.

Rules:
- Keep the same words unless a token is an obvious mis-hear of the words around it.
- Do not import lines from any other song.
- Do not add bars that were not heard.
- lyric: the verse, one phrase per line.
JSON: {"lyric":"...","words":[{"text":"word","from":0,"to":0}]}`,
          },
          {
            role: "user",
            content: `Track: ${data.trackName || "unknown"}
${hintBlock ? `Listener corrections: ${hintBlock}\n` : ""}ASR as a line: ${asLine}
Numbered: ${numbered}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(40_000),
    });

    if (!res.ok) {
      return { ok: false, error: `Sense pass failed (${res.status}).` };
    }

    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = body.choices?.[0]?.message?.content ?? "";
    const parsed = parsePolish(raw, data.words.length);
    if (!parsed.lyric && !parsed.words.length) return { ok: false, error: "Sense pass returned nothing." };
    return { ok: true, words: parsed.words, lyric: parsed.lyric };
  });

function parsePolish(raw: string, n: number): { words: PolishWord[]; lyric: string } {
  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd <= jsonStart) return { words: [], lyric: "" };
  try {
    const body = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
      lyric?: string;
      text?: string;
      words?: { text?: string; from?: number; to?: number; i?: number }[];
    };
    const out: PolishWord[] = [];
    for (const w of body.words ?? []) {
      const text = String(w.text ?? "").trim();
      if (!text) continue;
      const from = clampIndex(Number(w.from ?? w.i ?? 0), n);
      const to = clampIndex(Number(w.to ?? w.from ?? w.i ?? from), n);
      out.push({ text, from: Math.min(from, to), to: Math.max(from, to) });
    }
    const lyric = String(body.lyric ?? body.text ?? "").trim();
    return { words: out, lyric };
  } catch {
    return { words: [], lyric: "" };
  }
}

function clampIndex(n: number, len: number) {
  if (!Number.isFinite(n) || !len) return 0;
  return Math.max(0, Math.min(len - 1, Math.round(n)));
}
