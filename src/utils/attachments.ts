import type { AttachmentItem } from '../types/crm';

export const MAX_ATTACHMENT_BYTES = 650 * 1024; // 650 KB binary (~887 KB base64, safely < 1 MiB Firestore doc limit)
export const MAX_PHOTO_BYTES = 100 * 1024; // 100 KB for compressed admin profile photo

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
    return 'File exceeds 650 KB cloud document limit. Please compress the file or upload a smaller copy.';
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

function estimateBase64Bytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}

export async function compressImageDataUrl(
  file: File,
  maxDimension: number,
  maxTargetChars: number,
): Promise<{ dataUrl: string; byteSize: number; fileType: string }> {
  const rawDataUrl = await readFileAsDataUrl(file);
  if (typeof document === 'undefined') {
    return { dataUrl: rawDataUrl, byteSize: file.size, fileType: file.type || 'image/jpeg' };
  }

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not decode image.'));
    el.src = rawDataUrl;
  });

  const scale = Math.min(1, maxDimension / Math.max(img.width || 1, img.height || 1));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { dataUrl: rawDataUrl, byteSize: file.size, fileType: file.type || 'image/jpeg' };
  }
  ctx.drawImage(img, 0, 0, width, height);

  let out = canvas.toDataURL('image/jpeg', 0.82);
  if (out.length > maxTargetChars) {
    out = canvas.toDataURL('image/jpeg', 0.62);
  }
  if (out.length > maxTargetChars) {
    out = canvas.toDataURL('image/jpeg', 0.45);
  }

  return {
    dataUrl: out,
    byteSize: estimateBase64Bytes(out),
    fileType: 'image/jpeg',
  };
}

export async function readAttachmentForFirestore(
  file: File,
): Promise<{ dataUrl: string; fileSize: number; fileType: string }> {
  const isCompressibleImage =
    file.type.startsWith('image/') && file.type !== 'image/svg+xml' && file.type !== 'image/gif';

  if (isCompressibleImage) {
    const compressed = await compressImageDataUrl(file, 1600, 880000);
    if (compressed.dataUrl.length > 940000) {
      throw new Error(
        'Compressed image still exceeds Firestore 1 MiB limit. Please upload a smaller image.',
      );
    }
    return {
      dataUrl: compressed.dataUrl,
      fileSize: compressed.byteSize,
      fileType: compressed.fileType,
    };
  }

  const sizeErr = validateAttachmentFileSize(file.size);
  if (sizeErr) {
    throw new Error(sizeErr);
  }
  const dataUrl = await readFileAsDataUrl(file);
  if (dataUrl.length > 940000) {
    throw new Error(
      'Encoded file exceeds Firestore 1 MiB limit. Please upload a file under 650 KB.',
    );
  }
  return {
    dataUrl,
    fileSize: file.size,
    fileType: file.type || 'application/octet-stream',
  };
}

export async function compressProfilePhotoDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a valid image file (PNG, JPG, WEBP).');
  }
  const compressed = await compressImageDataUrl(file, 256, 135000);
  if (compressed.dataUrl.length > 145000) {
    throw new Error('Profile photo is too large even after compression. Choose a smaller image.');
  }
  return compressed.dataUrl;
}
