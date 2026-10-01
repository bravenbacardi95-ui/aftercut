import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LyricEditor } from "@/components/studio/lyric-editor";
import { RegionScrubber } from "@/components/studio/region-scrubber";
import { SplitPane } from "@/components/studio/split-pane";
import { PhonePreview, Transport, useLivePreview } from "@/components/studio/studio-ui";
import { WordTimeline } from "@/components/studio/word-timeline";
import { formatTime } from "@/lib/studio/beats";
import { useStudioLayout } from "@/lib/studio/layout";
import { resolveCutClips } from "@/lib/studio/packs";
import { useStudio } from "@/lib/studio/store";
import { playWordsWithClicks, stopClicks } from "@/lib/studio/click-track";
import { prepareVocalStem } from "@/lib/studio/vocal-stem";

export function SetupWindow() {
  const analysis = useStudio((s) => s.analysis);
  const transcribing = useStudio((s) => s.transcribing);
  const setStep = useStudio((s) => s.setStep);
  const selectedClipIds = useStudio((s) => s.selectedClipIds);
  const userClips = useStudio((s) => s.userClips);
  const vaultClips = useStudio((s) => s.vaultClips);
  const timelineH = useStudioLayout((s) => s.timelineH);
  const previewW = useStudioLayout((s) => s.previewW);
  const setTimelineH = useStudioLayout((s) => s.setTimelineH);
  const setPreviewW = useStudioLayout((s) => s.setPreviewW);
  const navigate = useNavigate();
  const mode = useStudio((s) => s.mode);
  const recipe = useLivePreview();
  const cut = resolveCutClips(selectedClipIds, [...userClips, ...vaultClips]);

  if (!analysis) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">Reading the track…</div>
    );
  }

  const form = (
    <SetupForm
      bpm={analysis.bpm}
      duration={analysis.duration}
      beats={analysis.beats.length}
      transcribing={transcribing}
      cut={cut}
      mode={mode}
      onContinue={() => {
        if (mode === "single") {
          const state = useStudio.getState();
          if (!state.recipes.some((recipe) => recipe.id === "single") && state.clips().length) state.makeSingle();
          setStep("edit");
          void navigate({ href: "/studio/editor" });
          return;
        }
        setStep("footage");
        void navigate({ href: "/studio/footage" });
      }}
    />
  );

  const preview = (
    <section className="flex h-full min-h-0 flex-col items-stretch gap-2 overflow-hidden bg-surface p-3">
      <Transport compact />
      <div className="min-h-0 flex-1 overflow-hidden">
        <PhonePreview recipe={recipe} />
      </div>
    </section>
  );

  return (
    <SplitPane axis="y" size={timelineH} onChange={setTimelineH} min={148} max={520} className="h-full">
      <div className="h-full min-h-0">
        <div className="hidden h-full lg:block">
          <SplitPane axis="x" size={previewW} onChange={setPreviewW} min={160} max={560} className="h-full">
            <aside className="h-full min-h-0 overflow-y-scroll p-4">{form}</aside>
            {preview}
          </SplitPane>
        </div>
        <div className="h-full overflow-y-auto p-4 lg:hidden">{form}</div>
      </div>
      <WordTimeline />
    </SplitPane>
  );
}

function SetupForm({
  bpm,
  duration,
  beats,
  transcribing,
  cut,
  mode,
  onContinue,
}: {
  bpm: number;
  duration: number;
  beats: number;
  transcribing: boolean;
  cut: { id: string; poster?: string; src: string; name: string }[];
  mode: "single" | "batch";
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-medium">Set it up once</h1>
        <p className="mt-1 text-sm text-muted">
          {bpm} BPM · {formatTime(duration)} · {beats} beats
          {transcribing ? " · hearing lyrics" : ""}
        </p>
      </div>
      <div>
        <span className="text-xs font-medium uppercase tracking-[0.14em] text-subtle">Snippet</span>
        <RegionScrubber />
        <VocalIsolate />
      </div>
      <PasteLyrics />
      <LyricEditor compact actions={false} />
      <div>
        <p className="text-sm text-muted">
          {mode === "single"
            ? cut.length
              ? `${cut.length} clips ready. Order and length are on the video.`
              : "The video opens with the stock cut. Swap clips there."
            : cut.length
              ? `${cut.length} clips in the shared pool.`
              : "Pick the clips the batch can use."}
        </p>
        <Button type="button" className="mt-3" onClick={onContinue}>
          {mode === "single" ? "Edit the video" : "Choose clips"}
        </Button>
      </div>
    </div>
  );
}

