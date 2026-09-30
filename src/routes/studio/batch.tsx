import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/studio/batch")({
  beforeLoad: () => {
    throw redirect({ to: "/studio/setup", replace: true });
  },
});
