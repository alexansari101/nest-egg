import type { Account, AccountType, Plan } from './types';
import { ACCOUNT_TYPES } from './types';
import { latestValue } from './history';
import { stepDebtYear } from './debt';
import { computeTaxes, LIMITS_2026, propertyTaxFor, TAX_YEAR } from './tax';
import { accountReturn, shockLoadings, type ShockLoadings } from './returns';
import { benefitAtClaim } from './socialSecurity';
import { healthcarePremiumIndex, healthcareYear } from './healthcare';

/**
 * Returns the realized annual return (fraction) for an account in projection year k (1-based),
 * given its expected return and volatility (both fractions) and how it loads on market factors.
 */
export type ReturnSampler = (k: number, accountId: string, expected: number, sd: number, load: ShockLoadings) => number;

export interface YearRow {
  k: number; // 0 = today
  year: number;
  age: number;
  spouseAge: number | null;
  inflation: number; // cumulative index vs today
  retired: boolean;
  spouseRetired: boolean;
  // Flows (nominal $ for the year)
  wages: number;
  socialSecurity: number;
  otherIncome: number;
  eventsIn: number;
  eventsOut: number;
  contributions: number; // your contributions (cash outflow)
  employerContributions: number;
  spending: number; // living expenses incl. healthcare
  /** All healthcare: preMedicare + medicare + irmaa + ltc (included in spending). */
  healthcare: number;
  preMedicare: number;
  medicare: number;
  irmaa: number;
  ltc: number;
  /** HSA withdrawals beyond cumulative medical costs (taxed, +20% penalty before 65). */
  hsaNonQualified: number;
  agi: number;
  debtPayments: number;
  /** The part of debtPayments that goes to mortgages. */
  mortgagePayments: number;
  debtInterest: number;
  /** California property tax on your homes (Prop 13). */
  propertyTax: number;
  /** Maintenance and repairs on your homes. */
  homeUpkeep: number;
  /** HSA money used for this year's medical costs (tax-free). */
  hsaMedical: number;
  /** Itemized vs. standard deduction used on the federal return. */
  federalItemized: boolean;
  federalDeduction: number;
  taxes: number;
  federalTax: number;
  stateTax: number;
  payrollTax: number;
  penalty: number;
  withdrawals: number;
  withdrawalsByType: Record<AccountType, number>;
  rmd: number;
  realizedGains: number;
  surplus: number; // leftover cash flow after everything (before investing it)
  surplusInvested: number;
  /** Where invested leftover cash went. */
  surplusTo401k: number;
  surplusToHSA: number;
  surplusToBrokerage: number;
  shortfall: number; // spending that could not be funded
  // Balances (nominal, end of year)
  balances: Record<string, number>;
  byType: Record<AccountType, number>;
  debtBalances: Record<string, number>;
  totalDebt: number;
  assets: number;
  liquid: number;
  netWorth: number;
}

export interface ProjectionResult {
  rows: YearRow[];
  currentAge: number;
  retireIndex: number; // row index where you are first retired
  depletionAge: number | null;
  success: boolean;
  debtPayoffAge: Record<string, number | null>;
  /** Placeholder accounts the model opened to hold leftover income. */
  syntheticAccounts: Account[];
}

const WITHDRAW_ORDER: AccountType[] = ['cash', 'taxable', 'traditional', 'roth', 'hsa', 'other', 'property'];

export { ssFactor } from './socialSecurity';

/** IRS Uniform Lifetime Table divisor (abridged). */
export function rmdDivisor(age: number): number {
  const table: Record<number, number> = {
    72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1, 80: 20.2,
    81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9,
    90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9, 96: 8.4, 97: 7.8, 98: 7.3,
    99: 6.8, 100: 6.4, 101: 6.0, 102: 5.6, 103: 5.2, 104: 4.9, 105: 4.6,
  };
  if (age < 72) return Infinity;
  return table[age] ?? Math.max(2, 4.6 - 0.3 * (age - 105));
}

/**
 * Typical (median) annual growth for a lognormal return with this arithmetic mean and
 * volatility: the mean minus "volatility drag". Compounding the arithmetic mean every year
 * describes the average outcome, which a few very lucky paths pull up; the median is what
 * a typical path looks like and matches the middle of the Monte Carlo range.
 */
