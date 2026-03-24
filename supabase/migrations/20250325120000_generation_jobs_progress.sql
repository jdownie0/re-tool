-- Structured progress for long-running generation jobs (stage, percent, optional label).
alter table public.generation_jobs
  add column if not exists progress jsonb;

comment on column public.generation_jobs.progress is
  'Optional { stage, label?, percent? } for UI progress/ETA; cleared when job completes.';
