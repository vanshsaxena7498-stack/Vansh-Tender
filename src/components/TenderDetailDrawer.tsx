import { useEffect, useState, type FormEvent } from 'react';
import {
  Calculator,
  CheckSquare,
  Landmark,
  MessageSquarePlus,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import type { EmdBgRecord, Tender, TenderStage } from '../types/crm';
import { calculateBidQuote } from '../utils/calculations';
import {
  formatDateTime,
  formatINR,
  formatShortDate,
  getLocalDateInputValue,
} from '../utils/formatters';
import {
  buildInitialAttachmentSlots,
  extractSavedAttachments,
  TENDER_DEFAULT_SLOT_LABELS,
  type AttachmentSlotState,
} from '../utils/attachments';
import { AttachmentSlots } from './AttachmentSlots';

interface TenderDetailDrawerProps {
  tender: Tender;
  linkedEmdRecord?: EmdBgRecord;
  onClose: () => void;
  onEdit: (tender: Tender) => void;
  onDelete: (id: string) => void;
  onUpdateTender: (updated: Tender) => void;
  onSyncToEmdTracker: (tender: Tender) => void;
  onGoToEmdTab: () => void;
}

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

export function TenderDetailDrawer({
  tender,
  linkedEmdRecord,
  onClose,
  onEdit,
  onDelete,
  onUpdateTender,
  onSyncToEmdTracker,
  onGoToEmdTab,
}: TenderDetailDrawerProps) {
  const [newRemark, setNewRemark] = useState('');
  const [resultInfoDraft, setResultInfoDraft] = useState(tender.resultInfo);
  const [baseCostInput, setBaseCostInput] = useState<string>(
    tender.quotedValue > 0
      ? String(Math.round(tender.quotedValue / 1.18))
      : String(Math.round((tender.estimatedValue || 1000000) * 0.85)),
  );
  const [gstPct, setGstPct] = useState<number>(18);
  const [marginPct, setMarginPct] = useState<number>(12);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setResultInfoDraft(tender.resultInfo);
  }, [tender.id, tender.resultInfo]);

  const calcResult = calculateBidQuote(Number(baseCostInput) || 0, gstPct, marginPct);

  const toggleChecklist = (itemId: string) => {
    const nextChecklist = tender.checklist.map((item) =>
      item.id === itemId ? { ...item, checked: !item.checked } : item,
    );
    onUpdateTender({
      ...tender,
      checklist: nextChecklist,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleStageChange = (newStage: TenderStage) => {
    onUpdateTender({
      ...tender,
      stage: newStage,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleResultBlur = (val: string) => {
    if (val === tender.resultInfo) return;
    onUpdateTender({
      ...tender,
      resultInfo: val,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleAddRemark = (e: FormEvent) => {
    e.preventDefault();
    if (!newRemark.trim()) return;
    const now = new Date();
    const stamp = `${getLocalDateInputValue(now)} ${now.toTimeString().slice(0, 5)}`;
    const entry = {
      id: `rem-${Date.now()}`,
      timestamp: stamp,
      text: newRemark.trim(),
    };
    onUpdateTender({
      ...tender,
      remarks: [entry, ...tender.remarks],
      updatedAt: now.toISOString(),
    });
    setNewRemark('');
  };

  const handleApplyQuote = () => {
    onUpdateTender({
      ...tender,
      quotedValue: calcResult.finalBidQuote,
      updatedAt: new Date().toISOString(),
    });
  };

  const completedChecklistCount = tender.checklist.filter((c) => c.checked).length;
  const canSyncEmd =
    tender.emdStatus === 'EMD Paid' || tender.emdStatus === 'BG Submitted';
  const attachmentSlots = buildInitialAttachmentSlots(
    tender.attachments,
    TENDER_DEFAULT_SLOT_LABELS,
  );

  const handleAttachmentsChange = (nextSlots: AttachmentSlotState[]) => {
    onUpdateTender({
      ...tender,
      attachments: extractSavedAttachments(nextSlots),
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Tender Details for ${tender.tenderId}`}
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/50"
    >
      <div className="w-full max-w-2xl h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col shadow-2xl">
        {/* Drawer Header */}
        <div
          className={`flex items-start justify-between gap-4 px-6 py-4 border-b ${
            tender.stage === 'Tender Not Filled'
              ? 'border-red-200 dark:border-red-900/70 bg-red-50/70 dark:bg-red-950/35'
              : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50'
          }`}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p
                className={`font-mono-num text-xs font-semibold ${
                  tender.stage === 'Tender Not Filled'
                    ? 'text-red-700 dark:text-red-400'
                    : 'text-[#1E3A8A] dark:text-blue-400'
                }`}
              >
                {tender.tenderId} · {tender.portal}
              </p>
              {tender.stage === 'Tender Not Filled' && (
                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700 border border-red-200 dark:bg-red-950/80 dark:text-red-300 dark:border-red-800">
                  Tender Not Filled
                </span>
              )}
            </div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white mt-0.5">
              {tender.title}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {tender.department} · {tender.location}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onEdit(tender)}
              aria-label={`Edit ${tender.tenderId}`}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label={`Delete ${tender.tenderId}`}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close tender drawer"
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 dark:text-slate-400"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {confirmDelete && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 p-4 flex items-center justify-between gap-4">
              <p className="text-xs font-medium text-red-800 dark:text-red-200">
                Permanently delete tender {tender.tenderId}?
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(tender.id)}
                  className="px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-medium"
                >
                  Confirm Delete
                </button>
              </div>
            </div>
          )}

          {/* Core Specs & Financials */}
          <section className="grid grid-cols-2 sm:grid-cols-3 gap-4 pb-5 border-b border-slate-200 dark:border-slate-800 text-xs">
            <div>
              <span className="text-slate-500 dark:text-slate-400">Client / Organization</span>
              <p className="font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                {tender.clientName || tender.department}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Location / Department</span>
              <p className="font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                {tender.locationDepartment || [tender.location, tender.department].filter(Boolean).join(' / ')}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Assigned Person / Owner</span>
              <p className="font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                {tender.assignedOwner || '—'}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Publish Date</span>
              <p className="font-mono-num font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                {formatShortDate(tender.publishDate)}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Submission Due</span>
              <p className="font-mono-num font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                {formatDateTime(tender.submissionDueDate)}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Pre-Bid Meeting</span>
              <p className="font-mono-num font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                {formatShortDate(tender.preBidDate)}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Technical Opening</span>
              <p className="font-mono-num font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                {formatShortDate(tender.technicalOpeningDate)}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Financial Opening</span>
              <p className="font-mono-num font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                {formatShortDate(tender.financialOpeningDate || tender.completionDate)}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Estimated Value</span>
              <p className="font-mono-num font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {formatINR(tender.estimatedValue)}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Our Quoted Bid</span>
              <p className="font-mono-num font-semibold text-[#1E3A8A] dark:text-blue-400 mt-0.5">
                {tender.quotedValue > 0 ? formatINR(tender.quotedValue) : 'Not Quoted'}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">EMD / Security</span>
              <p className="font-mono-num font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                {tender.emdStatus}
                {tender.emdAmount > 0 ? ` (${formatINR(tender.emdAmount)})` : ''}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">L1 Bidder / Quoted</span>
              <p className="font-mono-num font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                {tender.l1BidderName || '—'}
                {tender.l1QuotedValue && tender.l1QuotedValue > 0 ? ` (${formatINR(tender.l1QuotedValue)})` : ''}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Our Position / Rank</span>
              <p className="font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                {tender.ourPositionRank || (tender.stage === 'L1 / Won' ? 'L1' : '—')}
              </p>
            </div>
          </section>

          {/* Stage & L1 Result + Sync to EMD/BG */}
          <section className="space-y-4 pb-5 border-b border-slate-200 dark:border-slate-800">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="drawer-stage-select"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Current Tender Stage
                </label>
                <select
                  id="drawer-stage-select"
                  value={tender.stage}
                  onChange={(e) => handleStageChange(e.target.value as TenderStage)}
                  className={`w-full rounded-lg border px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 ${
                    tender.stage === 'Tender Not Filled'
                      ? 'border-red-400 dark:border-red-700 bg-red-50/70 dark:bg-red-950/30 text-red-800 dark:text-red-200 focus:ring-red-500'
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

              <div>
                <label
                  htmlFor="drawer-result-info"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Result / L1 Price Info
                </label>
                <input
                  id="drawer-result-info"
                  type="text"
                  value={resultInfoDraft}
                  onChange={(e) => setResultInfoDraft(e.target.value)}
                  onBlur={() => handleResultBlur(resultInfoDraft)}
                  placeholder="Record L1 price or reason for loss..."
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            {canSyncEmd && (
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-2 text-xs">
                  <Landmark className="h-4 w-4 text-[#1E3A8A] dark:text-blue-400 shrink-0" />
                  {linkedEmdRecord ? (
                    <span className="text-slate-700 dark:text-slate-300">
                      Synced to EMD/BG Tracker ({linkedEmdRecord.referenceNo} ·{' '}
                      <span className="font-mono-num font-semibold">
                        {formatINR(linkedEmdRecord.amount)}
                      </span>
                      )
                    </span>
                  ) : (
                    <span className="text-slate-700 dark:text-slate-300">
                      {tender.emdStatus} ({formatINR(tender.emdAmount)}) is not yet logged in EMD & BG Tracker.
                    </span>
                  )}
                </div>
                {linkedEmdRecord ? (
                  <button
                    type="button"
                    onClick={onGoToEmdTab}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-medium text-[#1E3A8A] dark:text-blue-400 hover:bg-white dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    View in EMD & BG Tab
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSyncToEmdTracker(tender)}
                    className="px-3 py-1.5 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap"
                  >
                    Sync to EMD & BG Tracker
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Built-in Side-Tool 1: Document Readiness Checklist */}
          <section className="space-y-3 pb-5 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckSquare className="h-4 w-4 text-[#1E3A8A] dark:text-blue-400" />
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Document Readiness Checklist
                </h3>
              </div>
              <span className="font-mono-num text-xs font-medium text-slate-500 dark:text-slate-400">
                {completedChecklistCount}/{tender.checklist.length} Ready
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {tender.checklist.map((item) => (
                <label
                  key={item.id}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                    item.checked
                      ? 'border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/60 dark:bg-emerald-950/30 text-slate-900 dark:text-slate-100'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={() => toggleChecklist(item.id)}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
                  />
                  <span className={item.checked ? 'font-medium' : ''}>{item.label}</span>
                </label>
              ))}
            </div>
          </section>

          {/* Built-in Side-Tool 2: Quick Bid Margin & GST Calculator */}
          <section className="space-y-3 pb-5 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Calculator className="h-4 w-4 text-[#1E3A8A] dark:text-blue-400" />
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Quick Bid Margin & GST Calculator
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor="calc-base-cost"
                  className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
                >
                  Base Landing Cost (₹)
                </label>
                <input
                  id="calc-base-cost"
                  type="number"
                  min={0}
                  value={baseCostInput}
                  onChange={(e) => setBaseCostInput(e.target.value)}
                  className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label
                  htmlFor="calc-margin"
                  className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
                >
                  Margin (%)
                </label>
                <input
                  id="calc-margin"
                  type="number"
                  step="0.5"
                  value={marginPct}
                  onChange={(e) => setMarginPct(Number(e.target.value) || 0)}
                  className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label
                  htmlFor="calc-gst"
                  className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
                >
                  GST Slab (%)
                </label>
                <select
                  id="calc-gst"
                  value={gstPct}
                  onChange={(e) => setGstPct(Number(e.target.value))}
                  className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                >
                  <option value={5}>5% GST</option>
                  <option value={12}>12% GST</option>
                  <option value={18}>18% GST</option>
                  <option value={28}>28% GST</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 text-xs">
              <div className="space-y-0.5">
                <p className="text-slate-500 dark:text-slate-400">
                  Margin: <span className="font-mono-num text-slate-800 dark:text-slate-200">{formatINR(calcResult.marginAmount)}</span> · GST:{' '}
                  <span className="font-mono-num text-slate-800 dark:text-slate-200">{formatINR(calcResult.gstAmount)}</span>
                </p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  Final Bid Quote:{' '}
                  <span className="font-mono-num text-[#1E3A8A] dark:text-blue-400">
                    {formatINR(calcResult.finalBidQuote)}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={handleApplyQuote}
                className="px-3 py-1.5 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap"
              >
                Apply to Quoted Value
              </button>
            </div>
          </section>

          {/* Daily Follow-up Remarks / Activity Log */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <MessageSquarePlus className="h-4 w-4 text-[#1E3A8A] dark:text-blue-400" />
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Daily Follow-up Remarks & Activity Log
              </h3>
            </div>

            <form onSubmit={handleAddRemark} className="flex gap-2">
              <label htmlFor="new-remark-input" className="sr-only">
                Add daily follow-up remark
              </label>
              <input
                id="new-remark-input"
                type="text"
                value={newRemark}
                onChange={(e) => setNewRemark(e.target.value)}
                placeholder="Log daily progress (e.g., OEM authorization received, BOQ uploaded)..."
                className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap"
              >
                Log Note
              </button>
            </form>

            {tender.remarks.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
                No follow-up remarks logged yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {tender.remarks.map((r) => (
                  <li
                    key={r.id}
                    className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-xs"
                  >
                    <span className="font-mono-num text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {r.timestamp}
                    </span>
                    <p className="text-slate-800 dark:text-slate-200 mt-1">{r.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <AttachmentSlots
            title="Tender Documents & Attachments (3 Slots + Extra)"
            slots={attachmentSlots}
            onChange={handleAttachmentsChange}
          />
        </div>
      </div>
    </div>
  );
}
