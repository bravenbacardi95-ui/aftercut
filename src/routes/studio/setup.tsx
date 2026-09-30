import { createFileRoute } from "@tanstack/react-router";
import { SetupWindow } from "@/components/studio/windows/setup-window";

export const Route = createFileRoute("/studio/setup")({
  component: SetupWindow,
});
