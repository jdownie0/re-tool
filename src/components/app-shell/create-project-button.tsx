"use client";

import Link from "next/link";
import { ChevronDown, Clapperboard, ImageIcon } from "lucide-react";
import { createProject } from "@/app/app/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const triggerClass =
  "inline-flex items-center gap-1.5 rounded-lg border border-[color-mix(in_oklab,var(--app-accent)_40%,transparent)] bg-transparent px-4 py-2 text-sm font-medium tracking-wide text-[var(--app-accent)] transition-colors hover:bg-[color-mix(in_oklab,var(--app-accent)_8%,transparent)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--app-accent)_30%,transparent)] focus-visible:outline-none";

const itemClass =
  "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none";

export function CreateProjectButton() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={triggerClass} aria-label="Create media">
          Create Media
          <ChevronDown className="size-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem asChild>
          <form action={createProject} className="w-full">
            <button type="submit" className={itemClass}>
              <Clapperboard className="text-muted-foreground size-4 shrink-0" aria-hidden />
              Video
            </button>
          </form>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app/images" className={itemClass}>
            <ImageIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Image
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
