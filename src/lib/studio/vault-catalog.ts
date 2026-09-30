import { PACKS } from "./packs";
import type { MediaClip } from "./types";

const ALIASES: Record<string, string> = {
  nyc: "city street night downtown aerial",
  "new york": "city street night downtown",
  la: "drive highway night city",
  tokyo: "neon night city rain",
  london: "street rain night city",
  paris: "street city dusk",
  rain: "tunnel drive aerial wet night",
  night: "tunnel drive aerial club bar stage",
  car: "tunnel drive highway",
  ocean: "ocean shoreline water",
  beach: "ocean shoreline",
  forest: "forest path trees",
  stage: "stage spots concert lights",
  studio: "tape console reels",
};

export function searchVaultCatalog(query: string): MediaClip[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const extra = (ALIASES[q] ?? "").split(" ").filter(Boolean);
  const tokens = [...new Set([...q.split(/\s+/), ...extra])];
  const clips = PACKS.flatMap((pack) => pack.clips);
  const scored = clips
    .map((clip) => {
      const hay = `${clip.name} ${clip.categoryId ?? ""} ${packTags(clip.categoryId ?? "")}`.toLowerCase();
      let score = 0;
      if (hay.includes(q)) score += 8;
      for (const token of tokens) if (token && hay.includes(token)) score += 3;
      return { clip, score };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: MediaClip[] = [];
  for (const hit of scored) {
    if (seen.has(hit.clip.src)) continue;
    seen.add(hit.clip.src);
    out.push({ ...hit.clip, id: `vault-${hit.clip.id}`, categoryId: `search:${q}` });
  }
  return out;
}

function packTags(categoryId: string) {
  if (categoryId === "night-drive") return "night car drive tunnel city rain highway aerial";
  if (categoryId === "tape-room") return "studio tape reels console music";
  if (categoryId === "after-hours") return "night club bar neon lights";
  if (categoryId === "grain") return "landscape ocean beach grass forest nature wind";
  if (categoryId === "stage") return "stage concert lights spots";
  return "street city walk downtown dusk";
}

export const VAULT_SIZE = PACKS.reduce((sum, pack) => sum + pack.clips.length, 0);