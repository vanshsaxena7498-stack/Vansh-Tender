import { useMemo, useState } from 'react';
import { Download, FileText, Plus, Search } from 'lucide-react';
import type { EmdBgRecord, Tender } from '../types/crm';
import {
  ACTIVE_LOCKED_STATUSES,
  COMPLETED_TENDER_STAGES,
  computeEmdBgSummary,
  isBgOrFdr,
} from '../utils/calculations';
import {
  buildCsvContent,
  downloadTextFile,
  formatINR,
  formatINRCompact,
  formatShortDate,
  getDaysRemaining,
} from '../utils/formatters';
import { sortRecordsByDate, type DateSortDirection } from '../utils/tableSorting';
import {
  CrmCompactTable,
  DeleteConfirmModal,
  PreviewField,
  RecordPreviewModal,
} from './CompactTableKit';

interface EmdBgTabProps {
  records: EmdBgRecord[];
  tenders: Tender[];
  onAddRecord: () => void;
  onEditRecord: (record: EmdBgRecord) => void;
  onDeleteRecord: (id: string) => void;
}

type InstrumentFilter = 'ALL' | 'EMD_ONLY' | 'BG_FDR_ONLY';
type StatusFilter = 'ALL' | 'ACTIVE' | 'EXPIRING_SOON' | 'PENDING_REFUND' | 'RELEASED';

function getValidityBadge(r: EmdBgRecord): { label: string; cls: string } {
  const isReleased = r.status === 'Refunded / Released' || r.status === 'Forfeited';
  const daysLeft = r.expiryDate ? getDaysRemaining(r.expiryDate) : null;

  if (isReleased) {
    return {
      label: r.status === 'Forfeited' ? 'Forfeited' : 'Closed',
      cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    };
  }
  if (daysLeft === null) {
    return {
      label: 'No Expiry',
      cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    };
  }
  if (daysLeft < 0) {
    return {
      label: `Expired (${Math.abs(daysLeft)}d)`,
      cls: 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-400',
    };
  }
  if (daysLeft < 30) {
    return {
      label: `Expiring in ${daysLeft}d`,
      cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400',
    };
  }
  return {
    label: `Safe (${daysLeft}d)`,
    cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400',
  };
}