function VocalIsolate() {
  const isolateVocals = useStudio((s) => s.isolateVocals);
  const setIsolateVocals = useStudio((s) => s.setIsolateVocals);
  const onsetSnap = useStudio((s) => s.onsetSnap);
  const setOnsetSnap = useStudio((s) => s.setOnsetSnap);
  const region = useStudio((s) => s.region);
  const audioUrl = useStudio((s) => s.audioUrl);
  const transcribing = useStudio((s) => s.transcribing);
  const speechEngine = useStudio((s) => s.speechEngine);
  const [note, setNote] = useState<string | null>(null);
  const [noteError, setNoteError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);

  const solo = async () => {
    setBusy(true);
    setNoteError(false);
    setNote("Isolating vocals…");
    const stem = await prepareVocalStem({
      audioUrl,
      region,
      isolate: true,
      onStatus: (label) => {
        setNoteError(false);
        setNote(label);
      },
    });
    setBusy(false);
    if (!stem?.isolated) {
      setNote(stem?.error ?? "Vocal isolation failed.");
      setNoteError(true);
      return;
    }
    const player = new Audio(stem.url);
    player.onended = () => {
      setPlaying(false);
      setNote("Isolated vocal is ready.");
      setNoteError(false);
    };
    try {
      await player.play();
      setPlaying(true);
      setNote(stem.cached ? "Playing the saved vocal stem." : "Playing the isolated vocal.");
      setNoteError(false);
    } catch {
      setPlaying(false);
      setNote("Couldn’t play the vocal stem.");
      setNoteError(true);
    }
  };

  return (
    <div className="mt-3 flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          checked={isolateVocals}
          onChange={(e) => setIsolateVocals(e.target.checked)}
          disabled={transcribing}
        />
        Isolate vocals (recommended)
      </label>
      <label className="flex items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          checked={onsetSnap}
          onChange={(e) => setOnsetSnap(e.target.checked)}
          disabled={transcribing}
        />
        Snap starts to onsets
      </label>
      <p className="text-xs text-muted">Off by default. Applies on the next sync. At most 40 ms earlier or later, and only on the isolated vocal.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={playing || busy ? "primary" : "secondary"}
          size="sm"
          aria-pressed={playing}
          aria-busy={busy}
          onClick={() => void solo()}
          disabled={busy || transcribing || speechEngine === "down"}
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {busy ? "Isolating…" : playing ? "Playing vocal" : "Solo vocal"}
        </Button>
        {note ? (
          <p className={noteError ? "text-xs text-danger" : "text-xs text-muted"} role={noteError ? "alert" : "status"}>
            {note}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PasteLyrics() {
  const lyricDraft = useStudio((s) => s.lyricDraft);
  const setLyricDraft = useStudio((s) => s.setLyricDraft);
  const syncLyrics = useStudio((s) => s.syncLyrics);
  const transcribe = useStudio((s) => s.transcribe);
  const transcribing = useStudio((s) => s.transcribing);
  const transcribeStatus = useStudio((s) => s.transcribeStatus);
  const syncProgress = useStudio((s) => s.syncProgress);
  const region = useStudio((s) => s.region);
  const last = useStudio((s) => s.lastTranscribedRegion);
  const words = useStudio((s) => s.words);
  const notice = useStudio((s) => s.notice);
  const noticeError = useStudio((s) => s.noticeError);
  const speechEngine = useStudio((s) => s.speechEngine);
  const isolateVocals = useStudio((s) => s.isolateVocals);
  const syncOffsetMs = useStudio((s) => s.syncOffsetMs);
  const setSyncOffset = useStudio((s) => s.setSyncOffset);
  const drifted = Boolean(
    last &&
      words.length &&
      (Math.abs(last.start - region.start) > 0.08 || Math.abs(last.end - region.end) > 0.08),
  );
  const [clicks, setClicks] = useState<"idle" | "playing">("idle");
  const transcribeBlocked = speechEngine === "down" && isolateVocals;
  const percent = syncProgress == null ? null : Math.max(0, Math.min(100, syncProgress));

  return (
    <div>
      <label className="text-xs font-medium uppercase tracking-[0.14em] text-subtle" htmlFor="paste-lyrics">
        Paste your lyrics (recommended)
      </label>
      <textarea
        id="paste-lyrics"
        value={lyricDraft}
        onChange={(e) => setLyricDraft(e.target.value)}
        rows={8}
        spellCheck={false}
        disabled={transcribing}
        placeholder="Paste the lines for this snippet. Each line stays its own caption."
        className="mt-2 min-h-40 w-full resize-y rounded-lg bg-elevated px-3 py-2 text-sm leading-relaxed text-fg shadow-[0_0_0_1px_rgba(242,239,232,0.08)] outline-none focus:shadow-[0_0_0_1px_rgba(236,231,220,0.45)]"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" onClick={() => void syncLyrics()} disabled={transcribing || !lyricDraft.trim() || speechEngine === "down"}>
          Sync lyrics
        </Button>
        <Button type="button" variant="secondary" onClick={() => void transcribe()} disabled={transcribing || transcribeBlocked}>
          Transcribe instead
        </Button>
        {drifted ? (
          <Button type="button" variant="secondary" onClick={() => void syncLyrics()} disabled={transcribing || !lyricDraft.trim() || speechEngine === "down"}>
            Re-sync to new window
          </Button>
        ) : null}
      </div>
      <label className="mt-3 flex items-center gap-3 text-xs text-muted">
        Sync offset
        <input
          type="range"
          min={-200}
          max={200}
          step={5}
          value={syncOffsetMs}
          onChange={(e) => setSyncOffset(Number(e.target.value))}
          disabled={!words.length || transcribing}
          className="w-40"
        />
        <span className="w-14 text-fg">{syncOffsetMs > 0 ? `+${syncOffsetMs}` : syncOffsetMs} ms</span>
      </label>
      <div className="mt-2">
        <Button
          type="button"
          variant={clicks === "playing" ? "primary" : "secondary"}
          size="sm"
          aria-pressed={clicks === "playing"}
          disabled={!words.length || transcribing}
          onClick={() => {
            if (clicks === "playing") {
              stopClicks();
              setClicks("idle");
              return;
            }
            setClicks("playing");
            void playWordsWithClicks(words, region).finally(() => setClicks("idle"));
          }}
        >
          {clicks === "playing" ? "Playing clicks" : "Play with clicks"}
        </Button>
      </div>
      {transcribing ? (
        <div className="mt-3" role="status">
          <div className="h-1 overflow-hidden rounded-full bg-elevated">
            <div
              className={percent == null ? "h-full w-1/3 animate-pulse bg-accent" : "h-full bg-accent transition-[width] duration-200"}
              style={percent == null ? undefined : { width: `${percent}%` }}
            />
          </div>
          <p className="mt-1 text-sm text-fg">{transcribeStatus || "Working…"}</p>
        </div>
      ) : null}
      {notice ? (
        <p className={noticeError ? "mt-2 text-sm text-danger" : "mt-2 text-sm text-muted"} role={noticeError ? "alert" : "status"}>
          {notice}
        </p>
      ) : null}
    </div>
  );
}
