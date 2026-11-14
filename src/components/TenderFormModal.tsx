import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import type {
  EmdSecurityType,
  MafItemStatus,
  MafLineItem,
  PortalType,
  Tender,
  TenderStage,
} from '../types/crm';
import { COMMON_OEM_NAMES, createDefaultChecklist } from '../data/seedData';
import {
  buildInitialAttachmentSlots,
  extractSavedAttachments,
  TENDER_DEFAULT_SLOT_LABELS,
  type AttachmentSlotState,
} from '../utils/attachments';
import { createMafItemId, MAF_STATUS_OPTIONS } from '../utils/mafCalculations';
import { AttachmentSlots } from './AttachmentSlots';

interface TenderFormModalProps {
  initialTender?: Tender | null;
  onClose: () => void;
  onSave: (tender: Tender, syncToEmd: boolean, initialMafItems?: MafLineItem[]) => void;
}

const PORTAL_OPTIONS: PortalType[] = [
  'GeM',
  'CPPP / eProcure',
  'State Portal',
  'PSU / Direct',
  'Private',
];

const EMD_OPTIONS: EmdSecurityType[] = [
  'Exempted - MSME/Startup',
  'EMD Paid',
  'BG Submitted',
  'No EMD',
];

const STAGE_OPTIONS: TenderStage[] = [
  'Identified / Reviewing',
  'Doc Preparation',
  'Submitted',
  'Technical Eval',
  'Financial / BOQ Eval',
  'L1 / Won',
  'Lost (L2/L3)',
  'Cancelled / Retendered',
  'Tender Not Filled',
];

