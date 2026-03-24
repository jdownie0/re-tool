import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WizardStepper } from "@/components/wizard/wizard-stepper";

type Props = {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
};

export default async function ProjectWizardLayout({ children, params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("id, title")
    .eq("id", id)
    .eq("user_id", user!.id)
    .single();

  if (!project) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <WizardStepper projectId={project.id} />
      <div>
        <p className="text-[var(--app-accent)] text-xs font-medium tracking-wide uppercase">
          {project.title}
        </p>
        <h1 className="font-[family-name:var(--font-app-heading)] text-3xl font-semibold tracking-tight md:text-4xl">
          Listing video
        </h1>
      </div>
      {children}
    </div>
  );
}
