import { deviceRoute } from '@/server/device-route';
import { ApiError } from '@/server/device-core';
import { getChunk, MAX_CHUNK, putChunk } from '@/server/backup-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const params = (req: Request) => {
  const u = new URL(req.url);
  return { id: u.searchParams.get('backupId') ?? '', idx: Number(u.searchParams.get('index') ?? -1) };
};

export const PUT = deviceRoute(async (req, db, device) => {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_CHUNK) throw new ApiError(413, 'TOO_LARGE', 'Piece is too large.');
  const { id, idx } = params(req);
  return Response.json(await putChunk(db, device, id, idx, req.headers.get('x-chunk-sha256') ?? '', Buffer.from(await req.arrayBuffer())));
});

export const GET = deviceRoute(async (req, db, device) => {
  const { id, idx } = params(req);
  const c = await getChunk(db, device, id, idx);
  return new Response(new Uint8Array(c.data), { headers: { 'content-type': 'application/octet-stream', 'x-chunk-sha256': c.sha256, 'cache-control': 'no-store' } });
});
