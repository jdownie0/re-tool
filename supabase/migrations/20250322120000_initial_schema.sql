-- Real estate video tool — architecture scaffold
-- Run via Supabase CLI: supabase db push / migration apply

-- Extensions
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- profiles (billing + app state; 1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text unique,
  subscription_status text,
  plan_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'User profile; stripe fields synced from webhooks via service role.';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- projects
-- -----------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled listing',
  status text not null default 'draft'
    check (status in ('draft', 'processing', 'ready', 'failed')),
  listing_url text,
  duration_seconds integer,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_user_id_idx on public.projects (user_id);

create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- project_assets
-- -----------------------------------------------------------------------------
create table public.project_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  type text not null
    check (type in ('photo', 'voice_sample', 'music', 'video_clip', 'final_render')),
  storage_path text not null,
  mime_type text,
  sort_order integer,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index project_assets_project_id_idx on public.project_assets (project_id);

-- -----------------------------------------------------------------------------
-- listing_snapshots (normalized ingest; raw jsonb for debugging)
-- -----------------------------------------------------------------------------
create table public.listing_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  source_url text,
  provider text,
  fetched_at timestamptz not null default now(),
  address text,
  price numeric,
  beds integer,
  baths numeric,
  sqft integer,
  year_built integer,
  neighborhood_summary text,
  comps jsonb not null default '[]',
  features jsonb not null default '[]',
  raw jsonb
);

create index listing_snapshots_project_id_idx on public.listing_snapshots (project_id);

-- -----------------------------------------------------------------------------
-- generation_jobs
-- -----------------------------------------------------------------------------
create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null
    check (kind in ('script', 'voice', 'music', 'scene_video', 'compose')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  provider text,
  idempotency_key text,
  input jsonb not null default '{}',
  output jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index generation_jobs_project_id_idx on public.generation_jobs (project_id);
create index generation_jobs_status_idx on public.generation_jobs (status);

create unique index generation_jobs_project_idempotency_uidx
  on public.generation_jobs (project_id, idempotency_key)
  where idempotency_key is not null;

create trigger generation_jobs_set_updated_at
before update on public.generation_jobs
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- usage_ledger (credits / metered billing hooks)
-- -----------------------------------------------------------------------------
create table public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  credits numeric not null,
  job_id uuid references public.generation_jobs (id) on delete set null,
  stripe_invoice_id text,
  note text,
  created_at timestamptz not null default now()
);

create index usage_ledger_user_id_idx on public.usage_ledger (user_id);

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_assets enable row level security;
alter table public.listing_snapshots enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.usage_ledger enable row level security;

-- profiles: users see/update own row
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- projects
create policy "projects_select_own"
  on public.projects for select
  using (auth.uid() = user_id);

create policy "projects_insert_own"
  on public.projects for insert
  with check (auth.uid() = user_id);

create policy "projects_update_own"
  on public.projects for update
  using (auth.uid() = user_id);

create policy "projects_delete_own"
  on public.projects for delete
  using (auth.uid() = user_id);

-- project_assets: via project ownership
create policy "project_assets_select"
  on public.project_assets for select
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_assets.project_id and p.user_id = auth.uid()
    )
  );

create policy "project_assets_insert"
  on public.project_assets for insert
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_assets.project_id and p.user_id = auth.uid()
    )
  );

create policy "project_assets_update"
  on public.project_assets for update
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_assets.project_id and p.user_id = auth.uid()
    )
  );

create policy "project_assets_delete"
  on public.project_assets for delete
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_assets.project_id and p.user_id = auth.uid()
    )
  );

-- listing_snapshots
create policy "listing_snapshots_select"
  on public.listing_snapshots for select
  using (
    exists (
      select 1 from public.projects p
      where p.id = listing_snapshots.project_id and p.user_id = auth.uid()
    )
  );

create policy "listing_snapshots_insert"
  on public.listing_snapshots for insert
  with check (
    exists (
      select 1 from public.projects p
      where p.id = listing_snapshots.project_id and p.user_id = auth.uid()
    )
  );

create policy "listing_snapshots_update"
  on public.listing_snapshots for update
  using (
    exists (
      select 1 from public.projects p
      where p.id = listing_snapshots.project_id and p.user_id = auth.uid()
    )
  );

create policy "listing_snapshots_delete"
  on public.listing_snapshots for delete
  using (
    exists (
      select 1 from public.projects p
      where p.id = listing_snapshots.project_id and p.user_id = auth.uid()
    )
  );

-- generation_jobs
create policy "generation_jobs_select"
  on public.generation_jobs for select
  using (
    exists (
      select 1 from public.projects p
      where p.id = generation_jobs.project_id and p.user_id = auth.uid()
    )
  );

create policy "generation_jobs_insert"
  on public.generation_jobs for insert
  with check (
    exists (
      select 1 from public.projects p
      where p.id = generation_jobs.project_id and p.user_id = auth.uid()
    )
  );

create policy "generation_jobs_update"
  on public.generation_jobs for update
  using (
    exists (
      select 1 from public.projects p
      where p.id = generation_jobs.project_id and p.user_id = auth.uid()
    )
  );

create policy "generation_jobs_delete"
  on public.generation_jobs for delete
  using (
    exists (
      select 1 from public.projects p
      where p.id = generation_jobs.project_id and p.user_id = auth.uid()
    )
  );

-- usage_ledger
create policy "usage_ledger_select_own"
  on public.usage_ledger for select
  using (auth.uid() = user_id);

-- Inserts typically via service role / server; optional insert for logged-in user:
create policy "usage_ledger_insert_own"
  on public.usage_ledger for insert
  with check (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- Storage buckets (private; path prefix = user uuid)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('listing-photos', 'listing-photos', false),
  ('generated-audio', 'generated-audio', false),
  ('generated-video', 'generated-video', false),
  ('renders', 'renders', false)
on conflict (id) do nothing;

-- Policies: first path segment must equal auth.uid()
create policy "storage_listing_photos_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'listing-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "storage_listing_photos_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'listing-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "storage_listing_photos_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'listing-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "storage_listing_photos_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'listing-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "storage_generated_audio_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'generated-audio'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "storage_generated_audio_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'generated-audio'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "storage_generated_audio_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'generated-audio'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "storage_generated_audio_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'generated-audio'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "storage_generated_video_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'generated-video'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "storage_generated_video_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'generated-video'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "storage_generated_video_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'generated-video'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "storage_generated_video_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'generated-video'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "storage_renders_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'renders'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "storage_renders_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'renders'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "storage_renders_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'renders'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "storage_renders_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'renders'
    and split_part(name, '/', 1) = auth.uid()::text
  );
