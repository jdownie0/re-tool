"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { finishCheckoutSignup } from "@/app/auth/complete/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Props = {
  sessionId: string;
  emailHint: string;
};

export function CompleteAccountForm({ sessionId, emailHint }: Props) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await finishCheckoutSignup(sessionId, password);

    if (!result.ok) {
      setLoading(false);
      if (result.code === "already_claimed" || result.code === "account_exists") {
        router.push(`/login?notice=${encodeURIComponent(result.error)}`);
        return;
      }
      setError(result.error);
      return;
    }

    const supabase = createClient();
    const { error: signErr } = await supabase.auth.signInWithPassword({
      email: result.email,
      password,
    });
    setLoading(false);
    if (signErr) {
      setError(
        `Account created, but sign-in failed: ${signErr.message}. Try signing in manually.`,
      );
      return;
    }
    router.push("/app/projects");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Create your password</CardTitle>
        <CardDescription>
          Payment succeeded. Use the email from checkout
          {emailHint ? (
            <>
              : <span className="text-foreground font-medium">{emailHint}</span>
            </>
          ) : null}{" "}
          and choose a password for your account.
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="password">
              Password
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
            <p className="text-muted-foreground text-xs">At least 8 characters.</p>
          </div>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Please wait…" : "Activate account"}
          </Button>
          <Link href="/login" className="text-muted-foreground text-center text-sm">
            Already have an account? Sign in
          </Link>
        </CardFooter>
      </form>
    </Card>
  );
}
