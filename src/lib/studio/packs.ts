import type { CaptionEffectId, CaptionFontId, CaptionStyleId, FramingId, LookId, MediaClip, Pack, PacingId } from "./types";

function motion(id: string, file: string, name: string, categoryId: string): MediaClip {
  return {
    id,
    kind: "video",
    src: `/packs/motion/${file}.mp4`,
    poster: `/packs/motion/${file}.jpg`,
    name,
    origin: "stock",
    categoryId,
  };
}

export const PACKS: Pack[] = [
  {
    id: "night-drive",
    name: "Night Drive",
    description: "Moving roads, tunnels, and wet city light.",
    poster: "/packs/motion/tunnel.jpg",
    clips: [
      motion("nd-tunnel", "tunnel", "Wet tunnel", "night-drive"),
      motion("nd-drive", "drive", "Downtown rush", "night-drive"),
      motion("nd-aerial", "aerial", "Night intersection", "night-drive"),
    ],
  },
  {
    id: "tape-room",
    name: "Tape Room",
    description: "Spinning reels and a live console.",
    poster: "/packs/motion/tape.jpg",
    clips: [
      motion("tr-tape", "tape", "Spinning reels", "tape-room"),
      motion("tr-console", "console", "Live console", "tape-room"),
    ],
  },
  {
    id: "after-hours",
    name: "After Hours",
    description: "Sweeping club light and a neon bar.",
    poster: "/packs/motion/club.jpg",
    clips: [
      motion("ah-club", "club", "Club beams", "after-hours"),
      motion("ah-bar", "bar", "Neon bar", "after-hours"),
    ],
  },
  {
    id: "grain",
    name: "Open Air",
    description: "Wind, water, and a walking path.",
    poster: "/packs/motion/grass.jpg",
    clips: [
      motion("gr-grass", "grass", "Wind in the grass", "grain"),
      motion("gr-ocean", "ocean", "Shoreline", "grain"),
      motion("gr-forest", "forest", "Forest path", "grain"),
    ],
  },
  {
    id: "stage",
    name: "Stage",
    description: "Spotlights moving across an empty stage.",
    poster: "/packs/motion/stage.jpg",
    clips: [motion("st-stage", "stage", "Moving spots", "stage")],
  },
  {
    id: "street",
    name: "Street",
    description: "A walking city and traffic at dusk.",
    poster: "/packs/motion/street.jpg",
    clips: [
      motion("sr-street", "street", "Blue hour walk", "street"),
      motion("sr-aerial", "aerial", "Wet crossing", "street"),
    ],
  },
];

export const STOCK_BY_ID = new Map(PACKS.flatMap((p) => p.clips.map((c) => [c.id, c] as const)));

export const DEFAULT_CUT_IDS = ["nd-tunnel", "nd-drive", "gr-ocean"];

export function resolveCutClips(ids: string[], extras: MediaClip[] = []): MediaClip[] {
  const extra = extras.length ? new Map(extras.map((c) => [c.id, c] as const)) : null;
  return ids
    .map((id) => STOCK_BY_ID.get(id) ?? extra?.get(id))
    .filter((c): c is MediaClip => Boolean(c));
}

export const CAPTION_STYLES: { id: CaptionStyleId; name: string; sample: string }[] = [
  { id: "brat", name: "Brat", sample: "Justified lowercase block" },
  { id: "word", name: "One word", sample: "Only the current word" },
  { id: "line", name: "Whole line", sample: "The full phrase" },
  { id: "karaoke", name: "Karaoke", sample: "Line, current word lit" },
  { id: "typewriter", name: "Typewriter", sample: "Letters tick on" },
];

export const CAPTION_EFFECTS: { id: CaptionEffectId; name: string; sample: string }[] = [
  { id: "none", name: "None", sample: "Clean overlay" },
  { id: "outline", name: "Outline", sample: "Heavy stroke" },
  { id: "boxed", name: "Boxed", sample: "Black plate" },
];

export const CAPTION_FONTS: { id: CaptionFontId; name: string; sample: string }[] = [
  { id: "brat", name: "Brat", sample: "Narrow, lowercase" },
  { id: "clean", name: "Clean", sample: "Outfit, tight sans" },
  { id: "editorial", name: "Editorial", sample: "Instrument Serif" },
  { id: "poster", name: "Poster", sample: "Anton, all caps" },
];

export const LOOKS: { id: LookId; name: string }[] = [
  { id: "clean", name: "Clean" },
  { id: "film", name: "Film" },
  { id: "crush", name: "Crush" },
  { id: "cool", name: "Cool" },
  { id: "fade", name: "Fade" },
];

export const FRAMINGS: { id: FramingId; name: string }[] = [
  { id: "fill", name: "Fill" },
  { id: "offset", name: "Offset" },
  { id: "letterbox", name: "Letterbox" },
  { id: "punch", name: "Punch-in" },
];

export const PACINGS: { id: PacingId; name: string; blurb: string }[] = [
  { id: "smart", name: "Smart", blurb: "Downbeats, extra cuts when the track opens up." },
  { id: "steady", name: "Steady", blurb: "Even cuts, every other beat." },
  { id: "energy", name: "Energy", blurb: "Dense where the mix is loud, held where it isn’t." },
];

export const DEMO_LYRICS = `chasing the feeling
all night
never coming down
hold the line
out past midnight
we don't talk about it
keep the lights low
let it ride`;

export const BATCH_SIZES = [12, 24, 36, 48] as const;
