import {
  TrendingUp, PiggyBank, CreditCard, ShieldCheck, Target, Hourglass, AlertTriangle, CheckCircle2, Info,
  Flag, Landmark, HeartPulse, CalendarClock, Sparkles, Umbrella,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useApp } from '../App';
import { usePlan } from '../store';
import { Card, Segmented, StatTile, Button } from '../components/ui';
import { NetWorthTimeline, PartsBar } from '../components/charts';
import { currentTotals, latestValue, netWorthHistory } from '../engine/history';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_SHORT } from '../engine/types';
import { benefitAtClaim } from '../engine/socialSecurity';
import { buildMilestones, type MilestoneKind } from '../engine/milestones';
import { fmtCompact, fmtPct, fmtSigned, fmtUSD, fmtDate } from '../format';

export function successTone(p: number): 'good' | 'warning' | 'serious' | 'critical' {
  if (p >= 0.85) return 'good';
  if (p >= 0.7) return 'warning';
  if (p >= 0.5) return 'serious';
  return 'critical';
}

export function successLabel(p: number) {
  return { good: 'On track', warning: 'Borderline', serious: 'At risk', critical: 'Off track' }[successTone(p)];
}

export function StatusIcon({ tone, size = 16 }: { tone: string; size?: number }) {
  if (tone === 'good') return <CheckCircle2 size={size} />;
  if (tone === 'warning') return <Info size={size} />;
  return <AlertTriangle size={size} />;
}

export function isEmptyPlan(plan: { accounts: unknown[]; debts: unknown[]; self: { income: number } }) {
  return plan.accounts.length === 0 && plan.debts.length === 0 && plan.self.income === 0;
}

function GettingStarted() {
  const { resetSample, openFile } = usePlan();
  const { go } = useApp();
  const steps = [
    { n: 1, title: 'Tell us about your household', text: 'Ages, retirement ages, incomes, Social Security estimates and spending.', cta: 'Open plan', to: 'plan' as const },
    { n: 2, title: 'Add your accounts', text: '401(k)s, IRAs, Roth, HSA, brokerage, savings and your home — each with its own expected return.', cta: 'Add accounts', to: 'accounts' as const },
    { n: 3, title: 'Add debts', text: 'Mortgage, car loans, student loans — with rates and monthly payments.', cta: 'Add debts', to: 'debts' as const },
    { n: 4, title: 'Update balances over time', text: 'Every month or quarter, hit “Update balances” to record a snapshot and build your history.', cta: 'View history', to: 'history' as const },
  ];
  return (
    <div className="stack">
      <Card title="Let's build your plan" subtitle="Four steps. Everything saves automatically in this browser; use Save to keep a file copy.">
        <ol className="steps">
          {steps.map((s) => (
            <li key={s.n}>
              <span className="step-n">{s.n}</span>
              <div>
                <strong>{s.title}</strong>
                <p className="muted">{s.text}</p>
              </div>
              <Button size="sm" onClick={() => go(s.to)}>{s.cta}</Button>
            </li>
          ))}
        </ol>
        <div className="inline" style={{ marginTop: 16 }}>
          <Button variant="ghost" onClick={openFile}>Open a saved file</Button>
          <Button variant="ghost" onClick={resetSample}>Explore with sample data</Button>
        </div>
      </Card>
    </div>
  );
}

