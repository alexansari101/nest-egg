import type { Account, Debt, Plan, Snapshot } from './types';

export const todayISO = () => new Date().toISOString().slice(0, 10);

export function sortedHistory(h: Snapshot[]): Snapshot[] {
  return [...h].sort((a, b) => a.date.localeCompare(b.date));
}

export function latestValue(h: Snapshot[]): number {
  if (!h.length) return 0;
  return sortedHistory(h).at(-1)!.value;
}

export function latestDate(h: Snapshot[]): string | null {
  if (!h.length) return null;
  return sortedHistory(h).at(-1)!.date;
}

/** Value as of a date: the most recent snapshot on or before it (carry-forward). */
export function valueAt(h: Snapshot[], date: string): number | null {
  let best: Snapshot | null = null;
  for (const s of h) if (s.date <= date && (!best || s.date > best.date)) best = s;
  return best ? best.value : null;
}

/** Insert or replace the snapshot for a date. */
export function upsertSnapshot(h: Snapshot[], date: string, value: number): Snapshot[] {
  const rest = h.filter((s) => s.date !== date);
  return sortedHistory([...rest, { date, value }]);
}

export interface NetWorthPoint {
  date: string;
  t: number; // epoch ms
  assets: number;
  debts: number;
  netWorth: number;
  byAccount: Record<string, number>;
  byDebt: Record<string, number>;
}

/** Builds a net-worth time series across every date on which anything was recorded. */
export function netWorthHistory(plan: Pick<Plan, 'accounts' | 'debts'>): NetWorthPoint[] {
  const dates = new Set<string>();
  plan.accounts.forEach((a) => a.history.forEach((s) => dates.add(s.date)));
  plan.debts.forEach((d) => d.history.forEach((s) => dates.add(s.date)));
  return [...dates].sort().map((date) => {
    const byAccount: Record<string, number> = {};
    const byDebt: Record<string, number> = {};
    let assets = 0;
    let debts = 0;
    for (const a of plan.accounts) {
      const v = valueAt(a.history, date);
      if (v != null) {
        byAccount[a.id] = v;
        assets += v;
      }
    }
    for (const d of plan.debts) {
      const v = valueAt(d.history, date);
      if (v != null) {
        byDebt[d.id] = v;
        debts += v;
      }
    }
    return { date, t: Date.parse(date), assets, debts, netWorth: assets - debts, byAccount, byDebt };
  });
}

export function currentTotals(plan: Pick<Plan, 'accounts' | 'debts'>) {
  const assets = plan.accounts.reduce((s, a) => s + latestValue(a.history), 0);
  const liquid = plan.accounts
    .filter((a) => a.spendable)
    .reduce((s, a) => s + latestValue(a.history), 0);
  const debts = plan.debts.reduce((s, d) => s + latestValue(d.history), 0);
  return { assets, liquid, debts, netWorth: assets - debts };
}

/** Simple change between the two most recent recorded dates for any item. */
export function lastChange(item: Account | Debt): { delta: number; from: string } | null {
  const h = sortedHistory(item.history);
  if (h.length < 2) return null;
  return { delta: h.at(-1)!.value - h.at(-2)!.value, from: h.at(-2)!.date };
}

/**
 * Annualized growth between first and last snapshot. This ignores contributions,
 * so it overstates investment return for accounts you are actively funding.
 */
export function annualizedGrowth(h: Snapshot[]): number | null {
  const s = sortedHistory(h);
  if (s.length < 2) return null;
  const first = s[0];
  const last = s.at(-1)!;
  const years = (Date.parse(last.date) - Date.parse(first.date)) / (365.25 * 864e5);
  if (years < 0.25 || first.value <= 0 || last.value <= 0) return null;
  return Math.pow(last.value / first.value, 1 / years) - 1;
}