export function TenderFormModal({ initialTender, onClose, onSave }: TenderFormModalProps) {
  const isEdit = Boolean(initialTender);

  const [tenderId, setTenderId] = useState(initialTender?.tenderId ?? '');
  const [portal, setPortal] = useState<PortalType>(initialTender?.portal ?? 'GeM');
  const [department, setDepartment] = useState(initialTender?.department ?? '');
  const [location, setLocation] = useState(initialTender?.location ?? '');
  const [category, setCategory] = useState(initialTender?.category ?? '');
  const [title, setTitle] = useState(initialTender?.title ?? '');
  const [publishDate, setPublishDate] = useState(
    initialTender?.publishDate ?? new Date().toISOString().slice(0, 10),
  );
  const [submissionDueDate, setSubmissionDueDate] = useState(
    initialTender?.submissionDueDate ?? `${new Date().toISOString().slice(0, 10)}T17:00`,
  );
  const [preBidDate, setPreBidDate] = useState(initialTender?.preBidDate ?? '');
  const [estimatedValue, setEstimatedValue] = useState(
    initialTender ? String(initialTender.estimatedValue) : '',
  );
  const [quotedValue, setQuotedValue] = useState(
    initialTender ? String(initialTender.quotedValue) : '',
  );
  const [emdStatus, setEmdStatus] = useState<EmdSecurityType>(
    initialTender?.emdStatus ?? 'Exempted - MSME/Startup',
  );
  const [emdAmount, setEmdAmount] = useState(
    initialTender ? String(initialTender.emdAmount) : '0',
  );
  const [stage, setStage] = useState<TenderStage>(
    initialTender?.stage ?? 'Identified / Reviewing',
  );
  const [resultInfo, setResultInfo] = useState(initialTender?.resultInfo ?? '');
  const [completionDate, setCompletionDate] = useState(initialTender?.completionDate ?? '');
  const [syncToEmd, setSyncToEmd] = useState(!isEdit);
  const [attachmentSlots, setAttachmentSlots] = useState<AttachmentSlotState[]>(() =>
    buildInitialAttachmentSlots(initialTender?.attachments, TENDER_DEFAULT_SLOT_LABELS),
  );
  const [initMafEnabled, setInitMafEnabled] = useState(false);
  const [draftMafItems, setDraftMafItems] = useState<
    { itemId: string; itemName: string; requiredQuantity: string; oemName: string; mafStatus: MafItemStatus }[]
  >(() => [
    {
      itemId: createMafItemId(0),
      itemName: '',
      requiredQuantity: '',
      oemName: '',
      mafStatus: 'Not Requested',
    },
  ]);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const supportsEmdSync = emdStatus === 'EMD Paid' || emdStatus === 'BG Submitted';

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!tenderId.trim() || !department.trim() || !title.trim() || !submissionDueDate) {
      setErrorMsg('Please fill Tender ID, Department, Work Title, and Submission Due Date.');
      return;
    }

    const parsedEst = Math.max(0, Number(estimatedValue) || 0);
    const parsedQuoted = Math.max(0, Number(quotedValue) || 0);
    const parsedEmd = supportsEmdSync ? Math.max(0, Number(emdAmount) || 0) : 0;

    if (supportsEmdSync && parsedEmd <= 0) {
      setErrorMsg('Please enter a valid EMD / BG Amount greater than ₹ 0.');
      return;
    }

    const nowIso = new Date().toISOString();
    const savedTender: Tender = {
      id: initialTender?.id ?? `tnd-${Date.now()}`,
      tenderId: tenderId.trim(),
      portal,
      department: department.trim(),
      location: location.trim() || 'India',
      category: category.trim() || 'General Supply & Services',
      title: title.trim(),
      publishDate,
      submissionDueDate,
      preBidDate: preBidDate || undefined,
      estimatedValue: parsedEst,
      quotedValue: parsedQuoted,
      emdStatus,
      emdAmount: parsedEmd,
      stage,
      resultInfo: resultInfo.trim(),
      completionDate: completionDate || undefined,
      checklist: initialTender?.checklist ?? createDefaultChecklist(false),
      remarks: initialTender?.remarks ?? [],
      attachments: extractSavedAttachments(attachmentSlots),
      createdAt: initialTender?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };

    const initialMafItems: MafLineItem[] | undefined =
      !isEdit && initMafEnabled
        ? draftMafItems
            .filter((row) => row.itemName.trim() && row.oemName.trim())
            .map((row) => ({
              itemId: row.itemId,
              itemName: row.itemName.trim(),
              requiredQuantity: row.requiredQuantity.trim(),
              oemName: row.oemName.trim(),
              oemContact: '',
              mafStatus: row.mafStatus,
              validityDate: '',
              mafDocumentUrl: '',
              mafDocumentName: '',
              remarks: '',
              updatedAt: nowIso,
            }))
        : undefined;

    if (!isEdit && initMafEnabled && (!initialMafItems || initialMafItems.length === 0)) {
      setErrorMsg('Please enter at least one Item Name and OEM Name for MAF initialization, or uncheck MAF initialization.');
      return;
    }

    onSave(savedTender, supportsEmdSync && syncToEmd, initialMafItems);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? 'Edit Tender Record' : 'Add New Tender'}
      data-fullscreen-form="tender"
      className="fixed inset-0 z-50 flex flex-col bg-[#F8FAFC] dark:bg-[#0B1120] text-slate-900 dark:text-slate-100 overflow-hidden"
    >
      <form onSubmit={handleSubmit} className="flex flex-col h-full w-full">
        {/* Full-Screen Top Action Header */}
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
                  {isEdit ? `Edit Tender · ${initialTender?.tenderId}` : 'Add New Tender'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  Daily Tender Data · Full-Screen Entry
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
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{isEdit ? 'Save Changes' : 'Create Tender'}</span>
              </button>
            </div>
          </div>
        </header>

        {/* Scrollable Full-Screen Form Canvas */}
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

            {/* Section 1: Tender Identification & Department */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-2.5">
                1. Tender Identification & Department
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label
                    htmlFor="t-tender-id"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Tender ID / Bid No. *
                  </label>
                  <input
                    id="t-tender-id"
                    type="text"
                    required
                    value={tenderId}
                    onChange={(e) => setTenderId(e.target.value)}
                    placeholder="e.g. GEM/2026/B/5489210"
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="t-portal"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Portal / Source *
                  </label>
                  <select
                    id="t-portal"
                    value={portal}
                    onChange={(e) => setPortal(e.target.value as PortalType)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {PORTAL_OPTIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="t-stage"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Current Stage / Status
                  </label>
                  <select
                    id="t-stage"
                    value={stage}
                    onChange={(e) => setStage(e.target.value as TenderStage)}
                    className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                      stage === 'Tender Not Filled'
                        ? 'border-red-400 dark:border-red-700 bg-red-50/70 dark:bg-red-950/30 text-red-800 dark:text-red-200 font-medium focus:ring-red-500'
                        : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:ring-blue-600'
                    }`}
                  >
                    {STAGE_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="lg:col-span-2">
                  <label
                    htmlFor="t-department"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Department / Organization Name *
                  </label>
                  <input
                    id="t-department"
                    type="text"
                    required
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    placeholder="e.g. Ministry of Defence (MES)"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="t-location"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    City / State
                  </label>
                  <input
                    id="t-location"
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g. Pune, Maharashtra"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label
                    htmlFor="t-title"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Work / Supply Brief Title *
                  </label>
                  <input
                    id="t-title"
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Supply & Installation of Managed Network Switches & Firewall"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="t-category"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Work / Item Category
                  </label>
                  <input
                    id="t-category"
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="e.g. IT Hardware & Networking"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>
            </section>

            {/* Section 2: Schedule, Valuation & Bid Security */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-2.5">
                2. Schedule, Financials & Bid Security (EMD / BG)
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label
                    htmlFor="t-pub-date"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Publish Date
                  </label>
                  <input
                    id="t-pub-date"
                    type="date"
                    value={publishDate}
                    onChange={(e) => setPublishDate(e.target.value)}
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="t-due-date"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Submission Due Date & Time *
                  </label>
                  <input
                    id="t-due-date"
                    type="datetime-local"
                    required
                    value={submissionDueDate}
                    onChange={(e) => setSubmissionDueDate(e.target.value)}
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="t-prebid-date"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Pre-Bid Meeting Date (Optional)
                  </label>
                  <input
                    id="t-prebid-date"
                    type="date"
                    value={preBidDate}
                    onChange={(e) => setPreBidDate(e.target.value)}
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="t-completion-date"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Tender Result / Completion Date
                  </label>
                  <input
                    id="t-completion-date"
                    type="date"
                    value={completionDate}
                    onChange={(e) => setCompletionDate(e.target.value)}
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="t-est-val"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Estimated Tender Value (₹)
                  </label>
                  <input
                    id="t-est-val"
                    type="number"
                    min={0}
                    value={estimatedValue}
                    onChange={(e) => setEstimatedValue(e.target.value)}
                    placeholder="e.g. 15000000"
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="t-quoted-val"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Our Quoted Bid Value (₹)
                  </label>
                  <input
                    id="t-quoted-val"
                    type="number"
                    min={0}
                    value={quotedValue}
                    onChange={(e) => setQuotedValue(e.target.value)}
                    placeholder="e.g. 14250000"
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="t-emd-status"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    EMD / Bid Security Required
                  </label>
                  <select
                    id="t-emd-status"
                    value={emdStatus}
                    onChange={(e) => setEmdStatus(e.target.value as EmdSecurityType)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {EMD_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="t-emd-amt"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    EMD Amount (₹)
                  </label>
                  <input
                    id="t-emd-amt"
                    type="number"
                    min={0}
                    disabled={!supportsEmdSync}
                    value={supportsEmdSync ? emdAmount : '0'}
                    onChange={(e) => setEmdAmount(e.target.value)}
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:bg-slate-100 dark:disabled:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="sm:col-span-2 lg:col-span-4">
                  <label
                    htmlFor="t-result-info"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Result / L1 Price Info (Competitive Analysis)
                  </label>
                  <input
                    id="t-result-info"
                    type="text"
                    value={resultInfo}
                    onChange={(e) => setResultInfo(e.target.value)}
                    placeholder="e.g. Declared L1 or L2 behind competitor at ₹ X"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              {supportsEmdSync && !isEdit && (
                <label className="flex items-center gap-2.5 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs font-medium text-blue-900 dark:text-blue-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncToEmd}
                    onChange={(e) => setSyncToEmd(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                  />
                  <span>
                    Auto-create linked entry in Tab 3 (EMD & BG Tracker) upon saving
                  </span>
                </label>
              )}
            </section>

            {/* Section 3: Tender Attachments */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6">
              <AttachmentSlots
                title="3. Tender Attachments (3 Slots + Extra)"
                slots={attachmentSlots}
                onChange={setAttachmentSlots}
              />
            </section>

            {/* Section 4: Optional Bulk MAF Tracker Initialization (New Tenders Only) */}
            {!isEdit && (
              <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={initMafEnabled}
                      onChange={(e) => setInitMafEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                    />
                    <ShieldCheck
                      className="h-4 w-4 text-[#1E3A8A] dark:text-blue-400"
                      aria-hidden="true"
                    />
                    <span className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                      4. Initialize MAF Status Tracker (Optional BOQ / OEM Items)
                    </span>
                  </label>
                  {initMafEnabled && (
                    <button
                      type="button"
                      onClick={() =>
                        setDraftMafItems((prev) => [
                          ...prev,
                          {
                            itemId: createMafItemId(prev.length),
                            itemName: '',
                            requiredQuantity: '',
                            oemName: '',
                            mafStatus: 'Not Requested',
                          },
                        ])
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-200"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Add Item</span>
                    </button>
                  )}
                </div>

                {initMafEnabled && (
                  <div className="space-y-2.5 pt-1">
                    <datalist id="tender-modal-oem-list">
                      {COMMON_OEM_NAMES.map((oem) => (
                        <option key={oem} value={oem} />
                      ))}
                    </datalist>
                    {draftMafItems.map((row, idx) => (
                      <div
                        key={row.itemId}
                        className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-3"
                      >
                        <input
                          type="text"
                          value={row.itemName}
                          onChange={(e) =>
                            setDraftMafItems((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, itemName: e.target.value } : r)),
                            )
                          }
                          placeholder={`Item ${idx + 1} Name (e.g. Core Switch)`}
                          className="sm:col-span-4 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                        />
                        <input
                          type="text"
                          value={row.requiredQuantity}
                          onChange={(e) =>
                            setDraftMafItems((prev) =>
                              prev.map((r, i) =>
                                i === idx ? { ...r, requiredQuantity: e.target.value } : r,
                              ),
                            )
                          }
                          placeholder="Qty (e.g. 10 Nos)"
                          className="sm:col-span-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                        />
                        <input
                          type="text"
                          list="tender-modal-oem-list"
                          value={row.oemName}
                          onChange={(e) =>
                            setDraftMafItems((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, oemName: e.target.value } : r)),
                            )
                          }
                          placeholder="OEM Name (e.g. Cisco)"
                          className="sm:col-span-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                        />
                        <select
                          value={row.mafStatus}
                          onChange={(e) =>
                            setDraftMafItems((prev) =>
                              prev.map((r, i) =>
                                i === idx ? { ...r, mafStatus: e.target.value as MafItemStatus } : r,
                              ),
                            )
                          }
                          className="sm:col-span-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                        >
                          {MAF_STATUS_OPTIONS.map((st) => (
                            <option key={st} value={st}>
                              {st}
                            </option>
                          ))}
                        </select>
                        <div className="sm:col-span-1 flex justify-end">
                          {draftMafItems.length > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                setDraftMafItems((prev) => prev.filter((_, i) => i !== idx))
                              }
                              aria-label={`Remove MAF item ${idx + 1}`}
                              className="p-1.5 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Bottom Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 pb-4">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Back to Daily Tender Data</span>
              </button>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{isEdit ? 'Save Changes' : 'Create Tender'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
