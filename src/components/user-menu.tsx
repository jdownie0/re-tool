"use client";

import Link from "next/link";
import { CreditCard, HelpCircle, User } from "lucide-react";
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
};

const itemClass =
  "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none";

export function UserMenu({ email, displayName }: Props) {
  const initials = getInitials(displayName, email);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase shadow-sm",
            "ring-offset-background focus-visible:ring-ring outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
            "hover:opacity-90",
          )}
          aria-label="Account menu"
        >
          {initials}
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
