import { useEffect, useState } from 'react';
import type { BackupStatus } from '../services/backup';
import type { CloudState, CloudStatus } from '../services/cloud-backup';
import type { RemoteBackup } from '../services/cloud-client';
import type { SyncHealth } from '../services/dashboard-sync';
import { call } from './api';
import { useI18n } from './i18n';
import { InfoIcon } from './InfoIcon';

type FullStatus = CloudStatus & { configured: boolean; url: string | null; storeId: string | null; deviceId: string | null; keyConfigured: boolean; recoveryReady: boolean; local: BackupStatus; sync: SyncHealth };
type Facts = { backupId: string; createdAt: string; lastInvoiceNo: string | null; counts: Record<string, number>; newerLocal: boolean; liveSales: number };
type Msg = { kind: 'ok' | 'error' | 'warn'; text: string } | null;

const STATE: Record<CloudState, { text: string; kind: 'ok' | 'warn' | 'error' }> = {
  not_configured: { text: 'Not connected', kind: 'warn' },
  no_backup_yet: { text: 'Connected. No cloud backup yet', kind: 'warn' },
  ok: { text: 'Last backup successful', kind: 'ok' },
  uploading: { text: 'Backup uploading', kind: 'warn' },
  waiting_internet: { text: 'Waiting for internet', kind: 'warn' },
  remote_unavailable: { text: 'Remote backup unavailable', kind: 'error' },
  rejected: { text: 'Cloud refused the backup', kind: 'error' },
  verification_failed: { text: 'Backup verification failed', kind: 'error' },
};

const when = (iso: string | null | undefined, never: string) => (iso ? new Date(iso).toLocaleString() : never);
const mb = (n: number | null | undefined) => (n ? `${Math.max(1, Math.floor(n / 104_858)) / 10} MB` : '—');

/** Picks a remote backup, checks it fully, then asks before anything is replaced. */
function RestoreList({ backups, needCode }: { backups: RemoteBackup[]; needCode: string | undefined }) {
  const { t } = useI18n();
  const [facts, setFacts] = useState<Facts | null>(null);
  const [ack, setAck] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const check = async (backupId: string) => {
    setBusy(true);
    setMsg(null);
    setFacts(null);
    try {
      setFacts(await call<Facts>('cloud.restorePrepare', { backupId, recoveryCode: needCode }));
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!window.confirm(t('Replace ALL current data with this backup? The current data is kept in a side file, not deleted. The app will restart.'))) return;
    try {
      await call('restore.apply', { acknowledgeOlder: ack });
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    }
  };
  return (
    <>
      <table className="list" aria-label="cloud backups">
        <thead><tr><th>{t('Date')}</th><th>{t('App version')}</th><th className="num">{t('Size')}</th><th>{t('Check')}</th><th /></tr></thead>
        <tbody>{backups.map((b) => (
          <tr key={b.backupId}><td>{new Date(b.createdAt).toLocaleString()}</td><td>{b.appVersion}</td><td className="num">{mb(b.encryptedBytes)}</td><td>{b.verificationStatus}</td>
            <td><button disabled={busy || b.uploadStatus !== 'uploaded'} onClick={() => void check(b.backupId)}>{t('Check this backup')}</button></td></tr>
        ))}</tbody>
      </table>
      {busy && <p>{t('Downloading and checking…')}</p>}
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
      {facts && (
        <div className="msg ok">
          {t('Backup from {0} is valid. Last invoice: {1}. Sales: {2}, products: {3}.', new Date(facts.createdAt).toLocaleString(), facts.lastInvoiceNo ?? t('none'), facts.counts.sales ?? 0, facts.counts.products ?? 0)}
          {facts.newerLocal && (
            <p className="msg warn"><label><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> {t('This computer has {0} sales, more or newer than this backup. I understand they will leave the live data.', facts.liveSales)}</label></p>
          )}
          <p><button className="danger" disabled={facts.newerLocal && !ack} onClick={() => void apply()}>{t('Restore this backup')}</button></p>
        </div>
      )}
    </>
  );
}