export default function Dashboard() {
  const { plan, isSample, startFresh } = usePlan();
  const { sim, chart: c, real, setReal, go, openUpdate } = useApp();
  const { projection: pr, mc } = sim;
  const [range, setRange] = useState<'5' | 'retire' | 'all'>('retire');
  const totals = currentTotals(plan);
  const hist = netWorthHistory(plan);
  const nwDelta = hist.length >= 2 ? hist.at(-1)!.netWorth - hist.at(-2)!.netWorth : null;
  const retireRow = pr.rows[pr.retireIndex];
  const atRetireReal = retireRow ? retireRow.liquid / retireRow.inflation : 0;
  const wr = plan.assumptions.withdrawalRate / 100;
  const fiNumber = plan.retirementSpending / wr;
  const yearsToRetire = Math.max(0, plan.self.retirementAge - pr.currentAge);
  const next = pr.rows[1];
  const tone = mc ? successTone(mc.successRate) : undefined;
  const ssToday = 12 * (benefitAtClaim(plan, 'self').monthly + (plan.married ? benefitAtClaim(plan, 'spouse').monthly : 0));

  const milestones = buildMilestones(plan, pr);
  const MS_ICON: Record<MilestoneKind, ReactNode> = {
    debt: <Landmark size={16} />, retire: <Flag size={16} />, ss: <Umbrella size={16} />, medicare: <HeartPulse size={16} />,
    irmaa: <HeartPulse size={16} />, ltc: <HeartPulse size={16} />, rmd: <CalendarClock size={16} />, event: <Sparkles size={16} />,
    depletion: <AlertTriangle size={16} />,
  };

  const byType = ACCOUNT_TYPES.map((t) => ({
    label: ACCOUNT_TYPE_SHORT[t],
    value: plan.accounts.filter((a) => a.type === t).reduce((s, a) => s + latestValue(a.history), 0),
    color: c.type[t],
  })).filter((p) => p.value > 0);

  if (isEmptyPlan(plan)) return <GettingStarted />;

  return (
    <div className="stack">
      {isSample && (
        <div className="banner">
          <Sparkles size={18} />
          <div>
            <strong>You're looking at a sample San Francisco household.</strong> Edit anything to make it yours, or start from a blank plan.
          </div>
          <Button size="sm" onClick={startFresh}>Start blank</Button>
          <Button size="sm" variant="primary" onClick={() => go('accounts')}>Edit accounts</Button>
        </div>
      )}

      <div className="stats">
        <StatTile
          icon={<TrendingUp size={16} />}
          label="Net worth"
          value={fmtCompact(totals.netWorth)}
          delta={nwDelta != null ? fmtSigned(nwDelta) : undefined}
          deltaGood={(nwDelta ?? 0) >= 0}
          sub={hist.length >= 2 ? `since ${fmtDate(hist.at(-2)!.date)}` : 'record more updates to see change'}
        />
        <StatTile icon={<PiggyBank size={16} />} label="Investable assets" value={fmtCompact(totals.liquid)} sub={`${fmtPct(fiNumber > 0 ? totals.liquid / fiNumber : 0, 0)} of FI target ${fmtCompact(fiNumber)}`} />
        <StatTile icon={<CreditCard size={16} />} label="Total debt" value={fmtCompact(totals.debts)} sub={`${plan.debts.length} ${plan.debts.length === 1 ? 'loan' : 'loans'}`} />
        <StatTile
          icon={<ShieldCheck size={16} />}
          label="Plan success"
          value={mc ? fmtPct(mc.successRate, 0) : '—'}
          loading={!mc}
          tone={tone}
          sub={mc ? <span className={`status status-${tone}`}><StatusIcon tone={tone!} size={13} /> {successLabel(mc.successRate)} · {mc.sims} simulations</span> : 'simulating…'}
        />
        <StatTile icon={<Target size={16} />} label={`Spendable at ${plan.self.retirementAge}`} value={fmtCompact(atRetireReal)} sub={`today's $ · in ${yearsToRetire} yrs`} />
        <StatTile
          icon={<Hourglass size={16} />}
          label="Sustainable spending"
          value={sim.spending != null ? `${fmtCompact(sim.spending)}/yr` : '—'}
          loading={sim.spending == null}
          sub={sim.spending != null
            ? `${plan.assumptions.targetSuccess}% confidence · earliest retirement ${sim.earliest ?? '80+'}`
            : 'searching…'}
        />
      </div>

      <Card
        title="Net worth over time"
        subtitle="Recorded balances (as entered) and the projected path from today with expected returns"
        actions={
          <div className="inline">
            <Segmented value={range} onChange={setRange} options={[{ value: '5', label: '5Y' }, { value: 'retire', label: 'To retirement' }, { value: 'all', label: 'All' }]} />
            <Segmented value={real ? 'real' : 'nominal'} onChange={(v) => setReal(v === 'real')} options={[{ value: 'real', label: "Today's $" }, { value: 'nominal', label: 'Nominal' }]} />
          </div>
        }
      >
        <NetWorthTimeline history={hist} projection={pr} real={real} c={c} years={range === '5' ? 5 : range === 'retire' ? Math.max(1, pr.retireIndex + 2) : undefined} />
      </Card>

      <div className="grid-2">
        <Card title="Retirement outlook" subtitle={`Retiring at ${plan.self.retirementAge}, planning to age ${plan.lifeExpectancy}`}>
          {mc && (
            <div className="meter-block">
              <div className="meter-head">
                <span className={`status status-${tone}`}><StatusIcon tone={tone!} /> {successLabel(mc.successRate)}</span>
                <strong>{fmtPct(mc.successRate, 0)}</strong>
              </div>
              <div className={`meter meter-${tone}`}><span style={{ width: `${mc.successRate * 100}%` }} /></div>
              <p className="muted small">
                Share of {mc.sims} market simulations where your spendable savings last through age {plan.lifeExpectancy}.
              </p>
            </div>
          )}
          <dl className="kv">
            <div><dt>Target retirement spending</dt><dd>{fmtUSD(plan.retirementSpending)}/yr</dd></div>
            <div><dt>Spendable savings at retirement</dt><dd>{fmtUSD(atRetireReal)}</dd></div>
            <div><dt>{plan.assumptions.withdrawalRate}% rule income from savings</dt><dd>{fmtUSD(atRetireReal * wr)}/yr</dd></div>
            <div><dt>Social Security, both claimed (today's $)</dt><dd>{fmtUSD(ssToday)}/yr</dd></div>
            <div><dt>Healthcare over retirement (today's $)</dt><dd>{fmtUSD(pr.rows.reduce((s, r) => s + r.healthcare / r.inflation, 0))}</dd></div>
            <div><dt>Sustainable spending ({plan.assumptions.targetSuccess}% confidence)</dt><dd>{sim.spending != null ? `${fmtUSD(sim.spending)}/yr` : '…'}</dd></div>
            <div><dt>Earliest retirement age ({plan.assumptions.targetSuccess}% confidence)</dt><dd>{sim.searchPending && sim.earliest == null ? '…' : sim.earliest ?? 'Not before 80'}</dd></div>
            <div><dt>Median savings at {plan.lifeExpectancy} (today's $)</dt><dd>{mc ? fmtUSD(mc.medianEndingReal) : '…'}</dd></div>
          </dl>
          <div className="card-cta"><Button size="sm" onClick={() => go('projections')}>Explore scenarios →</Button></div>
        </Card>

        <Card title="Next 12 months" subtitle="Where household income goes, based on your plan inputs">
          {next && next.wages > 0 ? (
            <PartsBar
              parts={[
                { label: 'Taxes', value: next.taxes, color: c.series[6] },
                { label: 'Your retirement & savings contributions', value: next.contributions, color: c.series[0] },
                { label: 'Debt payments', value: next.debtPayments, color: c.debt },
                { label: 'Property tax & upkeep', value: next.propertyTax + next.homeUpkeep, color: c.type.property },
                { label: 'Living expenses', value: next.spending + next.eventsOut, color: c.series[3] },
                { label: 'Leftover → 401(k) & HSA top-ups', value: next.surplusTo401k + next.surplusToHSA, color: c.series[4] },
                { label: 'Leftover → brokerage', value: next.surplusToBrokerage, color: c.series[2] },
                { label: 'Leftover spent (not invested)', value: next.surplus - next.surplusInvested, color: c.wages },
              ].filter((p) => p.value > 1 || p.label === 'Taxes' || p.label === 'Living expenses').concat([
                ...(next.withdrawals > 0 ? [{ label: 'Shortfall covered from savings', value: next.withdrawals, color: c.critical }] : []),
              ])}
              total={next.wages + next.otherIncome + next.eventsIn + next.withdrawals + next.socialSecurity}
            />
          ) : (
            <p className="muted">Add your income on the Plan page to see your cash flow.</p>
          )}
          {next && next.wages > 0 && (
            <p className="muted small">
              Employer contributions add another {fmtUSD(next.employerContributions)}. Savings rate: <strong>{fmtPct((next.contributions + next.employerContributions + next.surplusInvested) / Math.max(1, next.wages + next.employerContributions), 0)}</strong> of gross pay.
            </p>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Asset mix" subtitle="Current balances by account type" actions={<Button size="sm" variant="ghost" onClick={() => go('accounts')}>Manage</Button>}>
          {byType.length ? <PartsBar parts={byType} /> : <p className="muted">No accounts yet.</p>}
        </Card>
        <Card title="Milestones" subtitle="By year · the number is your age" actions={<Button size="sm" variant="ghost" onClick={openUpdate}>Update balances</Button>}>
          <ol className="timeline">
            {milestones.map((m, i) => (
              <li key={i}>
                <span className="tl-age">{m.age}</span>
                <span className="tl-icon">{MS_ICON[m.kind]}</span>
                <span className="tl-text">
                  {m.kind === 'depletion' ? <strong className="text-critical">{m.label}</strong> : m.label}
                  {m.ownerAge != null && <span className="muted"> at {m.ownerAge}</span>}
                  {m.amount != null && <span className="muted"> ({fmtSigned(m.amount)})</span>}
                  <span className="muted small"> · {m.year}</span>
                </span>
              </li>
            ))}
            {pr.depletionAge == null && (
              <li>
                <span className="tl-age">{plan.lifeExpectancy}</span>
                <span className="tl-icon"><CheckCircle2 size={16} /></span>
                <span className="tl-text">Plan horizon — savings last with typical returns<span className="muted small"> · {plan.self.birthYear + plan.lifeExpectancy}</span></span>
              </li>
            )}
          </ol>
        </Card>
      </div>
    </div>
  );
}
