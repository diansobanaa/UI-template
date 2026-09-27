import { chromium } from 'playwright';

const espIp = '192.168.0.139';

async function main() {
  console.log('Launching browser to simulate operator flow...');
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // Add bootstrap address hint so browser knows where ESP32 is
  await context.addInitScript((ip) => {
    localStorage.setItem('agrotech_bootstrap_ips', JSON.stringify([`http://${ip}`]));
    document.cookie = `agrotech_bootstrap_ip=http://${ip}; path=/`;
  }, espIp);

  const page = await context.newPage();

  page.on('console', msg => console.log(`[CONSOLE ${msg.type()}]`, msg.text()));
  page.on('pageerror', err => console.log('[PAGEERROR]', err.message));
  page.on('request', req => {
    if (req.url().includes('schedule')) {
      console.log(`[REQ] ${req.method()} ${req.url()}`);
    }
  });
  page.on('response', res => {
    if (res.url().includes('schedule')) {
      console.log(`[RES] ${res.status()} ${res.url()}`);
    }
  });

  console.log('Navigating to http://localhost:5173/#/schedule?complex=complex-01');
  await page.goto('http://localhost:5173/#/schedule?complex=complex-01');
  await page.waitForLoadState('networkidle');
  await new Promise(r => setTimeout(r, 3000));

  console.log('Clicking "Add Well Pump Schedule"...');
  const addBtn = page.locator('button:has-text("Add Well Pump Schedule")').first();
  await addBtn.click();
  await new Promise(r => setTimeout(r, 1000));

  console.log('Filling form: Task Name = "Pompa Sumur Pagi", Time = "06:30", Duration = 2 min...');
  const taskInput = page.locator('input:visible').filter({ hasText: '' }).nth(1); // or label Task Name
  await page.locator('label:has-text("Task Name") + input, div:has(> label:has-text("Task Name")) input').fill('Pompa Sumur Pagi');
  await page.locator('input[type="time"]:visible').fill('06:30');
  
  // Duration input
  const durInput = page.locator('label:has-text("Duration") ~ div input, label:has-text("Duration") + div input').first();
  if (await durInput.isVisible()) {
    await durInput.fill('2');
  }

  await new Promise(r => setTimeout(r, 1000));

  console.log('Submitting form...');
  const submitBtn = page.locator('button:visible:has-text("Create Schedule")').first();
  await submitBtn.click();
  await new Promise(r => setTimeout(r, 3000));

  console.log('Checking ESP32 directly via curl/http...');
  const http = await import('http');
  const checkEsp = () => new Promise(res => {
    http.get(`http://${espIp}/api/v1/schedule-intents`, { headers: { 'Authorization': 'Bearer agrotech-secret-key' } }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => res(d));
    });
  });

  const espDataBeforeReload = await checkEsp();
  console.log('ESP32 data immediately after creation:', espDataBeforeReload);

  console.log('Now reloading browser (F5)...');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await new Promise(r => setTimeout(r, 4000));

  const espDataAfterReload = await checkEsp();
  console.log('ESP32 data after browser reload:', espDataAfterReload);

  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('Page text after reload contains "Pompa Sumur Pagi":', bodyText.includes('Pompa Sumur Pagi'));

  await browser.close();
}

main().catch(console.error);
