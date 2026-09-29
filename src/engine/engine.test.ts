import { describe, expect, it } from 'vitest';
import { bracketTax, computeTaxes, FED_BRACKETS_MFJ, LIMITS_2026, ltcgTax, LTCG_BRACKETS_MFJ, propertyTaxFor, saltCap, taxableSocialSecurity } from './tax';
import { amortize, paymentFor, stepDebtYear } from './debt';
import { netWorthHistory, upsertSnapshot, valueAt } from './history';
import { medianReturn, runProjection, ssFactor, rmdDivisor } from './projection';
import { makeSampler, runMonteCarlo, sustainableSpending, earliestRetirement } from './montecarlo';
import { emptyPlan, newAccount, newDebt, samplePlan } from './defaults';
import type { Plan } from './types';
import { accountReturn, blend, glideStockPct, shockLoadings } from './returns';
import { benefitAtClaim, estimatePIA, piaFromAime, spousalFactor } from './socialSecurity';
import { defaultAssumptions } from './defaults';
import { defaultHealthcare, healthcarePremiumIndex, healthcareYear, irmaaMonthly } from './healthcare';
import { normalizePlan } from '../store';
import { buildMilestones } from './milestones';

const NOW = new Date('2026-09-27T12:00:00Z');

describe('tax', () => {
  it('computes federal bracket tax', () => {
    expect(bracketTax(24_800, FED_BRACKETS_MFJ)).toBeCloseTo(2_480);
    // 2,480 + 12% of 76,000
    expect(bracketTax(100_800, FED_BRACKETS_MFJ)).toBeCloseTo(2_480 + 9_120);
    expect(bracketTax(0, FED_BRACKETS_MFJ)).toBe(0);
  });

  it('stacks LTCG on ordinary income', () => {
    expect(ltcgTax(50_000, 40_000, LTCG_BRACKETS_MFJ)).toBe(0); // fully inside 0% band
    expect(ltcgTax(90_000, 20_000, LTCG_BRACKETS_MFJ)).toBeCloseTo((110_000 - 98_900) * 0.15);
  });

  it('taxes at most 85% of social security', () => {
    expect(taxableSocialSecurity(40_000, 0, true)).toBe(0);
    expect(taxableSocialSecurity(60_000, 200_000, true)).toBeCloseTo(51_000);
  });

  it('produces sensible totals for a SF dual-income couple', () => {
    const t = computeTaxes({
      married: true, wages: [215_000, 168_000], pretaxRetirement: 49_000, hsaContrib: 8_750,
      ordinaryOther: 0, socialSecurity: 0, longTermGains: 0, seniors: 0,
    });
    expect(t.federal).toBeGreaterThan(45_000);
    expect(t.federal).toBeLessThan(60_000);
    expect(t.state).toBeGreaterThan(20_000);
    expect(t.state).toBeLessThan(30_000);
    // CA does not allow the HSA deduction, so state taxable > federal wages base minus CA std deduction
    expect(t.stateTaxable).toBeCloseTo(383_000 - 49_000 - 11_412);
    expect(t.socialSecurityTax).toBeCloseTo(184_500 * 0.062 + 168_000 * 0.062);
    expect(t.effectiveRate).toBeGreaterThan(0.2);
    expect(t.effectiveRate).toBeLessThan(0.35);
    expect(t.marginalFederal).toBe(0.24);
    expect(t.marginalState).toBe(0.093);
  });

  it('indexes brackets with inflation', () => {
    const base = { married: true, wages: [], pretaxRetirement: 0, hsaContrib: 0, ordinaryOther: 150_000, socialSecurity: 0, longTermGains: 0, seniors: 0 };
    expect(computeTaxes({ ...base, index: 2 }).federal).toBeLessThan(computeTaxes(base).federal);
  });
});

describe('debt', () => {
  it('amortizes a standard mortgage in its term', () => {
    const pmt = paymentFor(500_000, 6, 360);
    expect(pmt).toBeCloseTo(2997.75, 1);
    const s = amortize(500_000, 6, pmt);
    expect(s.months).toBe(360);
    expect(s.totalInterest).toBeCloseTo(pmt * 360 - 500_000, -1);
  });

  it('extra payments shorten the loan', () => {
    const pmt = paymentFor(500_000, 6, 360);
    expect(amortize(500_000, 6, pmt, 500).months!).toBeLessThan(300);
  });

  it('flags debts that never pay off', () => {
    expect(amortize(10_000, 24, 100).months).toBeNull();
  });

  it('steps a year', () => {
    const r = stepDebtYear(1000, 0, 100);
    expect(r.balance).toBeCloseTo(0);
    expect(r.paid).toBeCloseTo(1000);
  });
});

describe('history', () => {
  it('carries forward values between snapshots', () => {
    const h = [{ date: '2025-01-01', value: 10 }, { date: '2025-06-01', value: 20 }];
    expect(valueAt(h, '2025-03-01')).toBe(10);
    expect(valueAt(h, '2024-12-31')).toBeNull();
    expect(upsertSnapshot(h, '2025-06-01', 25).at(-1)!.value).toBe(25);
  });

  it('builds a net worth series over all dates', () => {
    const a = { ...newAccount('cash'), history: [{ date: '2025-01-01', value: 100 }, { date: '2025-03-01', value: 150 }] };
    const d = { ...newDebt('auto'), history: [{ date: '2025-02-01', value: 40 }] };
    const s = netWorthHistory({ accounts: [a], debts: [d] });
    expect(s.map((p) => p.netWorth)).toEqual([100, 60, 110]);
  });
});

