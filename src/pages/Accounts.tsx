import { Plus, Trash2, Wallet, ChevronDown, Info } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../App';
import { usePlan } from '../store';
import { Button, Card, Empty, Field, NumberInput, Select, Toggle } from '../components/ui';
import { PartsBar, Sparkline } from '../components/charts';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL, ACCOUNT_TYPE_SHORT, type Account, type AccountType, type Allocation, type Plan } from '../engine/types';
import { TYPE_DEFAULTS, defaultPropertyTax, newAccount, uid } from '../engine/defaults';
import { ALLOCATION_PRESETS, allocationLabel, currentReturn, glideStockPct, ownerInfo, usesMix } from '../engine/returns';
import { CA_HOMEOWNERS_EXEMPTION, LIMITS_2026, propertyTaxFor } from '../engine/tax';
import { annualizedGrowth, latestDate, latestValue, sortedHistory, todayISO, upsertSnapshot } from '../engine/history';
import { fmtDate, fmtPct, fmtUSD } from '../format';

const TYPE_HELP: Record<AccountType, string> = {
  cash: 'Checking, savings, HYSA, CDs, money market. Drawn first in retirement.',
  taxable: 'Brokerage accounts. Withdrawals realize capital gains on the growth.',
  traditional: '401(k), 403(b), 457, traditional IRA. Pre-tax; withdrawals taxed as income; RMDs apply.',
  roth: 'Roth 401(k) and Roth IRA. Tax-free withdrawals; drawn after pre-tax accounts.',
  hsa: 'Health Savings Account. Pre-tax federally (not in CA). Pays retirement medical bills first, tax-free.',
  property: 'Your home or other real estate. Counts toward net worth but is not sold to fund retirement. California property tax (Prop 13) is charged every year.',
  other: '529s, crypto, private company stock, a business — anything else.',
};

const TYPE_COMPACT: Record<AccountType, string> = {
  cash: 'Cash & savings', taxable: 'Brokerage', traditional: '401(k) / IRA', roth: 'Roth', hsa: 'HSA', property: 'Real estate', other: 'Other',
};

/** Suggested "max out" amounts for the account owner's age this year. */
function maxOptions(a: Account, plan: Plan): { label: string; amount: number }[] {
  const { age } = ownerInfo(plan, a);
  const k401 = LIMITS_2026.k401 + (age >= 60 && age <= 63 ? LIMITS_2026.k401CatchUp60to63 : age >= 50 ? LIMITS_2026.k401CatchUp50 : 0);
  const ira = LIMITS_2026.ira + (age >= 50 ? LIMITS_2026.iraCatchUp50 : 0);
  const hsa = (plan.married ? LIMITS_2026.hsaFamily : LIMITS_2026.hsaSelf) + (age >= 55 ? LIMITS_2026.hsaCatchUp55 : 0);
  if (a.type === 'traditional') return [{ label: 'Max 401(k)', amount: k401 }, { label: 'Max IRA', amount: ira }];
  if (a.type === 'roth') return [{ label: 'Max Roth 401(k)', amount: k401 }, { label: plan.married && a.owner === 'joint' ? 'Max 2 IRAs' : 'Max IRA', amount: plan.married && a.owner === 'joint' ? ira * 2 : ira }];
  if (a.type === 'hsa') return [{ label: plan.married ? 'Max family' : 'Max', amount: Math.max(0, hsa - a.employerContribution) }];
  return [];
}

function mixHint(a: Account, plan: Plan): string {
  const r = currentReturn(plan, a);
  const base = `≈ ${r.rate.toFixed(1)}% expected return · ${r.vol.toFixed(0)}% volatility`;
  if (a.allocation === 'auto') {
    const o = ownerInfo(plan, a);
    return `${Math.round(glideStockPct(o.age, o.retirementAge))}% stocks today, 50% at retirement, 30% later. ${base}`;
  }
  return base;
}

