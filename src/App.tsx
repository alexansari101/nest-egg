import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  LayoutDashboard, Wallet, Landmark, SlidersHorizontal, LineChart, History, Receipt,
  Save, FolderOpen, RefreshCw, Sun, Moon, Monitor, MoreHorizontal, FilePlus2, Sparkles, Download,
} from 'lucide-react';
import { PlanProvider, usePlan } from './store';
import { useThemePref, type ChartTheme, type ThemePref } from './theme';
import { useSimulation } from './useSimulation';
import { Button } from './components/ui';
import { UpdateBalancesModal } from './components/UpdateBalances';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Debts from './pages/Debts';
import PlanPage from './pages/PlanPage';
import Projections from './pages/Projections';
import HistoryPage from './pages/HistoryPage';
import Taxes from './pages/Taxes';

type Route = 'dashboard' | 'accounts' | 'debts' | 'plan' | 'projections' | 'history' | 'taxes';

const NAV: { id: Route; label: string; icon: ReactNode }[] = [
  { id: 'dashboard', label: 'Overview', icon: <LayoutDashboard size={18} /> },
  { id: 'projections', label: 'Projections', icon: <LineChart size={18} /> },
  { id: 'accounts', label: 'Accounts', icon: <Wallet size={18} /> },
  { id: 'debts', label: 'Debts', icon: <Landmark size={18} /> },
  { id: 'history', label: 'History', icon: <History size={18} /> },
  { id: 'plan', label: 'Plan & assumptions', icon: <SlidersHorizontal size={18} /> },
  { id: 'taxes', label: 'Taxes', icon: <Receipt size={18} /> },
];

interface AppCtx {
  sim: ReturnType<typeof useSimulation>;
  chart: ChartTheme;
  real: boolean;
  setReal: (b: boolean) => void;
  go: (r: Route) => void;
  openUpdate: () => void;
}
const Ctx = createContext<AppCtx | null>(null);
export const useApp = () => useContext(Ctx)!;

function useRoute(): [Route, (r: Route) => void] {
  const read = () => (location.hash.replace('#/', '') as Route) || 'dashboard';
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (r: Route) => {
    location.hash = `#/${r}`;
    window.scrollTo({ top: 0 });
  };
  return [NAV.some((n) => n.id === route) ? route : 'dashboard', go];
}

function ThemeSwitch({ pref, setPref }: { pref: ThemePref; setPref: (p: ThemePref) => void }) {
  const opts: { v: ThemePref; icon: ReactNode; label: string }[] = [
    { v: 'light', icon: <Sun size={15} />, label: 'Light' },
    { v: 'system', icon: <Monitor size={15} />, label: 'System' },
    { v: 'dark', icon: <Moon size={15} />, label: 'Dark' },
  ];
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Theme">
      {opts.map((o) => (
        <button key={o.v} role="radio" aria-checked={pref === o.v} title={o.label} className={pref === o.v ? 'active' : ''} onClick={() => setPref(o.v)}>
          {o.icon}
        </button>
      ))}
    </div>
  );
}

function MoreMenu() {
  const { saveToFile, resetSample, startFresh } = usePlan();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | 'sample' | 'fresh'>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !(e.target as HTMLElement).closest('.menu-wrap') && (setOpen(false), setConfirm(null));
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="menu-wrap">
      <Button variant="ghost" icon={<MoreHorizontal size={18} />} title="More" onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" onClick={() => { saveToFile(true); setOpen(false); }}><Download size={16} /> Save as new file…</button>
          <hr />
          {confirm === 'sample' ? (
            <button role="menuitem" className="danger" onClick={() => { resetSample(); setOpen(false); setConfirm(null); }}>Replace my data with sample?</button>
          ) : (
            <button role="menuitem" onClick={() => setConfirm('sample')}><Sparkles size={16} /> Load sample household</button>
          )}
          {confirm === 'fresh' ? (
            <button role="menuitem" className="danger" onClick={() => { startFresh(); setOpen(false); setConfirm(null); }}>Erase everything and start blank?</button>
          ) : (
            <button role="menuitem" onClick={() => setConfirm('fresh')}><FilePlus2 size={16} /> Start a blank plan</button>
          )}
          <p className="menu-note">Save a file first — these replace the plan stored in this browser.</p>
        </div>
      )}
    </div>
  );
}

function Shell() {
  const { plan, savedAt, saveToFile, openFile, toast, fileName } = usePlan();
  const theme = useThemePref();
  const sim = useSimulation(plan);
  const [route, go] = useRoute();
  const [real, setRealState] = useState(() => {
    try { return localStorage.getItem('nestegg.real') !== '0'; } catch { return true; }
  });
  const setReal = (b: boolean) => {
    setRealState(b);
    try { localStorage.setItem('nestegg.real', b ? '1' : '0'); } catch { /* ignore */ }
  };
  const [updateOpen, setUpdateOpen] = useState(false);
  const current = NAV.find((n) => n.id === route)!;

  return (
    <Ctx.Provider value={{ sim, chart: theme.chart, real, setReal, go, openUpdate: () => setUpdateOpen(true) }}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden><rect width="32" height="32" rx="9" fill="var(--accent)" /><path d="M8 22 L14 15 L18 19 L24 10" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <div>
              <div className="brand-name">Nestegg</div>
              <div className="brand-sub">{plan.location || 'Retirement planner'}</div>
            </div>
          </div>
          <nav className="nav">
            {NAV.map((n) => (
              <a key={n.id} href={`#/${n.id}`} className={route === n.id ? 'active' : ''} onClick={(e) => { e.preventDefault(); go(n.id); }}>
                {n.icon}
                <span>{n.label}</span>
              </a>
            ))}
          </nav>
          <div className="sidebar-foot">
            <ThemeSwitch pref={theme.pref} setPref={theme.setPref} />
            <div className="save-state">
              <span className="dot" />
              {savedAt ? `Autosaved ${savedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Saving…'}
              {fileName && <div className="muted small">File: {fileName}</div>}
            </div>
          </div>
        </aside>

        <main className="main">
          <header className="topbar">
            <h1>{current.label}</h1>
            <div className="topbar-actions">
              <Button variant="primary" icon={<RefreshCw size={16} />} onClick={() => setUpdateOpen(true)}>Update balances</Button>
              <Button icon={<Save size={16} />} onClick={() => saveToFile()} title="Save plan to a file">Save</Button>
              <Button icon={<FolderOpen size={16} />} onClick={openFile} title="Open a saved plan file">Open</Button>
              <MoreMenu />
            </div>
          </header>
          <div className="page">
            {route === 'dashboard' && <Dashboard />}
            {route === 'projections' && <Projections />}
            {route === 'accounts' && <Accounts />}
            {route === 'debts' && <Debts />}
            {route === 'history' && <HistoryPage />}
            {route === 'plan' && <PlanPage />}
            {route === 'taxes' && <Taxes />}
          </div>
        </main>

        <nav className="bottom-nav">
          {NAV.map((n) => (
            <a key={n.id} href={`#/${n.id}`} className={route === n.id ? 'active' : ''} onClick={(e) => { e.preventDefault(); go(n.id); }}>
              {n.icon}
              <span>{n.label.split(' ')[0]}</span>
            </a>
          ))}
        </nav>

        <UpdateBalancesModal open={updateOpen} onClose={() => setUpdateOpen(false)} />
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </Ctx.Provider>
  );
}

export default function App() {
  return (
    <PlanProvider>
      <Shell />
    </PlanProvider>
  );
}
