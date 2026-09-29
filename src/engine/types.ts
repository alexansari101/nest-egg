// Core data model. Everything the user enters lives in a single `Plan` object,
// which is what gets saved to localStorage and exported to JSON.

export type AccountType =
  | 'cash'
  | 'taxable'
  | 'traditional'
  | 'roth'
  | 'hsa'
  | 'property'
  | 'other';

export type Owner = 'self' | 'spouse' | 'joint';

/**
 * What an investment account holds: stock % (S&P 500, remainder US Treasuries),
 * 'auto' for a target-date glide path, or 'custom' to use returnRate/volatility.
 */
export type Allocation = number | 'auto' | 'custom';

export interface Snapshot {
  date: string; // ISO yyyy-mm-dd
  value: number;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  owner: Owner;
  /** Investment mix. Returns come from Assumptions unless 'custom'. */
  allocation: Allocation;
  /** Custom expected nominal annual return, percent (used when allocation is 'custom', and for property/other). */
  returnRate: number;
  /** Custom annual standard deviation of returns, percent. Used by Monte Carlo. */
  volatility: number;
  /** Your own annual contribution in today's dollars (grows with income). */
  contribution: number;
  /** Employer contribution / match in today's dollars per year. */
  employerContribution: number;
  /** Taxable accounts only: portion of the balance that is cost basis, percent. */
  costBasisPct: number;
  /** Whether the account can be drawn down to fund retirement spending. */
  spendable: boolean;
  history: Snapshot[];
  notes?: string;
  /** Created by the projection to hold leftover income when you have no such account. */
  synthetic?: boolean;
  /** Real estate only: California property tax (Prop 13). */
  propertyTax?: PropertyTaxInfo;
}

export interface PropertyTaxInfo {
  /** Assessed value on your tax bill (today). Grows 2%/yr under Prop 13, never above market value. */
  assessedValue: number | null;
  /** Ad valorem rate, % (San Francisco ~1.18%). */
  rate: number;
  /** Parcel taxes and direct assessments, $/yr (grow with inflation). */
  fixedCharges: number;
  /** Primary residence: $7,000 off assessed value. */
  homeownersExemption: boolean;
  /** Maintenance and repairs, % of market value per year (not a tax, but a cost of owning). */
  upkeepPct: number;
}

export type DebtType = 'mortgage' | 'heloc' | 'auto' | 'student' | 'credit' | 'personal' | 'other';

export interface Debt {
  id: string;
  name: string;
  type: DebtType;
  /** Annual interest rate, percent (APR). */
  rate: number;
  /** Required monthly payment (principal + interest). */
  monthlyPayment: number;
  /** Optional extra principal each month. */
  extraPayment: number;
  history: Snapshot[];
  notes?: string;
}

export interface Person {
  name: string;
  birthYear: number;
  retirementAge: number;
  /** Gross annual W-2 / self-employment income. */
  income: number;
  /** Compute the benefit from income and career length (true) or use ssBenefitFRA as entered. */
  ssEstimate: boolean;
  /** Monthly Social Security benefit at full retirement age (67) from your ssa.gov statement, today's $. */
  ssBenefitFRA: number;
  ssClaimAge: number;
}

export interface IncomeStream {
  id: string;
  name: string;
  /** Annual amount, today's dollars. */
  amount: number;
  /** Your age when it starts / stops (inclusive start, exclusive end). */
  startAge: number;
  endAge: number;
  taxable: boolean;
  inflationAdjusted: boolean;
}

export interface LifeEvent {
  id: string;
  name: string;
  /** Your age when it happens. */
  age: number;
  /** Positive = money in (inheritance, home sale). Negative = money out. Today's $. */
  amount: number;
}

export interface LongTermCare {
  enabled: boolean;
  /** Your age when care starts. */
  startAge: number;
  /** Years of care per person. */
  years: number;
  /** Annual cost of care, today's $. */
  annualCost: number;
  /** 1 = one of you needs care; 2 = both, back to back. */
  people: 1 | 2;
}

/** Healthcare costs, per person, today's $. Rise at inflation + the healthcare premium. */
export interface HealthcarePlan {
  /** Premiums + out-of-pocket before 65 once no one in the household has employer coverage. */
  pre65PerPerson: number;
  /** Medicare Part B + Part D + Medigap + out-of-pocket from 65, excluding IRMAA. */
  medicarePerPerson: number;
  /** Add Medicare income surcharges (IRMAA) based on income two years earlier. */
  includeIRMAA: boolean;
  ltc: LongTermCare;
}

export interface Assumptions {
  /** S&P 500 expected nominal return and volatility, %. */
  stockReturn: number;
  stockVolatility: number;
  /** Intermediate US Treasuries expected nominal return and volatility, %. */
  bondReturn: number;
  bondVolatility: number;
  /** High-yield savings / T-bill yield, %. */
  cashReturn: number;
  inflation: number; // %
  incomeGrowth: number; // % nominal raise per year
  /** Applied to custom-return accounts after the owner retires, %-points. */
  retirementReturnShift: number;
  /** Global stress test shift applied to all non-cash, non-property returns, %-points. */
  returnShift: number;
  /** Healthcare costs rise this many %-points faster than general inflation. */
  healthcareInflationExtra: number;
  /** Percentage of leftover annual cash flow (income beyond spending, taxes, debts) that gets invested. */
  surplusSavePct: number;
  /** Leftover cash first tops up 401(k)s to the IRS limit… */
  surplusTo401k: boolean;
  /** …then the HSA to its limit (requires a high-deductible health plan)… */
  surplusToHSA: boolean;
  /** …and the remainder goes here (null = your first brokerage account). */
  surplusAccountId: string | null;
  /** Success threshold used for "earliest retirement" and "sustainable spending" searches. */
  targetSuccess: number; // %
  simulations: number;
  /** Safe withdrawal rate for the simple rule-of-thumb readout. */
  withdrawalRate: number; // %
}

export interface Plan {
  version: 1;
  married: boolean;
  location: string;
  self: Person;
  spouse: Person;
  /** Plan runs until you reach this age. */
  lifeExpectancy: number;
  /** Current annual living expenses, excluding taxes, savings and debt payments. */
  annualSpending: number;
  /** Desired annual retirement spending in today's $, excluding debt payments. */
  retirementSpending: number;
  healthcare: HealthcarePlan;
  assumptions: Assumptions;
  accounts: Account[];
  debts: Debt[];
  incomeStreams: IncomeStream[];
  events: LifeEvent[];
  updatedAt: string;
}

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  cash: 'Cash & savings',
  taxable: 'Brokerage (taxable)',
  traditional: 'Pre-tax (401k / IRA)',
  roth: 'Roth (401k / IRA)',
  hsa: 'HSA',
  property: 'Real estate',
  other: 'Other assets',
};

export const ACCOUNT_TYPE_SHORT: Record<AccountType, string> = {
  cash: 'Cash',
  taxable: 'Taxable',
  traditional: 'Pre-tax',
  roth: 'Roth',
  hsa: 'HSA',
  property: 'Real estate',
  other: 'Other',
};

export const DEBT_TYPE_LABEL: Record<DebtType, string> = {
  mortgage: 'Mortgage',
  heloc: 'HELOC',
  auto: 'Auto loan',
  student: 'Student loan',
  credit: 'Credit card',
  personal: 'Personal loan',
  other: 'Other debt',
};

/** Fixed order — also the categorical color slot order for charts. */
export const ACCOUNT_TYPES: AccountType[] = [
  'traditional',
  'taxable',
  'roth',
  'hsa',
  'cash',
  'property',
  'other',
];
