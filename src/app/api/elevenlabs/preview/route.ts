import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  buildVoicePreviewNarration,
  synthesizeVoiceMp3,
} from "@/lib/ai/elevenlabs-tts";

type Body = {
  voiceId?: string;
  projectId?: string;
  /** Display name for “Hello, I'm …” in the preview script. */
  voiceName?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const voiceId = typeof body.voiceId === "string" ? body.voiceId.trim() : "";
  const projectId =
    typeof body.projectId === "string" ? body.projectId.trim() : "";

  if (!voiceId || !projectId) {
    return NextResponse.json(
      { error: "voiceId and projectId are required" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (projErr || !project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const voiceName =
    typeof body.voiceName === "string" ? body.voiceName.trim() : "";
  const text = buildVoicePreviewNarration(voiceName);

  const result = await synthesizeVoiceMp3(voiceId, text);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return new NextResponse(result.buffer, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, no-store",
    },
  });
}
