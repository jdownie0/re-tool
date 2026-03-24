import type { ReactNode } from "react";
import { UserMenu } from "@/components/user-menu";

type Props = {
  email: string | null;
  displayName: string | null;
  /** Primary actions (e.g. Create project). Shown before the account menu. */
  actions?: ReactNode;
};

export function AppShellHeader({ email, displayName, actions }: Props) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-end gap-4 border-b border-[var(--app-border)] bg-[var(--app-header)] px-6 backdrop-blur-sm">
      {actions}
      <UserMenu email={email} displayName={displayName} variant="app" />
    </header>
  );
}
