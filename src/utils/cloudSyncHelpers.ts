import type {
  AttachmentItem,
  EmailAlertLog,
  EmailAlertSettings,
  EmdBgRecord,
  FirmProfile,
  GoogleSheetSettings,
  MafLineItem,
  MafTrackerRecord,
  OemRecord,
  Tender,
  UserPreferences,
} from '../types/crm';
import { isSafeHttpUrl } from './mafCalculations.ts';

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
  BIDRA_STATUS_MAX: 80,
  BIDRA_REMARKS_MAX: 1000,
  OWNER_NAME_MAX: 100,
  RANK_MAX: 40,
  PROJECT_ID_MAX: 128,
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
  MAF_PERSON_NAME_MAX: 120,
  MAF_PHONE_MAX: 40,
  MAF_EMAIL_MAX: 160,
  MAF_QTY_MAX: 60,
  MAF_URL_MAX: 2000,
  MAF_REMARKS_MAX: 500,
} as const;

const textEncoder = new TextEncoder();

export function utf8ByteLength(str: string): number {
  return textEncoder.encode(str).length;
}

function clampStr(val: string | undefined | null, maxBytes: number, fallback = ''): string {
  const normalized = typeof val === 'string' ? val : fallback;
  if (maxBytes <= 0 || normalized.length === 0) return '';
  if (utf8ByteLength(normalized) <= maxBytes) return normalized;

  // Fast trim by UTF-8 byte budget without splitting surrogate pairs
  let byteCount = 0;
  let endIndex = 0;
  for (const ch of normalized) {
    const chBytes = utf8ByteLength(ch);
    if (byteCount + chBytes > maxBytes) break;
    byteCount += chBytes;
    endIndex += ch.length;
  }
  return normalized.slice(0, endIndex);
}

function clampNonNegativeNumber(val: unknown): number {
  const num = typeof val === 'number' && Number.isFinite(val) ? val : Number(val);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num;
}

export function isFirestoreTimestampObject(val: unknown): boolean {
  if (!val || typeof val !== 'object') return false;
  const candidate = val as { toDate?: unknown; seconds?: unknown; nanoseconds?: unknown };
  if (typeof candidate.toDate === 'function') return true;
  return (
    typeof candidate.seconds === 'number' &&
    Number.isFinite(candidate.seconds) &&
    typeof candidate.nanoseconds === 'number' &&
    Number.isFinite(candidate.nanoseconds)
  );
}

export function pickValidExistingCreatedAt(val: unknown): unknown {
  return isFirestoreTimestampObject(val) ? val : undefined;
}

const VALID_PORTALS: ReadonlySet<Tender['portal']> = new Set([
  'GeM',
  'CPPP / eProcure',
  'State Portal',
  'PSU / Direct',
  'Private',
]);

export function normalizePortalForCloud(raw: unknown): Tender['portal'] {
  if (typeof raw === 'string') {
    const trimmed = raw.trim() as Tender['portal'];
    if (VALID_PORTALS.has(trimmed)) return trimmed;
    const lower = trimmed.toLowerCase();
    if (lower.includes('gem')) return 'GeM';
    if (lower.includes('cppp') || lower.includes('eprocure')) return 'CPPP / eProcure';
    if (lower.includes('state')) return 'State Portal';
    if (lower.includes('psu') || lower.includes('direct')) return 'PSU / Direct';
    if (lower.includes('private')) return 'Private';
  }
  return 'GeM';
}

const VALID_EMD_STATUSES: ReadonlySet<Tender['emdStatus']> = new Set([
  'Exempted - MSME/Startup',
  'EMD Paid',
  'BG Submitted',
  'No EMD',
]);

