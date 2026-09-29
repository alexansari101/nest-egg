import { Download, ChevronDown, ChevronUp, LineChart } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../App';
import { usePlan } from '../store';
import { Button, Card, Empty, Segmented, Slider, StatTile, Toggle } from '../components/ui';
import { BalanceSheetChart, FanChart, HealthcareChart, IncomeSourcesChart, TaxesOverTime } from '../components/charts';
import { fmtCompact, fmtPct, fmtUSD } from '../format';
import { successLabel, successTone, StatusIcon, isEmptyPlan } from './Dashboard';
import type { YearRow } from '../engine/projection';

function toCSV(rows: YearRow[], real: boolean): string {
  const cols: [string, (r: YearRow) => number | string][] = [
    ['Year', (r) => r.year], ['Age', (r) => r.age], ['Spouse age', (r) => r.spouseAge ?? ''],
    ['Wages', (r) => r.wages], ['Social Security', (r) => r.socialSecurity], ['Other income', (r) => r.otherIncome + r.eventsIn],
    ['Contributions (yours)', (r) => r.contributions], ['Employer contributions', (r) => r.employerContributions],
    ['Living expenses', (r) => r.spending - r.healthcare],
    ['Healthcare (pre-65 insurance)', (r) => r.preMedicare], ['Medicare', (r) => r.medicare], ['IRMAA', (r) => r.irmaa], ['Long-term care', (r) => r.ltc], ['One-time spending', (r) => r.eventsOut], ['Debt payments', (r) => r.debtPayments], ['Property tax', (r) => r.propertyTax], ['Home upkeep', (r) => r.homeUpkeep], ['HSA paid medical', (r) => r.hsaMedical], ['Itemized federal deduction', (r) => (r.federalItemized ? r.federalDeduction : 0)],
    ['Federal tax', (r) => r.federalTax], ['CA tax', (r) => r.stateTax], ['Payroll tax', (r) => r.payrollTax], ['Penalty', (r) => r.penalty],
    ['Withdrawals', (r) => r.withdrawals], ['RMD', (r) => r.rmd], ['Surplus invested', (r) => r.surplusInvested], ['Shortfall', (r) => r.shortfall],
    ['Spendable assets', (r) => r.liquid], ['Total assets', (r) => r.assets], ['Debt', (r) => r.totalDebt], ['Net worth', (r) => r.netWorth],
  ];
  const head = cols.map((c) => c[0]).join(',');
  const body = rows.map((r) => cols.map(([name, f]) => {
    const v = f(r);
    if (typeof v !== 'number' || ['Year', 'Age', 'Spouse age'].includes(name)) return v;
    return Math.round(real ? v / r.inflation : v);
  }).join(','));
  return [head, ...body].join('\n');
}

