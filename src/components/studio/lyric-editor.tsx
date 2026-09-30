import { useEffect, useState } from "react";
import { LoaderCircle, Mic, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMs } from "@/lib/studio/beats";
import { lyricKey } from "@/lib/studio/lyric-bank";
import { useStudio } from "@/lib/studio/store";
import { warmTranscriber } from "@/lib/studio/whisper";
import { cn } from "@/lib/utils";
import { usePlayback } from "./playback";

const CHIP = ["bg-lyric-a", "bg-lyric-b", "bg-lyric-c", "bg-lyric-d"] as const;

export function LyricEditor({ compact = false, actions = true }: { compact?: boolean; actions?: boolean }) {
  const lyricDraft = useStudio((s) => s.lyricDraft);
  const setLyricDraft = useStudio((s) => s.setLyricDraft);
  const applyLyrics = useStudio((s) => s.applyLyrics);
  const transcribe = useStudio((s) => s.transcribe);
  const syncLyrics = useStudio((s) => s.syncLyrics);
  const transcribing = useStudio((s) => s.transcribing);
  const transcribeStatus = useStudio((s) => s.transcribeStatus);
  const source = useStudio((s) => s.transcribeSource);
  const notice = useStudio((s) => s.notice);
  const noticeError = useStudio((s) => s.noticeError);
  const words = useStudio((s) => s.words);
  const lyrics = useStudio((s) => s.lyrics);
  const selectedWordId = useStudio((s) => s.selectedWordId);
  const selectWord = useStudio((s) => s.selectWord);
  const updateWordText = useStudio((s) => s.updateWordText);
  const resizeWordEdge = useStudio((s) => s.resizeWordEdge);
  const nudgeSelected = useStudio((s) => s.nudgeSelected);
  const nudgeLine = useStudio((s) => s.nudgeLine);
  const { seek } = usePlayback();
  const lyricBank = useStudio((s) => s.lyricBank);
  const saveLyricVersion = useStudio((s) => s.saveLyricVersion);
  const loadLyricVersion = useStudio((s) => s.loadLyricVersion);
  const deleteLyricVersion = useStudio((s) => s.deleteLyricVersion);
  const trackName = useStudio((s) => s.trackName);
  const analysis = useStudio((s) => s.analysis);
  const region = useStudio((s) => s.region);
  const lastRegion = useStudio((s) => s.lastTranscribedRegion);
  const activeLyricId = useStudio((s) => s.activeLyricId);
  const songKey = lyricKey(trackName, analysis?.duration ?? 0);
  const [mode, setMode] = useState<"words" | "text" | "transcribe">("words");
  const [versionName, setVersionName] = useState("");

  useEffect(() => {
    if (mode !== "transcribe") return;
    warmTranscriber();
  }, [mode]);

  const selected = words.find((w) => w.id === selectedWordId) ?? null;

  const sourceLabel =
    source === "stt"
      ? "Transcribed from the vocal"
      : source === "aligned"
        ? "Synced to this snippet"
        : source === "manual"
          ? "Edited by you"
          : transcribing
            ? "Listening"
            : "Waiting";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-[0.14em] text-subtle">Lyrics</span>
        <span className="text-xs text-subtle">
          {words.length} word{words.length === 1 ? "" : "s"} · {sourceLabel}
        </span>
      </div>

      <div className="mt-2 flex gap-1">
        <button
          type="button"
          onClick={() => setMode("words")}
          className={cn(
            "h-8 rounded-md px-2.5 text-xs",
            mode === "words" ? "bg-elevated text-fg" : "text-muted hover:text-fg",
          )}
        >
          Words
        </button>
        <button
          type="button"
          onClick={() => setMode("text")}
          className={cn(
            "h-8 rounded-md px-2.5 text-xs",
            mode === "text" ? "bg-elevated text-fg" : "text-muted hover:text-fg",
          )}
        >
          Text
        </button>
        <button
          type="button"
          onClick={() => setMode("transcribe")}
          className={cn(
            "h-8 rounded-md px-2.5 text-xs",
            mode === "transcribe" ? "bg-elevated text-fg" : "text-muted hover:text-fg",
          )}
        >
          Transcribe
        </button>
      </div>

      <div className="mt-3 rounded-lg bg-elevated p-2 shadow-[0_0_0_1px_rgba(242,239,232,0.08)]">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-subtle">Lyric history</p>
        <div className="mt-2 flex gap-1">
          <input
            value={versionName}
            onChange={(e) => setVersionName(e.target.value)}
            placeholder={trackName ? `${trackName} take` : "Name this version"}
            className="h-8 min-w-0 flex-1 rounded-md bg-surface px-2 text-xs text-fg outline-none"
          />
          <Button
            type="button"
            size="sm"
            disabled={!words.length && !lyricDraft.trim()}
            onClick={() => {
              saveLyricVersion(versionName || `${trackName || "Track"} take`);
              setVersionName("");
            }}
          >
            Save
          </Button>
        </div>
        {lyricBank.length ? (
          <ul className="mt-2 max-h-36 space-y-1 overflow-y-scroll">
            {lyricBank.map((v) => (
              <li key={v.id} className="flex items-center gap-1">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate rounded px-1 py-1 text-left text-xs text-fg hover:bg-surface"
                  onClick={() => loadLyricVersion(v.id)}
                  title={`${v.trackName} · ${v.words.length} words`}
                >
                  {v.name}
                  <span className="ml-1 text-subtle">
                    {(v.key ?? lyricKey(v.trackName, v.duration ?? 0)) === songKey || v.id === activeLyricId
                      ? "this song · "
                      : `${v.trackName} · `}
                    {v.words.length}w
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${v.name}`}
                  className="rounded p-1 text-subtle hover:text-fg"
                  onClick={() => deleteLyricVersion(v.id)}
                >
                  <Trash2 className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[11px] text-subtle">Save a take after the words are right. It stays in this browser.</p>
        )}
      </div>

      {transcribing ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-fg" role="status">
          <LoaderCircle className="size-4 shrink-0 animate-spin text-muted" />
          {transcribeStatus || "Hearing lyrics…"}
        </p>
      ) : null}
      {mode === "text" ? (
        <textarea
          value={lyricDraft}
          onChange={(e) => setLyricDraft(e.target.value)}
          onBlur={applyLyrics}
          rows={compact ? 6 : 12}
          spellCheck={false}
          className="mt-2 min-h-36 w-full flex-1 resize-none rounded-lg bg-elevated px-3 py-2 text-sm leading-relaxed text-fg shadow-[0_0_0_1px_rgba(242,239,232,0.08)] outline-none focus:shadow-[0_0_0_1px_rgba(236,231,220,0.45)]"
          data-studio-undo=""
          placeholder="Paste lyrics, one phrase per line. Nothing is filled in until you sync or transcribe."
        />
      ) : mode === "transcribe" ? (
        <div className="mt-2 flex flex-1 flex-col gap-3 rounded-lg bg-elevated px-3 py-3 shadow-[0_0_0_1px_rgba(242,239,232,0.08)]">
          <p className="text-sm text-muted">
            Transcribe this snippet from the isolated vocal. If cloud speech-to-text is down, the browser model takes the same stem. Nothing is invented if both fail.
          </p>
          <Button type="button" onClick={() => void transcribe()} disabled={transcribing}>
            {transcribing ? "Transcribing…" : "Transcribe instead"}
          </Button>
          {notice ? (
            <p className={noticeError ? "text-sm text-danger" : "text-sm text-muted"} role={noticeError ? "alert" : "status"}>
              {notice}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-2 min-h-0 flex-1 overflow-y-scroll rounded-lg bg-elevated px-3 py-3 shadow-[0_0_0_1px_rgba(242,239,232,0.08)]">
          {lyrics.length ? (
            <div className="flex flex-col gap-3">
              {lyrics.map((line, index) => (
                <div key={line.id} className="flex items-start gap-2">
                  <div className="mt-0.5 flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      className="rounded px-1 text-xs text-subtle hover:text-fg"
                      title="Nudge this line 20 ms earlier"
                      onClick={() => nudgeLine(index, -20)}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      className="rounded px-1 text-xs text-subtle hover:text-fg"
                      title="Nudge this line 20 ms later"
                      onClick={() => nudgeLine(index, 20)}
                    >
                      +
                    </button>
                  </div>
                  <p className="flex flex-wrap gap-1.5">
                  {line.words.map((word) => {
                    const selected = word.id === selectedWordId;
                    return (
                      <button
                        key={word.id}
                        type="button"
                        onClick={() => {
                          selectWord(word.id);
                          seek(word.start);
                        }}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          const next = window.prompt("Word", word.text);
                          if (next !== null) updateWordText(word.id, next);
                        }}
                        className={cn(
                          "rounded-md px-1.5 py-0.5 text-sm font-medium text-lyric-fg",
                          CHIP[Math.abs(word.line) % CHIP.length],
                          selected ? "ring-2 ring-accent" : "opacity-90 hover:opacity-100",
                        )}
                      >
                        {word.text}
                      </button>
                    );
                  })}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">
              No words yet. Paste lyrics on Setup, then Sync lyrics. Or transcribe this snippet.
            </p>
          )}
        </div>
      )}

      {selected ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-elevated px-2 py-2">
          <input
            value={selected.text}
            onChange={(e) => updateWordText(selected.id, e.target.value)}
            className="h-8 w-28 rounded-md bg-surface px-2 text-sm text-fg outline-none"
            aria-label="Selected word"
            data-studio-undo=""
          />
          <label className="flex items-center gap-1 text-xs text-muted">
            In
            <input
              type="number"
              step="0.01"
              value={Number(selected.start.toFixed(2))}
              onChange={(e) => resizeWordEdge(selected.id, "start", Number(e.target.value))}
              className="h-8 w-[4.5rem] rounded-md bg-surface px-1.5 font-mono text-xs text-fg outline-none"
              data-studio-undo=""
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted">
            Out
            <input
              type="number"
              step="0.01"
              value={Number(selected.end.toFixed(2))}
              onChange={(e) => resizeWordEdge(selected.id, "end", Number(e.target.value))}
              className="h-8 w-[4.5rem] rounded-md bg-surface px-1.5 font-mono text-xs text-fg outline-none"
              data-studio-undo=""
            />
          </label>
          <span className="font-mono text-xs text-subtle">{formatMs(selected.end - selected.start)}</span>
          <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => nudgeSelected(-0.01)}>
            −10 ms
          </button>
          <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => nudgeSelected(0.01)}>
            +10 ms
          </button>
        </div>
      ) : null}

      {actions ? (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => void transcribe()} disabled={transcribing}>
          {transcribing ? <LoaderCircle className="size-4 animate-spin" /> : <Mic className="size-4" />}
          {transcribing ? "Transcribing…" : "Transcribe instead"}
        </Button>
        {lastRegion &&
        words.length &&
        (Math.abs(lastRegion.start - region.start) > 0.08 || Math.abs(lastRegion.end - region.end) > 0.08) ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => void syncLyrics()} disabled={transcribing}>
            Re-sync to new window
          </Button>
        ) : null}
        <p className="text-xs text-subtle">Click a word to jump. Double-click to rename. Timing lives on the timeline.</p>
      </div>
      ) : null}
      {notice ? (
        <p className={noticeError ? "mt-2 text-sm text-danger" : "mt-2 text-xs text-muted"} role={noticeError ? "alert" : "status"}>
          {notice}
        </p>
      ) : null}
    </div>
  );
}
