import type {
  AttachmentItem,
  EmdBgRecord,
  FirmProfile,
  MafLineItem,
  MafTrackerRecord,
  Tender,
  UserPreferences,
  WhatsAppAlertLog,
  WhatsAppSettings,
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
  MAF_ITEMS_MAX: 50,
  MAF_ITEM_NAME_MAX: 220,
  MAF_OEM_NAME_MAX: 150,
  MAF_CONTACT_MAX: 120,
  MAF_QTY_MAX: 60,
  MAF_URL_MAX: 2000,
  MAF_REMARKS_MAX: 500,
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

export function sanitizeMafLineItemForCloud(item: MafLineItem): MafLineItem {
  const rawUrl = typeof item.mafDocumentUrl === 'string' ? item.mafDocumentUrl.trim() : '';
  const safeUrl = rawUrl.startsWith('data:') ? '' : clampStr(rawUrl, CLOUD_LIMITS.MAF_URL_MAX);
  return {
    itemId: sanitizeDocId(item.itemId),
    itemName: clampStr(item.itemName.trim() || 'Item', CLOUD_LIMITS.MAF_ITEM_NAME_MAX),
    requiredQuantity: clampStr(item.requiredQuantity, CLOUD_LIMITS.MAF_QTY_MAX),
    oemName: clampStr(item.oemName.trim() || 'OEM', CLOUD_LIMITS.MAF_OEM_NAME_MAX),
    oemContact: clampStr(item.oemContact, CLOUD_LIMITS.MAF_CONTACT_MAX),
    mafStatus: item.mafStatus,
    validityDate: clampStr(item.validityDate, CLOUD_LIMITS.DATE_MAX),
    mafDocumentUrl: safeUrl,
    mafDocumentName: clampStr(item.mafDocumentName, 200),
    mafAttachmentId: item.mafAttachmentId ? sanitizeDocId(item.mafAttachmentId) : '',
    remarks: clampStr(item.remarks, CLOUD_LIMITS.MAF_REMARKS_MAX),
    updatedAt: clampStr(item.updatedAt, CLOUD_LIMITS.CLIENT_ISO_MAX),
  };
}

export function buildCloudMafTrackerPayload<TTime>(
  tracker: MafTrackerRecord,
  ownerUid: string,
  serverTimeToken: TTime,
  existingCreatedAt?: unknown,
): Record<string, unknown> {
  const safeId = sanitizeDocId(tracker.id);
  return {
    ownerUid: sanitizeDocId(ownerUid),
    id: safeId,
    tenderRefId: clampStr(tracker.tenderRefId, CLOUD_LIMITS.ID_MAX),
    tenderId: clampStr(tracker.tenderId.trim() || safeId, CLOUD_LIMITS.TENDER_ID_MAX),
    tenderTitle: clampStr(tracker.tenderTitle, CLOUD_LIMITS.TITLE_MAX),
    department: clampStr(tracker.department, CLOUD_LIMITS.DEPARTMENT_MAX),
    tenderDueDate: clampStr(tracker.tenderDueDate, CLOUD_LIMITS.DATE_MAX),
    itemsMAF: (tracker.itemsMAF ?? [])
      .slice(0, CLOUD_LIMITS.MAF_ITEMS_MAX)
      .map(sanitizeMafLineItemForCloud),
    clientCreatedAt: clampStr(tracker.createdAt, CLOUD_LIMITS.CLIENT_ISO_MAX),
    clientUpdatedAt: clampStr(tracker.updatedAt, CLOUD_LIMITS.CLIENT_ISO_MAX),
    createdAt: existingCreatedAt ?? serverTimeToken,
    updatedAt: serverTimeToken,
  };
}

export function mergeCloudMafTrackersWithFiles(
  cloudTrackers: MafTrackerRecord[],
  fileDataMap: ReadonlyMap<string, string>,
  currentTrackers: MafTrackerRecord[],
): MafTrackerRecord[] {
  const currentById = new Map(currentTrackers.map((t) => [t.id, t]));
  return cloudTrackers.map((tracker) => {
    const prevItemsById = new Map(
      (currentById.get(tracker.id)?.itemsMAF ?? []).map((it) => [it.itemId, it]),
    );
    return {
      ...tracker,
      itemsMAF: (tracker.itemsMAF ?? []).map((item) => {
        if (item.mafDocumentUrl) return item;
        if (item.mafAttachmentId) {
          const fromMap =
            fileDataMap.get(item.mafAttachmentId) ??
            fileDataMap.get(sanitizeDocId(item.mafAttachmentId));
          if (fromMap) {
            return { ...item, mafDocumentUrl: fromMap };
          }
        }
        const prevItem = prevItemsById.get(item.itemId);
        if (prevItem?.mafDocumentUrl && prevItem.mafDocumentUrl.startsWith('data:')) {
          return { ...item, mafDocumentUrl: prevItem.mafDocumentUrl };
        }
        return item;
      }),
    };
  });
}

export function buildCloudWhatsAppConfigPayload<TTime>(
  config: WhatsAppSettings,
  ownerUid: string,
  serverTimeToken: TTime,
  existingCreatedAt?: unknown,
): Record<string, unknown> {
  return {
    ownerUid: sanitizeDocId(ownerUid),
    enabled: Boolean(config.enabled),
    recipientName: clampStr(config.recipientName.trim() || 'Vansh', 100),
    recipientPhone: clampStr(config.recipientPhone.trim() || '9717690890', 20),
    createdAt: existingCreatedAt ?? serverTimeToken,
    updatedAt: serverTimeToken,
  };
}

export function buildCloudWhatsAppAlertLogPayload<TTime>(
  log: WhatsAppAlertLog,
  ownerUid: string,
  serverTimeToken: TTime,
  existingCreatedAt?: unknown,
): Record<string, unknown> {
  const safeId = sanitizeDocId(log.id);
  return {
    ownerUid: sanitizeDocId(ownerUid),
    id: safeId,
    milestoneKey: clampStr(log.milestoneKey || safeId, 150),
    tenderRefId: clampStr(log.tenderRefId, 128),
    tenderId: clampStr(log.tenderId || safeId, 120),
    milestone: log.milestone,
    recipientName: clampStr(log.recipientName || 'Vansh', 100),
    recipientPhone: clampStr(log.recipientPhone || '919717690890', 24),
    dueDateIso: clampStr(log.dueDateIso, 40),
    status: log.status,
    provider: clampStr(log.provider || 'manual_ready', 40),
    message: clampStr(log.message, 3000),
    clientCreatedAt: clampStr(log.createdAt || new Date().toISOString(), 40),
    createdAt: existingCreatedAt ?? serverTimeToken,
    updatedAt: serverTimeToken,
  };
}