describe('projection', () => {
  it('SS factors match SSA schedule', () => {
    expect(ssFactor(62)).toBeCloseTo(0.7);
    expect(ssFactor(67)).toBe(1);
    expect(ssFactor(70)).toBeCloseTo(1.24);
    expect(rmdDivisor(75)).toBe(24.6);
  });

  it('grows a lone account at its rate with no flows', () => {
    const p: Plan = { ...emptyPlan(), married: false, lifeExpectancy: 45 };
    p.self = { ...p.self, birthYear: 1991, retirementAge: 80 };
    p.accounts = [{ ...newAccount('taxable', 100_000, '2026-09-27'), allocation: 'custom', returnRate: 10, volatility: 0 }];
    p.healthcare = { ...defaultHealthcare(), pre65PerPerson: 0, medicarePerPerson: 0 }; // pure growth, no costs
    const r = runProjection(p, { now: NOW });
    expect(r.rows[0].liquid).toBe(100_000);
    expect(r.rows[10].liquid).toBeCloseTo(100_000 * 1.1 ** 10, 0);
  });

  it('projects volatile accounts at the median return, matching the Monte Carlo middle', () => {
    expect(medianReturn(0.08, 0)).toBe(0.08);
    // S&P 500 defaults: 8% mean, 16% vol → about 6.9% typical growth.
    expect(medianReturn(0.08, 0.16)).toBeCloseTo(0.0683, 3);
    const p: Plan = { ...emptyPlan(), married: false, lifeExpectancy: 65 };
    p.self = { ...p.self, birthYear: 1991, retirementAge: 90 };
    p.healthcare = { ...defaultHealthcare(), pre65PerPerson: 0, medicarePerPerson: 0 }; // pure growth, no costs
    p.accounts = [{ ...newAccount('taxable', 100_000, '2026-09-27'), allocation: 100 }];
    const det = runProjection(p, { now: NOW }).rows.at(-1)!.liquid;
    const mc = runMonteCarlo(p, 2000, 7, NOW);
    const p50 = mc.bands.at(-1)!.p50 * runProjection(p, { now: NOW }).rows.at(-1)!.inflation;
    expect(Math.abs(det / p50 - 1)).toBeLessThan(0.08);
  });

  it('correlates accounts by what they hold, not a single market factor', () => {
    const A = defaultAssumptions();
    const sp = newAccount('taxable'); // 100% S&P 500
    const tr = { ...newAccount('taxable'), allocation: 0 as const }; // Treasuries
    const L1 = shockLoadings(sp, A, 40, 60);
    const L2 = shockLoadings(tr, A, 40, 60);
    const N = 20_000;
    const s = makeSampler(3, N, ['a', 'b', 'c']);
    const a: number[] = [], b: number[] = [], c: number[] = [];
    for (let k = 0; k < N; k++) { a.push(s(k, 'a', 0.08, 0.16, L1)); b.push(s(k, 'b', 0.08, 0.16, L1)); c.push(s(k, 'c', 0.0425, 0.06, L2)); }
    const mean = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length;
    const corr = (u: number[], v: number[]) => {
      const mu = mean(u), mv = mean(v);
      const cov = mean(u.map((x, i) => (x - mu) * (v[i] - mv)));
      return cov / Math.sqrt(mean(u.map((x) => (x - mu) ** 2)) * mean(v.map((x) => (x - mv) ** 2)));
    };
    expect(corr(a, b)).toBeCloseTo(1, 3); // two S&P 500 funds move together
    expect(Math.abs(corr(a, c) - 0.1)).toBeLessThan(0.03); // stocks vs Treasuries
    expect(mean(a)).toBeCloseTo(0.08, 2);
    // Loadings always give a unit-variance shock.
    for (const acct of [sp, tr, { ...sp, allocation: 60 as const }, newAccount('property'), newAccount('cash')]) {
      const l = shockLoadings(acct, A, 40, 60);
      expect(l.s ** 2 + l.b ** 2 + l.i ** 2).toBeCloseTo(1, 6);
    }
  });

  it('keeps the family on the working spouse\'s plan and starts Medicare when it ends', () => {
    const p = samplePlan(NOW);
    p.self = { ...p.self, birthYear: 1988, retirementAge: 55 };
    p.spouse = { ...p.spouse, birthYear: 1985, retirementAge: 70 };
    const rows = runProjection(p, { now: NOW }).rows;
    const at = (age: number) => rows.find((r) => r.age === age)!;
    // You're retired from 55 but covered by your spouse's plan, even after your spouse turns 65.
    for (const age of [55, 60, 64, 66]) expect(at(age).healthcare).toBe(0);
    // Spouse retires at 70 (you're 67): both on Medicare from then on.
    expect(at(67).medicare).toBeGreaterThan(0);
    expect(at(67).preMedicare).toBe(0);
    // A spouse with no paycheck doesn't provide employer coverage.
    const ms = buildMilestones(p, runProjection(p, { now: NOW })).filter((m) => m.kind === 'medicare');
    expect(ms.map((m) => m.year)).toEqual([2055, 2055]); // both when the spouse retires (spouse 70, you 67)
    const q = { ...p, spouse: { ...p.spouse, income: 0 } };
    expect(runProjection(q, { now: NOW }).rows.find((r) => r.age === 56)!.preMedicare).toBeGreaterThan(0);
  });

  it('reports mortgage payments separately from other debt', () => {
    const r = runProjection(samplePlan(NOW), { now: NOW }).rows[1];
    const mortgage = samplePlan(NOW).debts.find((d) => d.type === 'mortgage')!;
    expect(r.mortgagePayments).toBeCloseTo(mortgage.monthlyPayment * 12, -1);
    expect(r.debtPayments - r.mortgagePayments).toBeGreaterThan(0); // the car loan
  });

  it('pays retirement healthcare from the HSA first, tax-free', () => {
    const p: Plan = { ...emptyPlan(), married: false, lifeExpectancy: 70, retirementSpending: 40_000 };
    p.self = { ...p.self, birthYear: 1961, retirementAge: 60 };
    p.accounts = [
      { ...newAccount('taxable', 1_000_000, '2026-09-27'), allocation: 'custom', returnRate: 0, volatility: 0, costBasisPct: 100 },
      { ...newAccount('hsa', 50_000, '2026-09-27'), allocation: 'custom', returnRate: 0, volatility: 0 },
    ];
    const r = runProjection(p, { now: NOW }).rows[1];
    expect(r.healthcare).toBeGreaterThan(0);
    expect(r.hsaMedical).toBeCloseTo(r.healthcare, 0);
    expect(r.withdrawalsByType.hsa).toBeCloseTo(r.healthcare, 0);
    expect(r.hsaNonQualified).toBe(0);
    expect(r.byType.hsa).toBeCloseTo(50_000 - r.healthcare, 0);
  });

  it('charges home upkeep as a share of market value', () => {
    const p: Plan = { ...emptyPlan(), married: false, lifeExpectancy: 45 };
    p.self = { ...p.self, birthYear: 1986, retirementAge: 80, income: 200_000 };
    const home = newAccount('property', 1_000_000, '2026-09-27');
    p.accounts = [{ ...home, returnRate: 0, volatility: 0, propertyTax: { ...home.propertyTax!, upkeepPct: 1 } }];
    const r = runProjection(p, { now: NOW }).rows[1];
    expect(r.homeUpkeep).toBeCloseTo(10_000, 0);
    const none = runProjection({ ...p, accounts: [{ ...p.accounts[0], propertyTax: { ...home.propertyTax!, upkeepPct: 0 } }] }, { now: NOW }).rows[1];
    expect(none.surplus - r.surplus).toBeCloseTo(10_000, -1);
  });

  it('amortizes debt and records payoff age', () => {
    const p: Plan = { ...emptyPlan(), married: false, lifeExpectancy: 60 };
    p.self = { ...p.self, birthYear: 1986, retirementAge: 80, income: 100_000 };
    p.debts = [{ ...newDebt('auto', 12_000, '2026-09-27'), rate: 0, monthlyPayment: 1000 }];
    const r = runProjection(p, { now: NOW });
    expect(r.rows[1].totalDebt).toBeCloseTo(0);
    expect(r.debtPayoffAge[p.debts[0].id]).toBe(41);
  });

  it('withdraws in retirement, grossing up for taxes, and detects depletion', () => {
    const p: Plan = { ...emptyPlan(), married: false, lifeExpectancy: 90 };
    p.self = { ...p.self, birthYear: 1961, retirementAge: 60, income: 0 };
    p.retirementSpending = 80_000;
    p.assumptions.inflation = 0;
    p.assumptions.retirementReturnShift = 0;
    p.accounts = [{ ...newAccount('traditional', 400_000, '2026-09-27'), allocation: 'custom', returnRate: 0 }];
    const r = runProjection(p, { now: NOW });
    const y1 = r.rows[1];
    expect(y1.withdrawals).toBeGreaterThan(80_000); // must also cover income tax
    expect(y1.spending).toBeGreaterThan(80_000); // target + Medicare costs
    expect(y1.withdrawals - y1.taxes).toBeCloseTo(y1.spending, -1);
    expect(r.success).toBe(false);
    expect(r.depletionAge).toBeGreaterThan(65);
    expect(r.depletionAge).toBeLessThan(71);
  });

  it('applies the 10% early-withdrawal penalty before 59', () => {
    const p: Plan = { ...emptyPlan(), married: false, lifeExpectancy: 55 };
    p.self = { ...p.self, birthYear: 1976, retirementAge: 50 };
    p.retirementSpending = 50_000;
    p.accounts = [{ ...newAccount('traditional', 1_000_000, '2026-09-27') }];
    const r = runProjection(p, { now: NOW });
    expect(r.rows[1].penalty).toBeGreaterThan(0);
  });

  it('runs the sample plan end to end with sane numbers', () => {
    const p = samplePlan(NOW);
    const r = runProjection(p, { now: NOW });
    expect(r.rows.length).toBe(95 - 38 + 1);
    for (const row of r.rows) {
      expect(Number.isFinite(row.netWorth)).toBe(true);
      expect(row.liquid).toBeGreaterThanOrEqual(0);
    }
    // Working years should accumulate wealth.
    expect(r.rows[r.retireIndex].liquid).toBeGreaterThan(r.rows[0].liquid * 3);
    // Taxes in year 1 roughly match a standalone estimate (25-35% of wages).
    expect(r.rows[1].taxes / r.rows[1].wages).toBeGreaterThan(0.2);
    expect(r.rows[1].taxes / r.rows[1].wages).toBeLessThan(0.4);
    // SS starts at 67.
    expect(r.rows.find((x) => x.age === 66)!.socialSecurity).toBe(0);
    expect(r.rows.find((x) => x.age === 69)!.socialSecurity).toBeGreaterThan(0);
  });
});

