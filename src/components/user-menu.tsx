"use client";

import Link from "next/link";
import { ChevronDown, CreditCard, HelpCircle, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

function getInitials(displayName: string | null, email: string | null): string {
  const n = displayName?.trim();
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (
        parts[0]!.slice(0, 1) + parts[parts.length - 1]!.slice(0, 1)
      ).toUpperCase();
    }
    return n.slice(0, 2).toUpperCase();
  }
  if (email) {
    const local = email.split("@")[0] ?? email;
    return local.slice(0, 2).toUpperCase();
  }
  return "?";
}

type Props = {
  email: string | null;
  displayName: string | null;
  variant?: "default" | "app";
};

const itemClass =
  "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none";

export function UserMenu({ email, displayName, variant = "default" }: Props) {
  const initials = getInitials(displayName, email);
  const appShell = variant === "app";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full py-0.5 pr-1 pl-0.5 outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
            appShell
              ? "focus-visible:ring-[color-mix(in_oklab,var(--app-accent)_45%,transparent)] focus-visible:ring-offset-[var(--app-canvas)]"
              : "ring-offset-background focus-visible:ring-ring focus-visible:ring-offset-2",
          )}
          aria-label="Account menu"
        >
          <span
            className={cn(
              "flex size-10 items-center justify-center rounded-full text-xs font-semibold tracking-wide uppercase shadow-sm",
              appShell
                ? "bg-[var(--app-accent)] text-white hover:brightness-105"
                : "bg-primary text-primary-foreground hover:opacity-90",
            )}
          >
            {initials}
          </span>
          <ChevronDown
            className={cn(
              "size-4 shrink-0",
              appShell ? "text-[var(--app-accent)]" : "text-muted-foreground",
            )}
            aria-hidden
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem asChild>
          <Link href="/app/profile" className={itemClass}>
            <User className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app/billing" className={itemClass}>
            <CreditCard className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Billing
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app/support" className={itemClass}>
            <HelpCircle className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Support
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
