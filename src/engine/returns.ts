// How each account's expected return and volatility are derived.
//
// Most people don't know their portfolio's expected return, but they do know roughly
// what they own. So accounts pick a simple mix instead:
//   - a stock/bond split, where "stocks" means an S&P 500 index fund and
//     "bonds" means intermediate US Treasuries
//   - 'auto': a target-date glide path that de-risks toward and through retirement
//   - 'custom': the account's own returnRate / volatility (e.g. a CD, crypto, a rental)
// The asset-class assumptions live in one place (Plan → Assumptions) so changing
// "stocks return 8%" updates every account at once.

import type { Account, Allocation, Assumptions, Plan } from './types';

/** Long-run correlation between US stocks and Treasuries (near zero, slightly positive). */
export const STOCK_BOND_CORRELATION = 0.1;
export const CASH_VOLATILITY = 0.5;

export const ALLOCATION_PRESETS: { value: Allocation; label: string; short: string }[] = [
  { value: 'auto', label: 'Target-date fund (auto glide path)', short: 'Target-date' },
  { value: 100, label: '100% stocks — S&P 500 index', short: '100% S&P 500' },
  { value: 80, label: '80% stocks / 20% bonds', short: '80/20' },
  { value: 60, label: '60% stocks / 40% bonds', short: '60/40' },
  { value: 40, label: '40% stocks / 60% bonds', short: '40/60' },
  { value: 0, label: '100% bonds — US Treasuries', short: 'Treasuries' },
  { value: 'custom', label: 'Custom return…', short: 'Custom' },
];

export function allocationLabel(a: Allocation): string {
  const p = ALLOCATION_PRESETS.find((x) => x.value === a);
  if (p) return p.short;
  return typeof a === 'number' ? `${a}/${100 - a}` : 'Custom';
}

/**
 * Stock share for a target-date fund, similar to major providers' glide paths:
 * 90% stocks until 25 years out, sliding to 50% at retirement, then to 30% seven years later.
 */
export function glideStockPct(age: number, retirementAge: number): number {
  const toGo = retirementAge - age;
  if (toGo >= 25) return 90;
  if (toGo >= 0) return 50 + (40 * toGo) / 25;
  return Math.max(30, 50 - (20 * -toGo) / 7);
}

/** Expected return and volatility (both in %) of a stock/bond mix. */
export function blend(stockPct: number, A: Assumptions): { rate: number; vol: number } {
  const w = Math.min(100, Math.max(0, stockPct)) / 100;
  const s = A.stockVolatility;
  const b = A.bondVolatility;
  const rate = w * A.stockReturn + (1 - w) * A.bondReturn;
  const vol = Math.sqrt(w * w * s * s + (1 - w) * (1 - w) * b * b + 2 * w * (1 - w) * STOCK_BOND_CORRELATION * s * b);
  return { rate, vol };
}

export const INVESTMENT_TYPES = new Set(['taxable', 'traditional', 'roth', 'hsa'] as const);
export const usesMix = (a: Pick<Account, 'type'>) => INVESTMENT_TYPES.has(a.type as never);

/**
 * Expected return and volatility for an account in a given year (percent).
 * `ownerAge` / `ownerRetirementAge` drive the target-date glide path.
 */
export function accountReturn(
  a: Account,
  A: Assumptions,
  ownerAge: number,
  ownerRetirementAge: number,
): { rate: number; vol: number } {
  if (a.type === 'cash') {
    return a.allocation === 'custom' ? { rate: a.returnRate, vol: a.volatility } : { rate: A.cashReturn, vol: CASH_VOLATILITY };
  }
  if (a.type === 'property' || a.type === 'other' || a.allocation === 'custom') {
    let rate = a.returnRate;
    if (a.type !== 'property') {
      rate += A.returnShift;
      if (ownerAge >= ownerRetirementAge) rate += A.retirementReturnShift;
    }
    return { rate, vol: a.volatility };
  }
  const pct = a.allocation === 'auto' ? glideStockPct(ownerAge, ownerRetirementAge) : a.allocation;
  const m = blend(pct, A);
  return { rate: m.rate + A.returnShift, vol: m.vol };
}

/** Correlation of home prices with the stock market, year to year. */
export const PROPERTY_STOCK_CORRELATION = 0.3;
/** Correlation of custom/other risky assets with the stock market. */
export const OTHER_STOCK_CORRELATION = 0.85;

/**
 * How an account's random yearly shock loads on shared market factors, for Monte Carlo.
 * The shock is z = s·Zstock + b·Zbond + i·ε, where Zstock and Zbond are independent standard
 * normals shared by every account and ε is the account's own noise, scaled so z has variance 1.
 * A stock/bond mix loads on the stock and bond factors in proportion to its holdings (bonds
 * correlate 0.1 with stocks), so two S&P 500 accounts move together exactly and a Treasury
 * account barely moves with them.
 */
export interface ShockLoadings { s: number; b: number; i: number }

export function shockLoadings(
  a: Account,
  A: Assumptions,
  ownerAge: number,
  ownerRetirementAge: number,
): ShockLoadings {
  if (a.type === 'cash') return { s: 0, b: 0, i: 1 };
  const own = (rho: number) => ({ s: rho, b: 0, i: Math.sqrt(1 - rho * rho) });
  if (a.type === 'property') return own(PROPERTY_STOCK_CORRELATION);
  if (a.type === 'other' || a.allocation === 'custom') return own(OTHER_STOCK_CORRELATION);
  const w = (a.allocation === 'auto' ? glideStockPct(ownerAge, ownerRetirementAge) : a.allocation) / 100;
  const ss = w * A.stockVolatility;
  const bb = (1 - w) * A.bondVolatility;
  const rho = STOCK_BOND_CORRELATION;
  const sd = Math.sqrt(ss * ss + bb * bb + 2 * rho * ss * bb);
  if (sd <= 0) return { s: 0, b: 0, i: 1 };
  return { s: (ss + rho * bb) / sd, b: (bb * Math.sqrt(1 - rho * rho)) / sd, i: 0 };
}

/** Owner's current age and retirement age for an account. */
export function ownerInfo(plan: Plan, a: Pick<Account, 'owner'>, year = new Date().getFullYear()) {
  const spouse = a.owner === 'spouse' && plan.married;
  const p = spouse ? plan.spouse : plan.self;
  return { age: year - p.birthYear, retirementAge: p.retirementAge };
}

/** This year's expected return and volatility for an account (percent). */
export function currentReturn(plan: Plan, a: Account) {
  const o = ownerInfo(plan, a);
  return accountReturn(a, plan.assumptions, o.age, o.retirementAge);
}
