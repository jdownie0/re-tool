"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import { SECONDS_PER_SCENE } from "@/lib/wizard/constants";
import type { WizardMetadata } from "@/lib/wizard/types";
import { reorderProjectPhotos } from "@/app/app/projects/[id]/wizard/actions";

type PhotoRow = {
  id: string;
  storage_path: string;
  mime_type: string | null;
  sort_order: number | null;
};

type Props = {
  projectId: string;
  wizard: WizardMetadata;
  photos: PhotoRow[];
};

export function ArrangeStep({ projectId, photos: initialPhotos }: Props) {
  const router = useRouter();
  const [items, setItems] = useState(initialPhotos);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItems(initialPhotos);
  }, [initialPhotos]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const ids = useMemo(() => items.map((p) => p.id), [items]);

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next);
    setBusy(true);
    setError(null);
    try {
      await reorderProjectPhotos(
        projectId,
        next.map((p) => p.id),
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reorder failed");
      setItems(initialPhotos);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Arrange scenes</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Drag photos into order. Each slot is roughly {SECONDS_PER_SCENE}s in the final video (mock).
        </p>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {items.map((photo, index) => (
              <SortablePhoto
                key={photo.id}
                id={photo.id}
                index={index}
                path={photo.storage_path}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          disabled={busy}
          onClick={() => router.push(`/app/projects/${projectId}/wizard/music`)}
        >
          Continue to music
        </Button>
        <Link
          href={`/app/projects/${projectId}/wizard/voiceover`}
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Back
        </Link>
      </div>
    </div>
  );
}

function SortablePhoto({
  id,
  index,
  path,
}: {
  id: string;
  index: number;
  path: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.storage
        .from("listing-photos")
        .createSignedUrl(path, 3600);
      if (!cancelled && data?.signedUrl) setSrc(data.signedUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  const start = index * SECONDS_PER_SCENE;
  const end = (index + 1) * SECONDS_PER_SCENE;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative aspect-video overflow-hidden rounded-lg border bg-muted",
        isDragging && "z-10 opacity-90 ring-2 ring-ring",
      )}
    >
      <div
        className="bg-background/80 absolute top-1 left-1 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
        aria-hidden
      >
        {start}-{end}s
      </div>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed Supabase URLs; dynamic host
        <img src={src} alt="" className="size-full object-cover" draggable={false} />
      ) : (
        <div className="text-muted-foreground flex size-full items-center justify-center text-xs">
          …
        </div>
      )}
      <button
        type="button"
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        aria-label={`Reorder scene ${index + 1}`}
        {...attributes}
        {...listeners}
      />
    </div>
  );
}
