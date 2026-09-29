// Social Security benefit estimate, following SSA's formula in today's dollars.
//
// We don't have your earnings record, so we reconstruct a plausible one:
//   - work starts at 22 and stops at your planned retirement age
//   - past pay ramps up toward today's pay (2%/yr real wage growth, so early-career pay is lower)
//   - future pay grows at your raises minus inflation
//   - each year is capped at the Social Security wage base
// Then SSA's steps: average the top 35 years (AIME), apply the 2026 bend points (PIA),
// and compare with the spousal benefit (50% of the other spouse's PIA).
// Your ssa.gov statement uses your real record and is more accurate.

import type { Person, Plan } from './types';
import { SS_WAGE_BASE } from './tax';

export const SS_BEND_POINTS = [1_286, 7_749]; // 2026, monthly AIME
export const SS_FRA = 67;
const CAREER_START = 22;
const PAST_REAL_WAGE_GROWTH = 0.02;

export interface SSEstimate {
  /** Own retirement benefit at 67 (PIA), monthly, today's $. */
  own: number;
  /** Years with earnings counted toward the benefit. */
  years: number;
  aime: number;
}

export function piaFromAime(aime: number): number {
  const [b1, b2] = SS_BEND_POINTS;
  return 0.9 * Math.min(aime, b1) + 0.32 * Math.max(0, Math.min(aime, b2) - b1) + 0.15 * Math.max(0, aime - b2);
}

export function estimatePIA(p: Person, realRaise: number, year = new Date().getFullYear()): SSEstimate {
  const age = year - p.birthYear;
  if (p.income <= 0) return { own: 0, years: 0, aime: 0 };
  const earnings: number[] = [];
  const lastWorkAge = Math.min(p.retirementAge, SS_FRA + 3) - 1;
  for (let a = CAREER_START; a <= lastWorkAge; a++) {
    const pay = a < age
      ? p.income / Math.pow(1 + PAST_REAL_WAGE_GROWTH, age - a)
      : p.income * Math.pow(1 + Math.max(0, realRaise), a - age);
    earnings.push(Math.min(pay, SS_WAGE_BASE));
  }
  const top35 = earnings.sort((x, y) => y - x).slice(0, 35);
  const aime = top35.reduce((s, v) => s + v, 0) / (35 * 12);
  return { own: Math.round(piaFromAime(aime)), years: earnings.length, aime };
}

/** Real raise used for future earnings: nominal raises minus inflation. */
export const realRaiseOf = (plan: Plan) => (plan.assumptions.incomeGrowth - plan.assumptions.inflation) / 100;

/** The monthly benefit at 67 the model uses for a person: estimated, or what they entered. */
export function ownBenefit(plan: Plan, who: 'self' | 'spouse'): number {
  const p = plan[who];
  return p.ssEstimate ? estimatePIA(p, realRaiseOf(plan)).own : p.ssBenefitFRA;
}

/** Spousal benefit reduction for claiming before 67 (it doesn't grow past 67). */
export function spousalFactor(claimAge: number): number {
  const a = Math.min(67, Math.max(62, claimAge));
  const monthsEarly = (67 - a) * 12;
  return 1 - Math.min(36, monthsEarly) * (25 / 36) * 0.01 - Math.max(0, monthsEarly - 36) * (5 / 12) * 0.01;
}

/** Retirement benefit adjustment for claiming age relative to 67. */
export function ssFactor(claimAge: number): number {
  const a = Math.min(70, Math.max(62, claimAge));
  if (a >= 67) return 1 + 0.08 * (a - 67);
  const monthsEarly = (67 - a) * 12;
  return 1 - Math.min(36, monthsEarly) * (5 / 9) * 0.01 - Math.max(0, monthsEarly - 36) * (5 / 12) * 0.01;
}

export interface Benefit {
  /** Monthly benefit at the chosen claiming age, today's $. */
  monthly: number;
  own: number;
  spousal: number;
  usesSpousal: boolean;
}

/** Monthly benefit at the person's claiming age, taking the larger of own or spousal. */
export function benefitAtClaim(plan: Plan, who: 'self' | 'spouse'): Benefit {
  const p = plan[who];
  const own = ownBenefit(plan, who);
  const other = who === 'self' ? 'spouse' : 'self';
  const spousal = plan.married ? 0.5 * ownBenefit(plan, other) : 0;
  const ownAtClaim = own * ssFactor(p.ssClaimAge);
  const spousalAtClaim = spousal * spousalFactor(p.ssClaimAge);
  return spousalAtClaim > ownAtClaim
    ? { monthly: spousalAtClaim, own, spousal, usesSpousal: true }
    : { monthly: ownAtClaim, own, spousal, usesSpousal: false };
}
