import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const TALL_PAGE_URL = "https://footnote-e2e.test/tall-page";

// The live site is auth-gated by Clerk in this repo. This spec renders the
// real StudioPanel web viewer via the `/test/web-viewer?harness=1` test harness
// (which is not an isProtectedRoute) and mocks only the embeddability check
// plus the page the iframe loads, so no signed-in session is required.
const tallPageHtml = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;padding:0}p{border-bottom:1px solid #ddd;padding:16px 0}</style>
</head><body>${Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i + 1}: the live-site viewer should render a scrollable document taller than the iframe.</p>`).join("")}</body></html>`;

async function withMocks(page: Page) {
  // embeddability check (auth-protected API, intercepted client-side before middleware)
  await page.route(/\/api\/web-preview\?url=/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        embeddable: true,
        finalUrl: TALL_PAGE_URL,
        title: "Example Article",
        text: "Sample extracted reader text used to verify the reader fallback view.",
        reason: "",
      }),
    }),
  );
  // tall page the iframe loads
  await page.route(TALL_PAGE_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: tallPageHtml,
    }),
  );
  // defensive: WEB citations never hit the source-content endpoint
  await page.route(/\/api\/sources\//, (route) => route.fulfill({ status: 404 }));
}

test.describe("Web viewer live-site iframe", () => {
  const widths = [1920, 1440, 1280, 1024];

  for (const width of widths) {
    test(`viewer body fills the panel at ${width}px`, async ({ page }) => {
      test.setTimeout(30000);
      await page.setViewportSize({ width, height: 1080 });
      await withMocks(page);
      await page.goto(`${BASE_URL}/test/web-viewer?harness=1`, {
        waitUntil: "domcontentloaded",
      });

      await page.waitForSelector("iframe", { state: "visible", timeout: 10000 });
      await page
        .locator('[data-testid="web-viewer-loading"]')
        .waitFor({ state: "hidden", timeout: 5000 });
      await page.waitForTimeout(200);

      const panel = page.locator('[data-testid="citation-viewer"]');
      const header = page.locator('[data-testid="source-viewer-header"]');
      const toolbar = page.locator('[data-testid="web-viewer-toolbar"]');
      const body = page.locator('[data-testid="web-viewer-body"]');
      const iframe = page.locator("iframe").first();

      const panelBox = await panel.boundingBox();
      const headerBox = await header.boundingBox();
      const toolbarBox = await toolbar.boundingBox();
      const bodyBox = await body.boundingBox();
      const iframeBox = await iframe.boundingBox();

      // 1) viewer body height == panel height - header - toolbar (±2px)
      const expectedBody = panelBox!.height - headerBox!.height - toolbarBox!.height;
      expect(Math.abs(bodyBox!.height - expectedBody)).toBeLessThanOrEqual(2);

      // 2) iframe (post-transform) fills the body vertically and stays within it
      expect(iframeBox!.height).toBeGreaterThanOrEqual(bodyBox!.height - 2);
      expect(iframeBox!.width).toBeLessThanOrEqual(bodyBox!.width + 1);

      // 3) no horizontal overflow
      const scrollWidth = await page.evaluate(
        () =>
          Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      );
      expect(scrollWidth).toBeLessThanOrEqual(width + 2);

      // 4) toolbar's last button fully inside the viewport
      const lastBtn = toolbar.locator("button").last();
      const lastBox = await lastBtn.boundingBox();
      expect(lastBox!.x + lastBox!.width).toBeLessThanOrEqual(width);

      // Artifact: after-screenshot at this width
      await page.screenshot({
        path: `test-results/web-viewer-after-${width}.png`,
        fullPage: false,
      });
    });
  }

  test("device switch keeps the iframe filling the body vertically", async ({
    page,
  }) => {
    test.setTimeout(30000);
    await page.setViewportSize({ width: 1440, height: 1080 });
    await withMocks(page);
    await page.goto(`${BASE_URL}/test/web-viewer?harness=1`, {
      waitUntil: "domcontentloaded",
    });

    await page.waitForSelector("iframe", { state: "visible", timeout: 10000 });
    await page
      .locator('[data-testid="web-viewer-loading"]')
      .waitFor({ state: "hidden", timeout: 5000 });
    await page.waitForTimeout(200);

    const body = page.locator('[data-testid="web-viewer-body"]');
    const iframe = page.locator("iframe").first();

    for (const mode of ["Tablet", "Mobile", "Desktop"]) {
      await page.getByRole("button", { name: new RegExp(`^${mode}$`) }).click();
      await page.waitForTimeout(500);
      const iframeBox = await iframe.boundingBox();
      const bodyBox = await body.boundingBox();
      expect(iframeBox!.height).toBeGreaterThanOrEqual(bodyBox!.height - 2);
    }
  });
});
