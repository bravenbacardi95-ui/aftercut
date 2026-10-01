import { useEffect, useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { AppIcon } from "@/components/brand/logo";
import { useStudio } from "@/lib/studio/store";
import { SPEECH_ENGINE_DOWN } from "@/lib/studio/speech-error";
import { cn } from "@/lib/utils";

const SINGLE = [
  { to: "/studio/setup", id: "batch", label: "Setup" },
  { to: "/studio/editor", id: "editor", label: "Video" },
] as const;

const BATCH = [
  { to: "/studio/setup", id: "batch", label: "Setup" },
  { to: "/studio/footage", id: "footage", label: "Clips" },
  { to: "/studio/vary", id: "vary", label: "Variations" },
  { to: "/studio/wall", id: "wall", label: "Wall" },
  { to: "/studio/editor", id: "editor", label: "Editor" },
] as const;

export function DesktopShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const audioUrl = useStudio((s) => s.audioUrl);
  const trackName = useStudio((s) => s.trackName);
  const step = useStudio((s) => s.step);
  const mode = useStudio((s) => s.mode);
  const setMode = useStudio((s) => s.setMode);
  const error = useStudio((s) => s.error);
  const transcribing = useStudio((s) => s.transcribing);
  const transcribeStatus = useStudio((s) => s.transcribeStatus);
  const speechEngine = useStudio((s) => s.speechEngine);
  const exporting = useStudio((s) => s.exporting);
  const batchRows = useStudio((s) => s.batchRows);
  const batchNote = useStudio((s) => s.batchNote);
  const cancelBatchExport = useStudio((s) => s.cancelBatchExport);
  const batching = exporting && batchRows.length > 0;
  const batchDone = batchRows.filter((row) => row.progress >= 1).length;
  const batchCurrent = batchRows.find((row) => row.progress < 1);
  const batchIndex = Math.min(batchRows.length, batchDone + (batchCurrent ? 1 : 0));
  const windows = mode === "batch" ? BATCH : SINGLE;
  const current =
    windows.find((w) => pathname === w.to || pathname.startsWith(`${w.to}/`)) ??
    (audioUrl ? windows.find((w) => w.id === stepToWindow(step, mode)) : null);

  return (
    <div className="studio-app flex h-dvh flex-col overflow-hidden bg-bg">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-3 md:px-4">
        <Link to="/" className="inline-flex min-w-0 items-center gap-2 text-fg hover:opacity-70">
          <AppIcon size={24} />
          <span className="max-w-[16rem] truncate text-xs text-fg">{trackName || "studio"}</span>
        </Link>
        {audioUrl ? (
          <>
            <FileMenu />
            <EditMenu />
            <ViewMenu />
          </>
        ) : null}
        <span className="ml-auto">
          <Clock />
        </span>
      </header>
      {audioUrl ? (
        <nav className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5" aria-label="Windows">
          <div className="mr-2 flex rounded-md bg-elevated p-0.5" role="group" aria-label="Edit mode">
            <button
              type="button"
              aria-pressed={mode === "single"}
              className={cn("rounded px-2.5 py-1 text-sm", mode === "single" ? "bg-fg text-bg" : "text-muted hover:text-fg")}
              onClick={() => {
                setMode("single");
                const state = useStudio.getState();
                if (state.analysis && state.clips().length && !state.recipes.some((recipe) => recipe.id === "single")) state.makeSingle();
                void navigate({ href: "/studio/editor" });
              }}
            >
              One video
            </button>
            <button
              type="button"
              aria-pressed={mode === "batch"}
              className={cn("rounded px-2.5 py-1 text-sm", mode === "batch" ? "bg-fg text-bg" : "text-muted hover:text-fg")}
              onClick={() => {
                setMode("batch");
                void navigate({ href: "/studio/vary" });
              }}
            >
              Batch
            </button>
          </div>
          {windows.map((w) => (
            <a
              key={w.id}
              href={w.to}
              aria-current={current?.id === w.id ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-[background-color,color] duration-150",
                current?.id === w.id ? "bg-elevated text-fg" : "text-muted hover:text-fg",
              )}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                void navigate({ href: w.to });
              }}
            >
              {w.label}
            </a>
          ))}
        </nav>
      ) : null}
      {transcribing ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-elevated px-4 py-2 text-sm text-fg" role="status">
          <LoaderCircle className="size-4 shrink-0 animate-spin text-muted" />
          <span>{transcribeStatus || "Hearing lyrics…"}</span>
          <span className="text-muted">The studio stays usable while this runs.</span>
        </div>
      ) : null}
      {speechEngine === "down" ? (
        <p className="shrink-0 border-b border-border bg-elevated px-4 py-2 text-sm text-fg" role="status">
          {SPEECH_ENGINE_DOWN}
        </p>
      ) : null}
      {error ? (
        <p className="shrink-0 border-b border-border bg-elevated px-4 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {batching ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-elevated px-4 py-2 text-sm text-fg" role="status">
          <LoaderCircle className="size-4 shrink-0 animate-spin text-muted" />
          <span className="min-w-0 truncate">
            Exporting {batchIndex} of {batchRows.length}
            {batchCurrent ? ` · ${batchCurrent.label}` : ""}
          </span>
          <div className="hidden h-1 w-24 overflow-hidden rounded-full bg-bg sm:block">
            <div className="h-full bg-fg" style={{ width: `${Math.round((batchCurrent?.progress ?? 1) * 100)}%` }} />
          </div>
          <button type="button" className="ml-auto shrink-0 text-sm text-muted hover:text-fg" onClick={() => cancelBatchExport()}>
            Cancel
          </button>
        </div>
      ) : null}
      {!exporting && batchNote ? (
        <p className="shrink-0 border-b border-border bg-elevated px-4 py-2 text-sm text-muted" role="status">
          {batchNote}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function stepToWindow(step: string, mode: "single" | "batch") {
  if (mode === "single") return step === "setup" ? "batch" : "editor";
  if (step === "footage") return "footage";
  if (step === "vary") return "vary";
  if (step === "wall") return "wall";
  if (step === "edit") return "editor";
  return "batch";
}

function FileMenu() {
  const navigate = useNavigate();
  const reset = useStudio((s) => s.reset);
  const loadFile = useStudio((s) => s.loadFile);
  return (
    <>
      <Menu label="File">
        <MenuItem
          onClick={() => {
            reset();
            void navigate({ href: "/studio" });
          }}
        >
          New track
        </MenuItem>
        <label
          htmlFor="studio-open-file"
          className="flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-sm text-fg hover:bg-elevated"
        >
          Open…
        </label>
      </Menu>
      <input
        id="studio-open-file"
        type="file"
        accept="audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/mp4,.mp3,.wav,.flac,.m4a,.ogg"
        className="file-picker"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.currentTarget.value = "";
          if (file) void loadFile(file).then(() => navigate({ href: "/studio/setup" }));
        }}
      />
    </>
  );
}

