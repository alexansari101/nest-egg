// Key dates on the household timeline. Every milestone belongs to a person and is computed
// from that person's own birth year, then placed on the timeline by calendar year, with
// your age alongside it.

import type { Plan } from './types';
import type { ProjectionResult } from './projection';
import { rmdStartAge } from './projection';
import { benefitAtClaim } from './socialSecurity';
import { MEDICARE_AGE } from './healthcare';

export type MilestoneKind = 'debt' | 'retire' | 'ss' | 'medicare' | 'irmaa' | 'ltc' | 'rmd' | 'event' | 'depletion';

export interface Milestone {
  year: number;
  /** Your age that year. */
  age: number;
  kind: MilestoneKind;
  who: 'self' | 'spouse' | 'household';
  label: string;
  /** The owner's age, when it isn't you (e.g. "Spouse retires at 57"). */
  ownerAge?: number;
  amount?: number;
}

export function buildMilestones(plan: Plan, pr: ProjectionResult): Milestone[] {
  const selfBY = plan.self.birthYear;
  const spouseBY = plan.spouse.birthYear;
  const out: Milestone[] = [];
  const add = (who: Milestone['who'], ownerAge: number, kind: MilestoneKind, label: string, amount?: number) => {
    const year = (who === 'spouse' ? spouseBY : selfBY) + ownerAge;
    out.push({ year, age: year - selfBY, kind, who, label, ownerAge: who === 'spouse' ? ownerAge : undefined, amount });
  };
  const spouseName = plan.spouse.name && plan.spouse.name !== 'Spouse' ? plan.spouse.name : 'Spouse';
  const people: ('self' | 'spouse')[] = plan.married ? ['self', 'spouse'] : ['self'];
  const allAccounts = [...plan.accounts, ...pr.syntheticAccounts];

  for (const d of plan.debts) {
    const a = pr.debtPayoffAge[d.id];
    if (a != null && a > pr.currentAge) add('self', a, 'debt', `${d.name} paid off`);
  }
  // Last year anyone has a paycheck with employer health coverage.
  const coverageEndYear = Math.max(0, ...people.filter((w) => plan[w].income > 0).map((w) => plan[w].birthYear + plan[w].retirementAge));
  for (const who of people) {
    const p = plan[who];
    const name = who === 'self' ? 'You' : spouseName;
    add(who, p.retirementAge, 'retire', who === 'self' ? 'You retire' : `${name} retires`);
    if (benefitAtClaim(plan, who).monthly > 0)
      add(who, p.ssClaimAge, 'ss', who === 'self' ? 'Your Social Security begins' : `${name}'s Social Security begins`);
    // Medicare starts at 65, or later if a working spouse's employer plan still covers you.
    const medicareAge = Math.max(MEDICARE_AGE, coverageEndYear - p.birthYear);
    add(who, medicareAge, 'medicare', who === 'self' ? 'Your Medicare begins' : `${name}'s Medicare begins`);
    const hasPretax = allAccounts.some((a) => a.type === 'traditional' && (who === 'spouse' ? a.owner === 'spouse' : a.owner !== 'spouse' || !plan.married));
    if (hasPretax) {
      add(who, rmdStartAge(p.birthYear), 'rmd', who === 'self' ? 'Your required minimum distributions start' : `${name}'s required minimum distributions start`);
    }
  }

  const firstIrmaa = pr.rows.find((r) => r.irmaa > 0);
  if (firstIrmaa) add('household', firstIrmaa.age, 'irmaa', 'Medicare income surcharges (IRMAA) begin');
  if (plan.healthcare.ltc.enabled) add('household', plan.healthcare.ltc.startAge, 'ltc', 'Long-term care stress test begins');
  for (const e of plan.events) add('household', e.age, 'event', e.name, e.amount);
  if (pr.depletionAge != null) add('household', pr.depletionAge, 'depletion', 'Spendable savings run out (typical returns)');

  return out
    .filter((m) => m.age >= pr.currentAge && m.age <= plan.lifeExpectancy)
    .sort((a, b) => a.year - b.year || order(a.kind) - order(b.kind));
}

const ORDER: MilestoneKind[] = ['retire', 'debt', 'event', 'ss', 'medicare', 'irmaa', 'rmd', 'ltc', 'depletion'];
const order = (k: MilestoneKind) => ORDER.indexOf(k);
