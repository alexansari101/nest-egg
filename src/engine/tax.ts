// Tax estimates for a married couple filing jointly in San Francisco, CA
// (single filer rates are used when `married` is false).
//
// Federal: 2026 brackets (IRS Rev. Proc. 2025-32, post-OBBBA).
// California: 2025 FTB brackets (latest published); indexed with inflation in projections.
// San Francisco levies no personal income tax (its payroll/gross receipts taxes fall on employers).
// These are planning estimates, not tax advice. No AMT, NIIT or itemized-deduction modeling.

export type Bracket = [upTo: number, rate: number];

export const TAX_YEAR = 2026;

export const FED_BRACKETS_MFJ: Bracket[] = [
  [24_800, 0.10],
  [100_800, 0.12],
  [211_400, 0.22],
  [403_550, 0.24],
  [512_450, 0.32],
  [768_700, 0.35],
  [Infinity, 0.37],
];

export const FED_BRACKETS_SINGLE: Bracket[] = [
  [12_400, 0.10],
  [50_400, 0.12],
  [105_700, 0.22],
  [201_775, 0.24],
  [256_225, 0.32],
  [640_600, 0.35],
  [Infinity, 0.37],
];

export const FED_STD_DEDUCTION = { mfj: 32_200, single: 16_100 };
/** Additional standard deduction per person age 65+ (MFJ, per spouse). */
export const FED_STD_65_ADDON = { mfj: 1_650, single: 2_050 };

/** Long-term capital gains: rate applies to taxable income up to the threshold. */
export const LTCG_BRACKETS_MFJ: Bracket[] = [
  [98_900, 0],
  [613_700, 0.15],
  [Infinity, 0.20],
];
export const LTCG_BRACKETS_SINGLE: Bracket[] = [
  [49_450, 0],
  [545_500, 0.15],
  [Infinity, 0.20],
];

export const CA_BRACKETS_MFJ: Bracket[] = [
  [22_158, 0.01],
  [52_528, 0.02],
  [82_904, 0.04],
  [115_084, 0.06],
  [145_448, 0.08],
  [742_958, 0.093],
  [891_542, 0.103],
  [1_485_906, 0.113],
  [Infinity, 0.123],
];
export const CA_BRACKETS_SINGLE: Bracket[] = CA_BRACKETS_MFJ.map(([t, r]) => [t / 2, r]);
export const CA_STD_DEDUCTION = { mfj: 11_412, single: 5_706 };
export const CA_EXEMPTION_CREDIT = { mfj: 306, single: 153 };
/** Mental Health Services Tax: +1% on taxable income over $1M (not indexed). */
export const CA_MHST_THRESHOLD = 1_000_000;

export const SS_WAGE_BASE = 184_500;
export const SS_RATE = 0.062;
export const MEDICARE_RATE = 0.0145;
export const ADDL_MEDICARE_RATE = 0.009;
export const ADDL_MEDICARE_THRESHOLD = { mfj: 250_000, single: 200_000 };
export const CA_SDI_RATE = 0.013; // 2026, no wage cap

export const LIMITS_2026 = {
  k401: 24_500,
  k401CatchUp50: 8_000,
  k401CatchUp60to63: 11_250,
  ira: 7_500,
  iraCatchUp50: 1_100,
  hsaFamily: 8_750,
  hsaSelf: 4_400,
  hsaCatchUp55: 1_000,
};

export function bracketTax(income: number, brackets: Bracket[], index = 1): number {
  if (income <= 0) return 0;
  let tax = 0;
  let prev = 0;
  for (const [upTo, rate] of brackets) {
    const cap = upTo * index;
    if (income <= cap) return tax + (income - prev) * rate;
    tax += (cap - prev) * rate;
    prev = cap;
  }
  return tax;
}

export function marginalRate(income: number, brackets: Bracket[], index = 1): number {
  for (const [upTo, rate] of brackets) if (income <= upTo * index) return rate;
  return brackets[brackets.length - 1][1];
}

/** Federal tax on LTCG stacked on top of ordinary taxable income. */
export function ltcgTax(ordinaryTaxable: number, gains: number, brackets: Bracket[], index = 1): number {
  if (gains <= 0) return 0;
  let tax = 0;
  let start = Math.max(0, ordinaryTaxable);
  let remaining = gains;
  for (const [upTo, rate] of brackets) {
    const cap = upTo * index;
    if (start >= cap) continue;
    const room = cap - start;
    const taxed = Math.min(room, remaining);
    tax += taxed * rate;
    remaining -= taxed;
    start += taxed;
    if (remaining <= 0) break;
  }
  return tax;
}

