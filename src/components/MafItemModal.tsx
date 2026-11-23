import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertTriangle,
  Building2,
  Check,
  FileText,
  Link2,
  Loader2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { MafItemStatus, MafLineItem, OemRecord } from '../types/crm';
import {
  createMafItemId,
  getMafContactDetails,
  getMafRequestedDate,
  isSafeHttpUrl,
  isSafeMafDataUrl,
  MAF_STATUS_OPTIONS,
  validateMafItemDraft,
  validateMafUploadFile,
} from '../utils/mafCalculations';
import { buildMafContactPatchFromOem, findOemByName } from '../utils/oemDirectory';
import { OemSelectControl } from './OemSelectControl';

interface MafItemModalProps {
  trackerId: string;
  tenderId: string;
  tenderTitle: string;
  initialItem?: MafLineItem | null;
  oemRecords: OemRecord[];
  onGoToOemDetails: () => void;
  onClose: () => void;
  onSave: (item: MafLineItem) => void;
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

export function MafItemModal({
  trackerId,
  tenderId,
  tenderTitle,
  initialItem,
  oemRecords,
  onGoToOemDetails,
  onClose,
  onSave,
  onUploadFile,
}: MafItemModalProps) {
  const isEdit = Boolean(initialItem);
  const initialContact = initialItem
    ? getMafContactDetails(initialItem)
    : { concernedPersonName: '', contactNo: '', mailId: '' };

  const [itemId] = useState(() => initialItem?.itemId ?? createMafItemId());
  const [itemName, setItemName] = useState(initialItem?.itemName ?? '');
  const [requiredQuantity, setRequiredQuantity] = useState(initialItem?.requiredQuantity ?? '');
  const [oemName, setOemName] = useState(initialItem?.oemName ?? '');
  const [companyName, setCompanyName] = useState(initialItem?.companyName ?? '');
  const [concernedPersonName, setConcernedPersonName] = useState(
    initialContact.concernedPersonName,
  );
  const [contactNo, setContactNo] = useState(initialContact.contactNo);
  const [mailId, setMailId] = useState(initialContact.mailId);
  const [mafStatus, setMafStatus] = useState<MafItemStatus>(
    initialItem?.mafStatus ?? 'Not Requested',
  );
  const [mafRequestedDate, setMafRequestedDate] = useState(
    initialItem ? getMafRequestedDate(initialItem) : '',
  );
  const [mafDocumentUrl, setMafDocumentUrl] = useState(initialItem?.mafDocumentUrl ?? '');
  const [mafDocumentName, setMafDocumentName] = useState(initialItem?.mafDocumentName ?? '');
  const [mafAttachmentId, setMafAttachmentId] = useState(initialItem?.mafAttachmentId ?? '');
  const [remarks, setRemarks] = useState(initialItem?.remarks ?? '');

  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const matchedOem = findOemByName(oemRecords, oemName);
  const hasUnlistedLegacyOem = Boolean(oemName.trim()) && !matchedOem;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleSelectOem = (selected: OemRecord | null) => {
    if (selected) {
      const patch = buildMafContactPatchFromOem(selected);
      setOemName(patch.oemName);
      setCompanyName(patch.companyName);
      setConcernedPersonName(patch.concernedPersonName);
      setContactNo(patch.contactNo);
      setMailId(patch.mailId);
      setErrorMsg('');
    } else {
      setOemName('');
      setCompanyName('');
      setConcernedPersonName('');
      setContactNo('');
      setMailId('');
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const validationError = validateMafUploadFile(file);
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }

    setErrorMsg('');
    setUploading(true);
    try {
      const uploaded = await onUploadFile(trackerId, itemId, file);
      setMafDocumentUrl(uploaded.mafDocumentUrl);
      setMafDocumentName(uploaded.mafDocumentName);
      setMafAttachmentId(uploaded.mafAttachmentId ?? '');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to upload signed MAF document.');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const validationErr = validateMafItemDraft({
      itemName,
      oemName,
      companyName,
      mafStatus,
      requiredQuantity,
      allowedOemNames: oemRecords.map((o) => o.oemName),
    });
    if (validationErr) {
      setErrorMsg(validationErr);
      return;
    }
    if (uploading) {
      setErrorMsg('Please wait for the MAF document upload to complete.');
      return;
    }
    const cleanDocUrl = mafDocumentUrl.trim();
    if (cleanDocUrl && !isSafeMafDataUrl(cleanDocUrl) && !isSafeHttpUrl(cleanDocUrl)) {
      setErrorMsg('Please enter a valid http:// or https:// cloud link for the MAF document.');
      return;
    }

    const canonicalPatch = matchedOem ? buildMafContactPatchFromOem(matchedOem) : null;
    const finalOemName = canonicalPatch ? canonicalPatch.oemName : oemName.trim();
    const finalCompany = canonicalPatch ? canonicalPatch.companyName : companyName.trim();
    const cleanPerson = canonicalPatch
      ? canonicalPatch.concernedPersonName
      : concernedPersonName.trim();
    const cleanPhone = canonicalPatch ? canonicalPatch.contactNo : contactNo.trim();
    const cleanMail = canonicalPatch ? canonicalPatch.mailId : mailId.trim();

    const savedItem: MafLineItem = {
      itemId,
      itemName: itemName.trim(),
      requiredQuantity: requiredQuantity.trim(),
      oemName: finalOemName,
      companyName: finalCompany,
      concernedPersonName: cleanPerson,
      contactNo: cleanPhone,
      mailId: cleanMail,
      oemContact: [cleanPerson, cleanPhone].filter(Boolean).join(' · '),
      mafStatus,
      mafRequestedDate,
      mafDocumentUrl: mafDocumentUrl.trim(),
      mafDocumentName:
        mafDocumentName.trim() ||
        (mafDocumentUrl.trim() && !mafDocumentUrl.startsWith('data:') ? 'Cloud link' : ''),
      mafAttachmentId: mafAttachmentId || undefined,
      remarks: remarks.trim(),
      updatedAt: new Date().toISOString(),
    };
    onSave(savedItem);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? 'Edit MAF Line Item' : 'Add MAF Line Item'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 overflow-y-auto"
    >
      <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white truncate">
              {isEdit ? 'Edit BOQ / OEM MAF Item' : 'Add New BOQ / OEM MAF Item'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              <span className="font-mono-num font-medium text-slate-700 dark:text-slate-300">
                {tenderId}
              </span>{' '}
              · {tenderTitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close item dialog"
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

          {oemRecords.length === 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/30 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-300">
              <span className="inline-flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  No OEMs registered in <strong>OEM Details</strong> yet. Add OEMs first before assigning an OEM here.
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onGoToOemDetails();
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-700 hover:bg-amber-800 text-white text-[11px] font-medium shrink-0"
              >
                <Building2 className="h-3 w-3" aria-hidden="true" />
                <span>Go to OEM Details</span>
              </button>
            </div>
          )}

          {oemRecords.length > 0 && hasUnlistedLegacyOem && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/30 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                &ldquo;{oemName.trim()}&rdquo; is not in your <strong>OEM Details</strong> directory. Select a registered OEM below to auto-fill contact details.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label
                htmlFor="maf-item-name"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Item Name / BOQ Category *
              </label>
              <input
                id="maf-item-name"
                type="text"
                required
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                placeholder="e.g. Dome Cameras (4MP IR Weatherproof)"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="maf-item-qty"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Required Qty
              </label>
              <input
                id="maf-item-qty"
                type="text"
                value={requiredQuantity}
                onChange={(e) => setRequiredQuantity(e.target.value)}
                placeholder="e.g. 120 Nos"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="maf-oem-name"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                OEM / Manufacturer Name {mafStatus !== 'Pending' ? '*' : ''}
              </label>
              <OemSelectControl
                id="maf-oem-name"
                oemRecords={oemRecords}
                value={oemName}
                required={mafStatus !== 'Pending'}
                allowClear={mafStatus === 'Pending'}
                placeholder="Select from OEM Details..."
                onSelectOem={handleSelectOem}
                onGoToOemDetails={() => {
                  onClose();
                  onGoToOemDetails();
                }}
              />
            </div>

            <div>
              <label
                htmlFor="maf-company-name"
                className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                <span>Company Name</span>
                <span className="text-[10px] font-normal text-blue-700 dark:text-blue-400">
                  Auto-filled
                </span>
              </label>
              <input
                id="maf-company-name"
                type="text"
                readOnly
                value={companyName}
                placeholder="Auto-filled from OEM Details"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/70 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 cursor-not-allowed focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="maf-item-status"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                MAF Status
              </label>
              <select
                id="maf-item-status"
                value={mafStatus}
                onChange={(e) => setMafStatus(e.target.value as MafItemStatus)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {MAF_STATUS_OPTIONS.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="maf-requested-date"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                MAF Requested Date
              </label>
              <input
                id="maf-requested-date"
                type="date"
                value={mafRequestedDate}
                onChange={(e) => setMafRequestedDate(e.target.value)}
                className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="maf-concerned-person"
                className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                <span>Concerned Person Name</span>
                <span className="text-[10px] font-normal text-blue-700 dark:text-blue-400">
                  Auto-filled
                </span>
              </label>
              <input
                id="maf-concerned-person"
                type="text"
                readOnly
                value={concernedPersonName}
                placeholder="Auto-filled from OEM Details"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/70 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 cursor-not-allowed focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="maf-contact-no"
                className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                <span>Contact No.</span>
                <span className="text-[10px] font-normal text-blue-700 dark:text-blue-400">
                  Auto-filled
                </span>
              </label>
              <input
                id="maf-contact-no"
                type="tel"
                readOnly
                value={contactNo}
                placeholder="Auto-filled from OEM Details"
                className="font-mono-num w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/70 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 cursor-not-allowed focus:outline-none"
              />
            </div>

            <div className="sm:col-span-3">
              <label
                htmlFor="maf-mail-id"
                className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                <span>Mail ID</span>
                <span className="text-[10px] font-normal text-blue-700 dark:text-blue-400">
                  Auto-filled
                </span>
              </label>
              <input
                id="maf-mail-id"
                type="email"
                readOnly
                value={mailId}
                placeholder="Auto-filled from OEM Details"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/70 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 cursor-not-allowed focus:outline-none"
              />
            </div>

            <div className="sm:col-span-3">
              <label
                htmlFor="maf-doc-url"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Signed MAF Document (Upload PDF/Image ≤ 5 MB or Paste Cloud Link)
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                  className="sr-only"
                  aria-label="Upload signed MAF PDF or image"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200 shrink-0"
                >
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span>{uploading ? 'Uploading...' : 'Upload File'}</span>
                </button>

                {mafDocumentUrl.startsWith('data:') ? (
                  <div className="flex-1 min-w-0 flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 text-xs text-emerald-800 dark:text-emerald-300">
                    <span className="inline-flex items-center gap-1.5 truncate">
                      <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{mafDocumentName || 'Uploaded MAF File'}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setMafDocumentUrl('');
                        setMafDocumentName('');
                        setMafAttachmentId('');
                      }}
                      className="text-red-600 dark:text-red-400 hover:underline shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex-1 min-w-[180px] relative">
                    <Link2
                      className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                      aria-hidden="true"
                    />
                    <input
                      id="maf-doc-url"
                      type="url"
                      value={mafDocumentUrl}
                      onChange={(e) => {
                        const val = e.target.value;
                        setMafDocumentUrl(val);
                        if (!val.trim()) {
                          setMafDocumentName('');
                        } else if (!mafDocumentName) {
                          setMafDocumentName('Cloud link');
                        }
                        setMafAttachmentId('');
                      }}
                      placeholder="https://drive.google.com/..."
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 pl-8 pr-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="sm:col-span-3">
              <label
                htmlFor="maf-item-remarks"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Follow-up Remarks & History
              </label>
              <textarea
                id="maf-item-remarks"
                rows={2}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="e.g. Deal registration ID, OEM channel escalation notes, or compliance conditions..."
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
              disabled={uploading}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-medium"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isEdit ? 'Save Item Changes' : 'Add Item to Tracker'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
