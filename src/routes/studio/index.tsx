import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStudio } from "@/lib/studio/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/studio/")({
  component: StudioHome,
});

function StudioHome() {
  const audioUrl = useStudio((s) => s.audioUrl);
  const loadFile = useStudio((s) => s.loadFile);
  const loadDemo = useStudio((s) => s.loadDemo);
  const error = useStudio((s) => s.error);
  const status = useStudio((s) => s.transcribeStatus);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    if (audioUrl) void navigate({ href: "/studio/setup" });
  }, [audioUrl, navigate]);

  const go = async (file: File | "demo") => {
    if (file === "demo") await loadDemo();
    else await loadFile(file);
    void navigate({ href: "/studio/setup" });
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-16">
      {error ? (
        <p className="mb-4 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void go(file);
        }}
        className={cn(
          "w-full max-w-lg rounded-xl border border-dashed px-6 py-12 text-center",
          over ? "border-fg bg-elevated" : "border-border bg-surface",
        )}
      >
        <Upload className="mx-auto size-6 text-muted" />
        <h1 className="mt-4 font-serif text-3xl tracking-tight">Drop a track</h1>
        <p className="mt-2 text-sm text-muted">
          MP3, WAV, FLAC or M4A. Then set the snippet, paste or transcribe the lyrics, and cut the video.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {status ? (
            <p className="text-sm text-muted">{status}</p>
          ) : (
            <>
              <Button asChild>
                <label className="relative cursor-pointer">
                  Choose file
                  <input
                    ref={inputRef}
                    type="file"
                    accept="audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/mp4,.mp3,.wav,.flac,.m4a,.ogg"
                    className="file-picker"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.currentTarget.value = "";
                      if (file) void go(file);
                    }}
                  />
                </label>
              </Button>
              <Button type="button" variant="secondary" onClick={() => void go("demo")}>
                Use demo track
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
