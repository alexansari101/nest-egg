import type { Plan } from './engine/types';
import { earliestRetirement, runMonteCarlo, sustainableSpending } from './engine/montecarlo';

export type SimRequest = { id: number; plan: Plan; kind: 'mc' | 'search' };

self.onmessage = (e: MessageEvent<SimRequest>) => {
  const { id, plan, kind } = e.data;
  if (kind === 'mc') {
    const mc = runMonteCarlo(plan);
    (self as unknown as Worker).postMessage({ id, kind, mc });
  } else {
    const spending = sustainableSpending(plan);
    const earliest = earliestRetirement(plan);
    (self as unknown as Worker).postMessage({ id, kind, spending, earliest });
  }
};
