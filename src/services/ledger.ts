import { DomainError, type Ctx } from './context';

export interface PostingLine {
  account: string; // account code
  debit?: number;
  credit?: number;
}

export interface PostingInput {
  date: string;
  sourceType: string;
  sourceId: number;
  memo: string;
  lines: PostingLine[];
}

/**
 * Posts one balanced journal entry. Must run inside the caller's transaction.
 * UNIQUE(source_type, source_id) makes a second posting for the same source fail,
 * so a retry can never double-post.
 */
export function postEntry(ctx: Ctx, input: PostingInput): number {
  const lines = input.lines.filter((l) => (l.debit ?? 0) !== 0 || (l.credit ?? 0) !== 0);
  let dr = 0;
  let cr = 0;
  for (const l of lines) {
    const d = l.debit ?? 0;
    const c = l.credit ?? 0;
    if (!Number.isSafeInteger(d) || !Number.isSafeInteger(c) || d < 0 || c < 0 || (d > 0 && c > 0)) {
      throw new DomainError('VALIDATION', `Invalid journal line for ${l.account}`);
    }
    dr += d;
    cr += c;
  }
  if (dr !== cr) throw new DomainError('VALIDATION', `Unbalanced journal entry: debit ${dr} != credit ${cr}`);
  if (dr === 0) return 0; // nothing to post (e.g. a zero-value sale)

  const entryId = Number(
    ctx.db
      .prepare('INSERT INTO journal_entries (entry_date, source_type, source_id, memo, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(input.date, input.sourceType, input.sourceId, input.memo, ctx.now()).lastInsertRowid,
  );
  const findAccount = ctx.db.prepare('SELECT id FROM accounts WHERE code = ? AND is_postable = 1');
  const insertLine = ctx.db.prepare('INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES (?, ?, ?, ?)');
  for (const l of lines) {
    const acc = findAccount.get(l.account) as { id: number } | undefined;
    if (!acc) throw new DomainError('VALIDATION', `Unknown or non-postable account ${l.account}`);
    insertLine.run(entryId, acc.id, l.debit ?? 0, l.credit ?? 0);
  }
  return entryId;
}

export interface TrialBalanceRow {
  code: string;
  name_en: string;
  type: string;
  debit: number;
  credit: number;
}

export function trialBalance(ctx: Ctx): TrialBalanceRow[] {
  return ctx.db
    .prepare(
      `SELECT a.code, a.name_en, a.type, COALESCE(SUM(l.debit),0) AS debit, COALESCE(SUM(l.credit),0) AS credit
       FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id
       GROUP BY a.id HAVING debit <> 0 OR credit <> 0 ORDER BY a.code`,
    )
    .all() as TrialBalanceRow[];
}

/** Ids of journal entries whose lines do not balance. Must always be empty. */
export function unbalancedEntries(ctx: Ctx): number[] {
  return (
    ctx.db
      .prepare('SELECT entry_id FROM journal_lines GROUP BY entry_id HAVING SUM(debit) <> SUM(credit)')
      .all() as { entry_id: number }[]
  ).map((r) => r.entry_id);
}
