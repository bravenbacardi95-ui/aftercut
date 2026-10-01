import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { BRAND } from "@/lib/brand";

export const Route = createFileRoute("/about")({
  component: About,
  head: () => ({
    meta: [{ title: `About · ${BRAND.name}` }],
  }),
});

function About() {
  return (
    <div className="min-h-screen bg-bg">
      <SiteHeader solid />
      <main className="mx-auto max-w-2xl px-4 py-16 md:px-8">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-muted">About</p>
        <h1 className="mt-3 font-serif text-4xl tracking-tight md:text-5xl">Upload the song, pick footage, post the result.</h1>
        <div className="mt-8 space-y-5 text-base leading-relaxed text-muted">
          <p>
            {BRAND.name} is a replica of the batch-video studio musicians use after a track is finished — beat-synced cuts,
            word-timed lyric captions, a wall of versions to choose from. The original product caps a batch at ten and a
            basic plan at sixty exports a month. That is the part we did not keep.
          </p>
          <p>
            Drop a track, set the snippet, then paste the lyrics or press Transcribe. Cloud speech-to-text runs on the
            isolated vocal; if that service is down, the same stem is heard in the browser. Sample lyrics are never
            filled in. Every word lands on a timeline you can stretch, rewrite, add, or delete. Brat is the default caption —
            a justified lowercase block on white, with green and black plates — and Clean, Editorial, and Poster still sit
            next to one-word, whole-line, karaoke, and typewriter. Beat detection, packs, and
            export still run in this browser — one video, or the whole wall as a zip.
          </p>
          <p>{BRAND.tagline}</p>
        </div>
        <Link
          to="/studio"
          className="mt-10 inline-flex h-12 items-center rounded-xl bg-accent px-5 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
        >
          Explore the studio
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
