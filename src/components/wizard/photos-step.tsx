"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CloudDownload, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import {
  DEFAULT_WIZARD_DURATION_SECONDS,
  DURATION_OPTIONS,
  requiredPhotosForDuration,
} from "@/lib/wizard/constants";
import type { ListingDetailsDisplay } from "@/lib/wizard/listing-details";
import type { WizardMetadata } from "@/lib/wizard/types";
import {
  deleteProjectPhoto,
  fetchListingDetails,
  saveStubListingSnapshot,
  setDurationAndPhotos,
  setListingUrl,
  updateProjectTitle,
} from "@/app/app/projects/[id]/wizard/actions";

type PhotoRow = {
  id: string;
  storage_path: string;
  mime_type: string | null;
  sort_order: number | null;
};

type Props = {
  projectId: string;
  projectTitle: string;
  listingUrl: string | null;
  durationSeconds: number | null;
  wizard: WizardMetadata;
  photos: PhotoRow[];
  listingDetails: ListingDetailsDisplay | null;
};

function formatPrice(n: number | null): string {
  if (n === null || Number.isNaN(n)) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return String(n);
  }
}

function formatFeatures(f: unknown): string {
  if (Array.isArray(f)) {
    const strings = f.filter(
      (x): x is string => typeof x === "string" && x.trim().length > 0,
    );
    return strings.length ? strings.join(" · ") : "—";
  }
  return "—";
}

