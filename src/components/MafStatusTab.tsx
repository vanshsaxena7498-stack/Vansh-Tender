import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import type { MafItemStatus, MafLineItem, MafTrackerRecord, Tender } from '../types/crm';
import { buildCsvContent, downloadTextFile, formatShortDate } from '../utils/formatters';
import {
  computeMafSummaryMetrics,
  getMafContactDetails,
  getMafRequestedDate,
  MAF_STATUS_OPTIONS,
  resolveAndFilterMafTrackers,
  validateMafUploadFile,
} from '../utils/mafCalculations';

interface MafStatusTabProps {
  trackers: MafTrackerRecord[];
  tenders: Tender[];
  onAddTracker: () => void;
  onEditTracker: (tracker: MafTrackerRecord) => void;
  onDeleteTracker: (trackerId: string) => void;
  onOpenNewItemModal: (tracker: MafTrackerRecord) => void;
  onOpenEditItemModal: (tracker: MafTrackerRecord, item: MafLineItem) => void;
  onInlineStatusChange: (
    trackerId: string,
    itemId: string,
    nextStatus: MafItemStatus,
  ) => void;
  onInlineFileUpload: (trackerId: string, itemId: string, file: File) => Promise<void>;
  onDeleteItem: (trackerId: string, itemId: string) => void;
  onValidationError: (msg: string) => void;
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
  onOpenNewItemModal,
  onOpenEditItemModal,
  onInlineStatusChange,
  onInlineFileUpload,
  onDeleteItem,
  onValidationError,
}: MafStatusTabProps) {
  const [tenderQuery, setTenderQuery] = useState('');
  const [itemOrOemQuery, setItemOrOemQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | MafItemStatus>('ALL');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>(() => {
    const first = trackers[0]?.id;
    return first ? { [first]: true } : {};
  });
  const seenTrackerIdsRef = useRef<Set<string>>(new Set(trackers.map((t) => t.id)));
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [confirmDeleteTrackerId, setConfirmDeleteTrackerId] = useState<string | null>(null);
  const [confirmDeleteItemKey, setConfirmDeleteItemKey] = useState<string | null>(null);

  useEffect(() => {
    const newlyAddedIds: string[] = [];
    for (const t of trackers) {
      if (!seenTrackerIdsRef.current.has(t.id)) {
        seenTrackerIdsRef.current.add(t.id);
        newlyAddedIds.push(t.id);
      }
    }
    if (newlyAddedIds.length > 0) {
      setExpandedIds((prev) => {
        const next = { ...prev };
        for (const id of newlyAddedIds) next[id] = true;
        return next;
      });
    }
  }, [trackers]);

  const metrics = useMemo(
    () => computeMafSummaryMetrics(trackers, tenders),
    [trackers, tenders],
  );

  const filteredTrackers = useMemo(
    () =>
      resolveAndFilterMafTrackers(trackers, tenders, {
        tenderQuery,
        itemOrOemQuery,
        statusFilter,
      }),
    [trackers, tenders, tenderQuery, itemOrOemQuery, statusFilter],
  );

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleRowFileSelect = async (
    trackerId: string,
    itemId: string,
    e: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const err = validateMafUploadFile(file);
    if (err) {
      onValidationError(err);
      return;
    }

    const key = `${trackerId}:${itemId}`;
    setUploadingKey(key);
    try {
      await onInlineFileUpload(trackerId, itemId, file);
    } finally {
      setUploadingKey(null);
    }
  };

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
      `MAF_Tracker_${new Date().toISOString().slice(0, 10)}.csv`,
      buildCsvContent(headers, rows),
      'text/csv;charset=utf-8;',
    );
  };

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

      {/* Main Master-Detail Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {/* Header + Filter Controls */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 space-y-4">
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

        {/* Master-Detail Nested Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/40 text-[11px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">
                <th className="py-3 px-3.5 whitespace-nowrap">
                  Tender ID{' '}
                  <span className="normal-case font-normal text-slate-400">
                    (Daily Tender)
                  </span>
                </th>
                <th className="py-3 px-3.5">Tender Title &amp; Dept</th>
                <th className="py-3 px-3.5 whitespace-nowrap">Due Date</th>
                <th className="py-3 px-3.5 whitespace-nowrap">Overall MAF Status</th>
                <th className="py-3 px-3.5 text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {filteredTrackers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 px-4 text-center text-slate-500 dark:text-slate-400">
                    No MAF tracker records match the current filters. Click{' '}
                    <span className="font-semibold text-[#1E3A8A] dark:text-blue-400">
                      + Add MAF Status
                    </span>{' '}
                    to link OEM authorizations to a tender.
                  </td>
                </tr>
              ) : (
                filteredTrackers.map((tracker) => {
                  const isExpanded = Boolean(expandedIds[tracker.id]);
                  const visibleItems = itemOrOemQuery.trim()
                    ? tracker.matchedItems
                    : tracker.itemsMAF;

                  return (
                    <Fragment key={tracker.id}>
                      {/* Parent Row */}
                      <tr
                        onClick={() => toggleExpand(tracker.id)}
                        className={`cursor-pointer transition-colors ${
                          isExpanded
                            ? 'bg-blue-50/70 dark:bg-blue-950/30'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <td className="py-3.5 px-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              aria-label={
                                isExpanded
                                  ? `Collapse ${tracker.tenderId}`
                                  : `Expand ${tracker.tenderId}`
                              }
                              aria-expanded={isExpanded}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpand(tracker.id);
                              }}
                              className="p-0.5 rounded text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" aria-hidden="true" />
                              ) : (
                                <ChevronRight className="h-4 w-4" aria-hidden="true" />
                              )}
                            </button>
                            <span className="font-mono-num font-semibold text-slate-900 dark:text-white">
                              {tracker.tenderId}
                            </span>
                            <span className="font-mono-num text-[11px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                              {tracker.itemsMAF.length}{' '}
                              {tracker.itemsMAF.length === 1 ? 'item' : 'items'}
                            </span>
                          </div>
                        </td>

                        <td className="py-3.5 px-3.5 max-w-[260px] xl:max-w-[320px]">
                          <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                            {tracker.resolvedTenderTitle}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {tracker.resolvedDepartment}
                          </p>
                        </td>

                        <td className="py-3.5 px-3.5 whitespace-nowrap font-mono-num text-slate-700 dark:text-slate-300">
                          {formatShortDate(tracker.resolvedDueDate)}
                        </td>

                        <td className="py-3.5 px-3.5 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-md border text-[11px] font-semibold ${getMafStatusBadgeClass(
                              tracker.overallStatus,
                            )}`}
                          >
                            {tracker.overallStatus}
                          </span>
                        </td>

                        <td
                          className="py-3.5 px-3.5 whitespace-nowrap text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setExpandedIds((prev) => ({ ...prev, [tracker.id]: true }));
                                onOpenNewItemModal(tracker);
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-[11px] font-medium text-slate-800 dark:text-slate-200"
                            >
                              <Plus className="h-3 w-3" aria-hidden="true" />
                              <span>New Item</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => onEditTracker(tracker)}
                              aria-label={`Edit MAF tracker ${tracker.tenderId}`}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-200"
                            >
                              <Pencil className="h-3 w-3" aria-hidden="true" />
                              <span>Edit</span>
                            </button>

                            {confirmDeleteTrackerId === tracker.id ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    onDeleteTracker(tracker.id);
                                    setConfirmDeleteTrackerId(null);
                                  }}
                                  className="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-[11px] font-medium"
                                >
                                  Delete
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteTrackerId(null)}
                                  className="px-1.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-[11px]"
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteTrackerId(tracker.id)}
                                aria-label={`Delete MAF tracker ${tracker.tenderId}`}
                                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-red-600 hover:border-red-200 dark:hover:text-red-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Child Inner Table */}
                      {isExpanded && (
                        <tr className="bg-slate-50/80 dark:bg-slate-950/60">
                          <td colSpan={5} className="p-3 sm:px-4 sm:py-3.5">
                            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto shadow-sm">
                              {visibleItems.length === 0 ? (
                                <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                                  No BOQ / OEM items added yet. Click{' '}
                                  <button
                                    type="button"
                                    onClick={() => onOpenNewItemModal(tracker)}
                                    className="font-semibold text-[#1E3A8A] dark:text-blue-400 hover:underline"
                                  >
                                    + New Item
                                  </button>{' '}
                                  to add the first OEM MAF item.
                                </div>
                              ) : (
                                <table className="w-full text-left border-collapse">
                                  <thead>
                                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                                      <th className="py-2.5 px-3">Item Name</th>
                                      <th className="py-2.5 px-3">OEM Name</th>
                                      <th className="py-2.5 px-3">OEM Contact Details</th>
                                      <th className="py-2.5 px-3">MAF Status</th>
                                      <th className="py-2.5 px-3 whitespace-nowrap">
                                        MAF Requested Date
                                      </th>
                                      <th className="py-2.5 px-3">Attachment</th>
                                      <th className="py-2.5 px-3 text-right">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                    {visibleItems.map((item, idx) => {
                                      const itemKey = `${tracker.id}:${item.itemId}`;
                                      const isUploading = uploadingKey === itemKey;
                                      const isDataUri = item.mafDocumentUrl.startsWith('data:');
                                      const contact = getMafContactDetails(item);
                                      const requestedDate = getMafRequestedDate(item);

                                      return (
                                        <tr
                                          key={item.itemId}
                                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30"
                                        >
                                          <td className="py-2.5 px-3 max-w-[210px]">
                                            <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                                              <span className="text-slate-500 dark:text-slate-400 mr-1">
                                                Item {idx + 1}:
                                              </span>
                                              {item.itemName}
                                            </p>
                                            {(item.requiredQuantity || item.remarks) && (
                                              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                                {item.requiredQuantity
                                                  ? `Qty: ${item.requiredQuantity}`
                                                  : ''}
                                                {item.requiredQuantity && item.remarks ? ' · ' : ''}
                                                {item.remarks}
                                              </p>
                                            )}
                                          </td>

                                          <td className="py-2.5 px-3 max-w-[160px]">
                                            {item.oemName || item.companyName ? (
                                              <div className="space-y-0.5">
                                                <p className="font-medium text-slate-800 dark:text-slate-200 truncate">
                                                  {item.oemName || '—'}
                                                </p>
                                                {item.companyName && (
                                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                                    {item.companyName}
                                                  </p>
                                                )}
                                              </div>
                                            ) : (
                                              <span className="text-slate-400 dark:text-slate-500">
                                                —
                                              </span>
                                            )}
                                          </td>

                                          <td className="py-2.5 px-3 max-w-[210px]">
                                            {contact.concernedPersonName ||
                                            contact.contactNo ||
                                            contact.mailId ? (
                                              <div className="space-y-0.5">
                                                {contact.concernedPersonName && (
                                                  <p className="font-medium text-slate-800 dark:text-slate-200 truncate">
                                                    {contact.concernedPersonName}
                                                  </p>
                                                )}
                                                {contact.contactNo && (
                                                  <p className="font-mono-num text-[11px] text-slate-600 dark:text-slate-400 truncate">
                                                    {contact.contactNo}
                                                  </p>
                                                )}
                                                {contact.mailId && (
                                                  <a
                                                    href={`mailto:${contact.mailId}`}
                                                    className="block text-[11px] text-blue-700 dark:text-blue-400 hover:underline truncate"
                                                  >
                                                    {contact.mailId}
                                                  </a>
                                                )}
                                              </div>
                                            ) : (
                                              <span className="text-slate-400 dark:text-slate-500">
                                                —
                                              </span>
                                            )}
                                          </td>

                                          <td className="py-2.5 px-3 whitespace-nowrap">
                                            <select
                                              aria-label={`MAF status for ${item.itemName}`}
                                              value={item.mafStatus}
                                              onChange={(e) =>
                                                onInlineStatusChange(
                                                  tracker.id,
                                                  item.itemId,
                                                  e.target.value as MafItemStatus,
                                                )
                                              }
                                              className={`rounded-md border px-2 py-1 text-[11px] font-semibold focus:outline-none focus:ring-2 focus:ring-blue-600 cursor-pointer ${getMafStatusBadgeClass(
                                                item.mafStatus,
                                              )}`}
                                            >
                                              {MAF_STATUS_OPTIONS.map((st) => (
                                                <option
                                                  key={st}
                                                  value={st}
                                                  className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100"
                                                >
                                                  {st}
                                                </option>
                                              ))}
                                            </select>
                                          </td>

                                          <td className="py-2.5 px-3 whitespace-nowrap font-mono-num text-slate-700 dark:text-slate-300">
                                            {formatShortDate(requestedDate)}
                                          </td>

                                          <td className="py-2.5 px-3 whitespace-nowrap">
                                            <div className="flex items-center gap-1.5">
                                              {item.mafDocumentUrl ? (
                                                isDataUri ? (
                                                  <a
                                                    href={item.mafDocumentUrl}
                                                    download={
                                                      item.mafDocumentName || `${item.oemName}_MAF`
                                                    }
                                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-[11px] font-medium text-blue-700 dark:text-blue-400 max-w-[140px]"
                                                  >
                                                    <FileText
                                                      className="h-3.5 w-3.5 text-red-500 shrink-0"
                                                      aria-hidden="true"
                                                    />
                                                    <span className="truncate">
                                                      {item.mafDocumentName || 'maf_signed.pdf'}
                                                    </span>
                                                  </a>
                                                ) : (
                                                  <a
                                                    href={item.mafDocumentUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-200 max-w-[140px]"
                                                  >
                                                    <Link2
                                                      className="h-3.5 w-3.5 text-slate-500 shrink-0"
                                                      aria-hidden="true"
                                                    />
                                                    <span className="truncate">
                                                      {item.mafDocumentName || 'Cloud link'}
                                                    </span>
                                                    <ExternalLink
                                                      className="h-3 w-3 text-slate-400 shrink-0"
                                                      aria-hidden="true"
                                                    />
                                                  </a>
                                                )
                                              ) : (
                                                <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
                                                  {isUploading ? (
                                                    <Loader2
                                                      className="h-3.5 w-3.5 animate-spin"
                                                      aria-hidden="true"
                                                    />
                                                  ) : (
                                                    <Upload
                                                      className="h-3.5 w-3.5"
                                                      aria-hidden="true"
                                                    />
                                                  )}
                                                  <span>
                                                    {isUploading ? 'Uploading...' : 'Upload file'}
                                                  </span>
                                                  <input
                                                    type="file"
                                                    accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
                                                    onChange={(e) =>
                                                      handleRowFileSelect(
                                                        tracker.id,
                                                        item.itemId,
                                                        e,
                                                      )
                                                    }
                                                    className="sr-only"
                                                  />
                                                </label>
                                              )}
                                            </div>
                                          </td>

                                          <td className="py-2.5 px-3 whitespace-nowrap text-right">
                                            <div className="inline-flex items-center gap-0.5">
                                              <button
                                                type="button"
                                                onClick={() => onOpenEditItemModal(tracker, item)}
                                                aria-label={`Edit ${item.itemName}`}
                                                className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800"
                                              >
                                                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                              </button>

                                              {confirmDeleteItemKey === itemKey ? (
                                                <div className="inline-flex items-center gap-1">
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      onDeleteItem(tracker.id, item.itemId);
                                                      setConfirmDeleteItemKey(null);
                                                    }}
                                                    className="px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-medium"
                                                  >
                                                    Remove
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => setConfirmDeleteItemKey(null)}
                                                    className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 text-[10px]"
                                                  >
                                                    No
                                                  </button>
                                                </div>
                                              ) : (
                                                <button
                                                  type="button"
                                                  onClick={() => setConfirmDeleteItemKey(itemKey)}
                                                  aria-label={`Remove ${item.itemName}`}
                                                  className="p-1.5 rounded-md text-slate-500 hover:text-red-600 hover:bg-red-50 dark:text-slate-400 dark:hover:text-red-400 dark:hover:bg-red-950/40"
                                                >
                                                  <Trash2
                                                    className="h-3.5 w-3.5"
                                                    aria-hidden="true"
                                                  />
                                                </button>
                                              )}
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
