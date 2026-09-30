import { createFileRoute } from "@tanstack/react-router";
import { VaryWindow } from "@/components/studio/windows/vary-window";

export const Route = createFileRoute("/studio/vary")({
  component: VaryWindow,
});
