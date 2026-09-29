import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AccountType } from './engine/types';

export type ThemePref = 'system' | 'light' | 'dark';

// Validated categorical palette (light/dark steps of the same eight hues).
const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

/** Account type -> fixed categorical slot (color follows the entity, never its rank). */
export const TYPE_SLOT: Record<AccountType, number> = {
  traditional: 0, taxable: 1, roth: 2, hsa: 3, cash: 4, property: 5, other: 6,
};

export interface ChartTheme {
  dark: boolean;
  series: string[];
  type: Record<AccountType, string>;
  ink: string;
  ink2: string;
  muted: string;
  grid: string;
  axis: string;
  surface: string;
  good: string;
  warning: string;
  serious: string;
  critical: string;
  debt: string;
  ss: string;
  otherIncome: string;
  wages: string;
}

function build(dark: boolean): ChartTheme {
  const series = dark ? SERIES_DARK : SERIES_LIGHT;
  const type = Object.fromEntries(
    Object.entries(TYPE_SLOT).map(([t, i]) => [t, series[i]]),
  ) as Record<AccountType, string>;
  return {
    dark,
    series,
    type,
    ink: dark ? '#ffffff' : '#0b0b0b',
    ink2: dark ? '#c3c2b7' : '#52514e',
    muted: '#898781',
    grid: dark ? '#2c2c2a' : '#e1e0d9',
    axis: dark ? '#383835' : '#c3c2b7',
    surface: dark ? '#1a1a19' : '#fcfcfb',
    good: '#0ca30c',
    warning: '#fab219',
    serious: '#ec835a',
    critical: '#d03b3b',
    debt: series[7],
    ss: series[5],
    otherIncome: series[6],
    wages: dark ? '#6b6a64' : '#a3a29b',
  };
}

const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const subscribe = (cb: () => void) => {
  mq?.addEventListener('change', cb);
  return () => mq?.removeEventListener('change', cb);
};

export function useThemePref() {
  const [pref, setPref] = useState<ThemePref>(() => {
    try {
      return (localStorage.getItem('nestegg.theme') as ThemePref) || 'system';
    } catch {
      return 'system';
    }
  });
  const systemDark = useSyncExternalStore(subscribe, () => mq?.matches ?? false, () => false);
  const dark = pref === 'dark' || (pref === 'system' && systemDark);
  useEffect(() => {
    const root = document.documentElement;
    if (pref === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', pref);
    try {
      localStorage.setItem('nestegg.theme', pref);
    } catch {
      /* ignore */
    }
  }, [pref]);
  return { pref, setPref, dark, chart: build(dark) };
}
