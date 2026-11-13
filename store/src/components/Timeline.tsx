import { STEP_LABEL, STEPS } from '@/domain/order-text';
import type { OrderFulfilment, OrderStatus } from '@/domain/order-machine';

// Kept on its own with plain states, so an animation can be added here later without touching the order page.
type State = 'done' | 'current' | 'upcoming' | 'stopped';

const DOT: Record<State, string> = {
  done: 'bg-brand-900 border-brand-900',
  current: 'bg-leaf-500 border-brand-900',
  upcoming: 'bg-surface border-line',
  stopped: 'bg-danger border-danger',
};

export function Timeline({ fulfilment, status, history }: { fulfilment: OrderFulfilment; status: OrderStatus; history: { status: OrderStatus; at: string }[] }) {
  const steps = STEPS[fulfilment];
  const at = (s: OrderStatus) => history.find((h) => h.status === s)?.at ?? null;
  const ended = !steps.includes(status);
  const reached = ended ? Math.max(0, ...history.map((h) => steps.indexOf(h.status))) : steps.indexOf(status);
  const rows: { label: string; state: State; time: string | null }[] = steps.map((s, i) => ({
    label: STEP_LABEL[s],
    state: ended ? (i <= reached ? 'done' : 'upcoming') : i < reached || (i === reached && status === 'completed') ? 'done' : i === reached ? 'current' : 'upcoming',
    time: at(s),
  }));
  if (ended) rows.splice(reached + 1, rows.length, { label: STEP_LABEL[status], state: 'stopped', time: at(status) });

  return (
    <ol aria-label="Order progress" className="relative">
      {rows.map((r, i) => (
        <li key={r.label} data-state={r.state} className="relative flex gap-4 pb-6 last:pb-0">
          {i < rows.length - 1 && <span aria-hidden="true" className={`absolute top-6 left-[0.6875rem] h-[calc(100%-1.5rem)] w-0.5 ${r.state === 'done' ? 'bg-brand-900' : 'bg-line'}`} />}
          <span aria-hidden="true" className={`relative z-10 mt-0.5 size-6 shrink-0 rounded-full border-2 ${DOT[r.state]}`} />
          <div className="min-w-0">
            <p className={`font-semibold ${r.state === 'upcoming' ? 'text-ink-600' : ''}`}>
              {r.label}
              <span className="sr-only">{r.state === 'done' ? ', done' : r.state === 'current' ? ', current step' : r.state === 'stopped' ? ', stopped' : ', not yet'}</span>
            </p>
            {r.time && <p className="text-sm text-ink-600">{new Date(r.time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
