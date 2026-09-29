import { Plus, Trash2, Landmark, AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../App';
import { usePlan } from '../store';
import { Button, Card, Empty, Field, NumberInput, Select, StatTile } from '../components/ui';
import { DebtPayoffChart } from '../components/charts';
import { DEBT_TYPE_LABEL, type Debt, type DebtType } from '../engine/types';
import { DEFAULT_DEBT_RATES, DEFAULT_DEBT_TERMS, newDebt } from '../engine/defaults';
import { currentReturn } from '../engine/returns';
import { amortize, debtSchedule, paymentFor } from '../engine/debt';
import { latestDate, latestValue, todayISO, upsertSnapshot } from '../engine/history';
import { fmtCompact, fmtDate, fmtUSD, monthsToText } from '../format';

const DEBT_TYPES = Object.keys(DEBT_TYPE_LABEL) as DebtType[];

function payoffDate(months: number | null): string {
  if (months == null) return 'Never';
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function DebtEditor({ d, index, onChange, onDelete }: { d: Debt; index: number; onChange: (d: Debt) => void; onDelete: () => void }) {
  const { chart: c } = useApp();
  const [confirm, setConfirm] = useState(false);
  const [calcYears, setCalcYears] = useState(30);
  const set = <K extends keyof Debt>(k: K, v: Debt[K]) => onChange({ ...d, [k]: v });
  // Keep inferring the payment until the user types one in themselves.
  const [autoPay, setAutoPay] = useState(d.monthlyPayment === 0);
  const bal = latestValue(d.history);
  const withExtra = debtSchedule(d);
  const base = amortize(bal, d.rate, d.monthlyPayment, 0);
  const saved = d.extraPayment > 0 && base.months != null ? base.totalInterest - withExtra.totalInterest : 0;
  const monthlyInterest = (bal * d.rate) / 100 / 12;
  const last = latestDate(d.history);

  return (
    <div className="acct">
      <div className="acct-head">
        <span className="acct-swatch" style={{ background: c.series[index % 8] }} />
        <input className="acct-name" value={d.name} onChange={(e) => set('name', e.target.value)} aria-label="Debt name" />
        <div className="acct-balance">
          <span className="muted small">{last ? `as of ${fmtDate(last)}` : 'no balance yet'}</span>
          <strong>{fmtUSD(bal)}</strong>
        </div>
        {confirm ? (
          <div className="confirm-inline">
            <Button size="sm" variant="danger" onClick={onDelete}>Delete</Button>
            <Button size="sm" onClick={() => setConfirm(false)}>Keep</Button>
          </div>
        ) : (
          <Button variant="ghost" icon={<Trash2 size={16} />} title="Delete debt" onClick={() => setConfirm(true)} />
        )}
      </div>
      <div className="form-grid">
        <Field label="Type">
          <Select value={d.type} onChange={(v) => onChange({ ...d, type: v, rate: d.rate === DEFAULT_DEBT_RATES[d.type] ? DEFAULT_DEBT_RATES[v] : d.rate, name: d.name === DEBT_TYPE_LABEL[d.type] ? DEBT_TYPE_LABEL[v] : d.name })} options={DEBT_TYPES.map((t) => ({ value: t, label: DEBT_TYPE_LABEL[t] }))} />
        </Field>
        <Field label="Current balance" hint="Edits today's snapshot">
          <NumberInput
            prefix="$"
            value={bal}
            ariaLabel="Current balance"
            onChange={(n) => onChange({
              ...d,
              history: upsertSnapshot(d.history, todayISO(), n),
              // No payment yet? Assume a standard payment for this kind of loan.
              monthlyPayment: autoPay ? Math.round(paymentFor(n, d.rate, DEFAULT_DEBT_TERMS[d.type])) : d.monthlyPayment,
            })}
          />
        </Field>
        <Field label="Interest rate (APR)" hint={d.rate === DEFAULT_DEBT_RATES[d.type] ? 'Typical rate — replace with yours' : undefined}>
          <NumberInput suffix="%" value={d.rate} decimals={3} step={0.125} min={0} onChange={(n) => set('rate', n)} />
        </Field>
        <Field label="Monthly payment" hint={autoPay && bal > 0 ? `Estimated for a ${DEFAULT_DEBT_TERMS[d.type] / 12}-yr ${DEBT_TYPE_LABEL[d.type].toLowerCase()} — enter yours` : `Principal + interest · interest now ≈ ${fmtUSD(monthlyInterest)}/mo`}>
          <NumberInput prefix="$" value={d.monthlyPayment} onChange={(n) => { setAutoPay(false); set('monthlyPayment', n); }} ariaLabel="Monthly payment" />
        </Field>
        <Field label="Extra principal / month">
          <NumberInput prefix="$" value={d.extraPayment} step={50} min={0} onChange={(n) => set('extraPayment', n)} />
        </Field>
        <Field label="Payment calculator" hint={`Standard payment over ${calcYears} yrs: ${fmtUSD(paymentFor(bal, d.rate, calcYears * 12))}`}>
          <div className="inline">
            <NumberInput suffix="yrs" value={calcYears} min={1} max={40} onChange={setCalcYears} compact />
            <Button size="sm" onClick={() => set('monthlyPayment', Math.round(paymentFor(bal, d.rate, calcYears * 12)))}>Use</Button>
          </div>
        </Field>
      </div>
      <div className="debt-stats">
        <div><span className="muted small">Paid off</span><strong>{payoffDate(withExtra.months)}</strong><span className="muted small">{monthsToText(withExtra.months)}</span></div>
        <div><span className="muted small">Interest remaining</span><strong>{withExtra.months == null ? '∞' : fmtCompact(withExtra.totalInterest)}</strong></div>
        <div><span className="muted small">Total to pay</span><strong>{withExtra.months == null ? '∞' : fmtCompact(withExtra.totalPaid)}</strong></div>
        {d.extraPayment > 0 && base.months != null && withExtra.months != null && (
          <div className="good-box"><span className="small">Extra payments save</span><strong>{fmtCompact(saved)}</strong><span className="small">and {monthsToText(base.months - withExtra.months)}</span></div>
        )}
      </div>
      {withExtra.months == null && bal > 0 && (
        <p className="status status-critical"><AlertTriangle size={14} /> Payment doesn't cover interest — this balance never shrinks.</p>
      )}
    </div>
  );
}

export default function Debts() {
  const { plan, update } = usePlan();
  const { chart: c } = useApp();
  const [newType, setNewType] = useState<DebtType>('mortgage');
  const add = () => {
    const d = newDebt(newType, 0, todayISO());
    update((p) => ({ ...p, debts: [...p.debts, d] }));
  };
  const schedules = Object.fromEntries(plan.debts.map((d) => [d.id, debtSchedule(d).rows]));
  const starts = Object.fromEntries(plan.debts.map((d) => [d.id, latestValue(d.history)]));
  const total = plan.debts.reduce((s, d) => s + latestValue(d.history), 0);
  const monthly = plan.debts.reduce((s, d) => s + (latestValue(d.history) > 0 ? d.monthlyPayment + d.extraPayment : 0), 0);
  const interest = plan.debts.reduce((s, d) => s + debtSchedule(d).totalInterest, 0);
  const wRate = total ? plan.debts.reduce((s, d) => s + d.rate * latestValue(d.history), 0) / total : 0;
  const debtFree = Math.max(0, ...plan.debts.map((d) => debtSchedule(d).months ?? Infinity));
  const weightedReturn = (() => {
    const inv = plan.accounts.filter((a) => a.spendable);
    const t = inv.reduce((s, a) => s + latestValue(a.history), 0);
    return t ? inv.reduce((s, a) => s + currentReturn(plan, a).rate * latestValue(a.history), 0) / t : 0;
  })();
  const highRate = plan.debts.filter((d) => d.rate > weightedReturn && latestValue(d.history) > 0);

  return (
    <div className="stack">
      <div className="stats stats-4">
        <StatTile label="Total debt" value={fmtCompact(total)} sub={`weighted ${wRate.toFixed(2)}% APR`} />
        <StatTile label="Monthly payments" value={fmtUSD(monthly)} sub={`${fmtUSD(monthly * 12)}/yr`} />
        <StatTile label="Interest still to pay" value={Number.isFinite(interest) ? fmtCompact(interest) : '∞'} sub="at current payments" />
        <StatTile label="Debt-free" value={Number.isFinite(debtFree) ? payoffDate(debtFree) : 'Never'} sub={Number.isFinite(debtFree) ? monthsToText(debtFree) : 'a payment is too low'} />
      </div>

      {highRate.length > 0 && (
        <div className="banner banner-warn">
          <AlertTriangle size={18} />
          <div>
            {highRate.map((d) => d.name).join(', ')} {highRate.length > 1 ? 'charge' : 'charges'} more interest than your portfolio's expected {weightedReturn.toFixed(1)}% return. Extra payments there are a guaranteed return.
          </div>
        </div>
      )}

      {plan.debts.length > 0 && (
        <Card title="Payoff timeline" subtitle="Balance of each debt over time at current payments (including extra principal)">
          <DebtPayoffChart debts={plan.debts} schedules={schedules} starts={starts} c={c} />
        </Card>
      )}

      <Card title="Add a debt">
        <div className="add-row">
          <Select value={newType} onChange={setNewType} options={DEBT_TYPES.map((t) => ({ value: t, label: DEBT_TYPE_LABEL[t] }))} ariaLabel="New debt type" />
          <Button variant="primary" icon={<Plus size={16} />} onClick={add}>Add debt</Button>
        </div>
      </Card>

      {plan.debts.length === 0 && (
        <Card><Empty icon={<Landmark size={28} />} title="No debts">Add a mortgage, car loan, student loans or credit cards to include them in your projections.</Empty></Card>
      )}
      <div className="acct-list">
        {plan.debts.map((d, i) => (
          <DebtEditor
            key={d.id}
            d={d}
            index={i}
            onChange={(nd) => update((p) => ({ ...p, debts: p.debts.map((x) => (x.id === d.id ? nd : x)) }))}
            onDelete={() => update((p) => ({ ...p, debts: p.debts.filter((x) => x.id !== d.id) }))}
          />
        ))}
      </div>
    </div>
  );
}