export function normalizeEmdStatusForCloud(raw: unknown): Tender['emdStatus'] {
  if (typeof raw === 'string') {
    const trimmed = raw.trim() as Tender['emdStatus'];
    if (VALID_EMD_STATUSES.has(trimmed)) return trimmed;
    const lower = trimmed.toLowerCase();
    if (lower.includes('exempt') || lower.includes('msme') || lower.includes('startup')) {
      return 'Exempted - MSME/Startup';
    }
    if (lower.includes('bg')) return 'BG Submitted';
    if (lower.includes('paid')) return 'EMD Paid';
    if (lower.includes('no') || lower.includes('nil') || lower.includes('na')) return 'No EMD';
  }
  return 'No EMD';
}

const VALID_TENDER_STAGES: ReadonlySet<Tender['stage']> = new Set([
  'Identified / Reviewing',
  'Doc Preparation',
  'Submitted',
  'Technical Eval',
  'Financial / BOQ Eval',
  'L1 / Won',
  'Lost (L2/L3)',
  'Cancelled / Retendered',
  'Tender Not Filled',
]);

export function normalizeTenderStageForCloud(raw: unknown): Tender['stage'] {
  if (typeof raw === 'string') {
    const trimmed = raw.trim() as Tender['stage'];
    if (VALID_TENDER_STAGES.has(trimmed)) return trimmed;
    const lower = trimmed.toLowerCase();
    if (lower.includes('l1') || lower.includes('won') || lower.includes('awarded')) return 'L1 / Won';
    if (lower.includes('lost') || lower.includes('l2') || lower.includes('l3')) return 'Lost (L2/L3)';
    if (lower.includes('cancel') || lower.includes('retender')) return 'Cancelled / Retendered';
    if (lower.includes('not filled') || lower.includes('dropped') || lower.includes('skip')) {
      return 'Tender Not Filled';
    }
    if (lower.includes('financial') || lower.includes('boq')) return 'Financial / BOQ Eval';
    if (lower.includes('technical')) return 'Technical Eval';
    if (lower.includes('submit')) return 'Submitted';
    if (lower.includes('prep')) return 'Doc Preparation';
  }
  return 'Identified / Reviewing';
}

const VALID_INSTRUMENT_TYPES: ReadonlySet<EmdBgRecord['instrumentType']> = new Set([
  'Online / NEFT / RTGS',
  'Demand Draft (DD)',
  'Bank Guarantee (PBG / Bid BG)',
  'FDR / TDR',
  'e-PBG',
]);

export function normalizeInstrumentTypeForCloud(raw: unknown): EmdBgRecord['instrumentType'] {
  if (typeof raw === 'string') {
    const trimmed = raw.trim() as EmdBgRecord['instrumentType'];
    if (VALID_INSTRUMENT_TYPES.has(trimmed)) return trimmed;
    const lower = trimmed.toLowerCase();
    if (lower.includes('e-pbg') || lower.includes('epbg')) return 'e-PBG';
    if (lower.includes('fdr') || lower.includes('tdr')) return 'FDR / TDR';
    if (lower.includes('bg') || lower.includes('guarantee')) return 'Bank Guarantee (PBG / Bid BG)';
    if (lower.includes('dd') || lower.includes('demand draft')) return 'Demand Draft (DD)';
  }
  return 'Online / NEFT / RTGS';
}

const VALID_FINANCIAL_STATUSES: ReadonlySet<EmdBgRecord['status']> = new Set([
  'Active / Locked',
  'Extension Requested',
  'Refund / Release Applied',
  'Refunded / Released',
  'Forfeited',
]);

export function normalizeFinancialStatusForCloud(raw: unknown): EmdBgRecord['status'] {
  if (typeof raw === 'string') {
    const trimmed = raw.trim() as EmdBgRecord['status'];
    if (VALID_FINANCIAL_STATUSES.has(trimmed)) return trimmed;
    const lower = trimmed.toLowerCase();
    if (lower.includes('forfeit')) return 'Forfeited';
    if (lower.includes('refunded') || lower.includes('released')) return 'Refunded / Released';
    if (lower.includes('applied')) return 'Refund / Release Applied';
    if (lower.includes('extension')) return 'Extension Requested';
  }
  return 'Active / Locked';
}

