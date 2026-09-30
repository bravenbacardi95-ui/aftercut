import { createFileRoute } from "@tanstack/react-router";
import { WallWindow } from "@/components/studio/windows/wall-window";

export const Route = createFileRoute("/studio/wall")({
  component: WallWindow,
});
