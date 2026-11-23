import { useEffect, useState, type FormEvent } from 'react';
import { Building2, Check, X } from 'lucide-react';
import type { OemRecord } from '../types/crm';
import {
  createOemId,
  sanitizeOemDraft,
  validateOemDraft,
} from '../utils/oemDirectory';

interface OemFormModalProps {
  initialOem?: OemRecord | null;
  existingOems: OemRecord[];
  onClose: () => void;
  onSave: (oem: OemRecord) => void;
}

export function OemFormModal({
  initialOem,
  existingOems,
  onClose,
  onSave,
}: OemFormModalProps) {
  const isEdit = Boolean(initialOem);

  const [oemName, setOemName] = useState(initialOem?.oemName ?? '');
  const [companyName, setCompanyName] = useState(initialOem?.companyName ?? '');
  const [concernedPersonName, setConcernedPersonName] = useState(
    initialOem?.concernedPersonName ?? '',
  );
  const [email, setEmail] = useState(initialOem?.email ?? '');
  const [phone, setPhone] = useState(initialOem?.phone ?? '');
  const [remarks, setRemarks] = useState(initialOem?.remarks ?? '');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const rawDraft = {
      oemName,
      companyName,
      concernedPersonName,
      email,
      phone,
      remarks,
    };

    const validationError = validateOemDraft(rawDraft, existingOems, initialOem?.id);
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }

    const cleaned = sanitizeOemDraft(rawDraft);
    const nowIso = new Date().toISOString();
    onSave({
      id: initialOem?.id ?? createOemId(),
      oemName: cleaned.oemName,
      companyName: cleaned.companyName,
      concernedPersonName: cleaned.concernedPersonName,
      email: cleaned.email,
      phone: cleaned.phone,
      remarks: cleaned.remarks,
      createdAt: initialOem?.createdAt ?? nowIso,
      updatedAt: nowIso,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="oem-modal-title"
      data-testid="oem-form-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 overflow-y-auto"
    >
      <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-[#1E3A8A]/10 dark:bg-blue-900/40 text-[#1E3A8A] dark:text-blue-400 flex items-center justify-center shrink-0">
              <Building2 className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="oem-modal-title"
                className="font-display text-base font-semibold text-slate-900 dark:text-white truncate"
              >
                {isEdit ? `Edit OEM Details · ${initialOem?.oemName}` : 'Add New OEM Record'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                Registered OEMs appear in MAF Status dropdowns and auto-fill contact details
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close OEM dialog"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorMsg && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:text-red-300"
            >
              {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="oem-name-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                OEM / Manufacturer Name *
              </label>
              <input
                id="oem-name-input"
                type="text"
                required
                value={oemName}
                onChange={(e) => setOemName(e.target.value)}
                placeholder="e.g. NVS"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="oem-company-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Company Name
              </label>
              <input
                id="oem-company-input"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Newtech"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="oem-person-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Concerned Person Name
              </label>
              <input
                id="oem-person-input"
                type="text"
                value={concernedPersonName}
                onChange={(e) => setConcernedPersonName(e.target.value)}
                placeholder="e.g. Sandeep Tyagi"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="oem-phone-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Phone No.
              </label>
              <input
                id="oem-phone-input"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. +91 8800686947"
                className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="oem-email-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Email ID
              </label>
              <input
                id="oem-email-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. sandeep.tyagi@nvsledwall.com"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="oem-remarks-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Remarks / Notes
              </label>
              <textarea
                id="oem-remarks-input"
                rows={3}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Product line authorization notes, portal registration ID, escalation details..."
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="save-oem-btn"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isEdit ? 'Save OEM Changes' : 'Save OEM Record'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
