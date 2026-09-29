import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { useApp } from '../App';
import { usePlan } from '../store';
import { Card, StatTile } from '../components/ui';
import { PartsBar } from '../components/charts';
import { computeTaxes, LIMITS_2026, propertyTaxFor, saltCap, SS_WAGE_BASE, TAX_YEAR, FED_BRACKETS_MFJ, FED_BRACKETS_SINGLE, CA_BRACKETS_MFJ, CA_BRACKETS_SINGLE, type Bracket } from '../engine/tax';
import { fmtCompact, fmtPct, fmtUSD } from '../format';
import type { Owner } from '../engine/types';
import { latestValue } from '../engine/history';
import { amortize } from '../engine/debt';
import { defaultPropertyTax } from '../engine/defaults';

function BracketBar({ brackets, taxable, c, label }: { brackets: Bracket[]; taxable: number; c: string; label: string }) {
  // Show brackets up to a bit beyond your taxable income.
  const maxX = Math.max(taxable * 1.35, brackets[2][0]);
  const segs: { rate: number; w: number; filled: number }[] = [];
  let prev = 0;
  for (const [upTo, rate] of brackets) {
    if (prev >= maxX) break;
    const end = Math.min(upTo, maxX);
    segs.push({ rate, w: end - prev, filled: Math.max(0, Math.min(taxable, end) - prev) });
    prev = end;
  }
  return (
    <div className="brackets" role="img" aria-label={`${label} brackets`}>
      {segs.map((sg) => (
        <div key={sg.rate} className="bracket" style={{ flexGrow: sg.w }}>
          <div className="bracket-track"><span style={{ width: `${(sg.filled / sg.w) * 100}%`, background: c }} /></div>
          <span className="bracket-rate">{+(sg.rate * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

export default function Taxes() {
  const { plan } = usePlan();
  const { chart: c, sim } = useApp();
  const m = plan.married;
  const age = TAX_YEAR - plan.self.birthYear;
  const sAge = TAX_YEAR - plan.spouse.birthYear;
  const working = (o: Owner) => (o === 'spouse' ? m && sAge < plan.spouse.retirementAge : age < plan.self.retirementAge);
  // Contributions you entered plus leftover-income top-ups from the savings waterfall (today's $).
  const r1 = sim.projection.rows[1];
  const auto401 = r1 ? r1.surplusTo401k / r1.inflation : 0;
  const autoHsa = r1 ? r1.surplusToHSA / r1.inflation : 0;
  const trad = plan.accounts.filter((a) => a.type === 'traditional' && working(a.owner)).reduce((s, a) => s + a.contribution, 0) + auto401;
  const hsa = plan.accounts.filter((a) => a.type === 'hsa' && working(a.owner)).reduce((s, a) => s + a.contribution, 0) + autoHsa;
  const wages = [age < plan.self.retirementAge ? plan.self.income : 0, ...(m ? [sAge < plan.spouse.retirementAge ? plan.spouse.income : 0] : [])];
  const gross = wages.reduce((a, b) => a + b, 0);
  // This year's property tax on each home and mortgage interest over the next 12 months.
  const homes = plan.accounts.filter((a) => a.type === 'property' && latestValue(a.history) > 0).map((a) => {
    const info = a.propertyTax ?? defaultPropertyTax();
    const value = latestValue(a.history);
    const assessed = Math.min(info.assessedValue ?? value, value);
    const now = propertyTaxFor(info, assessed, 0, value, 1).tax;
    // In 20 years (today's $): assessed +2%/yr vs. inflation.
    const f20 = Math.pow(1 + plan.assumptions.inflation / 100, 20);
    const later = propertyTaxFor(info, assessed, 20, value * Math.pow(1 + a.returnRate / 100, 20), f20).tax / f20;
    return { a, info, value, assessed, now, later };
  });
  const propertyTax = homes.reduce((s, h) => s + h.now, 0);
  let mortgageInterest = 0;
  let mortgageBalance = 0;
  for (const d of plan.debts.filter((x) => x.type === 'mortgage')) {
    const bal = latestValue(d.history);
    const rows = amortize(bal, d.rate, d.monthlyPayment, d.extraPayment).rows.slice(0, 12);
    mortgageInterest += rows.reduce((s, r) => s + r.interest, 0);
    mortgageBalance += (bal + (rows.at(-1)?.balance ?? bal)) / 2;
  }
  const home = { propertyTax, mortgageInterest, mortgageBalance };
  const t = computeTaxes({ married: m, wages, pretaxRetirement: trad, hsaContrib: hsa, ordinaryOther: 0, socialSecurity: 0, longTermGains: 0, seniors: 0, ...home });
  const noPretax = computeTaxes({ married: m, wages, pretaxRetirement: 0, hsaContrib: 0, ordinaryOther: 0, socialSecurity: 0, longTermGains: 0, seniors: 0, ...home });
  const noHomeDeductions = computeTaxes({ married: m, wages, pretaxRetirement: trad, hsaContrib: hsa, ordinaryOther: 0, socialSecurity: 0, longTermGains: 0, seniors: 0 });
  const homeSavings = noHomeDeductions.federal + noHomeDeductions.state - t.federal - t.state;
  const saved = noPretax.total - t.total;
  const ficaMarginal = wages.some((w) => w < SS_WAGE_BASE) ? 0.062 : 0;
  const medMarginal = 0.0145 + (gross > (m ? 250_000 : 200_000) ? 0.009 : 0);
  const combined = t.marginalFederal + t.marginalState + ficaMarginal + medMarginal + 0.013;
  const takeHome = gross - t.total - trad - hsa - propertyTax;

  // First full retirement year from the projection
  const rRow = sim.projection.rows.find((r) => r.age > plan.self.retirementAge && r.wages === 0 && r.withdrawals > 0);

  // Contribution limit checks
  const checks: { label: string; amount: number; limit: number }[] = [];
  const catchUp401 = (a: number) => (a >= 60 && a <= 63 ? LIMITS_2026.k401CatchUp60to63 : a >= 50 ? LIMITS_2026.k401CatchUp50 : 0);
  for (const [owner, who, a] of [['self', plan.self.name || 'You', age], ['spouse', plan.spouse.name || 'Spouse', sAge]] as const) {
    if (owner === 'spouse' && !m) continue;
    const k = plan.accounts.filter((x) => x.type === 'traditional' && x.owner === owner).reduce((s, x) => s + x.contribution, 0);
    if (k > 0) checks.push({ label: `${who}: pre-tax 401(k) deferrals`, amount: k, limit: LIMITS_2026.k401 + catchUp401(a) });
  }
  const hsaTotal = plan.accounts.filter((x) => x.type === 'hsa').reduce((s, x) => s + x.contribution + x.employerContribution, 0);
  if (hsaTotal > 0) checks.push({ label: 'HSA (family, incl. employer)', amount: hsaTotal, limit: LIMITS_2026.hsaFamily + (age >= 55 ? LIMITS_2026.hsaCatchUp55 : 0) });

  return (
    <div className="stack">
      <div className="stats stats-4">
        <StatTile label={`Estimated ${TAX_YEAR} taxes`} value={fmtCompact(t.total)} sub={`on ${fmtCompact(gross)} of wages${propertyTax > 0 ? ` · plus ${fmtCompact(propertyTax)} property tax` : ''}`} />
        <StatTile label="Effective rate" value={fmtPct(t.effectiveRate)} sub="all taxes ÷ gross income" />
        <StatTile label="Marginal rate" value={fmtPct(combined)} sub={`fed ${fmtPct(t.marginalFederal, 0)} · CA ${fmtPct(t.marginalState)} · payroll ${fmtPct(ficaMarginal + medMarginal + 0.013)}`} />
        <StatTile label="Saved by pre-tax accounts" value={fmtCompact(saved)} sub={`${fmtUSD(trad + hsa)} of 401(k) + HSA`} />
      </div>

      <div className="grid-2">
        <Card title="Where your paycheck goes" subtitle={`${m ? 'Married filing jointly' : 'Single'} · ${plan.location || 'California'} · ${t.federalItemized ? 'itemized deductions' : 'standard deduction'}`}>
          <PartsBar
            parts={[
              { label: 'Federal income tax', value: t.federal, color: c.series[0] },
              { label: 'California income tax', value: t.state, color: c.series[1] },
              { label: 'Social Security (6.2%)', value: t.socialSecurityTax, color: c.series[2] },
              { label: 'Medicare', value: t.medicare, color: c.series[3] },
              { label: 'CA SDI (1.3%)', value: t.sdi, color: c.series[4] },
              { label: 'Pre-tax 401(k) + HSA', value: trad + hsa, color: c.series[6] },
              ...(propertyTax > 0 ? [{ label: 'Property tax', value: propertyTax, color: c.type.property }] : []),
              { label: 'Take-home pay', value: takeHome, color: c.wages },
            ]}
            total={gross}
          />
        </Card>
        <Card title="Bracket position" subtitle="How far your taxable income reaches into each bracket">
          <div className="bracket-block">
            <div className="bracket-head"><span>Federal</span><span className="muted small">taxable {fmtUSD(t.federalTaxable)}</span></div>
            <BracketBar brackets={m ? FED_BRACKETS_MFJ : FED_BRACKETS_SINGLE} taxable={t.federalTaxable} c={c.series[0]} label="Federal" />
          </div>
          <div className="bracket-block">
            <div className="bracket-head"><span>California</span><span className="muted small">taxable {fmtUSD(t.stateTaxable)}</span></div>
            <BracketBar brackets={m ? CA_BRACKETS_MFJ : CA_BRACKETS_SINGLE} taxable={t.stateTaxable} c={c.series[1]} label="California" />
          </div>
          <p className="muted small">Each extra pre-tax dollar you defer saves about {fmtPct(t.marginalFederal + t.marginalState, 1)} in income tax today. California taxes HSA contributions, so HSAs save only the federal portion there.</p>
        </Card>
      </div>

      <div className="grid-2">
        <Card title={`${TAX_YEAR} contribution limits`}>
          {checks.length === 0 && <p className="muted">No pre-tax contributions entered.</p>}
          {auto401 + autoHsa > 1 && (
            <p className="muted small">Leftover income tops these up automatically: about {fmtUSD(auto401)} more to 401(k)s{autoHsa > 1 ? ` and ${fmtUSD(autoHsa)} to the HSA` : ''} this year (included in the estimate above).</p>
          )}
          <ul className="checks">
            {checks.map((k) => {
              const over = k.amount > k.limit;
              return (
                <li key={k.label}>
                  <span className={`status ${over ? 'status-critical' : 'status-good'}`}>{over ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}</span>
                  <div>
                    <div>{k.label}</div>
                    <div className="meter meter-thin"><span style={{ width: `${Math.min(100, (k.amount / k.limit) * 100)}%`, background: over ? c.critical : c.series[0] }} /></div>
                    <div className="muted small">{fmtUSD(k.amount)} of {fmtUSD(k.limit)} {over ? `— ${fmtUSD(k.amount - k.limit)} over the limit` : `— ${fmtUSD(k.limit - k.amount)} room left`}</div>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="muted small">Other {TAX_YEAR} limits: IRA {fmtUSD(LIMITS_2026.ira)} (+{fmtUSD(LIMITS_2026.iraCatchUp50)} at 50+) — at your income use a backdoor Roth. HSA self-only {fmtUSD(LIMITS_2026.hsaSelf)}.</p>
        </Card>
        <Card title="In retirement" subtitle={rRow ? `First full retirement year: age ${rRow.age} (${rRow.year}), today's dollars` : 'No retirement withdrawals in the projection'}>
          {rRow ? (
            <dl className="kv">
              <div><dt>Withdrawals from savings</dt><dd>{fmtUSD(rRow.withdrawals / rRow.inflation)}</dd></div>
              <div><dt>Social Security & other income</dt><dd>{fmtUSD((rRow.socialSecurity + rRow.otherIncome) / rRow.inflation)}</dd></div>
              <div><dt>Federal tax</dt><dd>{fmtUSD(rRow.federalTax / rRow.inflation)}</dd></div>
              <div><dt>California tax</dt><dd>{fmtUSD(rRow.stateTax / rRow.inflation)}</dd></div>
              {rRow.propertyTax > 0 && <div><dt>Property tax</dt><dd>{fmtUSD(rRow.propertyTax / rRow.inflation)}</dd></div>}
              {rRow.irmaa > 0 && <div><dt>Medicare IRMAA surcharge</dt><dd>{fmtUSD(rRow.irmaa / rRow.inflation)}</dd></div>}
              {rRow.penalty > 0 && <div><dt>Early-withdrawal penalty</dt><dd className="text-bad">{fmtUSD(rRow.penalty / rRow.inflation)}</dd></div>}
              <div><dt>Effective rate on cash received</dt><dd>{fmtPct(rRow.taxes / Math.max(1, rRow.withdrawals + rRow.socialSecurity + rRow.otherIncome))}</dd></div>
            </dl>
          ) : <p className="muted">—</p>}
          <p className="muted small">San Francisco has no personal income tax. Moving to a no-income-tax state in retirement would remove the California line.</p>
        </Card>
      </div>
      <div className="grid-2">
        <Card title="Deductions" subtitle={`${TAX_YEAR}: itemizing vs. the standard deduction`}>
          <dl className="kv">
            <div><dt>Property tax</dt><dd>{fmtUSD(propertyTax)}</dd></div>
            <div><dt>California income tax</dt><dd>{fmtUSD(t.state)}</dd></div>
            <div><dt>Federal SALT deduction (capped)</dt><dd>{fmtUSD(t.saltDeducted)}</dd></div>
            <div><dt>Mortgage interest (next 12 months)</dt><dd>{fmtUSD(mortgageInterest)}</dd></div>
            <div><dt>Federal deduction</dt><dd>{fmtUSD(t.federalDeduction)} · {t.federalItemized ? 'itemized' : 'standard'}</dd></div>
            <div><dt>California deduction</dt><dd>{fmtUSD(t.stateDeduction)} · {t.stateItemized ? 'itemized' : 'standard'}</dd></div>
            {homeSavings > 1 && <div><dt>Income tax saved by home deductions</dt><dd className="text-good">{fmtUSD(homeSavings)}</dd></div>}
          </dl>
          <p className="muted small">
            Federal: state income + property tax deductible up to the SALT cap ({fmtUSD(saltCap(TAX_YEAR, 0))} in {TAX_YEAR}, lower above $505K of income, back to $10,000 in 2030); mortgage interest on up to $750K of debt. California: property tax without a cap, interest on up to $1M, no deduction for state income tax.
          </p>
        </Card>
        <Card title="Property tax" subtitle="California Prop 13: assessed value can rise at most 2% a year until you sell">
          {homes.length === 0 ? (
            <p className="muted">No real estate. Add your home on the Accounts page to include property tax.</p>
          ) : (
            <>
              <dl className="kv">
                {homes.map((h) => (
                  <div key={h.a.id}>
                    <dt>{h.a.name}<span className="muted small"> · assessed {fmtUSD(h.assessed)} of {fmtUSD(h.value)} market{h.info.assessedValue == null ? ' (enter your tax bill value)' : ''}</span></dt>
                    <dd>{fmtUSD(h.now)}/yr</dd>
                  </div>
                ))}
                <div><dt>Monthly</dt><dd>{fmtUSD(propertyTax / 12)}/mo</dd></div>
                <div><dt>In 20 years (today's $)</dt><dd>{fmtUSD(homes.reduce((s, h) => s + h.later, 0))}/yr</dd></div>
              </dl>
              <p className="muted small">The 2% cap trails inflation, so the real cost of property tax slowly shrinks while you stay in the home. It never goes away after the mortgage is paid off.</p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
