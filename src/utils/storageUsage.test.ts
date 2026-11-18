import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FIRM_PROFILE,
  SEED_EMD_RECORDS,
  SEED_MAF_TRACKERS,
  SEED_TENDERS,
} from '../data/seedData';
import { DEFAULT_GOOGLE_SHEET_SETTINGS } from './googleSheetSync';
import {
  estimateCloudStorageUsage,
  FIRESTORE_FREE_QUOTA_BYTES,
  formatStorageSize,
} from './storageUsage';
import { DEFAULT_WHATSAPP_SETTINGS } from './whatsappAlerts';

test('formatStorageSize formats bytes, KB, MB, and GB cleanly', () => {
  assert.equal(formatStorageSize(0), '0 B');
  assert.equal(formatStorageSize(512), '512 B');
  assert.equal(formatStorageSize(2048), '2.0 KB');
  assert.equal(formatStorageSize(5 * 1024 * 1024), '5.00 MB');
  assert.equal(formatStorageSize(1024 * 1024 * 1024), '1.000 GB');
});

test('estimateCloudStorageUsage accurately computes seed dataset below 1 MB', () => {
  const result = estimateCloudStorageUsage({
    ownerUid: 'uid-test-1',
    profile: DEFAULT_FIRM_PROFILE,
    preferences: { adminPin: '1234', darkMode: false },
    tenders: SEED_TENDERS,
    emdRecords: SEED_EMD_RECORDS,
    mafTrackers: SEED_MAF_TRACKERS,
    whatsappSettings: DEFAULT_WHATSAPP_SETTINGS,
    whatsappLogs: [],
    sheetSettings: DEFAULT_GOOGLE_SHEET_SETTINGS,
  });

  assert.equal(result.quotaBytes, FIRESTORE_FREE_QUOTA_BYTES);
  assert.equal(result.statusLevel, 'healthy');
  assert.ok(result.totalBytes > 5000 && result.totalBytes < 1024 * 1024);
  assert.ok(result.usagePercent < 0.1);
  assert.equal(result.firestoreAttachmentCount, 0);
  assert.equal(result.externalStorageFileCount, 6);
  assert.equal(result.categories.length, 5);
});

test('estimateCloudStorageUsage includes deduplicated Firestore attachments and tracks external Storage PDFs separately', () => {
  const fakePdfDataUrl = `data:application/pdf;base64,${'A'.repeat(400_000)}`;
  const tenderWithAttachment = {
    ...SEED_TENDERS[0],
    attachments: [
      {
        id: 'att-nit-1',
        slotLabel: 'Attachment 1 · NIT',
        fileName: 'nit.pdf',
        fileType: 'application/pdf',
        fileSize: 300_000,
        uploadedAt: '2026-11-18T00:00:00.000Z',
        dataUrl: '', // Hydrated via attachmentFiles map
      },
    ],
  };

  const mafWithExternalUrl = {
    ...SEED_MAF_TRACKERS[0],
    itemsMAF: [
      {
        ...SEED_MAF_TRACKERS[0].itemsMAF[0],
        mafDocumentUrl: 'https://firebasestorage.googleapis.com/v0/b/test/o/maf.pdf',
        mafDocumentName: 'large-maf.pdf',
      },
    ],
  };

  const result = estimateCloudStorageUsage({
    ownerUid: 'uid-test-2',
    profile: DEFAULT_FIRM_PROFILE,
    preferences: { adminPin: '1234', darkMode: false },
    tenders: [tenderWithAttachment],
    emdRecords: [],
    mafTrackers: [mafWithExternalUrl],
    whatsappSettings: DEFAULT_WHATSAPP_SETTINGS,
    whatsappLogs: [],
    sheetSettings: DEFAULT_GOOGLE_SHEET_SETTINGS,
    attachmentFiles: new Map([['att-nit-1', fakePdfDataUrl]]),
  });

  assert.equal(result.firestoreAttachmentCount, 1);
  assert.equal(result.externalStorageFileCount, 1);
  const attCat = result.categories.find((c) => c.key === 'attachments');
  assert.ok(attCat);
  assert.equal(attCat.docCount, 1);
  assert.ok(attCat.bytes > 400_000);
  assert.ok(result.totalBytes > 400_000);
});
