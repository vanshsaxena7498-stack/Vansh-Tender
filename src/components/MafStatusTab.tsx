import { useMemo, useState } from 'react';
import { Download, ExternalLink, FileText, Link2, Plus, Search } from 'lucide-react';
import type { MafItemStatus, MafLineItem, MafTrackerRecord, Tender } from '../types/crm';
import {
  buildCsvContent,
  downloadTextFile,
  formatShortDate,
  getLocalDateInputValue,
} from '../utils/formatters';
import {
  computeMafSummaryMetrics,
  getMafContactDetails,
  getMafRequestedDate,
  isSafeHttpUrl,
  isSafeMafDataUrl,
  MAF_STATUS_OPTIONS,
  resolveAndFilterMafTrackers,
  type ResolvedMafTracker,
} from '../utils/mafCalculations';
import { sortRecordsByDate, type DateSortDirection } from '../utils/tableSorting';
import {
  CrmCompactTable,
  DeleteConfirmModal,
  PreviewField,
  RecordPreviewModal,
} from './CompactTableKit';

interface MafStatusTabProps {
  trackers: MafTrackerRecord[];
  tenders: Tender[];
  onAddTracker: () => void;
  onEditTracker: (tracker: MafTrackerRecord) => void;
  onDeleteTracker: (trackerId: string) => void;
  onOpenNewItemModal?: (tracker: MafTrackerRecord) => void;
  onOpenEditItemModal?: (tracker: MafTrackerRecord, item: MafLineItem) => void;
  onInlineStatusChange?: (
    trackerId: string,
    itemId: string,
    nextStatus: MafItemStatus,
  ) => void;
  onInlineFileUpload?: (trackerId: string, itemId: string, file: File) => Promise<void>;
  onDeleteItem?: (trackerId: string, itemId: string) => void;
  onValidationError?: (msg: string) => void;
}

function getMafStatusBadgeClass(status: MafItemStatus): string {
  switch (status) {
    case 'Pending':
      return 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800/70';
    case 'Received / Approved':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70';
    case 'Under Approval':
      return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70';
    case 'Requested / Follow-up':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-950/60 dark:text-yellow-300 dark:border-yellow-800/70';
    case 'Rejected':
      return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800/70';
    default:
      return 'bg-slate-200 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
  }
}

