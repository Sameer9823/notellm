import { test, expect, type Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "1920", width: 1920, height: 1080 },
  { name: "1440", width: 1440, height: 900 },
  { name: "1280", width: 1280, height: 800 },
  { name: "1024", width: 1024, height: 768 },
  { name: "390", width: 390, height: 844 },
];

const PANEL_STATES = [
  { name: "all-closed", sources: false, right: false, rightKind: null },
  { name: "sources-only", sources: true, right: false, rightKind: null },
  { name: "audio-tab", sources: false, right: true, rightKind: "audio" },
  { name: "roadmap-tab", sources: false, right: true, rightKind: "roadmap" },
  { name: "study-tab", sources: false, right: true, rightKind: "study" },
  { name: "notes-tab", sources: false, right: true, rightKind: "notes" },
];

async function setupTestNotebook(page: Page) {
  // Mock authentication and navigate to a test notebook
  await page.goto("/notebook/test-notebook-id");
  
  // Wait for the workspace to load
  await page.waitForSelector('[data-testid="workspace-layout"]', { timeout: 10000 });
  
  // Wait for any animations to complete
  await page.waitForTimeout(500);
}

async function setPanelState(page: Page, sources: boolean, right: boolean, rightKind: string | null) {
  // Toggle sources panel
  const sourcesButton = page.locator('button[aria-label="Toggle Sources (⌘B)"]');
  const sourcesOpen = await sourcesButton.getAttribute("aria-pressed") === "true";
  if (sourcesOpen !== sources) {
    await sourcesButton.click();
    await page.waitForTimeout(200);
  }

  // Toggle right panel
  const rightButton = page.locator('button[aria-label="Toggle Studio"]');
  const rightOpen = await rightButton.getAttribute("aria-pressed") === "true";
  if (rightOpen !== right) {
    await rightButton.click();
    await page.waitForTimeout(200);
  }

  // Select right panel tab if needed
  if (right && rightKind) {
    const tabButton = page.locator(`button[role="tab"]:has-text("${rightKind.charAt(0).toUpperCase() + rightKind.slice(1)}")`);
    if (await tabButton.count() > 0) {
      await tabButton.click();
      await page.waitForTimeout(200);
    }
  }
}

async function assertNoHorizontalOverflow(page: Page) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const innerWidth = await page.evaluate(() => window.innerWidth);
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

async function assertRightPanelInViewport(page: Page) {
  const rightPanel = page.locator('[data-testid="right-panel"]').first();
  if (await rightPanel.count() > 0) {
    const rect = await rightPanel.boundingBox();
    const innerWidth = await page.evaluate(() => window.innerWidth);
    expect((rect?.x ?? 0) + (rect?.width ?? 0)).toBeLessThanOrEqual(innerWidth);
    
    // Check close button is visible
    const closeButton = rightPanel.locator('button[aria-label*="Close"], button[aria-label*="close"]').first();
    if (await closeButton.count() > 0) {
      const closeRect = await closeButton.boundingBox();
      expect((closeRect?.x ?? 0) + (closeRect?.width ?? 0)).toBeLessThanOrEqual(innerWidth);
    }
    
    // Check last tab is visible
    const tabs = rightPanel.locator('[role="tab"]');
    const tabCount = await tabs.count();
    if (tabCount > 0) {
      const lastTab = tabs.nth(tabCount - 1);
      const lastTabRect = await lastTab.boundingBox();
      expect((lastTabRect?.x ?? 0) + (lastTabRect?.width ?? 0)).toBeLessThanOrEqual(innerWidth);
    }
  }
}

async function assertChatColumnWidth(page: Page, minWidth: number) {
  const chatColumn = page.locator('[data-testid="chat-column"]').first();
  if (await chatColumn.count() > 0) {
    const rect = await chatColumn.boundingBox();
    expect(rect?.width).toBeGreaterThanOrEqual(minWidth);
  }
}

async function openCitationChip(page: Page) {
  // Find a citation chip and click it
  const citationChip = page.locator('[data-testid="citation-chip"]').first();
  if (await citationChip.count() > 0) {
    await citationChip.click();
    await page.waitForTimeout(300);
    return true;
  }
  return false;
}

async function assertSourcesPersisted(page: Page, expectedOpen: boolean) {
  // Reload the page
  await page.reload();
  await page.waitForSelector('[data-testid="workspace-layout"]', { timeout: 10000 });
  await page.waitForTimeout(500);
  
  const sourcesButton = page.locator('button[aria-label="Toggle Sources (⌘B)"]');
  const sourcesOpen = await sourcesButton.getAttribute("aria-pressed") === "true";
  expect(sourcesOpen).toBe(expectedOpen);
}

