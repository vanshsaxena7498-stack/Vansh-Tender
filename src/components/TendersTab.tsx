import { useMemo, useState } from 'react';
import { Download, FileText, Plus, Search } from 'lucide-react';
import type { EmdBgRecord, Tender, TenderStage } from '../types/crm';
import {
  buildCsvContent,
  downloadTextFile,
  formatDateTime,
  formatINR,
  formatShortDate,
  getDaysRemaining,
  getLatestRemarkText,
} from '../utils/formatters';
import {
  MIS_MONTHLY_TENDER_HEADERS,
  serializeTenderForSheet,
} from '../utils/googleSheetSync';
import { sortRecordsByDate, type DateSortDirection } from '../utils/tableSorting';
import {
  CrmCompactTable,
  DeleteConfirmModal,
  PreviewField,
  RecordPreviewModal,
} from './CompactTableKit';

interface TendersTabProps {
  tenders: Tender[];
  emdRecords: EmdBgRecord[];
  defaultOwner?: string;
  onAddTender: () => void;
  onEditTender: (tender: Tender) => void;
  onOpenTender: (tender: Tender) => void;
  onDeleteTender: (id: string) => void;
}

type QuickFilterKey =
  | 'ALL'
  | 'DUE_WEEK'
  | 'SUBMITTED'
  | 'UNDER_EVAL'
  | 'WON'
  | 'LOST'
  | 'NOT_FILLED';

const QUICK_FILTERS: { key: QuickFilterKey; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'DUE_WEEK', label: 'Due This Week' },
  { key: 'SUBMITTED', label: 'Submitted' },
  { key: 'UNDER_EVAL', label: 'Under Eval' },
  { key: 'WON', label: 'L1 / Won' },
  { key: 'LOST', label: 'Lost' },
  { key: 'NOT_FILLED', label: 'Not Filled' },
];

function getStageBadgeClass(stage: TenderStage): string {
  switch (stage) {
    case 'L1 / Won':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400';
    case 'Lost (L2/L3)':
      return 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-400';
    case 'Technical Eval':
    case 'Financial / BOQ Eval':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400';
    case 'Submitted':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400';
    case 'Tender Not Filled':
      return 'bg-red-100 text-red-700 border border-red-200 dark:bg-red-950/70 dark:text-red-300 dark:border-red-800/70';
    case 'Cancelled / Retendered':
      return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }
}

