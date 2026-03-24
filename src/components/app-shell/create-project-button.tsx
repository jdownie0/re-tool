import { createProject } from "@/app/app/actions";

export function CreateProjectButton() {
  return (
    <form action={createProject}>
      <button
        type="submit"
        className="rounded-lg border border-[color-mix(in_oklab,var(--app-accent)_40%,transparent)] bg-transparent px-4 py-2 text-sm font-medium tracking-wide text-[var(--app-accent)] transition-colors hover:bg-[color-mix(in_oklab,var(--app-accent)_8%,transparent)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--app-accent)_30%,transparent)] focus-visible:outline-none"
      >
        Create New Project
      </button>
    </form>
  );
}
