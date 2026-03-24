"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  updateAccountEmail,
  updateAccountPassword,
  updateDisplayName,
} from "@/app/app/account/actions";

type Props = {
  initialDisplayName: string | null;
  initialEmail: string | null;
};

export function ProfileForm({ initialDisplayName, initialEmail }: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialDisplayName ?? "");
  const [email, setEmail] = useState(initialEmail ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const onSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await updateDisplayName(name);
      setOk("Name saved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save name");
    } finally {
      setBusy(false);
    }
  };

  const onSaveEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await updateAccountEmail(email);
      setOk(
        "If your project requires email confirmation, check your inbox for a link to confirm the new address.",
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update email");
    } finally {
      setBusy(false);
    }
  };

  const onSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await updateAccountPassword(password);
      setPassword("");
      setConfirmPassword("");
      setOk("Password updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex max-w-lg flex-col gap-8">
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="text-muted-foreground text-sm" role="status">
          {ok}
        </p>
      ) : null}

      <form onSubmit={onSaveName} className="grid gap-3">
        <div className="grid gap-2">
          <Label htmlFor="display-name">Name</Label>
          <Input
            id="display-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
            disabled={busy}
          />
        </div>
        <Button type="submit" disabled={busy}>
          Save name
        </Button>
      </form>

      <form onSubmit={onSaveEmail} className="grid gap-3">
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            disabled={busy}
          />
        </div>
        <Button type="submit" disabled={busy} variant="secondary">
          Save email
        </Button>
      </form>

      <form onSubmit={onSavePassword} className="grid gap-3">
        <div className="grid gap-2">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            disabled={busy}
            minLength={8}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirm-password">Confirm new password</Label>
          <Input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            disabled={busy}
            minLength={8}
          />
        </div>
        <Button type="submit" disabled={busy} variant="secondary">
          Update password
        </Button>
      </form>
    </div>
  );
}
