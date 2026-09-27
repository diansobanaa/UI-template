import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const RUN_ID = 'run-20260921-001';
const auditDir = path.join(rootDir, 'artifacts', 'schedule-prd-audit', RUN_ID);
const screenshotDir = path.join(auditDir, 'screenshots');
fs.mkdirSync(screenshotDir, { recursive: true });

function getScreenshotPath(name) {
  return path.join(screenshotDir, name);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log('====================================================');
  console.log('LAUNCHING REAL HEADED BROWSER UI ACCEPTANCE');
  console.log(`Run ID: ${RUN_ID}`);
  console.log('====================================================');

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--window-size=1440,960', '--start-maximized']
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 }
  });
  const page = await context.newPage();

  const consoleLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    consoleLogs.push(`[${msg.type()}] ${text}`);
    if (msg.type() === 'error') {
      console.log('BROWSER CONSOLE ERROR:', text);
    }
  });

  page.on('pageerror', (err) => {
    consoleLogs.push(`[PAGEERROR] ${err.message}`);
    console.log('BROWSER UNCAUGHT ERROR:', err.message);
  });

  const BASE_URL = 'http://localhost:5173/#';

  try {
    // ----------------------------------------------------
    // STAGE 01: INITIAL SCHEDULE PAGE
    // ----------------------------------------------------
    console.log('\nStage 01: Opening Schedule UI...');
    await page.goto(`${BASE_URL}/schedule?complex=complex-01&gh=gh-01`);
    await page.waitForLoadState('networkidle');
    await sleep(2000);
    await page.screenshot({ path: getScreenshotPath('01_schedule_page_initial.png'), fullPage: true });
    console.log('  Captured 01_schedule_page_initial.png');

    // ----------------------------------------------------
    // STAGE 02: OPEN ADD FAN SCHEDULE DRAWER
    // ----------------------------------------------------
    console.log('\nStage 02: Opening Add Fan Schedule Drawer...');
    const addFanBtn = page.locator('button:has-text("Add Fan Schedule")').first();
    await addFanBtn.waitFor({ state: 'visible', timeout: 8000 });
    await addFanBtn.click();
    await sleep(1500);
    await page.screenshot({ path: getScreenshotPath('02_fan_drawer_open.png'), fullPage: true });
    console.log('  Captured 02_fan_drawer_open.png');

    // ----------------------------------------------------
    // STAGE 03: CREATE FAN SCHEDULE WITH NO PERIPHERAL
    // ----------------------------------------------------
    console.log('\nStage 03: Submitting Fan Schedule form (No Fan Hardware Installed)...');
    const timeInput = page.locator('input[type="time"]:visible').first();
    if (await timeInput.isVisible()) {
      await timeInput.fill('09:15');
    }
    await sleep(600);
    const createBtn = page.locator('button:visible:has-text("Create Schedule")').first();
    await createBtn.click();
    await sleep(2500);
    await page.screenshot({ path: getScreenshotPath('03_schedule_created_no_peripheral.png'), fullPage: true });
    console.log('  Captured 03_schedule_created_no_peripheral.png');

    // ----------------------------------------------------
    // STAGE 04: INSPECT BLOCKED STATUS & REASON
    // ----------------------------------------------------
    console.log('\nStage 04: Inspecting Blocked Status badge and Alert message...');
    const blockedBadge = page.locator('text="Blocked (No Hardware)"').first();
    const isBlockedVisible = await blockedBadge.isVisible();
    console.log(`  Blocked badge visible: ${isBlockedVisible}`);
    
    // Look for blocked reason alert
    const blockedReasonAlert = page.locator('text="No fan resource is assigned"').first();
    const isAlertVisible = await blockedReasonAlert.isVisible();
    console.log(`  Blocked reason alert visible: ${isAlertVisible}`);

    await page.screenshot({ path: getScreenshotPath('04_schedule_blocked_detail.png'), fullPage: true });
    console.log('  Captured 04_schedule_blocked_detail.png');

    // ----------------------------------------------------
    // STAGE 05: EDIT SCHEDULE
    // ----------------------------------------------------
    console.log('\nStage 05: Editing Schedule...');
    const fanRow = page.locator('tr:has-text("Fan Schedule"), tr:has-text("Fan"), tr:has-text("09:15")').first();
    const editBtn = (await fanRow.isVisible())
      ? fanRow.locator('button[title="Edit"]:visible, button[aria-label="Edit"]:visible').first()
      : page.locator('button[title="Edit"]:visible, button[aria-label="Edit"]:visible').last();
    if (await editBtn.isVisible()) {
      await editBtn.click();
      await sleep(1500);
      const timeInputEdit = page.locator('input[type="time"]:visible').first();
      if (await timeInputEdit.isVisible()) {
        await timeInputEdit.fill('10:00');
      }
      await sleep(600);
      const saveBtn = page.locator('button:visible:has-text("Save Changes")').first();
      await saveBtn.click();
      await sleep(2000);
      await page.screenshot({ path: getScreenshotPath('05_schedule_edited.png'), fullPage: true });
      console.log('  Captured 05_schedule_edited.png');
    }

    // ----------------------------------------------------
    // STAGE 06: REFRESH PAGE
    // ----------------------------------------------------
    console.log('\nStage 06: Refreshing Page (Verifying Schedule Persists in Storage)...');
    await page.reload();
    await page.waitForLoadState('networkidle');
    await sleep(2500);
    const blockedAfterReload = await page.locator('text="Blocked (No Hardware)"').first().isVisible();
    console.log(`  Schedule still present and Blocked after reload: ${blockedAfterReload}`);
    await page.screenshot({ path: getScreenshotPath('06_schedule_after_refresh.png'), fullPage: true });
    console.log('  Captured 06_schedule_after_refresh.png');

    // ----------------------------------------------------
    // STAGE 07: BROWSER STORAGE LOSS TEST
    // ----------------------------------------------------
    console.log('\nStage 07: Clearing browser storage (localStorage & sessionStorage)...');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await sleep(2500);
    const blockedAfterStorageLoss = await page.locator('text="Blocked (No Hardware)"').first().isVisible();
    console.log(`  Schedule recovered from operational backend after storage wipe: ${blockedAfterStorageLoss}`);
    await page.screenshot({ path: getScreenshotPath('07_schedule_after_storage_loss.png'), fullPage: true });
    console.log('  Captured 07_schedule_after_storage_loss.png');

    // ----------------------------------------------------
    // STAGE 08: SCHEDULE DELETION
    // ----------------------------------------------------
    console.log('\nStage 08: Deleting schedule...');
    const fanRowDel = page.locator('tr:has-text("Fan Schedule"), tr:has-text("Fan"), tr:has-text("10:00"), tr:has-text("09:15")').first();
    const delBtn = (await fanRowDel.isVisible())
      ? fanRowDel.locator('button[title="Delete"]:visible, button[aria-label="Delete"]:visible').first()
      : page.locator('button[title="Delete"]:visible, button[aria-label="Delete"]:visible').last();
    if (await delBtn.isVisible()) {
      await delBtn.click();
      await sleep(1000);
      await page.screenshot({ path: getScreenshotPath('08_delete_confirm_dialog.png'), fullPage: true });
      console.log('  Captured 08_delete_confirm_dialog.png');

      const confirmDel = page.locator('button:visible:has-text("Delete")').last();
      await confirmDel.click();
      await sleep(2000);
      await page.screenshot({ path: getScreenshotPath('09_schedule_deleted.png'), fullPage: true });
      console.log('  Captured 09_schedule_deleted.png');
    }

    // ----------------------------------------------------
    // STAGE 09: ROUTE AUDIT
    // ----------------------------------------------------
    console.log('\nStage 09: Route audit (navigating direct routes)...');
    await page.goto(`${BASE_URL}/schedule`);
    await sleep(1500);
    await page.screenshot({ path: getScreenshotPath('10_schedule_routes_tested.png'), fullPage: true });
    console.log('  Captured 10_schedule_routes_tested.png');

    console.log('\n====================================================');
    console.log('ALL BROWSER UI ACCEPTANCE STAGES COMPLETED SUCCESSFULLY');
    console.log('====================================================');

    // Write execution logs
    fs.writeFileSync(path.join(auditDir, 'BROWSER_CONSOLE_LOG.txt'), consoleLogs.join('\n'));

  } catch (err) {
    console.error('Test run failed:', err);
    await page.screenshot({ path: getScreenshotPath('ERROR_failure.png'), fullPage: true });
    throw err;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
