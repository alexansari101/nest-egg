import { useEffect, useId, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Card({
  title, subtitle, actions, children, className = '', pad = true,
}: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function StatTile({
  label, value, sub, delta, deltaGood, icon, tone, loading,
}: {
  label: string; value: ReactNode; sub?: ReactNode; delta?: string; deltaGood?: boolean;
  icon?: ReactNode; tone?: 'good' | 'warning' | 'serious' | 'critical'; loading?: boolean;
}) {
  return (
    <div className={`stat ${tone ? `tone-${tone}` : ''}`}>
      <div className="stat-label">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`stat-value ${loading ? 'shimmer' : ''}`}>{value}</div>
      <div className="stat-foot">
        {delta && <span className={`delta ${deltaGood ? 'up' : 'down'}`}>{delta}</span>}
        {sub && <span className="stat-sub">{sub}</span>}
      </div>
    </div>
  );
}

function parseNum(s: string): number {
  const cleaned = s.replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Numeric input that shows grouped digits when idle and raw digits while editing. */
export function NumberInput({
  value, onChange, prefix, suffix, step, min, max, decimals = 0, ariaLabel, id, compact, group = prefix === '$',
}: {
  value: number; onChange: (n: number) => void; prefix?: string; suffix?: string; step?: number;
  min?: number; max?: number; decimals?: number; ariaLabel?: string; id?: string; compact?: boolean;
  /** Thousands separators. On for currency only — years and ages must read as plain numbers. */
  group?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState('');
  const display = focused
    ? text
    : Number.isFinite(value)
      ? value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals, useGrouping: group })
      : '';
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  return (
    <div className={`num ${compact ? 'num-compact' : ''}`}>
      {prefix && <span className="num-affix">{prefix}</span>}
      <input
        id={id}
        aria-label={ariaLabel}
        inputMode="decimal"
        value={display}
        onFocus={(e) => {
          // Swap to raw digits synchronously so fast typing never lands on the formatted text.
          const raw = Number.isFinite(value) ? String(value) : '';
          e.currentTarget.value = raw;
          e.currentTarget.select();
          setText(raw);
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          onChange(clamp(parseNum(text)));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseNum(e.target.value);
          if (e.target.value.trim() !== '' && e.target.value !== '-') onChange(clamp(n));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (step && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            const n = clamp(+(value + (e.key === 'ArrowUp' ? step : -step)).toFixed(4));
            setText(String(n));
            onChange(n);
          }
        }}
      />
      {suffix && <span className="num-affix">{suffix}</span>}
    </div>
  );
}

export function Field({ label, hint, children, wide, full }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean; full?: boolean }) {
  return (
    <label className={`field ${wide ? 'field-wide' : ''} ${full ? 'field-full' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function TextInput({ value, onChange, placeholder, ariaLabel }: { value: string; onChange: (s: string) => void; placeholder?: string; ariaLabel?: string }) {
  return <input className="text" value={value} placeholder={placeholder} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)} />;
}

export function Select<T extends string>({ value, onChange, options, ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; ariaLabel?: string }) {
  return (
    <select className="select" value={value} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (b: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="toggle-knob" />
      {label && <span className="toggle-label">{label}</span>}
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  label, value, onChange, min, max, step = 1, format,
}: { label: string; value: number; onChange: (n: number) => void; min: number; max: number; step?: number; format: (n: number) => string }) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider">
      <div className="slider-top">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{format(value)}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--pct' as string]: `${Math.min(100, Math.max(0, pct))}%` }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

export function Button({
  children, onClick, variant = 'default', icon, title, type = 'button', size,
}: {
  children?: ReactNode; onClick?: () => void; variant?: 'default' | 'primary' | 'ghost' | 'danger';
  icon?: ReactNode; title?: string; type?: 'button' | 'submit'; size?: 'sm';
}) {
  return (
    <button type={type} title={title} aria-label={!children ? title : undefined} className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${!children ? 'btn-icon' : ''}`} onClick={onClick}>
      {icon}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <Button variant="ghost" icon={<X size={18} />} title="Close" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h4>{title}</h4>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; kind?: 'line' | 'swatch' | 'dash' }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label} className="legend-item">
          <span className={`legend-key ${i.kind ?? 'swatch'}`} style={{ ['--c' as string]: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