export function PhotosStep({
  projectId,
  projectTitle,
  listingUrl,
  durationSeconds,
  photos,
  listingDetails,
}: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(projectTitle);
  const [url, setUrl] = useState(listingUrl ?? "");
  const [details, setDetails] = useState<ListingDetailsDisplay | null>(
    listingDetails,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const uploadInProgress = useRef(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    setDetails(listingDetails);
  }, [listingDetails]);

  useEffect(() => {
    setTitle(projectTitle);
  }, [projectTitle]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const next: Record<string, string> = {};
      for (const p of photos) {
        const { data } = await supabase.storage
          .from("listing-photos")
          .createSignedUrl(p.storage_path, 3600);
        if (data?.signedUrl) next[p.id] = data.signedUrl;
      }
      if (!cancelled) setPhotoUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [photos]);

  const duration = durationSeconds ?? DEFAULT_WIZARD_DURATION_SECONDS;
  const required = requiredPhotosForDuration(duration);
  const count = photos.length;
  const canContinue = count >= required;
  const canFetch = url.trim().length > 0;

  const onDuration = async (seconds: number) => {
    setBusy(true);
    setError(null);
    try {
      await setDurationAndPhotos(projectId, seconds);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save duration");
    } finally {
      setBusy(false);
    }
  };

  const onBlurListingTitle = async () => {
    if (title.trim() === projectTitle.trim()) return;
    try {
      await updateProjectTitle(projectId, title);
      router.refresh();
    } catch {
      /* ignore */
    }
  };

  const onBlurListingUrl = async () => {
    if (url === (listingUrl ?? "")) return;
    try {
      await setListingUrl(projectId, url);
      router.refresh();
    } catch {
      /* ignore */
    }
  };

  const onRemovePhoto = async (assetId: string) => {
    setDeletingId(assetId);
    setError(null);
    try {
      await deleteProjectPhoto(projectId, assetId);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove photo");
    } finally {
      setDeletingId(null);
    }
  };

  const onFetchDetails = async () => {
    if (!canFetch) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetchListingDetails(projectId, url);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDetails(r.details);
      setUrl(r.details.source_url ?? url);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch listing");
    } finally {
      setBusy(false);
    }
  };

  const onFiles = useCallback(
    async (files: FileList | null, inputEl: HTMLInputElement | null) => {
      if (!files?.length) return;
      if (uploadInProgress.current) return;
      uploadInProgress.current = true;
      setBusy(true);
      setError(null);
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          setError("Not signed in");
          return;
        }

        const { data: existing } = await supabase
          .from("project_assets")
          .select("sort_order")
          .eq("project_id", projectId)
          .eq("type", "photo")
          .order("sort_order", { ascending: false })
          .limit(1);

        let nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

        for (const file of Array.from(files)) {
          if (!file.type.startsWith("image/")) continue;
          const ext = file.name.split(".").pop() || "jpg";
          const path = `${user.id}/${projectId}/${crypto.randomUUID()}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("listing-photos")
            .upload(path, file, { upsert: false });
          if (upErr) {
            setError(upErr.message);
            break;
          }
          const { error: insErr } = await supabase.from("project_assets").insert({
            project_id: projectId,
            type: "photo",
            storage_path: path,
            mime_type: file.type,
            sort_order: nextOrder,
          });
          if (insErr) {
            setError(insErr.message);
            break;
          }
          nextOrder += 1;
        }
      } finally {
        uploadInProgress.current = false;
        if (inputEl) inputEl.value = "";
        setBusy(false);
        router.refresh();
      }
    },
    [projectId, router],
  );

  const onContinue = async () => {
    if (!canContinue) return;
    setBusy(true);
    setError(null);
    try {
      await saveStubListingSnapshot(projectId);
      router.push(`/app/projects/${projectId}/wizard/voiceover`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to continue");
    } finally {
      setBusy(false);
    }
  };

  const hint = useMemo(
    () => `${count}/${required} photos`,
    [count, required],
  );

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Photos & listing</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Choose video length, add optional listing link, then upload photos.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="listing-title">Listing title</Label>
        <Input
          id="listing-title"
          placeholder="e.g. 123 Main St — City"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={onBlurListingTitle}
          disabled={busy}
        />
      </div>

      <div>
        <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
          Video duration
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {DURATION_OPTIONS.map((opt) => {
            const active = duration === opt.seconds;
            return (
              <button
                key={opt.seconds}
                type="button"
                disabled={busy}
                onClick={() => onDuration(opt.seconds)}
                className={cn(
                  "rounded-lg border px-4 py-3 text-left text-sm transition-colors",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card hover:bg-muted/60",
                )}
              >
                <div className="font-semibold">{opt.label}</div>
                <div className={cn("text-xs", active ? "opacity-90" : "text-muted-foreground")}>
                  {opt.photos} photos
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="listing-url">Property listing (optional)</Label>
        <div className="flex gap-2">
          <Input
            id="listing-url"
            className="min-w-0 flex-1"
            placeholder="Zillow / Redfin / other listing URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={onBlurListingUrl}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onFetchDetails();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0"
            disabled={busy || !canFetch}
            onClick={() => void onFetchDetails()}
            aria-label="Fetch listing details"
            title="Fetch listing details"
          >
            <CloudDownload className="size-4" aria-hidden />
          </Button>
        </div>

        {details ? (
          <div className="mt-3 overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th
                    scope="col"
                    className="text-muted-foreground w-[38%] px-3 py-2 text-left text-xs font-medium tracking-wide uppercase"
                  >
                    Field
                  </th>
                  <th
                    scope="col"
                    className="text-muted-foreground px-3 py-2 text-left text-xs font-medium tracking-wide uppercase"
                  >
                    Value
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <DetailRow label="Address" value={details.address ?? "—"} />
                <DetailRow label="Price" value={formatPrice(details.price)} />
                <DetailRow
                  label="Beds / baths"
                  value={
                    details.beds != null || details.baths != null
                      ? `${details.beds ?? "—"} bd / ${details.baths ?? "—"} ba`
                      : "—"
                  }
                />
                <DetailRow
                  label="Sq ft"
                  value={details.sqft != null ? String(details.sqft) : "—"}
                />
                <DetailRow
                  label="Year built"
                  value={details.year_built != null ? String(details.year_built) : "—"}
                />
                <DetailRow
                  label="Neighborhood"
                  value={details.neighborhood_summary ?? "—"}
                  multiline
                />
                <DetailRow label="Features" value={formatFeatures(details.features)} multiline />
              </tbody>
            </table>
            {details.warning ? (
              <p className="text-destructive border-t px-3 py-2 text-xs">{details.warning}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div>
        <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
          Listing photos
        </p>
        <label
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed py-12 transition-colors",
            "hover:bg-muted/40",
            busy && "pointer-events-none opacity-60",
          )}
        >
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            disabled={busy}
            onChange={(e) => void onFiles(e.target.files, e.currentTarget)}
          />
          <span className="text-sm font-medium">Drop photos here or click to upload</span>
          <span className="text-muted-foreground mt-1 text-xs">JPG, PNG, WebP</span>
        </label>
        {photos.length > 0 ? (
          <ul
            className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6"
            aria-label="Uploaded photos"
          >
            {photos.map((p) => (
              <li
                key={p.id}
                className="bg-muted relative aspect-square overflow-hidden rounded-md border"
              >
                <button
                  type="button"
                  disabled={busy || deletingId === p.id}
                  onClick={() => void onRemovePhoto(p.id)}
                  className="bg-background/90 text-muted-foreground hover:bg-destructive/15 hover:text-destructive absolute top-1 right-1 z-10 flex size-7 items-center justify-center rounded-full border shadow-sm transition-colors disabled:opacity-50"
                  aria-label="Remove photo"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
                {photoUrls[p.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed Supabase URLs; dynamic host
                  <img
                    src={photoUrls[p.id]}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="text-muted-foreground flex size-full items-center justify-center text-xs">
                    …
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-muted-foreground mt-2 text-sm">{hint}</p>
      </div>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={!canContinue || busy} onClick={onContinue}>
          Continue to voiceover
        </Button>
        <Link href="/app/projects" className={cn(buttonVariants({ variant: "ghost" }))}>
          All projects
        </Link>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <tr>
      <th
        scope="row"
        className="text-muted-foreground bg-muted/20 px-3 py-2 text-left align-top text-xs font-medium"
      >
        {label}
      </th>
      <td
        className={cn(
          "px-3 py-2 align-top",
          multiline ? "whitespace-pre-wrap break-words" : "",
        )}
      >
        {value}
      </td>
    </tr>
  );
}