export function AccountEditor({ a, plan, onChange, onDelete }: { a: Account; plan: Plan; onChange: (a: Account) => void; onDelete: () => void }) {
  const { chart: c, go } = useApp();
  const [confirm, setConfirm] = useState(false);
  const [more, setMore] = useState(false);
  const set = <K extends keyof Account>(k: K, v: Account[K]) => onChange({ ...a, [k]: v });
  const A = plan.assumptions;
  const growth = annualizedGrowth(a.history);
  const last = latestDate(a.history);
  const matchable = a.type === 'traditional' || a.type === 'roth' || a.type === 'hsa';
  const pt = a.type === 'property' ? a.propertyTax ?? defaultPropertyTax() : null;
  const setPT = (patch: Partial<NonNullable<Account['propertyTax']>>) => set('propertyTax', { ...(pt ?? defaultPropertyTax()), ...patch });
  const assessedNow = pt ? Math.min(pt.assessedValue ?? latestValue(a.history), latestValue(a.history)) : 0;
  const taxNow = pt ? propertyTaxFor(pt, assessedNow, 0, latestValue(a.history), 1).tax : 0;
  const maxes = maxOptions(a, plan);

  const changeType = (t: AccountType) => {
    const d = TYPE_DEFAULTS[t];
    const defaultName = Object.values(TYPE_DEFAULTS).some((x) => x.name === a.name);
    onChange({
      ...a, type: t, allocation: d.allocation, returnRate: d.rate, volatility: d.vol,
      spendable: t !== 'property', name: defaultName ? d.name : a.name,
      propertyTax: t === 'property' ? a.propertyTax ?? defaultPropertyTax() : undefined,
    });
  };

  return (
    <div className="acct">
      <div className="acct-head">
        <span className="acct-swatch" style={{ background: c.type[a.type] }} />
        <input className="acct-name" value={a.name} onChange={(e) => set('name', e.target.value)} aria-label="Account name" />
        <div className="acct-balance">
          <span className="muted small">{last ? `as of ${fmtDate(last)}` : 'no balance yet'}</span>
          <strong>{fmtUSD(latestValue(a.history))}</strong>
        </div>
        {confirm ? (
          <div className="confirm-inline">
            <Button size="sm" variant="danger" onClick={onDelete}>Delete</Button>
            <Button size="sm" onClick={() => setConfirm(false)}>Keep</Button>
          </div>
        ) : (
          <Button variant="ghost" icon={<Trash2 size={16} />} title="Delete account" onClick={() => setConfirm(true)} />
        )}
      </div>

      <div className="form-grid">
        <Field label="Type">
          <Select value={a.type} onChange={changeType} options={ACCOUNT_TYPES.map((t) => ({ value: t, label: TYPE_COMPACT[t] }))} ariaLabel="Account type" />
        </Field>
        <Field label={a.type === 'property' ? 'Current value' : 'Current balance'}>
          <NumberInput prefix="$" value={latestValue(a.history)} onChange={(n) => set('history', upsertSnapshot(a.history, todayISO(), n))} ariaLabel="Current balance" />
        </Field>
        {plan.married && (
          <Field label="Owner">
            <Select value={a.owner} onChange={(v) => set('owner', v)} options={[{ value: 'self', label: plan.self.name || 'You' }, { value: 'spouse', label: plan.spouse.name || 'Spouse' }, { value: 'joint', label: 'Joint' }]} ariaLabel="Owner" />
          </Field>
        )}
      </div>

      <div className="form-grid">
        {usesMix(a) && (
          <Field label="Invested in" hint={a.allocation === 'custom' ? 'Enter your own expected return and volatility (under More options)' : mixHint(a, plan)} full>
            <Select
              value={String(a.allocation)}
              onChange={(v) => set('allocation', (v === 'auto' || v === 'custom' ? v : Number(v)) as Allocation)}
              options={ALLOCATION_PRESETS.map((p) => ({ value: String(p.value), label: p.label }))}
              ariaLabel="Invested in"
            />
          </Field>
        )}
        {usesMix(a) && a.allocation === 'custom' && (
          <Field label="Expected return / yr" hint="Nominal, before inflation">
            <NumberInput suffix="%" value={a.returnRate} decimals={2} step={0.25} onChange={(n) => set('returnRate', n)} ariaLabel="Expected return" />
          </Field>
        )}
        {a.type === 'cash' && (
          <Field
            label="Interest rate (APY)"
            hint={a.allocation === 'custom'
              ? <>Your rate · <button type="button" className="link" onClick={() => set('allocation', 'auto')}>use market rate ({A.cashReturn}%)</button></>
              : <>Market savings rate — <button type="button" className="link" onClick={() => go('plan')}>change for all</button> or type your own</>}
          >
            <NumberInput
              suffix="%"
              value={a.allocation === 'custom' ? a.returnRate : A.cashReturn}
              decimals={2}
              step={0.25}
              onChange={(n) => onChange({ ...a, allocation: 'custom', returnRate: n, volatility: 0.5 })}
              ariaLabel="Interest rate"
            />
          </Field>
        )}
        {(a.type === 'property' || a.type === 'other') && (
          <Field label={a.type === 'property' ? 'Appreciation / yr' : 'Expected return / yr'} hint={a.type === 'property' ? 'Long-run SF home prices: ~4–5%/yr' : 'Nominal, before inflation'}>
            <NumberInput suffix="%" value={a.returnRate} decimals={2} step={0.25} onChange={(n) => set('returnRate', n)} ariaLabel="Expected return" />
          </Field>
        )}
        {a.type === 'property' && pt && (
          <Field
            label="Assessed value (tax bill)"
            hint={pt.assessedValue == null
              ? 'Using market value. Enter the assessed value from your tax bill — Prop 13 keeps it far lower for homes bought years ago.'
              : 'Grows 2%/yr under Prop 13'}
          >
            <NumberInput
              prefix="$"
              value={pt.assessedValue ?? latestValue(a.history)}
              onChange={(n) => setPT({ assessedValue: n })}
              ariaLabel="Assessed value"
            />
          </Field>
        )}
        {a.type !== 'property' && (
          <Field
            label="You contribute / yr"
            hint={maxes.length ? (
              <span className="quick">
                {maxes.map((m) => (
                  <button key={m.label} type="button" className="chip" onClick={() => set('contribution', m.amount)}>{m.label} {fmtUSD(m.amount)}</button>
                ))}
              </span>
            ) : 'Until the owner retires'}
          >
            <NumberInput prefix="$" value={a.contribution} onChange={(n) => set('contribution', n)} ariaLabel="Your contribution" />
          </Field>
        )}
        {matchable && (
          <Field label="Employer adds / yr" hint="Match or profit sharing">
            <NumberInput prefix="$" value={a.employerContribution} onChange={(n) => set('employerContribution', n)} ariaLabel="Employer contribution" />
          </Field>
        )}
      </div>

      {a.type === 'property' && pt && latestValue(a.history) > 0 && (
        <div className="prop-tax">
          <span>Property tax this year</span>
          <strong>{fmtUSD(taxNow)}</strong>
          <span className="muted small">{fmtUSD(taxNow / 12)}/mo · {pt.rate}% of {fmtUSD(Math.max(0, assessedNow - (pt.homeownersExemption ? CA_HOMEOWNERS_EXEMPTION : 0)))}{pt.fixedCharges > 0 ? ` + ${fmtUSD(pt.fixedCharges)} parcel taxes` : ''}</span>
          <span>Upkeep this year</span>
          <strong>{fmtUSD((latestValue(a.history) * pt.upkeepPct) / 100)}</strong>
          <span className="muted small">{pt.upkeepPct}% of value for maintenance & repairs · change under More options</span>
        </div>
      )}

      <button type="button" className={`more-toggle ${more ? 'open' : ''}`} onClick={() => setMore((m) => !m)} aria-expanded={more}>
        <ChevronDown size={15} /> More options
      </button>
      {more && (
        <div className="form-grid">
          {a.type === 'property' && pt && (
            <>
              <Field label="Upkeep / yr" hint="Maintenance & repairs as % of home value. Rule of thumb 1%; 0 if your living expenses already include it.">
                <NumberInput suffix="%" value={pt.upkeepPct} decimals={2} step={0.25} min={0} onChange={(n) => setPT({ upkeepPct: n })} ariaLabel="Home upkeep" />
              </Field>
              <Field label="Property tax rate" hint="1% base + local bonds. San Francisco ~1.18%; most CA counties 1.05–1.25%.">
                <NumberInput suffix="%" value={pt.rate} decimals={3} step={0.01} min={0} onChange={(n) => setPT({ rate: n })} ariaLabel="Property tax rate" />
              </Field>
              <Field label="Parcel taxes & assessments / yr" hint="Fixed charges on your bill (schools, transit, etc.)">
                <NumberInput prefix="$" value={pt.fixedCharges} min={0} onChange={(n) => setPT({ fixedCharges: n })} ariaLabel="Parcel taxes" />
              </Field>
              <Field label="Primary residence" hint="Homeowners' exemption: $7,000 off assessed value">
                <Toggle checked={pt.homeownersExemption} onChange={(b) => setPT({ homeownersExemption: b })} label={pt.homeownersExemption ? 'Yes' : 'No'} />
              </Field>
            </>
          )}
          {a.type === 'taxable' && (
            <Field label="Cost basis" hint="Share of the balance you put in (not growth). Used for capital-gains tax.">
              <NumberInput suffix="%" value={a.costBasisPct} min={0} max={100} onChange={(n) => set('costBasisPct', n)} ariaLabel="Cost basis" />
            </Field>
          )}
          {(!usesMix(a) || a.allocation === 'custom') && a.type !== 'cash' && (
            <Field label="Volatility (std dev)" hint="Year-to-year swings. S&P 500 ~16%, Treasuries ~6%, homes ~8%.">
              <NumberInput suffix="%" value={a.volatility} decimals={1} step={1} min={0} onChange={(n) => set('volatility', n)} ariaLabel="Volatility" />
            </Field>
          )}
          <Field label="Use to fund retirement" hint={a.spendable ? 'Drawn down when spending exceeds income' : 'Counts toward net worth only'}>
            <Toggle checked={a.spendable} onChange={(b) => set('spendable', b)} label={a.spendable ? 'Spendable' : 'Held'} />
          </Field>
        </div>
      )}

      <div className="acct-foot">
        <Sparkline values={sortedHistory(a.history).map((s) => s.value)} color={c.type[a.type]} width={140} height={32} />
        <span className="muted small">
          {a.history.length} snapshot{a.history.length === 1 ? '' : 's'}
          {growth != null && <> · grew {fmtPct(growth)}/yr since {fmtDate(sortedHistory(a.history)[0].date)} (incl. contributions)</>}
        </span>
      </div>
    </div>
  );
}

