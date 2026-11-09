import { useEffect, useRef } from 'react';
import { DAY_PRESETS, inRange, monthOf, pickDay, presetOf, presetRange, rangeText, shiftRange, stepDay, stripDays, validRange, weekdayOf, type DayPreset, type DayRange } from '../core/date-range';
import { storeDay } from '../core/store-time';
import { useI18n } from './i18n';
import { useRemembered } from './TabHost';

const todayDay = () => storeDay(new Date().toISOString());

/** The selected dates for one screen, kept for this user. Every chart, figure and table on the screen reads this one value. */
export function useDateRange(tab: string, initial: DayPreset = 'month'): [DayRange, (r: DayRange) => void] {
  return useRemembered<DayRange>(tab, 'dates', presetRange(initial, todayDay()), validRange);
}

/** The one date control for report screens: a scrollable strip, previous and next, presets and a normal date picker. */
export function DateNavigator({ value, onChange, name }: { value: DayRange; onChange: (r: DayRange) => void; name: string }) {
  const { t } = useI18n();
  const today = todayDay();
  const strip = useRef<HTMLDivElement>(null);
  const latest = useRef({ value, today, onChange });
  latest.current = { value, today, onChange };
  const days = stripDays(value, today);
  const preset = presetOf(value, today);

  // A wheel over the strip moves the date, and must not scroll the page: React's own wheel handler cannot stop that.
  useEffect(() => {
    const el = strip.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      const n = latest.current;
      n.onChange(stepDay(n.value, delta > 0 ? 1 : -1, n.today));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    strip.current?.querySelector('[data-end="1"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [value.to]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      onChange(stepDay(value, e.key === 'ArrowRight' ? 1 : -1, today));
    } else if (e.key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      onChange(presetRange('today', today));
    }
  };

  return (
    <div className="date-nav" role="group" aria-label={`${name}: dates`}>
      <div className="date-nav-top">
        <div className="seg" role="group" aria-label="date presets">
          {DAY_PRESETS.map((p) => <button key={p.id} type="button" className={preset === p.id ? 'on' : ''} onClick={() => onChange(presetRange(p.id, today))}>{t(p.label)}</button>)}
        </div>
        <div className="date-nav-fields">
          <input type="date" aria-label="from date" max={value.to} value={value.from} onChange={(e) => e.target.value && e.target.value <= value.to && onChange({ from: e.target.value, to: value.to })} />
          <span aria-hidden="true">–</span>
          <input type="date" aria-label="to date" min={value.from} max={today} value={value.to} onChange={(e) => e.target.value && e.target.value >= value.from && e.target.value <= today && onChange({ from: value.from, to: e.target.value })} />
        </div>
        <strong className="date-nav-now" aria-live="polite">{rangeText(value)}</strong>
      </div>
      <div className="date-nav-strip">
        <button type="button" className="sm" aria-label="earlier dates" onClick={() => onChange(shiftRange(value, -1, today))}>‹</button>
        <div ref={strip} className="date-strip" tabIndex={0} role="listbox" aria-label={t('Dates. Arrow keys move one day.')} onKeyDown={onKey}>
          {days.map((d) => (
            <button key={d} type="button" role="option" tabIndex={-1} aria-selected={inRange(d, value)} data-end={d === value.to ? '1' : undefined} className={`${inRange(d, value) ? 'on' : ''}${d === today ? ' today' : ''}`} title={t('Shift + click to choose a range')} onClick={(e) => onChange(pickDay(d, value, e.shiftKey))}>
              <small>{t(weekdayOf(d))}</small>
              <b>{Number(d.slice(8))}</b>
              <small>{t(monthOf(d))}</small>
            </button>
          ))}
        </div>
        <button type="button" className="sm" aria-label="later dates" disabled={value.to >= today} onClick={() => onChange(shiftRange(value, 1, today))}>›</button>
      </div>
    </div>
  );
}
