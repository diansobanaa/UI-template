import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const RUN_ID = 'run-20260921-001';
const screenshotDir = path.join(rootDir, 'artifacts', 'ux-acceptance', RUN_ID, 'screenshots');
fs.mkdirSync(screenshotDir, { recursive: true });

function getScreenshotPath(name) {
  return path.join(screenshotDir, name);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function resetBackendComplexes() {
  try {
    console.log('Resetting backend topology pool & operational store via API...');
    const res = await fetch('http://127.0.0.1:8090/api/v1/topology-pool/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (res.ok) {
      const data = await res.json();
      console.log('Reset result:', data.status);
    } else {
      console.warn('Reset response status:', res.status);
    }
  } catch (err) {
    console.warn('Backend reset note:', err.message);
  }
}

async function run() {
  console.log('=== Step 0: Clean State Preparation ===');
  await resetBackendComplexes();
  await sleep(1000);

  console.log('Launching visible/headed Google Chrome browser...');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--window-size=1440,960', '--start-maximized']
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log('BROWSER CONSOLE ERROR:', msg.text());
    }
  });

  page.on('pageerror', (err) => {
    console.log('BROWSER UNCAUGHT ERROR:', err.message);
  });

  const BASE_URL = 'http://localhost:5181/#';
  let gh3Id = 'gh-03';

  try {
    // ----------------------------------------------------
    // S01: INITIAL EMPTY STATE
    // ----------------------------------------------------
    console.log('Step 1: Navigating to /complex and checking initial empty state...');
    await page.goto(`${BASE_URL}/complex`);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await sleep(2500);

    await page.screenshot({ path: getScreenshotPath('S01_initial_empty.png'), fullPage: true });
    console.log('Captured S01_initial_empty.png');

    // ----------------------------------------------------
    // S02: CREATE 1 COMPLEX (Complex Test, Test Address 001)
    // ----------------------------------------------------
    console.log('Step 2: Creating 1 Complex (Complex Test, Test Address 001)...');
    const addBtn = page.locator('button:has-text("Add Complex & ESP32")').first();
    await addBtn.click();
    await page.waitForURL('**/onboarding/complex**');
    await sleep(1500);

    // Fill Step 0 of onboarding: Name, Location
    const nameInput = page.locator('input[placeholder="Research Complex North"]');
    await nameInput.fill('Complex Test');
    await sleep(500);

    const locationInput = page.locator('input[placeholder="Lembang, Indonesia"]');
    await locationInput.fill('Test Address 001');
    await sleep(800);

    const createBtn = page.locator('button:has-text("Create & continue")');
    await createBtn.click();
    await sleep(2500);

    // Navigate back to /complex to view the newly created complex overview
    await page.goto(`${BASE_URL}/complex`);
    await page.waitForLoadState('networkidle');
    await sleep(2000);

    await page.screenshot({ path: getScreenshotPath('S02_complex_created.png'), fullPage: true });
    console.log('Captured S02_complex_created.png');

    // ----------------------------------------------------
    // S03: EDIT COMPLEX NAME -> "Complex Test Renamed"
    // ----------------------------------------------------
    console.log('Step 3: Editing complex name to Complex Test Renamed...');
    const editComplexBtn = page.locator('button:has-text("Edit")').first();
    await editComplexBtn.click();
    await sleep(1200);

    const editNameInput = page.locator('input[placeholder="Greenhouse Complex"], label:has-text("Complex Name") ~ input').first();
    await editNameInput.fill('Complex Test Renamed');
    await sleep(600);

    const saveChangesBtn = page.locator('button:has-text("Save Changes")');
    await saveChangesBtn.click();
    await sleep(2000);

    await page.screenshot({ path: getScreenshotPath('S03_complex_name_edited.png'), fullPage: true });
    console.log('Captured S03_complex_name_edited.png');

    // ----------------------------------------------------
    // S04: EDIT COMPLEX ADDRESS -> "Test Address 002"
    // ----------------------------------------------------
    console.log('Step 4: Editing complex address to Test Address 002...');
    await editComplexBtn.click();
    await sleep(1200);

    const editLocationInput = page.locator('input[placeholder="Lembang, Indonesia"], label:has-text("Location") ~ input').first();
    await editLocationInput.fill('Test Address 002');
    await sleep(600);

    await saveChangesBtn.click();
    await sleep(2000);

    await page.screenshot({ path: getScreenshotPath('S04_complex_address_edited.png'), fullPage: true });
    console.log('Captured S04_complex_address_edited.png');

    // ----------------------------------------------------
    // S05: REFRESH & CONTROLLER REDISCOVERY
    // ----------------------------------------------------
    console.log('Step 5: Refreshing page and verifying controller rediscovery...');
    await page.reload();
    await page.waitForLoadState('networkidle');
    await sleep(3000);

    await page.screenshot({ path: getScreenshotPath('S05_complex_rediscovered.png'), fullPage: true });
    console.log('Captured S05_complex_rediscovered.png');

    // ----------------------------------------------------
    // S06: CREATE 3 GREENHOUSES (GH-01, GH-02, GH-03)
    // ----------------------------------------------------
    console.log('Step 6: Creating 3 Greenhouses (GH-01, GH-02, GH-03)...');

    async function createGh(cropName) {
      console.log(`Adding Greenhouse: crop = ${cropName}...`);
      const addGhBtn = page.locator('button:has-text("Add GH"), button:has-text("Add Greenhouse")').first();
      await addGhBtn.click();
      await sleep(1000);

      // Select crop button inside modal
      const cropBtn = page.locator(`button:has-text("${cropName}")`).first();
      if (await cropBtn.isVisible()) {
        await cropBtn.click();
        await sleep(400);
      }

      const submitGhBtn = page.locator('button:has-text("Create Greenhouse")');
      await submitGhBtn.click();
      await sleep(2500);
    }

    await createGh('Tomato');      // Generates GH 01
    await createGh('Cucumber');    // Generates GH 02
    await createGh('Bell Pepper');  // Generates GH 03

    await sleep(2000);
    await page.screenshot({ path: getScreenshotPath('S06_three_gh_created.png'), fullPage: true });
    console.log('Captured S06_three_gh_created.png');

    // ----------------------------------------------------
    // S07: GH-01 KEEP -> INSPECT GH-01 DETAIL
    // ----------------------------------------------------
    console.log('Step 7: Inspecting GH-01 detail page (KEEP)...');
    const gh1Link = page.locator('a:has-text("GH 01"), a:has-text("GH-01")').first();
    await gh1Link.click();
    await page.waitForURL('**/greenhouse/**');
    await page.waitForLoadState('networkidle');
    await sleep(3000);

    await page.screenshot({ path: getScreenshotPath('S07_gh01_keep.png'), fullPage: true });
    console.log('Captured S07_gh01_keep.png');

    // Navigate back to complex overview
    await page.goto(`${BASE_URL}/complex`);
    await page.waitForLoadState('networkidle');
    await sleep(2000);

    // ----------------------------------------------------
    // S08: GH-02 EDIT FORM OPEN
    // ----------------------------------------------------
    console.log('Step 8: Opening GH-02 edit form...');
    const gh2EditBtn = page.locator('button[aria-label="Edit GH 02"], button[aria-label="Edit GH-02"]').first();
    await gh2EditBtn.click();
    await sleep(1200);

    await page.screenshot({ path: getScreenshotPath('S08_gh02_edit_form.png'), fullPage: true });
    console.log('Captured S08_gh02_edit_form.png');

    // ----------------------------------------------------
    // S09: GH-02 EDITED -> "GH-02 Renamed"
    // ----------------------------------------------------
    console.log('Step 9: Saving GH-02 as GH-02 Renamed...');
    const ghCodeInput = page.locator('input[placeholder="GH tag"], label:has-text("Greenhouse Tag") ~ input, label:has-text("Greenhouse Code") ~ input').first();
    await ghCodeInput.fill('GH-02 Renamed');
    await sleep(500);

    const saveGhBtn = page.locator('button:has-text("Save Changes")');
    await saveGhBtn.click();
    await sleep(2500);

    await page.screenshot({ path: getScreenshotPath('S09_gh02_edited.png'), fullPage: true });
    console.log('Captured S09_gh02_edited.png');

    // ----------------------------------------------------
    // S10: GH-02 REFRESH & CONTROLLER REDISCOVERY
    // ----------------------------------------------------
    console.log('Step 10: Refreshing page and verifying GH-02 Renamed persistence...');
    await page.reload();
    await page.waitForLoadState('networkidle');
    await sleep(3000);

    await page.screenshot({ path: getScreenshotPath('S10_gh02_rediscovered.png'), fullPage: true });
    console.log('Captured S10_gh02_rediscovered.png');

    // ----------------------------------------------------
    // S11: GH-03 DETAIL BEFORE DELETION
    // ----------------------------------------------------
    console.log('Step 11: Inspecting GH-03 before deletion...');
    const gh3Card = page.locator('div:has(a:has-text("GH 03")), div:has(a:has-text("GH-03"))').last();
    await gh3Card.scrollIntoViewIfNeeded();
    await sleep(800);

    // Extract GH-03 ID if available from the card's link
    const gh3CardLink = gh3Card.locator('a[href*="/greenhouse/"]').first();
    if (await gh3CardLink.count() > 0) {
      const href = await gh3CardLink.getAttribute('href');
      if (href) {
        const match = href.match(/greenhouse\/([^\/\?]+)/);
        if (match) gh3Id = match[1];
      }
    }
    console.log(`Navigating to GH-03 detail (${BASE_URL}/greenhouse/${gh3Id})...`);
    await page.goto(`${BASE_URL}/greenhouse/${gh3Id}`);
    await page.waitForLoadState('networkidle');
    await sleep(3000);

    await page.screenshot({ path: getScreenshotPath('S11_gh03_before_delete.png'), fullPage: true });
    console.log(`Captured S11_gh03_before_delete.png (gh3Id = ${gh3Id})`);

    // ----------------------------------------------------
    // S12: GH-03 DELETE CONFIRMATION MODAL
    // ----------------------------------------------------
    console.log('Step 12: Triggering GH-03 deletion confirmation modal on detail page...');
    const deleteGhDetailBtn = page.locator('button:has-text("Delete GH")').first();
    await deleteGhDetailBtn.click();
    await sleep(1200);

    await page.screenshot({ path: getScreenshotPath('S12_gh03_delete_confirmation.png'), fullPage: true });
    console.log('Captured S12_gh03_delete_confirmation.png');

    // ----------------------------------------------------
    // S13: CONFIRM DELETE GH-03 -> 2 GH REMAINING
    // ----------------------------------------------------
    console.log('Step 13: Confirming GH-03 deletion and waiting for redirect to complex overview...');
    const confirmDeleteBtn = page.locator('button:has-text("Delete Greenhouse")').last();
    await confirmDeleteBtn.click();
    await page.waitForURL('**/complex**');
    await page.waitForLoadState('networkidle');
    await sleep(3000);

    await page.screenshot({ path: getScreenshotPath('S13_gh03_deleted.png'), fullPage: true });
    console.log('Captured S13_gh03_deleted.png');

    // ----------------------------------------------------
    // S14: TEST OLD DELETED GH-03 ROUTE
    // ----------------------------------------------------
    console.log(`Step 14: Navigating to deleted GH-03 URL (${BASE_URL}/greenhouse/${gh3Id}) to verify safe Not Found handling...`);
    await page.goto(`${BASE_URL}/greenhouse/${gh3Id}`);
    await page.waitForLoadState('networkidle');
    await sleep(2500);

    await page.screenshot({ path: getScreenshotPath('S14_gh03_deleted_route.png'), fullPage: true });
    console.log('Captured S14_gh03_deleted_route.png');

    // Also capture as BUG-001-after.png
    await page.screenshot({ path: getScreenshotPath('BUG-001-after.png'), fullPage: true });

    // ----------------------------------------------------
    // S15: FINAL TOPOLOGY OVERVIEW BEFORE STORAGE CLEAR
    // ----------------------------------------------------
    console.log('Step 15: Viewing final topology overview before storage clear...');
    const returnBtn = page.locator('button:has-text("Return to Complex Overview")').first();
    if (await returnBtn.isVisible()) {
      await returnBtn.click();
    } else {
      await page.goto(`${BASE_URL}/complex`);
    }
    await page.waitForLoadState('networkidle');
    await sleep(2000);

    await page.screenshot({ path: getScreenshotPath('S15_final_before_storage_clear.png'), fullPage: true });
    console.log('Captured S15_final_before_storage_clear.png');

    // ----------------------------------------------------
    // S16: CLEAR BROWSER STORAGE & PROVE REDISCOVERY
    // ----------------------------------------------------
    console.log('Step 16: Clearing browser storage and rediscovering from authoritative pool...');
    await context.clearCookies();
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await sleep(1500);

    await page.goto(`${BASE_URL}/complex`);
    await page.waitForLoadState('networkidle');
    await sleep(4000);

    await page.screenshot({ path: getScreenshotPath('S16_final_after_rediscovery.png'), fullPage: true });
    console.log('Captured S16_final_after_rediscovery.png');

    console.log('=== All 16 acceptance test steps completed successfully! ===');
  } catch (err) {
    console.error('Test step failed:', err);
    await page.screenshot({ path: getScreenshotPath('ERROR_failure.png') });
    throw err;
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error('Fatal execution error:', e);
  process.exit(1);
});
