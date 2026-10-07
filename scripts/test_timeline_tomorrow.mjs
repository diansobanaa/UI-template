import { chromium } from "playwright";

async function main() {
  try {
    const browser = await chromium.launch({
      headless: true,
      channel: "msedge",
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    
    await page.goto("http://127.0.0.1:5173/#/complex", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(4000);

    const complexTimeline = page.locator('text=Schedule Timeline').first();
    await complexTimeline.scrollIntoViewIfNeeded();

    // Click Next Day (ChevronRight in date navigation)
    console.log("Clicking Next Day...");
    const nextDayBtn = page.locator('button[title="Next Day"]').first();
    await nextDayBtn.click();
    await page.waitForTimeout(1000);

    await page.screenshot({ path: "timeline_tomorrow_screenshot.png", fullPage: false });
    console.log("Saved: timeline_tomorrow_screenshot.png");

    await browser.close();
    console.log("NEXT DAY TEST FINISHED!");
  } catch (err) {
    console.error("Test error:", err);
  }
}

main();
