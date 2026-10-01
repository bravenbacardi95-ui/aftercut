import { useEffect, useRef } from "react";
import { PhoneFrame, PlatformChrome } from "@/components/phone-frame";
import { drawFrame, ensureCaptionFonts } from "@/lib/studio/compositor";
import { getVideo } from "@/lib/studio/media";
import { resolveCutClips } from "@/lib/studio/packs";
import type { CaptionFontId, CaptionStyleId, FramingId, LookId, LyricLine, Recipe } from "@/lib/studio/types";

const LOOP = 8;

function line(id: string, text: string, start: number, end: number): LyricLine {
  const parts = text.split(" ");
  const span = (end - start) / parts.length;
  return {
    id,
    text,
    start,
    end,
    words: parts.map((word, i) => ({
      id: `${id}-${i}`,
      text: word,
      start: start + span * i,
      end: start + span * (i + 1),
      line: 0,
    })),
  };
}

const LYRICS: LyricLine[] = [
  line("a", "chasing the feeling", 0.2, 2.1),
  line("b", "all night", 2.2, 3.6),
  line("c", "keep the lights low", 3.7, 5.8),
  line("d", "let it ride", 5.9, 7.6),
];

const REELS: {
  clip: string;
  font: CaptionFontId;
  style: CaptionStyleId;
  look: LookId;
  framing: FramingId;
  variant: "tiktok" | "reels";
  seed: number;
}[] = [
  { clip: "nd-tunnel", font: "brat", style: "brat", look: "clean", framing: "fill", variant: "tiktok", seed: 3 },
  { clip: "gr-ocean", font: "editorial", style: "karaoke", look: "cool", framing: "letterbox", variant: "reels", seed: 8 },
  { clip: "ah-club", font: "poster", style: "word", look: "crush", framing: "punch", variant: "tiktok", seed: 14 },
  { clip: "gr-grass", font: "clean", style: "typewriter", look: "fade", framing: "offset", variant: "reels", seed: 21 },
];

function recipeFor(index: number): Recipe {
  const spec = REELS[index]!;
  return {
    id: `landing-${index}`,
    index,
    captionStyle: spec.style,
    font: spec.font,
    effect: spec.style === "karaoke" ? "outline" : "none",
    look: spec.look,
    framing: spec.framing,
    pacing: "smart",
    seed: spec.seed,
    clipOrder: [0],
    clipIds: [spec.clip],
    cuts: [0, LOOP],
  };
}

function Reel({ index }: { index: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spec = REELS[index]!;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ensureCaptionFonts();
    const recipe = recipeFor(index);
    const clips = resolveCutClips(recipe.clipIds);
    const width = 360;
    const height = 640;
    canvas.width = width;
    canvas.height = height;
    for (const clip of clips) {
      if (clip.kind !== "video") continue;
      const video = getVideo(clip.src);
      video.muted = true;
      void video.play().catch(() => undefined);
    }
    let frame = 0;
    const started = performance.now();
    const paint = () => {
      const time = ((performance.now() - started) / 1000) % LOOP;
      drawFrame(ctx, { recipe, clips, lyrics: LYRICS, time, width, height, quality: "preview" });
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [index]);

  return (
    <PhoneFrame>
      <canvas ref={canvasRef} className="block h-full w-full" aria-label={`${spec.font} ${spec.style} ${spec.look}`} />
      <PlatformChrome variant={spec.variant} />
    </PhoneFrame>
  );
}

export function LandingReel() {
  return (
    <div className="w-full max-w-full overflow-hidden">
      <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2">
        {REELS.map((spec, index) => (
          <div key={spec.clip} className="w-[14rem] shrink-0 sm:w-[16rem]">
            <Reel index={index} />
          </div>
        ))}
      </div>
      <p className="mt-3 px-4 text-xs uppercase tracking-[0.16em] text-subtle md:px-0">
        Same compositor as the export — brat, whole line, karaoke, and looks
      </p>
    </div>
  );
}
