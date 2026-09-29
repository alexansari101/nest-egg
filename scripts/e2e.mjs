// End-to-end checks against a running dev server: node scripts/e2e.mjs [baseUrl] [shotDir]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const base = process.argv[2] || 'http://localhost:5317';
const shots = process.argv[3] || 'shots';
fs.mkdirSync(shots, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
// Force the download / <input type=file> fallbacks so the test can drive them.
await page.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const tileValue = (label) => page.locator('.stat', { hasText: label }).first().locator('.stat-value').innerText();

await page.goto(`${base}/#/dashboard`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.stat');
check((await tileValue('Net worth')) === '$1.45M', 'sample net worth shows $1.45M');
await page.waitForFunction(() => !document.querySelector('.stat .shimmer'), null, { timeout: 20000 });
check(/%$/.test(await tileValue('Plan success')), 'Monte Carlo success rate renders');

// --- Update balances: overwrite today's brokerage value
await page.getByRole('button', { name: 'Update balances' }).first().click();
const brokerage = page.getByLabel('Brokerage — index funds balance');
await brokerage.fill('286000');
await page.getByRole('button', { name: 'Save snapshot' }).click();
await page.waitForTimeout(300);
{ const v = await tileValue('Net worth'); check(v === '$1.55M', `net worth updates after snapshot (+$100K): ${v}`); }

// --- Record a snapshot on a new past date -> history gains a row
await page.goto(`${base}/#/history`);
const before = Number(await tileValue('Snapshots'));
await page.getByRole('button', { name: 'Update balances' }).first().click();
await page.locator('.modal input[type=date]').fill('2026-08-15');
await page.getByRole('button', { name: 'Save snapshot' }).click();
await page.waitForTimeout(300);
check(Number(await tileValue('Snapshots')) === before + 1, `new dated snapshot adds a history row (${before} -> ${before + 1})`);

// --- Edit a cell in the snapshot matrix
await page.getByRole('button', { name: 'Edit', exact: true }).click();
const cell = page.getByLabel('High-yield savings on 2026-08-15');
await cell.fill('50000');
await cell.press('Enter');
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'Done' }).click();
check(await page.locator('td', { hasText: '$50,000' }).count() > 0, 'matrix cell edit is saved');

// --- Persistence across reload
await page.reload();
await page.waitForSelector('.stat');
check((await tileValue('Net worth')) === '$1.55M', 'data persists after reload (localStorage)');

// --- Save to file (download) and verify JSON
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save', exact: true }).click()]);
const file = `${shots}/saved-plan.json`;
await dl.saveAs(file);
const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
check(saved.accounts.length === 7 && saved.debts.length === 2, 'saved file contains accounts and debts');
check(saved.accounts.find((a) => a.name.startsWith('Brokerage')).history.some((h) => h.value === 286000), 'saved file includes updated history');

// --- Change a rate and verify projections react
await page.goto(`${base}/#/projections`);
await page.waitForTimeout(500);
const peakBefore = await tileValue('Peak savings');
await page.goto(`${base}/#/accounts`);
const k401 = page.locator('.acct').filter({ has: page.locator('input.acct-name[value="Your 401(k)"]') });
await k401.getByLabel('Invested in').selectOption({ label: '40% stocks / 60% bonds' });
check((await k401.innerText()).includes('expected return'), '401(k) shows derived expected return for its mix');
await page.goto(`${base}/#/projections`);
await page.waitForTimeout(500);
const peakAfter = await tileValue('Peak savings');
check(peakAfter !== peakBefore, `changing an account's mix changes projections (${peakBefore} -> ${peakAfter})`);

// --- Market assumption flows through to all accounts
await page.goto(`${base}/#/plan`);
const stock = page.getByLabel('Stock return');
await stock.fill('6');
await stock.press('Enter');
await page.goto(`${base}/#/projections`);
await page.waitForTimeout(500);
const peakLow = await tileValue('Peak savings');
check(peakLow !== peakAfter, `lower S&P 500 assumption lowers projections (${peakAfter} -> ${peakLow})`);

// --- Years and ages render without thousands separators
await page.goto(`${base}/#/plan`);
const by = await page.getByLabel('Your birth year').inputValue();
check(/^\d{4}$/.test(by), `birth year renders as a plain year: "${by}"`);
await page.getByLabel('Your birth year').fill('1981');
await page.getByLabel('Your birth year').press('Enter');
check((await page.getByLabel('Your birth year').inputValue()) === '1981', 'birth year 1981 stays "1981" after editing');
check(!(await page.getByLabel('Your retirement age').inputValue()).includes(','), 'retirement age has no comma');

// --- Add account + debt
await page.goto(`${base}/#/accounts`);
const n0 = await page.locator('.acct').count();
await page.getByRole('button', { name: 'Add account' }).click();
check((await page.locator('.acct').count()) === n0 + 1, 'add account');
await page.goto(`${base}/#/debts`);
const d0 = await page.locator('.acct').count();
await page.getByLabel('New debt type').selectOption('credit');
await page.getByRole('button', { name: 'Add debt' }).click();
const newDebt = page.locator('.acct').last();
await newDebt.getByLabel('Current balance').fill('5000');
await newDebt.getByLabel('Current balance').press('Enter');
const inferred = await newDebt.getByLabel('Monthly payment').inputValue();
check(Number(inferred.replace(/[^0-9]/g, '')) > 150, `payment is inferred for a new credit card: $${inferred}`);
await newDebt.locator('.field', { hasText: 'Monthly payment' }).locator('input').fill('250');
await newDebt.locator('.field', { hasText: 'Monthly payment' }).locator('input').press('Enter');
await page.waitForTimeout(200);
check((await page.locator('.acct').count()) === d0 + 1, 'add debt');
check((await newDebt.innerText()).includes('Paid off'), 'new debt shows payoff estimate');
await page.screenshot({ path: `${shots}/e2e-debts.png`, fullPage: true });

// --- Start blank: all pages must survive an empty plan
await page.locator('button[title="More"]').click();
await page.getByRole('menuitem', { name: 'Start a blank plan' }).click();
await page.getByRole('menuitem', { name: /Erase everything/ }).click();
for (const r of ['dashboard', 'projections', 'accounts', 'debts', 'history', 'plan', 'taxes']) {
  await page.goto(`${base}/#/${r}`);
  await page.waitForTimeout(r === 'dashboard' ? 2500 : 400);
  await page.screenshot({ path: `${shots}/blank-${r}.png`, fullPage: true });
}
check(errors.length === 0, 'blank plan renders every page without errors');

// --- Re-open the saved file
await page.goto(`${base}/#/dashboard`);
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Open', exact: true }).click()]);
await chooser.setFiles(file);
await page.waitForTimeout(500);
check((await tileValue('Net worth')) === '$1.55M', 'opening the saved file restores the plan');

// --- Bad file is rejected gracefully
fs.writeFileSync(`${shots}/bad.json`, '{"hello": 1}');
const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Open', exact: true }).click()]);
await chooser2.setFiles(`${shots}/bad.json`);
await page.waitForTimeout(300);
check((await page.locator('.toast').innerText()).includes('Could not load'), 'invalid file shows an error toast');
check((await tileValue('Net worth')) === '$1.55M', 'invalid file leaves plan untouched');

// --- Theme toggle
await page.getByRole('radio', { name: 'Dark' }).click();
check((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'dark theme toggle');
await page.getByRole('radio', { name: 'System' }).click();

check(errors.length === 0, `no runtime errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await b.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
