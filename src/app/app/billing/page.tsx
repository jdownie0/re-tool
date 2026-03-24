import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { openStripeBillingPortal } from "@/app/app/account/actions";

export default async function BillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status, plan_key, stripe_customer_id")
    .eq("id", user.id)
    .single();

  const hasStripeCustomer = Boolean(profile?.stripe_customer_id);
  const planLabel =
    profile?.plan_key === "professional" || profile?.plan_key === "pro"
      ? "Professional"
      : profile?.plan_key
        ? profile.plan_key
        : "—";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          View your plan and open the Stripe customer portal to manage your subscription.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current plan</CardTitle>
          <CardDescription>Synced from Stripe via webhooks.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="text-muted-foreground">Plan: </span>
            {planLabel}
          </p>
          <p>
            <span className="text-muted-foreground">Subscription status: </span>
            {profile?.subscription_status ?? "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Stripe customer: </span>
            {hasStripeCustomer ? "Connected" : "Not linked yet"}
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        {hasStripeCustomer ? (
          <form action={openStripeBillingPortal}>
            <Button type="submit" size="lg">
              Manage subscription
            </Button>
          </form>
        ) : (
          <Link
            href="/pricing"
            className={cn(buttonVariants({ size: "lg" }))}
          >
            Subscribe
          </Link>
        )}
        <Link
          href="/app/videos"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Back to videos
        </Link>
      </div>
    </div>
  );
}
