import { useEffect, useState } from 'react';
import { usePlan } from '../store';
import { Button, Modal, NumberInput } from './ui';
import { latestDate, latestValue, todayISO, upsertSnapshot, valueAt } from '../engine/history';
import { ACCOUNT_TYPE_SHORT, DEBT_TYPE_LABEL } from '../engine/types';
import { fmtDate, fmtSigned, fmtUSD } from '../format';

/**
 * Record a dated snapshot of every account and debt at once. This is the main
 * "update over time" workflow — each save adds a point to every history chart.
 */
export function UpdateBalancesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { plan, update, notify } = usePlan();
  const [date, setDate] = useState(todayISO());
  const [vals, setVals] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!open) return;
    setDate(todayISO());
    const v: Record<string, number> = {};
    plan.accounts.forEach((a) => (v[a.id] = latestValue(a.history)));
    plan.debts.forEach((d) => (v[d.id] = latestValue(d.history)));
    setVals(v);
    // Only reset when opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = () => {
    update((p) => ({
      ...p,
      accounts: p.accounts.map((a) => ({ ...a, history: upsertSnapshot(a.history, date, vals[a.id] ?? 0) })),
      debts: p.debts.map((d) => ({ ...d, history: upsertSnapshot(d.history, date, vals[d.id] ?? 0) })),
    }));
    notify(`Recorded balances for ${fmtDate(date)}`);
    onClose();
  };

  const prior = (h: { date: string; value: number }[]) => {
    const dayBefore = new Date(Date.parse(date) - 864e5).toISOString().slice(0, 10);
    return valueAt(h, dayBefore);
  };

  const assetTotal = plan.accounts.reduce((s, a) => s + (vals[a.id] ?? 0), 0);
  const debtTotal = plan.debts.reduce((s, d) => s + (vals[d.id] ?? 0), 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Update balances"
      wide
      footer={
        <>
          <div className="modal-total">
            Net worth on this date <strong>{fmtUSD(assetTotal - debtTotal)}</strong>
          </div>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>Save snapshot</Button>
        </>
      }
    >
      <div className="update-date">
        <label className="field">
          <span className="field-label">As of</span>
          <input type="date" className="text" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} />
        </label>
        <p className="muted small">
          Enter the current balance of each account and debt. Saving adds a dated point to your history (re-saving the same date overwrites it).
        </p>
      </div>
      {plan.accounts.length > 0 && <h4 className="update-group">Accounts</h4>}
      <div className="update-list">
        {plan.accounts.map((a) => {
          const prev = prior(a.history);
          const diff = prev != null ? (vals[a.id] ?? 0) - prev : null;
          return (
            <div key={a.id} className="update-row">
              <div>
                <div className="update-name">{a.name}</div>
                <div className="muted small">
                  {ACCOUNT_TYPE_SHORT[a.type]} · last {latestDate(a.history) ? fmtDate(latestDate(a.history)!) : 'never'}
                </div>
              </div>
              <div className={`update-diff ${diff == null ? '' : diff >= 0 ? 'up' : 'down'}`}>{diff == null || Math.abs(diff) < 1 ? '' : fmtSigned(diff)}</div>
              <NumberInput prefix="$" value={vals[a.id] ?? 0} onChange={(n) => setVals((v) => ({ ...v, [a.id]: n }))} ariaLabel={`${a.name} balance`} />
            </div>
          );
        })}
      </div>
      {plan.debts.length > 0 && <h4 className="update-group">Debts</h4>}
      <div className="update-list">
        {plan.debts.map((d) => {
          const prev = prior(d.history);
          const diff = prev != null ? (vals[d.id] ?? 0) - prev : null;
          return (
            <div key={d.id} className="update-row">
              <div>
                <div className="update-name">{d.name}</div>
                <div className="muted small">{DEBT_TYPE_LABEL[d.type]} · {d.rate}% APR</div>
              </div>
              <div className={`update-diff ${diff == null ? '' : diff <= 0 ? 'up' : 'down'}`}>{diff == null || Math.abs(diff) < 1 ? '' : fmtSigned(diff)}</div>
              <NumberInput prefix="$" value={vals[d.id] ?? 0} onChange={(n) => setVals((v) => ({ ...v, [d.id]: n }))} ariaLabel={`${d.name} balance`} />
            </div>
          );
        })}
      </div>
      {!plan.accounts.length && !plan.debts.length && <p className="muted">Add accounts or debts first.</p>}
    </Modal>
  );
}
