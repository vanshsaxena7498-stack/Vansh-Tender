import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import type {
  EmdBgRecord,
  FinancialStatus,
  InstrumentType,
  Tender,
} from '../types/crm';
import {
  buildInitialAttachmentSlots,
  EMD_DEFAULT_SLOT_LABELS,
  extractSavedAttachments,
  type AttachmentSlotState,
} from '../utils/attachments';
import { getLocalDateInputValue } from '../utils/formatters';
import { AttachmentSlots } from './AttachmentSlots';

interface EmdBgFormModalProps {
  initialRecord?: EmdBgRecord | null;
  tenders: Tender[];
  onClose: () => void;
  onSave: (record: EmdBgRecord) => void;
}

const INSTRUMENT_TYPES: InstrumentType[] = [
  'Online / NEFT / RTGS',
  'Demand Draft (DD)',
  'Bank Guarantee (PBG / Bid BG)',
  'FDR / TDR',
  'e-PBG',
];

const FINANCIAL_STATUSES: FinancialStatus[] = [
  'Active / Locked',
  'Extension Requested',
  'Refund / Release Applied',
  'Refunded / Released',
  'Forfeited',
];

export function EmdBgFormModal({
  initialRecord,
  tenders,
  onClose,
  onSave,
}: EmdBgFormModalProps) {
  const isEdit = Boolean(initialRecord);

  const [tenderRefId, setTenderRefId] = useState(initialRecord?.tenderRefId ?? '');
  const [tenderId, setTenderId] = useState(initialRecord?.tenderId ?? '');
  const [department, setDepartment] = useState(initialRecord?.department ?? '');
  const [instrumentType, setInstrumentType] = useState<InstrumentType>(
    initialRecord?.instrumentType ?? 'Bank Guarantee (PBG / Bid BG)',
  );
  const [referenceNo, setReferenceNo] = useState(initialRecord?.referenceNo ?? '');
  const [bankName, setBankName] = useState(initialRecord?.bankName ?? '');
  const [amount, setAmount] = useState(initialRecord ? String(initialRecord.amount) : '');
  const [issueDate, setIssueDate] = useState(
    initialRecord?.issueDate ?? getLocalDateInputValue(),
  );
  const [expiryDate, setExpiryDate] = useState(initialRecord?.expiryDate ?? '');
  const [claimEndDate, setClaimEndDate] = useState(initialRecord?.claimEndDate ?? '');
  const [status, setStatus] = useState<FinancialStatus>(
    initialRecord?.status ?? 'Active / Locked',
  );
  const [refundDate, setRefundDate] = useState(initialRecord?.refundDate ?? '');
  const [refundRef, setRefundRef] = useState(initialRecord?.refundRef ?? '');
  const [remarks, setRemarks] = useState(initialRecord?.remarks ?? '');
  const [attachmentSlots, setAttachmentSlots] = useState<AttachmentSlotState[]>(() =>
    buildInitialAttachmentSlots(initialRecord?.attachments, EMD_DEFAULT_SLOT_LABELS),
  );
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

  const handleSelectLinkedTender = (selectedInternalId: string) => {
    setTenderRefId(selectedInternalId);
    const found = tenders.find((t) => t.id === selectedInternalId);
    if (found) {
      setTenderId(found.tenderId);
      setDepartment(found.department);
      if (!amount && found.emdAmount > 0) {
        setAmount(String(found.emdAmount));
      }
      if (!isEdit) {
        setInstrumentType(
          found.emdStatus === 'BG Submitted'
            ? 'Bank Guarantee (PBG / Bid BG)'
            : 'Online / NEFT / RTGS',
        );
      }
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const numericAmt = Number(amount);
    if (
      !tenderId.trim() ||
      !department.trim() ||
      !referenceNo.trim() ||
      !bankName.trim() ||
      !Number.isFinite(numericAmt) ||
      numericAmt <= 0
    ) {
      setErrorMsg(
        'Please complete Tender ID, Department, Instrument Reference No., Issuing Bank, and Amount (> ₹ 0).',
      );
      return;
    }
    if (expiryDate && issueDate && expiryDate < issueDate) {
      setErrorMsg('Expiry / Maturity Date cannot be earlier than Issue Date.');
      return;
    }
    if (claimEndDate && expiryDate && claimEndDate < expiryDate) {
      setErrorMsg('Claim Period End Date cannot be earlier than Expiry / Maturity Date.');
      return;
    }
    if (status === 'Refunded / Released' && !refundDate) {
      setErrorMsg('Please enter the Refund / Release Date before marking status as Refunded / Released.');
      return;
    }

    const record: EmdBgRecord = {
      id: initialRecord?.id ?? `emd-${Date.now()}`,
      tenderRefId: tenderRefId || undefined,
      tenderId: tenderId.trim(),
      department: department.trim(),
      instrumentType,
      referenceNo: referenceNo.trim(),
      bankName: bankName.trim(),
      amount: Math.round(numericAmt),
      issueDate,
      expiryDate,
      claimEndDate,
      status,
      refundDate: refundDate || undefined,
      refundRef: refundRef.trim() || undefined,
      remarks: remarks.trim(),
      attachments: extractSavedAttachments(attachmentSlots),
    };

    onSave(record);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? 'Edit EMD / BG Entry' : 'Add EMD / BG Entry'}
      data-fullscreen-form="emdbg"
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
                  {isEdit
                    ? `Edit Security Instrument · ${initialRecord?.referenceNo}`
                    : 'Log EMD / Bank Guarantee'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  EMD & BG Tracker · Full-Screen Entry
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
                <span>{isEdit ? 'Save Instrument' : 'Add EMD / BG Record'}</span>
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

            {/* Section 1: Linked Tender & Instrument Details */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-2.5">
                1. Linked Tender & Security Instrument Details
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="sm:col-span-2 lg:col-span-3">
                  <label
                    htmlFor="emd-link-tender"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Auto-Link Existing Tender (Optional)
                  </label>
                  <select
                    id="emd-link-tender"
                    value={tenderRefId}
                    onChange={(e) => handleSelectLinkedTender(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="">-- Manual Entry / Select from Daily Tender Data --</option>
                    {tenders.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.tenderId} — {t.department}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="emd-tender-id"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Linked Tender ID / Bid No. *
                  </label>
                  <input
                    id="emd-tender-id"
                    type="text"
                    required
                    value={tenderId}
                    onChange={(e) => setTenderId(e.target.value)}
                    placeholder="e.g. CPPP/2026/NHAI/88341"
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="lg:col-span-2">
                  <label
                    htmlFor="emd-dept"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Department / Beneficiary Name *
                  </label>
                  <input
                    id="emd-dept"
                    type="text"
                    required
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    placeholder="e.g. NHAI, Jaipur"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="emd-type"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Instrument Type *
                  </label>
                  <select
                    id="emd-type"
                    value={instrumentType}
                    onChange={(e) => setInstrumentType(e.target.value as InstrumentType)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {INSTRUMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="emd-ref-no"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Instrument / BG / UTR Reference No. *
                  </label>
                  <input
                    id="emd-ref-no"
                    type="text"
                    required
                    value={referenceNo}
                    onChange={(e) => setReferenceNo(e.target.value)}
                    placeholder="e.g. BG-HDFC-2026-004918"
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="emd-bank"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Issuing Bank Name & Branch *
                  </label>
                  <input
                    id="emd-bank"
                    type="text"
                    required
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="e.g. HDFC Bank, Nariman Point"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>
            </section>

            {/* Section 2: Amount, Validity & Refund Tracking */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-2.5">
                2. Amount, Validity Dates & Refund Tracking
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label
                    htmlFor="emd-amount"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Amount (₹) *
                  </label>
                  <input
                    id="emd-amount"
                    type="number"
                    min={1}
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 500000"
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="emd-status"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Financial Status
                  </label>
                  <select
                    id="emd-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as FinancialStatus)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {FINANCIAL_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="emd-issue-date"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Issue Date
                  </label>
                  <input
                    id="emd-issue-date"
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="emd-expiry-date"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Expiry / Maturity Date
                  </label>
                  <input
                    id="emd-expiry-date"
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="emd-claim-date"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Claim Period End Date (for BGs)
                  </label>
                  <input
                    id="emd-claim-date"
                    type="date"
                    value={claimEndDate}
                    onChange={(e) => setClaimEndDate(e.target.value)}
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="emd-refund-date"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Refund / Release Date
                  </label>
                  <input
                    id="emd-refund-date"
                    type="date"
                    value={refundDate}
                    onChange={(e) => setRefundDate(e.target.value)}
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="lg:col-span-2">
                  <label
                    htmlFor="emd-refund-ref"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Refund / Release Transaction Ref
                  </label>
                  <input
                    id="emd-refund-ref"
                    type="text"
                    value={refundRef}
                    onChange={(e) => setRefundRef(e.target.value)}
                    placeholder="e.g. NEFT-REF-2026-991"
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="sm:col-span-2 lg:col-span-4">
                  <label
                    htmlFor="emd-remarks"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Follow-up Remarks
                  </label>
                  <textarea
                    id="emd-remarks"
                    rows={2}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="e.g. Letter submitted to accounts dept for EMD release"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>
            </section>

            {/* Section 3: EMD / BG Attachments */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6">
              <AttachmentSlots
                title="3. EMD / BG Attachments (3 Slots + Extra)"
                slots={attachmentSlots}
                onChange={setAttachmentSlots}
              />
            </section>

            {/* Bottom Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 pb-4">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Back to EMD & BG Tracker</span>
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
                  <span>{isEdit ? 'Save Instrument' : 'Add EMD / BG Record'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
