import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { functions } from "@/lib/inngest/functions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel's Hobby plan hard-caps a serverless function's maxDuration at 300s
// and rejects the build outright for anything higher, so this can never be
// raised past 300. The audio job therefore has to fit inside that budget:
// the TTS phase is sized (model + concurrency + a bounded script) to
// complete well within it, and the job is checkpointed by Inngest so a
// failure retries rather than being lost.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({ client: inngest, functions });