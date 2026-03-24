-- Display name on profiles + support requests for admin review

alter table public.profiles
  add column if not exists display_name text;

comment on column public.profiles.display_name is 'Optional display name for UI and support tickets.';

-- -----------------------------------------------------------------------------
-- support_requests
-- -----------------------------------------------------------------------------
create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  submitter_name text,
  message_type text not null
    check (message_type in ('bug_report', 'feature_request', 'billing', 'other')),
  message text not null,
  created_at timestamptz not null default now()
);

create index support_requests_user_id_idx on public.support_requests (user_id);
create index support_requests_created_at_idx on public.support_requests (created_at desc);

comment on table public.support_requests is 'User-submitted support messages for admin review.';

alter table public.support_requests enable row level security;

create policy "support_requests_insert_own"
  on public.support_requests for insert
  with check (auth.uid() = user_id);

create policy "support_requests_select_own"
  on public.support_requests for select
  using (auth.uid() = user_id);
