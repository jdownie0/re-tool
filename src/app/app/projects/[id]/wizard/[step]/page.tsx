import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isWizardStep } from "@/lib/wizard/types";
import { getWizardFromMetadata } from "@/lib/wizard/metadata";
import { PhotosStep } from "@/components/wizard/photos-step";
import { VoiceoverStep } from "@/components/wizard/voiceover-step";
import { ArrangeStep } from "@/components/wizard/arrange-step";
import { MusicStep } from "@/components/wizard/music-step";
import { ReviewStep } from "@/components/wizard/review-step";
import {
  buildListingContextForScript,
  type ListingSnapshotRow,
} from "@/lib/ai/listing-script-context";
import {
  fetchElevenLabsVoices,
  type WizardVoiceOption,
} from "@/lib/ai/elevenlabs-voices";
import { isElevenLabsConfigured } from "@/lib/ai/elevenlabs-env";
import { isOpenAiConfigured } from "@/lib/ai/openai-env";
import { VOICE_PRESETS } from "@/lib/wizard/constants";
import { listingSnapshotRowToDisplay } from "@/lib/wizard/listing-details";

type Props = {
  params: Promise<{ id: string; step: string }>;
};

export default async function WizardStepPage({ params }: Props) {
  const { id, step: stepParam } = await params;
  if (!isWizardStep(stepParam)) {
    notFound();
  }
  const step = stepParam;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("id, title, listing_url, duration_seconds, metadata, status")
    .eq("id", id)
    .eq("user_id", user!.id)
    .single();

  if (!project) {
    notFound();
  }

  const wizard = getWizardFromMetadata(
    project.metadata as Record<string, unknown> | null,
  );

  const { data: assets } = await supabase
    .from("project_assets")
    .select("id, storage_path, mime_type, sort_order, type")
    .eq("project_id", project.id)
    .eq("type", "photo")
    .order("sort_order", { ascending: true, nullsFirst: false });

  const photos = assets ?? [];

  if (
    (step === "voiceover" ||
      step === "arrange" ||
      step === "music" ||
      step === "review") &&
    photos.length === 0
  ) {
    redirect(`/app/videos/${id}/wizard/photos`);
  }

  if (
    (step === "arrange" || step === "music" || step === "review") &&
    !wizard.voiceMockReady
  ) {
    redirect(`/app/videos/${id}/wizard/voiceover`);
  }

  if (
    step === "review" &&
    !wizard.musicMockReady &&
    !wizard.musicSkipped
  ) {
    redirect(`/app/videos/${id}/wizard/music`);
  }

  const common = {
    projectId: project.id,
    listingUrl: project.listing_url,
    durationSeconds: project.duration_seconds,
    wizard,
    photos,
  };

  if (step === "photos") {
    const { data: listingSnapRow } = await supabase
      .from("listing_snapshots")
      .select(
        "provider, source_url, address, price, beds, baths, sqft, year_built, neighborhood_summary, features, raw",
      )
      .eq("project_id", project.id)
      .maybeSingle();

    const listingDetails = listingSnapRow
      ? listingSnapshotRowToDisplay(
          listingSnapRow as unknown as Record<string, unknown>,
          null,
        )
      : null;

    return (
      <PhotosStep
        {...common}
        projectTitle={project.title}
        listingDetails={listingDetails}
      />
    );
  }

  if (step === "review") {
    const { data: sceneJobs } = await supabase
      .from("generation_jobs")
      .select("id, status, error, input, output, created_at, updated_at, progress")
      .eq("project_id", project.id)
      .eq("kind", "scene_video")
      .order("created_at", { ascending: true });

    const { data: composeJobRow } = await supabase
      .from("generation_jobs")
      .select("id, status, error, input, output, created_at, updated_at, progress")
      .eq("project_id", project.id)
      .eq("kind", "compose")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: videoClips } = await supabase
      .from("project_assets")
      .select("id, storage_path, sort_order, duration_ms")
      .eq("project_id", project.id)
      .eq("type", "video_clip")
      .order("sort_order", { ascending: true, nullsFirst: false });

    const { data: voiceAsset } = await supabase
      .from("project_assets")
      .select("storage_path")
      .eq("project_id", project.id)
      .eq("type", "voice_sample")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let voiceoverAudioUrl: string | null = null;
    if (voiceAsset?.storage_path) {
      const { data: signed } = await supabase.storage
        .from("generated-audio")
        .createSignedUrl(voiceAsset.storage_path, 3600);
      voiceoverAudioUrl = signed?.signedUrl ?? null;
    }

    const { data: musicAsset } = await supabase
      .from("project_assets")
      .select("storage_path")
      .eq("project_id", project.id)
      .eq("type", "music")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let musicAudioUrl: string | null = null;
    if (musicAsset?.storage_path) {
      const { data: signed } = await supabase.storage
        .from("generated-audio")
        .createSignedUrl(musicAsset.storage_path, 3600);
      musicAudioUrl = signed?.signedUrl ?? null;
    }

    const { data: finalRenderAsset } = await supabase
      .from("project_assets")
      .select("id, storage_path")
      .eq("project_id", project.id)
      .eq("type", "final_render")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let finalRenderUrl: string | null = null;
    let renderPath = finalRenderAsset?.storage_path ?? null;
    if (!renderPath && composeJobRow?.output && typeof composeJobRow.output === "object") {
      const out = composeJobRow.output as Record<string, unknown>;
      if (typeof out.storage_path === "string" && out.storage_path.length > 0) {
        renderPath = out.storage_path;
      }
    }
    if (renderPath) {
      const { data: signed } = await supabase.storage
        .from("renders")
        .createSignedUrl(renderPath, 3600);
      finalRenderUrl = signed?.signedUrl ?? null;
    }

    return (
      <ReviewStep
        {...common}
        sceneJobs={sceneJobs ?? []}
        composeJob={composeJobRow}
        videoClips={videoClips ?? []}
        voiceoverAudioUrl={voiceoverAudioUrl}
        musicAudioUrl={musicAudioUrl}
        finalRenderUrl={finalRenderUrl}
      />
    );
  }

  switch (step) {
    case "voiceover": {
      const { data: listingForScript } = await supabase
        .from("listing_snapshots")
        .select(
          "address, price, beds, baths, sqft, year_built, neighborhood_summary, features, raw",
        )
        .eq("project_id", project.id)
        .maybeSingle();

      const listingContext = listingForScript
        ? buildListingContextForScript(
            listingForScript as unknown as ListingSnapshotRow,
          )
        : null;

      const fallbackVoices: WizardVoiceOption[] = VOICE_PRESETS.map((p) => ({
        id: p.id,
        name: p.label,
        label: p.label,
      }));
      let voiceOptions: WizardVoiceOption[] = fallbackVoices;
      if (isElevenLabsConfigured()) {
        const el = await fetchElevenLabsVoices();
        if (el.ok) {
          voiceOptions = el.voices;
        }
      }

      const { data: voiceAsset } = await supabase
        .from("project_assets")
        .select("storage_path")
        .eq("project_id", project.id)
        .eq("type", "voice_sample")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let voiceoverAudioUrl: string | null = null;
      if (voiceAsset?.storage_path) {
        const { data: signed } = await supabase.storage
          .from("generated-audio")
          .createSignedUrl(voiceAsset.storage_path, 3600);
        voiceoverAudioUrl = signed?.signedUrl ?? null;
      }

      return (
        <VoiceoverStep
          {...common}
          hasListingContext={Boolean(listingContext?.trim())}
          openaiConfigured={isOpenAiConfigured()}
          elevenLabsConfigured={isElevenLabsConfigured()}
          voiceOptions={voiceOptions}
          voiceoverAudioUrl={voiceoverAudioUrl}
        />
      );
    }
    case "arrange":
      return <ArrangeStep {...common} />;
    case "music": {
      const { data: musicAsset } = await supabase
        .from("project_assets")
        .select("storage_path")
        .eq("project_id", project.id)
        .eq("type", "music")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let musicAudioUrl: string | null = null;
      if (musicAsset?.storage_path) {
        const { data: signed } = await supabase.storage
          .from("generated-audio")
          .createSignedUrl(musicAsset.storage_path, 3600);
        musicAudioUrl = signed?.signedUrl ?? null;
      }

      return (
        <MusicStep
          {...common}
          elevenLabsConfigured={isElevenLabsConfigured()}
          musicAudioUrl={musicAudioUrl}
        />
      );
    }
    default:
      notFound();
  }
}
