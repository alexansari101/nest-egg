// Regenerates the README screenshots in docs/screenshots from the sample plan.
// Usage: npm run dev (in another terminal), then node scripts/readme-shots.mjs [baseUrl]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const base = process.argv[2] || 'http://localhost:5317';
const out = 'docs/screenshots';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium' });

async function open(mode, size, route) {
  const ctx = await browser.newContext({ viewport: size, colorScheme: mode, deviceScaleFactor: size.width < 600 ? 2 : 1 });
  const page = await ctx.newPage();
  await page.goto(`${base}/#/${route}`);
  await page.waitForTimeout(1500);
  // The sustainable-spending and earliest-retirement searches run in a worker; wait for them.
  await page.waitForFunction(() => !document.body.innerText.includes('searching'), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(500);
  return { ctx, page };
}
const card = (page, title) => page.locator('section.card', { hasText: title }).first();

const desktop = { width: 1440, height: 900 };
{
  const { ctx, page } = await open('light', desktop, 'dashboard');
  await page.screenshot({ path: `${out}/overview.png`, fullPage: true });
  await ctx.close();
}
{
  const { ctx, page } = await open('light', desktop, 'projections');
  await card(page, 'Projected balance sheet').screenshot({ path: `${out}/balance-sheet.png` });
  await card(page, 'Range of outcomes').screenshot({ path: `${out}/range-of-outcomes.png` });
  await page.getByRole('tab', { name: 'Where it goes' }).click();
  await page.waitForTimeout(400);
  await card(page, 'Retirement paycheck').screenshot({ path: `${out}/retirement-paycheck.png` });
  await card(page, 'Healthcare costs').screenshot({ path: `${out}/healthcare.png` });
  await ctx.close();
}
for (const [route, name] of [['accounts', 'accounts'], ['taxes', 'taxes'], ['history', 'history']]) {
  const { ctx, page } = await open('light', desktop, route);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
  await ctx.close();
}
{
  const { ctx, page } = await open('dark', desktop, 'dashboard');
  await page.screenshot({ path: `${out}/overview-dark.png`, fullPage: false });
  await ctx.close();
}
{
  const { ctx, page } = await open('light', { width: 390, height: 844 }, 'dashboard');
  await page.screenshot({ path: `${out}/phone-overview.png`, fullPage: false });
  await ctx.close();
}
await browser.close();
console.log('done');