/** Portion of Social Security benefits subject to federal income tax (up to 85%). */
export function taxableSocialSecurity(ssBenefits: number, otherIncome: number, married: boolean): number {
  if (ssBenefits <= 0) return 0;
  const [base1, base2] = married ? [32_000, 44_000] : [25_000, 34_000];
  const provisional = otherIncome + ssBenefits / 2;
  if (provisional <= base1) return 0;
  if (provisional <= base2) return Math.min(0.5 * (provisional - base1), 0.5 * ssBenefits);
  const amt = 0.85 * (provisional - base2) + Math.min(0.5 * (base2 - base1), 0.5 * ssBenefits);
  return Math.min(amt, 0.85 * ssBenefits);
}

export interface TaxInput {
  married: boolean;
  /** Wages per earner (FICA is per person). */
  wages: number[];
  /** Pre-tax payroll deductions: traditional 401k/403b employee deferrals. */
  pretaxRetirement: number;
  /** HSA contributions via payroll (federal-deductible, NOT deductible in CA). */
  hsaContrib: number;
  /** Traditional IRA/401k withdrawals and other ordinary income. */
  ordinaryOther: number;
  /** Ordinary income that CA does not tax (none by default; SS is handled separately). */
  socialSecurity: number;
  longTermGains: number;
  /** Number of filers age 65+ (for extra standard deduction). */
  seniors: number;
  /** Bracket inflation index relative to the tax year (1 = today). */
  index?: number;
  /** Calendar year (the federal SALT cap changes by year). Defaults to TAX_YEAR. */
  year?: number;
  /** Property tax paid on your homes (deductible if you itemize). */
  propertyTax?: number;
  /** Mortgage interest paid, and the average mortgage balance (for the loan-size limits). */
  mortgageInterest?: number;
  mortgageBalance?: number;
}

/**
 * Federal SALT deduction cap (OBBBA): $40,000 in 2025 rising 1%/yr through 2029, then back to
 * $10,000. It shrinks by 30% of MAGI above $500,000 (also +1%/yr), but never below $10,000.
 */
export function saltCap(year: number, magi: number): number {
  if (year >= 2030) return 10_000;
  const steps = Math.max(0, Math.min(year, 2029) - 2025);
  const cap = 40_000 * Math.pow(1.01, steps);
  const threshold = 500_000 * Math.pow(1.01, steps);
  return Math.max(10_000, cap - 0.3 * Math.max(0, magi - threshold));
}

/** Mortgage interest on loan balances above these limits isn't deductible. */
export const MORTGAGE_LIMIT = { federal: 750_000, ca: 1_000_000 };

export interface TaxResult {
  federal: number;
  federalOrdinary: number;
  federalLtcg: number;
  state: number;
  socialSecurityTax: number;
  medicare: number;
  sdi: number;
  total: number;
  agi: number;
  federalTaxable: number;
  stateTaxable: number;
  taxableSS: number;
  marginalFederal: number;
  marginalState: number;
  effectiveRate: number;
  /** Deduction actually used, and whether itemizing beat the standard deduction. */
  federalDeduction: number;
  federalItemized: boolean;
  stateDeduction: number;
  stateItemized: boolean;
  saltDeducted: number;
}

