"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";

export async function updateDisplayName(displayName: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const trimmed = displayName.trim();
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: trimmed.length ? trimmed : null })
    .eq("id", user.id);

  if (error) throw new Error(error.message);
  revalidatePath("/app", "layout");
  revalidatePath("/app/profile");
}

export async function updateAccountEmail(newEmail: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const email = newEmail.trim();
  if (!email) throw new Error("Email is required");

  const { error } = await supabase.auth.updateUser({ email });
  if (error) throw new Error(error.message);
  revalidatePath("/app", "layout");
  revalidatePath("/app/profile");
}

export async function updateAccountPassword(newPassword: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  if (newPassword.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}

export type SupportMessageType =
  | "bug_report"
  | "feature_request"
  | "billing"
  | "other";

export async function submitSupportRequest(
  messageType: SupportMessageType,
  message: string,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const body = message.trim();
  if (!body) throw new Error("Message is required");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const submitterName =
    profile?.display_name?.trim() ||
    user.email?.split("@")[0] ||
    "User";

  const { error } = await supabase.from("support_requests").insert({
    user_id: user.id,
    submitter_name: submitterName,
    message_type: messageType,
    message: body,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/app/support");
}

export async function openStripeBillingPortal() {
  const secret = process.env.STRIPE_SECRET_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!secret || !appUrl) {
    throw new Error("Billing is not configured");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .single();

  if (!profile?.stripe_customer_id) {
    redirect("/pricing");
  }

  const stripe = new Stripe(secret, { typescript: true });
  const session = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${appUrl}/app/billing`,
  });

  if (!session.url) {
    throw new Error("Could not open billing portal");
  }

  redirect(session.url);
}