const VALID_EMAIL_SLOTS: ReadonlySet<EmailAlertLog['slot']> = new Set([
  'slot_11am',
  'slot_4pm',
  'manual',
  'test',
]);

export function normalizeEmailSlotForCloud(raw: unknown): EmailAlertLog['slot'] {
  if (typeof raw === 'string') {
    const trimmed = raw.trim() as EmailAlertLog['slot'];
    if (VALID_EMAIL_SLOTS.has(trimmed)) return trimmed;
  }
  return 'manual';
}

const VALID_EMAIL_STATUSES: ReadonlySet<EmailAlertLog['status']> = new Set(['sent', 'failed']);

export function normalizeEmailStatusForCloud(raw: unknown): EmailAlertLog['status'] {
  if (typeof raw === 'string') {
    const trimmed = raw.trim() as EmailAlertLog['status'];
    if (VALID_EMAIL_STATUSES.has(trimmed)) return trimmed;
  }
  return 'failed';
}

export function sanitizeDocId(rawId: string): string {
  const cleaned = (rawId || '')
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .slice(0, CLOUD_LIMITS.ID_MAX);
  return cleaned.length > 0 ? cleaned : `doc_${Date.now()}`;
}

export function sanitizePhotoForCloud(photoUrl: string | undefined): string {
  if (!photoUrl || typeof photoUrl !== 'string') return '';
  const trimmed = photoUrl.trim();
  if (utf8ByteLength(trimmed) > CLOUD_LIMITS.PHOTO_URL_MAX) return '';
  if (
    isSafeHttpUrl(trimmed) ||
    /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-zA-Z0-9+/=]+$/i.test(trimmed)
  ) {
    return trimmed;
  }
  return '';
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
  if (!att.dataUrl || utf8ByteLength(att.dataUrl) > CLOUD_LIMITS.ATTACHMENT_DATA_URL_MAX) {
    return null;
  }
  const safeId = sanitizeDocId(att.id);
  const safeFileName = clampStr((att.fileName || '').trim() || 'attachment', 200);
  const safeFileType = clampStr((att.fileType || '').trim() || 'application/octet-stream', 120);
  return {
    ownerUid: sanitizeDocId(ownerUid),
    id: safeId,
    fileName: safeFileName || 'attachment',
    fileType: safeFileType || 'application/octet-stream',
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
  const firmName = clampStr((profile.firmName || '').trim() || 'Corporate Tender Desk', CLOUD_LIMITS.FIRM_NAME_MAX);
  const adminName = clampStr((profile.adminName || '').trim() || 'Tender Desk User', CLOUD_LIMITS.ADMIN_NAME_MAX);
  return {
    ownerUid: sanitizeDocId(ownerUid),
    firmName: firmName || 'Corporate Tender Desk',
    gstin: clampStr(profile.gstin, CLOUD_LIMITS.GSTIN_MAX),
    udyamNumber: clampStr(profile.udyamNumber, CLOUD_LIMITS.UDYAM_MAX),
    adminName: adminName || 'Tender Desk User',
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
  const dept = clampStr((tender.department || '').trim() || 'Department', CLOUD_LIMITS.DEPARTMENT_MAX) || 'Department';
  const safeTenderId = clampStr((tender.tenderId || '').trim() || safeId, CLOUD_LIMITS.TENDER_ID_MAX) || safeId;
  const safeTitle = clampStr((tender.title || '').trim() || 'Untitled Tender', CLOUD_LIMITS.TITLE_MAX) || 'Untitled Tender';
  const safeDue =
    clampStr(
      (tender.submissionDueDate || '').trim() || new Date().toISOString().slice(0, 16),
      CLOUD_LIMITS.DATE_MAX,
    ) || new Date().toISOString().slice(0, 16);
  return {
    ownerUid: sanitizeDocId(ownerUid),
    id: safeId,
    tenderId: safeTenderId,
    portal: normalizePortalForCloud(tender.portal),
    clientName: clampStr((tender.clientName ?? '').trim() || dept, CLOUD_LIMITS.DEPARTMENT_MAX) || dept,
    department: dept,
    locationDepartment: clampStr((tender.locationDepartment ?? '').trim() || dept, CLOUD_LIMITS.DEPARTMENT_MAX),
    location: clampStr(tender.location, CLOUD_LIMITS.LOCATION_MAX),
    category: clampStr(tender.category, CLOUD_LIMITS.CATEGORY_MAX),
    title: safeTitle,
    publishDate: clampStr(tender.publishDate, CLOUD_LIMITS.DATE_MAX),
    submissionDueDate: safeDue,
    preBidDate: clampStr(tender.preBidDate, CLOUD_LIMITS.DATE_MAX),
    technicalOpeningDate: clampStr(tender.technicalOpeningDate, CLOUD_LIMITS.DATE_MAX),
    financialOpeningDate: clampStr(tender.financialOpeningDate, CLOUD_LIMITS.DATE_MAX),
    estimatedValue: clampNonNegativeNumber(tender.estimatedValue),
    quotedValue: clampNonNegativeNumber(tender.quotedValue),
    l1BidderName: clampStr(tender.l1BidderName, CLOUD_LIMITS.DEPARTMENT_MAX),
    l1QuotedValue: clampNonNegativeNumber(tender.l1QuotedValue),
    ourPositionRank: clampStr(tender.ourPositionRank, CLOUD_LIMITS.RANK_MAX),
    assignedOwner: clampStr(tender.assignedOwner, CLOUD_LIMITS.OWNER_NAME_MAX),
    emdStatus: normalizeEmdStatusForCloud(tender.emdStatus),
    emdAmount: clampNonNegativeNumber(tender.emdAmount),
    stage: normalizeTenderStageForCloud(tender.stage),
    resultInfo: clampStr(tender.resultInfo, CLOUD_LIMITS.RESULT_INFO_MAX),
    completionDate: clampStr(tender.completionDate, CLOUD_LIMITS.DATE_MAX),
    technicalStatus: clampStr(tender.technicalStatus, CLOUD_LIMITS.BIDRA_STATUS_MAX),
    technicalOpeningDateTime: clampStr(tender.technicalOpeningDateTime, CLOUD_LIMITS.DATE_MAX),
    technicalRemarks: clampStr(tender.technicalRemarks, CLOUD_LIMITS.BIDRA_REMARKS_MAX),
    financialRaStatus: clampStr(tender.financialRaStatus, CLOUD_LIMITS.BIDRA_STATUS_MAX),
    financialOpeningRaDateTime: clampStr(tender.financialOpeningRaDateTime, CLOUD_LIMITS.DATE_MAX),
    raFinalValue: clampNonNegativeNumber(tender.raFinalValue),
    raFinancialRemarks: clampStr(tender.raFinancialRemarks, CLOUD_LIMITS.BIDRA_REMARKS_MAX),
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
  const safeTenderId = clampStr((record.tenderId || '').trim() || safeId, CLOUD_LIMITS.TENDER_ID_MAX) || safeId;
  const safeDept = clampStr((record.department || '').trim() || 'Department', CLOUD_LIMITS.DEPARTMENT_MAX) || 'Department';
  const safeRef = clampStr((record.referenceNo || '').trim() || safeId, CLOUD_LIMITS.TENDER_ID_MAX) || safeId;
  const safeBank = clampStr((record.bankName || '').trim() || 'Bank', 150) || 'Bank';
  return {
    ownerUid: sanitizeDocId(ownerUid),
    id: safeId,
    tenderRefId: clampStr(record.tenderRefId, CLOUD_LIMITS.ID_MAX),
    tenderId: safeTenderId,
    department: safeDept,
    instrumentType: normalizeInstrumentTypeForCloud(record.instrumentType),
    referenceNo: safeRef,
    bankName: safeBank,
    amount: clampNonNegativeNumber(record.amount),
    issueDate: clampStr(record.issueDate, CLOUD_LIMITS.DATE_MAX),
    expiryDate: clampStr(record.expiryDate, CLOUD_LIMITS.DATE_MAX),
    claimEndDate: clampStr(record.claimEndDate, CLOUD_LIMITS.DATE_MAX),
    status: normalizeFinancialStatusForCloud(record.status),
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
  const safeUrl = isSafeHttpUrl(rawUrl) ? clampStr(rawUrl, CLOUD_LIMITS.MAF_URL_MAX) : '';
  const concernedPersonName = clampStr(item.concernedPersonName, CLOUD_LIMITS.MAF_PERSON_NAME_MAX);
  const contactNo = clampStr(item.contactNo, CLOUD_LIMITS.MAF_PHONE_MAX);
  const mailId = clampStr(item.mailId, CLOUD_LIMITS.MAF_EMAIL_MAX);
  const fallbackOemContact =
    item.oemContact ??
    ([concernedPersonName, contactNo].filter(Boolean).join(' · ') || '');
  return {
    itemId: sanitizeDocId(item.itemId),
    itemName: clampStr(item.itemName.trim() || 'Item', CLOUD_LIMITS.MAF_ITEM_NAME_MAX),
    requiredQuantity: clampStr(item.requiredQuantity, CLOUD_LIMITS.MAF_QTY_MAX),
    oemName: clampStr(item.oemName ? item.oemName.trim() : '', CLOUD_LIMITS.MAF_OEM_NAME_MAX),
    companyName: clampStr(item.companyName ? item.companyName.trim() : '', CLOUD_LIMITS.MAF_OEM_NAME_MAX),
    concernedPersonName,
    contactNo,
    mailId,
    oemContact: clampStr(fallbackOemContact, CLOUD_LIMITS.MAF_CONTACT_MAX),
    mafStatus: item.mafStatus,
    mafRequestedDate: clampStr(
      item.mafRequestedDate?.trim() || item.validityDate?.trim() || '',
      CLOUD_LIMITS.DATE_MAX,
    ),
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

export function buildCloudOemPayload<TTime>(
  oem: OemRecord,
  ownerUid: string,
  serverTimeToken: TTime,
  existingCreatedAt?: unknown,
): Record<string, unknown> {
  const safeId = sanitizeDocId(oem.id);
  return {
    ownerUid: sanitizeDocId(ownerUid),
    id: safeId,
    oemName: clampStr((oem.oemName || '').trim() || 'OEM', CLOUD_LIMITS.MAF_OEM_NAME_MAX),
    companyName: clampStr((oem.companyName || '').trim(), CLOUD_LIMITS.MAF_OEM_NAME_MAX),
    concernedPersonName: clampStr(
      (oem.concernedPersonName || '').trim(),
      CLOUD_LIMITS.MAF_PERSON_NAME_MAX,
    ),
    email: clampStr((oem.email || '').trim(), CLOUD_LIMITS.MAF_EMAIL_MAX),
    phone: clampStr((oem.phone || '').trim(), CLOUD_LIMITS.MAF_PHONE_MAX),
    remarks: clampStr((oem.remarks || '').trim(), CLOUD_LIMITS.MAF_REMARKS_MAX),
    clientCreatedAt: clampStr(oem.createdAt, CLOUD_LIMITS.CLIENT_ISO_MAX),
    clientUpdatedAt: clampStr(oem.updatedAt, CLOUD_LIMITS.CLIENT_ISO_MAX),
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

export function buildCloudEmailConfigPayload<TTime>(
  config: EmailAlertSettings,
  ownerUid: string,
  serverTimeToken: TTime,
  existingCreatedAt?: unknown,
): Record<string, unknown> {
  const safeName = clampStr((config.recipientName || '').trim() || 'Alert Recipient', 100) || 'Alert Recipient';
  const trimmedEmail = (config.recipientEmail || '').trim();
  const validLenEmail = trimmedEmail.length >= 5 ? trimmedEmail : 'alerts@example.com';
  const safeEmail = clampStr(validLenEmail, 160);
  return {
    ownerUid: sanitizeDocId(ownerUid),
    enabled: Boolean(config.enabled),
    recipientName: safeName,
    recipientEmail: utf8ByteLength(safeEmail) >= 5 ? safeEmail : 'alerts@example.com',
    createdAt: existingCreatedAt ?? serverTimeToken,
    updatedAt: serverTimeToken,
  };
}

export function buildCloudEmailAlertLogPayload<TTime>(
  log: EmailAlertLog,
  ownerUid: string,
  serverTimeToken: TTime,
  existingCreatedAt?: unknown,
): Record<string, unknown> {
  const safeId = sanitizeDocId(log.id);
  const safeSlotKey = clampStr((log.slotKey || '').trim() || safeId, 150) || safeId;
  const safeTenderId = clampStr((log.tenderId || '').trim() || safeId, 120) || safeId;
  return {
    ownerUid: sanitizeDocId(ownerUid),
    id: safeId,
    slotKey: safeSlotKey,
    tenderRefId: clampStr(log.tenderRefId, 128),
    tenderId: safeTenderId,
    slot: normalizeEmailSlotForCloud(log.slot),
    recipientName: clampStr((log.recipientName || '').trim() || 'Alert Recipient', 100),
    recipientEmail: clampStr((log.recipientEmail || '').trim() || 'alerts@example.com', 160),
    dueDateIso: clampStr(log.dueDateIso, 40),
    status: normalizeEmailStatusForCloud(log.status),
    provider: clampStr((log.provider || '').trim() || 'smtp', 40),
    subject: clampStr((log.subject || '').trim() || 'Tender Alert Notification', 240),
    message: clampStr(log.message, 4000),
    clientCreatedAt: clampStr((log.createdAt || '').trim() || new Date().toISOString(), 40),
    createdAt: existingCreatedAt ?? serverTimeToken,
    updatedAt: serverTimeToken,
  };
}

export function buildCloudSheetConfigPayload<TTime>(
  config: GoogleSheetSettings,
  ownerUid: string,
  serverTimeToken: TTime,
  existingCreatedAt?: unknown,
): Record<string, unknown> {
  const rawUrl = (config.webhookUrl || '').trim();
  const safeUrl = rawUrl.startsWith('https://') ? clampStr(rawUrl, 500) : '';
  const safeSheetName =
    clampStr((config.sheetName || '').trim() || 'MIS Monthly Report', 120) || 'MIS Monthly Report';
  return {
    ownerUid: sanitizeDocId(ownerUid),
    enabled: Boolean(config.enabled),
    webhookUrl: safeUrl,
    sheetName: safeSheetName,
    lastSyncedAt: clampStr(config.lastSyncedAt, 40),
    createdAt: existingCreatedAt ?? serverTimeToken,
    updatedAt: serverTimeToken,
  };
}

export function buildWorkspaceRootPayload<TTime>(
  params: {
    ownerUid: string;
    tenantId: string;
    username: string;
    email: string;
  },
  serverTimeToken: TTime,
  existingCreatedAt?: unknown,
): Record<string, unknown> {
  return {
    ownerUid: sanitizeDocId(params.ownerUid),
    tenantId: sanitizeDocId(params.tenantId),
    username: clampStr(params.username.trim() || 'User', 64),
    email: clampStr(params.email.trim().toLowerCase(), 160),
    createdAt: existingCreatedAt ?? serverTimeToken,
    updatedAt: serverTimeToken,
  };
}

export function buildSecondaryUserCloudPayload<TTime>(
  params: {
    ownerUid: string;
    userId: string;
    username: string;
    email: string;
    isActive?: boolean;
    isEnabled?: boolean;
    presenceStatus?: 'active' | 'not_active';
    lastHeartbeatAt?: string;
    lastLogoutAt?: string;
    byocProjectId?: string;
    createdAtIso?: string;
    lastLoginAtIso?: string;
  },
  serverTimeToken: TTime,
  existingCreatedAt?: unknown,
): Record<string, unknown> {
  const safeEmail = params.email.trim().toLowerCase();
  const isEnabled =
    typeof params.isEnabled === 'boolean' ? params.isEnabled : params.isActive !== false;
  const presenceStatus =
    isEnabled && params.presenceStatus === 'active' ? 'active' : 'not_active';
  return {
    ownerUid: sanitizeDocId(params.ownerUid),
    userId: sanitizeDocId(params.userId),
    username: clampStr(params.username.trim() || 'User', 64),
    email: clampStr(safeEmail.length >= 5 ? safeEmail : 'user@example.com', 160),
    role: 'secondary',
    isActive: isEnabled && presenceStatus === 'active',
    isEnabled,
    presenceStatus,
    lastHeartbeatAt: clampStr(params.lastHeartbeatAt || '', 40),
    lastLogoutAt: clampStr(params.lastLogoutAt || '', 40),
    byocProjectId: clampStr(params.byocProjectId || '', CLOUD_LIMITS.PROJECT_ID_MAX),
    clientCreatedAt: clampStr(params.createdAtIso || new Date().toISOString(), 40),
    clientLastLoginAt: clampStr(params.lastLoginAtIso || '', 40),
    createdAt: existingCreatedAt ?? serverTimeToken,
    updatedAt: serverTimeToken,
  };
}

export function normalizeAdminFirestoreTimestamp(val: unknown, fallback = ''): string {
  if (typeof val === 'string') return val;
  if (typeof val === 'number' && Number.isFinite(val)) {
    return new Date(val).toISOString();
  }
  if (val && typeof val === 'object') {
    const maybeTs = val as { toDate?: () => Date; seconds?: number };
    if (typeof maybeTs.toDate === 'function') {
      try {
        return maybeTs.toDate().toISOString();
      } catch {
        return fallback;
      }
    }
    if (typeof maybeTs.seconds === 'number' && Number.isFinite(maybeTs.seconds)) {
      return new Date(maybeTs.seconds * 1000).toISOString();
    }
  }
  return fallback;
}

export function isLegacyDocExcludedFromAdmin(
  data: Record<string, unknown>,
  knownAdminUids: ReadonlySet<string>,
  excludedSecondaryOwnerUids: ReadonlySet<string>,
): boolean {
  const tenantId = typeof data.tenantId === 'string' ? data.tenantId.trim() : '';
  if (tenantId && tenantId !== 'admin_vanshsales') {
    return true;
  }
  const workspaceUserId = typeof data.userId === 'string' ? data.userId.trim() : '';
  if (workspaceUserId.startsWith('sec_')) {
    return true;
  }
  const ownerEmail = typeof data.ownerEmail === 'string' ? data.ownerEmail.trim().toLowerCase() : '';
  if (ownerEmail && ownerEmail !== 'vanshsaxena7498@gmail.com') {
    return true;
  }
  const docOwner = typeof data.ownerUid === 'string' ? data.ownerUid.trim() : '';
  if (!docOwner) {
    return false;
  }
  if (knownAdminUids.has(docOwner)) {
    return false;
  }
  if (docOwner.startsWith('sec_') || excludedSecondaryOwnerUids.has(docOwner)) {
    return true;
  }
  return false;
}

export function mergeAdminRecordsById<T extends { id: string }>(
  primary: T[],
  supplemental: T[],
): T[] {
  const byId = new Map<string, T>();
  for (const item of primary) {
    if (!item?.id) continue;
    if (!byId.has(item.id)) {
      byId.set(item.id, item);
    }
  }
  for (const item of supplemental) {
    if (!item?.id) continue;
    if (!byId.has(item.id)) {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values());
}

export function mergeAdminAttachmentMaps(
  primary: ReadonlyMap<string, string>,
  supplemental: ReadonlyMap<string, string>,
): Map<string, string> {
  const combined = new Map<string, string>();
  for (const [k, v] of supplemental.entries()) {
    if (v) combined.set(k, v);
  }
  for (const [k, v] of primary.entries()) {
    if (v) combined.set(k, v);
  }
  return combined;
}

