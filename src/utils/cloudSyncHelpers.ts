import type { AttachmentItem, EmdBgRecord, FirmProfile, Tender } from '../types/crm';

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
  PHOTO_URL_MAX: 140000,
  ATTACHMENT_DATA_URL_MAX: 90000,
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

export function sanitizeAttachmentForCloud(att: AttachmentItem): AttachmentItem {
  const keepDataUrl =
    typeof att.dataUrl === 'string' && att.dataUrl.length <= CLOUD_LIMITS.ATTACHMENT_DATA_URL_MAX
      ? att.dataUrl
      : '';
  return {
    id: sanitizeDocId(att.id),
    slotLabel: clampStr(att.slotLabel, 80, 'Attachment'),
    fileName: clampStr(att.fileName, 200, 'file'),
    fileType: clampStr(att.fileType, 120, 'application/octet-stream'),
    fileSize: clampNonNegativeNumber(att.fileSize),
    uploadedAt: clampStr(att.uploadedAt, 40),
    dataUrl: keepDataUrl,
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
      .map(sanitizeAttachmentForCloud),
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
      .map(sanitizeAttachmentForCloud),
    createdAt: existingCreatedAt ?? serverTimeToken,
    updatedAt: serverTimeToken,
  };
}

export function mergeCloudAttachmentsWithLocal(
  cloudAttachments: AttachmentItem[] | undefined,
  localAttachments: AttachmentItem[] | undefined,
): AttachmentItem[] {
  const cloudList = cloudAttachments ?? [];
  const localById = new Map((localAttachments ?? []).map((item) => [item.id, item]));
  return cloudList.map((att) => {
    if (att.dataUrl) return att;
    const localMatch = localById.get(att.id);
    if (localMatch?.dataUrl) {
      return { ...att, dataUrl: localMatch.dataUrl };
    }
    return att;
  });
}

export function mergeCloudProfileWithLocal(
  cloudProfile: FirmProfile,
  localProfile: FirmProfile,
): FirmProfile {
  return {
    firmName: cloudProfile.firmName || localProfile.firmName,
    gstin: cloudProfile.gstin ?? localProfile.gstin,
    udyamNumber: cloudProfile.udyamNumber ?? localProfile.udyamNumber,
    adminName: cloudProfile.adminName || localProfile.adminName,
    adminPhotoUrl: cloudProfile.adminPhotoUrl || localProfile.adminPhotoUrl || '',
  };
}

export function mergeCloudTendersWithLocal(
  cloudTenders: Tender[],
  localTenders: Tender[],
): Tender[] {
  const localById = new Map(localTenders.map((t) => [t.id, t]));
  return cloudTenders.map((t) => {
    const local = localById.get(t.id);
    return {
      ...t,
      attachments: mergeCloudAttachmentsWithLocal(t.attachments, local?.attachments),
    };
  });
}

export function mergeCloudEmdWithLocal(
  cloudEmd: EmdBgRecord[],
  localEmd: EmdBgRecord[],
): EmdBgRecord[] {
  const localById = new Map(localEmd.map((r) => [r.id, r]));
  return cloudEmd.map((r) => {
    const local = localById.get(r.id);
    return {
      ...r,
      attachments: mergeCloudAttachmentsWithLocal(r.attachments, local?.attachments),
    };
  });
}
