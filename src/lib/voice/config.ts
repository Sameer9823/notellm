export const DEFAULT_REALTIME_MODEL = "gpt-realtime";
export const DEFAULT_REALTIME_VOICE = "marin";

export const CLIENT_SECRET_TTL_SECONDS = 600;

export const VOICE_TURN_DETECTION = {
  type: "semantic_vad" as const,
  eagerness: "auto" as const,
  createResponse: true,
  interruptResponse: true,
};
