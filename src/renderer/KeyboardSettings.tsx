import { useEffect, useState } from 'react';
import { DEFAULT_COMBOS, comboOf, resolveBindings, validateOverrides, type LetterId, type ShortcutId, type ShortcutOverrides } from '../core/shortcuts';
import { call } from './api';
import { HelpLink } from './HelpLink';
import { useI18n } from './i18n';
import { DIRECT_SHORTCUTS, QUICK_ACTIONS, commandLetter, keyLike } from './keyboard-registry';
import { useKeyRecorder, useShortcuts } from './Keyboard';

type Msg = { kind: 'ok' | 'error'; text: string } | null;

/** Admin: change the key for each function. Saved changes apply at once on this till. */
export function KeyboardSettings() {
  const { t } = useI18n();
  const { overrides, setOverrides } = useShortcuts();
  const record = useKeyRecorder();
  const [draft, setDraft] = useState<ShortcutOverrides>(overrides);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(overrides), [overrides]);

  useEffect(() => {
    if (!capturing) return;
    return record((e) => {
      if (e.isComposing || e.repeat) return;
      const k = keyLike(e);
      const value = capturing.startsWith('letter.') ? commandLetter(k) : comboOf(k);
      if (!value) return;
      const next = { ...draft, [capturing]: value };
      const problem = validateOverrides(next);
      setMsg(problem ? { kind: 'error', text: t(problem) } : null);
      if (!problem) setDraft(next);
      setCapturing(null);
    });
  }, [capturing, draft, record]);

  const shown = resolveBindings(draft);
  const row = (id: string, label: string, value: string, isDefault: boolean) => (
    <tr key={id}>
      <td>{t(label)}</td>
      <td><span className="kbd" dir="ltr" aria-label={`key ${id}`}>{value}</span></td>
      <td className="num">
        {capturing === id ? (
          <button type="button" onClick={() => setCapturing(null)}>{t('Press the new key… (Cancel)')}</button>
        ) : (
          <button type="button" aria-label={`change ${id}`} disabled={busy} onClick={() => { setMsg(null); setCapturing(id); }}>{t('Change')}</button>
        )}
        {!isDefault && capturing !== id && (
          <button type="button" aria-label={`reset ${id}`} disabled={busy} style={{ marginInlineStart: 6 }} onClick={() => {
            const rest = Object.fromEntries(Object.entries(draft).filter(([k]) => k !== id));
            const problem = validateOverrides(rest);
            if (problem) return setMsg({ kind: 'error', text: t(problem) });
            setDraft(rest);
          }}>{t('Default')}</button>
        )}
      </td>
    </tr>
  );

  const save = async (next: ShortcutOverrides) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    setCapturing(null);
    try {
      await call('shortcuts.save', { overrides: next });
      setOverrides(await call<ShortcutOverrides>('shortcuts.get'));
      setMsg({ kind: 'ok', text: t('Keyboard shortcuts saved.') });
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    } finally {
      setBusy(false);
    }
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(overrides);
  return (
    <div className="card section" role="region" aria-label="keyboard shortcuts">
      <h3>{t('Keyboard shortcuts')} <HelpLink article="admin-shortcuts" /></h3>
      <table className="list">
        <thead><tr><th>{t('Function')}</th><th>{t('Key')}</th><th /></tr></thead>
        <tbody>
          {DIRECT_SHORTCUTS.filter((s) => !s.fixed).map((s) => row(s.id, s.action, shown.direct[s.id as ShortcutId], shown.direct[s.id as ShortcutId] === DEFAULT_COMBOS[s.id as ShortcutId]))}
        </tbody>
      </table>
      <h4>{t('Quick Actions letters')}</h4>
      <table className="list">
        <tbody>
          {QUICK_ACTIONS.map((a) => row(`letter.${a.id}`, a.label, shown.letters[a.id as LetterId], shown.letters[a.id as LetterId] === a.id))}
        </tbody>
      </table>
      {msg && <p className={`msg ${msg.kind}`} role="status">{msg.text}</p>}
      <p className="row">
        <button className="primary" disabled={busy || !dirty} onClick={() => void save(draft)}>{t('Save shortcuts')}</button>
        <button disabled={busy || Object.keys(overrides).length + Object.keys(draft).length === 0} onClick={() => void save({})}>{t('Reset all to default')}</button>
      </p>
    </div>
  );
}
