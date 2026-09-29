import type { Account, AccountType, Allocation, Debt, DebtType, Plan, Snapshot } from './types';
import { DEBT_TYPE_LABEL } from './types';
import { paymentFor } from './debt';
import { defaultHealthcare } from './healthcare';
import { SF_PROPERTY_TAX_RATE } from './tax';

export const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Sensible defaults per account type so a new account needs only a name and balance.
 * Retirement accounts default to a target-date glide path, brokerage and HSA to an
 * S&P 500 index fund (HSAs drawn last have a long horizon), cash to the market savings rate.
 */
export const TYPE_DEFAULTS: Record<AccountType, { name: string; allocation: Allocation; rate: number; vol: number }> = {
  cash: { name: 'Savings', allocation: 'auto', rate: 4, vol: 0.5 },
  taxable: { name: 'Brokerage', allocation: 100, rate: 8, vol: 16 },
  traditional: { name: '401(k)', allocation: 'auto', rate: 7, vol: 12 },
  roth: { name: 'Roth IRA', allocation: 'auto', rate: 7, vol: 12 },
  hsa: { name: 'HSA', allocation: 100, rate: 8, vol: 16 },
  property: { name: 'Home', allocation: 'custom', rate: 4, vol: 8 },
  other: { name: 'Other asset', allocation: 'custom', rate: 5, vol: 10 },
};

/** Typical loan terms (months) used to infer a payment when none is entered. */
export const DEFAULT_DEBT_TERMS: Record<DebtType, number> = {
  mortgage: 360, heloc: 240, auto: 60, student: 120, credit: 36, personal: 60, other: 60,
};

export const DEFAULT_DEBT_RATES: Record<DebtType, number> = {
  mortgage: 6.25, heloc: 8.5, auto: 6.5, student: 5.5, credit: 22, personal: 12, other: 8,
};

export function newAccount(type: AccountType = 'taxable', value = 0, date?: string): Account {
  return {
    id: uid(),
    name: TYPE_DEFAULTS[type].name,
    type,
    owner: 'self',
    allocation: TYPE_DEFAULTS[type].allocation,
    returnRate: TYPE_DEFAULTS[type].rate,
    volatility: TYPE_DEFAULTS[type].vol,
    contribution: 0,
    employerContribution: 0,
    costBasisPct: 80,
    spendable: type !== 'property',
    history: date ? [{ date, value }] : [],
    ...(type === 'property' ? { propertyTax: defaultPropertyTax() } : {}),
  };
}

export function defaultPropertyTax(): NonNullable<Account['propertyTax']> {
  return { assessedValue: null, rate: SF_PROPERTY_TAX_RATE, fixedCharges: 600, homeownersExemption: true, upkeepPct: 1 };
}

export function newDebt(type: DebtType = 'mortgage', balance = 0, date?: string): Debt {
  return {
    id: uid(),
    name: DEBT_TYPE_LABEL[type],
    type,
    rate: DEFAULT_DEBT_RATES[type],
    monthlyPayment: 0,
    extraPayment: 0,
    history: date ? [{ date, value: balance }] : [],
  };
}

export function defaultAssumptions(): Plan['assumptions'] {
  return {
    stockReturn: 8,
    stockVolatility: 16,
    bondReturn: 4.25,
    bondVolatility: 6,
    cashReturn: 3.75,
    inflation: 2.75,
    incomeGrowth: 3.5,
    retirementReturnShift: 0,
    returnShift: 0,
    healthcareInflationExtra: 2,
    surplusSavePct: 100,
    surplusTo401k: true,
    surplusToHSA: true,
    surplusAccountId: null,
    targetSuccess: 85,
    simulations: 500,
    withdrawalRate: 4,
  };
}

export function emptyPlan(): Plan {
  const y = new Date().getFullYear();
  return {
    version: 1,
    married: true,
    location: 'San Francisco, CA',
    self: { name: 'You', birthYear: y - 35, retirementAge: 62, income: 0, ssEstimate: true, ssBenefitFRA: 0, ssClaimAge: 67 },
    spouse: { name: 'Spouse', birthYear: y - 35, retirementAge: 62, income: 0, ssEstimate: true, ssBenefitFRA: 0, ssClaimAge: 67 },
    lifeExpectancy: 95,
    annualSpending: 0,
    retirementSpending: 0,
    healthcare: defaultHealthcare(),
    assumptions: defaultAssumptions(),
    accounts: [],
    debts: [],
    incomeStreams: [],
    events: [],
    updatedAt: new Date().toISOString(),
  };
}