describe('monte carlo', () => {
  it('is deterministic for a seed and returns ordered bands', () => {
    const p = samplePlan(NOW);
    const a = runMonteCarlo(p, 100, 7, NOW);
    const b = runMonteCarlo(p, 100, 7, NOW);
    expect(a.successRate).toBe(b.successRate);
    for (const band of a.bands) {
      expect(band.p10).toBeLessThanOrEqual(band.p50);
      expect(band.p50).toBeLessThanOrEqual(band.p90);
    }
  });

  it('zero-volatility MC matches the deterministic projection', () => {
    const p = samplePlan(NOW);
    p.accounts = p.accounts.map((a) => ({ ...a, allocation: 'custom' as const, volatility: 0 }));
    const mc = runMonteCarlo(p, 5, 1, NOW);
    const det = runProjection(p, { now: NOW });
    const last = det.rows.at(-1)!;
    expect(mc.bands.at(-1)!.p50).toBeCloseTo(last.liquid / last.inflation, 0);
  });

  it('finds sustainable spending and earliest retirement consistently', () => {
    const p = samplePlan(NOW);
    const s = sustainableSpending(p, 80, NOW);
    expect(s).toBeGreaterThan(50_000);
    const early = earliestRetirement(p, 80, NOW);
    expect(early).not.toBeNull();
    expect(early!).toBeGreaterThanOrEqual(38);
  });

  it('runs quickly', () => {
    const p = samplePlan(NOW);
    const t0 = performance.now();
    runMonteCarlo(p, 500, 1, NOW);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});

describe('returns', () => {
  const A = defaultAssumptions();

  it('blends S&P 500 and Treasuries', () => {
    expect(blend(100, A)).toEqual({ rate: A.stockReturn, vol: A.stockVolatility });
    expect(blend(0, A).rate).toBe(A.bondReturn);
    const m = blend(60, A);
    expect(m.rate).toBeCloseTo(0.6 * A.stockReturn + 0.4 * A.bondReturn);
    // Diversification: blended volatility is below the weighted average.
    expect(m.vol).toBeLessThan(0.6 * A.stockVolatility + 0.4 * A.bondVolatility);
  });

  it('target-date glide path de-risks toward and through retirement', () => {
    expect(glideStockPct(30, 65)).toBe(90);
    expect(glideStockPct(65, 65)).toBe(50);
    expect(glideStockPct(52.5, 65)).toBe(70);
    expect(glideStockPct(80, 65)).toBe(30);
  });

  it('derives account returns from allocation and market assumptions', () => {
    const t = newAccount('taxable'); // defaults to 100% S&P 500
    expect(accountReturn(t, A, 40, 65).rate).toBe(A.stockReturn);
    const cash = newAccount('cash');
    expect(accountReturn(cash, A, 40, 65).rate).toBe(A.cashReturn);
    const k = newAccount('traditional'); // target-date
    expect(accountReturn(k, A, 64, 65).rate).toBeLessThan(accountReturn(k, A, 30, 65).rate);
    expect(accountReturn({ ...t, allocation: 'custom', returnRate: 12 }, A, 40, 65).rate).toBe(12);
    expect(accountReturn(t, { ...A, returnShift: -1 }, 40, 65).rate).toBe(A.stockReturn - 1);
  });

  it('changing the stock assumption changes projections', () => {
    const p = samplePlan(NOW);
    const base = runProjection(p, { now: NOW }).rows.at(-1)!.liquid;
    const lower = runProjection({ ...p, assumptions: { ...p.assumptions, stockReturn: 6 } }, { now: NOW }).rows.at(-1)!.liquid;
    expect(lower).toBeLessThan(base);
  });

  it('keeps explicit returns when loading files saved before allocations existed', () => {
    const old = { accounts: [{ id: 'a', name: 'Old', type: 'taxable', returnRate: 6, volatility: 12, history: [] }], debts: [] };
    const p = normalizePlan(old);
    expect(p.accounts[0].allocation).toBe('custom');
    expect(p.assumptions.stockReturn).toBe(8);
  });
});

describe('social security estimate', () => {
  const person = (over: Partial<Plan['self']> = {}): Plan['self'] => ({
    name: 'A', birthYear: 1988, retirementAge: 65, income: 100_000, ssEstimate: true, ssBenefitFRA: 0, ssClaimAge: 67, ...over,
  });

  it('applies the 2026 bend points', () => {
    expect(piaFromAime(1_000)).toBeCloseTo(900);
    expect(piaFromAime(7_749)).toBeCloseTo(0.9 * 1286 + 0.32 * (7749 - 1286));
  });

  it('caps earnings at the wage base and lands near the real maximum', () => {
    const max = estimatePIA(person({ income: 500_000 }), 0.01, 2026).own;
    expect(estimatePIA(person({ income: 1_000_000 }), 0.01, 2026).own).toBe(max);
    expect(max).toBeGreaterThan(3_800);
    expect(max).toBeLessThan(4_500);
  });

  it('is progressive and responds to career length', () => {
    const mid = estimatePIA(person({ income: 70_000 }), 0.01, 2026);
    expect(mid.own).toBeGreaterThan(2_000);
    expect(mid.own).toBeLessThan(2_900);
    expect(mid.years).toBe(65 - 22);
    const early = estimatePIA(person({ income: 70_000, retirementAge: 45 }), 0.01, 2026);
    expect(early.years).toBe(45 - 22);
    expect(early.own).toBeLessThan(mid.own); // fewer than 35 years means zeros in the average
    expect(estimatePIA(person({ income: 0 }), 0.01, 2026).own).toBe(0);
  });

  it('uses an entered statement value when not estimating', () => {
    const p = samplePlan(NOW);
    p.self = { ...p.self, ssEstimate: false, ssBenefitFRA: 1_234 };
    expect(benefitAtClaim(p, 'self').own).toBe(1_234);
  });

  it('gives a non-working spouse the spousal benefit', () => {
    const p = samplePlan(NOW);
    p.spouse = { ...p.spouse, income: 0 };
    const b = benefitAtClaim(p, 'spouse');
    expect(b.usesSpousal).toBe(true);
    expect(b.monthly).toBeCloseTo(0.5 * benefitAtClaim(p, 'self').own * spousalFactor(67));
    expect(spousalFactor(62)).toBeCloseTo(0.65);
    // And the projection pays it.
    const r = runProjection(p, { now: NOW });
    expect(r.rows.find((x) => x.age === 70)!.socialSecurity).toBeGreaterThan(0);
  });

  it('migrates older files: entered benefits kept, missing ones estimated', () => {
    const p = normalizePlan({ accounts: [], debts: [], self: { ssBenefitFRA: 3000 }, spouse: { ssBenefitFRA: 0 } });
    expect(p.self.ssEstimate).toBe(false);
    expect(p.spouse.ssEstimate).toBe(true);
  });
});

describe('income and the savings waterfall', () => {
  // A single earner with nothing but a checking account, so every dollar is traceable.
  const simple = (income: number, over: Partial<Plan['assumptions']> = {}): Plan => {
    const p: Plan = { ...emptyPlan(), married: false, lifeExpectancy: 90, annualSpending: 60_000, retirementSpending: 60_000 };
    p.self = { ...p.self, birthYear: 1986, retirementAge: 65, income, ssEstimate: false, ssBenefitFRA: 0 };
    p.assumptions = { ...p.assumptions, ...over };
    p.accounts = [{ ...newAccount('cash', 10_000, '2026-09-27') }];
    return p;
  };
  const year1 = (p: Plan) => runProjection(p, { now: NOW }).rows[1];

  it('higher gross income raises projected net worth', () => {
    const lo = runProjection(simple(120_000), { now: NOW });
    const hi = runProjection(simple(180_000), { now: NOW });
    expect(hi.rows[hi.retireIndex].netWorth).toBeGreaterThan(lo.rows[lo.retireIndex].netWorth * 1.3);
    expect(hi.rows[1].wages).toBe(180_000);
  });

  it('fills the 401(k) to the limit, then the HSA, then brokerage', () => {
    const r = year1(simple(200_000));
    expect(r.surplusTo401k).toBeCloseTo(LIMITS_2026.k401 * 1.0275, 0); // indexed one year
    expect(r.surplusToHSA).toBeCloseTo(LIMITS_2026.hsaSelf * 1.0275, 0);
    expect(r.surplusToBrokerage).toBeGreaterThan(0);
    const res = runProjection(simple(200_000), { now: NOW });
    expect(res.syntheticAccounts.map((a) => a.type).sort()).toEqual(['hsa', 'taxable', 'traditional']);
  });

  it('conserves cash: every leftover dollar is invested', () => {
    const r = year1(simple(200_000));
    const leftover = r.wages - r.taxes - r.spending - r.debtPayments - r.contributions;
    expect(r.surplusInvested).toBeCloseTo(leftover, 0);
    expect(r.surplus).toBeCloseTo(leftover, 0);
  });

  it('pre-tax 401(k)/HSA top-ups lower taxes vs. putting it all in brokerage', () => {
    const withTopUps = year1(simple(200_000));
    const brokerageOnly = year1(simple(200_000, { surplusTo401k: false, surplusToHSA: false }));
    expect(withTopUps.taxes).toBeLessThan(brokerageOnly.taxes - 7_000);
    expect(brokerageOnly.surplusTo401k).toBe(0);
  });

  it('only fills the 401(k) up to what you already contribute', () => {
    const p = simple(200_000);
    p.accounts.push({ ...newAccount('traditional', 0, '2026-09-27'), contribution: 20_000 });
    expect(year1(p).surplusTo401k).toBeCloseTo(LIMITS_2026.k401 * 1.0275 - 20_000, 0);
    p.accounts[1].contribution = 30_000;
    expect(year1(p).surplusTo401k).toBe(0);
  });

  it('adds the age-50 catch-up', () => {
    const p = simple(200_000);
    p.self.birthYear = 1975; // 52 in year 1
    expect(year1(p).surplusTo401k).toBeCloseTo((LIMITS_2026.k401 + LIMITS_2026.k401CatchUp50) * 1.0275, 0);
  });

  it('when income barely covers spending, only what is left gets invested', () => {
    const r = year1(simple(90_000));
    expect(r.surplusTo401k).toBeGreaterThan(0);
    expect(r.surplusTo401k).toBeLessThan(LIMITS_2026.k401);
    expect(r.surplusToHSA).toBe(0); // 401(k) not full yet, so nothing spills over
    expect(r.surplusToBrokerage).toBeLessThan(1); // at most a rounding residual
  });

  it('respects a lower invest share and a 0% setting', () => {
    const half = year1(simple(200_000, { surplusSavePct: 50 }));
    expect(half.surplusInvested).toBeCloseTo(half.surplus * 0.5, 0);
    const none = runProjection(simple(200_000, { surplusSavePct: 0 }), { now: NOW });
    expect(none.rows[1].surplusInvested).toBe(0);
    expect(none.syntheticAccounts).toHaveLength(0);
  });

  it('works in Monte Carlo with placeholder accounts', () => {
    const mc = runMonteCarlo(simple(200_000), 20, 3, NOW);
    expect(mc.bands.at(-1)!.p50).toBeGreaterThan(0);
  });

  it('migrates old files that discarded leftover income', () => {
    const p = normalizePlan({ accounts: [], debts: [], assumptions: { surplusSavePct: 0 } });
    expect(p.assumptions.surplusSavePct).toBe(100);
    expect(p.assumptions.surplusTo401k).toBe(true);
  });
});

describe('healthcare', () => {
  const h = defaultHealthcare();
  const base = { h, married: true, anyoneWorking: false, magiTwoYearsAgo: null, hcf: 1, index: 1 };

  it('charges private insurance before 65 only once nobody has employer coverage', () => {
    expect(healthcareYear({ ...base, ages: [60, 58], yourAge: 60, anyoneWorking: true }).total).toBe(0);
    // A working spouse's plan also covers people 65+ (Medicare delayed) — no Medicare or IRMAA.
    expect(healthcareYear({ ...base, ages: [66, 63], yourAge: 66, anyoneWorking: true, magiTwoYearsAgo: 900_000 }).total).toBe(0);
    expect(healthcareYear({ ...base, ages: [60, 58], yourAge: 60 }).preMedicare).toBe(2 * h.pre65PerPerson);
  });

  it('moves each person to Medicare at 65 separately', () => {
    const y = healthcareYear({ ...base, ages: [66, 64], yourAge: 66 });
    expect(y.medicare).toBe(h.medicarePerPerson);
    expect(y.preMedicare).toBe(h.pre65PerPerson); // younger spouse still needs private coverage
  });

  it('applies IRMAA tiers per person on Medicare', () => {
    expect(irmaaMonthly(200_000, true)).toBe(0);
    expect(irmaaMonthly(250_000, true)).toBeCloseTo(81.2 + 14.5);
    expect(irmaaMonthly(1_000_000, true)).toBeCloseTo(487 + 91);
    expect(irmaaMonthly(120_000, false)).toBeCloseTo(81.2 + 14.5);
    expect(irmaaMonthly(250_000, true, 1.2)).toBe(0); // thresholds index with inflation
    const y = healthcareYear({ ...base, ages: [70, 68], yourAge: 70, magiTwoYearsAgo: 300_000 });
    expect(y.irmaa).toBeCloseTo((202.9 + 37.5) * 12 * 2);
    expect(healthcareYear({ ...base, h: { ...h, includeIRMAA: false }, ages: [70, 68], yourAge: 70, magiTwoYearsAgo: 300_000 }).irmaa).toBe(0);
  });

  it('models long-term care for one or both, back to back', () => {
    const ltc = { enabled: true, startAge: 85, years: 3, annualCost: 100_000, people: 2 as const };
    const at = (age: number) => healthcareYear({ ...base, h: { ...h, ltc }, ages: [age, age - 2], yourAge: age }).ltc;
    expect(at(84)).toBe(0);
    expect(at(85)).toBe(100_000);
    expect(at(90)).toBe(100_000);
    expect(at(91)).toBe(0);
    expect(healthcareYear({ ...base, married: false, h: { ...h, ltc }, ages: [88], yourAge: 88 }).ltc).toBe(0); // single: one episode
  });

  it('keeps charging healthcare after 65 and grows it faster than inflation', () => {
    const r = runProjection(samplePlan(NOW), { now: NOW });
    const at70 = r.rows.find((x) => x.age === 70)!;
    const at90 = r.rows.find((x) => x.age === 90)!;
    expect(at70.medicare).toBeGreaterThan(0);
    expect(at70.medicare / at70.inflation).toBeGreaterThan(2 * 7_500 * 1.2); // faster than CPI
    expect(at90.medicare / at90.inflation).toBeCloseTo(at70.medicare / at70.inflation, -2); // premium has faded
    expect(r.rows.find((x) => x.age === 40)!.healthcare).toBe(0); // employer coverage while working
    // You turn 65 before your spouse: the gap years still pay private insurance for them.
    const at65 = r.rows.find((x) => x.age === 65)!;
    expect(at65.preMedicare).toBeGreaterThan(0);
    expect(at65.medicare).toBeGreaterThan(0);
  });

  it('adds IRMAA when retirement income is high', () => {
    const p = samplePlan(NOW);
    const r = runProjection(p, { now: NOW });
    expect(r.rows.some((x) => x.irmaa > 0)).toBe(true); // RMDs push MAGI over the threshold
    const off = runProjection({ ...p, healthcare: { ...p.healthcare, includeIRMAA: false } }, { now: NOW });
    expect(off.rows.every((x) => x.irmaa === 0)).toBe(true);
  });

  it('long-term care lowers the ending balance', () => {
    const p = samplePlan(NOW);
    const base = runProjection(p, { now: NOW }).rows.at(-1)!.liquid;
    const withLtc = runProjection({ ...p, healthcare: { ...p.healthcare, ltc: { enabled: true, startAge: 85, years: 3, annualCost: 150_000, people: 2 } } }, { now: NOW }).rows.at(-1)!.liquid;
    expect(withLtc).toBeLessThan(base);
  });

  it('taxes HSA withdrawals beyond medical costs', () => {
    const mk = (medicare: number) => {
      const p: Plan = { ...emptyPlan(), married: false, lifeExpectancy: 72 };
      p.self = { ...p.self, birthYear: 1956, retirementAge: 60, income: 0, ssEstimate: false, ssBenefitFRA: 0 };
      p.retirementSpending = 40_000;
      p.healthcare = { ...defaultHealthcare(), medicarePerPerson: medicare, includeIRMAA: false };
      p.accounts = [{ ...newAccount('hsa', 500_000, '2026-09-27'), allocation: 'custom', returnRate: 0 }];
      return runProjection(p, { now: NOW }).rows[1];
    };
    const noCosts = mk(0);
    expect(noCosts.hsaNonQualified).toBeCloseTo(noCosts.withdrawals, 0);
    expect(noCosts.taxes).toBeGreaterThan(0);
    const withCosts = mk(10_000);
    // The first $10K+ covers medical costs tax-free.
    expect(withCosts.hsaNonQualified).toBeLessThan(withCosts.withdrawals - 10_000);
  });

  it('fades the healthcare premium over 30 years', () => {
    expect(healthcarePremiumIndex(0, 2)).toBe(1);
    expect(healthcarePremiumIndex(1, 2)).toBeCloseTo(1.02);
    expect(healthcarePremiumIndex(30, 2)).toBeCloseTo(healthcarePremiumIndex(60, 2)); // no growth after the fade
    expect(healthcarePremiumIndex(30, 2)).toBeGreaterThan(1.3);
    expect(healthcarePremiumIndex(30, 2)).toBeLessThan(1.4);
  });

  it('migrates the old household pre-65 field', () => {
    const p = normalizePlan({ accounts: [], debts: [], married: true, healthcarePre65: 30_000 });
    expect(p.healthcare.pre65PerPerson).toBe(15_000);
    expect(p.healthcare.medicarePerPerson).toBe(7_500);
  });
});

describe('California property tax and itemized deductions', () => {
  const info = { rate: 1.18, fixedCharges: 600, homeownersExemption: true };

  it('computes SF property tax with the homeowners exemption and parcel taxes', () => {
    const { tax } = propertyTaxFor(info, 1_500_000, 0, 1_800_000, 1);
    expect(tax).toBeCloseTo((1_500_000 - 7_000) * 0.0118 + 600, 0);
  });

  it('grows assessed value 2%/yr under Prop 13, never above market value', () => {
    expect(propertyTaxFor(info, 1_000_000, 10, 5_000_000, 1).assessed).toBeCloseTo(1_000_000 * 1.02 ** 10, 0);
    expect(propertyTaxFor(info, 1_000_000, 10, 900_000, 1).assessed).toBe(900_000); // market fell
    expect(propertyTaxFor(info, 1_000_000, 0, 1_000_000, 2).tax - propertyTaxFor(info, 1_000_000, 0, 1_000_000, 1).tax).toBeCloseTo(600); // parcel taxes inflate
  });

  it('applies the federal SALT cap schedule and high-income phase-down', () => {
    expect(saltCap(2025, 300_000)).toBe(40_000);
    expect(saltCap(2026, 300_000)).toBeCloseTo(40_400);
    expect(saltCap(2026, 600_000)).toBeCloseTo(Math.max(10_000, 40_400 - 0.3 * (600_000 - 505_000)));
    expect(saltCap(2026, 5_000_000)).toBe(10_000);
    expect(saltCap(2030, 100_000)).toBe(10_000);
  });

  const couple = { married: true, wages: [225_000, 175_000], pretaxRetirement: 49_000, hsaContrib: 8_750, ordinaryOther: 0, socialSecurity: 0, longTermGains: 0, seniors: 0 };

  it('itemizes when property tax + mortgage interest beat the standard deduction', () => {
    const renter = computeTaxes(couple);
    const owner = computeTaxes({ ...couple, propertyTax: 19_000, mortgageInterest: 64_000, mortgageBalance: 1_050_000 });
    expect(renter.federalItemized).toBe(false);
    expect(owner.federalItemized).toBe(true);
    expect(owner.stateItemized).toBe(true);
    // Federal: SALT (state tax + property tax, capped at $40,400) + interest on $750K of a $1.05M loan.
    expect(owner.saltDeducted).toBeCloseTo(Math.min(owner.state + 19_000, 40_400), 0);
    expect(owner.federalDeduction).toBeCloseTo(owner.saltDeducted + 64_000 * (750_000 / 1_050_000), 0);
    // A bigger property tax bill hits the cap.
    expect(computeTaxes({ ...couple, propertyTax: 40_000, mortgageInterest: 0, mortgageBalance: 0 }).saltDeducted).toBeCloseTo(40_400, 0);
    // California: property tax uncapped + interest on up to $1M of debt; no state income tax deduction.
    expect(owner.stateDeduction).toBeCloseTo(19_000 + 64_000 * (1_000_000 / 1_050_000), 0);
    expect(owner.federal).toBeLessThan(renter.federal - 10_000);
    expect(owner.state).toBeLessThan(renter.state - 5_000);
  });

  it('takes the standard deduction when itemizing is not worth it', () => {
    const modest = { ...couple, wages: [60_000, 0], pretaxRetirement: 0, hsaContrib: 0 };
    const t = computeTaxes({ ...modest, propertyTax: 5_000, mortgageInterest: 0, mortgageBalance: 0 });
    expect(t.federalItemized).toBe(false);
    expect(t.federalDeduction).toBe(32_200);
  });

  it('charges property tax every year in the projection and deducts it', () => {
    const p = samplePlan(NOW);
    const r = runProjection(p, { now: NOW });
    const y1 = r.rows[1];
    expect(y1.propertyTax).toBeGreaterThan(19_000);
    expect(y1.propertyTax).toBeLessThan(21_500);
    expect(y1.federalItemized).toBe(true); // big SF mortgage + property tax
    // Prop 13: property tax falls in real terms as the 2% cap trails inflation.
    const y30 = r.rows[30];
    expect(y30.propertyTax / y30.inflation).toBeLessThan(y1.propertyTax / y1.inflation);
    expect(r.rows.at(-1)!.propertyTax).toBeGreaterThan(0); // still owed after the mortgage is gone
    // Removing the home removes the tax.
    const noHome = runProjection({ ...p, accounts: p.accounts.filter((a) => a.type !== 'property') }, { now: NOW });
    expect(noHome.rows[1].propertyTax).toBe(0);
  });

  it('defaults assessed value to market value and migrates old files', () => {
    const p = normalizePlan({ accounts: [{ id: 'h', name: 'Home', type: 'property', returnRate: 4, volatility: 8, history: [{ date: '2026-09-27', value: 1_000_000 }] }], debts: [] });
    expect(p.accounts[0].propertyTax?.rate).toBe(1.18);
    const r = runProjection({ ...p, self: { ...p.self, birthYear: 1986 } }, { now: NOW });
    // Assessed = market value today ($1M), so year 1 is capped at the market value.
    expect(r.rows[1].propertyTax).toBeCloseTo((1_000_000 - 7_000) * 0.0118 + 600 * 1.0275, 0);
  });
});

describe('milestones', () => {
  // You born 1988; spouse born 1985 (3 years older). Both claim Social Security at 67.
  const plan = () => {
    const p = samplePlan(NOW);
    p.self = { ...p.self, birthYear: 1988, retirementAge: 60, ssClaimAge: 67 };
    p.spouse = { ...p.spouse, name: 'Sam', birthYear: 1985, retirementAge: 60, ssClaimAge: 67 };
    return p;
  };
  const find = (ms: ReturnType<typeof buildMilestones>, label: string) => ms.find((m) => m.label === label)!;

  it('places an older spouse’s milestones earlier, at their own ages', () => {
    const ms = buildMilestones(plan(), runProjection(plan(), { now: NOW }));
    const mySS = find(ms, 'Your Social Security begins');
    const theirSS = find(ms, "Sam's Social Security begins");
    expect(mySS).toMatchObject({ year: 2055, age: 67 });
    expect(theirSS).toMatchObject({ year: 2052, age: 64, ownerAge: 67 });
    expect(ms.indexOf(theirSS)).toBeLessThan(ms.indexOf(mySS));
    expect(find(ms, "Sam's Medicare begins")).toMatchObject({ year: 2050, age: 62, ownerAge: 65 });
    expect(find(ms, 'Your Medicare begins')).toMatchObject({ year: 2053, age: 65 });
    expect(find(ms, 'Sam retires')).toMatchObject({ year: 2045, age: 57, ownerAge: 60 });
    expect(find(ms, 'You retire')).toMatchObject({ year: 2048, age: 60 });
  });

  it('places a younger spouse’s milestones later', () => {
    const p = plan();
    p.spouse = { ...p.spouse, birthYear: 1991 };
    const ms = buildMilestones(p, runProjection(p, { now: NOW }));
    expect(find(ms, "Sam's Medicare begins")).toMatchObject({ year: 2056, age: 68 });
  });

  it('gives each spouse their own RMD start and keeps the list in date order', () => {
    const ms = buildMilestones(plan(), runProjection(plan(), { now: NOW }));
    expect(find(ms, "Sam's required minimum distributions start")).toMatchObject({ year: 2060, ownerAge: 75 });
    expect(find(ms, 'Your required minimum distributions start')).toMatchObject({ year: 2063, age: 75 });
    for (let i = 1; i < ms.length; i++) expect(ms[i].year).toBeGreaterThanOrEqual(ms[i - 1].year);
    for (const m of ms) expect(m.age).toBe(m.year - 1988);
  });

  it('matches when the projection actually pays Social Security', () => {
    const p = plan();
    const r = runProjection(p, { now: NOW });
    const firstSS = r.rows.find((x) => x.socialSecurity > 0)!;
    expect(firstSS.year).toBe(find(buildMilestones(p, r), "Sam's Social Security begins").year);
  });
});
