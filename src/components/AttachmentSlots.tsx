import { useState, type ChangeEvent } from 'react';
import { Download, FileText, Paperclip, Plus, Trash2, Upload } from 'lucide-react';
import type { AttachmentItem } from '../types/crm';
import {
  formatFileSize,
  readFileAsDataUrl,
  validateAttachmentFileSize,
  type AttachmentSlotState,
} from '../utils/attachments';

interface AttachmentSlotsProps {
  title: string;
  slots: AttachmentSlotState[];
  onChange: (nextSlots: AttachmentSlotState[]) => void;
}

export function AttachmentSlots({ title, slots, onChange }: AttachmentSlotsProps) {
  const [slotError, setSlotError] = useState<string>('');

  const handleFilePick = async (slotIndex: number, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const sizeErr = validateAttachmentFileSize(file.size);
    if (sizeErr) {
      setSlotError(sizeErr);
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const item: AttachmentItem = {
        id: `att-${Date.now()}-${slotIndex}`,
        slotLabel: slots[slotIndex].slotLabel,
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        uploadedAt: new Date().toISOString().slice(0, 10),
        dataUrl,
      };
      setSlotError('');
      onChange(
        slots.map((slot, idx) => (idx === slotIndex ? { ...slot, attachment: item } : slot)),
      );
    } catch {
      setSlotError('Unable to read the selected file.');
    }
  };

  const handleRemoveFile = (slotIndex: number) => {
    setSlotError('');
    onChange(
      slots.map((slot, idx) => (idx === slotIndex ? { ...slot, attachment: null } : slot)),
    );
  };

  const handleAddSlot = () => {
    const nextNumber = slots.length + 1;
    onChange([
      ...slots,
      {
        slotId: `slot-${Date.now()}-${nextNumber}`,
        slotLabel: `Attachment ${nextNumber} · Additional Document`,
        attachment: null,
      },
    ]);
  };

  const attachedCount = slots.filter((s) => s.attachment !== null).length;

  return (
    <section
      aria-label={title}
      className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-[#1E3A8A] dark:text-blue-400" aria-hidden="true" />
          <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </h3>
          <span className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
            ({attachedCount}/{slots.length} attached · max 2 MB/file)
          </span>
        </div>

        <button
          type="button"
          onClick={handleAddSlot}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Add Extra Attachment</span>
        </button>
      </div>

      {slotError && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs font-medium text-red-700 dark:text-red-300"
        >
          {slotError}
        </p>
      )}

      <div className="grid grid-cols-1 gap-2.5">
        {slots.map((slot, idx) => {
          const inputId = `att-input-${slot.slotId}`;
          const file = slot.attachment;
          return (
            <div
              key={slot.slotId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                  {slot.slotLabel}
                </p>
                {file ? (
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                    <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="font-medium truncate max-w-[240px]" title={file.fileName}>
                      {file.fileName}
                    </span>
                    <span className="font-mono-num text-slate-500 dark:text-slate-400 shrink-0">
                      · {formatFileSize(file.fileSize)}
                    </span>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    No file selected (PDF, Image, Excel, Word supported)
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {file && (
                  <>
                    <a
                      href={file.dataUrl}
                      download={file.fileName}
                      aria-label={`Download ${file.fileName}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Download</span>
                    </a>
                    <button
                      type="button"
                      onClick={() => handleRemoveFile(idx)}
                      aria-label={`Remove ${file.fileName}`}
                      className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}

                <label
                  htmlFor={inputId}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-[11px] font-medium text-[#1E3A8A] dark:text-blue-400 cursor-pointer whitespace-nowrap"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{file ? 'Replace' : 'Attach File'}</span>
                  <input
                    id={inputId}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.xls,.xlsx,.csv,.doc,.docx"
                    onChange={(e) => handleFilePick(idx, e)}
                    className="sr-only"
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