export function EmdBgTab({
  records,
  tenders,
  onAddRecord,
  onEditRecord,
  onDeleteRecord,
}: EmdBgTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [instrumentFilter, setInstrumentFilter] = useState<InstrumentFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [dateSortDir, setDateSortDir] = useState<DateSortDirection>('desc');
  const [previewRecord, setPreviewRecord] = useState<EmdBgRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EmdBgRecord | null>(null);

  const summary = useMemo(
    () => computeEmdBgSummary(records, tenders),
    [records, tenders],
  );

  const tenderByCode = useMemo(
    () => new Map(tenders.map((t) => [t.tenderId.toLowerCase(), t])),
    [tenders],
  );

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const now = new Date();
    const matched = records.filter((r) => {
      if (q) {
        const hit =
          r.tenderId.toLowerCase().includes(q) ||
          r.department.toLowerCase().includes(q) ||
          r.referenceNo.toLowerCase().includes(q) ||
          r.bankName.toLowerCase().includes(q);
        if (!hit) return false;
      }

      if (instrumentFilter === 'EMD_ONLY' && isBgOrFdr(r.instrumentType)) return false;
      if (instrumentFilter === 'BG_FDR_ONLY' && !isBgOrFdr(r.instrumentType)) return false;

      const isActive = (ACTIVE_LOCKED_STATUSES as readonly string[]).includes(r.status);
      const daysLeft = r.expiryDate ? getDaysRemaining(r.expiryDate, now) : 999;
      const linked = tenderByCode.get(r.tenderId.toLowerCase());
      const daysSinceCompletion =
        linked && COMPLETED_TENDER_STAGES.includes(linked.stage)
          ? -getDaysRemaining(linked.completionDate || linked.submissionDueDate, now)
          : 0;

      switch (statusFilter) {
        case 'ACTIVE':
          return isActive;
        case 'EXPIRING_SOON':
          return isActive && Boolean(r.expiryDate) && daysLeft <= 30;
        case 'PENDING_REFUND':
          return (
            isActive &&
            (r.status === 'Refund / Release Applied' || daysSinceCompletion > 60)
          );
        case 'RELEASED':
          return r.status === 'Refunded / Released';
        default:
          return true;
      }
    });
    return sortRecordsByDate(matched, (r) => r.issueDate || r.expiryDate, dateSortDir);
  }, [records, searchQuery, instrumentFilter, statusFilter, tenderByCode, dateSortDir]);

  const handleExportCsv = () => {
    const headers = [
      'Tender ID',
      'Department',
      'Instrument Type',
      'Reference / UTR / BG No.',
      'Issuing Bank',
      'Amount (INR)',
      'Issue Date',
      'Expiry / Maturity Date',
      'Claim End Date',
      'Status',
      'Refund / Release Date',
      'Refund Ref',
      'Remarks',
    ];
    const rows = filteredRecords.map((r) => [
      r.tenderId,
      r.department,
      r.instrumentType,
      r.referenceNo,
      r.bankName,
      r.amount,
      r.issueDate,
      r.expiryDate,
      r.claimEndDate,
      r.status,
      r.refundDate ?? '',
      r.refundRef ?? '',
      r.remarks,
    ]);
    const csv = buildCsvContent(headers, rows);
    downloadTextFile(
      `BidLedger_EMD_BG_Report_${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
      'text/csv;charset=utf-8;',
    );
  };

  const summaryCards = [
    {
      label: 'Total Active EMD Locked',
      amount: summary.activeEmdLocked,
      tone: 'text-[#1E3A8A] dark:text-blue-400',
    },
    {
      label: 'Total Active Bank Guarantees',
      amount: summary.activeBgTotal,
      tone: 'text-slate-900 dark:text-slate-100',
    },
    {
      label: 'Total Pending Refund / Overdue',
      amount: summary.pendingRefundOverdue,
      tone: 'text-amber-700 dark:text-amber-400',
    },
    {
      label: 'Total Safely Released / Refunded',
      amount: summary.safelyReleased,
      tone: 'text-emerald-700 dark:text-emerald-400',
    },
  ];

  const previewValidity = previewRecord ? getValidityBadge(previewRecord) : null;
  const previewLocation = previewRecord
    ? tenderByCode.get(previewRecord.tenderId.toLowerCase())?.location || '—'
    : '—';

  return (
    <div className="space-y-4">
      {/* Top Financial Summary Strip */}
      <section
        aria-label="EMD and Bank Guarantee Summary"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        {summaryCards.map((c) => (
          <div
            key={c.label}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4"
          >
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {c.label}
            </p>
            <p className={`font-mono-num text-xl font-semibold mt-2 ${c.tone}`}>
              {formatINR(c.amount)}
            </p>
            <p className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              {formatINRCompact(c.amount)}
            </p>
          </div>
        ))}
      </section>

      {/* Filter & Action Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search
              className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <label htmlFor="emd-search-input" className="sr-only">
              Search EMD and Bank Guarantees
            </label>
            <input
              id="emd-search-input"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Tender ID, UTR/BG Ref, Bank, Department..."
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
              onClick={onAddRecord}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Add EMD / BG Entry</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5" role="group" aria-label="Instrument Type Filter">
            <span className="text-slate-500 dark:text-slate-400 mr-1">Instrument:</span>
            {(
              [
                { key: 'ALL', label: 'All' },
                { key: 'EMD_ONLY', label: 'EMD Only' },
                { key: 'BG_FDR_ONLY', label: 'BG / FDR Only' },
              ] as { key: InstrumentFilter; label: string }[]
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setInstrumentFilter(opt.key)}
                aria-pressed={instrumentFilter === opt.key}
                className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap transition-colors ${
                  instrumentFilter === opt.key
                    ? 'bg-[#1E3A8A] text-white dark:bg-blue-600'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Status Filter">
            <span className="text-slate-500 dark:text-slate-400 mr-1">Status:</span>
            {(
              [
                { key: 'ALL', label: 'All' },
                { key: 'ACTIVE', label: 'Active' },
                { key: 'EXPIRING_SOON', label: 'Expiring Soon' },
                { key: 'PENDING_REFUND', label: 'Pending Refund' },
                { key: 'RELEASED', label: 'Released' },
              ] as { key: StatusFilter; label: string }[]
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setStatusFilter(opt.key)}
                aria-pressed={statusFilter === opt.key}
                className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap transition-colors ${
                  statusFilter === opt.key
                    ? 'bg-[#1E3A8A] text-white dark:bg-blue-600'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Compact 6-Column + Actions Table */}
      <CrmCompactTable
        rows={filteredRecords}
        getRowKey={(r) => r.id}
        getTenderNo={(r) => r.tenderId}
        onClickTenderNo={(r) => setPreviewRecord(r)}
        getDepartmentName={(r) => r.department}
        getLocation={(r) => tenderByCode.get(r.tenderId.toLowerCase())?.location || '—'}
        getDateLabel={(r) => formatShortDate(r.issueDate || r.expiryDate)}
        getDescription={(r) => r.remarks || `${r.instrumentType} · ${r.referenceNo}`}
        getRecordLabel={(r) => `${r.tenderId} (${r.referenceNo})`}
        dateSortDir={dateSortDir}
        onToggleDateSort={() =>
          setDateSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'))
        }
        onPreview={(r) => setPreviewRecord(r)}
        onEdit={(r) => onEditRecord(r)}
        onRequestDelete={(r) => setDeleteTarget(r)}
        emptyContent={
          <div className="px-6 py-12 text-center space-y-3">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              No EMD or Bank Guarantee records match your filters.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setInstrumentFilter('ALL');
                setStatusFilter('ALL');
              }}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
            >
              Reset Filters
            </button>
          </div>
        }
      />

      {/* Full-Detail Read-Only Preview Modal */}
      {previewRecord && (
        <RecordPreviewModal
          open
          title={`${previewRecord.tenderId} · ${previewRecord.referenceNo}`}
          subtitle={`${previewRecord.department} · ${previewLocation}`}
          badge={
            previewValidity && (
              <span
                className={`font-mono-num inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${previewValidity.cls}`}
              >
                {previewValidity.label}
              </span>
            )
          }
          onClose={() => setPreviewRecord(null)}
        >
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
              <PreviewField label="Tender ID" value={previewRecord.tenderId} mono />
              <PreviewField label="Department" value={previewRecord.department} />
              <PreviewField label="Location" value={previewLocation} />
              <PreviewField label="Instrument Type" value={previewRecord.instrumentType} />
              <PreviewField
                label="Reference / UTR / BG No."
                value={previewRecord.referenceNo}
                mono
              />
              <PreviewField label="Issuing Bank" value={previewRecord.bankName || '—'} />
              <PreviewField
                label="Amount (INR)"
                value={formatINR(previewRecord.amount)}
                mono
              />
              <PreviewField label="Current Status" value={previewRecord.status} />
              <PreviewField
                label="Issue Date"
                value={formatShortDate(previewRecord.issueDate)}
                mono
              />
              <PreviewField
                label="Expiry / Maturity Date"
                value={formatShortDate(previewRecord.expiryDate)}
                mono
              />
              <PreviewField
                label="Claim End Date"
                value={formatShortDate(previewRecord.claimEndDate)}
                mono
              />
              <PreviewField
                label="Refund / Release Date"
                value={formatShortDate(previewRecord.refundDate)}
                mono
              />
              <PreviewField
                label="Refund Reference"
                value={previewRecord.refundRef || '—'}
                mono
              />
            </div>

            <PreviewField label="Remarks" value={previewRecord.remarks || '—'} />

            {previewRecord.attachments && previewRecord.attachments.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Attached Documents ({previewRecord.attachments.length})
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {previewRecord.attachments.map((att) => (
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
        title={`Delete EMD / BG ${deleteTarget?.referenceNo ?? ''}`}
        description={`Are you sure you want to delete ${deleteTarget?.instrumentType ?? 'this entry'} (${
          deleteTarget?.referenceNo ?? ''
        }) for tender "${deleteTarget?.tenderId ?? ''}"?`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            onDeleteRecord(deleteTarget.id);
          }
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
