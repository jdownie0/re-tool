import Link from "next/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

export default function AuthCodeErrorPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-xl font-semibold">Sign-in error</h1>
      <p className="text-muted-foreground max-w-md text-center text-sm">
        The authentication link was invalid or expired. Try signing in again.
      </p>
      <Link href="/login" className={cn(buttonVariants())}>
        Back to sign in
      </Link>
    </div>
  );
}
