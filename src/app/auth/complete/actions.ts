"use server";

import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export type FinishCheckoutResult =
  | { ok: true; email: string }
  | { ok: false; error: string; code?: "already_claimed" | "account_exists" | "invalid_session" };

export async function finishCheckoutSignup(
  sessionId: string,
  password: string,
): Promise<FinishCheckoutResult> {
  if (!sessionId || password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters.", code: "invalid_session" };
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return { ok: false, error: "Server configuration error." };
  }

  const stripe = new Stripe(secret, { typescript: true });

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription", "customer"],
    });
  } catch {
    return { ok: false, error: "Could not load checkout session.", code: "invalid_session" };
  }

  if (session.mode !== "subscription" || session.payment_status !== "paid") {
    return { ok: false, error: "Checkout is not complete or was not a subscription.", code: "invalid_session" };
  }

  if (session.client_reference_id) {
    return {
      ok: false,
      error: "This purchase is already linked to an account. Sign in with that account.",
      code: "invalid_session",
    };
  }

  const email =
    session.customer_details?.email ??
    session.customer_email ??
    (typeof session.customer === "object" &&
    session.customer &&
    !("deleted" in session.customer)
      ? (session.customer as Stripe.Customer).email
      : null);

  if (!email) {
    return { ok: false, error: "No email found on this checkout. Contact support." };
  }

  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;

  if (!customerId) {
    return { ok: false, error: "No Stripe customer on this session." };
  }

  const admin = createAdminClient();

  const { data: claimed } = await admin
    .from("stripe_checkout_sessions_claimed")
    .select("user_id")
    .eq("checkout_session_id", sessionId)
    .maybeSingle();

  if (claimed) {
    return {
      ok: false,
      error: "This checkout was already used to create an account. Sign in instead.",
      code: "already_claimed",
    };
  }

  const subRaw = session.subscription;
  const sub =
    typeof subRaw === "object" && subRaw !== null
      ? (subRaw as Stripe.Subscription)
      : null;
  const subscriptionStatus = sub?.status ?? "active";
  const price = sub?.items?.data?.[0]?.price;
  const planKey = price?.nickname ?? price?.id ?? null;

  const { data: createdUserPayload, error: createErr } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

  const newUser = createdUserPayload?.user;
  if (createErr || !newUser) {
    const msg = createErr?.message ?? "Could not create account.";
    if (
      msg.toLowerCase().includes("already") ||
      msg.toLowerCase().includes("registered")
    ) {
      return {
        ok: false,
        error: "An account with this email already exists. Sign in instead.",
        code: "account_exists",
      };
    }
    return { ok: false, error: msg };
  }

  const userId = newUser.id;

  const { error: profileErr } = await admin
    .from("profiles")
    .update({
      stripe_customer_id: customerId,
      subscription_status: subscriptionStatus,
      plan_key: planKey,
    })
    .eq("id", userId);

  if (profileErr) {
    console.error("[finishCheckoutSignup] profile update", profileErr);
    return { ok: false, error: "Account was created but billing could not be linked. Contact support." };
  }

  const { error: claimErr } = await admin.from("stripe_checkout_sessions_claimed").insert({
    checkout_session_id: sessionId,
    user_id: userId,
  });

  if (claimErr) {
    console.error("[finishCheckoutSignup] claim insert", claimErr);
  }

  return { ok: true, email };
}
