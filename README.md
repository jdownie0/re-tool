# re-tool — real estate listing video

Next.js (App Router), Tailwind, shadcn/ui, Supabase (Postgres + Auth + Storage), and Stripe subscriptions.

## Product flows

- **Pricing & billing**: `/pricing` (pay-first checkout) and Stripe webhooks updating `profiles`.
- **Listing video wizard**: `/app/projects/[id]/wizard/[step]` with steps **photos → voiceover → arrange → music → review**.
  - **Photos**: duration tiers (20s / 40s / 60s → 5 / 10 / 15 photos), optional listing URL, uploads to Storage bucket `listing-photos`. On Continue, **`listing_snapshots`** is filled from **Apify** (`maxcopell/zillow-detail-scraper`) when `APIFY_API_TOKEN` is set; otherwise a stub snapshot is stored.
  - **Voiceover**: script editor, mock **script** and **voice** jobs (`generation_jobs`, provider `mock`).
  - **Arrange**: drag-and-drop photo order (`@dnd-kit`), updates `sort_order`.
  - **Music**: preset cards + prompt, mock **music** job or skip.
  - **Review**: summary, mock waveform placeholders, captions toggle, **Generate video clips** (per-photo **`scene_video`** jobs). With **`FAL_AI_KEY`**, clips are generated via **Fal.ai** (default model `fal-ai/kling-video/v2.1/standard/image-to-video`, overridable with `FAL_SCENE_VIDEO_MODEL`), uploaded to **`generated-video`**, and linked as **`project_assets`** (`type: video_clip`). Without Fal credentials, jobs still complete using the mock processor.

Script, voice, and music jobs are still completed synchronously via [`src/lib/jobs/mock-process.ts`](src/lib/jobs/mock-process.ts). Scene video jobs use [`src/lib/jobs/process-generation-job.ts`](src/lib/jobs/process-generation-job.ts) to choose mock vs Fal.

[`POST /api/jobs`](src/app/api/jobs/route.ts) enqueues a job and runs the processor immediately except for **`scene_video`** when Fal is configured (jobs stay **queued** until processed).

[`POST /api/jobs/process`](src/app/api/jobs/process/route.ts) runs **one** queued `scene_video` job for a project (session auth).

[`GET /api/cron/process-jobs`](src/app/api/cron/process-jobs/route.ts) processes a batch of queued `scene_video` jobs with the **service role**; protect it with `Authorization: Bearer $CRON_SECRET`. [`vercel.json`](vercel.json) includes an example cron schedule (adjust for your host).

## Prerequisites

- Node 20+
- A [Supabase](https://supabase.com) project
- A [Stripe](https://stripe.com) account (test mode for local dev)

## Environment

Copy `.env.example` to `.env.local` and fill in values.

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_APP_URL` | Base URL (e.g. `http://localhost:3000`) for Stripe redirects |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase API (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only; Stripe webhooks, `auth.admin.createUser` on guest checkout, cron job processing |
| `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe API |
| `STRIPE_WEBHOOK_SECRET` | From Stripe CLI or Dashboard webhook endpoint |
| `STRIPE_PRICE_ID` | Recurring **Price** id (`price_…`) for subscription Checkout |
| `APIFY_API_TOKEN` | Apify token for listing scrape (server-only) |
| `APIFY_USER_ID` | Optional; not required for REST |
| `FAL_AI_KEY` | Fal.ai API key for image-to-video clips (server-only) |
| `FAL_SCENE_VIDEO_MODEL` | Optional Fal endpoint id (see `.env.example` default) |
| `USE_MOCK_VIDEO` | If `true` / `1`, force mock `scene_video` even when `FAL_AI_KEY` is set |
| `LISTING_INGEST_FALLBACK_STUB` | If `true` / `1`, save stub `listing_snapshots` when Apify fails instead of surfacing an error |
| `CRON_SECRET` | Bearer token for `GET /api/cron/process-jobs` |
| `CRON_SCENE_JOBS_BATCH` | Optional; max jobs per cron run (default 3, max 10) |

## Supabase

1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) if you want local linking.
2. Apply migrations:

   - `supabase link --project-ref <ref>`
   - `supabase db push`  

   Or run SQL under `supabase/migrations/` in order (including `stripe_checkout_sessions_claimed`).

3. **Auth**: Enable the **Email** provider. Set redirect URL `{NEXT_PUBLIC_APP_URL}/auth/callback` if using magic links.

4. **Storage**: Buckets `listing-photos`, `generated-audio`, `generated-video`, `renders` — object paths must start with `{auth.uid()}/…`.

## Stripe & signup

See [Stripe Dashboard](https://dashboard.stripe.com) for Products/Prices. Webhook URL: `POST /api/webhooks/stripe`.

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

## Scripts

```bash
npm install
npm run dev
```

- Health: `GET /api/health`
- Jobs: `POST /api/jobs` with JSON body (session cookie): `project_id`, `kind`, optional `idempotency_key`, `input`
- Process one scene job: `POST /api/jobs/process` with `{ "project_id": "<uuid>" }`

## Compliance

Scraping third-party listing sites may conflict with their terms of use. Use Apify and listing URLs in line with your product’s legal posture; prefer MLS or licensed feeds for production.

## Next steps (more providers)

Swap remaining mock completion in [`mock-process.ts`](src/lib/jobs/mock-process.ts) for real **script**, **voice**, **music**, and **compose** providers; keep using `generation_jobs` for status and outputs.
