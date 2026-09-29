import { Plus, Trash2 } from 'lucide-react';
import { usePlan } from '../store';
import { useApp } from '../App';
import { todayISO } from '../engine/history';
import { Button, Card, Field, NumberInput, Select, TextInput, Toggle } from '../components/ui';
import type { Assumptions, IncomeStream, LifeEvent, Person, Plan } from '../engine/types';
import { uid } from '../engine/defaults';
import { fmtUSD } from '../format';
import { benefitAtClaim, estimatePIA, realRaiseOf, ssFactor } from '../engine/socialSecurity';
import { blend } from '../engine/returns';
import { PART_B_2026 } from '../engine/healthcare';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

function PersonFields({ plan, which, onChange, who }: { plan: Plan; which: 'self' | 'spouse'; onChange: (p: Person) => void; who: string }) {
  const p = plan[which];
  const set = <K extends keyof Person>(k: K, v: Person[K]) => onChange({ ...p, [k]: v });
  const age = new Date().getFullYear() - p.birthYear;
  const est = estimatePIA(p, realRaiseOf(plan));
  const b = benefitAtClaim(plan, which);
  const firstName = which === 'self' ? 'your' : 'their';

  const ssHint = p.ssEstimate ? (
    <>
      {p.income > 0
        ? <>Estimated from {est.years} yrs of earnings (ages 22–{21 + est.years}) with SSA's formula. </>
        : <>No income entered. </>}
      Type your <a href="https://www.ssa.gov/myaccount/" target="_blank" rel="noreferrer">ssa.gov</a> figure to override.
    </>
  ) : (
    <>From {firstName} statement · <button type="button" className="link" onClick={() => onChange({ ...p, ssEstimate: true })}>use estimate ({fmtUSD(est.own)})</button></>
  );

  return (
    <div className="form-grid">
      <Field label="Name"><TextInput value={p.name} onChange={(v) => set('name', v)} ariaLabel={`${who} name`} /></Field>
      <Field label="Birth year" hint={`Age ${age} this year`}>
        <NumberInput value={p.birthYear} min={1920} max={2015} step={1} onChange={(n) => set('birthYear', Math.round(n))} ariaLabel={`${who} birth year`} />
      </Field>
      <Field label="Retirement age" hint={`In ${Math.max(0, p.retirementAge - age)} years · ${p.birthYear + p.retirementAge}`}>
        <NumberInput value={p.retirementAge} min={age} max={85} step={1} onChange={(n) => set('retirementAge', Math.round(n))} ariaLabel={`${who} retirement age`} />
      </Field>
      <Field label="Gross annual income" hint="Salary + bonus + RSUs">
        <NumberInput prefix="$" value={p.income} onChange={(n) => set('income', n)} ariaLabel={`${who} income`} />
      </Field>
      <Field label={p.ssEstimate ? 'Social Security at 67 · estimated' : 'Social Security at 67'} hint={ssHint}>
        <NumberInput
          prefix="$"
          suffix="/mo"
          value={p.ssEstimate ? est.own : p.ssBenefitFRA}
          onChange={(n) => onChange({ ...p, ssEstimate: false, ssBenefitFRA: n })}
          ariaLabel={`${who} social security`}
        />
      </Field>
      <Field
        label="Claim Social Security at"
        hint={b.usesSpousal
          ? `Spousal benefit (half of ${plan[which === 'self' ? 'spouse' : 'self'].name || 'spouse'}'s) is higher → ${fmtUSD(b.monthly)}/mo${p.ssClaimAge < 67 ? ` (${fmtUSD(b.spousal)} at 67)` : ''}`
          : `${(ssFactor(p.ssClaimAge) * 100).toFixed(0)}% of full benefit → ${fmtUSD(b.monthly)}/mo`}
      >
        <NumberInput value={p.ssClaimAge} min={62} max={70} step={1} onChange={(n) => set('ssClaimAge', Math.round(n))} ariaLabel={`${who} claim age`} />
      </Field>
    </div>
  );
}

