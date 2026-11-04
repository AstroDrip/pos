import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Backup file format (plan §J):
//   "POSBAK1\n" | uint32 BE manifest length | manifest JSON (UTF-8) | ciphertext
// Each file has its own random data key, which is encrypted ("wrapped") with the master backup key.
// The manifest is bound to the ciphertext as AES-GCM associated data, so editing either is detected.

const MAGIC = Buffer.from('POSBAK1\n', 'ascii');

export interface BackupManifest {
  format: 1;
  backupId: string;
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  counts: Record<string, number>;
  lastInvoiceNo: string | null;
  plainSha256: string;
  plainBytes: number;
  keyId: string;
  wrap: { iv: string; tag: string; key: string };
  data: { iv: string };
}

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Short public fingerprint of a master key, stored in backups to say which key is needed. */
export const keyId = (masterKey: Buffer) => sha256(masterKey).slice(0, 16);

export function encryptBackup(plain: Buffer, masterKey: Buffer, meta: Omit<BackupManifest, 'format' | 'plainSha256' | 'plainBytes' | 'keyId' | 'wrap' | 'data'>): { file: Buffer; manifest: BackupManifest } {
  if (masterKey.length !== 32) throw new Error('Master key must be 32 bytes');
  const dataKey = randomBytes(32);
  const wrapIv = randomBytes(12);
  const w = createCipheriv('aes-256-gcm', masterKey, wrapIv);
  const wrapped = Buffer.concat([w.update(dataKey), w.final()]);
  const manifest: BackupManifest = {
    format: 1,
    ...meta,
    plainSha256: sha256(plain),
    plainBytes: plain.length,
    keyId: keyId(masterKey),
    wrap: { iv: wrapIv.toString('base64'), tag: w.getAuthTag().toString('base64'), key: wrapped.toString('base64') },
    data: { iv: randomBytes(12).toString('base64') },
  };
  const header = Buffer.from(JSON.stringify(manifest), 'utf8');
  const c = createCipheriv('aes-256-gcm', dataKey, Buffer.from(manifest.data.iv, 'base64'));
  c.setAAD(header);
  const body = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(header.length);
  return { file: Buffer.concat([MAGIC, len, header, body]), manifest };
}

export function readManifest(file: Buffer): { manifest: BackupManifest; header: Buffer; body: Buffer } {
  if (file.length < 12 || !file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not a POS backup file');
  const len = file.readUInt32BE(MAGIC.length);
  const start = MAGIC.length + 4;
  if (len > 1_000_000 || start + len > file.length) throw new Error('Backup file is damaged (bad header)');
  const header = file.subarray(start, start + len);
  const manifest = JSON.parse(header.toString('utf8')) as BackupManifest;
  if (manifest.format !== 1) throw new Error(`Unsupported backup format ${String(manifest.format)}`);
  return { manifest, header, body: file.subarray(start + len) };
}

export function decryptBackup(file: Buffer, masterKey: Buffer): { plain: Buffer; manifest: BackupManifest } {
  const { manifest, header, body } = readManifest(file);
  if (keyId(masterKey) !== manifest.keyId) throw new Error('This backup was made with a different backup key');
  try {
    const w = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(manifest.wrap.iv, 'base64'));
    w.setAuthTag(Buffer.from(manifest.wrap.tag, 'base64'));
    const dataKey = Buffer.concat([w.update(Buffer.from(manifest.wrap.key, 'base64')), w.final()]);
    if (body.length < 16) throw new Error('short');
    const d = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(manifest.data.iv, 'base64'));
    d.setAAD(header);
    d.setAuthTag(body.subarray(body.length - 16));
    const plain = Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]);
    if (sha256(plain) !== manifest.plainSha256) throw new Error('checksum');
    return { plain, manifest };
  } catch {
    throw new Error('Backup file is damaged or has been altered');
  }
}

// ── Recovery code: the master key written out for the owner to keep on paper ──
// 32 key bytes + 2 checksum bytes, Crockford base32, groups of 5. Typos are caught by the checksum.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function keyToRecoveryCode(key: Buffer): string {
  if (key.length !== 32) throw new Error('Key must be 32 bytes');
  const bytes = Buffer.concat([key, createHash('sha256').update(key).digest().subarray(0, 2)]);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out.match(/.{1,5}/g)!.join('-');
}

export function recoveryCodeToKey(code: string): Buffer {
  const clean = code.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (clean.length !== 55) throw new Error('Recovery code has the wrong length');
  let bits = '';
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error(`Invalid character "${ch}" in recovery code`);
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = Buffer.alloc(34);
  for (let i = 0; i < 34; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  const key = bytes.subarray(0, 32);
  if (!createHash('sha256').update(key).digest().subarray(0, 2).equals(bytes.subarray(32))) {
    throw new Error('Recovery code is wrong (checksum failed). Check for typos.');
  }
  return Buffer.from(key);
}
