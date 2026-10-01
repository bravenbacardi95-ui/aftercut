import { Link } from "@tanstack/react-router";
import { AppIcon, Wordmark } from "@/components/brand/logo";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

const links = [{ to: "/about", label: "About" }];

export function SiteHeader({ solid = false }: { solid?: boolean }) {
  return (
    <header
      className={cn(
        "relative z-30 flex h-16 items-center justify-between gap-4 px-4 md:h-[4.5rem] md:px-8",
        solid ? "bg-bg" : "bg-transparent",
      )}
    >
      <Link to="/" className="inline-flex items-center text-fg transition-opacity hover:opacity-70">
        <Wordmark variant="on-dark" height={22} />
      </Link>
      <nav className="flex items-center gap-5 md:gap-7" aria-label="Primary">
        {links.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className="hidden text-xs font-medium uppercase tracking-[0.18em] text-muted transition-colors hover:text-fg sm:inline md:text-sm"
          >
            {l.label}
          </Link>
        ))}
        <Link
          to="/studio"
          className="inline-flex h-10 items-center rounded-lg bg-elevated px-3 text-sm font-medium text-fg shadow-[0_0_0_1px_rgba(242,239,232,0.08)] transition-opacity hover:opacity-90 sm:px-3.5"
        >
          Open studio
        </Link>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border px-4 py-12 md:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-serif text-2xl tracking-tight">{BRAND.name}</p>
          <p className="mt-2 max-w-sm text-sm text-muted">{BRAND.tagline}</p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
          <Link to="/studio" className="hover:text-fg">
            Studio
          </Link>
          <Link to="/about" className="hover:text-fg">
            About
          </Link>
        </div>
      </div>
      <p className="mx-auto mt-10 flex max-w-6xl items-center gap-2 text-xs text-subtle">
        <AppIcon size={16} />
        <span>
          © {new Date().getFullYear()} {BRAND.company}
        </span>
      </p>
    </footer>
  );
}