export default function PlanPage() {
  const { plan, update } = usePlan();
  const set = <K extends keyof Plan>(k: K, v: Plan[K]) => update((p) => ({ ...p, [k]: v }));
  const setA = <K extends keyof Assumptions>(k: K, v: Assumptions[K]) => update((p) => ({ ...p, assumptions: { ...p.assumptions, [k]: v } }));
  const A = plan.assumptions;
  const [advanced, setAdvanced] = useState(false);
  const { sim } = useApp();
  const H = plan.healthcare;
  const setH = (patch: Partial<Plan['healthcare']>) => update((p) => ({ ...p, healthcare: { ...p.healthcare, ...patch } }));
  const setLtc = (patch: Partial<Plan['healthcare']['ltc']>) => setH({ ltc: { ...H.ltc, ...patch } });
  const hcStats = sim.projection.rows.reduce(
    (s, r) => ({
      total: s.total + r.healthcare / r.inflation,
      pre: s.pre + r.preMedicare / r.inflation,
      medicare: s.medicare + r.medicare / r.inflation,
      irmaa: s.irmaa + r.irmaa / r.inflation,
      ltc: s.ltc + r.ltc / r.inflation,
    }),
    { total: 0, pre: 0, medicare: 0, irmaa: 0, ltc: 0 },
  );
  const next = sim.projection.rows[1];
  const synthetic = sim.projection.syntheticAccounts;
  const addSynthetic = () =>
    update((p) => ({
      ...p,
      accounts: [
        ...p.accounts,
        ...synthetic.map(({ synthetic: _s, ...a }) => ({ ...a, id: uid(), history: [{ date: todayISO(), value: 0 }] })),
      ],
    }));

  const setStream = (id: string, patch: Partial<IncomeStream>) =>
    update((p) => ({ ...p, incomeStreams: p.incomeStreams.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const setEvent = (id: string, patch: Partial<LifeEvent>) =>
    update((p) => ({ ...p, events: p.events.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const age0 = new Date().getFullYear() - plan.self.birthYear;

  return (
    <div className="stack">
      <Card title="Household" subtitle="Used for ages, income, Social Security and tax filing status" actions={<Toggle checked={plan.married} onChange={(b) => set('married', b)} label={plan.married ? 'Married, filing jointly' : 'Single'} />}>
        <div className="form-grid" style={{ marginBottom: 16 }}>
          <Field label="Location" hint="Taxes modeled for California; San Francisco has no personal income tax" wide>
            <TextInput value={plan.location} onChange={(v) => set('location', v)} ariaLabel="Location" />
          </Field>
        </div>
        <h4 className="sub-head">You</h4>
        <PersonFields plan={plan} which="self" who="Your" onChange={(p) => set('self', p)} />
        {plan.married && (
          <>
            <h4 className="sub-head">Spouse</h4>
            <PersonFields plan={plan} which="spouse" who="Spouse" onChange={(p) => set('spouse', p)} />
          </>
        )}
      </Card>

      <Card title="Spending & horizon" subtitle="In today's dollars — the model grows them with inflation">
        <div className="form-grid">
          <Field label="Current living expenses / yr" hint="Everything except taxes, savings and debt payments: food, insurance, childcare, travel… Property tax is added separately from your home.">
            <NumberInput prefix="$" value={plan.annualSpending} onChange={(n) => set('annualSpending', n)} ariaLabel="Current spending" />
          </Field>
          <Field label="Target retirement spending / yr" hint={<>Excludes healthcare, property tax and debt payments (added separately){plan.annualSpending > 0 && plan.retirementSpending !== plan.annualSpending && <> · <button type="button" className="link" onClick={() => set('retirementSpending', plan.annualSpending)}>same as today</button></>}</>}>
            <NumberInput prefix="$" value={plan.retirementSpending} onChange={(n) => set('retirementSpending', n)} ariaLabel="Retirement spending" />
          </Field>
          <Field label="Plan until your age" hint="Life expectancy horizon — plan conservatively (90–100)">
            <NumberInput value={plan.lifeExpectancy} min={age0 + 1} max={115} step={1} onChange={(n) => set('lifeExpectancy', Math.round(n))} ariaLabel="Life expectancy" />
          </Field>
        </div>
      </Card>

      <Card
        title="Healthcare"
        subtitle="Per person, today's dollars. Employer coverage is assumed while either of you works (its cost is in living expenses); after that each person pays these until and after 65."
      >
        {hcStats.total > 0 && (
          <div className="flow">
            <div className="flow-total"><span className="muted small">Healthcare from retirement on</span><strong>{fmtUSD(hcStats.total)}</strong></div>
            <div><span className="muted small">Before Medicare</span><strong>{fmtUSD(hcStats.pre)}</strong></div>
            <div><span className="muted small">Medicare</span><strong>{fmtUSD(hcStats.medicare)}</strong></div>
            {H.includeIRMAA && <div><span className="muted small">IRMAA surcharges</span><strong>{fmtUSD(hcStats.irmaa)}</strong></div>}
            {H.ltc.enabled && <div><span className="muted small">Long-term care</span><strong>{fmtUSD(hcStats.ltc)}</strong></div>}
          </div>
        )}
        <div className="form-grid">
          <Field label="Before Medicare, per person / yr" hint="Covered California premiums for ages 55–64 run ~$900–1,300/mo unsubsidized, plus deductibles and copays">
            <NumberInput prefix="$" value={H.pre65PerPerson} onChange={(n) => setH({ pre65PerPerson: n })} ariaLabel="Pre-Medicare cost per person" />
          </Field>
          <Field label="Medicare, per person / yr" hint={`Part B ($${PART_B_2026}/mo in 2026) + Part D + Medigap Plan G + dental, vision, copays. ~$7,500 is typical in CA.`}>
            <NumberInput prefix="$" value={H.medicarePerPerson} onChange={(n) => setH({ medicarePerPerson: n })} ariaLabel="Medicare cost per person" />
          </Field>
          <Field label="Healthcare inflation premium" hint="How much faster than inflation costs rise today (medical costs have run ~1–3 points ahead). Fades to zero over 30 years.">
            <NumberInput suffix="pts" value={A.healthcareInflationExtra} decimals={2} step={0.5} onChange={(n) => setA('healthcareInflationExtra', n)} ariaLabel="Healthcare inflation" />
          </Field>
          <Field label="Medicare income surcharges (IRMAA)" hint="Higher Part B/D premiums when income two years earlier exceeds $218K (married). Large RMDs can trigger this.">
            <Toggle checked={H.includeIRMAA} onChange={(b) => setH({ includeIRMAA: b })} label={H.includeIRMAA ? 'Included' : 'Ignored'} />
          </Field>
        </div>
        <h4 className="sub-head">Long-term care stress test</h4>
        <div className="form-grid">
          <Field label="Include long-term care" hint="About half of people 65+ need some paid care; most stays are under 2–3 years">
            <Toggle checked={H.ltc.enabled} onChange={(b) => setLtc({ enabled: b })} label={H.ltc.enabled ? 'On' : 'Off'} />
          </Field>
          {H.ltc.enabled && (
            <>
              <Field label="Starts at your age">
                <NumberInput value={H.ltc.startAge} min={60} max={110} step={1} onChange={(n) => setLtc({ startAge: Math.round(n) })} ariaLabel="Care start age" />
              </Field>
              <Field label="Years of care, per person">
                <NumberInput value={H.ltc.years} min={1} max={15} step={1} onChange={(n) => setLtc({ years: Math.round(n) })} ariaLabel="Years of care" />
              </Field>
              <Field label="Annual cost (today's price)" hint="Bay Area: home care ~$90K, assisted living ~$100K, nursing home private room ~$180K+. Grows with healthcare inflation.">
                <NumberInput prefix="$" value={H.ltc.annualCost} onChange={(n) => setLtc({ annualCost: n })} ariaLabel="Care annual cost" />
              </Field>
              {plan.married && (
                <Field label="Who needs care">
                  <Select value={String(H.ltc.people)} onChange={(v) => setLtc({ people: Number(v) as 1 | 2 })} options={[{ value: '1', label: 'One of us' }, { value: '2', label: 'Both, back to back' }]} ariaLabel="Who needs care" />
                </Field>
              )}
            </>
          )}
        </div>
      </Card>

      <Card title="Leftover income" subtitle="What happens to pay left after taxes, living expenses, debt payments and the contributions on your accounts, while either of you is working.">
        {next && next.wages > 0 && (
          <div className="flow">
            <div className="flow-total"><span className="muted small">Next year left over</span><strong>{fmtUSD(next.surplus)}</strong></div>
            <span className="flow-arrow">→</span>
            <div><span className="muted small">401(k) top-up</span><strong>{fmtUSD(next.surplusTo401k)}</strong></div>
            <div><span className="muted small">HSA top-up</span><strong>{fmtUSD(next.surplusToHSA)}</strong></div>
            <div><span className="muted small">Brokerage</span><strong>{fmtUSD(next.surplusToBrokerage)}</strong></div>
            {next.surplus - next.surplusInvested > 1 && <div><span className="muted small">Spent / not invested</span><strong>{fmtUSD(next.surplus - next.surplusInvested)}</strong></div>}
          </div>
        )}
        <div className="form-grid">
          <Field label="Share that gets invested" hint="100% assumes lifestyle doesn't grow with pay. Lower it if raises tend to get spent.">
            <NumberInput suffix="%" value={A.surplusSavePct} min={0} max={100} step={5} onChange={(n) => setA('surplusSavePct', n)} ariaLabel="Share invested" />
          </Field>
          <Field label="1. Top up 401(k)s" hint="Up to the IRS limit for each working spouse (incl. catch-ups), counting what you already contribute. Pre-tax.">
            <Toggle checked={A.surplusTo401k} onChange={(b) => setA('surplusTo401k', b)} label={A.surplusTo401k ? 'On' : 'Off'} />
          </Field>
          <Field label="2. Then top up the HSA" hint="Up to the family limit. Needs a high-deductible health plan. Pre-tax federally.">
            <Toggle checked={A.surplusToHSA} onChange={(b) => setA('surplusToHSA', b)} label={A.surplusToHSA ? 'On' : 'Off'} />
          </Field>
          <Field label="3. The rest goes to">
            <Select
              value={A.surplusAccountId ?? ''}
              onChange={(v) => setA('surplusAccountId', v || null)}
              options={[{ value: '', label: 'Brokerage (auto)' }, ...plan.accounts.filter((a) => a.type !== 'property' && a.type !== 'traditional' && a.type !== 'hsa').map((a) => ({ value: a.id, label: a.name }))]}
              ariaLabel="Remainder account"
            />
          </Field>
        </div>
        {synthetic.length > 0 && (
          <p className="muted small" style={{ marginTop: 12 }}>
            You don't have {synthetic.map((a) => a.name).join(', ')} yet, so the projection models {synthetic.length > 1 ? 'them' : 'it'} starting at $0.{' '}
            <button type="button" className="link" onClick={addSynthetic}>Add {synthetic.length > 1 ? 'them' : 'it'} to your accounts</button>
          </p>
        )}
      </Card>

      <Card title="Market assumptions" subtitle="Long-run nominal returns that drive every account's “Invested in” mix. Stocks = S&P 500 index, bonds = intermediate US Treasuries.">
        <div className="form-grid">
          <Field label="Stocks (S&P 500) return" hint="~10% historically; 7–8% is a common forward estimate">
            <NumberInput suffix="%" value={A.stockReturn} decimals={2} step={0.25} onChange={(n) => setA('stockReturn', n)} ariaLabel="Stock return" />
          </Field>
          <Field label="Bonds (US Treasuries) return" hint="Roughly today's 5–10 year Treasury yield">
            <NumberInput suffix="%" value={A.bondReturn} decimals={2} step={0.25} onChange={(n) => setA('bondReturn', n)} ariaLabel="Bond return" />
          </Field>
          <Field label="Cash / savings rate" hint="High-yield savings & T-bills">
            <NumberInput suffix="%" value={A.cashReturn} decimals={2} step={0.25} onChange={(n) => setA('cashReturn', n)} ariaLabel="Cash return" />
          </Field>
          <Field label="Inflation" hint="Long-run CPI; the Fed targets 2%">
            <NumberInput suffix="%" value={A.inflation} decimals={2} step={0.25} onChange={(n) => setA('inflation', n)} ariaLabel="Inflation" />
          </Field>
          <Field label="Annual raises" hint="Growth of pay and contributions">
            <NumberInput suffix="%" value={A.incomeGrowth} decimals={2} step={0.25} onChange={(n) => setA('incomeGrowth', n)} ariaLabel="Income growth" />
          </Field>
        </div>
        <p className="muted small" style={{ marginTop: 12 }}>
          Resulting mixes: 100% stocks ≈ {blend(100, A).rate.toFixed(1)}%/yr · 60/40 ≈ {blend(60, A).rate.toFixed(1)}%/yr · all Treasuries ≈ {blend(0, A).rate.toFixed(1)}%/yr.
        </p>
        <button type="button" className={`more-toggle ${advanced ? 'open' : ''}`} onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>
          <ChevronDown size={15} /> Advanced assumptions
        </button>
        {advanced && (
          <div className="form-grid">
            <Field label="Stock volatility" hint="Annual std dev of the S&P 500 (~16%)">
              <NumberInput suffix="%" value={A.stockVolatility} decimals={1} step={1} min={0} onChange={(n) => setA('stockVolatility', n)} ariaLabel="Stock volatility" />
            </Field>
            <Field label="Bond volatility" hint="Intermediate Treasuries (~6%)">
              <NumberInput suffix="%" value={A.bondVolatility} decimals={1} step={1} min={0} onChange={(n) => setA('bondVolatility', n)} ariaLabel="Bond volatility" />
            </Field>
            <Field label="Market stress test" hint="Shifts every investment return, e.g. −1 for a weak decade">
              <NumberInput suffix="pts" value={A.returnShift} decimals={2} step={0.25} onChange={(n) => setA('returnShift', n)} ariaLabel="Return shift" />
            </Field>
            <Field label="Custom accounts in retirement" hint="Return change after retiring, for accounts with a custom return">
              <NumberInput suffix="pts" value={A.retirementReturnShift} decimals={2} step={0.25} onChange={(n) => setA('retirementReturnShift', n)} ariaLabel="Retirement return shift" />
            </Field>
            <Field label="Safe withdrawal rate" hint="For the rule-of-thumb readouts only">
              <NumberInput suffix="%" value={A.withdrawalRate} decimals={2} step={0.25} min={1} max={10} onChange={(n) => setA('withdrawalRate', n)} ariaLabel="Withdrawal rate" />
            </Field>
            <Field label="Confidence target" hint="For sustainable spending & earliest retirement">
              <NumberInput suffix="%" value={A.targetSuccess} min={50} max={99} step={5} onChange={(n) => setA('targetSuccess', n)} ariaLabel="Target success" />
            </Field>
            <Field label="Monte Carlo simulations">
              <Select value={String(A.simulations)} onChange={(v) => setA('simulations', Number(v))} options={['250', '500', '1000', '2000'].map((v) => ({ value: v, label: `${v} runs` }))} ariaLabel="Simulations" />
            </Field>
          </div>
        )}
      </Card>

      <Card
        title="Other retirement income"
        subtitle="Pensions, annuities, rental income, part-time work — by your age"
        actions={<Button size="sm" icon={<Plus size={15} />} onClick={() => update((p) => ({ ...p, incomeStreams: [...p.incomeStreams, { id: uid(), name: 'Pension', amount: 20_000, startAge: plan.self.retirementAge, endAge: plan.lifeExpectancy + 1, taxable: true, inflationAdjusted: true }] }))}>Add income</Button>}
      >
        {plan.incomeStreams.length === 0 ? (
          <p className="muted">None. Add a pension, rental property income, or part-time consulting in early retirement.</p>
        ) : (
          <div className="table-wrap">
            <table className="table edit-table">
              <thead><tr><th>Name</th><th>Amount / yr (today's $)</th><th>From age</th><th>Until age</th><th>Taxable</th><th>Inflation-adjusted</th><th /></tr></thead>
              <tbody>
                {plan.incomeStreams.map((s) => (
                  <tr key={s.id}>
                    <td><TextInput value={s.name} onChange={(v) => setStream(s.id, { name: v })} ariaLabel="Income name" /></td>
                    <td><NumberInput prefix="$" value={s.amount} onChange={(n) => setStream(s.id, { amount: n })} ariaLabel="Amount" compact /></td>
                    <td><NumberInput value={s.startAge} onChange={(n) => setStream(s.id, { startAge: Math.round(n) })} ariaLabel="Start age" compact /></td>
                    <td><NumberInput value={s.endAge} onChange={(n) => setStream(s.id, { endAge: Math.round(n) })} ariaLabel="End age" compact /></td>
                    <td><Toggle checked={s.taxable} onChange={(b) => setStream(s.id, { taxable: b })} /></td>
                    <td><Toggle checked={s.inflationAdjusted} onChange={(b) => setStream(s.id, { inflationAdjusted: b })} /></td>
                    <td><Button variant="ghost" icon={<Trash2 size={15} />} title="Remove" onClick={() => update((p) => ({ ...p, incomeStreams: p.incomeStreams.filter((x) => x.id !== s.id) }))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="One-time events"
        subtitle="Big purchases, college, weddings, inheritance, selling a home. Negative = spending. Today's $."
        actions={<Button size="sm" icon={<Plus size={15} />} onClick={() => update((p) => ({ ...p, events: [...p.events, { id: uid(), name: 'New car', age: age0 + 3, amount: -45_000 }] }))}>Add event</Button>}
      >
        {plan.events.length === 0 ? (
          <p className="muted">No events.</p>
        ) : (
          <div className="table-wrap">
            <table className="table edit-table">
              <thead><tr><th>Event</th><th>Your age</th><th>Year</th><th>Amount (today's $)</th><th /></tr></thead>
              <tbody>
                {[...plan.events].sort((a, b) => a.age - b.age).map((e) => (
                  <tr key={e.id}>
                    <td><TextInput value={e.name} onChange={(v) => setEvent(e.id, { name: v })} ariaLabel="Event name" /></td>
                    <td><NumberInput value={e.age} onChange={(n) => setEvent(e.id, { age: Math.round(n) })} ariaLabel="Event age" compact /></td>
                    <td className="muted">{plan.self.birthYear + e.age}</td>
                    <td><NumberInput prefix="$" value={e.amount} onChange={(n) => setEvent(e.id, { amount: n })} ariaLabel="Event amount" compact /></td>
                    <td><Button variant="ghost" icon={<Trash2 size={15} />} title="Remove" onClick={() => update((p) => ({ ...p, events: p.events.filter((x) => x.id !== e.id) }))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="How the model works">
        <ul className="notes">
          <li>Each year: income and Social Security come in; taxes (federal, California, FICA, CA SDI), living expenses, healthcare, debt payments, property tax, home upkeep and your contributions go out. Any gap is withdrawn from savings — cash first, then taxable brokerage, pre-tax, Roth, and HSA last — with withdrawals grossed up for the taxes they trigger. Once you pay for your own healthcare, the HSA pays those bills first, tax-free.</li>
          <li>Contributions stop when the account owner retires. Employer contributions are added on top of yours.</li>
          <li>Pay left over after taxes, spending, debt payments and contributions is invested each working year: first topping up 401(k)s to the IRS limit, then the HSA, then brokerage. Taxes are recalculated because the first two are pre-tax. In retirement, any excess (such as large RMDs) is reinvested in brokerage.</li>
          <li>Pre-tax withdrawals before 59 pay a 10% penalty. Required minimum distributions start at 75 (73 if born before 1960); any excess is reinvested.</li>
          <li>Social Security is estimated with SSA's formula: pay from age 22 to retirement (lower earlier in your career), capped at the wage base, top 35 years averaged, 2026 bend points. A spouse gets the larger of their own benefit or 50% of the other's. Early retirement means fewer earning years and a smaller benefit.</li>
          <li>Healthcare is modeled per person: employer coverage while either of you works; then private insurance until 65; then Medicare (Part B, D, Medigap, out-of-pocket) plus IRMAA income surcharges based on income two years earlier. Costs rise at inflation plus a healthcare premium that fades to zero over 30 years. Optional long-term care adds years of care at a set cost. HSA withdrawals are tax-free up to the medical costs incurred; beyond that they are taxed (+20% before 65).</li>
          <li>Up to 85% of Social Security is federally taxable; California doesn't tax it. California doesn't allow the HSA deduction and taxes capital gains as ordinary income.</li>
          <li>Each account's return comes from its mix: stocks are an S&P 500 index fund, bonds are intermediate US Treasuries, cash earns the savings rate. Target-date accounts hold 90% stocks until 25 years before the owner retires, glide to 50% at retirement and 30% seven years later.</li>
          <li>The projected balance sheet and timeline use typical (median) returns: each account's expected return minus volatility drag (about 1.2 points for the S&P 500), so they line up with the middle of the Monte Carlo range. Monte Carlo draws yearly returns from each account's expected return and volatility and counts how often savings last through your horizon. Accounts share the same yearly stock and bond shocks in proportion to what they hold, so all your S&P 500 money falls together in a bad year while Treasuries barely move with it (homes are modeled as 0.3 correlated with stocks). Inflation is held at your assumption rather than simulated.</li>
          <li>This is a planning tool, not tax or investment advice. Not modeled: AMT, NIIT, itemized deductions, Roth conversions, spousal/survivor Social Security benefits, dividend tax drag.</li>
        </ul>
      </Card>
    </div>
  );
}
