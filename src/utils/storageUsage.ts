import type {
  EmailAlertLog,
  EmailAlertSettings,
  EmdBgRecord,
  FirmProfile,
  GoogleSheetSettings,
  MafTrackerRecord,
  Tender,
  UserPreferences,
} from '../types/crm';
import {
  buildCloudAttachmentFilePayload,
  buildCloudEmailAlertLogPayload,
  buildCloudEmailConfigPayload,
  buildCloudEmdPayload,
  buildCloudMafTrackerPayload,
  buildCloudPreferencesPayload,
  buildCloudProfilePayload,
  buildCloudSheetConfigPayload,
  buildCloudTenderPayload,
  sanitizeDocId,
} from './cloudSyncHelpers';

export const FIRESTORE_FREE_QUOTA_BYTES = 1024 * 1024 * 1024; // 1 GiB (1,024 MiB)
const FIRESTORE_DOC_OVERHEAD_BYTES = 160;
const SAMPLE_ISO_TIMESTAMP = '2026-01-01T00:00:00.000Z';

const utf8Encoder = new TextEncoder();

function measureJsonBytes(payload: unknown): number {
  const json = JSON.stringify(payload);
  return utf8Encoder.encode(json).length + FIRESTORE_DOC_OVERHEAD_BYTES;
}

