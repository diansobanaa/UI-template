import { chromium } from 'playwright';

async function check() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  page.on('console', m => console.log('CONSOLE:', m.type(), m.text()));
  page.on('pageerror', e => console.log('PAGEERROR:', e.message, '\n', e.stack));
  
  await page.goto('http://localhost:5181/#/complex');
  await page.waitForTimeout(2000);
  const link = await page.locator('a[href*="/greenhouse/"]').first().getAttribute('href');
  console.log('Found link:', link);
  
  await page.goto('http://localhost:5181/' + link);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'artifacts/ux-acceptance/run-20260921-001/screenshots/S07_gh01_detail.png', fullPage: true });
  console.log('Saved S07_gh01_detail.png successfully!');
  await browser.close();
}

check().catch(console.error);
