import { useEffect, type ReactNode } from 'react';
import { ArrowUpDown, Eye, Pencil, Trash2, X } from 'lucide-react';
import type { DateSortDirection } from '../utils/tableSorting';

interface CrmCompactTableProps<T> {
  rows: readonly T[];
  getRowKey: (row: T) => string;
  getTenderNo: (row: T) => string;
  onClickTenderNo?: (row: T) => void;
  getDepartmentName: (row: T) => string;
  getLocation: (row: T) => string;
  getDateLabel: (row: T) => string;
  getDescription: (row: T) => string;
  getRecordLabel: (row: T) => string;
  getRowClassName?: (row: T) => string;
  dateSortDir: DateSortDirection;
  onToggleDateSort: () => void;
  onPreview: (row: T) => void;
  onEdit: (row: T) => void;
  onRequestDelete: (row: T) => void;
  emptyContent: ReactNode;
}

export function CrmCompactTable<T>({
  rows,
  getRowKey,
  getTenderNo,
  onClickTenderNo,
  getDepartmentName,
  getLocation,
  getDateLabel,
  getDescription,
  getRecordLabel,
  getRowClassName,
  dateSortDir,
  onToggleDateSort,
  onPreview,
  onEdit,
  onRequestDelete,
  emptyContent,
}: CrmCompactTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {emptyContent}
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
      <table className="w-full table-fixed text-left border-collapse text-xs">
        <colgroup>
          <col className="w-14" />
          <col className="w-[17%]" />
          <col className="w-[21%]" />
          <col className="w-[15%]" />
          <col className="w-[118px]" />
          <col className="w-auto" />
          <col className="w-[118px]" />
        </colgroup>
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300">
            <th scope="col" className="py-2.5 px-3 font-semibold whitespace-nowrap">
              S.No.
            </th>
            <th scope="col" className="py-2.5 px-3 font-semibold whitespace-nowrap">
              Tender No.
            </th>
            <th scope="col" className="py-2.5 px-3 font-semibold whitespace-nowrap">
              Department Name
            </th>
            <th scope="col" className="py-2.5 px-3 font-semibold whitespace-nowrap">
              Location
            </th>
            <th
              scope="col"
              aria-sort={dateSortDir === 'asc' ? 'ascending' : 'descending'}
              className="py-2.5 px-3 font-semibold whitespace-nowrap"
            >
              <button
                type="button"
                onClick={onToggleDateSort}
                aria-label={`Sort by Date (${
                  dateSortDir === 'asc'
                    ? 'oldest first, click for newest first'
                    : 'newest first, click for oldest first'
                })`}
                title={
                  dateSortDir === 'asc'
                    ? 'Sorted oldest first · Click for newest first'
                    : 'Sorted newest first · Click for oldest first'
                }
                className="inline-flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-200 hover:text-[#1E3A8A] dark:hover:text-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded px-1 -ml-1 py-0.5 transition-colors cursor-pointer"
              >
                <span>Date</span>
                <ArrowUpDown
                  className={`h-3.5 w-3.5 shrink-0 ${
                    dateSortDir === 'asc'
                      ? 'text-[#1E3A8A] dark:text-blue-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                  aria-hidden="true"
                />
              </button>
            </th>
            <th scope="col" className="py-2.5 px-3 font-semibold whitespace-nowrap">
              Description
            </th>
            <th scope="col" className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((row, index) => {
            const tenderNo = getTenderNo(row) || '—';
            const departmentName = getDepartmentName(row) || '—';
            const location = getLocation(row) || '—';
            const dateLabel = getDateLabel(row) || '—';
            const description = getDescription(row) || '—';
            const recordLabel = getRecordLabel(row) || tenderNo;
            const rowHighlight = getRowClassName ? getRowClassName(row) : '';

            return (
              <tr
                key={getRowKey(row)}
                className={`transition-colors ${
                  rowHighlight || 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <td className="py-2.5 px-3 font-mono-num text-slate-600 dark:text-slate-400 whitespace-nowrap">
                  {index + 1}
                </td>

                <td className="py-2.5 px-3">
                  {onClickTenderNo && tenderNo !== '—' ? (
                    <button
                      type="button"
                      onClick={() => onClickTenderNo(row)}
                      title={tenderNo}
                      className="font-mono-num font-semibold text-[#1E3A8A] dark:text-blue-400 hover:underline text-left block w-full truncate cursor-pointer"
                    >
                      {tenderNo}
                    </button>
                  ) : (
                    <span
                      title={tenderNo}
                      className="font-mono-num font-medium text-slate-800 dark:text-slate-200 block truncate"
                    >
                      {tenderNo}
                    </span>
                  )}
                </td>

                <td className="py-2.5 px-3">
                  <span
                    title={departmentName}
                    className="font-medium text-slate-900 dark:text-slate-100 block truncate"
                  >
                    {departmentName}
                  </span>
                </td>

                <td className="py-2.5 px-3">
                  <span
                    title={location}
                    className="text-slate-600 dark:text-slate-400 block truncate"
                  >
                    {location}
                  </span>
                </td>

                <td className="py-2.5 px-3 font-mono-num text-slate-700 dark:text-slate-300 whitespace-nowrap">
                  {dateLabel}
                </td>

                <td className="py-2.5 px-3">
                  <span
                    title={description}
                    className="text-slate-700 dark:text-slate-300 block truncate"
                  >
                    {description}
                  </span>
                </td>

                <td className="py-2 px-3 text-right whitespace-nowrap">
                  <div className="inline-flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => onPreview(row)}
                      aria-label={`Preview ${recordLabel}`}
                      title="Preview details"
                      className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-blue-200/80 bg-blue-50 text-[#1E3A8A] hover:bg-blue-100 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 cursor-pointer"
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onEdit(row)}
                      aria-label={`Edit ${recordLabel}`}
                      title="Edit record"
                      className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-amber-200/80 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-900/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 cursor-pointer"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRequestDelete(row)}
                      aria-label={`Delete ${recordLabel}`}
                      title="Delete record"
                      className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-red-900/20 bg-red-800 text-white hover:bg-red-900 dark:border-red-700/60 dark:bg-red-700 dark:hover:bg-red-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface DeleteConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmModal({
  open,
  title,
  description,
  onCancel,
  onConfirm,
}: DeleteConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
            {title}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel delete"
            className="p-1 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            {description}
          </p>
          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 text-white text-xs font-medium"
            >
              Confirm Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface RecordPreviewModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

export function RecordPreviewModal({
  open,
  title,
  subtitle,
  badge,
  onClose,
  children,
}: RecordPreviewModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
    >
      <div className="w-full max-w-3xl max-h-[90vh] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white truncate">
                {title}
              </h2>
              {badge}
            </div>
            {subtitle && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 dark:text-slate-400 shrink-0"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">{children}</div>

        <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex items-center justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

interface PreviewFieldProps {
  label: string;
  value: ReactNode;
  mono?: boolean;
  className?: string;
}

export function PreviewField({ label, value, mono, className = '' }: PreviewFieldProps) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <div
        className={`text-xs font-medium text-slate-900 dark:text-slate-100 mt-0.5 break-words ${
          mono ? 'font-mono-num' : ''
        }`}
      >
        {value || '—'}
      </div>
    </div>
  );
}