/** Quarterly dates going back `quarters` quarters from today (oldest first). */
function quarterDates(quarters: number, now: Date): string[] {
  const out: string[] = [];
  for (let q = quarters; q >= 1; q--) {
    const d = new Date(now.getFullYear(), now.getMonth() - q * 3 + 1, 0); // month-end
    out.push(d.toISOString().slice(0, 10));
  }
  out.push(now.toISOString().slice(0, 10));
  return out;
}

/** Plausible back-filled history ending at `current`, with market-like wiggle. */
function backfill(current: number, annualRate: number, annualAdd: number, dates: string[], wiggle: number, phase: number): Snapshot[] {
  const end = Date.parse(dates.at(-1)!);
  return dates.map((date, i) => {
    const yrs = (end - Date.parse(date)) / (365.25 * 864e5);
    const noise = i === dates.length - 1 ? 0 : wiggle * Math.sin(i * 1.7 + phase) * Math.min(1, yrs);
    const v = current / Math.pow(1 + annualRate, yrs) - annualAdd * yrs;
    return { date, value: Math.max(0, Math.round(v * (1 + noise))) };
  });
}

function debtBackfill(current: number, rate: number, payment: number, dates: string[]): Snapshot[] {
  const end = Date.parse(dates.at(-1)!);
  const r = rate / 100 / 12;
  return dates.map((date) => {
    const months = Math.round((end - Date.parse(date)) / (30.44 * 864e5));
    // Reverse amortization: balance n months ago.
    let b = current;
    for (let m = 0; m < months; m++) b = (b + payment) / (1 + r);
    return { date, value: Math.round(b) };
  });
}

/** Illustrative household in San Francisco. Replace with your own numbers. */
export function samplePlan(now = new Date()): Plan {
  const y = now.getFullYear();
  const dates = quarterDates(8, now);
  const acct = (
    name: string, type: AccountType, owner: Account['owner'], value: number,
    contribution: number, employer = 0, extra: Partial<Account> = {},
  ): Account => {
    const a = newAccount(type);
    const annualAdd = contribution + employer;
    return {
      ...a, name, owner, contribution, employerContribution: employer, ...extra,
      history: backfill(value, type === 'cash' ? 0.04 : type === 'property' ? 0.035 : 0.07, annualAdd,
        dates, type === 'cash' ? 0.02 : type === 'property' ? 0.015 : 0.05, name.length),
    };
  };
  const accounts: Account[] = [
    acct('High-yield savings', 'cash', 'joint', 48_000, 0, 0),
    acct('Brokerage — index funds', 'taxable', 'joint', 186_000, 12_000, 0, { costBasisPct: 68 }),
    acct('Your 401(k)', 'traditional', 'self', 312_000, 24_500, 9_500),
    acct("Spouse's 401(k)", 'traditional', 'spouse', 198_000, 24_500, 7_000),
    acct('Roth IRAs (backdoor)', 'roth', 'joint', 96_000, 15_000, 0),
    acct('Family HSA', 'hsa', 'self', 34_000, 8_750, 0),
    acct('Home — Noe Valley', 'property', 'joint', 1_650_000, 0, 0, {
      returnRate: 3.5,
      // Bought in 2023 for $1.5M: Prop 13 assessed value is ~$1.59M today.
      propertyTax: { ...defaultPropertyTax(), assessedValue: 1_591_800 },
    }),
  ];
  const mortPay = Math.round(paymentFor(1_120_000, 6.125, 360));
  const debts: Debt[] = [
    { ...newDebt('mortgage'), name: '30-yr fixed mortgage', rate: 6.125, monthlyPayment: mortPay,
      history: debtBackfill(1_061_000, 6.125, mortPay, dates) },
    { ...newDebt('auto'), name: 'Car loan', rate: 4.9, monthlyPayment: 610,
      history: debtBackfill(17_400, 4.9, 610, dates) },
  ];
  return {
    version: 1,
    married: true,
    location: 'San Francisco, CA',
    self: { name: 'You', birthYear: y - 38, retirementAge: 57, income: 225_000, ssEstimate: true, ssBenefitFRA: 0, ssClaimAge: 67 },
    spouse: { name: 'Spouse', birthYear: y - 36, retirementAge: 57, income: 175_000, ssEstimate: true, ssBenefitFRA: 0, ssClaimAge: 67 },
    lifeExpectancy: 95,
    annualSpending: 62_000,
    retirementSpending: 88_000,
    healthcare: defaultHealthcare(),
    assumptions: defaultAssumptions(),
    accounts,
    debts,
    incomeStreams: [],
    events: [
      { id: uid(), name: 'Kitchen remodel', age: 41, amount: -85_000 },
      { id: uid(), name: 'College (two kids, 529 top-up)', age: 52, amount: -120_000 },
    ],
    updatedAt: now.toISOString(),
  };
}
