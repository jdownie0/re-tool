import Link from "next/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-24">
      <div className="max-w-lg text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Listing Video</h1>
        <p className="text-muted-foreground mt-3 text-balance text-sm leading-relaxed">
          Real estate listing video workspace: subscribe to get started, then sign in to manage
          projects, uploads, and billing.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/pricing" className={cn(buttonVariants())}>
          Get started
        </Link>
        <Link href="/login" className={cn(buttonVariants({ variant: "outline" }))}>
          Sign in
        </Link>
      </div>
    </div>
  );
}
