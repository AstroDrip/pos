/** A business rule said no. Carries a stable code the API and tests can rely on. */
export class DomainError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}
