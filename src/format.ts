const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const fmtUSD = (n: number) => usd0.format(Math.round(n || 0));

/** Compact currency: $1.2M, $845K, $950. */
export function fmtCompact(n: number, digits = 1): string {
  const v = Math.abs(n || 0);
  const sign = n < 0 ? '−' : '';
  if (v >= 1e9) return `${sign}$${(v / 1e9).toFixed(digits)}B`;
  if (v >= 1e6) return `${sign}$${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2)}M`;
  if (v >= 1e4) return `${sign}$${(v / 1e3).toFixed(0)}K`;
  if (v >= 1e3) return `${sign}$${(v / 1e3).toFixed(1)}K`;
  return `${sign}$${v.toFixed(0)}`;
}

export const fmtPct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;

export function fmtSigned(n: number): string {
  return (n >= 0 ? '+' : '−') + fmtCompact(Math.abs(n));
}

export function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtMonthYear(t: number): string {
  return new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function monthsToText(m: number | null): string {
  if (m == null) return 'Never';
  const y = Math.floor(m / 12);
  const r = m % 12;
  if (y === 0) return `${r} mo`;
  return r ? `${y} yr ${r} mo` : `${y} yr`;
}
