import type { Channel, IpcResult } from '../shared/ipc';

declare global {
  interface Window {
    pos: { invoke: (channel: Channel, payload: unknown) => Promise<IpcResult<unknown>> };
  }
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Calls the main process. Throws ApiError with a staff-readable message on failure. */
export async function call<T>(channel: Channel, payload: unknown = null): Promise<T> {
  let res: IpcResult<unknown>;
  try {
    res = await window.pos.invoke(channel, payload);
  } catch {
    throw new ApiError('IPC', 'Lost contact with the app core. Try again.');
  }
  if (!res.ok) throw new ApiError(res.code, res.message);
  return res.data as T;
}