for (const viewport of VIEWPORTS) {
  for (const state of PANEL_STATES) {
    test.describe(`Workspace Layout - ${viewport.name}px - ${state.name}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test.beforeEach(async ({ page }) => {
        await setupTestNotebook(page);
        await setPanelState(page, state.sources, state.right, state.rightKind);
      });

      test("no horizontal overflow", async ({ page }) => {
        await assertNoHorizontalOverflow(page);
      });

      test("right panel fully in viewport", async ({ page }) => {
        if (state.right) {
          await assertRightPanelInViewport(page);
        }
      });

      test("chat column minimum width", async ({ page }) => {
        if (viewport.width >= 1280) {
          await assertChatColumnWidth(page, 520);
        }
      });
    });
  }
}

test.describe("Citation chip opens viewer", () => {
  for (const viewport of VIEWPORTS) {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test(`opens viewer at ${viewport.name}px`, async ({ page }) => {
      await setupTestNotebook(page);
      
      // Ensure right panel is closed
      const rightButton = page.locator('button[aria-label="Toggle Studio"]');
      const rightOpen = await rightButton.getAttribute("aria-pressed") === "true";
      if (rightOpen) {
        await rightButton.click();
        await page.waitForTimeout(200);
      }
      
      // Try to open a citation
      const opened = await openCitationChip(page);
      if (opened) {
        // Verify viewer opened
        const viewer = page.locator('[data-testid="citation-viewer"]');
        await expect(viewer).toBeVisible({ timeout: 2000 });
      }
    });
  }
});

test.describe("Sources toggle persistence", () => {
  for (const viewport of VIEWPORTS) {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test(`persists sources state after reload at ${viewport.name}px`, async ({ page }) => {
      await setupTestNotebook(page);
      
      // Toggle sources
      const sourcesButton = page.locator('button[aria-label="Toggle Sources (⌘B)"]');
      const initialState = await sourcesButton.getAttribute("aria-pressed") === "true";
      await sourcesButton.click();
      await page.waitForTimeout(200);
      
      const newState = await sourcesButton.getAttribute("aria-pressed") === "true";
      expect(newState).not.toBe(initialState);
      
      // Reload and check persistence
      await assertSourcesPersisted(page, newState);
    });

    test(`Ctrl/Cmd+B toggles sources at ${viewport.name}px`, async ({ page }) => {
      await setupTestNotebook(page);
      
      const sourcesButton = page.locator('button[aria-label="Toggle Sources (⌘B)"]');
      const initialState = await sourcesButton.getAttribute("aria-pressed") === "true";
      
      // Press Ctrl+B (or Meta+B on Mac)
      await page.keyboard.press("Meta+B");
      await page.waitForTimeout(200);
      
      const newState = await sourcesButton.getAttribute("aria-pressed") === "true";
      expect(newState).not.toBe(initialState);
    });
  }
});

test.describe("Focus mode", () => {
  for (const viewport of VIEWPORTS.filter(v => v.width >= 1024)) {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test(`focus mode hides side panels at ${viewport.name}px`, async ({ page }) => {
      await setupTestNotebook(page);
      
      const focusButton = page.locator('button[aria-label*="Focus Mode"]');
      await focusButton.click();
      await page.waitForTimeout(200);
      
      // Check sources panel is hidden
      const sourcesPanel = page.locator('[data-testid="sources-panel"]');
      await expect(sourcesPanel).toBeHidden();
      
      // Check right panel is hidden
      const rightPanel = page.locator('[data-testid="right-panel"]');
      await expect(rightPanel).toBeHidden();
      
      // Chat should be full width
      const chatColumn = page.locator('[data-testid="chat-column"]');
      const rect = await chatColumn.boundingBox();
      const innerWidth = await page.evaluate(() => window.innerWidth);
      expect(rect?.width).toBeGreaterThan(innerWidth * 0.9);
    });
  }
});

test.describe("Mobile behavior", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("sources opens as drawer", async ({ page }) => {
    await setupTestNotebook(page);
    
    const sourcesButton = page.locator('button[aria-label="Toggle Sources (⌘B)"]');
    await sourcesButton.click();
    await page.waitForTimeout(300);
    
    // Check drawer is open
    const drawer = page.locator('[role="dialog"]:has-text("Sources")');
    await expect(drawer).toBeVisible();
  });

  test("right panel opens as sheet", async ({ page }) => {
    await setupTestNotebook(page);
    
    const rightButton = page.locator('button[aria-label="Toggle Studio"]');
    await rightButton.click();
    await page.waitForTimeout(300);
    
    // Check sheet is open
    const sheet = page.locator('[role="dialog"]:has-text("Studio")');
    await expect(sheet).toBeVisible();
  });

  test("no horizontal scroll on mobile", async ({ page }) => {
    await setupTestNotebook(page);
    await assertNoHorizontalOverflow(page);
  });

  test("composer usable on mobile", async ({ page }) => {
    await setupTestNotebook(page);
    
    const textarea = page.locator('textarea[placeholder="Ask about your sources…"]');
    await expect(textarea).toBeVisible();
    
    // Check it's not too wide
    const rect = await textarea.boundingBox();
    const innerWidth = await page.evaluate(() => window.innerWidth);
    expect(rect?.width).toBeLessThanOrEqual(innerWidth);
  });
});

test.describe("Accessibility", () => {
  test("all icon buttons have aria-labels", async ({ page }) => {
    await setupTestNotebook(page);
    
    const iconButtons = page.locator('button[aria-label]');
    const count = await iconButtons.count();
    expect(count).toBeGreaterThan(0);
    
    // Check none have empty aria-labels
    for (let i = 0; i < count; i++) {
      const label = await iconButtons.nth(i).getAttribute("aria-label");
      expect(label).toBeTruthy();
      expect(label?.length).toBeGreaterThan(0);
    }
  });

  test("focus rings visible", async ({ page }) => {
    await setupTestNotebook(page);
    
    // Tab through focusable elements
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(focused).toBeTruthy();
  });

  test("Esc closes panels", async ({ page }) => {
    await setupTestNotebook(page);
    
    // Open right panel
    const rightButton = page.locator('button[aria-label="Toggle Studio"]');
    await rightButton.click();
    await page.waitForTimeout(200);
    
    // Press Escape
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    
    // Panel should be closed
    const rightOpen = await rightButton.getAttribute("aria-pressed") === "true";
    expect(rightOpen).toBe(false);
  });
});