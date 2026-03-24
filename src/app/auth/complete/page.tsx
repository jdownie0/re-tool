import Link from "next/link";
import Stripe from "stripe";
import { CompleteAccountForm } from "@/app/auth/complete/complete-form";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

type Props = {
  searchParams: Promise<{ session_id?: string }>;
};

export default async function AuthCompletePage({ searchParams }: Props) {
  const { session_id: sessionId } = await searchParams;

  if (!sessionId) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-4">
        <p className="text-muted-foreground text-center text-sm">
          Missing checkout session. Start from the pricing page after completing payment in Stripe.
        </p>
        <Link href="/pricing" className={cn(buttonVariants())}>
          View pricing
        </Link>
      </div>
    );
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
        <p className="text-destructive text-sm">Stripe is not configured on the server.</p>
      </div>
    );
  }

  const stripe = new Stripe(secret, { typescript: true });
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["customer"],
    });
  } catch {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-4">
        <p className="text-muted-foreground text-center text-sm">Invalid or expired checkout session.</p>
        <Link href="/pricing" className={cn(buttonVariants({ variant: "outline" }))}>
          Back to pricing
        </Link>
      </div>
    );
  }

  if (session.payment_status !== "paid" || session.mode !== "subscription") {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-4">
        <p className="text-muted-foreground text-center text-sm">
          This session is not a completed subscription payment.
        </p>
        <Link href="/pricing" className={cn(buttonVariants())}>
          View pricing
        </Link>
      </div>
    );
  }

  if (session.client_reference_id) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-muted-foreground max-w-md text-sm">
          This purchase is already linked to a signed-in account. Open the app to continue.
        </p>
        <Link href="/app/videos" className={cn(buttonVariants())}>
          Go to app
        </Link>
      </div>
    );
  }

  const emailHint =
    session.customer_details?.email ??
    session.customer_email ??
    (typeof session.customer === "object" &&
    session.customer &&
    !("deleted" in session.customer)
      ? (session.customer as Stripe.Customer).email
      : null) ??
    "";

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4 py-12">
      <CompleteAccountForm sessionId={sessionId} emailHint={emailHint} />
    </div>
  );
}
