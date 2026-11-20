import { useMemo, useState } from 'react';
import { Download, Eye, Pencil, Plus, Search } from 'lucide-react';
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

interface TendersTabProps {
  tenders: Tender[];
  emdRecords: EmdBgRecord[];
  defaultOwner?: string;
  onAddTender: () => void;
  onEditTender: (tender: Tender) => void;
  onOpenTender: (tender: Tender) => void;
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
}: TendersTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilterKey>('ALL');

  const filteredTenders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const now = new Date();
    return tenders
      .filter((t) => {
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
      })
      .sort((a, b) => b.submissionDueDate.localeCompare(a.submissionDueDate));
  }, [tenders, searchQuery, quickFilter]);

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

      {/* Master Operations Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {filteredTenders.length === 0 ? (
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
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[2300px] w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                  <th className="py-2.5 px-3 font-semibold text-center whitespace-nowrap">S.No.</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Tender Ref / ID</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Client / Organization Name</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Location / Department</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Location</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Brief Description &amp; Scope of Work</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Portal / Platform</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Publish / Tender Date</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Due Date &amp; Time</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Pre-Bid Meeting Date</th>
                  <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Estimated Tender Value (INR)</th>
                  <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">EMD Amount (INR)</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">EMD Mode / Form</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Current Status</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Technical Opening Date</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Financial Opening Date</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">L1 Bidder Name</th>
                  <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">L1 Quoted Value (INR)</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Our Position / Rank</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Assigned Person / Owner</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Remarks / Next Action</th>
                  <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredTenders.map((t, index) => {
                  const days = getDaysRemaining(t.submissionDueDate);
                  const isOpenStage =
                    t.stage === 'Identified / Reviewing' || t.stage === 'Doc Preparation';
                  const dueColor =
                    isOpenStage && days <= 2
                      ? 'text-red-600 dark:text-red-400 font-semibold'
                      : isOpenStage && days <= 5
                        ? 'text-amber-600 dark:text-amber-400 font-medium'
                        : 'text-slate-600 dark:text-slate-400';
                  const isSynced = syncedSet.has(t.tenderId.toLowerCase());
                  const isNotFilled = t.stage === 'Tender Not Filled';
                  const clientName = t.clientName || t.department;
                  const locationDept =
                    t.locationDepartment ||
                    [t.location, t.department].filter(Boolean).join(' / ');
                  const latestRemark = getLatestRemarkText(t.remarks);
                  const remarksSummary = [latestRemark, (t.resultInfo || '').trim()]
                    .filter(Boolean)
                    .join(' | ');
                  const l1Quoted =
                    typeof t.l1QuotedValue === 'number' && t.l1QuotedValue > 0
                      ? t.l1QuotedValue
                      : t.quotedValue;
                  const rankDisplay =
                    t.ourPositionRank ||
                    (t.stage === 'L1 / Won'
                      ? 'L1'
                      : t.stage === 'Lost (L2/L3)'
                        ? 'L2 / L3'
                        : '—');
                  const techOpen =
                    t.technicalOpeningDate ||
                    (t.stage === 'Technical Eval' ? t.completionDate : '');
                  const finOpen = t.financialOpeningDate || t.completionDate;

                  return (
                    <tr
                      key={t.id}
                      data-stage={t.stage}
                      className={`transition-colors ${
                        isNotFilled
                          ? 'bg-red-50/80 hover:bg-red-100/80 border-l-4 border-l-red-500 dark:bg-red-950/30 dark:hover:bg-red-950/45 dark:border-l-red-500'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      {/* 1. S.No. */}
                      <td className="py-2.5 px-3 align-top text-center font-mono-num text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {index + 1}
                      </td>

                      {/* 2. Tender Ref / ID */}
                      <td className="py-2.5 px-3 align-top max-w-[180px]">
                        <button
                          type="button"
                          onClick={() => onOpenTender(t)}
                          className={`font-mono-num font-semibold hover:underline text-left block truncate max-w-full ${
                            isNotFilled
                              ? 'text-red-700 dark:text-red-400'
                              : 'text-[#1E3A8A] dark:text-blue-400'
                          }`}
                          title={t.tenderId}
                        >
                          {t.tenderId}
                        </button>
                        {(t.attachments?.length ?? 0) > 0 && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                            {t.attachments?.length} {t.attachments?.length === 1 ? 'doc' : 'docs'}
                          </div>
                        )}
                      </td>

                      {/* 3. Client / Organization Name */}
                      <td className="py-2.5 px-3 align-top max-w-[200px]">
                        <p className="font-medium text-slate-900 dark:text-slate-100 truncate" title={clientName}>
                          {clientName}
                        </p>
                      </td>

                      {/* 4. Location / Department */}
                      <td className="py-2.5 px-3 align-top max-w-[200px]">
                        <p className="text-slate-700 dark:text-slate-300 truncate" title={locationDept}>
                          {locationDept || '—'}
                        </p>
                      </td>

                      {/* 5. Location */}
                      <td className="py-2.5 px-3 align-top max-w-[150px]">
                        <p className="text-slate-600 dark:text-slate-400 truncate" title={t.location}>
                          {t.location || '—'}
                        </p>
                      </td>

                      {/* 6. Brief Description & Scope of Work + Item Category Badge */}
                      <td className="py-2.5 px-3 align-top max-w-[260px]">
                        <p className="font-medium text-slate-900 dark:text-slate-100 line-clamp-2" title={t.title}>
                          {t.title}
                        </p>
                        {t.category && (
                          <span className="inline-block mt-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                            {t.category}
                          </span>
                        )}
                      </td>

                      {/* 7. Portal / Platform */}
                      <td className="py-2.5 px-3 align-top whitespace-nowrap text-slate-700 dark:text-slate-300">
                        {t.portal}
                      </td>

                      {/* 8. Publish / Tender Date */}
                      <td className="py-2.5 px-3 align-top whitespace-nowrap font-mono-num text-slate-600 dark:text-slate-400">
                        {formatShortDate(t.publishDate)}
                      </td>

                      {/* 9. Due Date & Time */}
                      <td className="py-2.5 px-3 align-top whitespace-nowrap">
                        <div className={`font-mono-num ${dueColor}`}>
                          {formatDateTime(t.submissionDueDate)}
                        </div>
                        {isOpenStage && (
                          <div className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {days < 0 ? 'Past due' : days === 0 ? 'Due Today' : `${days}d left`}
                          </div>
                        )}
                      </td>

                      {/* 10. Pre-Bid Meeting Date */}
                      <td className="py-2.5 px-3 align-top whitespace-nowrap font-mono-num text-slate-600 dark:text-slate-400">
                        {formatShortDate(t.preBidDate)}
                      </td>

                      {/* 11. Estimated Tender Value (INR) */}
                      <td className="py-2.5 px-3 align-top text-right font-mono-num text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {formatINR(t.estimatedValue)}
                      </td>

                      {/* 12. EMD Amount (INR) */}
                      <td className="py-2.5 px-3 align-top text-right font-mono-num font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {t.emdAmount > 0 ? formatINR(t.emdAmount) : 'Exempt / ₹ 0'}
                      </td>

                      {/* 13. EMD Mode / Form */}
                      <td className="py-2.5 px-3 align-top whitespace-nowrap text-slate-700 dark:text-slate-300">
                        <span>{t.emdStatus === 'Exempted - MSME/Startup' ? 'MSME Exempt' : t.emdStatus}</span>
                        {isSynced && (
                          <span className="ml-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                            · Synced
                          </span>
                        )}
                      </td>

                      {/* 14. Current Status */}
                      <td className="py-2.5 px-3 align-top whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-1 rounded text-[11px] font-semibold ${getStageBadgeClass(
                            t.stage,
                          )}`}
                        >
                          {t.stage}
                        </span>
                      </td>

                      {/* 15. Technical Opening Date */}
                      <td className="py-2.5 px-3 align-top whitespace-nowrap font-mono-num text-slate-600 dark:text-slate-400">
                        {formatShortDate(techOpen)}
                      </td>

                      {/* 16. Financial Opening Date */}
                      <td className="py-2.5 px-3 align-top whitespace-nowrap font-mono-num text-slate-600 dark:text-slate-400">
                        {formatShortDate(finOpen)}
                      </td>

                      {/* 17. L1 Bidder Name */}
                      <td className="py-2.5 px-3 align-top max-w-[160px] text-slate-700 dark:text-slate-300 truncate" title={t.l1BidderName || ''}>
                        {t.l1BidderName || '—'}
                      </td>

                      {/* 18. L1 Quoted Value (INR) */}
                      <td className="py-2.5 px-3 align-top text-right font-mono-num font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {l1Quoted > 0 ? formatINR(l1Quoted) : '—'}
                      </td>

                      {/* 19. Our Position / Rank */}
                      <td className="py-2.5 px-3 align-top whitespace-nowrap font-medium text-slate-700 dark:text-slate-300">
                        {rankDisplay}
                      </td>

                      {/* 20. Assigned Person / Owner */}
                      <td className="py-2.5 px-3 align-top whitespace-nowrap text-slate-700 dark:text-slate-300">
                        {t.assignedOwner || defaultOwner || '—'}
                      </td>

                      {/* 21. Remarks / Next Action */}
                      <td className="py-2.5 px-3 align-top max-w-[240px]">
                        <p className="text-slate-600 dark:text-slate-400 line-clamp-2" title={remarksSummary}>
                          {remarksSummary || '—'}
                        </p>
                      </td>

                      {/* Actions */}
                      <td className="py-2.5 px-3 align-top text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onOpenTender(t)}
                            aria-label={`Inspect ${t.tenderId}`}
                            className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onEditTender(t)}
                            aria-label={`Edit ${t.tenderId}`}
                            className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        </div>
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
