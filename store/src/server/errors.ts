/** Shown to the caller as a status and a stable code. Never carries internal detail. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}
