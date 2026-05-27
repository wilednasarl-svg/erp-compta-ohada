'use client';

import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

/* ─── Types ──────────────────────────────────────────────────── */

export interface DataTableColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  numeric?: boolean;
  mono?: boolean;
  className?: string;
  cell: (row: T, index: number) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T, index: number) => string;
  isLoading?: boolean;
  emptyMessage?: string;
  className?: string;
  /** Rendered below tbody, before tfoot — for totals rows or summary sections */
  footer?: React.ReactNode;
  /** Extra CSS classes applied to each <tr> based on the row */
  rowClassName?: (row: T, index: number) => string;
  /** Whether to alternate row backgrounds */
  striped?: boolean;
}

/* ─── Component ──────────────────────────────────────────────── */

export function DataTable<T>({
  columns,
  data,
  rowKey,
  isLoading = false,
  emptyMessage = 'Aucune donnée.',
  className,
  footer,
  rowClassName,
  striped = true,
}: DataTableProps<T>) {
  return (
    <div className={cn('overflow-x-auto rounded-sm border border-line', className)}>
      <table className="w-full text-sm">
        {/* Head */}
        <thead>
          <tr className="border-b border-line bg-sunk">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'px-3 py-2.5',
                  col.align === 'right'
                    ? 'text-right'
                    : col.align === 'center'
                      ? 'text-center'
                      : 'text-left',
                  col.className,
                )}
              >
                <span className="eyebrow">{col.header}</span>
              </th>
            ))}
          </tr>
        </thead>

        {/* Body */}
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center">
                <div className="flex items-center justify-center gap-2 text-sm text-ink-mute">
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                  Chargement…
                </div>
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-8 text-center text-sm text-ink-mute"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                className={cn(
                  'border-b border-line last:border-0 transition-colors duration-fast',
                  striped && i % 2 === 1 ? 'bg-sunk/25' : 'bg-paper',
                  rowClassName?.(row, i),
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'px-3 py-2.5',
                      col.align === 'right'
                        ? 'text-right'
                        : col.align === 'center'
                          ? 'text-center'
                          : 'text-left',
                      col.numeric && 'num tabular-nums',
                      col.mono && 'font-mono text-xs',
                      col.className,
                    )}
                  >
                    {col.cell(row, i)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>

        {footer && (
          <tfoot>
            <tr className="border-t border-line-strong bg-sunk">{footer}</tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/* ─── Footer cell helper ─────────────────────────────────────── */

export function DataTableFooterCell({
  children,
  align = 'left',
  colSpan,
  className,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  colSpan?: number;
  className?: string;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        'px-3 py-2.5 text-sm font-medium text-ink',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
    >
      {children}
    </td>
  );
}
