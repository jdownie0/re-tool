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
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {project.title}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Listing video</h1>
      </div>
      <WizardStepper projectId={project.id} />
      {children}
    </div>
  );
}
