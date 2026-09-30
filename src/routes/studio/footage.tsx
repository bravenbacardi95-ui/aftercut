import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FootageWindow } from "@/components/studio/windows/footage-window";
import { useStudio } from "@/lib/studio/store";

export const Route = createFileRoute("/studio/footage")({
  component: FootageRoute,
});

function FootageRoute() {
  const mode = useStudio((s) => s.mode);
  const navigate = useNavigate();
  useEffect(() => {
    if (mode !== "single") return;
    void navigate({ href: "/studio/editor", replace: true });
  }, [mode, navigate]);
  if (mode === "single") return null;
  return <FootageWindow />;
}