/** Admin screen: Cloud Backup & Recovery. */
export function CloudBackup({ can }: { can: (p: string) => boolean }) {
  const { t } = useI18n();
  const [s, setS] = useState<FullStatus | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ url: '', code: '', deviceName: 'Till 1' });
  const [backups, setBackups] = useState<RemoteBackup[] | null>(null);
  const load = () => void call<FullStatus>('cloud.status').then(setS, (e: Error) => setMsg({ kind: 'error', text: t(e.message) }));
  useEffect(load, []);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ kind: 'ok', text: await fn() });
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    } finally {
      setBusy(false);
      load();
    }
  };
  if (!s) return null;
  const state = STATE[s.state];
  return (
    <div className="card section">
      <h3>{t('Cloud Backup & Recovery')}</h3>
      <p className={`msg ${state.kind}`} role="status">{t(state.text)}{s.lastError && state.kind !== 'ok' ? ` · ${t(s.lastError)}` : ''}</p>
      <p className="hint">{t('Selling never waits for this. Backups are encrypted on this computer before they leave it.')}</p>
      <table className="list" aria-label="cloud backup status"><tbody>
        <tr><td>{t('Cloud connection')}</td><td>{s.configured ? s.url : t('Not connected')}</td></tr>
        <tr><td>{t('Last local backup')}</td><td>{when(s.local.lastVerifiedLocal?.at, t('never'))}</td></tr>
        <tr><td>{t('Last cloud backup')}</td><td>{when(s.lastCloudAt, t('never'))} {s.lastCloudBytes ? `(${mb(s.lastCloudBytes)})` : ''}</td></tr>
        <tr><td>{t('Last full verification')}</td><td>{when(s.lastFullVerifyAt, t('never'))}</td></tr>
        <tr><td>{t('Upload failures')}</td><td>{s.failures}</td></tr>
        <tr><td>{t('Retention')}</td><td>{t('Last 7 days and last 4 weeks. The newest verified backup is never deleted.')}</td></tr>
        <tr><td>{t('Device identity')}</td><td>{s.deviceId ?? '—'}</td></tr>
        <tr><td>{t('Store identity')}</td><td>{s.storeId ?? '—'}</td></tr>
        <tr><td>{t('Recovery readiness')}</td><td>{s.recoveryReady ? t('Ready, if you still have the paper recovery code') : t('Not ready')}</td></tr>
        <tr><td>{t('Dashboard data')}</td><td>{s.sync.enabled ? `${when(s.sync.lastSuccessAt, t('never'))} · ${s.sync.pending} ${t('waiting')}` : t('Not connected')}</td></tr>
      </tbody></table>
      <p className="msg warn">{t('If the paper recovery code is lost and this computer is lost, the cloud backups cannot be opened by anyone.')}</p>
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}

      {!s.configured && can('settings.manage') && (
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><label>{t('Cloud address')} <InfoIcon id="field.cloud.address" /></label><input aria-label="cloud address" placeholder="https://" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></div>
          <div><label>{t('One-time code')} <InfoIcon id="field.cloud.code" /></label><input aria-label="cloud code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
          <div><label>{t('Name of this till')}</label><input aria-label="device name" value={form.deviceName} onChange={(e) => setForm({ ...form, deviceName: e.target.value })} /></div>
          <button className="primary" disabled={busy || !form.url || !form.code || !s.keyConfigured} onClick={() => void run(async () => { await call('cloud.connect', form); setForm({ url: '', code: '', deviceName: form.deviceName }); return t('Connected.'); })}>{t('Connect')}</button>
          {!s.keyConfigured && <p className="hint">{t('Set up the backup key first.')}</p>}
        </div>
      )}

      {s.configured && (
        <p className="row">
          <button className="primary" disabled={busy} onClick={() => void run(async () => { const r = await call<{ uploaded: number; failed: boolean }>('cloud.backupNow'); return r.failed ? t('Saved here. The upload will retry.') : t('Backup uploaded.'); })}>{t('Back up to cloud now')}</button>
          <button disabled={busy} onClick={() => void run(async () => { const r = await call<{ ok: boolean; detail?: string }>('cloud.verify'); return r.ok ? t('The newest cloud backup opened and checked correctly.') : `${t('Backup verification failed')}: ${r.detail ?? ''}`; })}>{t('Test newest backup')}</button>
          {can('backup.restore') && <button disabled={busy} onClick={() => void run(async () => { setBackups(await call<RemoteBackup[]>('cloud.list')); return t('List updated.'); })}>{t('Show backup history')}</button>}
          {can('settings.manage') && (
            <select aria-label="backup frequency" value={s.everyHours} onChange={(e) => void run(async () => { await call('cloud.schedule', { hours: Number(e.target.value) }); return t('Saved.'); })}>
              {[6, 12, 24, 48].map((h) => <option key={h} value={h}>{t('Every {0} hours', h)}</option>)}
            </select>
          )}
          {can('settings.manage') && <button disabled={busy} onClick={() => { if (window.confirm(t('Disconnect this till from the cloud? Nothing is deleted.'))) void run(async () => { await call('cloud.disconnect'); return t('Disconnected.'); }); }}>{t('Disconnect')}</button>}
        </p>
      )}
      {backups && can('backup.restore') && <RestoreList backups={backups} needCode={undefined} />}
    </div>
  );
}

/** First-run screen: a replacement computer has only the store id and the paper recovery code. */
export function CloudRestoreNewComputer() {
  const { t } = useI18n();
  const [f, setF] = useState({ url: '', storeId: '', recoveryCode: '', deviceName: 'Replacement till', revokeOthers: true });
  const [backups, setBackups] = useState<RemoteBackup[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setMsg(null);
    try {
      setBackups(await call<RemoteBackup[]>('cloud.recover', f));
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card section">
      <h4>{t('Restore from the cloud')}</h4>
      <label>{t('Cloud address')}</label><input aria-label="recover address" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
      <label>{t('Store identity')}</label><input aria-label="recover store id" value={f.storeId} onChange={(e) => setF({ ...f, storeId: e.target.value })} />
      <label>{t('Recovery code (needed on a new computer)')}</label><input aria-label="recover code" value={f.recoveryCode} onChange={(e) => setF({ ...f, recoveryCode: e.target.value })} />
      <label><input type="checkbox" checked={f.revokeOthers} onChange={(e) => setF({ ...f, revokeOthers: e.target.checked })} /> {t('Cut off the old computer')}</label>
      <p><button disabled={busy || !f.url || !f.storeId || !f.recoveryCode} onClick={() => void go()}>{t('Find backups')}</button></p>
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
      {backups && <RestoreList backups={backups} needCode={f.recoveryCode} />}
    </div>
  );
}
