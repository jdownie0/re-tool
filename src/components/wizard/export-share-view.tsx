"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import { Download, Loader2, Share2 } from "lucide-react";

type Props = {
  projectId: string;
  projectTitle: string;
  initialVideoUrl: string | null;
  initialDescription: string;
};

const SHARE_NOTE =
  "Social networks usually need you to upload the file in their app or site. Use Download, then paste the caption we copied for you where needed.";

export function ExportShareView({
  projectId,
  projectTitle,
  initialVideoUrl,
  initialDescription,
}: Props) {
  const [videoUrl, setVideoUrl] = useState<string | null>(initialVideoUrl);
  const [description, setDescription] = useState(initialDescription);
  const [waiting, setWaiting] = useState(!initialVideoUrl);
  const [downloading, setDownloading] = useState(false);

  const refreshVideoUrl = useCallback(async () => {
    const supabase = createClient();
    const { data: asset } = await supabase
      .from("project_assets")
      .select("storage_path")
      .eq("project_id", projectId)
      .eq("type", "final_render")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!asset?.storage_path) return false;
    const { data: signed } = await supabase.storage
      .from("renders")
      .createSignedUrl(asset.storage_path, 3600);
    if (signed?.signedUrl) {
      setVideoUrl(signed.signedUrl);
      setWaiting(false);
      return true;
    }
    return false;
  }, [projectId]);

  useEffect(() => {
    if (initialVideoUrl) {
      setWaiting(false);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      if (await refreshVideoUrl()) return;
    };
    void tick();
    const id = setInterval(() => {
      if (cancelled) return;
      void tick();
    }, 2500);
    const maxWait = setTimeout(() => {
      if (!cancelled) setWaiting(false);
    }, 120_000);
    return () => {
      cancelled = true;
      clearInterval(id);
      clearTimeout(maxWait);
    };
  }, [initialVideoUrl, refreshVideoUrl]);

  const safeFilename = `${projectTitle.replace(/[^\w\s-]/g, "").slice(0, 60) || "listing"}-video.mp4`;

  const onDownload = async () => {
    if (!videoUrl) return;
    setDownloading(true);
    try {
      const res = await fetch(videoUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = safeFilename;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } finally {
      setDownloading(false);
    }
  };

  const openFacebook = () => {
    if (!videoUrl) return;
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(videoUrl)}`,
      "_blank",
      "noopener,noreferrer,width=600,height=600",
    );
  };

  const openX = () => {
    if (!videoUrl) return;
    const qs = new URLSearchParams({
      text: description.trim() || projectTitle,
      url: videoUrl,
    });
    window.open(`https://twitter.com/intent/tweet?${qs.toString()}`, "_blank", "noopener,noreferrer");
  };

  const copyCaption = async () => {
    await navigator.clipboard.writeText(description.trim() || projectTitle);
  };

  const openTikTokUpload = () => {
    window.open("https://www.tiktok.com/upload", "_blank", "noopener,noreferrer");
  };

  const openInstagramWeb = () => {
    window.open("https://www.instagram.com/", "_blank", "noopener,noreferrer");
  };

  const onNativeShare = async () => {
    if (!videoUrl) return;
    try {
      const res = await fetch(videoUrl);
      const blob = await res.blob();
      const file = new File([blob], safeFilename, { type: "video/mp4" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: projectTitle,
          text: description.trim() || projectTitle,
          files: [file],
        });
      } else if (navigator.share) {
        await navigator.share({
          title: projectTitle,
          text: `${description.trim() || projectTitle}\n${videoUrl}`,
          url: videoUrl,
        });
      }
    } catch {
      /* user cancelled or unsupported */
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Your video is ready</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Preview below, download the MP4, then share to your networks. Edit the description before
          posting.
        </p>
      </div>

      <div className="bg-muted/30 overflow-hidden rounded-xl border">
        {waiting && !videoUrl ? (
          <div className="text-muted-foreground flex aspect-video flex-col items-center justify-center gap-3 p-8">
            <Loader2 className="size-10 animate-spin" aria-hidden />
            <p className="text-sm font-medium">Finalizing your video…</p>
            <p className="max-w-sm text-center text-xs">
              This page will update when the file is available. You can also return to{" "}
              <Link href={`/app/videos/${projectId}/wizard/review`} className="underline">
                Review
              </Link>{" "}
              to check progress.
            </p>
          </div>
        ) : videoUrl ? (
          <video
            src={videoUrl}
            controls
            playsInline
            className="aspect-video w-full bg-black"
            preload="metadata"
          />
        ) : (
          <div className="text-muted-foreground flex aspect-video flex-col items-center justify-center gap-2 p-8 text-center text-sm">
            <p>No final video found yet.</p>
            <Link
              href={`/app/videos/${projectId}/wizard/review`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Back to Review
            </Link>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor="share-desc" className="text-sm font-medium">
          Post description
        </label>
        <textarea
          id="share-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          placeholder="Caption for social posts…"
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void copyCaption()}>
            Copy description
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Button
          type="button"
          size="lg"
          className="h-12 min-w-[200px] gap-2 px-8 text-base"
          disabled={!videoUrl || downloading}
          onClick={() => void onDownload()}
        >
          {downloading ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <Download className="size-5" />
          )}
          Download video
        </Button>
        {"share" in navigator && (
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="h-12 gap-2"
            disabled={!videoUrl}
            onClick={() => void onNativeShare()}
          >
            <Share2 className="size-5" />
            Share…
          </Button>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium tracking-wide uppercase">Share</h3>
        <p className="text-muted-foreground text-xs leading-relaxed">{SHARE_NOTE}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={!videoUrl} onClick={openFacebook}>
            Facebook
          </Button>
          <Button type="button" variant="outline" disabled={!videoUrl} onClick={openX}>
            X
          </Button>
          <Button type="button" variant="outline" onClick={openInstagramWeb}>
            Instagram
          </Button>
          <Button type="button" variant="outline" onClick={openTikTokUpload}>
            TikTok
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          <span className="font-medium text-foreground">Instagram & TikTok:</span> there is no
          reliable way to upload from this browser alone—open the site or app, then use{" "}
          <span className="font-medium">Download video</span> and paste your description.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href={`/app/videos/${projectId}/wizard/review`}
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Back to review
        </Link>
        <Link href="/app/videos" className={cn(buttonVariants({ variant: "ghost" }))}>
          All videos
        </Link>
      </div>
    </div>
  );
}
