import type {
  AttachmentItem,
  EmdBgRecord,
  FirmProfile,
  Tender,
  UserPreferences,
} from '../types/crm';

export const CLOUD_LIMITS = {
  ID_MAX: 128,
  TENDER_ID_MAX: 120,
  DEPARTMENT_MAX: 200,
  LOCATION_MAX: 120,
  CATEGORY_MAX: 120,
  TITLE_MAX: 300,
  DATE_MAX: 32,
  CLIENT_ISO_MAX: 40,
  RESULT_INFO_MAX: 1000,
  REMARKS_TEXT_MAX: 1000,
  FIRM_NAME_MAX: 150,
  GSTIN_MAX: 32,
  UDYAM_MAX: 40,
  ADMIN_NAME_MAX: 100,
  PHOTO_URL_MAX: 145000,
  ATTACHMENT_DATA_URL_MAX: 950000,
  CHECKLIST_MAX: 30,
  REMARKS_LIST_MAX: 100,
  ATTACHMENTS_LIST_MAX: 10,
} as const;

function clampStr(val: string | undefined | null, maxLen: number, fallback = ''): string {
  const normalized = typeof val === 'string' ? val : fallback;
  return normalized.slice(0, maxLen);
}

function clampNonNegativeNumber(val: unknown): number {
  const num = typeof val === 'number' && Number.isFinite(val) ? val : Number(val);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num;
}

export function sanitizeDocId(rawId: string): string {
  const cleaned = (rawId || '')
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .slice(0, CLOUD_LIMITS.ID_MAX);
  return cleaned.length > 0 ? cleaned : `doc_${Date.now()}`;
}

export function sanitizePhotoForCloud(photoUrl: string | undefined): string {
  if (!photoUrl || typeof photoUrl !== 'string') return '';
  return photoUrl.length <= CLOUD_LIMITS.PHOTO_URL_MAX ? photoUrl : '';
}

/**
 * Strips heavy dataUrl from Tender/EmdBgRecord attachment metadata so parent
 * documents stay compact; binary payloads live in /users/{uid}/attachmentFiles/{id}.
 */
export function sanitizeAttachmentMetadataForCloud(att: AttachmentItem): AttachmentItem {
  return {
    id: sanitizeDocId(att.id),
    slotLabel: clampStr(att.slotLabel, 80, 'Attachment'),
    fileName: clampStr(att.fileName, 200, 'file'),
    fileType: clampStr(att.fileType, 120, 'application/octet-stream'),
    fileSize: clampNonNegativeNumber(att.fileSize),
    uploadedAt: clampStr(att.uploadedAt, 40),
    dataUrl: '',
  };
}

export function buildCloudAttachmentFilePayload<TTime>(
  att: AttachmentItem,
  ownerUid: string,
  serverTimeToken: TTime,
  existingCreatedAt?: unknown,
): Record<string, unknown> | null {
  if (!att.dataUrl || att.dataUrl.length > CLOUD_LIMITS.ATTACHMENT_DATA_URL_MAX) {
    return null;
  }
  const safeId = sanitizeDocId(att.id);
  return {
    ownerUid: sanitizeDocId(ownerUid),
    id: safeId,
    fileName: clampStr(att.fileName.trim() || 'attachment', 200),
    fileType: clampStr(att.fileType.trim() || 'application/octet-stream', 120),
    fileSize: clampNonNegativeNumber(att.fileSize),
    dataUrl: att.dataUrl,
    createdAt: existingCreatedAt ?? serverTimeToken,
    updatedAt: serverTimeToken,
  };
}

export function buildCloudPreferencesPayload<TTime>(
  prefs: UserPreferences,
  ownerUid: string,
  serverTimeToken: TTime,
  existingCreatedAt?: unknown,
): Record<string, unknown> {
  const safePin = /^\d{4}$/.test(prefs.adminPin) ? prefs.adminPin : '1234';
  return {
    ownerUid: sanitizeDocId(ownerUid),
    adminPin: safePin,
    darkMode: Boolean(prefs.darkMode),
    createdAt: existingCreatedAt ?? serverTimeToken,
    updatedAt: serverTimeToken,
  };
}

