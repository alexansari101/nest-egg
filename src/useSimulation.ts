import { useEffect, useMemo, useRef, useState } from 'react';
import type { Plan } from './engine/types';
import type { MonteCarloResult } from './engine/montecarlo';
import { runProjection } from './engine/projection';

export interface SimState {
  mc: MonteCarloResult | null;
  mcPending: boolean;
  spending: number | null;
  earliest: number | null;
  searchPending: boolean;
}

/**
 * Deterministic projection runs synchronously (it's ~1ms). Monte Carlo and the
 * "what can I afford" searches run in two web workers, debounced, so typing stays smooth.
 */
export function useSimulation(plan: Plan) {
  const projection = useMemo(() => runProjection(plan), [plan]);
  const [state, setState] = useState<SimState>({ mc: null, mcPending: true, spending: null, earliest: null, searchPending: true });
  const mcWorker = useRef<Worker | null>(null);
  const searchWorker = useRef<Worker | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    mcWorker.current = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    mcWorker.current.onmessage = (e) => {
      if (e.data.id !== seq.current) return;
      setState((s) => ({ ...s, mc: e.data.mc, mcPending: false }));
    };
    return () => mcWorker.current?.terminate();
  }, []);

  const startSearchWorker = () => {
    searchWorker.current?.terminate();
    const w = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      if (e.data.id !== seq.current) return;
      setState((s) => ({ ...s, spending: e.data.spending, earliest: e.data.earliest, searchPending: false }));
    };
    searchWorker.current = w;
    return w;
  };

  useEffect(() => () => searchWorker.current?.terminate(), []);

  useEffect(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, mcPending: true, searchPending: true }));
    const t1 = window.setTimeout(() => mcWorker.current?.postMessage({ id, plan, kind: 'mc' }), 200);
    // Searches are heavier; restart the worker so stale searches don't queue up.
    const t2 = window.setTimeout(() => startSearchWorker().postMessage({ id, plan, kind: 'search' }), 600);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [plan]);

  return { projection, ...state };
}
