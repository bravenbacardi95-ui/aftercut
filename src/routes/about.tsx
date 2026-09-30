import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "@/components/site-header";

export const Route = createFileRoute("/about")({
  component: About,
  head: () => ({
    meta: [{ title: "About · Aftercut" }],
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
            Aftercut is a replica of the batch-video studio musicians use after a track is finished — beat-synced cuts,
            word-timed lyric captions, a wall of versions to choose from. The original product caps a batch at ten and a
            basic plan at sixty exports a month. That is the part we did not keep.
          </p>
          <p>
            Drop a track and the studio transcribes the vocal into the lyric editor — demo words are not reused.
            Every word lands on a timeline you can stretch, rewrite, add, or delete. Brat, Clean, Editorial, and
            Poster type sit next to the caption styles. Beat detection, packs, and export still run in this browser.
          </p>
          <p>Built for everything after the music is made.</p>
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
