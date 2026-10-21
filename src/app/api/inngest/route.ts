import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { functions } from "@/lib/inngest/functions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Must be >= the longest function's Inngest finish timeout (15m for
// generate-audio-overview). A full podcast script is ~23 TTS lines at
// 30-125s each, so the audio job legitimately runs for 5-15 minutes; a 300s
// cap killed the function mid-synthesis and left the overview stuck in
// SYNTHESIZING with no audio.
export const maxDuration = 900;

export const { GET, POST, PUT } = serve({ client: inngest, functions });