export function medianReturn(mean: number, sd: number): number {
  if (sd <= 0) return mean;
  return (1 + mean) / Math.sqrt(1 + (sd * sd) / ((1 + mean) * (1 + mean))) - 1;
}

export function rmdStartAge(birthYear: number): number {
  return birthYear >= 1960 ? 75 : 73;
}


const emptyByType = (): Record<AccountType, number> =>
  Object.fromEntries(ACCOUNT_TYPES.map((t) => [t, 0])) as Record<AccountType, number>;

export function catchUp401(age: number): number {
  if (age >= 60 && age <= 63) return LIMITS_2026.k401CatchUp60to63;
  return age >= 50 ? LIMITS_2026.k401CatchUp50 : 0;
}

/**
 * Placeholder accounts for the savings waterfall: a 401(k) for each earner without one,
 * an HSA, and a brokerage account, each only when the waterfall would use it.
 */
export function syntheticAccountsFor(plan: Plan): Account[] {
  const A = plan.assumptions;
  if (A.surplusSavePct <= 0) return [];
  const out: Account[] = [];
  const base = (id: string, name: string, type: AccountType, owner: Account['owner'], allocation: Account['allocation']): Account => ({
    id, name, type, owner, allocation, returnRate: 7, volatility: 12, contribution: 0, employerContribution: 0,
    costBasisPct: 100, spendable: true, history: [], synthetic: true,
  });
  const people: ('self' | 'spouse')[] = plan.married ? ['self', 'spouse'] : ['self'];
  if (A.surplusTo401k) {
    for (const who of people) {
      const has = plan.accounts.some((a) => a.type === 'traditional' && (a.owner === who || (who === 'self' && a.owner === 'joint')));
      if (!has && plan[who].income > 0) {
        out.push(base(`auto-401k-${who}`, `401(k) — ${plan[who].name || (who === 'self' ? 'You' : 'Spouse')}`, 'traditional', who, 'auto'));
      }
    }
  }
  const earners = people.some((w) => plan[w].income > 0);
  if (A.surplusToHSA && earners && !plan.accounts.some((a) => a.type === 'hsa')) {
    out.push(base('auto-hsa', 'HSA', 'hsa', 'self', 100));
  }
  const hasRemainder = plan.accounts.some((a) => a.id === A.surplusAccountId || a.type === 'taxable');
  if (earners && !hasRemainder) out.push(base('auto-brokerage', 'Brokerage', 'taxable', 'joint', 100));
  return out;
}

export function currentAgeOf(birthYear: number, now = new Date()): number {
  return now.getFullYear() - birthYear;
}

