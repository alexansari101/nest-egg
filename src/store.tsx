import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Plan } from './engine/types';
import { defaultAssumptions, defaultPropertyTax, emptyPlan, newAccount, newDebt, samplePlan } from './engine/defaults';
import { defaultHealthcare } from './engine/healthcare';

const KEY = 'nestegg.plan.v1';
const SAMPLE_KEY = 'nestegg.isSample';

/** Fill in any fields missing from older / hand-edited files so the app never crashes on load. */
export function normalizePlan(raw: unknown): Plan {
  if (!raw || typeof raw !== 'object') throw new Error('File does not contain a plan.');
  const r = raw as Partial<Plan>;
  if (!Array.isArray(r.accounts) || !Array.isArray(r.debts)) throw new Error('Missing accounts or debts — is this a Nestegg file?');
  const base = emptyPlan();
  return {
    ...base,
    ...r,
    version: 1,
    // Older files had only an entered benefit: keep it if present, otherwise estimate.
    self: { ...base.self, ...r.self, ssEstimate: r.self?.ssEstimate ?? !((r.self?.ssBenefitFRA ?? 0) > 0) },
    spouse: { ...base.spouse, ...r.spouse, ssEstimate: r.spouse?.ssEstimate ?? !((r.spouse?.ssBenefitFRA ?? 0) > 0) },
    assumptions: {
      ...defaultAssumptions(),
      ...r.assumptions,
      // Files from before the savings waterfall defaulted to discarding leftover income; invest it now.
      ...(r.assumptions && r.assumptions.surplusTo401k === undefined ? { surplusSavePct: 100 } : {}),
    },
    // Files saved before allocations existed keep their explicit returns ('custom').
    accounts: r.accounts.map((a) => ({
      ...newAccount(a.type ?? 'other'),
      ...a,
      allocation: a.allocation ?? 'custom',
      history: a.history ?? [],
      ...(a.type === 'property' ? { propertyTax: { ...defaultPropertyTax(), ...a.propertyTax } } : {}),
    })),
    debts: r.debts.map((d) => ({ ...newDebt(d.type ?? 'other'), ...d, history: d.history ?? [] })),
    healthcare: migrateHealthcare(r),
    incomeStreams: r.incomeStreams ?? [],
    events: r.events ?? [],
  };
}

/** Older files had one household pre-65 healthcare number; split it per person. */
function migrateHealthcare(r: Partial<Plan> & { healthcarePre65?: number }): Plan['healthcare'] {
  const d = defaultHealthcare();
  const old = r.healthcarePre65;
  const perPerson = old != null && !r.healthcare ? Math.round(old / (r.married === false ? 1 : 2)) : undefined;
  return {
    ...d,
    ...(perPerson != null ? { pre65PerPerson: perPerson } : {}),
    ...r.healthcare,
    ltc: { ...d.ltc, ...r.healthcare?.ltc },
  };
}

function loadInitial(): { plan: Plan; isSample: boolean } {
  try {
    const s = localStorage.getItem(KEY);
    if (s) return { plan: normalizePlan(JSON.parse(s)), isSample: localStorage.getItem(SAMPLE_KEY) === '1' };
  } catch {
    /* fall through to sample */
  }
  return { plan: samplePlan(), isSample: true };
}

type FileHandle = { name: string; createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> };
type FSWindow = Window & {
  showSaveFilePicker?: (o: unknown) => Promise<FileHandle>;
  showOpenFilePicker?: (o: unknown) => Promise<{ getFile: () => Promise<File> }[] & FileHandle[]>;
};

interface Store {
  plan: Plan;
  update: (fn: (p: Plan) => Plan) => void;
  replace: (p: Plan, isSample?: boolean) => void;
  isSample: boolean;
  savedAt: Date | null;
  fileName: string | null;
  saveToFile: (saveAs?: boolean) => Promise<void>;
  openFile: () => Promise<void>;
  importText: (text: string) => void;
  resetSample: () => void;
  startFresh: () => void;
  toast: string | null;
  notify: (msg: string) => void;
}

const Ctx = createContext<Store | null>(null);
const pickerOpts = { types: [{ description: 'Nestegg plan', accept: { 'application/json': ['.json'] } }] };

export function PlanProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(loadInitial, []);
  const [plan, setPlan] = useState<Plan>(initial.plan);
  const [isSample, setIsSample] = useState(initial.isSample);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const handle = useRef<FileHandle | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  // Autosave to this browser.
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(plan));
        localStorage.setItem(SAMPLE_KEY, isSample ? '1' : '0');
        setSavedAt(new Date());
      } catch {
        /* storage unavailable */
      }
    }, 300);
    return () => window.clearTimeout(id);
  }, [plan, isSample]);

  const update = useCallback((fn: (p: Plan) => Plan) => {
    setPlan((p) => ({ ...fn(p), updatedAt: new Date().toISOString() }));
  }, []);

  const replace = useCallback((p: Plan, sample = false) => {
    setPlan(p);
    setIsSample(sample);
  }, []);

  const saveToFile = useCallback(async (saveAs = false) => {
    const text = JSON.stringify(plan, null, 2);
    const w = window as FSWindow;
    const suggested = `nestegg-plan-${new Date().toISOString().slice(0, 10)}.json`;
    if (w.showSaveFilePicker) {
      try {
        if (!handle.current || saveAs) handle.current = await w.showSaveFilePicker({ ...pickerOpts, suggestedName: suggested });
        const ws = await handle.current.createWritable();
        await ws.write(text);
        await ws.close();
        setFileName(handle.current.name);
        notify(`Saved to ${handle.current.name}`);
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        handle.current = null;
      }
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = suggested;
    a.click();
    URL.revokeObjectURL(url);
    notify('Plan downloaded');
  }, [plan, notify]);

  const importText = useCallback((text: string) => {
    const p = normalizePlan(JSON.parse(text));
    setPlan(p);
    setIsSample(false);
  }, []);

  const openFile = useCallback(async () => {
    const w = window as FSWindow;
    const fromFile = async (file: File) => {
      try {
        importText(await file.text());
        setFileName(file.name);
        notify(`Loaded ${file.name}`);
      } catch (e) {
        notify(`Could not load: ${(e as Error).message}`);
      }
    };
    if (w.showOpenFilePicker) {
      try {
        const [h] = await w.showOpenFilePicker(pickerOpts);
        handle.current = h as unknown as FileHandle;
        await fromFile(await h.getFile());
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => input.files?.[0] && fromFile(input.files[0]);
    input.click();
  }, [importText, notify]);

  const resetSample = useCallback(() => {
    handle.current = null;
    setFileName(null);
    replace(samplePlan(), true);
    notify('Loaded sample household');
  }, [replace, notify]);

  const startFresh = useCallback(() => {
    handle.current = null;
    setFileName(null);
    replace(emptyPlan(), false);
    notify('Started a blank plan');
  }, [replace, notify]);

  const value: Store = {
    plan, update, replace, isSample, savedAt, fileName,
    saveToFile, openFile, importText, resetSample, startFresh, toast, notify,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlan(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('usePlan outside provider');
  return s;
}
