import { useRef, useState, type DragEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setHandoff } from "@/lib/studio/handoff";
import { cn } from "@/lib/utils";

const ACCEPT = "audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/mp4,audio/x-m4a,.mp3,.wav,.flac,.m4a,.ogg";

export function DropTrack({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const go = (payload: File | "demo") => {
    setHandoff(payload);
    void navigate({ to: "/studio" });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) go(file);
  };

  return (
    <div className={cn("w-full", compact ? "" : "max-w-xl")}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center transition-colors md:py-12",
          over ? "border-fg bg-elevated" : "border-border bg-surface",
        )}
      >
        <Upload className="size-6 text-muted" aria-hidden />
        <p className="mt-3 font-medium">Drop your song to start</p>
        <p className="mt-1 text-sm text-muted">MP3, WAV, FLAC or M4A · up to 80 MB</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button asChild>
            <label className="relative cursor-pointer">
              Choose file
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                className="file-picker"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.currentTarget.value = "";
                  if (file) go(file);
                }}
              />
            </label>
          </Button>
          <Button type="button" variant="secondary" onClick={() => go("demo")}>
            Use demo track
          </Button>
        </div>
      </div>
      <p className="mt-3 text-center text-sm text-subtle">
        No account needed to build it. Export is unlimited.
      </p>
    </div>
  );
}