export default function Projections() {
  const { plan, update } = usePlan();
  const { sim, chart: c, real, setReal, go } = useApp();
  const { projection: pr, mc } = sim;
  const [includeHome, setIncludeHome] = useState(true);
  const [showTable, setShowTable] = useState(false);
  const age0 = pr.currentAge;
  const d = (r: YearRow, v: number) => (real ? v / r.inflation : v);
  const retire = pr.rows[pr.retireIndex];
  const peak = pr.rows.reduce((m, r) => (d(r, r.liquid) > d(m, m.liquid) ? r : m), pr.rows[0]);
  const lifetimeTax = pr.rows.reduce((s, r) => s + d(r, r.taxes + r.propertyTax), 0);
  const lifetimePropertyTax = pr.rows.reduce((s, r) => s + d(r, r.propertyTax), 0);
  const lifetimeHealthcare = pr.rows.reduce((s, r) => s + d(r, r.healthcare), 0);
  const tone = mc ? successTone(mc.successRate) : undefined;

  const exportCSV = () => {
    const url = URL.createObjectURL(new Blob([toCSV(pr.rows, real)], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `nestegg-projection-${real ? 'real' : 'nominal'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isEmptyPlan(plan)) {
    return (
      <Card>
        <Empty icon={<LineChart size={28} />} title="Nothing to project yet" action={<Button variant="primary" onClick={() => go('accounts')}>Add accounts</Button>}>
          Add your accounts and income, and this page will project your balance sheet, retirement income, taxes and a range of market outcomes.
        </Empty>
      </Card>
    );
  }

  return (
    <div className="stack">
      <div className="proj-layout">
        <Card title="What if…" subtitle="Changes here update your saved plan" className="scenario">
          <Slider label="Your retirement age" value={plan.self.retirementAge} min={Math.max(age0, 40)} max={75} format={(n) => `${n}`}
            onChange={(n) => update((p) => ({ ...p, self: { ...p.self, retirementAge: n } }))} />
          {plan.married && (
            <Slider label="Spouse's retirement age" value={plan.spouse.retirementAge} min={40} max={75} format={(n) => `${n}`}
              onChange={(n) => update((p) => ({ ...p, spouse: { ...p.spouse, retirementAge: n } }))} />
          )}
          <Slider label="Retirement spending" value={plan.retirementSpending} min={20_000} max={Math.max(400_000, plan.retirementSpending)} step={5_000} format={(n) => `${fmtCompact(n)}/yr`}
            onChange={(n) => update((p) => ({ ...p, retirementSpending: n }))} />
          <Slider label="Current living expenses" value={plan.annualSpending} min={0} max={Math.max(400_000, plan.annualSpending)} step={2_500} format={(n) => `${fmtCompact(n)}/yr`}
            onChange={(n) => update((p) => ({ ...p, annualSpending: n }))} />
          <Slider label={plan.married ? "Both claim Social Security at" : "Claim Social Security at"} value={plan.self.ssClaimAge} min={62} max={70} format={(n) => `${n}`}
            onChange={(n) => update((p) => ({ ...p, self: { ...p.self, ssClaimAge: n }, spouse: { ...p.spouse, ssClaimAge: n } }))} />
          <Slider label="Market stress test" value={plan.assumptions.returnShift} min={-4} max={2} step={0.25} format={(n) => `${n > 0 ? '+' : ''}${n.toFixed(2)} pts`}
            onChange={(n) => update((p) => ({ ...p, assumptions: { ...p.assumptions, returnShift: n } }))} />
          <Slider label="Inflation" value={plan.assumptions.inflation} min={1} max={6} step={0.25} format={(n) => `${n.toFixed(2)}%`}
            onChange={(n) => update((p) => ({ ...p, assumptions: { ...p.assumptions, inflation: n } }))} />
          <Slider label="Plan until age" value={plan.lifeExpectancy} min={Math.max(age0 + 5, 75)} max={110} format={(n) => `${n}`}
            onChange={(n) => update((p) => ({ ...p, lifeExpectancy: n }))} />
        </Card>

        <div className="stack">
          <div className="stats stats-4">
            <StatTile label="Chance of success" value={mc ? fmtPct(mc.successRate, 0) : '—'} loading={!mc || sim.mcPending} tone={tone}
              sub={mc ? <span className={`status status-${tone}`}><StatusIcon tone={tone!} size={13} /> {successLabel(mc.successRate)}</span> : '…'} />
            <StatTile label={`Spendable at ${plan.self.retirementAge}`} value={retire ? fmtCompact(d(retire, retire.liquid)) : '—'} sub={real ? "today's $" : 'nominal'} />
            <StatTile label="Peak savings" value={fmtCompact(d(peak, peak.liquid))} sub={`at age ${peak.age}`} />
            <StatTile label="Lifetime taxes" value={fmtCompact(lifetimeTax)} sub={`incl. ${fmtCompact(lifetimePropertyTax)} property tax · ${real ? "today's $" : 'nominal'}`} />
          </div>
          <Card
            title="Projected balance sheet"
            subtitle="Assets by type, debt below the line, with typical (median) returns"
            actions={
              <div className="inline">
                <Toggle checked={includeHome} onChange={setIncludeHome} label="Home" />
                <Segmented value={real ? 'real' : 'nominal'} onChange={(v) => setReal(v === 'real')} options={[{ value: 'real', label: "Today's $" }, { value: 'nominal', label: 'Nominal' }]} />
              </div>
            }
          >
            <BalanceSheetChart projection={pr} real={real} c={c} includeProperty={includeHome} />
          </Card>
        </div>
      </div>

      <Card
        title="Range of outcomes"
        subtitle={mc ? `Spendable savings across ${mc.sims} simulated markets, in today's dollars. ${mc.depletionAges.length ? `In failing runs, money ran out at a median age of ${[...mc.depletionAges].sort((a, b) => a - b)[Math.floor(mc.depletionAges.length / 2)]}.` : 'No simulated run ran out of money.'}` : 'Simulating…'}
      >
        {mc ? <FanChart mc={mc} retireAge={plan.self.retirementAge} c={c} /> : <div className="chart-skeleton" />}
      </Card>

      <Card title="Retirement paycheck" subtitle={`Where each year's money comes from vs. what you need (living costs, healthcare, property tax & upkeep, debt, income taxes and any saving)${real ? " · today's $" : ''}`}>
        <IncomeSourcesChart projection={pr} real={real} c={c} fromAge={Math.max(age0 + 1, plan.self.retirementAge - 3)} />
      </Card>

      <Card
        title="Healthcare costs"
        subtitle={`Private insurance until 65, then Medicare, IRMAA surcharges${plan.healthcare.ltc.enabled ? ' and long-term care' : ''} · ${fmtUSD(lifetimeHealthcare)} over retirement${real ? " in today's $" : ''}`}
      >
        <HealthcareChart projection={pr} real={real} c={c} />
      </Card>

      <Card title="Taxes over time" subtitle={`Federal, California, payroll and property taxes (Prop 13 keeps property tax growth to 2%/yr)${real ? " · today's $" : ''}`}>
        <TaxesOverTime projection={pr} real={real} c={c} />
      </Card>

      <Card
        title="Year-by-year"
        subtitle={real ? "Today's dollars" : 'Nominal dollars'}
        actions={
          <div className="inline">
            <Button size="sm" icon={<Download size={15} />} onClick={exportCSV}>CSV</Button>
            <Button size="sm" icon={showTable ? <ChevronUp size={15} /> : <ChevronDown size={15} />} onClick={() => setShowTable((s) => !s)}>{showTable ? 'Hide' : 'Show'} table</Button>
          </div>
        }
      >
        {showTable ? (
          <div className="table-wrap tall">
            <table className="table data-table">
              <thead>
                <tr>
                  <th>Age</th><th>Year</th><th>Income</th><th>Taxes</th><th>Spending</th><th>Healthcare</th><th>Debt pmts</th><th>Home costs</th><th>Saved</th><th>Withdrawn</th><th>Spendable</th><th>Debt</th><th>Net worth</th>
                </tr>
              </thead>
              <tbody>
                {pr.rows.map((r) => (
                  <tr key={r.k} className={`${r.age === plan.self.retirementAge ? 'row-mark' : ''} ${r.shortfall > 0 ? 'row-bad' : ''}`}>
                    <td>{r.age}</td>
                    <td className="muted">{r.year}</td>
                    <td>{fmtUSD(d(r, r.wages + r.socialSecurity + r.otherIncome + r.eventsIn))}</td>
                    <td>{fmtUSD(d(r, r.taxes))}</td>
                    <td>{fmtUSD(d(r, r.spending - r.healthcare + r.eventsOut))}</td>
                    <td>{fmtUSD(d(r, r.healthcare))}</td>
                    <td>{fmtUSD(d(r, r.debtPayments))}</td>
                    <td title="Property tax + upkeep">{fmtUSD(d(r, r.propertyTax + r.homeUpkeep))}</td>
                    <td>{fmtUSD(d(r, r.contributions + r.employerContributions + r.surplusInvested))}</td>
                    <td>{fmtUSD(d(r, r.withdrawals))}</td>
                    <td>{fmtUSD(d(r, r.liquid))}</td>
                    <td>{fmtUSD(d(r, r.totalDebt))}</td>
                    <td><strong>{fmtUSD(d(r, r.netWorth))}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">Every projected year with income, taxes, savings, withdrawals and balances. Retirement year is highlighted; shortfall years are flagged.</p>
        )}
      </Card>
    </div>
  );
}
