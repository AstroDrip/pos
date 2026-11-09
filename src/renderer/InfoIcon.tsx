import { useRef, useState } from 'react';
import { fieldHelp, type FieldHelp } from './help/fields';
import { useOpenHelp } from './help/HelpContext';
import { metricHelp, type MetricHelp } from './help/metrics';

const isMetric = (h: FieldHelp | MetricHelp): h is MetricHelp => 'formula' in h;
export const helpFor = (id: string): FieldHelp | MetricHelp | undefined => fieldHelp(id) ?? metricHelp(id);

/**
 * A small "i" beside a label or figure that says what it means, with an example. Not a popup that takes over: keys
 * keep working, and it is left out of the Tab order so a cashier's Tab path does not change. English for now.
 */
export function InfoIcon({ id }: { id: string }) {
  const help = helpFor(id);
  const openHelp = useOpenHelp();
  const [open, setOpen] = useState(false);
  const back = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  if (!help) return null;
  const close = () => {
    setOpen(false);
    back.current?.focus();
  };
  const metric = isMetric(help) ? help : null;
  const field = isMetric(help) ? null : help;
  return (
    <span className="info-wrap" lang="en" dir="ltr">
      <button
        type="button"
        className="info-icon"
        tabIndex={-1}
        aria-label={`What is ${help.label}?`}
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (open) return close();
          back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setOpen(true);
          requestAnimationFrame(() => panel.current?.focus());
        }}
      >
        i
      </button>
      {open && (
        <div
          ref={panel}
          className="info-pop"
          role="note"
          aria-label={help.label}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
          }}
        >
          <strong>{help.label}</strong>
          <p>{help.means}</p>
          {metric && <p><b>How it is worked out:</b> {metric.formula}</p>}
          {metric && <p><b>Left out:</b> {metric.excludes}</p>}
          {field && <p><b>What to enter:</b> {field.enter} {field.required ? 'You must fill this in.' : 'You can leave this empty.'}</p>}
          <p><b>Example:</b> {help.example}</p>
          {field && <p><b>Watch out:</b> {field.mistakes}</p>}
          {metric && <p className="hint">{metric.kind === 'estimate' ? 'Provisional figure. ' : ''}{metric.span === 'balance' ? 'Right now.' : 'For the dates shown.'} {metric.vat === 'included' ? 'With VAT.' : metric.vat === 'excluded' ? 'Without VAT.' : ''}</p>}
          {help.article && (
            <button type="button" className="link" onClick={() => { const a = help.article!; setOpen(false); openHelp(a); }}>More</button>
          )}
        </div>
      )}
    </span>
  );
}