function EditMenu() {
  const transcribe = useStudio((s) => s.transcribe);
  const addWordAt = useStudio((s) => s.addWordAt);
  const deleteWord = useStudio((s) => s.deleteWord);
  const undo = useStudio((s) => s.undo);
  const redo = useStudio((s) => s.redo);
  const canUndo = useStudio((s) => s.canUndo);
  const canRedo = useStudio((s) => s.canRedo);
  const selectedWordId = useStudio((s) => s.selectedWordId);
  const region = useStudio((s) => s.region);
  const saveLyricVersion = useStudio((s) => s.saveLyricVersion);
  const trackName = useStudio((s) => s.trackName);
  const words = useStudio((s) => s.words);
  const transcribing = useStudio((s) => s.transcribing);
  return (
    <Menu label="Edit">
      <MenuItem disabled={!canUndo} hint="⌘Z" onClick={() => undo()}>
        Undo
      </MenuItem>
      <MenuItem disabled={!canRedo} hint="⇧⌘Z" onClick={() => redo()}>
        Redo
      </MenuItem>
      <MenuItem
        disabled={!words.length}
        onClick={() => saveLyricVersion(`${trackName || "Track"} take`)}
      >
        Save lyric version
      </MenuItem>
      <MenuItem disabled={transcribing} onClick={() => void transcribe()}>
        Transcribe instead
      </MenuItem>
      <MenuItem onClick={() => addWordAt(region.start)}>Add word</MenuItem>
      <MenuItem disabled={!selectedWordId} onClick={() => selectedWordId && deleteWord(selectedWordId)}>
        Delete word
      </MenuItem>
    </Menu>
  );
}

function ViewMenu() {
  const navigate = useNavigate();
  const mode = useStudio((s) => s.mode);
  const windows = mode === "batch" ? BATCH : SINGLE;
  return (
    <Menu label="View">
      {windows.map((w) => (
        <MenuItem key={w.id} onClick={() => void navigate({ href: w.to })}>
          {w.label}
        </MenuItem>
      ))}
    </Menu>
  );
}

function Menu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="h-7 rounded-md px-2 text-sm text-muted hover:bg-elevated hover:text-fg"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {label}
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-50 min-w-44 rounded-lg border border-border bg-surface py-1 shadow-lg">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  onClick,
  children,
  disabled,
  hint,
}: {
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-sm text-fg hover:bg-elevated disabled:text-subtle"
    >
      <span>{children}</span>
      {hint ? <span className="font-mono text-[10px] text-subtle">{hint}</span> : null}
    </button>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="font-mono text-xs tabular-nums text-subtle">
      {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
    </span>
  );
}
