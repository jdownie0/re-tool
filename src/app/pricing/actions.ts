"use server";

import { redirect } from "next/navigation";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";

/**
 * Starts Stripe Checkout for the public subscription price.
 * - Logged-out users return to /auth/complete to set a password after payment.
 * - Logged-in users return to /app after payment (subscription linked via webhook).
 */
export async function startCheckoutFromPricing() {
  const secret = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!secret || !priceId || !appUrl) {
    throw new Error(
      "Missing STRIPE_SECRET_KEY, STRIPE_PRICE_ID, or NEXT_PUBLIC_APP_URL",
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const stripe = new Stripe(secret, {
    typescript: true,
  });

  const loggedIn = Boolean(user);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: loggedIn
      ? `${appUrl}/app/projects?checkout=success`
      : `${appUrl}/auth/complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/pricing`,
    ...(loggedIn && user
      ? {
          client_reference_id: user.id,
          metadata: { supabase_user_id: user.id },
          subscription_data: {
            metadata: { supabase_user_id: user.id },
          },
          customer_email: user.email ?? undefined,
        }
      : {}),
  });

  if (!session.url) {
    throw new Error("Stripe Checkout did not return a URL");
  }

  redirect(session.url);
}
