import type { AttachmentItem } from '../types/crm';

export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024; // 2 MB per file for safe localStorage persistence

export const TENDER_DEFAULT_SLOT_LABELS = [
  'Attachment 1 · NIT / Tender Document',
  'Attachment 2 · BOQ / Technical Spec',
  'Attachment 3 · Bid Receipt / Supporting Doc',
];

export const EMD_DEFAULT_SLOT_LABELS = [
  'Attachment 1 · BG / FDR / DD / UTR Copy',
  'Attachment 2 · Bank Covering / SFMS Advice',
  'Attachment 3 · Refund / Release Letter',
];

export interface AttachmentSlotState {
  slotId: string;
  slotLabel: string;
  attachment: AttachmentItem | null;
}

export function buildInitialAttachmentSlots(
  existing: AttachmentItem[] | undefined,
  defaultLabels: string[],
): AttachmentSlotState[] {
  const safeExisting = existing ?? [];
  const slots: AttachmentSlotState[] = defaultLabels.map((label, idx) => {
    const matched = safeExisting[idx] ?? null;
    return {
      slotId: matched?.id ?? `slot-${idx + 1}`,
      slotLabel: matched?.slotLabel ?? label,
      attachment: matched,
    };
  });

  // Preserve any extra attachments beyond the 3 mandatory/default slots
  for (let i = defaultLabels.length; i < safeExisting.length; i++) {
    const extra = safeExisting[i];
    slots.push({
      slotId: extra.id,
      slotLabel: extra.slotLabel || `Attachment ${i + 1}`,
      attachment: extra,
    });
  }

  return slots;
}

export function extractSavedAttachments(slots: AttachmentSlotState[]): AttachmentItem[] {
  return slots
    .map((s) =>
      s.attachment
        ? {
            ...s.attachment,
            slotLabel: s.slotLabel,
          }
        : null,
    )
    .filter((item): item is AttachmentItem => item !== null);
}

export function validateAttachmentFileSize(sizeBytes: number): string | null {
  if (sizeBytes <= 0) return 'Selected file appears to be empty.';
  if (sizeBytes > MAX_ATTACHMENT_BYTES) {
    return 'File exceeds 2 MB limit for browser storage. Please compress or upload a smaller file.';
  }
  return null;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Failed to read selected file.'));
    reader.readAsDataURL(file);
  });
}
