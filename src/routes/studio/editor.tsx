import { createFileRoute } from "@tanstack/react-router";
import { EditorWindow } from "@/components/studio/windows/editor-window";

export const Route = createFileRoute("/studio/editor")({
  component: EditorWindow,
});
