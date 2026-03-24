"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  submitSupportRequest,
  type SupportMessageType,
} from "@/app/app/account/actions";

const MESSAGE_TYPES: { value: SupportMessageType; label: string }[] = [
  { value: "bug_report", label: "Bug report" },
  { value: "feature_request", label: "Feature request" },
  { value: "billing", label: "Billing" },
  { value: "other", label: "Other" },
];

export function SupportForm() {
  const router = useRouter();
  const [messageType, setMessageType] = useState<SupportMessageType | "">("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageType) {
      setError("Choose a message type");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitSupportRequest(messageType, message);
      setSent(true);
      setMessage("");
      setMessageType("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send message");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-lg border p-6 text-sm">
        <p className="font-medium">Thanks — your message was sent.</p>
        <p className="text-muted-foreground mt-2">
          Our team will review it. You can submit another message below.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          onClick={() => setSent(false)}
        >
          Send another
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-lg flex-col gap-4">
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor="message-type">Message type</Label>
        <Select
          value={messageType || undefined}
          onValueChange={(v) => setMessageType(v as SupportMessageType)}
          disabled={busy}
          required
        >
          <SelectTrigger id="message-type" className="w-full">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            {MESSAGE_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="message">Message</Label>
        <Textarea
          id="message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Describe your issue or idea…"
          rows={6}
          required
          disabled={busy}
        />
      </div>

      <Button type="submit" disabled={busy}>
        Submit
      </Button>
    </form>
  );
}
