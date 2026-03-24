"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderOpen, ImageIcon, LogOut, SquarePlay } from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut } from "@/app/app/actions";

function LogoMark() {
  return (
    <div
      className="flex size-10 items-center justify-center rounded-md border border-[color-mix(in_oklab,var(--app-accent)_35%,transparent)] bg-white/60"
      aria-hidden
    >
      <div className="flex gap-0.5">
        <span className="h-5 w-1 rounded-sm bg-[color-mix(in_oklab,var(--app-accent)_80%,transparent)]" />
        <span className="h-6 w-1 rounded-sm bg-[color-mix(in_oklab,var(--app-accent)_80%,transparent)]" />
        <span className="h-4 w-1 rounded-sm bg-[color-mix(in_oklab,var(--app-accent)_80%,transparent)]" />
      </div>
    </div>
  );
}

type NavItemProps = {
  href: string;
  label: string;
  active: boolean;
  icon: React.ReactNode;
};

function NavItem({ href, label, active, icon }: NavItemProps) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        "relative flex flex-col items-center gap-1.5 rounded-lg py-3 transition-colors max-md:px-1 md:px-2",
        active
          ? "bg-[var(--app-accent-soft)] text-[var(--app-accent)]"
          : "text-[var(--app-foreground)]/85 hover:bg-black/[0.03]",
        active &&
          "before:absolute before:top-2 before:bottom-2 before:left-0 before:w-0.5 before:rounded-full before:bg-[var(--app-accent)]",
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md border transition-colors",
          active
            ? "border-[color-mix(in_oklab,var(--app-accent)_45%,transparent)] bg-white/80 text-[var(--app-accent)]"
            : "border-transparent text-[var(--app-muted)]",
        )}
      >
        {icon}
      </span>
      <span className="max-w-[7rem] text-center text-[11px] font-medium leading-snug max-md:sr-only">
        {label}
      </span>
    </Link>
  );
}

export function AppShellSidebar() {
  const pathname = usePathname();
  const inListingVideoFlow = pathname.includes("/wizard");
  const listingVideoActive = inListingVideoFlow;
  const imagesActive = pathname.startsWith("/app/images");
  const videosActive = pathname.startsWith("/app/videos") && !inListingVideoFlow;

  return (
    <aside className="flex w-[154px] shrink-0 flex-col border-r border-[var(--app-border)] bg-[var(--app-sidebar)] max-md:w-[50px]">
      <div className="flex flex-col items-center px-2 py-6 max-md:px-1.5">
        <Link
          href="/app/videos"
          className="flex flex-col items-center gap-2 rounded-lg p-2 transition-colors hover:bg-[var(--app-accent-soft)] max-md:p-1"
          aria-label="Home"
        >
          <LogoMark />
        </Link>
      </div>

      <nav className="flex flex-col gap-1 px-2 max-md:px-1.5" aria-label="Main">
        {inListingVideoFlow ? (
          <NavItem
            href="/app/videos"
            label="Listing Video"
            active={listingVideoActive}
            icon={<SquarePlay className="size-[18px]" aria-hidden />}
          />
        ) : null}
        <NavItem
          href="/app/images"
          label="Images"
          active={imagesActive}
          icon={<ImageIcon className="size-[18px]" aria-hidden />}
        />
        <NavItem
          href="/app/projects"
          label="Projects"
          active={projectsActive}
          icon={<FolderOpen className="size-[18px]" aria-hidden />}
        />
      </nav>

      <div className="mt-auto border-t border-[var(--app-border)] p-2 max-md:p-1.5">
        <form action={signOut}>
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2.5 text-left text-sm text-[var(--app-muted)] transition-colors hover:bg-black/[0.04] hover:text-[var(--app-foreground)] max-md:justify-center max-md:px-1"
            aria-label="Sign out"
          >
            <LogOut className="size-[18px] shrink-0" aria-hidden />
            <span className="max-md:sr-only">Sign out</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
