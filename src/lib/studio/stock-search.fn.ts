import { createServerFn } from "@tanstack/react-start";

export type VaultShot = {
  id: string;
  name: string;
  src: string;
  prompt: string;
};

export const searchStockVault = createServerFn({ method: "POST" })
  .validator((input: { query: string }) => input)
  .handler(async ({ data }): Promise<{ ok: true; shots: VaultShot[]; query: string } | { ok: false; error: string }> => {
    const query = data.query.trim().slice(0, 80);
    if (query.length < 2) return { ok: false, error: "Type a place, mood, or object." };

    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "The vault is unavailable right now." };

    const shots = await planShots(apiKey, query);
    if (!shots.length) return { ok: false, error: "Couldn’t read that search." };

    const rendered: VaultShot[] = [];
    const batch = shots.slice(0, 6);
    await Promise.all(
      batch.map(async (shot, i) => {
        const img = await imagineStill(apiKey, shot.prompt);
        if (!img) return;
        rendered.push({
          id: `vault-${slug(query)}-${i}-${shot.name.replace(/\s+/g, "-").toLowerCase()}`,
          name: shot.name,
          src: img,
          prompt: shot.prompt,
        });
      }),
    );

    if (!rendered.length) return { ok: false, error: "Imagine couldn’t pull stills for that search. Try a more specific query." };
    return { ok: true, shots: rendered, query };
  });

async function planShots(apiKey: string, query: string): Promise<{ name: string; prompt: string }[]> {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-4.5",
      temperature: 0.7,
      max_tokens: 900,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a music-video B-roll scout. Given a search, return 6 distinct vertical 9:16 cinematic stills — specific, not generic.
Vary time of day, weather, lens, distance, and neighborhood. No text, logos, watermarks, or readable faces.
JSON: {"shots":[{"name":"Times Square rain","prompt":"photoreal vertical 9:16 music-video still, ..."}]}`,
        },
        { role: "user", content: `Search: ${query}` },
      ],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) return fallbackShots(query);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = body.choices?.[0]?.message?.content ?? "";
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return fallbackShots(query);
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      shots?: { name?: string; prompt?: string }[];
    };
    const shots = (parsed.shots ?? [])
      .map((s) => ({
        name: String(s.name ?? "").trim().slice(0, 42),
        prompt: String(s.prompt ?? "").trim(),
      }))
      .filter((s) => s.name && s.prompt);
    return shots.length ? shots.slice(0, 6) : fallbackShots(query);
  } catch {
    return fallbackShots(query);
  }
}

async function imagineStill(apiKey: string, prompt: string): Promise<string | null> {
  const run = () =>
    fetch("https://api.x.ai/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-imagine-image",
        prompt: `${prompt}. Vertical 9:16, photoreal cinematic B-roll, no text, no watermark, music video still.`,
        n: 1,
        resolution: "1k",
        response_format: "url",
      }),
      signal: AbortSignal.timeout(45_000),
    });

  let res = await run();
  if (!res.ok && res.status >= 500) res = await run();
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: { url?: string; b64_json?: string }[] };
  const first = body.data?.[0];
  if (first?.url) return first.url;
  if (first?.b64_json) return `data:image/png;base64,${first.b64_json}`;
  return null;
}

function fallbackShots(query: string): { name: string; prompt: string }[] {
  const q = query.trim();
  const angles = [
    ["Night street", `night ${q} wet asphalt neon reflections, 35mm`],
    ["Golden hour", `golden hour ${q} long lens, haze, cinematic`],
    ["Overhead", `high angle ${q} grid, dusk, anamorphic`],
    ["Interior", `interior ${q} tungsten practicals, handheld`],
    ["Rain", `rain ${q} windshield bokeh, night`],
    ["Empty hour", `empty ${q} just after close, fluorescent, quiet`],
  ];
  return angles.map(([name, prompt]) => ({ name, prompt }));
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 32) || "shot";
}
