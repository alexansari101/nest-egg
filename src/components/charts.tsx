import {
  Area, AreaChart, Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { ReactNode } from 'react';
import type { ChartTheme } from '../theme';
import type { Account, AccountType, Debt } from '../engine/types';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_SHORT } from '../engine/types';
import type { ProjectionResult, YearRow } from '../engine/projection';
import type { MonteCarloResult } from '../engine/montecarlo';
import type { NetWorthPoint } from '../engine/history';
import { fmtCompact, fmtMonthYear, fmtUSD } from '../format';
import { Legend } from './ui';

const yearFrac = (t: number) => {
  const d = new Date(t);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return d.getUTCFullYear() + (t - start) / (365.25 * 864e5);
};

function axisProps(c: ChartTheme) {
  return {
    stroke: c.axis,
    tick: { fill: c.muted, fontSize: 12 },
    tickLine: false,
    axisLine: { stroke: c.axis },
  } as const;
}

function yAxisProps(c: ChartTheme) {
  return {
    ...axisProps(c),
    axisLine: false,
    width: 64,
    tickFormatter: (v: number) => fmtCompact(v, 1),
  } as const;
}

interface TipRow { label: string; value: number | string; color?: string; kind?: 'line' | 'swatch'; strong?: boolean }

function TipBox({ title, rows, foot }: { title: ReactNode; rows: TipRow[]; foot?: ReactNode }) {
  return (
    <div className="tip">
      <div className="tip-title">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className={`tip-row ${r.strong ? 'strong' : ''}`}>
          {r.color && <span className={`legend-key ${r.kind ?? 'swatch'}`} style={{ ['--c' as string]: r.color }} />}
          <span className="tip-label">{r.label}</span>
          <span className="tip-val">{typeof r.value === 'number' ? fmtUSD(r.value) : r.value}</span>
        </div>
      ))}
      {foot && <div className="tip-foot">{foot}</div>}
    </div>
  );
}

const cursor = (c: ChartTheme) => ({ stroke: c.muted, strokeWidth: 1 });

// ---------------------------------------------------------------------------
// Net worth: recorded history + projection on a single timeline
// ---------------------------------------------------------------------------

