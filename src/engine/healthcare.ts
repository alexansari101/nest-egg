// Healthcare costs in retirement.
//
// - While either spouse earns a paycheck, the whole family is on that employer plan (its
//   premiums and out-of-pocket costs are part of living expenses), whatever their ages. People
//   65+ covered by a large employer's plan can delay Medicare without penalty.
// - Once nobody has employer coverage: each person under 65 buys private insurance
//   (e.g. Covered California); each person 65+ is on Medicare Part B + Part D + a Medigap
//   plan + dental/vision/out-of-pocket.
// - IRMAA: Medicare's income surcharge on Parts B and D, set by MAGI from two years earlier.
// - Long-term care: an optional stress test (N years of care starting at an age).
// Everything rises at inflation plus the healthcare premium (medical costs have
// historically outpaced CPI by 1-3 points a year).

import type { HealthcarePlan } from './types';

export const MEDICARE_AGE = 65;
export const PART_B_2026 = 202.9; // standard monthly premium

/** 2026 IRMAA tiers: MAGI thresholds and monthly surcharges per person (Part B, Part D). */
export const IRMAA_2026 = {
  mfj: [218_000, 274_000, 342_000, 410_000, 750_000],
  single: [109_000, 137_000, 171_000, 205_000, 500_000],
  partB: [81.2, 202.9, 324.6, 446.3, 487.0],
  partD: [14.5, 37.5, 60.4, 83.3, 91.0],
};

/** Monthly IRMAA surcharge per person (Part B + Part D) for a given MAGI. */
export function irmaaMonthly(magi: number, married: boolean, index = 1): number {
  const t = married ? IRMAA_2026.mfj : IRMAA_2026.single;
  let tier = -1;
  for (let i = 0; i < t.length; i++) if (magi > t[i] * index) tier = i;
  return tier < 0 ? 0 : (IRMAA_2026.partB[tier] + IRMAA_2026.partD[tier]) * index;
}

export interface HealthcareYear {
  preMedicare: number;
  medicare: number;
  irmaa: number;
  ltc: number;
  total: number;
}

/**
 * One year's healthcare costs (nominal).
 * `hcf` = inflation index including the healthcare premium; `index` = general inflation index
 * (IRMAA thresholds are CPI-indexed).
 */
export function healthcareYear(opts: {
  h: HealthcarePlan;
  married: boolean;
  ages: number[]; // [you, spouse?]
  /** Someone in the household has a paycheck with employer health coverage. */
  anyoneWorking: boolean;
  yourAge: number;
  magiTwoYearsAgo: number | null;
  hcf: number;
  index: number;
}): HealthcareYear {
  const { h, ages, hcf } = opts;
  let preMedicare = 0;
  let medicare = 0;
  let onMedicare = 0;
  for (const a of ages) {
    if (opts.anyoneWorking) continue; // everyone on the working spouse's employer plan
    if (a >= MEDICARE_AGE) {
      medicare += h.medicarePerPerson * hcf;
      onMedicare++;
    } else if (!opts.anyoneWorking) {
      preMedicare += h.pre65PerPerson * hcf;
    }
  }
  const irmaa =
    h.includeIRMAA && onMedicare > 0 && opts.magiTwoYearsAgo != null
      ? irmaaMonthly(opts.magiTwoYearsAgo, opts.married, opts.index) * 12 * onMedicare
      : 0;
  let ltc = 0;
  if (h.ltc.enabled) {
    const people = opts.married ? h.ltc.people : 1;
    const end = h.ltc.startAge + h.ltc.years * people;
    if (opts.yourAge >= h.ltc.startAge && opts.yourAge < end) ltc = h.ltc.annualCost * hcf;
  }
  return { preMedicare, medicare, irmaa, ltc, total: preMedicare + medicare + irmaa + ltc };
}

/** Years over which the healthcare inflation premium fades to zero. */
export const PREMIUM_FADE_YEARS = 30;

/**
 * Real (above-CPI) healthcare cost multiplier after `years`. The premium starts at
 * `extraPct` and fades linearly to zero over 30 years, as long-range actuarial projections
 * assume medical cost growth converges with the overall economy.
 */
export function healthcarePremiumIndex(years: number, extraPct: number): number {
  let idx = 1;
  for (let j = 0; j < years; j++) idx *= 1 + (extraPct / 100) * Math.max(0, 1 - j / PREMIUM_FADE_YEARS);
  return idx;
}

export function defaultHealthcare(): HealthcarePlan {
  return {
    pre65PerPerson: 14_000,
    medicarePerPerson: 7_500,
    includeIRMAA: true,
    ltc: { enabled: false, startAge: 85, years: 3, annualCost: 120_000, people: 1 },
  };
}
