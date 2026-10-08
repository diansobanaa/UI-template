// scripts/test_browser_audio_alarm.mjs
// Live browser validation for Web UI audio alarm via msedge

import { chromium } from "playwright";

async function run() {
  console.log("=== STARTING LIVE BROWSER AUDIO ALARM VALIDATION ===");
  const browser = await chromium.launch({
    headless: true,
    channel: "msedge",
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // Capture console messages
  page.on("console", (msg) => {
    console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
  });

  console.log("Navigating to http://127.0.0.1:5173...");
  await page.goto("http://127.0.0.1:5173", { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(2000);

  // 1. Check AudioContext before user interaction
  const audioStateBefore = await page.evaluate(() => {
    // Check if AudioContext was created or is null/suspended
    return {
      hasWindowAudio: typeof window.AudioContext !== "undefined",
    };
  });
  console.log("Audio capability:", audioStateBefore);

  // 2. Perform user gesture (click on the page)
  console.log("Simulating user gesture click to unlock audio...");
  await page.click("body");
  await page.waitForTimeout(500);

  // 3. Test triggering alarm condition in browser runtime
  console.log("Triggering alarm condition in live browser...");
  const alarmEvalResult = await page.evaluate(async () => {
    const alarmModule = await import("/src/lib/alarm-audio.ts");
    
    // Check unlock
    alarmModule.unlockAudio();
    const ctx = alarmModule.getAudioContext();
    const stateBefore = ctx ? ctx.state : "null";

    // Set offline condition
    alarmModule.setAlarmCondition("browser-test-offline", true);
    const isRunning = alarmModule.isAlarmLoopRunning();
    const isActive = alarmModule.isAlarmActive();

    // Verify pulse playback
    const pulseSuccess = alarmModule.playBuzzerPulse();

    // Clear condition
    alarmModule.setAlarmCondition("browser-test-offline", false);
    const isRunningAfter = alarmModule.isAlarmLoopRunning();
    const isActiveAfter = alarmModule.isAlarmActive();

    return {
      audioState: stateBefore,
      isRunningWhileActive: isRunning,
      isActiveWhileActive: isActive,
      pulseSuccess,
      isRunningAfterClear: isRunningAfter,
      isActiveAfterClear: isActiveAfter,
    };
  });

  console.log("Browser evaluation result:", alarmEvalResult);

  if (alarmEvalResult.isRunningWhileActive && !alarmEvalResult.isRunningAfterClear && alarmEvalResult.pulseSuccess) {
    console.log("✓ LIVE BROWSER AUDIO ALARM VERIFIED SUCCESSFULLY!");
  } else {
    console.error("✗ LIVE BROWSER VALIDATION FAILED:", alarmEvalResult);
    process.exit(1);
  }

  await browser.close();
  console.log("=== BROWSER VALIDATION COMPLETE ===");
}

run().catch((err) => {
  console.error("Browser validation script error:", err);
  process.exit(1);
});