export function runProjection(
  plan: Plan,
  opts: { sampler?: ReturnSampler; now?: Date } = {},
): ProjectionResult {
  const now = opts.now ?? new Date();
  const startYear = now.getFullYear();
  const A = plan.assumptions;
  const infl = A.inflation / 100;
  const g = A.incomeGrowth / 100;
  const married = plan.married;
  const age0 = currentAgeOf(plan.self.birthYear, now);
  const spouseAge0 = married ? currentAgeOf(plan.spouse.birthYear, now) : null;
  const horizon = Math.max(1, plan.lifeExpectancy - age0);
  // Tax brackets are for TAX_YEAR; index relative to it.
  const bracketBase = Math.pow(1 + infl, startYear - TAX_YEAR);

  // Leftover income needs somewhere to go. If you don't have the accounts the savings
  // waterfall uses, open empty placeholders so the money is still invested sensibly.
  const synthetic = syntheticAccountsFor(plan);
  const accounts = [...plan.accounts, ...synthetic];
  const bal: Record<string, number> = {};
  const basis: Record<string, number> = {};
  for (const a of accounts) {
    bal[a.id] = Math.max(0, latestValue(a.history));
    basis[a.id] = a.type === 'taxable' ? (bal[a.id] * a.costBasisPct) / 100 : bal[a.id];
  }
  // Prop 13 assessed values today (default: current market value if not entered).
  const assessed0: Record<string, number> = {};
  for (const a of accounts) {
    if (a.type === 'property' && a.propertyTax) assessed0[a.id] = a.propertyTax.assessedValue ?? bal[a.id];
  }
  const debtBal: Record<string, number> = {};
  for (const d of plan.debts) debtBal[d.id] = Math.max(0, latestValue(d.history));
  const debtPayoffAge: Record<string, number | null> = {};
  for (const d of plan.debts) debtPayoffAge[d.id] = debtBal[d.id] <= 0 ? age0 : null;

  const spendable = accounts
    .filter((a) => a.spendable)
    .sort((a, b) => WITHDRAW_ORDER.indexOf(a.type) - WITHDRAW_ORDER.indexOf(b.type));

  // Remainder of leftover cash (and excess RMDs in retirement) goes to brokerage.
  const remainderTarget =
    accounts.find((a) => a.id === A.surplusAccountId) ??
    accounts.find((a) => a.type === 'taxable') ??
    accounts.find((a) => a.type === 'cash') ??
    spendable[0] ??
    null;
  const k401Target = (who: 'self' | 'spouse') =>
    accounts.find((a) => a.type === 'traditional' && (a.owner === who || (who === 'self' && a.owner === 'joint'))) ?? null;
  const hsaTarget = accounts.find((a) => a.type === 'hsa') ?? null;
  const personOf = (a: Account): 'self' | 'spouse' => (a.owner === 'spouse' && married ? 'spouse' : 'self');

  const ownerAge = (a: Account, k: number) =>
    a.owner === 'spouse' && married ? spouseAge0! + k : age0 + k;
  const ownerRetirementAge = (a: Account) =>
    a.owner === 'spouse' && married ? plan.spouse.retirementAge : plan.self.retirementAge;
  const ownerWorking = (a: Account, k: number) => {
    const selfWorking = age0 + k < plan.self.retirementAge;
    const spouseWorking = married && spouseAge0! + k < plan.spouse.retirementAge;
    if (a.owner === 'spouse') return spouseWorking;
    if (a.owner === 'joint') return selfWorking || spouseWorking;
    return selfWorking;
  };

  const snapshotRow = (k: number, partial: Partial<YearRow>): YearRow => {
    const byType = emptyByType();
    let assets = 0;
    let liquid = 0;
    for (const a of accounts) {
      byType[a.type] += bal[a.id];
      assets += bal[a.id];
      if (a.spendable) liquid += bal[a.id];
    }
    const totalDebt = Object.values(debtBal).reduce((s, v) => s + v, 0);
    return {
      k,
      year: startYear + k,
      age: age0 + k,
      spouseAge: spouseAge0 != null ? spouseAge0 + k : null,
      inflation: Math.pow(1 + infl, k),
      retired: age0 + k >= plan.self.retirementAge,
      spouseRetired: married ? spouseAge0! + k >= plan.spouse.retirementAge : true,
      wages: 0, socialSecurity: 0, otherIncome: 0, eventsIn: 0, eventsOut: 0,
      contributions: 0, employerContributions: 0, spending: 0, healthcare: 0,
      preMedicare: 0, medicare: 0, irmaa: 0, ltc: 0, hsaNonQualified: 0, agi: 0,
      debtPayments: 0, mortgagePayments: 0, debtInterest: 0, propertyTax: 0, homeUpkeep: 0, hsaMedical: 0, federalItemized: false, federalDeduction: 0, taxes: 0, federalTax: 0, stateTax: 0, payrollTax: 0,
      penalty: 0, withdrawals: 0, withdrawalsByType: emptyByType(), rmd: 0, realizedGains: 0,
      surplus: 0, surplusInvested: 0, surplusTo401k: 0, surplusToHSA: 0, surplusToBrokerage: 0, shortfall: 0,
      ...partial,
      balances: { ...bal },
      byType,
      debtBalances: { ...debtBal },
      totalDebt,
      assets,
      liquid,
      netWorth: assets - totalDebt,
    };
  };

  // Monthly Social Security at each person's claiming age, today's $ (grows with inflation).
  const ssSelf = benefitAtClaim(plan, 'self').monthly;
  const ssSpouse = married ? benefitAtClaim(plan, 'spouse').monthly : 0;

  const hcPremium = Array.from({ length: horizon + 1 }, (_, k) => healthcarePremiumIndex(k, A.healthcareInflationExtra));
  const agiByK: number[] = [];
  let medicalBank = 0; // cumulative unreimbursed medical costs (for tax-free HSA withdrawals)

  const rows: YearRow[] = [snapshotRow(0, {})];
  let depletionAge: number | null = null;

  for (let k = 1; k <= horizon; k++) {
    // Row k covers the year in which you turn age0+k; balances are as of its end.
    const age = age0 + k;
    const sAge = spouseAge0 != null ? spouseAge0 + k : null;
    const f = Math.pow(1 + infl, k); // inflation index for this year
    const fBrackets = bracketBase * f;
    const selfWorking = age < plan.self.retirementAge;
    const spouseWorking = married && sAge! < plan.spouse.retirementAge;
    const retired = !selfWorking;
    const growth = Math.pow(1 + g, k - 1);

    // --- Income
    const wSelf = selfWorking ? plan.self.income * growth : 0;
    const wSpouse = spouseWorking ? plan.spouse.income * growth : 0;
    const wages = wSelf + wSpouse;
    let socialSecurity = 0;
    if (age >= plan.self.ssClaimAge) socialSecurity += ssSelf * 12 * f;
    if (married && sAge! >= plan.spouse.ssClaimAge) socialSecurity += ssSpouse * 12 * f;
    let otherIncome = 0;
    let otherTaxable = 0;
    for (const s of plan.incomeStreams) {
      if (age >= s.startAge && age < s.endAge) {
        const amt = s.amount * (s.inflationAdjusted ? f : 1);
        otherIncome += amt;
        if (s.taxable) otherTaxable += amt;
      }
    }
    let eventsIn = 0;
    let eventsOut = 0;
    for (const e of plan.events) {
      if (e.age === age) {
        if (e.amount >= 0) eventsIn += e.amount * f;
        else eventsOut += -e.amount * f;
      }
    }

    // --- Contributions (while the account owner works)
    const contrib: Record<string, number> = {};
    let contributions = 0;
    let employerContributions = 0;
    let pretax = 0;
    let hsaContrib = 0;
    const deferred = { self: 0, spouse: 0 }; // your own pre-tax 401(k) deferrals, per person
    let hsaTotal = 0; // incl. employer, counts toward the HSA limit
    for (const a of accounts) {
      if (!ownerWorking(a, k)) continue;
      const mine = a.contribution * growth;
      const er = a.employerContribution * growth;
      contrib[a.id] = mine + er;
      contributions += mine;
      employerContributions += er;
      if (a.type === 'traditional') {
        pretax += mine;
        deferred[personOf(a)] += mine;
      }
      if (a.type === 'hsa') {
        hsaContrib += mine;
        hsaTotal += mine + er;
      }
    }

    // --- Spending
    const baseSpend = (retired ? plan.retirementSpending : plan.annualSpending) * f;
    // While anyone works, employer coverage is assumed and its cost sits in living expenses.
    const hc = healthcareYear({
      h: plan.healthcare,
      married,
      ages: married ? [age, sAge!] : [age],
      // Coverage comes from a paycheck: a spouse with no income doesn't provide it.
      anyoneWorking: (selfWorking && plan.self.income > 0) || (spouseWorking && plan.spouse.income > 0),
      yourAge: age,
      magiTwoYearsAgo: agiByK[k - 2] ?? agiByK[k - 1] ?? null,
      hcf: f * hcPremium[k],
      index: fBrackets,
    });
    const healthcare = hc.total;
    const spending = baseSpend + healthcare;
    // Costs that HSA money can reimburse tax-free.
    medicalBank += healthcare;

    // --- Debts
    let debtPayments = 0;
    let mortgagePayments = 0;
    let debtInterest = 0;
    let mortgageInterest = 0;
    let mortgageBalance = 0;
    for (const d of plan.debts) {
      if (debtBal[d.id] <= 0) continue;
      const startBal = debtBal[d.id];
      const res = stepDebtYear(debtBal[d.id], d.rate, d.monthlyPayment + d.extraPayment);
      if (d.type === 'mortgage') {
        mortgageInterest += res.interest;
        mortgageBalance += (startBal + res.balance) / 2;
        mortgagePayments += res.paid;
      }
      debtBal[d.id] = res.balance;
      debtPayments += res.paid;
      debtInterest += res.interest;
      if (res.balance <= 0 && debtPayoffAge[d.id] == null) debtPayoffAge[d.id] = age;
    }

    // --- California property tax on each home (Prop 13: assessed value grows ≤2%/yr)
    // plus upkeep (maintenance and repairs) as a share of market value.
    let propertyTax = 0;
    let homeUpkeep = 0;
    for (const a of accounts) {
      if (a.type !== 'property' || !a.propertyTax || bal[a.id] <= 0) continue;
      propertyTax += propertyTaxFor(a.propertyTax, assessed0[a.id], k, bal[a.id], f).tax;
      homeUpkeep += (bal[a.id] * (a.propertyTax.upkeepPct ?? 0)) / 100;
    }

    // --- Withdrawals: required minimum distributions first
    const avail: Record<string, number> = {};
    for (const a of accounts) avail[a.id] = bal[a.id] + (contrib[a.id] ?? 0);
    const rmd: Record<string, number> = {};
    let rmdTotal = 0;
    for (const a of accounts) {
      if (a.type !== 'traditional') continue;
      const oBirth = a.owner === 'spouse' && married ? plan.spouse.birthYear : plan.self.birthYear;
      const oAge = ownerAge(a, k);
      if (oAge >= rmdStartAge(oBirth)) {
        const amt = Math.min(avail[a.id], bal[a.id] / rmdDivisor(oAge));
        rmd[a.id] = amt;
        rmdTotal += amt;
      }
    }

    // Once you pay for your own healthcare, the HSA reimburses it first (tax-free).
    let hsaMedical = 0;
    const hsaMed: Record<string, number> = {};
    for (const a of spendable) {
      if (a.type !== 'hsa' || healthcare <= 0) continue;
      const x = Math.min(avail[a.id], healthcare - hsaMedical);
      if (x <= 0) continue;
      hsaMed[a.id] = x;
      avail[a.id] -= x;
      hsaMedical += x;
    }
    medicalBank -= hsaMedical;

    const inflows = wages + socialSecurity + otherIncome + eventsIn + hsaMedical;
    const outflowsExTax = spending + debtPayments + propertyTax + homeUpkeep + contributions + eventsOut;
    const seniors = (age >= 65 ? 1 : 0) + (married && sAge! >= 65 ? 1 : 0);

    // Allocate `amount` of extra withdrawals in order, on top of RMDs.
    const allocate = (amount: number) => {
      const take: Record<string, number> = {};
      let remaining = amount;
      let trad = 0;
      let tradEarly = 0;
      let gains = 0;
      let bank = medicalBank;
      let hsaNonQ = 0;
      let hsaNonQEarly = 0;
      let hsaQualified = 0;
      for (const a of spendable) {
        if (remaining <= 0) break;
        const room = avail[a.id] - (rmd[a.id] ?? 0);
        if (room <= 0) continue;
        const t = Math.min(room, remaining);
        take[a.id] = t;
        remaining -= t;
        if (a.type === 'traditional') {
          trad += t;
          if (ownerAge(a, k) < 59) tradEarly += t;
        }
        if (a.type === 'taxable' && avail[a.id] > 0) {
          const basisRatio = Math.min(1, (basis[a.id] + (contrib[a.id] ?? 0)) / avail[a.id]);
          gains += t * (1 - basisRatio);
        }
        if (a.type === 'hsa') {
          // Tax-free up to medical costs incurred; beyond that it's income (+20% before 65).
          const q = Math.min(t, bank);
          bank -= q;
          hsaQualified += q;
          hsaNonQ += t - q;
          if (ownerAge(a, k) < 65) hsaNonQEarly += t - q;
        }
      }
      return { take, trad, tradEarly, gains, hsaNonQ, hsaNonQEarly, hsaQualified, taken: amount - remaining, unmet: remaining };
    };

    const taxFor = (a: ReturnType<typeof allocate>) => {
      const t = computeTaxes({
        married,
        wages: married ? [wSelf, wSpouse] : [wSelf],
        pretaxRetirement: pretax,
        hsaContrib,
        ordinaryOther: otherTaxable + rmdTotal + a.trad + a.hsaNonQ,
        socialSecurity,
        longTermGains: a.gains,
        seniors,
        index: fBrackets,
        year: startYear + k,
        propertyTax,
        mortgageInterest,
        mortgageBalance,
      });
      return { t, penalty: 0.1 * a.tradEarly + 0.2 * a.hsaNonQEarly };
    };

    let extra = 0;
    let alloc = allocate(0);
    let tx = taxFor(alloc);
    for (let iter = 0; iter < 12; iter++) {
      tx = taxFor(alloc);
      const need = outflowsExTax + tx.t.total + tx.penalty - inflows - rmdTotal;
      const next = Math.max(0, need);
      if (Math.abs(next - extra) < 0.5) break;
      extra = next;
      alloc = allocate(extra);
    }
    tx = taxFor(alloc);
    let taxes = tx.t.total + tx.penalty;
    const cashAfter = inflows + rmdTotal + alloc.taken - outflowsExTax - taxes;
    const shortfall = cashAfter < -1 ? -cashAfter : 0;
    let surplus = Math.max(0, cashAfter);
    if (shortfall > 0 && depletionAge == null) depletionAge = age;

    // --- Savings waterfall for leftover income while anyone is working:
    // 401(k) up to the limit → HSA up to the limit → brokerage. 401(k) and HSA money is
    // pre-tax, so each step lowers taxes and frees a little more cash for the next.
    const extraTo: Record<string, number> = {};
    let surplusTo401k = 0;
    let surplusToHSA = 0;
    let surplusToBrokerage = 0;
    const saveShare = A.surplusSavePct / 100;
    const working = selfWorking || spouseWorking;
    if (surplus > 0 && working && saveShare > 0) {
      let budget = surplus * saveShare;
      const retax = () => {
        const before = taxes;
        tx = taxFor(alloc);
        taxes = tx.t.total + tx.penalty;
        const saved = before - taxes;
        surplus += saved;
        budget += saved * saveShare;
      };
      const k401Room: Record<'self' | 'spouse', number> = { self: 0, spouse: 0 };
      if (A.surplusTo401k) {
        for (const [who, isWorking, wage, pAge] of [
          ['self', selfWorking, wSelf, age],
          ['spouse', spouseWorking, wSpouse, sAge ?? 0],
        ] as const) {
          if (!isWorking || !k401Target(who) || wage <= 0) continue;
          const limit = (LIMITS_2026.k401 + catchUp401(pAge)) * fBrackets;
          k401Room[who] = Math.max(0, Math.min(limit, wage) - deferred[who]);
        }
      }
      let hsaRoom = 0;
      if (A.surplusToHSA && hsaTarget) {
        const catchUps = (age >= 55 ? 1 : 0) + (married && (sAge ?? 0) >= 55 ? 1 : 0);
        const limit = ((married ? LIMITS_2026.hsaFamily : LIMITS_2026.hsaSelf) + LIMITS_2026.hsaCatchUp55 * catchUps) * fBrackets;
        hsaRoom = Math.max(0, limit - hsaTotal);
      }
      // Each pre-tax dollar lowers taxes, which frees more cash; repeat until it settles
      // so the 401(k) absorbs its own tax savings before anything spills to the HSA.
      for (let pass = 0; pass < 8 && budget > 0.5; pass++) {
        let moved = 0;
        for (const who of ['self', 'spouse'] as const) {
          const x = Math.min(budget, k401Room[who]);
          if (x <= 0) continue;
          const t = k401Target(who)!;
          extraTo[t.id] = (extraTo[t.id] ?? 0) + x;
          k401Room[who] -= x;
          surplusTo401k += x;
          pretax += x;
          budget -= x;
          moved += x;
        }
        if (moved === 0 && hsaRoom > 0 && budget > 0) {
          const x = Math.min(budget, hsaRoom);
          extraTo[hsaTarget!.id] = (extraTo[hsaTarget!.id] ?? 0) + x;
          hsaRoom -= x;
          surplusToHSA += x;
          hsaContrib += x;
          budget -= x;
          moved += x;
        }
        if (moved === 0) break;
        retax();
      }
      if (remainderTarget && budget > 0) {
        extraTo[remainderTarget.id] = (extraTo[remainderTarget.id] ?? 0) + budget;
        surplusToBrokerage = budget;
      }
    } else if (surplus > 0 && !working && remainderTarget) {
      // Retired: leftover cash (e.g. RMDs beyond spending) is reinvested.
      extraTo[remainderTarget.id] = surplus;
      surplusToBrokerage = surplus;
    }
    const surplusInvested = surplusTo401k + surplusToHSA + surplusToBrokerage;
    medicalBank -= alloc.hsaQualified;
    agiByK[k] = tx.t.agi;

    // Apply withdrawals
    const withdrawalsByType = emptyByType();
    const withdrawn: Record<string, number> = {};
    for (const a of accounts) {
      const w = (rmd[a.id] ?? 0) + (alloc.take[a.id] ?? 0) + (hsaMed[a.id] ?? 0);
      if (w <= 0) continue;
      withdrawn[a.id] = w;
      withdrawalsByType[a.type] += w;
      if (a.type === 'taxable' && avail[a.id] > 0) {
        const newBasis = basis[a.id] + (contrib[a.id] ?? 0);
        basis[a.id] = newBasis * (1 - w / avail[a.id]);
      }
    }
    for (const a of accounts) {
      if (a.type === 'taxable' && !withdrawn[a.id]) basis[a.id] += contrib[a.id] ?? 0;
      else if (a.type !== 'taxable') basis[a.id] = 0;
    }

    for (const [id, x] of Object.entries(extraTo)) {
      contrib[id] = (contrib[id] ?? 0) + x;
      if (accounts.find((a) => a.id === id)?.type === 'taxable') basis[id] += x;
    }

    // Grow balances. Contributions and withdrawals happen mid-year on average.
    for (const a of accounts) {
      const m = accountReturn(a, A, ownerAge(a, k), ownerRetirementAge(a));
      const r = opts.sampler
        ? opts.sampler(k, a.id, m.rate / 100, m.vol / 100, shockLoadings(a, A, ownerAge(a, k), ownerRetirementAge(a)))
        : medianReturn(m.rate / 100, m.vol / 100);
      const net = (contrib[a.id] ?? 0) - (withdrawn[a.id] ?? 0);
      bal[a.id] = Math.max(0, bal[a.id] * (1 + r) + net * (1 + r / 2));
      if (a.type === 'taxable') basis[a.id] = Math.min(basis[a.id], bal[a.id]);
    }

    rows.push(
      snapshotRow(k, {
        wages, socialSecurity, otherIncome, eventsIn, eventsOut,
        contributions, employerContributions, spending, healthcare,
        preMedicare: hc.preMedicare, medicare: hc.medicare, irmaa: hc.irmaa, ltc: hc.ltc,
        hsaNonQualified: alloc.hsaNonQ, agi: tx.t.agi,
        debtPayments, mortgagePayments, debtInterest, taxes, propertyTax, homeUpkeep, hsaMedical,
        federalItemized: tx.t.federalItemized, federalDeduction: tx.t.federalDeduction,
        federalTax: tx.t.federal,
        stateTax: tx.t.state,
        payrollTax: tx.t.socialSecurityTax + tx.t.medicare + tx.t.sdi,
        penalty: tx.penalty,
        withdrawals: rmdTotal + alloc.taken + hsaMedical,
        withdrawalsByType,
        rmd: rmdTotal,
        realizedGains: alloc.gains,
        surplus, surplusInvested, surplusTo401k, surplusToHSA, surplusToBrokerage, shortfall,
      }),
    );
  }

  const retireIndex = Math.max(0, Math.min(rows.length - 1, plan.self.retirementAge - age0));
  return {
    rows,
    currentAge: age0,
    retireIndex,
    depletionAge,
    success: depletionAge == null,
    debtPayoffAge,
    syntheticAccounts: synthetic,
  };
}
