import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SupportForm } from "./support-form";

export default async function SupportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const displayName =
    profile?.display_name?.trim() || user.email?.split("@")[0] || "User";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Support</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Messages are stored for our team to review. They include your account ID and name (
          <span className="text-foreground font-medium">{displayName}</span>
          ).
        </p>
      </div>
      <SupportForm />
    </div>
  );
}
