import { describe, it, expect } from "vitest";
import { RtcStateManager } from "../../src/lib/voice/rtc-dedupe";

describe("RtcStateManager call dedupe", () => {
  it("processes a call_id only once", () => {
    const s = new RtcStateManager();
    expect(s.shouldHandleCall("call-1")).toBe(true);
    expect(s.shouldHandleCall("call-1")).toBe(false);
    expect(s.shouldHandleCall("call-2")).toBe(true);
  });

  it("null/undefined callId is always allowed", () => {
    const s = new RtcStateManager();
    expect(s.shouldHandleCall(null)).toBe(true);
    expect(s.shouldHandleCall(undefined)).toBe(true);
  });

  it("drains the dedup set when it grows past the cap", () => {
    const s = new RtcStateManager();
    for (let i = 0; i < 1500; i++) {
      s.shouldHandleCall(`call-${i}`);
    }
    // After draining at 1001 entries, the oldest 500 evicted; kept half
    // is the last 500 added before the drain (call-501..call-1000) plus
    // the 499 that followed (call-1001..call-1499).
    expect(s.shouldHandleCall("call-0")).toBe(true); // evicted, re-processed
    expect(s.shouldHandleCall("call-501")).toBe(false); // retained
    expect(s.shouldHandleCall("call-1499")).toBe(false); // retained
    expect(s.shouldHandleCall("call-1500")).toBe(true); // new call
  });
});

describe("RtcStateManager pending-response bookkeeping", () => {
  it("first requestResponse sends create; second defers", () => {
    const s = new RtcStateManager();
    expect(s.requestResponse()).toBe("send-create");
    expect(s.requestResponse()).toBe("defer");
  });

  it("response.done after send-create fires a deferred create", () => {
    const s = new RtcStateManager();
    expect(s.requestResponse()).toBe("send-create");
    expect(s.requestResponse()).toBe("defer");
    // response.done should trigger the deferred create
    const result = s.onResponseDone();
    expect(result).toBe("send-create");
  });

  it("response.done without prior defer does nothing", () => {
    const s = new RtcStateManager();
    expect(s.requestResponse()).toBe("send-create");
    expect(s.onResponseDone()).toBe("nothing");
  });

  it("response.cancelled clears the active state without pending", () => {
    const s = new RtcStateManager();
    expect(s.requestResponse()).toBe("send-create");
    s.onResponseCancelled();
    // After cancel, a new request can send-create again
    expect(s.requestResponse()).toBe("send-create");
  });

  it("close resets all state", () => {
    const s = new RtcStateManager();
    s.shouldHandleCall("call-1");
    s.requestResponse();
    s.requestResponse(); // deferred
    s.close();
    // After close, everything resets
    expect(s.shouldHandleCall("call-1")).toBe(true);
    expect(s.requestResponse()).toBe("send-create");
    expect(s.onResponseDone()).toBe("nothing");
  });

  it("two tool calls finishing at once: first sends, second defers, then response.done triggers second create", () => {
    const s = new RtcStateManager();
    // Tool A finishes
    expect(s.requestResponse()).toBe("send-create");
    // Tool B finishes before response.created arrives
    expect(s.requestResponse()).toBe("defer");
    // response.created arrives (SDK sets responseActive = true, already is)
    s.onResponseCreated();
    // response.done arrives — should fire the deferred create
    expect(s.onResponseDone()).toBe("send-create");
    // No more pending
    expect(s.onResponseDone()).toBe("nothing");
  });
});
