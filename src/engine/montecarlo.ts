import type { Plan } from './types';
import { runProjection, syntheticAccountsFor, type ReturnSampler } from './projection';

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  let u = 0;
  while (u === 0) u = rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Lognormal annual returns with the given arithmetic mean and standard deviation.
 * Every account draws from the same yearly stock and bond shocks in proportion to what it
 * holds (see shockLoadings), so a bad stock year hits every stock-heavy account together.
 */
export function makeSampler(seed: number, years: number, accountIds: string[]): ReturnSampler {
  const rand = mulberry32(seed);
  const stock = Array.from({ length: years + 1 }, () => gaussian(rand));
  const bond = Array.from({ length: years + 1 }, () => gaussian(rand));
  const idio: Record<string, number[]> = {};
  for (const id of accountIds) idio[id] = Array.from({ length: years + 1 }, () => gaussian(rand));
  return (k, accountId, expected, sd, load) => {
    if (sd <= 0) return expected;
    const z = load.s * stock[k] + load.b * bond[k] + load.i * (idio[accountId]?.[k] ?? 0);
    const sigma = Math.sqrt(Math.log(1 + (sd * sd) / ((1 + expected) * (1 + expected))));
    const mu = Math.log(1 + expected) - (sigma * sigma) / 2;
    return Math.exp(mu + sigma * z) - 1;
  };
}

export interface MonteCarloResult {
  successRate: number; // 0..1
  sims: number;
  ages: number[];
  /** Percentile bands of spendable (liquid) assets in today's dollars, per year. */
  bands: { age: number; p10: number; p25: number; p50: number; p75: number; p90: number }[];
  /** Distribution of depletion ages among failed runs. */
  depletionAges: number[];
  medianEndingReal: number;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function runMonteCarlo(plan: Plan, sims = plan.assumptions.simulations, seed = 42, now?: Date): MonteCarloResult {
  const ids = [...plan.accounts, ...syntheticAccountsFor(plan)].map((a) => a.id);
  const years = Math.max(1, plan.lifeExpectancy - (now ?? new Date()).getFullYear() + plan.self.birthYear) + 1;
  const perYear: number[][] = [];
  let ages: number[] = [];
  let successes = 0;
  const depletionAges: number[] = [];
  for (let s = 0; s < sims; s++) {
    const res = runProjection(plan, { sampler: makeSampler(seed + s * 7919, years, ids), now });
    if (s === 0) ages = res.rows.map((r) => r.age);
    res.rows.forEach((r, i) => {
      (perYear[i] ??= []).push(r.liquid / r.inflation);
    });
    if (res.success) successes++;
    else depletionAges.push(res.depletionAge!);
  }
  const bands = perYear.map((vals, i) => {
    const s = vals.sort((a, b) => a - b);
    return {
      age: ages[i],
      p10: percentile(s, 0.1),
      p25: percentile(s, 0.25),
      p50: percentile(s, 0.5),
      p75: percentile(s, 0.75),
      p90: percentile(s, 0.9),
    };
  });
  return {
    successRate: sims ? successes / sims : 0,
    sims,
    ages,
    bands,
    depletionAges,
    medianEndingReal: bands.at(-1)?.p50 ?? 0,
  };
}

/** Probability of success for a plan variant using a smaller, fixed set of simulations. */
function quickSuccess(plan: Plan, sims: number, now?: Date): number {
  return runMonteCarlo(plan, sims, 1234, now).successRate;
}

/** Highest retirement spending (today's $) that meets the target success rate. */
export function sustainableSpending(plan: Plan, sims = 250, now?: Date): number {
  const target = plan.assumptions.targetSuccess / 100;
  let lo = 0;
  let hi = Math.max(50_000, plan.retirementSpending * 4);
  // Expand the upper bound if even that succeeds.
  for (let i = 0; i < 4 && quickSuccess({ ...plan, retirementSpending: hi }, sims, now) >= target; i++) hi *= 2;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (quickSuccess({ ...plan, retirementSpending: mid }, sims, now) >= target) lo = mid;
    else hi = mid;
    if (hi - lo < 500) break;
  }
  return Math.floor(lo / 100) * 100;
}

/** Earliest age (you) at which retiring meets the target success rate, or null. */
export function earliestRetirement(plan: Plan, sims = 250, now?: Date): number | null {
  const target = plan.assumptions.targetSuccess / 100;
  const age0 = (now ?? new Date()).getFullYear() - plan.self.birthYear;
  const maxAge = Math.min(plan.lifeExpectancy - 1, 80);
  const ok = (age: number) =>
    quickSuccess({ ...plan, self: { ...plan.self, retirementAge: age } }, sims, now) >= target;
  if (!ok(maxAge)) return null;
  // Success is (nearly) monotonic in retirement age, so binary search.
  let lo = age0;
  let hi = maxAge;
  if (ok(lo)) return lo;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}
