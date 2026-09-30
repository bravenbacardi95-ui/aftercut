import { createFileRoute, Link } from "@tanstack/react-router";
import { AudioLines, Captions, Download, Grid2x2, Scissors, SlidersHorizontal } from "lucide-react";
import { DropTrack } from "@/components/drop-track";
import { PhoneFrame, PlatformChrome } from "@/components/phone-frame";
import { SiteFooter, SiteHeader } from "@/components/site-header";

export const Route = createFileRoute("/")({ component: Home });

const demos = [
  {
    src: "/packs/motion/tunnel.mp4",
    poster: "/packs/motion/tunnel.jpg",
    caption: "chasing the feeling",
    variant: "tiktok" as const,
    look: "",
  },
  {
    src: "/packs/motion/ocean.mp4",
    poster: "/packs/motion/ocean.jpg",
    caption: "all night",
    variant: "reels" as const,
    look: "",
  },
  {
    src: "/packs/motion/club.mp4",
    poster: "/packs/motion/club.jpg",
    caption: "keep the lights low",
    variant: "tiktok" as const,
    look: "",
  },
  {
    src: "/packs/motion/grass.mp4",
    poster: "/packs/motion/grass.jpg",
    caption: "let it ride",
    variant: "reels" as const,
    look: "",
  },
];

function Home() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-bg">
      <SiteHeader />
      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-8 pt-6 md:px-8 lg:grid-cols-2 lg:gap-8 lg:pt-10">
          <div className="text-center lg:text-left">
            <p className="mb-5 text-sm font-semibold uppercase tracking-[0.35em] text-muted">aftercut</p>
            <h1 className="font-serif text-4xl leading-[1.08] tracking-tight text-fg md:text-5xl xl:text-[3.5rem]">
              Consistent content for artists, without the cap.
            </h1>
            <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-muted lg:mx-0">
              Drop a track. Aftercut hears the vocal and times every word. Make one video and control the clip order yourself, or build a wall of up to 48 versions. Unlimited exports.
            </p>
            <div className="mt-8 flex justify-center lg:justify-start">
              <DropTrack />
            </div>
          </div>
          <div className="w-full max-w-full overflow-hidden">
            <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2">
              {demos.map((d) => (
                <div key={d.src} className="w-[14rem] shrink-0 sm:w-[16rem]">
                  <PhoneFrame caption={d.caption}>
                    <video
                      src={d.src}
                      poster={d.poster}
                      muted
                      loop
                      playsInline
                      autoPlay
                      preload="metadata"
                      className={`block h-full w-full object-cover ${d.look}`.trim()}
                    />
                    <PlatformChrome variant={d.variant} />
                  </PhoneFrame>
                </div>
              ))}
            </div>
            <p className="mt-3 px-4 text-xs uppercase tracking-[0.16em] text-subtle md:px-0">
              Real exports, straight out of the studio
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-24">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-muted">How it works</p>
          <h2 className="mt-3 font-serif text-3xl tracking-tight md:text-4xl">From finished track to posted clip.</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {[
              {
                n: "1",
                t: "Set it up once",
                d: "Scrub the exact snippet. Vocals are transcribed and laid on the rhythm while you pick a pack of clips.",
              },
              {
                n: "2",
                t: "Choose what gets varied",
                d: "Caption styles, looks, and framings. Every version lands its own cuts on the beat, so no two come out the same.",
              },
              {
                n: "3",
                t: "Keep the ones that land",
                d: "A wall of finished videos comes back — up to 48. Edit any word on the timeline, then export the keepers.",
              },
            ].map((s) => (
              <li key={s.n} className="rounded-xl bg-surface p-6 shadow-[0_0_0_1px_rgba(242,239,232,0.08)]">
                <p className="font-serif text-3xl text-muted">{s.n}</p>
                <h3 className="mt-3 text-lg font-medium">{s.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-16 md:px-8 md:pb-24">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-muted">What’s inside</p>
          <h2 className="mt-3 font-serif text-3xl tracking-tight md:text-4xl">One studio, everything included.</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: Scissors, t: "Cuts that hit the beat", d: "Automatic beat detection with smart, steady, or energy-driven pacing." },
              {
                icon: Captions,
                t: "Word-level lyric timing",
                d: "The vocal is transcribed into the editor. Demo lyrics are never kept. Every word is a bubble you can rewrite or stretch to the millisecond.",
              },
              { icon: Grid2x2, t: "48 at a time", d: "Other studios stop at 10. Aftercut builds a full wall so you can actually choose." },
              { icon: Download, t: "Unlimited exports", d: "No 60-a-month ceiling. Download every keeper, every batch, no account." },
              { icon: AudioLines, t: "Packs included", d: "Night drive, tape room, after hours, grain — or drop in your own clips." },
              {
                icon: SlidersHorizontal,
                t: "Brat, plus the rest of the type",
                d: "Brat, Clean, Editorial, and Poster on every version — plus karaoke, stacked, and the lime full-bleed look.",
              },
            ].map((f) => (
              <div key={f.t} className="rounded-xl bg-surface p-5 shadow-[0_0_0_1px_rgba(242,239,232,0.08)]">
                <f.icon className="size-5 text-muted" aria-hidden />
                <h3 className="mt-4 text-base font-medium">{f.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-border bg-surface">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-4 py-16 md:flex-row md:items-center md:px-8">
            <div>
              <h2 className="font-serif text-3xl tracking-tight md:text-4xl">Your audience is one song away.</h2>
              <p className="mt-3 max-w-lg text-muted">
                Bring a song, cut a wall of videos, export the ones that land. Compared with a 10-at-a-time / 60-export
                plan, Aftercut does not meter the work.
              </p>
            </div>
            <Link
              to="/studio"
              className="inline-flex h-12 items-center rounded-xl bg-accent px-5 text-base font-medium text-accent-fg transition-opacity hover:opacity-90"
            >
              Open the studio
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