export function buildCloudProfilePayload<TTime>(
  profile: FirmProfile,
  ownerUid: string,
  serverTimeToken: TTime,
  existingCreatedAt?: unknown,
): Record<string, unknown> {
  return {
    ownerUid: sanitizeDocId(ownerUid),
    firmName: clampStr(profile.firmName.trim() || 'Corporate Tender Desk', CLOUD_LIMITS.FIRM_NAME_MAX),
    gstin: clampStr(profile.gstin, CLOUD_LIMITS.GSTIN_MAX),
    udyamNumber: clampStr(profile.udyamNumber, CLOUD_LIMITS.UDYAM_MAX),
    adminName: clampStr(profile.adminName.trim() || 'Vansh Saxena', CLOUD_LIMITS.ADMIN_NAME_MAX),
    adminPhotoUrl: sanitizePhotoForCloud(profile.adminPhotoUrl),
    createdAt: existingCreatedAt ?? serverTimeToken,
    updatedAt: serverTimeToken,
  };
}

export function buildCloudTenderPayload<TTime>(
  tender: Tender,
  ownerUid: string,
  serverTimeToken: TTime,
  existingCreatedAt?: unknown,
): Record<string, unknown> {
  const safeId = sanitizeDocId(tender.id);
  return {
    ownerUid: sanitizeDocId(ownerUid),
    id: safeId,
    tenderId: clampStr(tender.tenderId.trim() || safeId, CLOUD_LIMITS.TENDER_ID_MAX),
    portal: tender.portal,
    department: clampStr(tender.department.trim() || 'Department', CLOUD_LIMITS.DEPARTMENT_MAX),
    location: clampStr(tender.location, CLOUD_LIMITS.LOCATION_MAX),
    category: clampStr(tender.category, CLOUD_LIMITS.CATEGORY_MAX),
    title: clampStr(tender.title.trim() || 'Untitled Tender', CLOUD_LIMITS.TITLE_MAX),
    publishDate: clampStr(tender.publishDate, CLOUD_LIMITS.DATE_MAX),
    submissionDueDate: clampStr(
      tender.submissionDueDate.trim() || new Date().toISOString().slice(0, 16),
      CLOUD_LIMITS.DATE_MAX,
    ),
    preBidDate: clampStr(tender.preBidDate, CLOUD_LIMITS.DATE_MAX),
    estimatedValue: clampNonNegativeNumber(tender.estimatedValue),
    quotedValue: clampNonNegativeNumber(tender.quotedValue),
    emdStatus: tender.emdStatus,
    emdAmount: clampNonNegativeNumber(tender.emdAmount),
    stage: tender.stage,
    resultInfo: clampStr(tender.resultInfo, CLOUD_LIMITS.RESULT_INFO_MAX),
    completionDate: clampStr(tender.completionDate, CLOUD_LIMITS.DATE_MAX),
    checklist: (tender.checklist ?? []).slice(0, CLOUD_LIMITS.CHECKLIST_MAX).map((item) => ({
      id: clampStr(item.id, 80),
      label: clampStr(item.label, 160),
      checked: Boolean(item.checked),
    })),
    remarks: (tender.remarks ?? []).slice(0, CLOUD_LIMITS.REMARKS_LIST_MAX).map((r) => ({
      id: clampStr(r.id, 80),
      timestamp: clampStr(r.timestamp, 40),
      text: clampStr(r.text, 500),
    })),
    attachments: (tender.attachments ?? [])
      .slice(0, CLOUD_LIMITS.ATTACHMENTS_LIST_MAX)
      .map(sanitizeAttachmentMetadataForCloud),
    clientCreatedAt: clampStr(tender.createdAt, CLOUD_LIMITS.CLIENT_ISO_MAX),
    clientUpdatedAt: clampStr(tender.updatedAt, CLOUD_LIMITS.CLIENT_ISO_MAX),
    createdAt: existingCreatedAt ?? serverTimeToken,
    updatedAt: serverTimeToken,
  };
}