export default function Accounts() {
  const { plan, update } = usePlan();
  const { chart: c, go, sim } = useApp();
  const [newType, setNewType] = useState<AccountType>('traditional');
  const synthetic = sim.projection.syntheticAccounts;
  const addSynthetic = () =>
    update((p) => ({
      ...p,
      accounts: [...p.accounts, ...synthetic.map(({ synthetic: _s, ...a }) => ({ ...a, id: uid(), history: [{ date: todayISO(), value: 0 }] }))],
    }));
  const add = () => {
    const a = { ...newAccount(newType, 0, todayISO()), owner: 'self' as const };
    update((p) => ({ ...p, accounts: [...p.accounts, a] }));
  };
  const totals = ACCOUNT_TYPES.map((t) => ({
    label: ACCOUNT_TYPE_SHORT[t],
    value: plan.accounts.filter((a) => a.type === t).reduce((s, a) => s + latestValue(a.history), 0),
    color: c.type[t],
  })).filter((x) => x.value > 0);
  const weighted = (() => {
    const inv = plan.accounts.filter((a) => a.type !== 'property');
    const tot = inv.reduce((s, a) => s + latestValue(a.history), 0);
    return tot ? inv.reduce((s, a) => s + currentReturn(plan, a).rate * latestValue(a.history), 0) / tot : 0;
  })();
  const A = plan.assumptions;
  const d = TYPE_DEFAULTS[newType];

  return (
    <div className="stack">
      <div className="grid-2 grid-2-wide">
        <Card title="Balances by type" subtitle={`Weighted expected return (excluding home): ${weighted.toFixed(2)}%`}>
          {totals.length ? <PartsBar parts={totals} /> : <p className="muted">No balances yet.</p>}
        </Card>
        <Card title="Add an account">
          <div className="add-row">
            <Select value={newType} onChange={setNewType} options={ACCOUNT_TYPES.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABEL[t] }))} ariaLabel="New account type" />
            <Button variant="primary" icon={<Plus size={16} />} onClick={add}>Add account</Button>
          </div>
          <p className="muted small">{TYPE_HELP[newType]}</p>
          <p className="muted small">
            Starts {usesMix({ type: newType }) ? <>invested in a <strong>{allocationLabel(d.allocation).toLowerCase()}</strong> mix</> : newType === 'cash' ? <>at the market savings rate ({A.cashReturn}%)</> : <>at {d.rate}%/yr</>}. Just enter a name and balance; you can change anything later.
          </p>
        </Card>
      </div>

      {synthetic.length > 0 && (
        <div className="banner">
          <Info size={18} />
          <div>
            Your leftover income is modeled going into <strong>{synthetic.map((a) => a.name).join(', ')}</strong>, which you haven't added yet (starting at $0).
          </div>
          <Button size="sm" variant="primary" onClick={addSynthetic}>Add {synthetic.length > 1 ? 'them' : 'it'}</Button>
        </div>
      )}

      <div className="assumption-strip">
        <span>Market assumptions:</span>
        <span><strong>S&P 500</strong> {A.stockReturn}%/yr</span>
        <span><strong>US Treasuries</strong> {A.bondReturn}%/yr</span>
        <span><strong>Cash</strong> {A.cashReturn}%/yr</span>
        <span><strong>Inflation</strong> {A.inflation}%</span>
        <button type="button" className="link" onClick={() => go('plan')}>Edit</button>
      </div>

      {plan.accounts.length === 0 && (
        <Card><Empty icon={<Wallet size={28} />} title="No accounts yet" action={<Button variant="primary" icon={<Plus size={16} />} onClick={add}>Add your first account</Button>}>Add checking, brokerage, 401(k), Roth, HSA and your home to start modeling.</Empty></Card>
      )}
      <div className="acct-list">
        {plan.accounts.map((a) => (
          <AccountEditor
            key={a.id}
            a={a}
            plan={plan}
            onChange={(na) => update((p) => ({ ...p, accounts: p.accounts.map((x) => (x.id === a.id ? na : x)) }))}
            onDelete={() => update((p) => ({
              ...p,
              accounts: p.accounts.filter((x) => x.id !== a.id),
              assumptions: p.assumptions.surplusAccountId === a.id ? { ...p.assumptions, surplusAccountId: null } : p.assumptions,
            }))}
          />
        ))}
      </div>
    </div>
  );
}