export function NetWorthTimeline({
  history, projection, real, c, height = 320, years,
}: { history: NetWorthPoint[]; projection: ProjectionResult; real: boolean; c: ChartTheme; height?: number; years?: number }) {
  const now = yearFrac(Date.now());
  type P = { x: number; actual?: number; projected?: number; age?: number; label: string };
  const pts: P[] = history.map((h) => ({ x: yearFrac(h.t), actual: h.netWorth, label: fmtMonthYear(h.t) }));
  const proj: P[] = projection.rows.filter((r) => years == null || r.k <= years).map((r) => ({
    x: now + r.k,
    projected: real ? r.netWorth / r.inflation : r.netWorth,
    age: r.age,
    label: `${r.year} · age ${r.age}`,
  }));
  // Join the lines at today so the projection visibly continues from the latest actual.
  if (pts.length) proj[0] = { ...proj[0], actual: pts.at(-1)!.actual };
  const data = [...pts, ...proj].sort((a, b) => a.x - b.x);
  const retireX = now + projection.retireIndex;
  const minX = Math.floor(data[0]?.x ?? now);
  const maxX = Math.ceil(data.at(-1)?.x ?? now + 1);
  const ticks: number[] = [];
  const span = maxX - minX;
  const stepYears = span > 40 ? 10 : span > 16 ? 5 : span > 8 ? 2 : 1;
  for (let y = Math.ceil(minX / stepYears) * stepYears; y <= maxX; y += stepYears) ticks.push(y);

  return (
    <div>
      <Legend items={[
        { label: 'Recorded', color: c.ink, kind: 'line' },
        { label: real ? "Projected (today's $)" : 'Projected (nominal)', color: c.series[0], kind: 'line' },
      ]} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 16, right: 16, bottom: 4, left: 0 }}>
          <defs>
            <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c.series[0]} stopOpacity={0.18} />
              <stop offset="100%" stopColor={c.series[0]} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="x" type="number" domain={[minX, maxX]} ticks={ticks} tickFormatter={(v) => String(Math.round(v))} {...axisProps(c)} />
          <YAxis {...yAxisProps(c)} />
          <Tooltip
            cursor={cursor(c)}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as P;
              const rows: TipRow[] = [];
              if (p.actual != null) rows.push({ label: 'Recorded', value: p.actual, color: c.ink, kind: 'line' });
              if (p.projected != null) rows.push({ label: 'Projected', value: p.projected, color: c.series[0], kind: 'line' });
              return <TipBox title={p.label} rows={rows} />;
            }}
          />
          <ReferenceLine x={now} stroke={c.axis} label={{ value: 'Today', position: 'insideTopLeft', fill: c.muted, fontSize: 11 }} />
          {projection.retireIndex > 0 && retireX <= maxX && (
            <ReferenceLine x={retireX} stroke={c.axis} label={{ value: 'Retire', position: 'insideTopLeft', fill: c.muted, fontSize: 11 }} />
          )}
          <Area type="monotone" dataKey="projected" stroke={c.series[0]} strokeWidth={2} fill="url(#nwFill)" connectNulls isAnimationActive={false} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: c.surface }} />
          <Line type="monotone" dataKey="actual" stroke={c.ink} strokeWidth={2} connectNulls isAnimationActive={false} dot={{ r: 3, fill: c.ink, stroke: c.surface, strokeWidth: 2 }} activeDot={{ r: 5, strokeWidth: 2, stroke: c.surface }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Projected balance sheet: assets stacked by account type, debts below zero, net worth line
// ---------------------------------------------------------------------------

export function BalanceSheetChart({
  projection, real, c, includeProperty, height = 360,
}: { projection: ProjectionResult; real: boolean; c: ChartTheme; includeProperty: boolean; height?: number }) {
  const types = ACCOUNT_TYPES.filter((t) => (includeProperty || t !== 'property') && projection.rows.some((r) => r.byType[t] > 0));
  const data = projection.rows.map((r) => {
    const d = real ? r.inflation : 1;
    const row: Record<string, number> = { age: r.age, year: r.year };
    let assets = 0;
    for (const t of types) {
      row[t] = r.byType[t] / d;
      assets += r.byType[t] / d;
    }
    // A zero would flip to the positive stack under stackOffset="sign"; keep it just below.
    row.debt = -Math.max(r.totalDebt / d, 1e-6);
    row.net = assets - r.totalDebt / d;
    return row;
  });
  const hasDebt = data.some((d) => d.debt < -1);
  return (
    <div>
      <Legend items={[
        ...types.map((t) => ({ label: ACCOUNT_TYPE_SHORT[t], color: c.type[t] })),
        ...(hasDebt ? [{ label: 'Debt', color: c.debt }] : []),
        { label: includeProperty ? 'Net worth' : 'Net (ex. home)', color: c.ink, kind: 'line' as const },
      ]} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} stackOffset="sign" margin={{ top: 16, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="age" {...axisProps(c)} interval="preserveStartEnd" minTickGap={24} />
          <YAxis {...yAxisProps(c)} />
          <Tooltip
            cursor={cursor(c)}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as Record<string, number>;
              const rows: TipRow[] = [...types]
                .reverse()
                .filter((t) => p[t] > 0)
                .map((t) => ({ label: ACCOUNT_TYPE_SHORT[t], value: p[t], color: c.type[t] }));
              if (p.debt < -1) rows.push({ label: 'Debt', value: p.debt, color: c.debt });
              rows.push({ label: 'Net', value: p.net, color: c.ink, kind: 'line', strong: true });
              return <TipBox title={`Age ${p.age} · ${p.year}`} rows={rows} />;
            }}
          />
          <ReferenceLine y={0} stroke={c.axis} />
          <ReferenceLine x={projection.rows[projection.retireIndex]?.age} stroke={c.muted} strokeDasharray="0" label={{ value: 'Retire', position: 'insideTopLeft', fill: c.muted, fontSize: 11 }} />
          {types.map((t) => (
            <Area key={t} type="monotone" dataKey={t} stackId="a" stroke={c.surface} strokeWidth={1.5} fill={c.type[t]} fillOpacity={0.85} isAnimationActive={false} />
          ))}
          {hasDebt && <Area type="monotone" dataKey="debt" stackId="a" stroke={c.surface} strokeWidth={1.5} fill={c.debt} fillOpacity={0.7} isAnimationActive={false} />}
          <Line type="monotone" dataKey="net" stroke={c.ink} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monte Carlo fan chart of spendable assets (today's $)
// ---------------------------------------------------------------------------

export function FanChart({ mc, retireAge, c, height = 320 }: { mc: MonteCarloResult; retireAge: number; c: ChartTheme; height?: number }) {
  const data = mc.bands.map((b) => ({ ...b, outer: [b.p10, b.p90], inner: [b.p25, b.p75] }));
  return (
    <div>
      <Legend items={[
        { label: 'Median', color: c.series[0], kind: 'line' },
        { label: '25th–75th percentile', color: c.series[0] + '55' },
        { label: '10th–90th percentile', color: c.series[0] + '22' },
      ]} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 16, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="age" {...axisProps(c)} interval="preserveStartEnd" minTickGap={24} />
          <YAxis {...yAxisProps(c)} />
          <Tooltip
            cursor={cursor(c)}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const b = payload[0].payload as MonteCarloResult['bands'][number];
              return (
                <TipBox
                  title={`Age ${b.age} · today's $`}
                  rows={[
                    { label: '90th pct (great markets)', value: b.p90 },
                    { label: '75th pct', value: b.p75 },
                    { label: 'Median', value: b.p50, color: c.series[0], kind: 'line', strong: true },
                    { label: '25th pct', value: b.p25 },
                    { label: '10th pct (poor markets)', value: b.p10 },
                  ]}
                />
              );
            }}
          />
          <ReferenceLine x={retireAge} stroke={c.muted} label={{ value: 'Retire', position: 'insideTopLeft', fill: c.muted, fontSize: 11 }} />
          <Area type="monotone" dataKey="outer" stroke="none" fill={c.series[0]} fillOpacity={0.13} isAnimationActive={false} activeDot={false} />
          <Area type="monotone" dataKey="inner" stroke="none" fill={c.series[0]} fillOpacity={0.28} isAnimationActive={false} activeDot={false} />
          <Line type="monotone" dataKey="p50" stroke={c.series[0]} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Where retirement money comes from each year, vs. what you need
// ---------------------------------------------------------------------------

const WD_TYPES: AccountType[] = ['cash', 'taxable', 'traditional', 'roth', 'hsa', 'other'];

export type PaycheckView = 'sources' | 'uses';

export function IncomeSourcesChart({
  projection, real, c, fromAge, height = 340, view = 'sources',
}: { projection: ProjectionResult; real: boolean; c: ChartTheme; fromAge?: number; height?: number; view?: PaycheckView }) {
  const start = fromAge ?? projection.rows[projection.retireIndex]?.age ?? 0;
  const rows = projection.rows.filter((r) => r.k > 0 && r.age >= start);
  if (view === 'uses') return <PaycheckUsesChart rows={rows} real={real} c={c} height={height} />;
  const keys = [
    { key: 'wages', label: 'Wages', color: c.wages },
    { key: 'ss', label: 'Social Security', color: c.ss },
    { key: 'other', label: 'Pension & other', color: c.otherIncome },
    ...WD_TYPES.map((t) => ({ key: `wd_${t}`, label: `From ${ACCOUNT_TYPE_SHORT[t]}`, color: c.type[t] })),
  ];
  const data = rows.map((r) => {
    const d = real ? r.inflation : 1;
    const o: Record<string, number> = {
      age: r.age,
      year: r.year,
      wages: r.wages / d,
      ss: r.socialSecurity / d,
      other: (r.otherIncome + r.eventsIn) / d,
      need: (r.spending + r.debtPayments + r.propertyTax + r.homeUpkeep + r.taxes + r.eventsOut + r.contributions) / d,
      propertyTax: r.propertyTax / d,
      upkeep: r.homeUpkeep / d,
      spending: (r.spending - r.healthcare) / d,
      healthcare: (r.healthcare - r.ltc) / d,
      ltc: r.ltc / d,
      taxes: r.taxes / d,
      mortgage: r.mortgagePayments / d,
      debt: (r.debtPayments - r.mortgagePayments) / d,
      shortfall: r.shortfall / d,
      reinvested: r.surplusInvested / d,
    };
    for (const t of WD_TYPES) o[`wd_${t}`] = r.withdrawalsByType[t] / d;
    return o;
  });
  const used = keys.filter((k) => data.some((d) => d[k.key] > 1));
  return (
    <div>
      <Legend items={[...used.map((k) => ({ label: k.label, color: k.color })), { label: 'Total need (spending, taxes, home costs, debt, saving)', color: c.ink, kind: 'line' }]} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 16, right: 16, bottom: 4, left: 0 }} barCategoryGap="12%">
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="age" {...axisProps(c)} interval="preserveStartEnd" minTickGap={20} />
          <YAxis {...yAxisProps(c)} />
          <Tooltip
            cursor={{ fill: c.grid, fillOpacity: 0.5 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as Record<string, number>;
              const rs: TipRow[] = [...used].reverse().filter((k) => p[k.key] > 1).map((k) => ({ label: k.label, value: p[k.key], color: k.color }));
              rs.push({ label: 'Living expenses', value: p.spending });
              if (p.healthcare > 1) rs.push({ label: 'Healthcare', value: p.healthcare });
              if (p.ltc > 1) rs.push({ label: 'Long-term care', value: p.ltc });
              if (p.mortgage > 1) rs.push({ label: 'Mortgage', value: p.mortgage });
              if (p.debt > 1) rs.push({ label: 'Other debt payments', value: p.debt });
              if (p.propertyTax > 1) rs.push({ label: 'Property tax', value: p.propertyTax });
              if (p.upkeep > 1) rs.push({ label: 'Home upkeep', value: p.upkeep });
              rs.push({ label: 'Income taxes', value: p.taxes });
              rs.push({ label: 'Total need', value: p.need, color: c.ink, kind: 'line', strong: true });
              if (p.reinvested > 1) rs.push({ label: 'Excess reinvested', value: p.reinvested });
              if (p.shortfall > 1) rs.push({ label: 'Shortfall', value: p.shortfall, color: c.critical, strong: true });
              return <TipBox title={`Age ${p.age} · ${p.year}${real ? " · today's $" : ''}`} rows={rs} />;
            }}
          />
          {used.map((k, i) => (
            <Bar key={k.key} dataKey={k.key} stackId="s" fill={k.color} isAnimationActive={false} maxBarSize={24} radius={i === used.length - 1 ? [4, 4, 0, 0] : 0} stroke={c.surface} strokeWidth={1} />
          ))}
          <Line type="stepAfter" dataKey="need" stroke={c.ink} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Where each year's money goes: one stacked segment per kind of expense. */
function PaycheckUsesChart({ rows, real, c, height }: { rows: YearRow[]; real: boolean; c: ChartTheme; height: number }) {
  const keys = [
    { key: 'living', label: 'Living expenses', color: c.wages },
    { key: 'healthcare', label: 'Healthcare', color: c.series[2] },
    { key: 'mortgage', label: 'Mortgage', color: c.debt },
    { key: 'debt', label: 'Other debt', color: c.series[1] },
    { key: 'home', label: 'Property tax & upkeep', color: c.type.property },
    { key: 'taxes', label: 'Income taxes', color: c.series[6] },
    { key: 'oneTime', label: 'One-time spending', color: c.series[3] },
    { key: 'saving', label: 'Saving & reinvested', color: c.series[0] },
    { key: 'leftover', label: 'Leftover (spent)', color: c.series[4] },
  ];
  const data = rows.map((r) => {
    const d = real ? r.inflation : 1;
    return {
      age: r.age,
      year: r.year,
      living: (r.spending - r.healthcare) / d,
      healthcare: r.healthcare / d,
      mortgage: r.mortgagePayments / d,
      debt: (r.debtPayments - r.mortgagePayments) / d,
      home: (r.propertyTax + r.homeUpkeep) / d,
      taxes: r.taxes / d,
      oneTime: r.eventsOut / d,
      saving: (r.contributions + r.surplusInvested) / d,
      leftover: (r.surplus - r.surplusInvested) / d,
      available: (r.wages + r.socialSecurity + r.otherIncome + r.eventsIn + r.withdrawals) / d,
      shortfall: r.shortfall / d,
    } as Record<string, number>;
  });
  const used = keys.filter((k) => data.some((d) => d[k.key] > 1));
  return (
    <div>
      <Legend items={[...used.map((k) => ({ label: k.label, color: k.color })), { label: 'Money available (income + withdrawals)', color: c.ink, kind: 'line' }]} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 16, right: 16, bottom: 4, left: 0 }} barCategoryGap="12%">
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="age" {...axisProps(c)} interval="preserveStartEnd" minTickGap={20} />
          <YAxis {...yAxisProps(c)} />
          <Tooltip
            cursor={{ fill: c.grid, fillOpacity: 0.5 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as Record<string, number>;
              const rs: TipRow[] = [...used].reverse().filter((k) => p[k.key] > 1).map((k) => ({ label: k.label, value: p[k.key], color: k.color }));
              rs.push({ label: 'Money available', value: p.available, color: c.ink, kind: 'line', strong: true });
              if (p.shortfall > 1) rs.push({ label: 'Shortfall', value: p.shortfall, color: c.critical, strong: true });
              return <TipBox title={`Age ${p.age} · ${p.year}${real ? " · today's $" : ''}`} rows={rs} />;
            }}
          />
          {used.map((k, i) => (
            <Bar key={k.key} dataKey={k.key} stackId="u" fill={k.color} isAnimationActive={false} maxBarSize={24} radius={i === used.length - 1 ? [4, 4, 0, 0] : 0} stroke={c.surface} strokeWidth={1} />
          ))}
          <Line type="stepAfter" dataKey="available" stroke={c.ink} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Healthcare costs by year
// ---------------------------------------------------------------------------

export function HealthcareChart({ projection, real, c, height = 280 }: { projection: ProjectionResult; real: boolean; c: ChartTheme; height?: number }) {
  const rows = projection.rows.filter((r) => r.k > 0);
  const first = rows.findIndex((r) => r.healthcare > 0);
  const data = (first < 0 ? [] : rows.slice(Math.max(0, first - 1))).map((r) => {
    const d = real ? r.inflation : 1;
    return { age: r.age, year: r.year, pre: r.preMedicare / d, medicare: r.medicare / d, irmaa: r.irmaa / d, ltc: r.ltc / d };
  });
  const keys = [
    { key: 'pre', label: 'Private insurance (before 65)', color: c.series[0] },
    { key: 'medicare', label: 'Medicare + Medigap + out-of-pocket', color: c.series[2] },
    { key: 'irmaa', label: 'IRMAA surcharges', color: c.series[1] },
    { key: 'ltc', label: 'Long-term care', color: c.series[6] },
  ].filter((k) => data.some((d) => (d as Record<string, number>)[k.key] > 1));
  if (!data.length) return <p className="muted">No healthcare costs in the projection.</p>;
  return (
    <div>
      <Legend items={keys.map((k) => ({ label: k.label, color: k.color }))} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 16, right: 16, bottom: 4, left: 0 }} barCategoryGap="12%">
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="age" {...axisProps(c)} interval="preserveStartEnd" minTickGap={20} />
          <YAxis {...yAxisProps(c)} />
          <Tooltip
            cursor={{ fill: c.grid, fillOpacity: 0.5 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as Record<string, number>;
              const rows: TipRow[] = keys.filter((k) => p[k.key] > 0).map((k) => ({ label: k.label, value: p[k.key], color: k.color }));
              rows.push({ label: 'Total', value: keys.reduce((s, k) => s + p[k.key], 0), strong: true });
              return <TipBox title={`Age ${p.age} · ${p.year}${real ? " · today's $" : ''}`} rows={rows} />;
            }}
          />
          {keys.map((k, i) => (
            <Bar key={k.key} dataKey={k.key} stackId="h" fill={k.color} maxBarSize={24} isAnimationActive={false} radius={i === keys.length - 1 ? [4, 4, 0, 0] : 0} stroke={c.surface} strokeWidth={1} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Taxes by year
// ---------------------------------------------------------------------------

export function TaxesOverTime({ projection, real, c, height = 280 }: { projection: ProjectionResult; real: boolean; c: ChartTheme; height?: number }) {
  const data = projection.rows.filter((r) => r.k > 0).map((r) => {
    const d = real ? r.inflation : 1;
    return {
      age: r.age, year: r.year,
      federal: r.federalTax / d, state: r.stateTax / d, payroll: r.payrollTax / d, penalty: r.penalty / d,
      property: r.propertyTax / d, itemized: r.federalItemized ? 1 : 0, deduction: r.federalDeduction / d,
      rate: r.wages + r.withdrawals + r.socialSecurity + r.otherIncome > 0
        ? r.taxes / (r.wages + r.withdrawals + r.socialSecurity + r.otherIncome) : 0,
    };
  });
  const keys = [
    { key: 'federal', label: 'Federal income', color: c.series[0] },
    { key: 'state', label: 'California', color: c.series[1] },
    { key: 'payroll', label: 'Payroll (FICA + SDI)', color: c.series[2] },
    ...(data.some((d) => d.property > 0) ? [{ key: 'property', label: 'Property tax', color: c.type.property }] : []),
    ...(data.some((d) => d.penalty > 0) ? [{ key: 'penalty', label: 'Early-withdrawal penalty', color: c.series[3] }] : []),
  ];
  return (
    <div>
      <Legend items={keys.map((k) => ({ label: k.label, color: k.color }))} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 16, right: 16, bottom: 4, left: 0 }} barCategoryGap="12%">
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="age" {...axisProps(c)} interval="preserveStartEnd" minTickGap={20} />
          <YAxis {...yAxisProps(c)} />
          <Tooltip
            cursor={{ fill: c.grid, fillOpacity: 0.5 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as Record<string, number>;
              const rows: TipRow[] = keys.map((k) => ({ label: k.label, value: p[k.key], color: k.color }));
              rows.push({ label: 'Total', value: keys.reduce((s, k) => s + p[k.key], 0), strong: true });
              rows.push({ label: 'Income tax effective rate', value: `${(p.rate * 100).toFixed(1)}%` });
              rows.push({ label: p.itemized ? 'Federal: itemized deduction' : 'Federal: standard deduction', value: p.deduction });
              return <TipBox title={`Age ${p.age} · ${p.year}`} rows={rows} />;
            }}
          />
          {keys.map((k, i) => (
            <Bar key={k.key} dataKey={k.key} stackId="t" fill={k.color} maxBarSize={24} isAnimationActive={false} radius={i === keys.length - 1 ? [4, 4, 0, 0] : 0} stroke={c.surface} strokeWidth={1} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Debt balances over time (from amortization schedules)
// ---------------------------------------------------------------------------

export function DebtPayoffChart({
  debts, schedules, starts, c, height = 300,
}: { debts: Debt[]; schedules: Record<string, { balance: number }[]>; starts: Record<string, number>; c: ChartTheme; height?: number }) {
  const maxMonths = Math.max(1, ...debts.map((d) => schedules[d.id]?.length ?? 0));
  const step = maxMonths > 120 ? 3 : 1;
  const start = new Date();
  const data: Record<string, number>[] = [];
  for (let m = 0; m <= maxMonths; m += step) {
    const row: Record<string, number> = { m, t: new Date(start.getFullYear(), start.getMonth() + m, 1).getTime() };
    for (const d of debts) {
      const s = schedules[d.id] ?? [];
      row[d.id] = m === 0 ? starts[d.id] ?? 0 : (s[m - 1]?.balance ?? 0);
    }
    data.push(row);
  }
  return (
    <div>
      {debts.length > 1 && <Legend items={debts.map((d, i) => ({ label: d.name, color: c.series[i % 8], kind: 'line' }))} />}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 16, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={(t) => String(new Date(t).getFullYear())} {...axisProps(c)} minTickGap={32} />
          <YAxis {...yAxisProps(c)} />
          <Tooltip
            cursor={cursor(c)}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as Record<string, number>;
              return <TipBox title={fmtMonthYear(p.t)} rows={debts.map((d, i) => ({ label: d.name, value: p[d.id], color: c.series[i % 8], kind: 'line' }))} />;
            }}
          />
          {debts.map((d, i) => (
            <Line key={d.id} type="monotone" dataKey={d.id} stroke={c.series[i % 8]} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recorded history: stacked account values by date
// ---------------------------------------------------------------------------

export function HistoryStackChart({
  history, accounts, c, height = 340,
}: { history: NetWorthPoint[]; accounts: Account[]; c: ChartTheme; height?: number }) {
  // Group by account type so colors are stable and the stack stays readable.
  const types = ACCOUNT_TYPES.filter((t) => accounts.some((a) => a.type === t));
  const data = history.map((h) => {
    const row: Record<string, number> = { t: h.t, net: h.netWorth, debt: -Math.max(h.debts, 1e-6) };
    for (const t of types) row[t] = 0;
    for (const a of accounts) row[a.type] += h.byAccount[a.id] ?? 0;
    return row;
  });
  const hasDebt = data.some((d) => d.debt < -1);
  return (
    <div>
      <Legend items={[
        ...types.map((t) => ({ label: ACCOUNT_TYPE_SHORT[t], color: c.type[t] })),
        ...(hasDebt ? [{ label: 'Debt', color: c.debt }] : []),
        { label: 'Net worth', color: c.ink, kind: 'line' as const },
      ]} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} stackOffset="sign" margin={{ top: 16, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(t) => fmtMonthYear(t)} {...axisProps(c)} minTickGap={40} />
          <YAxis {...yAxisProps(c)} />
          <Tooltip
            cursor={cursor(c)}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as Record<string, number>;
              const rows: TipRow[] = [...types].reverse().filter((t) => p[t] > 0).map((t) => ({ label: ACCOUNT_TYPE_SHORT[t], value: p[t], color: c.type[t] }));
              if (p.debt < -1) rows.push({ label: 'Debt', value: p.debt, color: c.debt });
              rows.push({ label: 'Net worth', value: p.net, color: c.ink, kind: 'line', strong: true });
              return <TipBox title={new Date(p.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} rows={rows} />;
            }}
          />
          <ReferenceLine y={0} stroke={c.axis} />
          {types.map((t) => (
            <Area key={t} type="linear" dataKey={t} stackId="h" stroke={c.surface} strokeWidth={1.5} fill={c.type[t]} fillOpacity={0.85} isAnimationActive={false} />
          ))}
          {hasDebt && <Area type="linear" dataKey="debt" stackId="h" stroke={c.surface} strokeWidth={1.5} fill={c.debt} fillOpacity={0.7} isAnimationActive={false} />}
          <Line type="linear" dataKey="net" stroke={c.ink} strokeWidth={2} isAnimationActive={false} dot={{ r: 3, fill: c.ink, stroke: c.surface, strokeWidth: 2 }} activeDot={{ r: 5, stroke: c.surface, strokeWidth: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Sparkline({ values, color, width = 96, height = 28 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2) return <span className="muted small">—</span>;
  const data = values.map((v, i) => ({ i, v }));
  return (
    <AreaChart width={width} height={height} data={data} margin={{ top: 3, right: 3, bottom: 3, left: 3 }}>
      <YAxis hide domain={['dataMin', 'dataMax']} />
      <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={color} fillOpacity={0.12} isAnimationActive={false} dot={false} activeDot={false} />
    </AreaChart>
  );
}

/** 100% stacked horizontal bar (a meter) with a legend table beneath. */
export function PartsBar({ parts, total }: { parts: { label: string; value: number; color: string; hint?: string }[]; total?: number }) {
  const sum = total ?? parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div className="parts">
      <div className="parts-bar" role="img" aria-label={shown.map((p) => `${p.label} ${fmtUSD(p.value)}`).join(', ')}>
        {shown.map((p) => (
          <span key={p.label} className="parts-seg" title={`${p.label}: ${fmtUSD(p.value)}`} style={{ flexGrow: p.value, background: p.color }} />
        ))}
      </div>
      <table className="parts-table">
        <tbody>
          {parts.map((p) => (
            <tr key={p.label}>
              <td><span className="legend-key swatch" style={{ ['--c' as string]: p.color }} /> {p.label}{p.hint && <span className="muted small"> · {p.hint}</span>}</td>
              <td className="num-cell">{fmtUSD(p.value)}</td>
              <td className="num-cell muted">{sum > 0 ? `${((Math.max(0, p.value) / sum) * 100).toFixed(0)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type { YearRow };
