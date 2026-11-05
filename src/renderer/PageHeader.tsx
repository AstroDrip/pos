import type { ReactNode } from 'react';

/** Standard page top: title, an optional one-line description, and the page's actions at the end. */
export function PageHeader({ title, desc, actions }: { title: string; desc?: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h2>{title}</h2>
        {desc && <p className="desc">{desc}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

/** A table row that explains why a table is empty. */
export function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <tr className="empty">
      <td colSpan={cols}>{text}</td>
    </tr>
  );
}
