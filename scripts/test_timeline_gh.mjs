import { chromium } from "playwright";

async function main() {
  try {
    const browser = await chromium.launch({
      headless: true,
      channel: "msedge",
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    
    // Scoped to gh-muii7dtg -> mode === "gh"
    console.log("Navigating to http://127.0.0.1:5173/#/schedule?complex=complex-01&gh=gh-muii7dtg...");
    await page.goto("http://127.0.0.1:5173/#/schedule?complex=complex-01&gh=gh-muii7dtg", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page.waitForTimeout(4000);

    const schedTimeline = page.locator('text=Schedule Timeline').first();
    if (await schedTimeline.count() > 0) {
      await schedTimeline.scrollIntoViewIfNeeded();
    }
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "timeline_gh_screenshot.png", fullPage: false });
    console.log("Saved: timeline_gh_screenshot.png");

    await browser.close();
    console.log("GH DETAIL TIMELINE SCREENSHOT CAPTURED!");
  } catch (err) {
    console.error("Test error:", err);
  }
}

main();
