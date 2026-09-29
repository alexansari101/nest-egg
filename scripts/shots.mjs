// Visual smoke test: screenshots every page in light/dark at desktop and phone widths,
// and fails on any console error. Usage: node scripts/shots.mjs [outDir] [baseUrl]
import { chromium } from 'playwright-core';
const out = process.argv[2] || 'shots';
const base = process.argv[3] || 'http://localhost:5317';
const routes = ['dashboard', 'projections', 'accounts', 'debts', 'history', 'plan', 'taxes'];
const only = process.env.ROUTES ? process.env.ROUTES.split(',') : routes;
const modes = (process.env.MODES || 'light,dark').split(',');
const sizes = (process.env.SIZES || 'desktop,phone').split(',');
const dims = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium' });
const errors = [];
for (const size of sizes) {
  for (const mode of modes) {
    const ctx = await browser.newContext({ viewport: dims[size], colorScheme: mode, deviceScaleFactor: size === 'phone' ? 2 : 1 });
    const page = await ctx.newPage();
    page.on('console', (m) => m.type() === 'error' && errors.push(`[${size}/${mode}] ${m.text()}`));
    page.on('pageerror', (e) => errors.push(`[${size}/${mode}] pageerror ${e.message}`));
    for (const r of only) {
      await page.goto(`${base}/#/${r}`);
      await page.waitForTimeout(r === 'dashboard' || r === 'projections' ? 3500 : 700);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) errors.push(`[${size}/${mode}] ${r}: horizontal overflow ${overflow}px`);
      await page.screenshot({ path: `${out}/${size}-${mode}-${r}.png`, fullPage: true });
    }
    await ctx.close();
  }
}
await browser.close();
console.log(errors.length ? errors.join('\n') : 'no console errors');
