import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { COMMON_OEM_NAMES } from '../data/seedData';
import type { MafItemStatus, MafLineItem, MafTrackerRecord, Tender } from '../types/crm';
import {
  createMafItemId,
  findDailyTenderByCode,
  findMatchingDailyTender,
  MAF_STATUS_OPTIONS,
  validateMafItemDraft,
  validateMafUploadFile,
} from '../utils/mafCalculations';

interface MafTrackerFormModalProps {
  initialTracker?: MafTrackerRecord | null;
  tenders: Tender[];
  existingTrackers: MafTrackerRecord[];
  onClose: () => void;
  onSave: (tracker: MafTrackerRecord) => void;
  onUploadFile: (
    trackerId: string,
    itemId: string,
    file: File,
  ) => Promise<{
    mafDocumentUrl: string;
    mafDocumentName: string;
    mafAttachmentId?: string;
  }>;
}

function makeEmptyItem(index: number): MafLineItem {
  return {
    itemId: createMafItemId(index),
    itemName: '',
    requiredQuantity: '',
    oemName: '',
    oemContact: '',
    mafStatus: 'Not Requested',
    validityDate: '',
    mafDocumentUrl: '',
    mafDocumentName: '',
    remarks: '',
    updatedAt: new Date().toISOString(),
  };
}

