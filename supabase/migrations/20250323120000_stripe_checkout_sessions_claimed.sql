-- Tracks checkout sessions already used to create a Supabase account (prevents replay).
-- Service role only; no user-facing RLS policies.

create table public.stripe_checkout_sessions_claimed (
  checkout_session_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  claimed_at timestamptz not null default now()
);

comment on table public.stripe_checkout_sessions_claimed is
  'One row per Stripe Checkout session that has been consumed for account creation.';

alter table public.stripe_checkout_sessions_claimed enable row level security;
