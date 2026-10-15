"use client";

import { useSearchParams } from "next/navigation";
import { StudioPanel } from "@/components/studio/StudioPanel";
import type { Citation } from "@/types";

// A self-contained citation that exercises the WEB viewer path. The route is
// intentionally NOT auth-protected (/test/* is outside isProtectedRoute) and is
// gated on `?harness=1` so it is invisible to normal users. It exists so the
// web-viewer Playwright spec can render the real StudioPanel/ScaledIframe
// components without needing a signed-in Clerk session.
const mockCitation: Citation = {
  marker: 1,
  chunkId: "chunk_1",
  sourceId: "source_1",
  sourceTitle: "Example Article",
  sourceType: "WEB",
  snippet: "the quick brown fox jumps over the lazy dog",
  url: "https://example.com/article",
};

export default function WebViewerTestPage() {
  const searchParams = useSearchParams();
  if (searchParams.get("harness") !== "1") return null;

  return (
    <div className="flex h-dvh flex-col bg-background">
      <StudioPanel
        citation={mockCitation}
        onClose={() => {}}
        notebookId="webviewer-e2e"
      />
    </div>
  );
}
