import { useState, type ChangeEvent } from 'react';
import { Download, FileText, Paperclip, Plus, Trash2, Upload } from 'lucide-react';
import type { AttachmentItem } from '../types/crm';
import {
  formatFileSize,
  isSafeAttachmentHref,
  readAttachmentForFirestore,
  type AttachmentSlotState,
} from '../utils/attachments';
import { getLocalDateInputValue } from '../utils/formatters';

interface AttachmentSlotsProps {
  title: string;
  slots: AttachmentSlotState[];
  onChange: (nextSlots: AttachmentSlotState[]) => void;
}

export function AttachmentSlots({ title, slots, onChange }: AttachmentSlotsProps) {
  const [slotError, setSlotError] = useState<string>('');
  const [readingSlot, setReadingSlot] = useState<number | null>(null);
  const [extraEmptySlots, setExtraEmptySlots] = useState<AttachmentSlotState[]>([]);

  const displaySlots = [...slots, ...extraEmptySlots];

  const handleFilePick = async (slotIndex: number, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const targetSlot = displaySlots[slotIndex];
    if (!targetSlot) return;

    setReadingSlot(slotIndex);
    try {
      const { dataUrl, fileSize, fileType } = await readAttachmentForFirestore(file);
      const item: AttachmentItem = {
        id: `att-${Date.now()}-${slotIndex}`,
        slotLabel: targetSlot.slotLabel,
        fileName: file.name,
        fileType,
        fileSize,
        uploadedAt: getLocalDateInputValue(),
        dataUrl,
      };
      setSlotError('');
      if (slotIndex < slots.length) {
        onChange(
          slots.map((slot, idx) => (idx === slotIndex ? { ...slot, attachment: item } : slot)),
        );
      } else {
        const extraIdx = slotIndex - slots.length;
        setExtraEmptySlots((prev) => prev.filter((_, idx) => idx !== extraIdx));
        onChange([...slots, { ...targetSlot, attachment: item }]);
      }
    } catch (err) {
      setSlotError(
        err instanceof Error ? err.message : 'Unable to process the selected file.',
      );
    } finally {
      setReadingSlot(null);
    }
  };

  const handleRemoveFile = (slotIndex: number) => {
    setSlotError('');
    if (slotIndex < slots.length) {
      onChange(
        slots.map((slot, idx) => (idx === slotIndex ? { ...slot, attachment: null } : slot)),
      );
    } else {
      const extraIdx = slotIndex - slots.length;
      setExtraEmptySlots((prev) => prev.filter((_, idx) => idx !== extraIdx));
    }
  };

  const handleAddSlot = () => {
    const nextNumber = displaySlots.length + 1;
    setExtraEmptySlots((prev) => [
      ...prev,
      {
        slotId: `slot-${Date.now()}-${nextNumber}`,
        slotLabel: `Attachment ${nextNumber} · Additional Document`,
        attachment: null,
      },
    ]);
  };

  const attachedCount = displaySlots.filter((s) => s.attachment !== null).length;

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
            ({attachedCount}/{displaySlots.length} attached · max 650 KB/file, images auto-compressed)
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
        {displaySlots.map((slot, idx) => {
          const inputId = `att-input-${slot.slotId}`;
          const file = slot.attachment;
          const isBusy = readingSlot === idx;
          const isExtraEmpty = idx >= slots.length && !file;
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
                    {file.dataUrl ? (
                      isSafeAttachmentHref(file.dataUrl) ? (
                        <a
                          href={file.dataUrl}
                          download={file.fileName}
                          aria-label={`Download ${file.fileName}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Download</span>
                        </a>
                      ) : (
                        <span className="text-[11px] text-rose-600 dark:text-rose-400 px-2">
                          Unsafe attachment blocked
                        </span>
                      )
                    ) : (
                      <span className="text-[11px] text-slate-400 px-2">Syncing file…</span>
                    )}
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

                {isExtraEmpty && (
                  <button
                    type="button"
                    onClick={() => handleRemoveFile(idx)}
                    aria-label={`Remove ${slot.slotLabel}`}
                    className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}

                <label
                  htmlFor={inputId}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-[11px] font-medium text-[#1E3A8A] dark:text-blue-400 cursor-pointer whitespace-nowrap"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{isBusy ? 'Processing…' : file ? 'Replace' : 'Attach File'}</span>
                  <input
                    id={inputId}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.xls,.xlsx,.csv,.doc,.docx"
                    disabled={isBusy}
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
