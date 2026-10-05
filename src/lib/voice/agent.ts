import { defineVoiceAgent, type VoiceAgentConfig } from "samai-sdk/voice";
import { VOICE_TURN_DETECTION } from "./config";
import { VOICE_TOOLS } from "./tools/client";

export function createVoiceAgent(model: string, voice: string, instructions: string): VoiceAgentConfig {
  return defineVoiceAgent({
    name: "Voice Agent",
    model,
    instructions,
    voice: {
      voiceId: voice,
      interruption: "always-allow",
      maxSilenceMs: 700,
      backchannel: false,
    },
    tools: VOICE_TOOLS,
  });
}

export const turnDetection = VOICE_TURN_DETECTION;