export function buildCloudEmdPayload<TTime>(
  record: EmdBgRecord,
  ownerUid: string,
  serverTimeToken: TTime,
  existingCreatedAt?: unknown,
): Record<string, unknown> {
  const safeId = sanitizeDocId(record.id);
  return {
    ownerUid: sanitizeDocId(ownerUid),
    id: safeId,
    tenderRefId: clampStr(record.tenderRefId, CLOUD_LIMITS.ID_MAX),
    tenderId: clampStr(record.tenderId.trim() || safeId, CLOUD_LIMITS.TENDER_ID_MAX),
    department: clampStr(record.department.trim() || 'Department', CLOUD_LIMITS.DEPARTMENT_MAX),
    instrumentType: record.instrumentType,
    referenceNo: clampStr(record.referenceNo.trim() || safeId, CLOUD_LIMITS.TENDER_ID_MAX),
    bankName: clampStr(record.bankName.trim() || 'Bank', 150),
    amount: clampNonNegativeNumber(record.amount),
    issueDate: clampStr(record.issueDate, CLOUD_LIMITS.DATE_MAX),
    expiryDate: clampStr(record.expiryDate, CLOUD_LIMITS.DATE_MAX),
    claimEndDate: clampStr(record.claimEndDate, CLOUD_LIMITS.DATE_MAX),
    status: record.status,
    refundDate: clampStr(record.refundDate, CLOUD_LIMITS.DATE_MAX),
    refundRef: clampStr(record.refundRef, 120),
    remarks: clampStr(record.remarks, CLOUD_LIMITS.REMARKS_TEXT_MAX),
    attachments: (record.attachments ?? [])
      .slice(0, CLOUD_LIMITS.ATTACHMENTS_LIST_MAX)
      .map(sanitizeAttachmentMetadataForCloud),
    createdAt: existingCreatedAt ?? serverTimeToken,
    updatedAt: serverTimeToken,
  };
}

export function mergeAttachmentMapWithItems(
  attachments: AttachmentItem[] | undefined,
  fileDataMap: ReadonlyMap<string, string>,
  fallbackList?: AttachmentItem[],
): AttachmentItem[] {
  const list = attachments ?? [];
  const fallbackById = new Map((fallbackList ?? []).map((item) => [item.id, item]));
  return list.map((att) => {
    if (att.dataUrl) return att;
    const fromCloudFiles = fileDataMap.get(att.id) ?? fileDataMap.get(sanitizeDocId(att.id));
    if (fromCloudFiles) return { ...att, dataUrl: fromCloudFiles };
    const fromFallback = fallbackById.get(att.id);
    if (fromFallback?.dataUrl) return { ...att, dataUrl: fromFallback.dataUrl };
    return att;
  });
}

export function mergeCloudProfileWithLocal(
  cloudProfile: FirmProfile,
  currentProfile: FirmProfile,
): FirmProfile {
  return {
    firmName: cloudProfile.firmName || currentProfile.firmName,
    gstin: cloudProfile.gstin ?? currentProfile.gstin,
    udyamNumber: cloudProfile.udyamNumber ?? currentProfile.udyamNumber,
    adminName: cloudProfile.adminName || currentProfile.adminName,
    adminPhotoUrl: cloudProfile.adminPhotoUrl || currentProfile.adminPhotoUrl || '',
  };
}

export function mergeCloudTendersWithFiles(
  cloudTenders: Tender[],
  fileDataMap: ReadonlyMap<string, string>,
  currentTenders: Tender[],
): Tender[] {
  const currentById = new Map(currentTenders.map((t) => [t.id, t]));
  return cloudTenders.map((t) => ({
    ...t,
    attachments: mergeAttachmentMapWithItems(
      t.attachments,
      fileDataMap,
      currentById.get(t.id)?.attachments,
    ),
  }));
}

export function mergeCloudEmdWithFiles(
  cloudEmd: EmdBgRecord[],
  fileDataMap: ReadonlyMap<string, string>,
  currentEmd: EmdBgRecord[],
): EmdBgRecord[] {
  const currentById = new Map(currentEmd.map((r) => [r.id, r]));
  return cloudEmd.map((r) => ({
    ...r,
    attachments: mergeAttachmentMapWithItems(
      r.attachments,
      fileDataMap,
      currentById.get(r.id)?.attachments,
    ),
  }));
}
