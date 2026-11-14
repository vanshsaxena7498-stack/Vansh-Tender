import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInitialAttachmentSlots,
  EMD_DEFAULT_SLOT_LABELS,
  extractSavedAttachments,
  formatFileSize,
  MAX_ATTACHMENT_BYTES,
  TENDER_DEFAULT_SLOT_LABELS,
  validateAttachmentFileSize,
} from './attachments';
import type { AttachmentItem } from '../types/crm';

test('buildInitialAttachmentSlots always provides at least 3 slots for Tender and EMD/BG', () => {
  const tenderSlots = buildInitialAttachmentSlots(undefined, TENDER_DEFAULT_SLOT_LABELS);
  assert.equal(tenderSlots.length, 3);
  assert.ok(tenderSlots.every((s) => s.attachment === null));

  const emdSlots = buildInitialAttachmentSlots([], EMD_DEFAULT_SLOT_LABELS);
  assert.equal(emdSlots.length, 3);
});

test('buildInitialAttachmentSlots preserves existing attachments including extra slots beyond 3', () => {
  const mockItems: AttachmentItem[] = [1, 2, 3, 4].map((n) => ({
    id: `att-${n}`,
    slotLabel: `Doc ${n}`,
    fileName: `doc-${n}.pdf`,
    fileType: 'application/pdf',
    fileSize: 1024 * n,
    uploadedAt: '2026-11-13',
    dataUrl: `data:application/pdf;base64,ZmFrZQ==`,
  }));

  const slots = buildInitialAttachmentSlots(mockItems, TENDER_DEFAULT_SLOT_LABELS);
  assert.equal(slots.length, 4);
  const extracted = extractSavedAttachments(slots);
  assert.equal(extracted.length, 4);
  assert.equal(extracted[3].fileName, 'doc-4.pdf');
});

test('validateAttachmentFileSize and formatFileSize work cleanly', () => {
  assert.equal(validateAttachmentFileSize(0), 'Selected file appears to be empty.');
  assert.equal(validateAttachmentFileSize(500 * 1024), null);
  assert.ok(validateAttachmentFileSize(MAX_ATTACHMENT_BYTES + 1) !== null);
  assert.equal(formatFileSize(1536), '1.5 KB');
  assert.equal(formatFileSize(1024 * 1024), '1.00 MB');
});
