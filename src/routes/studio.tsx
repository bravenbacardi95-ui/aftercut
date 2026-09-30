import { useEffect } from "react";
import { Outlet, createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { DesktopShell } from "@/components/studio/desktop-shell";
import { PlaybackProvider } from "@/components/studio/playback";
import { StudioGuard } from "@/components/studio/studio-guard";
import { takeHandoff } from "@/lib/studio/handoff";
import { useStudio } from "@/lib/studio/store";

export const Route = createFileRoute("/studio")({
  component: StudioLayout,
  head: () => ({
    meta: [{ title: "Studio · Aftercut" }],
  }),
});

function StudioLayout() {
  const loadFile = useStudio((s) => s.loadFile);
  const loadDemo = useStudio((s) => s.loadDemo);
  const audioUrl = useStudio((s) => s.audioUrl);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable;
      const inBubble = Boolean(el?.closest("[data-word]"));
      if (!meta && e.key === "Tab") {
        if (typing && !inBubble) return;
        const { words, selectedWordId, selectWord } = useStudio.getState();
        const sorted = [...words].sort((a, b) => a.start - b.start || a.end - b.end);
        if (!sorted.length) return;
        e.preventDefault();
        const index = sorted.findIndex((word) => word.id === selectedWordId);
        const step = e.shiftKey ? -1 : 1;
        const next = sorted[(index + step + sorted.length) % sorted.length];
        if (!next) return;
        selectWord(next.id);
        window.dispatchEvent(new CustomEvent("aftercut-edit-word", { detail: next.id }));
        return;
      }
      if (!meta && (e.key === "Delete" || e.key === "Backspace")) {
        if (typing) return;
        const { selectedWordId, deleteWord } = useStudio.getState();
        if (!selectedWordId) return;
        e.preventDefault();
        deleteWord(selectedWordId);
        return;
      }
      if (!meta) return;
      if (key === "x" || key === "d") {
        if (typing) return;
        const { selectedWordId, words, deleteWord, insertAfterWord } = useStudio.getState();
        if (!selectedWordId) return;
        e.preventDefault();
        if (key === "x") deleteWord(selectedWordId);
        else {
          const word = words.find((w) => w.id === selectedWordId);
          insertAfterWord(selectedWordId, word?.text ?? "word");
        }
        return;
      }
      if (key !== "z" && key !== "y") return;
      const studioField = Boolean(el?.closest("[data-studio-undo]"));
      if (typing && !studioField) return;
      e.preventDefault();
      const redo = key === "y" || (key === "z" && e.shiftKey);
      if (redo) useStudio.getState().redo();
      else useStudio.getState().undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const handoff = takeHandoff();
    if (!handoff) return;
    const run = async () => {
      if (handoff === "demo") await loadDemo();
      else await loadFile(handoff);
      void navigate({ to: "/studio/batch" });
    };
    void run();
  }, [loadDemo, loadFile, navigate]);

  useEffect(() => {
    if (audioUrl) return;
    if (pathname === "/studio" || pathname === "/studio/") return;
    void navigate({ to: "/studio" });
  }, [audioUrl, navigate, pathname]);

  return (
    <PlaybackProvider>
      <DesktopShell>
        <StudioGuard>
          <Outlet />
        </StudioGuard>
      </DesktopShell>
    </PlaybackProvider>
  );
}
