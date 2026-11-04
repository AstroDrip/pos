import { useEffect, useState } from 'react';
import type { User } from '../services/users';
import { call } from './api';
import { Products } from './Products';
import { Sell } from './Sell';
import { Shift } from './Shift';

type Status = { needsSetup: boolean; user: User | null };
type Tab = 'sell' | 'products' | 'shift';

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [tab, setTab] = useState<Tab>('sell');
  const [error, setError] = useState('');

  const refresh = () => call<Status>('auth.status').then(setStatus, (e: Error) => setError(e.message));
  useEffect(() => void refresh(), []);

  if (error) return <div className="card msg error">{error}</div>;
  if (!status) return null;
  if (status.needsSetup) return <Login setup onDone={refresh} />;
  if (!status.user) return <Login onDone={refresh} />;

  const user = status.user;
  const can = (p: string) => user.permissions.includes(p);
  return (
    <>
      <div className="top">
        <strong>POS</strong>
        <button className={tab === 'sell' ? 'active' : ''} onClick={() => setTab('sell')}>Sell</button>
        {can('product.manage') && (
          <button className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>Products</button>
        )}
        <button className={tab === 'shift' ? 'active' : ''} onClick={() => setTab('shift')}>Shift</button>
        <span className="spacer" />
        <span>{user.displayName}</span>
        <button onClick={() => call('auth.logout').then(refresh)}>Log out</button>
      </div>
      {tab === 'sell' && <Sell />}
      {tab === 'products' && <Products />}
      {tab === 'shift' && <Shift can={can} />}
    </>
  );
}

function Login({ setup = false, onDone }: { setup?: boolean; onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (setup) await call('auth.setupAdmin', { username, displayName, pin });
      else await call('auth.login', { username, pin });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setPin('');
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h2>{setup ? 'First-time setup: create the owner account' : 'Log in'}</h2>
      <label>Username</label>
      <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
      {setup && (
        <>
          <label>Display name</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </>
      )}
      <label>PIN (4–8 digits)</label>
      <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} />
      {error && <p className="msg error">{error}</p>}
      <p>
        <button className="primary" type="submit">{setup ? 'Create owner' : 'Log in'}</button>
      </p>
    </form>
  );
}
