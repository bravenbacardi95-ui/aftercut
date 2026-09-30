import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PhoneFrame({
  children,
  className,
  caption,
}: {
  children: ReactNode;
  className?: string;
  caption?: string;
}) {
  return (
    <div className={cn("relative aspect-[9/16] overflow-hidden rounded-phone bg-bg shadow-[0_0_0_1px_rgba(242,239,232,0.12),0_24px_60px_rgba(0,0,0,0.45)]", className)}>
      {children}
      {caption ? (
        <div className="pointer-events-none absolute inset-x-4 bottom-[18%] text-center">
          <p className="font-sans text-[1.05rem] font-bold leading-tight text-fg drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">
            {caption}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function PlatformChrome({ variant = "tiktok" }: { variant?: "tiktok" | "reels" }) {
  if (variant === "reels") {
    return (
      <div className="pointer-events-none absolute inset-0 phone-chrome text-fg">
        <div className="absolute left-0 right-0 top-[5%] flex items-center justify-center text-[4.4cqw] font-semibold">
          Reels
        </div>
      </div>
    );
  }
  return (
    <div className="pointer-events-none absolute inset-0 phone-chrome text-fg">
      <div className="absolute left-0 right-0 top-[2.5%] flex items-center justify-center gap-[4cqw] text-[4cqw] font-semibold">
        <span className="opacity-60">Following</span>
        <span className="relative">
          For You
          <span className="absolute left-1/2 top-full mt-[0.5cqw] h-[0.5cqw] w-[5cqw] -translate-x-1/2 rounded-full bg-fg" />
        </span>
      </div>
    </div>
  );
}