export function formatStorageSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(3)} GB`;
}

export interface StorageCategorySummary {
  key: 'attachments' | 'tenders' | 'emd' | 'maf' | 'system';
  label: string;
  docCount: number;
  bytes: number;
  percentOfUsed: number;
}

export interface CloudStorageSummary {
  totalBytes: number;
  quotaBytes: number;
  remainingBytes: number;
  usagePercent: number;
  totalDocs: number;
  firestoreAttachmentCount: number;
  externalStorageFileCount: number;
  categories: StorageCategorySummary[];
  statusLevel: 'healthy' | 'warning' | 'critical';
}

export interface EstimateCloudStorageInput {
  ownerUid?: string;
  profile: FirmProfile;
  preferences: UserPreferences;
  tenders: Tender[];
  emdRecords: EmdBgRecord[];
  mafTrackers: MafTrackerRecord[];
  emailSettings: EmailAlertSettings;
  emailLogs: EmailAlertLog[];
  sheetSettings: GoogleSheetSettings;
  attachmentFiles?: ReadonlyMap<string, string>;
}

export function estimateCloudStorageUsage(
  input: EstimateCloudStorageInput,
): CloudStorageSummary {
  const ownerUid = sanitizeDocId(input.ownerUid || 'workspace_user');

  // 1. Tenders
  let tenderBytes = 0;
  for (const tender of input.tenders) {
    tenderBytes += measureJsonBytes(
      buildCloudTenderPayload(tender, ownerUid, SAMPLE_ISO_TIMESTAMP, SAMPLE_ISO_TIMESTAMP),
    );
  }

  // 2. EMD / BG Records
  let emdBytes = 0;
  for (const record of input.emdRecords) {
    emdBytes += measureJsonBytes(
      buildCloudEmdPayload(record, ownerUid, SAMPLE_ISO_TIMESTAMP, SAMPLE_ISO_TIMESTAMP),
    );
  }

  // 3. MAF Trackers (plus detect external Firebase Storage PDFs)
  let mafBytes = 0;
  let externalStorageFileCount = 0;
  const externalSeenKeys = new Set<string>();

  for (const tracker of input.mafTrackers) {
    mafBytes += measureJsonBytes(
      buildCloudMafTrackerPayload(tracker, ownerUid, SAMPLE_ISO_TIMESTAMP, SAMPLE_ISO_TIMESTAMP),
    );
    for (const item of tracker.itemsMAF ?? []) {
      const docUrl = (item.mafDocumentUrl || '').trim();
      if (docUrl.startsWith('http://') || docUrl.startsWith('https://')) {
        const key = `${tracker.id}:${item.itemId}:${docUrl}`;
        if (!externalSeenKeys.has(key)) {
          externalSeenKeys.add(key);
          externalStorageFileCount += 1;
        }
      }
    }
  }

  // 4. Attachments stored in Firestore (/users/{uid}/attachmentFiles/{id})
  const attachmentDocPayloads = new Map<string, Record<string, unknown>>();

  const registerAttachment = (meta: {
    id: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    dataUrl: string;
  }) => {
    const safeId = sanitizeDocId(meta.id);
    if (!meta.dataUrl) return;
    const payload = buildCloudAttachmentFilePayload(
      {
        id: safeId,
        slotLabel: 'Attachment',
        fileName: meta.fileName || 'attachment',
        fileType: meta.fileType || 'application/octet-stream',
        fileSize: meta.fileSize || 0,
        uploadedAt: SAMPLE_ISO_TIMESTAMP,
        dataUrl: meta.dataUrl,
      },
      ownerUid,
      SAMPLE_ISO_TIMESTAMP,
      SAMPLE_ISO_TIMESTAMP,
    );
    if (payload) {
      attachmentDocPayloads.set(safeId, payload);
    }
  };

  for (const tender of input.tenders) {
    for (const att of tender.attachments ?? []) {
      const safeId = sanitizeDocId(att.id);
      const dataUrl =
        att.dataUrl ||
        input.attachmentFiles?.get(att.id) ||
        input.attachmentFiles?.get(safeId) ||
        '';
      registerAttachment({
        id: safeId,
        fileName: att.fileName,
        fileType: att.fileType,
        fileSize: att.fileSize,
        dataUrl,
      });
    }
  }

  for (const record of input.emdRecords) {
    for (const att of record.attachments ?? []) {
      const safeId = sanitizeDocId(att.id);
      const dataUrl =
        att.dataUrl ||
        input.attachmentFiles?.get(att.id) ||
        input.attachmentFiles?.get(safeId) ||
        '';
      registerAttachment({
        id: safeId,
        fileName: att.fileName,
        fileType: att.fileType,
        fileSize: att.fileSize,
        dataUrl,
      });
    }
  }

  for (const tracker of input.mafTrackers) {
    for (const item of tracker.itemsMAF ?? []) {
      if (!item.mafAttachmentId) continue;
      const safeId = sanitizeDocId(item.mafAttachmentId);
      const inlineDataUrl = item.mafDocumentUrl?.startsWith('data:') ? item.mafDocumentUrl : '';
      const dataUrl =
        inlineDataUrl ||
        input.attachmentFiles?.get(item.mafAttachmentId) ||
        input.attachmentFiles?.get(safeId) ||
        '';
      registerAttachment({
        id: safeId,
        fileName: item.mafDocumentName || `${item.itemName || 'MAF'}.pdf`,
        fileType: 'application/pdf',
        fileSize: Math.floor((dataUrl.length * 3) / 4),
        dataUrl,
      });
    }
  }

  // Include any remaining attachmentFiles in cache/Firestore not currently linked in active state
  if (input.attachmentFiles) {
    for (const [rawId, dataUrl] of input.attachmentFiles.entries()) {
      const safeId = sanitizeDocId(rawId);
      if (attachmentDocPayloads.has(safeId) || !dataUrl) continue;
      registerAttachment({
        id: safeId,
        fileName: 'cloud-attachment',
        fileType: 'application/octet-stream',
        fileSize: Math.floor((dataUrl.length * 3) / 4),
        dataUrl,
      });
    }
  }

  let attachmentBytes = 0;
  for (const payload of attachmentDocPayloads.values()) {
    attachmentBytes += measureJsonBytes(payload);
  }

  // 5. Profile, Preferences, Email Alert Settings/Logs & Sheet Config
  let systemBytes = 0;
  let systemDocs = 5; // root user doc + profile + preferences + emailConfig + sheetConfig

  systemBytes += measureJsonBytes({
    ownerUid,
    email: 'user@example.com',
    createdAt: SAMPLE_ISO_TIMESTAMP,
    updatedAt: SAMPLE_ISO_TIMESTAMP,
  });
  systemBytes += measureJsonBytes(
    buildCloudProfilePayload(input.profile, ownerUid, SAMPLE_ISO_TIMESTAMP, SAMPLE_ISO_TIMESTAMP),
  );
  systemBytes += measureJsonBytes(
    buildCloudPreferencesPayload(
      input.preferences,
      ownerUid,
      SAMPLE_ISO_TIMESTAMP,
      SAMPLE_ISO_TIMESTAMP,
    ),
  );
  systemBytes += measureJsonBytes(
    buildCloudEmailConfigPayload(
      input.emailSettings,
      ownerUid,
      SAMPLE_ISO_TIMESTAMP,
      SAMPLE_ISO_TIMESTAMP,
    ),
  );
  systemBytes += measureJsonBytes(
    buildCloudSheetConfigPayload(
      input.sheetSettings,
      ownerUid,
      SAMPLE_ISO_TIMESTAMP,
      SAMPLE_ISO_TIMESTAMP,
    ),
  );

  for (const log of input.emailLogs) {
    systemDocs += 1;
    systemBytes += measureJsonBytes(
      buildCloudEmailAlertLogPayload(log, ownerUid, SAMPLE_ISO_TIMESTAMP, SAMPLE_ISO_TIMESTAMP),
    );
  }

  const totalBytes = attachmentBytes + tenderBytes + emdBytes + mafBytes + systemBytes;
  const totalDocs =
    attachmentDocPayloads.size +
    input.tenders.length +
    input.emdRecords.length +
    input.mafTrackers.length +
    systemDocs;

  const usagePercent = Math.min(100, (totalBytes / FIRESTORE_FREE_QUOTA_BYTES) * 100);
  const remainingBytes = Math.max(0, FIRESTORE_FREE_QUOTA_BYTES - totalBytes);

  const rawCategories: Array<Omit<StorageCategorySummary, 'percentOfUsed'>> = [
    {
      key: 'attachments',
      label: 'Attachments',
      docCount: attachmentDocPayloads.size,
      bytes: attachmentBytes,
    },
    {
      key: 'tenders',
      label: 'Daily Tenders',
      docCount: input.tenders.length,
      bytes: tenderBytes,
    },
    {
      key: 'emd',
      label: 'EMD & BG Records',
      docCount: input.emdRecords.length,
      bytes: emdBytes,
    },
    {
      key: 'maf',
      label: 'MAF Tracker',
      docCount: input.mafTrackers.length,
      bytes: mafBytes,
    },
    {
      key: 'system',
      label: 'Alerts & Configs',
      docCount: systemDocs,
      bytes: systemBytes,
    },
  ];

  const categories: StorageCategorySummary[] = rawCategories.map((cat) => ({
    ...cat,
    percentOfUsed: totalBytes > 0 ? (cat.bytes / totalBytes) * 100 : 0,
  }));

  const statusLevel: CloudStorageSummary['statusLevel'] =
    usagePercent >= 90 ? 'critical' : usagePercent >= 70 ? 'warning' : 'healthy';

  return {
    totalBytes,
    quotaBytes: FIRESTORE_FREE_QUOTA_BYTES,
    remainingBytes,
    usagePercent,
    totalDocs,
    firestoreAttachmentCount: attachmentDocPayloads.size,
    externalStorageFileCount,
    categories,
    statusLevel,
  };
}
