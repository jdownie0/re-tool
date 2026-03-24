import { Check } from "lucide-react";
import { startCheckoutFromPricing } from "@/app/pricing/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import Link from "next/link";

const FEATURES = [
  "AI-assisted listing video workflow",
  "Photo uploads & project storage",
  "Voiceover & music generation (coming soon)",
  "Stripe-secured subscription billing",
];

export default function PricingPage() {
  return (
    <div className="mx-auto flex min-h-[80vh] max-w-5xl flex-col gap-12 px-4 py-16">
      <div className="text-center">
        <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
          Listing Video
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Simple pricing for brokers & agents
        </h1>
        <p className="text-muted-foreground mx-auto mt-3 max-w-xl text-balance text-sm">
          Subscribe first, then create your account with the same email you use at checkout.
          Already have an account?{" "}
          <Link href="/login" className="text-foreground font-medium underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>

      <div className="flex justify-center">
        <Card className="w-full max-w-md border-2 shadow-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Professional</CardTitle>
            <CardDescription>Full access to the listing video workspace</CardDescription>
            <div className="pt-4">
              <span className="text-4xl font-semibold tracking-tight">$199.99</span>
              <span className="text-muted-foreground text-lg">/month</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Separator />
            <ul className="space-y-3 text-sm">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <form action={startCheckoutFromPricing} className="w-full">
              <Button type="submit" size="lg" className="h-11 w-full text-base">
                Get started
              </Button>
            </form>
            <p className="text-muted-foreground text-center text-xs leading-relaxed">
              You&apos;ll complete payment in Stripe, then choose a password to activate your
              account.
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
