import type { OutboxEvent } from './dashboard-sync';

// The till's only route to the cloud. Each call carries the device credential over TLS, and nothing here is logged.

export interface CloudCreds {
  url: string;
  storeId: string;
  deviceId: string;
  secret: string;
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export type ErrorKind = 'offline' | 'remote' | 'rejected';

export class CloudError extends Error {
  constructor(
    message: string,
    readonly kind: ErrorKind,
    readonly code: string,
  ) {
    super(message);
    this.name = 'CloudError';
  }
}

export interface RemoteBackup {
  backupId: string; createdAt: string; appVersion: string; schemaVersion: number; formatVersion: number; encryptionVersion: number; originalBytes: number; encryptedBytes: number; sha256: string; chunkCount: number; chunkSize: number; uploadStatus: string; verificationStatus: string; uploadedAt: string | null; verifiedAt: string | null;
}

export interface StartMeta {
  backupId: string; createdAt: string; appVersion: string; schemaVersion: number; formatVersion: number; encryptionVersion: number; originalBytes: number; encryptedBytes: number; sha256: string; chunkCount: number; chunkSize: number; chunksRoot: string;
}

export interface CloudApi {
  sync(events: OutboxEvent[]): Promise<{ acceptedIds: string[] }>;
  heartbeat(): Promise<void>;
  setVerifier(verifier: string): Promise<void>;
  start(meta: StartMeta): Promise<{ have: number[]; status: string }>;
  putChunk(backupId: string, index: number, sha: string, data: Buffer): Promise<void>;
  finish(backupId: string): Promise<void>;
  list(): Promise<RemoteBackup[]>;
  getChunk(backupId: string, index: number): Promise<{ data: Buffer; sha256: string }>;
  verified(backupId: string, ok: boolean, detail?: string): Promise<void>;
  restored(backupId: string, status: 'downloaded' | 'restored' | 'failed', detail?: string): Promise<void>;
}

/** Only https, except a local address for testing. Throws a message staff can read. */
export function normaliseUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new CloudError('Enter the full address, starting with https://', 'rejected', 'BAD_URL');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new CloudError('The address must start with https://', 'rejected', 'BAD_URL');
  return u.origin;
}

const TIMEOUT_MS = 60_000;

async function call(fetchFn: FetchFn, url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new CloudError('No internet connection to the cloud', 'offline', 'NETWORK');
  }
  if (res.ok) return res;
  let body: { error?: string; message?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* no usable body */
  }
  const kind: ErrorKind = res.status >= 500 || res.status === 429 ? 'remote' : 'rejected';
  throw new CloudError(body.message?.slice(0, 200) ?? `Cloud answered ${res.status}`, kind, body.error ?? String(res.status));
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export async function enrollDevice(fetchFn: FetchFn, url: string, input: { code: string; deviceName: string; appVersion: string; recoveryVerifier?: string }): Promise<CloudCreds> {
  const base = normaliseUrl(url);
  const r = (await (await call(fetchFn, `${base}/api/device/enroll`, json(input))).json()) as { storeId: string; deviceId: string; deviceSecret: string };
  return { url: base, storeId: r.storeId, deviceId: r.deviceId, secret: r.deviceSecret };
}

export async function recoverDevice(fetchFn: FetchFn, url: string, input: { storeId: string; recoveryToken: string; deviceName: string; revokeOthers: boolean }): Promise<CloudCreds> {
  const base = normaliseUrl(url);
  const r = (await (await call(fetchFn, `${base}/api/device/recover`, json(input))).json()) as { storeId: string; deviceId: string; deviceSecret: string };
  return { url: base, storeId: r.storeId, deviceId: r.deviceId, secret: r.deviceSecret };
}

export function makeCloudApi(creds: CloudCreds, fetchFn: FetchFn, appVersion: string): CloudApi {
  const auth = { authorization: `Bearer ${creds.deviceId}.${creds.secret}` };
  const post = async (path: string, body: unknown) => call(fetchFn, `${creds.url}/api/device/${path}`, { ...json(body), headers: { 'content-type': 'application/json', ...auth } });
  const chunkUrl = (id: string, i: number) => `${creds.url}/api/device/backup/chunk?backupId=${encodeURIComponent(id)}&index=${i}`;
  return {
    sync: async (events) => (await (await post('sync', { appVersion, events })).json()) as { acceptedIds: string[] },
    heartbeat: async () => void (await post('heartbeat', { appVersion })),
    setVerifier: async (recoveryVerifier) => void (await post('recovery-verifier', { recoveryVerifier })),
    start: async (meta) => (await (await post('backup/start', meta)).json()) as { have: number[]; status: string },
    putChunk: async (id, i, sha, data) => void (await call(fetchFn, chunkUrl(id, i), { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'x-chunk-sha256': sha, ...auth }, body: new Uint8Array(data) })),
    finish: async (backupId) => void (await post('backup/finish', { backupId })),
    list: async () => ((await (await call(fetchFn, `${creds.url}/api/device/backup/list`, { headers: auth })).json()) as { backups: RemoteBackup[] }).backups,
    getChunk: async (id, i) => {
      const r = await call(fetchFn, chunkUrl(id, i), { headers: auth });
      return { data: Buffer.from(await r.arrayBuffer()), sha256: r.headers.get('x-chunk-sha256') ?? '' };
    },
    verified: async (backupId, ok, detail) => void (await post('backup/verified', { backupId, ok, detail })),
    restored: async (backupId, status, detail) => void (await post('backup/restored', { backupId, status, detail })),
  };
}