export function MafStatusTab({
  trackers,
  tenders,
  onAddTracker,
  onEditTracker,
  onDeleteTracker,
}: MafStatusTabProps) {
  const [tenderQuery, setTenderQuery] = useState('');
  const [itemOrOemQuery, setItemOrOemQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | MafItemStatus>('ALL');
  const [dateSortDir, setDateSortDir] = useState<DateSortDirection>('desc');
  const [previewTracker, setPreviewTracker] = useState<ResolvedMafTracker | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ResolvedMafTracker | null>(null);

  const tenderMaps = useMemo(() => {
    const byId = new Map(tenders.map((t) => [t.id, t]));
    const byCode = new Map(tenders.map((t) => [t.tenderId.trim().toLowerCase(), t]));
    return { byId, byCode };
  }, [tenders]);

  const resolveLocation = (tracker: ResolvedMafTracker): string => {
    const linked =
      (tracker.tenderRefId ? tenderMaps.byId.get(tracker.tenderRefId) : undefined) ??
      tenderMaps.byCode.get(tracker.tenderId.trim().toLowerCase());
    return linked?.location || '—';
  };

  const metrics = useMemo(
    () => computeMafSummaryMetrics(trackers, tenders),
    [trackers, tenders],
  );

  const filteredTrackers = useMemo(() => {
    const resolved = resolveAndFilterMafTrackers(trackers, tenders, {
      tenderQuery,
      itemOrOemQuery,
      statusFilter,
    });
    return sortRecordsByDate(
      resolved,
      (tr) => tr.resolvedDueDate || tr.updatedAt,
      dateSortDir,
    );
  }, [trackers, tenders, tenderQuery, itemOrOemQuery, statusFilter, dateSortDir]);

  const handleExportCsv = () => {
    const headers = [
      'Tender ID',
      'Tender Title',
      'Department',
      'Tender Due Date',
      'Overall MAF Status',
      'Item Name',
      'Required Quantity',
      'OEM Name',
      'Company Name',
      'Concerned Person Name',
      'Contact No.',
      'Mail ID',
      'Item MAF Status',
      'MAF Requested Date',
      'Attachment / Link',
      'Remarks',
    ];
    const rows: (string | number)[][] = [];
    for (const tracker of filteredTrackers) {
      const items = tracker.matchedItems.length > 0 ? tracker.matchedItems : tracker.itemsMAF;
      if (items.length === 0) {
        rows.push([
          tracker.tenderId,
          tracker.resolvedTenderTitle,
          tracker.resolvedDepartment,
          tracker.resolvedDueDate,
          tracker.overallStatus,
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
        ]);
      } else {
        for (const item of items) {
          const contact = getMafContactDetails(item);
          rows.push([
            tracker.tenderId,
            tracker.resolvedTenderTitle,
            tracker.resolvedDepartment,
            tracker.resolvedDueDate,
            tracker.overallStatus,
            item.itemName,
            item.requiredQuantity,
            item.oemName,
            item.companyName ?? '',
            contact.concernedPersonName,
            contact.contactNo,
            contact.mailId,
            item.mafStatus,
            getMafRequestedDate(item),
            item.mafDocumentName ||
              (item.mafDocumentUrl.startsWith('data:') ? 'Uploaded File' : item.mafDocumentUrl),
            item.remarks,
          ]);
        }
      }
    }
    downloadTextFile(
      `MAF_Tracker_${getLocalDateInputValue()}.csv`,
      buildCsvContent(headers, rows),
      'text/csv;charset=utf-8;',
    );
  };

  const previewItems = previewTracker
    ? itemOrOemQuery.trim() && previewTracker.matchedItems.length > 0
      ? previewTracker.matchedItems
      : previewTracker.itemsMAF
    : [];

  return (
    <div className="space-y-5">
      {/* 4 Top Summary Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total Active Tenders
          </p>
          <p className="font-mono-num text-2xl sm:text-3xl font-bold text-[#0F172A] dark:text-white mt-1.5">
            {metrics.totalActiveTenders}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total Items Tracked
          </p>
          <p className="font-mono-num text-2xl sm:text-3xl font-bold text-[#0F172A] dark:text-white mt-1.5">
            {metrics.totalItemsTracked}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">MAF Pending</p>
          <p className="font-mono-num text-2xl sm:text-3xl font-bold text-amber-600 dark:text-amber-400 mt-1.5">
            {metrics.mafPending}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">MAF Received</p>
          <p className="font-mono-num text-2xl sm:text-3xl font-bold text-emerald-600 dark:text-emerald-400 mt-1.5">
            {metrics.mafReceived}
          </p>
        </div>
      </div>

      {/* Header + Filter Controls */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base sm:text-lg font-bold text-slate-900 dark:text-white">
              Tender-OEM MAF Tracker
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Linked by multiple BOQ items &amp; OEMs per tender
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Export CSV / Excel</span>
            </button>

            <button
              type="button"
              onClick={onAddTracker}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Add MAF Status</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-4 flex items-center gap-2">
            <label
              htmlFor="maf-filter-tender"
              className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap"
            >
              Tender ID:
            </label>
            <div className="relative flex-1">
              <Search
                className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                id="maf-filter-tender"
                type="text"
                value={tenderQuery}
                onChange={(e) => setTenderQuery(e.target.value)}
                placeholder="Search Tender ID..."
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="md:col-span-4 flex items-center gap-2">
            <label
              htmlFor="maf-filter-item"
              className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap"
            >
              Item / OEM:
            </label>
            <input
              id="maf-filter-item"
              type="text"
              value={itemOrOemQuery}
              onChange={(e) => setItemOrOemQuery(e.target.value)}
              placeholder="Item Name or OEM Name..."
              className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="md:col-span-4 flex items-center gap-2">
            <label
              htmlFor="maf-filter-status"
              className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap"
            >
              Overall Status:
            </label>
            <select
              id="maf-filter-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'ALL' | MafItemStatus)}
              className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="ALL">All</option>
              {MAF_STATUS_OPTIONS.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Compact 6-Column + Actions Table */}
      <CrmCompactTable
        rows={filteredTrackers}
        getRowKey={(tr) => tr.id}
        getTenderNo={(tr) => tr.tenderId}
        onClickTenderNo={(tr) => setPreviewTracker(tr)}
        getDepartmentName={(tr) => tr.resolvedDepartment}
        getLocation={resolveLocation}
        getDateLabel={(tr) => formatShortDate(tr.resolvedDueDate || tr.updatedAt)}
        getDescription={(tr) => tr.resolvedTenderTitle}
        getRecordLabel={(tr) => tr.tenderId}
        dateSortDir={dateSortDir}
        onToggleDateSort={() =>
          setDateSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'))
        }
        onPreview={(tr) => setPreviewTracker(tr)}
        onEdit={(tr) => onEditTracker(tr)}
        onRequestDelete={(tr) => setDeleteTarget(tr)}
        emptyContent={
          <div className="py-12 px-4 text-center text-xs text-slate-500 dark:text-slate-400 space-y-3">
            <p>
              No MAF tracker records match the current filters. Click{' '}
              <span className="font-semibold text-[#1E3A8A] dark:text-blue-400">
                + Add MAF Status
              </span>{' '}
              to link OEM authorizations to a tender.
            </p>
            {(tenderQuery || itemOrOemQuery || statusFilter !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setTenderQuery('');
                  setItemOrOemQuery('');
                  setStatusFilter('ALL');
                }}
                className="px-3.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                Clear Filters
              </button>
            )}
          </div>
        }
      />

      {/* Full-Detail Read-Only Preview Modal */}
      {previewTracker && (
        <RecordPreviewModal
          open
          title={previewTracker.tenderId}
          subtitle={`${previewTracker.resolvedDepartment} · ${resolveLocation(previewTracker)}`}
          badge={
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold ${getMafStatusBadgeClass(
                previewTracker.overallStatus,
              )}`}
            >
              {previewTracker.overallStatus}
            </span>
          }
          onClose={() => setPreviewTracker(null)}
        >
          <div className="space-y-5">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-4">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Tender Scope / Work Title
              </p>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mt-1">
                {previewTracker.resolvedTenderTitle}
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
              <PreviewField label="Tender ID" value={previewTracker.tenderId} mono />
              <PreviewField label="Department" value={previewTracker.resolvedDepartment} />
              <PreviewField label="Location" value={resolveLocation(previewTracker)} />
              <PreviewField
                label="Due Date"
                value={formatShortDate(previewTracker.resolvedDueDate || previewTracker.updatedAt)}
                mono
              />
            </div>

            <div className="space-y-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                BOQ &amp; OEM MAF Items ({previewItems.length})
              </p>

              {previewItems.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center rounded-xl border border-slate-200 dark:border-slate-800">
                  No BOQ / OEM items added yet. Click Edit to add OEM MAF items.
                </p>
              ) : (
                <div className="space-y-3">
                  {previewItems.map((item, idx) => {
                    const contact = getMafContactDetails(item);
                    const requestedDate = getMafRequestedDate(item);
                    const isSafeDataUri = isSafeMafDataUrl(item.mafDocumentUrl);
                    const isSafeExternalUrl = isSafeHttpUrl(item.mafDocumentUrl);

                    return (
                      <div
                        key={item.itemId}
                        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 p-4 space-y-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                              Item {idx + 1}: {item.itemName}
                            </p>
                            {item.requiredQuantity && (
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                Qty: {item.requiredQuantity}
                              </p>
                            )}
                          </div>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold shrink-0 ${getMafStatusBadgeClass(
                              item.mafStatus,
                            )}`}
                          >
                            {item.mafStatus}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                          <PreviewField
                            label="OEM / Manufacturer"
                            value={
                              item.companyName
                                ? `${item.oemName || '—'} · ${item.companyName}`
                                : item.oemName || '—'
                            }
                          />
                          <PreviewField
                            label="Concerned Person"
                            value={contact.concernedPersonName || '—'}
                          />
                          <PreviewField
                            label="Contact No."
                            value={contact.contactNo || '—'}
                            mono
                          />
                          <PreviewField
                            label="Mail ID"
                            value={
                              contact.mailId ? (
                                <a
                                  href={`mailto:${contact.mailId}`}
                                  className="text-[#1E3A8A] dark:text-blue-400 hover:underline break-all"
                                >
                                  {contact.mailId}
                                </a>
                              ) : (
                                '—'
                              )
                            }
                          />
                          <PreviewField
                            label="MAF Requested Date"
                            value={formatShortDate(requestedDate)}
                            mono
                          />
                          <PreviewField
                            label="Signed MAF Document"
                            value={
                              item.mafDocumentUrl ? (
                                isSafeDataUri ? (
                                  <a
                                    href={item.mafDocumentUrl}
                                    download={item.mafDocumentName || `${item.oemName}_MAF`}
                                    className="inline-flex items-center gap-1 text-[#1E3A8A] dark:text-blue-400 hover:underline"
                                  >
                                    <FileText className="h-3.5 w-3.5 shrink-0" />
                                    <span className="truncate">
                                      {item.mafDocumentName || 'maf_signed.pdf'}
                                    </span>
                                  </a>
                                ) : isSafeExternalUrl ? (
                                  <a
                                    href={item.mafDocumentUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[#1E3A8A] dark:text-blue-400 hover:underline"
                                  >
                                    <Link2 className="h-3.5 w-3.5 shrink-0" />
                                    <span className="truncate">
                                      {item.mafDocumentName || 'Cloud link'}
                                    </span>
                                    <ExternalLink className="h-3 w-3 shrink-0" />
                                  </a>
                                ) : (
                                  'Invalid link blocked'
                                )
                              ) : (
                                'Not uploaded'
                              )
                            }
                          />
                        </div>

                        {item.remarks && (
                          <PreviewField label="Remarks" value={item.remarks} />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </RecordPreviewModal>
      )}

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        open={Boolean(deleteTarget)}
        title={`Delete MAF Tracker ${deleteTarget?.tenderId ?? ''}`}
        description={`Are you sure you want to delete the MAF tracker and all BOQ/OEM items for "${
          deleteTarget?.tenderId ?? ''
        }"?`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            onDeleteTracker(deleteTarget.id);
          }
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
