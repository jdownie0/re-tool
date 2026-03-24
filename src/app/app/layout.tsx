import { createClient } from "@/lib/supabase/server";
import { AppShellHeader } from "@/components/app-shell/app-shell-header";
import { AppShellSidebar } from "@/components/app-shell/app-shell-sidebar";
import { CreateProjectButton } from "@/components/app-shell/create-project-button";

export default async function AppAreaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user!.id)
    .single();

  return (
    <div
      className="app-chrome flex min-h-svh bg-[var(--app-canvas)] text-[var(--app-foreground)] antialiased"
    >
      <AppShellSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppShellHeader
          email={user?.email ?? null}
          displayName={profile?.display_name ?? null}
          actions={<CreateProjectButton />}
        />
        <main className="flex flex-1 flex-col px-6 py-8 md:px-10">{children}</main>
      </div>
    </div>
  );
}
