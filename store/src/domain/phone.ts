/** Saudi mobile numbers in any usual form become +9665XXXXXXXX. Anything else is refused. Used by the form and the server alike. */
export function normalisePhone(raw: string): string | null {
  const m = /^(?:\+?966|00966)?0?(5\d{8})$/.exec(raw.replace(/[\s-]/g, ''));
  return m ? `+966${m[1]}` : null;
}
