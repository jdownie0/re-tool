"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProjectTitle } from "@/app/app/projects/[id]/wizard/actions";

type Props = {
  projectId: string;
  initialTitle: string;
  /** Use larger typography for the project detail page heading. */
  variant?: "default" | "pageHeading";
};

export function EditableProjectTitle({
  projectId,
  initialTitle,
  variant = "default",
}: Props) {
  const router = useRouter();
  const [value, setValue] = useState(initialTitle);

  useEffect(() => {
    setValue(initialTitle);
  }, [initialTitle]);

  const onBlur = async () => {
    if (value.trim() === initialTitle.trim()) return;
    try {
      await updateProjectTitle(projectId, value);
      router.refresh();
    } catch {
      setValue(initialTitle);
    }
  };

  return (
    <div className="grid w-full max-w-xl gap-2">
      <Label htmlFor={`project-title-${projectId}`}>Listing title</Label>
      <Input
        id={`project-title-${projectId}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={onBlur}
        placeholder="Untitled listing"
        className={
          variant === "pageHeading"
            ? "text-2xl font-semibold tracking-tight md:text-3xl"
            : undefined
        }
      />
    </div>
  );
}
