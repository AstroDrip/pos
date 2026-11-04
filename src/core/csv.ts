/** Minimal RFC 4180 CSV parser: quoted fields, "" escapes, CRLF/LF, UTF-8 BOM. Returns rows of strings. */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw new Error('CSV has an unclosed quote');
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0]!.trim() === ''));
}

/** Rows as objects keyed by lower-case header names. Throws if required headers are missing. */
export function csvRecords(text: string, required: readonly string[]): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error('CSV file is empty');
  const keys = header.map((h) => h.trim().toLowerCase());
  const missing = required.filter((r) => !keys.includes(r));
  if (missing.length) throw new Error(`CSV is missing columns: ${missing.join(', ')}`);
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}
