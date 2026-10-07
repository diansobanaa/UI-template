import { chromium } from "playwright";

async function main() {
  try {
    const browser = await chromium.launch({
      headless: true,
      channel: "msedge",
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    
    // 1. Navigate to Schedule Page: http://127.0.0.1:5173/#/schedule
    console.log("Navigating to http://127.0.0.1:5173/#/schedule...");
    await page.goto("http://127.0.0.1:5173/#/schedule", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(4000);
    
    const schedTimeline = page.locator('text=Schedule Timeline').first();
    if (await schedTimeline.count() > 0) {
      await schedTimeline.scrollIntoViewIfNeeded();
    }
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "timeline_schedule_screenshot.png", fullPage: false });
    console.log("Saved: timeline_schedule_screenshot.png");

    // 2. Navigate to Complex Page: http://127.0.0.1:5173/#/complex
    console.log("Navigating to http://127.0.0.1:5173/#/complex...");
    await page.goto("http://127.0.0.1:5173/#/complex", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(4000);

    const complexTimeline = page.locator('text=Schedule Timeline').first();
    if (await complexTimeline.count() > 0) {
      await complexTimeline.scrollIntoViewIfNeeded();
    }
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "timeline_complex_screenshot.png", fullPage: false });
    console.log("Saved: timeline_complex_screenshot.png");

    await browser.close();
    console.log("ALL SCREENSHOTS CAPTURED WITH HASH ROUTER SUCCESSFULLY!");
  } catch (err) {
    console.error("Playwright screenshot error:", err);
  }
}

main();
