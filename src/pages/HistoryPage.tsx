import { History, RefreshCw, Trash2, Plus } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../App';
import { usePlan } from '../store';
import { Button, Card, Empty, StatTile } from '../components/ui';
import { HistoryStackChart, Sparkline } from '../components/charts';
import { annualizedGrowth, lastChange, latestValue, netWorthHistory, sortedHistory, todayISO, upsertSnapshot } from '../engine/history';
import { ACCOUNT_TYPE_SHORT, DEBT_TYPE_LABEL } from '../engine/types';
import { fmtCompact, fmtDate, fmtPct, fmtSigned, fmtUSD } from '../format';

export default function HistoryPage() {
  const { plan, update } = usePlan();
  const { chart: c, openUpdate } = useApp();
  const hist = netWorthHistory(plan);
  const [editing, setEditing] = useState(false);
  const [newDate, setNewDate] = useState('');
  const dates = hist.map((h) => h.date).reverse();

  if (!hist.length) {
    return (
      <Card>
        <Empty icon={<History size={28} />} title="No history yet" action={<Button variant="primary" icon={<RefreshCw size={16} />} onClick={openUpdate}>Record balances</Button>}>
          Every time you update balances, a dated snapshot is stored here so you can watch your net worth change.
        </Empty>
      </Card>
    );
  }

  const first = hist[0];
  const last = hist.at(-1)!;
  const years = (last.t - first.t) / (365.25 * 864e5);
  const change = last.netWorth - first.netWorth;
  const yoy = (() => {
    // Snapshot closest to a year ago (at least ~10 months back).
    const target = last.t - 365.25 * 864e5;
    const prior = hist
      .filter((h) => h.t <= last.t - 300 * 864e5)
      .sort((a, b) => Math.abs(a.t - target) - Math.abs(b.t - target))[0];
    return prior ? { delta: last.netWorth - prior.netWorth, from: prior.date } : null;
  })();

  const setCell = (kind: 'account' | 'debt', id: string, date: string, value: number | null) => {
    update((p) => {
      const apply = <T extends { id: string; history: { date: string; value: number }[] }>(x: T): T =>
        x.id !== id ? x : { ...x, history: value == null ? x.history.filter((s) => s.date !== date) : upsertSnapshot(x.history, date, value) };
      return kind === 'account' ? { ...p, accounts: p.accounts.map(apply) } : { ...p, debts: p.debts.map(apply) };
    });
  };
  const deleteDate = (date: string) =>
    update((p) => ({
      ...p,
      accounts: p.accounts.map((a) => ({ ...a, history: a.history.filter((s) => s.date !== date) })),
      debts: p.debts.map((d) => ({ ...d, history: d.history.filter((s) => s.date !== date) })),
    }));
  const addDate = () => {
    if (!newDate) return;
    // Seed the new date with carried-forward values so it's editable.
    update((p) => ({
      ...p,
      accounts: p.accounts.map((a) => ({ ...a, history: a.history.some((s) => s.date === newDate) ? a.history : upsertSnapshot(a.history, newDate, latestBefore(a.history, newDate)) })),
      debts: p.debts.map((d) => ({ ...d, history: d.history.some((s) => s.date === newDate) ? d.history : upsertSnapshot(d.history, newDate, latestBefore(d.history, newDate)) })),
    }));
    setNewDate('');
  };

  return (
    <div className="stack">
      <div className="stats stats-4">
        <StatTile label="Net worth now" value={fmtCompact(last.netWorth)} sub={`as of ${fmtDate(last.date)}`} />
        <StatTile label="Past 12 months" value={yoy ? fmtSigned(yoy.delta) : '—'} deltaGood={(yoy?.delta ?? 0) >= 0} sub={yoy ? `since ${fmtDate(yoy.from)}` : 'need a year of history'} />
        <StatTile label="Since first record" value={fmtSigned(change)} sub={`${fmtDate(first.date)} · ${years.toFixed(1)} yrs`} />
        <StatTile label="Snapshots" value={String(hist.length)} sub="dates with recorded balances" />
      </div>

      <Card title="Recorded net worth" subtitle="Account balances stacked by type, debts below the line, as you entered them" actions={<Button size="sm" variant="primary" icon={<RefreshCw size={15} />} onClick={openUpdate}>Update balances</Button>}>
        <HistoryStackChart history={hist} accounts={plan.accounts} c={c} />
      </Card>

      <Card title="By account" subtitle="Change since the previous snapshot and growth since the first one (includes contributions)">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Account</th><th>Type</th><th className="num-cell">Balance</th><th className="num-cell">Last change</th><th className="num-cell">Growth / yr</th><th>Trend</th></tr></thead>
            <tbody>
              {plan.accounts.map((a) => {
                const ch = lastChange(a);
                const g = annualizedGrowth(a.history);
                return (
                  <tr key={a.id}>
                    <td><span className="legend-key swatch" style={{ ['--c' as string]: c.type[a.type] }} /> {a.name}</td>
                    <td className="muted">{ACCOUNT_TYPE_SHORT[a.type]}</td>
                    <td className="num-cell">{fmtUSD(latestValue(a.history))}</td>
                    <td className={`num-cell ${ch ? (ch.delta >= 0 ? 'text-good' : 'text-bad') : ''}`}>{ch ? fmtSigned(ch.delta) : '—'}</td>
                    <td className="num-cell">{g != null ? fmtPct(g) : '—'}</td>
                    <td><Sparkline values={sortedHistory(a.history).map((s) => s.value)} color={c.type[a.type]} /></td>
                  </tr>
                );
              })}
              {plan.debts.map((d) => {
                const ch = lastChange(d);
                return (
                  <tr key={d.id}>
                    <td><span className="legend-key swatch" style={{ ['--c' as string]: c.debt }} /> {d.name}</td>
                    <td className="muted">{DEBT_TYPE_LABEL[d.type]}</td>
                    <td className="num-cell">−{fmtUSD(latestValue(d.history))}</td>
                    <td className={`num-cell ${ch ? (ch.delta <= 0 ? 'text-good' : 'text-bad') : ''}`}>{ch ? fmtSigned(-ch.delta) : '—'}</td>
                    <td className="num-cell muted">—</td>
                    <td><Sparkline values={sortedHistory(d.history).map((s) => s.value)} color={c.debt} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="All snapshots"
        subtitle={editing ? 'Edit any value. Clear a cell to remove that snapshot. Blank cells carry the previous value forward.' : 'Every recorded balance, newest first'}
        actions={<Button size="sm" variant={editing ? 'primary' : 'default'} onClick={() => setEditing((e) => !e)}>{editing ? 'Done' : 'Edit'}</Button>}
      >
        {editing && (
          <div className="add-row" style={{ marginBottom: 12 }}>
            <input type="date" className="text" value={newDate} max={todayISO()} onChange={(e) => setNewDate(e.target.value)} aria-label="New snapshot date" />
            <Button size="sm" icon={<Plus size={15} />} onClick={addDate}>Add past date</Button>
          </div>
        )}
        <div className="table-wrap tall">
          <table className="table matrix">
            <thead>
              <tr>
                <th className="sticky-col">Date</th>
                <th className="num-cell">Net worth</th>
                {plan.accounts.map((a) => <th key={a.id} className="num-cell">{a.name}</th>)}
                {plan.debts.map((d) => <th key={d.id} className="num-cell">{d.name}</th>)}
                {editing && <th />}
              </tr>
            </thead>
            <tbody>
              {dates.map((date) => {
                const h = hist.find((x) => x.date === date)!;
                return (
                  <tr key={date}>
                    <td className="sticky-col">{fmtDate(date)}</td>
                    <td className="num-cell"><strong>{fmtUSD(h.netWorth)}</strong></td>
                    {plan.accounts.map((a) => {
                      const s = a.history.find((x) => x.date === date);
                      return (
                        <td key={a.id} className={`num-cell ${s ? '' : 'carried'}`}>
                          {editing ? (
                            <CellInput value={s?.value} onChange={(v) => setCell('account', a.id, date, v)} label={`${a.name} on ${date}`} />
                          ) : s ? fmtUSD(s.value) : '·'}
                        </td>
                      );
                    })}
                    {plan.debts.map((d) => {
                      const s = d.history.find((x) => x.date === date);
                      return (
                        <td key={d.id} className={`num-cell ${s ? '' : 'carried'}`}>
                          {editing ? (
                            <CellInput value={s?.value} onChange={(v) => setCell('debt', d.id, date, v)} label={`${d.name} on ${date}`} />
                          ) : s ? fmtUSD(s.value) : '·'}
                        </td>
                      );
                    })}
                    {editing && (
                      <td><Button variant="ghost" icon={<Trash2 size={15} />} title={`Delete all snapshots on ${date}`} onClick={() => deleteDate(date)} /></td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function latestBefore(h: { date: string; value: number }[], date: string): number {
  const prior = sortedHistory(h).filter((s) => s.date <= date);
  return prior.length ? prior.at(-1)!.value : 0;
}

/** A matrix cell: empty means "no snapshot on this date". */
function CellInput({ value, onChange, label }: { value: number | undefined; onChange: (v: number | null) => void; label: string }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value == null ? '' : value.toLocaleString('en-US'));
  return (
    <input
      className="cell-input"
      inputMode="decimal"
      aria-label={label}
      value={shown}
      placeholder="·"
      onFocus={(e) => {
        const raw = value == null ? '' : String(value);
        e.currentTarget.value = raw;
        e.currentTarget.select();
        setText(raw);
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const t = (text ?? '').replace(/[^0-9.\-]/g, '');
        setText(null);
        if (t === '') {
          if (value != null) onChange(null);
        } else {
          const n = parseFloat(t);
          if (Number.isFinite(n) && n !== value) onChange(n);
        }
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}
