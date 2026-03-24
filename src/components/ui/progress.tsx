import { cn } from "@/lib/utils";

type Props = {
  /** 0–100; null or undefined with indeterminate shows activity. */
  value?: number | null;
  indeterminate?: boolean;
  className?: string;
};

export function Progress({ value, indeterminate, className }: Props) {
  const v =
    value == null || indeterminate
      ? null
      : Math.min(100, Math.max(0, value));

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v ?? undefined}
      aria-label={indeterminate || v == null ? "In progress" : `${Math.round(v)}% complete`}
      className={cn("bg-muted h-1.5 w-full overflow-hidden rounded-full", className)}
    >
      {indeterminate || v == null ? (
        <div className="bg-primary/80 h-full w-1/3 animate-pulse rounded-full" />
      ) : (
        <div
          className="bg-primary h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${v}%` }}
        />
      )}
    </div>
  );
}
