import type { Debt } from './types';
import { latestValue } from './history';

export interface AmortizationRow {
  month: number;
  balance: number;
  interest: number;
  principal: number;
}

export interface DebtSchedule {
  rows: AmortizationRow[]; // one per month until paid off (or cap)
  months: number | null; // null = never pays off at this payment
  totalInterest: number;
  totalPaid: number;
}

const MAX_MONTHS = 12 * 60;

/** Month-by-month amortization starting from a balance. */
export function amortize(
  balance: number,
  aprPct: number,
  monthlyPayment: number,
  extra = 0,
): DebtSchedule {
  const r = aprPct / 100 / 12;
  const rows: AmortizationRow[] = [];
  let b = balance;
  let totalInterest = 0;
  let totalPaid = 0;
  const pay = monthlyPayment + extra;
  for (let m = 1; m <= MAX_MONTHS && b > 0.005; m++) {
    const interest = b * r;
    const payment = Math.min(pay, b + interest);
    const principal = payment - interest;
    if (principal <= 0 && m > 1) {
      // Payment doesn't cover interest: never pays off.
      return { rows, months: null, totalInterest, totalPaid };
    }
    b = Math.max(0, b - principal);
    totalInterest += interest;
    totalPaid += payment;
    rows.push({ month: m, balance: b, interest, principal });
  }
  return { rows, months: b <= 0.005 ? rows.length : null, totalInterest, totalPaid };
}

export function debtSchedule(d: Debt, extraOverride?: number): DebtSchedule {
  return amortize(latestValue(d.history), d.rate, d.monthlyPayment, extraOverride ?? d.extraPayment);
}

/** Standard payment for a fixed-rate loan. */
export function paymentFor(principal: number, aprPct: number, months: number): number {
  const r = aprPct / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

/** Advance a debt by 12 months; returns ending balance, interest and total paid. */
export function stepDebtYear(balance: number, aprPct: number, monthly: number) {
  const r = aprPct / 100 / 12;
  let b = balance;
  let interest = 0;
  let paid = 0;
  for (let m = 0; m < 12 && b > 0.005; m++) {
    const i = b * r;
    const p = Math.min(monthly, b + i);
    b = b + i - p;
    interest += i;
    paid += p;
  }
  return { balance: Math.max(0, b), interest, paid };
}
