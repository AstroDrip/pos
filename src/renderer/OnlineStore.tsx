import { useEffect, useState } from 'react';
import type { CommerceStatus } from '../services/commerce-sync';
import { call } from './api';
import { useI18n } from './i18n';
import { InfoIcon } from './InfoIcon';

type Status = CommerceStatus & { configured: boolean; url: string | null };
type Msg = { kind: 'ok' | 'error'; text: string } | null;

/** Connects this POS to the online store and shows whether stock is reaching it. */
export function OnlineStore() {
  const { t } = useI18n();
  const [s, setS] = useState<Status | null>(null);
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const load = () => call<Status>('commerce.status').then(setS);
  useEffect(() => void load(), []);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: 'ok', text: t(done) });
      setCode('');
      await load();
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    } finally {
      setBusy(false);
    }
  };

  if (!s) return null;
  const connected = s.configured && s.enabled;
  return (
    <div className="card section">
      <h3>{t('Online store')}</h3>
      <p className="muted">{t('Sends products and stock from this POS to the online store. Selling here never waits for it.')}</p>
      {connected ? (
        <>
          <p className={`msg ${s.lastError ? 'error' : 'ok'}`}>{s.lastError ? t('Waiting to reach the online store') : t('Connected')}</p>
          <table className="list" aria-label="online store status">
            <tbody>
              <tr><th>{t('Address')}</th><td>{s.url}</td></tr>
              <tr><th>{t('Last contact')}</th><td>{s.lastOkAt ? new Date(s.lastOkAt).toLocaleString() : t('Not yet')}</td></tr>
              <tr><th>{t('Waiting to send')}</th><td>{s.pending}</td></tr>
              {s.lastError && <tr><th>{t('Last problem')}</th><td>{s.lastError}</td></tr>}
            </tbody>
          </table>
          <p><button className="danger" disabled={busy} onClick={() => { if (window.confirm(t('Disconnect the online store? Online stock stops updating.'))) void run(() => call('commerce.disconnect', null), 'Disconnected'); }}>{t('Disconnect')}</button></p>
        </>
      ) : (
        <>
          <label>{t('Online store address')} <InfoIcon id="field.online.address" /></label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          <label>{t('Connection code')} <InfoIcon id="field.online.code" /></label>
          <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
          <p><button className="primary" disabled={busy || !url.trim() || !code.trim()} onClick={() => void run(() => call('commerce.connect', { url: url.trim(), code: code.trim(), deviceName: 'POS' }), 'Connected')}>{t('Connect')}</button></p>
        </>
      )}
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
    </div>
  );
}