export function computeTaxes(input: TaxInput): TaxResult {
  const idx = input.index ?? 1;
  const fs = input.married ? 'mfj' : 'single';
  const fedBr = input.married ? FED_BRACKETS_MFJ : FED_BRACKETS_SINGLE;
  const ltBr = input.married ? LTCG_BRACKETS_MFJ : LTCG_BRACKETS_SINGLE;
  const caBr = input.married ? CA_BRACKETS_MFJ : CA_BRACKETS_SINGLE;

  const totalWages = input.wages.reduce((a, b) => a + b, 0);
  const fedWages = Math.max(0, totalWages - input.pretaxRetirement - input.hsaContrib);
  const nonSSIncome = fedWages + input.ordinaryOther + input.longTermGains;
  const taxableSS = taxableSocialSecurity(input.socialSecurity, nonSSIncome, input.married);

  const agi = fedWages + input.ordinaryOther + taxableSS + input.longTermGains;

  // Itemized deductions: property tax and mortgage interest (interest only on the part of
  // the loan under the limit). California taxes first, since state tax is itself deductible.
  const propertyTax = input.propertyTax ?? 0;
  const interest = input.mortgageInterest ?? 0;
  const balance = input.mortgageBalance ?? 0;
  const interestShare = (limit: number) => (balance > limit ? limit / balance : 1);

  // California: HSA not deductible, SS exempt, capital gains taxed as ordinary income.
  // Itemizing in CA allows property tax (no cap) and mortgage interest (up to $1M of debt),
  // but not state income tax.
  const caWages = Math.max(0, totalWages - input.pretaxRetirement);
  const caItemized = propertyTax + interest * interestShare(MORTGAGE_LIMIT.ca);
  const caStandard = CA_STD_DEDUCTION[fs] * idx;
  const stateDeduction = Math.max(caStandard, caItemized);
  const stateTaxable = Math.max(0, caWages + input.ordinaryOther + input.longTermGains - stateDeduction);
  let state = bracketTax(stateTaxable, caBr, idx);
  if (stateTaxable > CA_MHST_THRESHOLD) state += (stateTaxable - CA_MHST_THRESHOLD) * 0.01;
  state = Math.max(0, state - CA_EXEMPTION_CREDIT[fs] * idx);

  // Federal: SALT (state income tax + property tax, capped) + mortgage interest (up to $750K of debt).
  const year = input.year ?? TAX_YEAR;
  const saltDeducted = Math.min(state + propertyTax, saltCap(year, agi));
  const fedItemized = saltDeducted + interest * interestShare(MORTGAGE_LIMIT.federal);
  const fedStandard = (FED_STD_DEDUCTION[fs] + FED_STD_65_ADDON[fs] * input.seniors) * idx;
  const fedDeduction = Math.max(fedStandard, fedItemized);
  const ordinaryTaxable = Math.max(0, fedWages + input.ordinaryOther + taxableSS - fedDeduction);
  // Deduction leftover shelters gains first.
  const leftoverDeduction = Math.max(0, fedDeduction - (fedWages + input.ordinaryOther + taxableSS));
  const gainsTaxable = Math.max(0, input.longTermGains - leftoverDeduction);
  const federalOrdinary = bracketTax(ordinaryTaxable, fedBr, idx);
  const federalLtcg = ltcgTax(ordinaryTaxable, gainsTaxable, ltBr, idx);

  // Payroll taxes, per earner.
  let socialSecurityTax = 0;
  let sdi = 0;
  for (const w of input.wages) {
    socialSecurityTax += Math.min(w, SS_WAGE_BASE * idx) * SS_RATE;
    sdi += w * CA_SDI_RATE;
  }
  const medicare =
    totalWages * MEDICARE_RATE +
    Math.max(0, totalWages - ADDL_MEDICARE_THRESHOLD[fs]) * ADDL_MEDICARE_RATE;

  const federal = federalOrdinary + federalLtcg;
  const total = federal + state + socialSecurityTax + medicare + sdi;
  const grossIncome = totalWages + input.ordinaryOther + input.socialSecurity + input.longTermGains;
  return {
    federal,
    federalOrdinary,
    federalLtcg,
    state,
    socialSecurityTax,
    medicare,
    sdi,
    total,
    agi,
    federalTaxable: ordinaryTaxable + gainsTaxable,
    stateTaxable,
    taxableSS,
    marginalFederal: marginalRate(ordinaryTaxable, fedBr, idx),
    marginalState: marginalRate(stateTaxable, caBr, idx) + (stateTaxable > CA_MHST_THRESHOLD ? 0.01 : 0),
    effectiveRate: grossIncome > 0 ? total / grossIncome : 0,
    federalDeduction: fedDeduction,
    federalItemized: fedItemized > fedStandard,
    stateDeduction,
    stateItemized: caItemized > caStandard,
    saltDeducted,
  };
}


// ---------------------------------------------------------------------------
// California property tax (Prop 13)
// ---------------------------------------------------------------------------

/** Prop 13 caps assessed-value growth at 2%/yr (less if California CPI is lower). */
export const PROP13_MAX_GROWTH = 0.02;
export const CA_HOMEOWNERS_EXEMPTION = 7_000;
/** San Francisco's combined ad valorem rate (1% base + voter-approved bonds), FY 2025-26. */
export const SF_PROPERTY_TAX_RATE = 1.18;

/**
 * Property tax for year `k` of the projection.
 * `assessed0` is today's assessed value; `marketValue` is the home's value that year.
 */
export function propertyTaxFor(
  info: { rate: number; fixedCharges: number; homeownersExemption: boolean },
  assessed0: number,
  k: number,
  marketValue: number,
  inflationIndex: number,
): { tax: number; assessed: number } {
  const assessed = Math.min(assessed0 * Math.pow(1 + PROP13_MAX_GROWTH, k), marketValue);
  const taxable = Math.max(0, assessed - (info.homeownersExemption ? CA_HOMEOWNERS_EXEMPTION : 0));
  return { tax: taxable * (info.rate / 100) + info.fixedCharges * inflationIndex, assessed };
}
