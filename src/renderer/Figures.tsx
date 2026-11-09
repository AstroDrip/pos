import { InfoIcon } from './InfoIcon';

/** One figure with its name. `lead` marks the few that matter most on a screen. */
export function Kpi({ l, v, sub, bad, info, lead }: { l: string; v: string; sub?: string; bad?: boolean; info?: string; lead?: boolean }) {
  return (
    <div className={`kpi${lead ? ' lead' : ''}`}>
      <div className="l">{l}{info && <InfoIcon id={info} />}</div>
      <div className={`v${bad ? ' neg' : ''}`}>{v}</div>
      {sub && <div className="l">{sub}</div>}
    </div>
  );
}

/** Switches between the views of one screen. */
export function Views<T extends string>({ value, onChange, options, name }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[]; name: string }) {
  return (
    <div className="seg views" role="group" aria-label={name}>
      {options.map((o) => <button key={o.id} type="button" className={value === o.id ? 'on' : ''} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>)}
    </div>
  );
}
