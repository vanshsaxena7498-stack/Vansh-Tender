import { useMemo, useState } from 'react';
import { Download, Pencil, Plus, Search, Trash2 } from 'lucide-react';
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

interface EmdBgTabProps {
  records: EmdBgRecord[];
  tenders: Tender[];
  onAddRecord: () => void;
  onEditRecord: (record: EmdBgRecord) => void;
  onDeleteRecord: (id: string) => void;
}

type InstrumentFilter = 'ALL' | 'EMD_ONLY' | 'BG_FDR_ONLY';
type StatusFilter = 'ALL' | 'ACTIVE' | 'EXPIRING_SOON' | 'PENDING_REFUND' | 'RELEASED';

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
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

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
    return records.filter((r) => {
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
  }, [records, searchQuery, instrumentFilter, statusFilter, tenderByCode]);

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

      {/* Data Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {filteredRecords.length === 0 ? (
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
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Tender ID & Dept</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Instrument & Ref</th>
                  <th className="py-2.5 px-3 font-semibold">Issuing Bank</th>
                  <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Amount (₹)</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Dates</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Validity</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Status</th>
                  <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredRecords.map((r) => {
                  const isReleased =
                    r.status === 'Refunded / Released' || r.status === 'Forfeited';
                  const daysLeft = r.expiryDate ? getDaysRemaining(r.expiryDate) : null;

                  let validityBadge = {
                    label: 'No Expiry',
                    cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
                  };
                  if (isReleased) {
                    validityBadge = {
                      label: r.status === 'Forfeited' ? 'Forfeited' : 'Closed',
                      cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
                    };
                  } else if (daysLeft !== null) {
                    if (daysLeft < 0) {
                      validityBadge = {
                        label: `Expired (${Math.abs(daysLeft)}d)`,
                        cls: 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-400',
                      };
                    } else if (daysLeft < 30) {
                      validityBadge = {
                        label: `Expiring in ${daysLeft}d`,
                        cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400',
                      };
                    } else {
                      validityBadge = {
                        label: `Safe (${daysLeft}d)`,
                        cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400',
                      };
                    }
                  }

                  return (
                    <tr
                      key={r.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-2.5 px-3 align-top max-w-[165px]">
                        <p className="font-mono-num font-semibold text-[#1E3A8A] dark:text-blue-400 truncate">
                          {r.tenderId}
                        </p>
                        <p className="text-slate-700 dark:text-slate-300 truncate mt-0.5">
                          {r.department}
                        </p>
                        {r.remarks && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {r.remarks}
                          </p>
                        )}
                      </td>

                      <td className="py-2.5 px-3 align-top max-w-[165px]">
                        <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                          {r.instrumentType}
                        </p>
                        <p className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                          {r.referenceNo}
                          {(r.attachments?.length ?? 0) > 0
                            ? ` · ${r.attachments?.length} ${r.attachments?.length === 1 ? 'doc' : 'docs'}`
                            : ''}
                        </p>
                      </td>

                      <td className="py-2.5 px-3 align-top max-w-[140px] text-slate-700 dark:text-slate-300">
                        <span className="line-clamp-2">{r.bankName}</span>
                      </td>

                      <td className="py-2.5 px-3 align-top text-right font-mono-num font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {formatINR(r.amount)}
                      </td>

                      <td className="py-2.5 px-3 align-top font-mono-num text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap space-y-0.5">
                        <div>Iss: {formatShortDate(r.issueDate)}</div>
                        <div>Exp: {formatShortDate(r.expiryDate)}</div>
                        {r.claimEndDate && <div>Clm: {formatShortDate(r.claimEndDate)}</div>}
                      </td>

                      <td className="py-2.5 px-3 align-top whitespace-nowrap">
                        <span
                          className={`font-mono-num inline-block px-2 py-1 rounded text-[11px] font-semibold ${validityBadge.cls}`}
                        >
                          {validityBadge.label}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 align-top max-w-[140px]">
                        <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                          {r.status}
                        </p>
                        {r.refundDate && (
                          <p className="font-mono-num text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5 truncate">
                            {formatShortDate(r.refundDate)} {r.refundRef ? `· ${r.refundRef}` : ''}
                          </p>
                        )}
                      </td>

                      <td className="py-2.5 px-3 align-top text-right whitespace-nowrap">
                        {deleteConfirmId === r.id ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteRecord(r.id);
                                setDeleteConfirmId(null);
                              }}
                              className="px-2 py-1 rounded bg-red-600 text-white text-[11px] font-medium"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId(null)}
                              className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-[11px]"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onEditRecord(r)}
                              aria-label={`Edit ${r.referenceNo}`}
                              className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId(r.id)}
                              aria-label={`Delete ${r.referenceNo}`}
                              className="p-1.5 rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