export function MafTrackerFormModal({
  initialTracker,
  tenders,
  existingTrackers,
  onClose,
  onSave,
  onUploadFile,
}: MafTrackerFormModalProps) {
  const isEdit = Boolean(initialTracker);
  const [trackerId] = useState(() => initialTracker?.id ?? `maf-${Date.now()}`);

  const initialMatched = initialTracker
    ? findMatchingDailyTender(tenders, initialTracker.tenderId, initialTracker.tenderRefId)
    : undefined;

  const [tenderRefId, setTenderRefId] = useState(
    initialMatched?.id ?? initialTracker?.tenderRefId ?? '',
  );
  const [tenderId, setTenderId] = useState(
    initialMatched?.tenderId ?? initialTracker?.tenderId ?? '',
  );
  const [tenderTitle, setTenderTitle] = useState(
    initialMatched?.title ?? initialTracker?.tenderTitle ?? '',
  );
  const [department, setDepartment] = useState(
    initialMatched?.department ?? initialTracker?.department ?? '',
  );
  const [tenderDueDate, setTenderDueDate] = useState(
    initialMatched?.submissionDueDate ?? initialTracker?.tenderDueDate ?? '',
  );
  const [itemsMAF, setItemsMAF] = useState<MafLineItem[]>(() =>
    initialTracker?.itemsMAF && initialTracker.itemsMAF.length > 0
      ? initialTracker.itemsMAF
      : [makeEmptyItem(0)],
  );
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const matchedTender = findDailyTenderByCode(tenders, tenderId);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleSelectLinkedTender = (selectedRefId: string) => {
    if (!selectedRefId) {
      setTenderRefId('');
      setTenderId('');
      setTenderTitle('');
      setDepartment('');
      setTenderDueDate('');
      setErrorMsg('');
      return;
    }
    const found = tenders.find((t) => t.id === selectedRefId);
    if (found) {
      setTenderRefId(found.id);
      setTenderId(found.tenderId);
      setTenderTitle(found.title);
      setDepartment(found.department);
      setTenderDueDate(found.submissionDueDate);
      setErrorMsg('');
    }
  };

  const handleTenderIdChange = (rawValue: string) => {
    setTenderId(rawValue);
    const found = findDailyTenderByCode(tenders, rawValue);
    if (found) {
      setTenderRefId(found.id);
      setTenderTitle(found.title);
      setDepartment(found.department);
      setTenderDueDate(found.submissionDueDate);
      setErrorMsg('');
    } else {
      setTenderRefId('');
      setTenderTitle('');
      setDepartment('');
      setTenderDueDate('');
    }
  };

  const handleUpdateRow = (index: number, patch: Partial<MafLineItem>) => {
    setItemsMAF((prev) =>
      prev.map((row, idx) =>
        idx === index ? { ...row, ...patch, updatedAt: new Date().toISOString() } : row,
      ),
    );
  };

  const handleRowFileUpload = async (
    index: number,
    itemId: string,
    e: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const validationError = validateMafUploadFile(file);
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }
    setErrorMsg('');
    setUploadingItemId(itemId);
    try {
      const uploaded = await onUploadFile(trackerId, itemId, file);
      handleUpdateRow(index, {
        mafDocumentUrl: uploaded.mafDocumentUrl,
        mafDocumentName: uploaded.mafDocumentName,
        mafAttachmentId: uploaded.mafAttachmentId,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to upload MAF file.');
    } finally {
      setUploadingItemId(null);
    }
  };

  const handleAddRow = () => {
    if (itemsMAF.length >= 50) {
      setErrorMsg('Maximum 50 line items are supported per tender MAF tracker.');
      return;
    }
    setItemsMAF((prev) => [...prev, makeEmptyItem(prev.length)]);
  };

  const handleRemoveRow = (index: number) => {
    if (itemsMAF.length <= 1) return;
    setItemsMAF((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!tenderId.trim()) {
      setErrorMsg('Please select or enter a Tender ID from Daily Tender Data.');
      return;
    }

    const verifiedTender = findDailyTenderByCode(tenders, tenderId);
    if (!verifiedTender) {
      setErrorMsg(
        `Tender "${tenderId.trim()}" does not exist in Daily Tender Data. Please add it in Daily Tender Data first before creating a MAF Status entry.`,
      );
      return;
    }

    if (itemsMAF.length === 0) {
      setErrorMsg('Please add at least one BOQ / OEM item.');
      return;
    }

    for (let i = 0; i < itemsMAF.length; i++) {
      const rowErr = validateMafItemDraft(itemsMAF[i]);
      if (rowErr) {
        setErrorMsg(`Item #${i + 1}: ${rowErr}`);
        return;
      }
    }

    if (uploadingItemId) {
      setErrorMsg('Please wait for the file upload to finish before saving.');
      return;
    }

    // If creating a new entry for a tender that already has a tracker, merge items under the existing doc ID
    const existingForTender = !isEdit
      ? existingTrackers.find(
          (t) =>
            t.tenderRefId === verifiedTender.id ||
            t.tenderId.toLowerCase() === verifiedTender.tenderId.toLowerCase(),
        )
      : undefined;

    const nowIso = new Date().toISOString();
    const cleanedItems: MafLineItem[] = itemsMAF.map((item) => ({
      ...item,
      itemName: item.itemName.trim(),
      requiredQuantity: item.requiredQuantity.trim(),
      oemName: item.oemName.trim(),
      oemContact: (item.oemContact ?? '').trim(),
      mafDocumentUrl: item.mafDocumentUrl.trim(),
      mafDocumentName: (item.mafDocumentName ?? '').trim(),
      remarks: item.remarks.trim(),
      updatedAt: item.updatedAt || nowIso,
    }));

    const finalTracker: MafTrackerRecord = existingForTender
      ? {
          ...existingForTender,
          tenderRefId: verifiedTender.id,
          tenderId: verifiedTender.tenderId,
          tenderTitle: verifiedTender.title,
          department: verifiedTender.department,
          tenderDueDate: verifiedTender.submissionDueDate,
          itemsMAF: [...existingForTender.itemsMAF, ...cleanedItems].slice(0, 50),
          updatedAt: nowIso,
        }
      : {
          id: trackerId,
          tenderRefId: verifiedTender.id,
          tenderId: verifiedTender.tenderId,
          tenderTitle: verifiedTender.title,
          department: verifiedTender.department,
          tenderDueDate: verifiedTender.submissionDueDate,
          itemsMAF: cleanedItems,
          createdAt: initialTracker?.createdAt ?? nowIso,
          updatedAt: nowIso,
        };

    onSave(finalTracker);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? 'Edit Tender MAF Tracker' : 'Add MAF Status Tracker'}
      data-fullscreen-form="maf"
      className="fixed inset-0 z-50 flex flex-col bg-[#F8FAFC] dark:bg-[#0B1120] text-slate-900 dark:text-slate-100 overflow-hidden"
    >
      <form onSubmit={handleSubmit} className="flex flex-col h-full w-full">
        {/* Top Action Header */}
        <header className="shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-8 py-3.5">
          <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 shrink-0"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                <span>Back</span>
              </button>
              <div className="h-5 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block" />
              <div className="min-w-0">
                <h2 className="font-display text-base sm:text-lg font-semibold text-slate-900 dark:text-white truncate">
                  {isEdit ? `Edit MAF Tracker · ${initialTracker?.tenderId}` : 'Add Tender MAF Status'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  Link BOQ line items to OEM Authorizations & upload signed MAF documents
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={Boolean(uploadingItemId)}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-medium"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{isEdit ? 'Save MAF Tracker' : 'Create MAF Tracker'}</span>
              </button>
            </div>
          </div>
        </header>

        {/* Form Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
          <div className="max-w-6xl mx-auto space-y-6">
            {errorMsg && (
              <div
                role="alert"
                className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-xs font-medium text-red-700 dark:text-red-300"
              >
                {errorMsg}
              </div>
            )}

            {/* Section 1: Link to Tender */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                  1. Linked Tender Reference (Daily Tender Data)
                </h3>
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Only tenders entered in Daily Tender Data are allowed
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label
                    htmlFor="maf-link-tender"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Select Registered Tender *
                  </label>
                  <select
                    id="maf-link-tender"
                    value={tenderRefId}
                    onChange={(e) => handleSelectLinkedTender(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="">— Select Tender from Daily Tender Data —</option>
                    {tenders.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.tenderId} · {t.department.slice(0, 32)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="maf-tender-id"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Or Type Tender ID / Bid No. *
                  </label>
                  <input
                    id="maf-tender-id"
                    type="text"
                    required
                    list="maf-daily-tenders-datalist"
                    value={tenderId}
                    onChange={(e) => handleTenderIdChange(e.target.value)}
                    placeholder="Type Tender ID from Daily Tender Data..."
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <datalist id="maf-daily-tenders-datalist">
                    {tenders.map((t) => (
                      <option key={t.id} value={t.tenderId}>
                        {t.department} — {t.title}
                      </option>
                    ))}
                  </datalist>
                </div>

                <div>
                  <label
                    htmlFor="maf-due-date"
                    className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    <span>Tender Due Date</span>
                    <span className="text-[10px] font-normal text-blue-700 dark:text-blue-400">
                      Auto-fetched
                    </span>
                  </label>
                  <input
                    id="maf-due-date"
                    type="datetime-local"
                    readOnly
                    value={tenderDueDate.slice(0, 16)}
                    className="font-mono-num w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/70 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 cursor-not-allowed focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="maf-department"
                    className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    <span>Department / Organization</span>
                    <span className="text-[10px] font-normal text-blue-700 dark:text-blue-400">
                      Auto-fetched
                    </span>
                  </label>
                  <input
                    id="maf-department"
                    type="text"
                    readOnly
                    value={department}
                    placeholder="Auto-fetched from Daily Tender Data"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/70 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 cursor-not-allowed focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label
                    htmlFor="maf-tender-title"
                    className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    <span>Tender Work / Supply Title</span>
                    <span className="text-[10px] font-normal text-blue-700 dark:text-blue-400">
                      Auto-fetched
                    </span>
                  </label>
                  <input
                    id="maf-tender-title"
                    type="text"
                    readOnly
                    value={tenderTitle}
                    placeholder="Auto-fetched from Daily Tender Data"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/70 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 cursor-not-allowed focus:outline-none"
                  />
                </div>
              </div>

              {tenders.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/30 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    No tenders are available in Daily Tender Data yet. Add a tender in Daily Tender
                    Data first before creating a MAF Status entry.
                  </span>
                </div>
              ) : matchedTender ? (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/30 px-3.5 py-2 text-xs text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    Matched with Daily Tender Data ({matchedTender.tenderId}) — Due Date,
                    Department &amp; Work Title synced automatically.
                  </span>
                </div>
              ) : tenderId.trim().length > 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800/70 bg-red-50 dark:bg-red-950/30 px-3.5 py-2 text-xs text-red-700 dark:text-red-300">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    &ldquo;{tenderId.trim()}&rdquo; was not found in Daily Tender Data. Please
                    enter a Tender ID that exists in Daily Tender Data.
                  </span>
                </div>
              ) : null}
            </section>

            {/* Section 2: BOQ Line Items & OEM MAFs */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
                <div>
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                    2. BOQ Line Items & OEM Authorizations ({itemsMAF.length})
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Track each item category requiring a separate Manufacturer Authorization Form
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddRow}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add BOQ Item</span>
                </button>
              </div>

              <datalist id="maf-form-oem-list">
                {COMMON_OEM_NAMES.map((oem) => (
                  <option key={oem} value={oem} />
                ))}
              </datalist>

              <div className="space-y-4">
                {itemsMAF.map((item, idx) => {
                  const isUploading = uploadingItemId === item.itemId;
                  return (
                    <div
                      key={item.itemId}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#1E3A8A] dark:text-blue-400">
                          Item #{idx + 1}
                        </span>
                        {itemsMAF.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveRow(idx)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Remove</span>
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="lg:col-span-2">
                          <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                            Item Name *
                          </label>
                          <input
                            type="text"
                            required
                            value={item.itemName}
                            onChange={(e) => handleUpdateRow(idx, { itemName: e.target.value })}
                            placeholder="e.g. Dome Cameras"
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                            Required Qty
                          </label>
                          <input
                            type="text"
                            value={item.requiredQuantity}
                            onChange={(e) =>
                              handleUpdateRow(idx, { requiredQuantity: e.target.value })
                            }
                            placeholder="e.g. 50 Nos"
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                            OEM Name *
                          </label>
                          <input
                            type="text"
                            required
                            list="maf-form-oem-list"
                            value={item.oemName}
                            onChange={(e) => handleUpdateRow(idx, { oemName: e.target.value })}
                            placeholder="e.g. CP Plus"
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                            OEM Contact
                          </label>
                          <input
                            type="text"
                            value={item.oemContact ?? ''}
                            onChange={(e) => handleUpdateRow(idx, { oemContact: e.target.value })}
                            placeholder="Name / Phone"
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                            MAF Status
                          </label>
                          <select
                            value={item.mafStatus}
                            onChange={(e) =>
                              handleUpdateRow(idx, {
                                mafStatus: e.target.value as MafItemStatus,
                              })
                            }
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          >
                            {MAF_STATUS_OPTIONS.map((st) => (
                              <option key={st} value={st}>
                                {st}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                            Validity Date
                          </label>
                          <input
                            type="date"
                            value={item.validityDate}
                            onChange={(e) => handleUpdateRow(idx, { validityDate: e.target.value })}
                            className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                            Signed MAF PDF / Cloud Link
                          </label>
                          <div className="flex items-center gap-1.5">
                            <label className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium cursor-pointer shrink-0">
                              {isUploading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                              ) : (
                                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                              <span>{isUploading ? 'Wait...' : 'Upload'}</span>
                              <input
                                type="file"
                                accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
                                onChange={(e) => handleRowFileUpload(idx, item.itemId, e)}
                                className="sr-only"
                              />
                            </label>
                            {item.mafDocumentUrl.startsWith('data:') ? (
                              <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 truncate">
                                <FileText className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{item.mafDocumentName || 'Uploaded'}</span>
                              </span>
                            ) : (
                              <input
                                type="url"
                                value={item.mafDocumentUrl}
                                onChange={(e) =>
                                  handleUpdateRow(idx, {
                                    mafDocumentUrl: e.target.value,
                                    mafDocumentName: e.target.value ? 'Cloud link' : '',
                                    mafAttachmentId: undefined,
                                  })
                                }
                                placeholder="or https://..."
                                className="flex-1 min-w-0 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                              />
                            )}
                          </div>
                        </div>

                        <div className="sm:col-span-2 lg:col-span-4">
                          <input
                            type="text"
                            value={item.remarks}
                            onChange={(e) => handleUpdateRow(idx, { remarks: e.target.value })}
                            placeholder="Remarks / follow-up history..."
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      </form>
    </div>
  );
}
