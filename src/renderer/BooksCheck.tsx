import { useEffect, useState } from 'react';
import { storeDateTime } from '../core/store-time';
import type { IntegrityRun } from '../services/integrity-runs';
import { call } from './api';
import { useI18n } from './i18n';

/** Runs the books check and shows what it found. It reports only: a person decides what to do. */
export function BooksCheck() {
  const { t } = useI18n();
  const [run, setRun] = useState<IntegrityRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  useEffect(() => void call<IntegrityRun | null>('integrity.latest').then(setRun, (e: Error) => setMsg(t(e.message))), []);
  const go = async () => {
    setBusy(true);
    setMsg('');
    try {
      setRun(await call<IntegrityRun>('integrity.run'));
    } catch (e) {
      setMsg(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const save = async (fingerprint: string) => {
    try {
      await call('integrity.review', { fingerprint, note: notes[fingerprint] ?? '' });
      setNotes({ ...notes, [fingerprint]: '' });
      setRun(await call<IntegrityRun | null>('integrity.latest'));
    } catch (e) {
      setMsg(t((e as Error).message));
    }
  };
  return (
    <div className="card" aria-label="books check">
      <p className="hint">{t('Works out the important totals again from the original records and compares them. It changes nothing.')}</p>
      <p><button className="primary" disabled={busy} onClick={() => void go()}>{busy ? t('Checking…') : t('Run check')}</button></p>
      {msg && <p className="msg error">{msg}</p>}
      {run && <p className="hint">{t('Last run: {0}', storeDateTime(run.at))}</p>}
      {run && run.findings.length === 0 && <p className="msg ok">{t('No problems found.')}</p>}
      {run?.findings.map((f) => (
        <div key={f.fingerprint} className="subpanel" style={{ marginBottom: 'var(--sp-3)' }}>
          <p className={`msg ${f.severity === 'critical' ? 'error' : 'warn'}`}><strong>{f.severity === 'critical' ? t('Serious') : t('Check this')}:</strong> {f.problem}</p>
          <p>{f.explanation}</p>
          <p className="hint">{f.entityType} {f.entityId}</p>
          <p><strong>{t('What to do')}:</strong> {f.suggestion} {t('Needs a person.')}</p>
          {f.reviews.map((r, i) => <p key={i} className="hint">{r.by} · {storeDateTime(r.at)}: {r.note}</p>)}
          <div className="row">
            <input aria-label="finding note" placeholder={t('Add a note')} value={notes[f.fingerprint] ?? ''} onChange={(e) => setNotes({ ...notes, [f.fingerprint]: e.target.value })} />
            <button disabled={!(notes[f.fingerprint] ?? '').trim()} onClick={() => void save(f.fingerprint)}>{t('Save note')}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