export function TendersTab({
  tenders,
  emdRecords,
  defaultOwner,
  onAddTender,
  onEditTender,
  onOpenTender,
  onDeleteTender,
}: TendersTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilterKey>('ALL');
  const [dateSortDir, setDateSortDir] = useState<DateSortDirection>('desc');
  const [previewTender, setPreviewTender] = useState<Tender | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Tender | null>(null);

  const filteredTenders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const now = new Date();
    const matched = tenders.filter((t) => {
      if (q) {
        const matches =
          t.tenderId.toLowerCase().includes(q) ||
          t.title.toLowerCase().includes(q) ||
          (t.clientName || '').toLowerCase().includes(q) ||
          t.department.toLowerCase().includes(q) ||
          (t.locationDepartment || '').toLowerCase().includes(q) ||
          t.location.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          (t.assignedOwner || '').toLowerCase().includes(q) ||
          (t.l1BidderName || '').toLowerCase().includes(q) ||
          t.portal.toLowerCase().includes(q);
        if (!matches) return false;
      }
      switch (quickFilter) {
        case 'DUE_WEEK': {
          const d = getDaysRemaining(t.submissionDueDate, now);
          return (
            d >= 0 &&
            d <= 7 &&
            (t.stage === 'Identified / Reviewing' || t.stage === 'Doc Preparation')
          );
        }
        case 'SUBMITTED':
          return t.stage === 'Submitted';
        case 'UNDER_EVAL':
          return t.stage === 'Technical Eval' || t.stage === 'Financial / BOQ Eval';
        case 'WON':
          return t.stage === 'L1 / Won';
        case 'LOST':
          return t.stage === 'Lost (L2/L3)';
        case 'NOT_FILLED':
          return t.stage === 'Tender Not Filled';
        default:
          return true;
      }
    });
    return sortRecordsByDate(matched, (t) => t.submissionDueDate, dateSortDir);
  }, [tenders, searchQuery, quickFilter, dateSortDir]);

  const handleExportCsv = () => {
    const headers = [...MIS_MONTHLY_TENDER_HEADERS];
    const rows = filteredTenders.map((t, index) => {
      const serialized = serializeTenderForSheet(t, {
        serialNo: index + 1,
        assignedOwner: defaultOwner,
      });
      const scopeWithCategory =
        serialized.category &&
        !serialized.title.toLowerCase().includes(serialized.category.toLowerCase())
          ? `${serialized.title} [${serialized.category}]`
          : serialized.title;
      return [
        serialized.serialNo ?? index + 1,
        serialized.tenderId,
        serialized.clientName,
        serialized.locationDepartment,
        serialized.location,
        scopeWithCategory,
        serialized.portal,
        serialized.publishDate,
        serialized.submissionDueDate,
        serialized.preBidDate,
        serialized.estimatedValue,
        serialized.emdAmount,
        serialized.emdMode,
        serialized.stage,
        serialized.technicalOpeningDate,
        serialized.financialOpeningDate,
        serialized.l1BidderName,
        serialized.l1QuotedValue,
        serialized.ourPositionRank,
        serialized.assignedOwner,
        serialized.remarksNextAction,
      ];
    });
    const csv = buildCsvContent(headers, rows);
    downloadTextFile(
      `BidLedger_MIS_Tenders_${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
      'text/csv;charset=utf-8;',
    );
  };

  const syncedSet = useMemo(
    () => new Set(emdRecords.map((r) => r.tenderId.toLowerCase())),
    [emdRecords],
  );

  return (
    <div className="space-y-4">
      {/* Top Action Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search
              className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <label htmlFor="tender-search-input" className="sr-only">
              Search tenders by ID, Title, Department, or City
            </label>
            <input
              id="tender-search-input"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Tender ID, Title, Department, City/State..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Export CSV / Excel</span>
            </button>

            <button
              type="button"
              onClick={onAddTender}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Add New Tender</span>
            </button>
          </div>
        </div>

        {/* Quick Filter Buttons */}
        <div
          role="group"
          aria-label="Quick tender stage filters"
          className="flex flex-wrap items-center gap-1.5"
        >
          {QUICK_FILTERS.map((f) => {
            const active = quickFilter === f.key;
            const isNotFilledFilter = f.key === 'NOT_FILLED';
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setQuickFilter(f.key)}
                aria-pressed={active}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? isNotFilledFilter
                      ? 'bg-red-600 text-white dark:bg-red-600'
                      : 'bg-[#1E3A8A] text-white dark:bg-blue-600'
                    : isNotFilledFilter
                      ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/60 hover:bg-red-100 dark:hover:bg-red-950/50'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {f.label}
              </button>
            );
          })}
          <span className="ml-auto font-mono-num text-xs text-slate-500 dark:text-slate-400">
            Showing {filteredTenders.length} of {tenders.length} tenders
          </span>
        </div>
      </div>

      {/* Compact 6-Column + Actions Table */}
      <CrmCompactTable
        rows={filteredTenders}
        getRowKey={(t) => t.id}
        getTenderNo={(t) => t.tenderId}
        onClickTenderNo={(t) => onOpenTender(t)}
        getDepartmentName={(t) => t.clientName || t.department}
        getLocation={(t) => t.location || '—'}
        getDateLabel={(t) => formatShortDate(t.submissionDueDate)}
        getDescription={(t) => t.title}
        getRecordLabel={(t) => t.tenderId}
        getRowClassName={(t) =>
          t.stage === 'Tender Not Filled'
            ? 'bg-red-50/75 hover:bg-red-100/75 dark:bg-red-950/30 dark:hover:bg-red-950/45'
            : ''
        }
        dateSortDir={dateSortDir}
        onToggleDateSort={() =>
          setDateSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'))
        }
        onPreview={(t) => setPreviewTender(t)}
        onEdit={(t) => onEditTender(t)}
        onRequestDelete={(t) => setDeleteTarget(t)}
        emptyContent={
          <div className="px-6 py-12 text-center space-y-3">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              No tenders match your current search or stage filter.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setQuickFilter('ALL');
                }}
                className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                Clear Filters
              </button>
              <button
                type="button"
                onClick={onAddTender}
                className="px-4 py-2 rounded-lg bg-[#1E3A8A] text-white text-xs font-medium"
              >
                Add New Tender
              </button>
            </div>
          </div>
        }
      />

      {/* Full-Detail Read-Only Preview Modal */}
      {previewTender && (
        <RecordPreviewModal
          open
          title={previewTender.tenderId}
          subtitle={`${previewTender.department} · ${previewTender.location || 'India'}`}
          badge={
            <span
              className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${getStageBadgeClass(
                previewTender.stage,
              )}`}
            >
              {previewTender.stage}
            </span>
          }
          onClose={() => setPreviewTender(null)}
        >
          <div className="space-y-5">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-4">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Brief Description &amp; Scope of Work
              </p>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mt-1">
                {previewTender.title}
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
              <PreviewField
                label="Client / Organization Name"
                value={previewTender.clientName || previewTender.department}
              />
              <PreviewField
                label="Location / Department"
                value={
                  previewTender.locationDepartment ||
                  [previewTender.location, previewTender.department].filter(Boolean).join(' / ')
                }
              />
              <PreviewField label="Portal / Platform" value={previewTender.portal} />
              <PreviewField label="Work / Item Category" value={previewTender.category || '—'} />
              <PreviewField
                label="Assigned Person / Owner"
                value={previewTender.assignedOwner || defaultOwner || '—'}
              />
              <PreviewField label="Location" value={previewTender.location || '—'} />
              <PreviewField
                label="Publish / Tender Date"
                value={formatShortDate(previewTender.publishDate)}
                mono
              />
              <PreviewField
                label="Due Date & Time"
                value={formatDateTime(previewTender.submissionDueDate)}
                mono
              />
              <PreviewField
                label="Pre-Bid Meeting Date"
                value={formatShortDate(previewTender.preBidDate)}
                mono
              />
              <PreviewField
                label="Technical Opening Date"
                value={formatShortDate(previewTender.technicalOpeningDate)}
                mono
              />
              <PreviewField
                label="Financial Opening Date"
                value={formatShortDate(
                  previewTender.financialOpeningDate || previewTender.completionDate,
                )}
                mono
              />
              <PreviewField
                label="Estimated Value (INR)"
                value={formatINR(previewTender.estimatedValue)}
                mono
              />
              <PreviewField
                label="Our Quoted Bid (INR)"
                value={
                  previewTender.quotedValue > 0 ? formatINR(previewTender.quotedValue) : '—'
                }
                mono
              />
              <PreviewField
                label="EMD Amount & Mode"
                value={`${
                  previewTender.emdAmount > 0 ? formatINR(previewTender.emdAmount) : 'Exempt / ₹ 0'
                } (${previewTender.emdStatus})${
                  syncedSet.has(previewTender.tenderId.toLowerCase()) ? ' · Synced' : ''
                }`}
                mono
              />
              <PreviewField label="L1 Bidder Name" value={previewTender.l1BidderName || '—'} />
              <PreviewField
                label="L1 Quoted Value (INR)"
                value={
                  previewTender.l1QuotedValue && previewTender.l1QuotedValue > 0
                    ? formatINR(previewTender.l1QuotedValue)
                    : previewTender.quotedValue > 0
                      ? formatINR(previewTender.quotedValue)
                      : '—'
                }
                mono
              />
              <PreviewField
                label="Our Position / Rank"
                value={
                  previewTender.ourPositionRank ||
                  (previewTender.stage === 'L1 / Won'
                    ? 'L1'
                    : previewTender.stage === 'Lost (L2/L3)'
                      ? 'L2 / L3'
                      : '—')
                }
              />
              <PreviewField
                label="Checklist Progress"
                value={`${previewTender.checklist.filter((c) => c.checked).length} / ${
                  previewTender.checklist.length
                } Ready`}
                mono
              />
            </div>

            <div className="space-y-2">
              <PreviewField
                label="Result / Remarks Summary"
                value={
                  [getLatestRemarkText(previewTender.remarks), (previewTender.resultInfo || '').trim()]
                    .filter(Boolean)
                    .join(' | ') || '—'
                }
              />
            </div>

            {previewTender.attachments && previewTender.attachments.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Attached Documents ({previewTender.attachments.length})
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {previewTender.attachments.map((att) => (
                    <a
                      key={att.id}
                      href={att.dataUrl}
                      download={att.fileName}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs text-slate-700 dark:text-slate-200"
                    >
                      <FileText className="h-3.5 w-3.5 text-[#1E3A8A] dark:text-blue-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium truncate">{att.fileName}</p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                          {att.slotLabel}
                        </p>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </RecordPreviewModal>
      )}

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        open={Boolean(deleteTarget)}
        title={`Delete Tender ${deleteTarget?.tenderId ?? ''}`}
        description={`Are you sure you want to permanently delete tender "${
          deleteTarget?.tenderId ?? ''
        }" (${deleteTarget?.department ?? ''})?`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            onDeleteTender(deleteTarget.id);
          }
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
