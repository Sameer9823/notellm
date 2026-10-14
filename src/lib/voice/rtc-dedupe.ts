/**
 * Extracted WebRTC function-calling state machine: call dedupe + pending
 * response-create bookkeeping. Mirrors the inline logic in patches/samai-sdk
 * (node_modules/samai-sdk/dist/voice/index.{js,cjs}) so the race-sensitive
 * parts can be unit-tested without a real WebRTC connection.
 *
 * Invariants:
 *  - A given call_id is processed at most once per session (dedupe).
 *  - At most one `response.create` is in flight at a time; subsequent
 *    requests are coalesced via `pendingResponseCreate`.
 *  - The dedup set is bounded so it can't leak memory across a long session.
 */

const MAX_HANDLED_CALLS = 1000;
const DRAIN_KEEP = 500;

export class RtcStateManager {
  private handledCalls = new Set<string>();
  private responseActive = false;
  private pendingResponseCreate = false;

  shouldHandleCall(callId: string | null | undefined): boolean {
    if (!callId) return true;
    if (this.handledCalls.has(callId)) return false;
    this.handledCalls.add(callId);
    if (this.handledCalls.size > MAX_HANDLED_CALLS) {
      const entries = [...this.handledCalls];
      this.handledCalls.clear();
      for (let i = entries.length - DRAIN_KEEP; i < entries.length; i++) {
        this.handledCalls.add(entries[i]);
      }
    }
    return true;
  }

  requestResponse(): "send-create" | "defer" {
    if (this.responseActive) {
      this.pendingResponseCreate = true;
      return "defer";
    }
    this.responseActive = true;
    return "send-create";
  }

  onResponseCreated(): void {
    this.responseActive = true;
  }

  onResponseDone(): "send-create" | "defer" | "nothing" {
    this.responseActive = false;
    if (this.pendingResponseCreate) {
      this.pendingResponseCreate = false;
      return this.requestResponse();
    }
    return "nothing";
  }

  onResponseCancelled(): void {
    this.responseActive = false;
  }

  close(): void {
    this.responseActive = false;
    this.pendingResponseCreate = false;
    this.handledCalls.clear();
  }
}
