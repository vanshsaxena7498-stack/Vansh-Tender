import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { db, handleFirestoreError, OperationType, storage } from '../lib/firebase.ts';
import type {
  AttachmentItem,
  CrmUserSession,
  EmailAlertLog,
  EmailAlertSettings,
  EmdBgRecord,
  FirmProfile,
  GoogleSheetSettings,
  MafTrackerRecord,
  SecondaryUserSummary,
  Tender,
  UserPreferences,
} from '../types/crm';
import { MAX_ATTACHMENT_BYTES, readAttachmentForFirestore } from './attachments.ts';
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
  buildSecondaryUserCloudPayload,
  buildWorkspaceRootPayload,
  sanitizeDocId,
} from './cloudSyncHelpers.ts';
import {
  getMafContactDetails,
  getMafRequestedDate,
  validateMafUploadFile,
} from './mafCalculations.ts';

const TERMINAL_TENDER_STAGES = new Set<Tender['stage']>([
  'L1 / Won',
  'Lost (L2/L3)',
  'Cancelled / Retendered',
]);

const ensuredWorkspaceKeys = new Set<string>();
const syncedAttachmentKeys = new Set<string>();

export function clearCloudSessionCache(): void {
  ensuredWorkspaceKeys.clear();
  syncedAttachmentKeys.clear();
}

const TERMINAL_FINANCIAL_STATUS = new Set<EmdBgRecord['status']>([
  'Refunded / Released',
  'Forfeited',
]);

function isBootstrappedAdminUser(user: User | null): boolean {
  return Boolean(user?.emailVerified && user.email === 'vanshsaxena7498@gmail.com');
}

function normalizeTenantId(workspaceTenantId?: string | null): string | null {
  if (!workspaceTenantId || typeof workspaceTenantId !== 'string') return null;
  const trimmed = workspaceTenantId.trim();
  if (!trimmed || trimmed === 'admin_vanshsales') return null;
  return sanitizeDocId(trimmed);
}

function getTenantPathPrefix(uid: string, workspaceTenantId?: string | null): string {
  const safeTenant = normalizeTenantId(workspaceTenantId);
  return safeTenant ? `users/${uid}/workspaces/${safeTenant}` : `users/${uid}`;
}

function getTenantDoc(
  uid: string,
  workspaceTenantId: string | null | undefined,
  colName: string,
  docId: string,
) {
  const safeTenant = normalizeTenantId(workspaceTenantId);
  if (safeTenant) {
    return doc(db, 'users', uid, 'workspaces', safeTenant, colName, docId);
  }
  return doc(db, 'users', uid, colName, docId);
}

function getTenantCollection(
  uid: string,
  workspaceTenantId: string | null | undefined,
  colName: string,
) {
  const safeTenant = normalizeTenantId(workspaceTenantId);
  if (safeTenant) {
    return collection(db, 'users', uid, 'workspaces', safeTenant, colName);
  }
  return collection(db, 'users', uid, colName);
}

function docToTender(data: Record<string, unknown>): Tender {
  return {
    id: String(data.id ?? ''),
    tenderId: String(data.tenderId ?? ''),
    portal: data.portal as Tender['portal'],
    department: String(data.department ?? ''),
    location: String(data.location ?? ''),
    category: String(data.category ?? ''),
    title: String(data.title ?? ''),
    publishDate: String(data.publishDate ?? ''),
    submissionDueDate: String(data.submissionDueDate ?? ''),
    preBidDate: String(data.preBidDate ?? ''),
    estimatedValue: Number(data.estimatedValue ?? 0),
    quotedValue: Number(data.quotedValue ?? 0),
    emdStatus: data.emdStatus as Tender['emdStatus'],
    emdAmount: Number(data.emdAmount ?? 0),
    stage: data.stage as Tender['stage'],
    resultInfo: String(data.resultInfo ?? ''),
    completionDate: String(data.completionDate ?? ''),
    checklist: Array.isArray(data.checklist) ? (data.checklist as Tender['checklist']) : [],
    remarks: Array.isArray(data.remarks) ? (data.remarks as Tender['remarks']) : [],
    attachments: Array.isArray(data.attachments)
      ? (data.attachments as Tender['attachments'])
      : [],
    createdAt: String(data.clientCreatedAt ?? new Date().toISOString()),
    updatedAt: String(data.clientUpdatedAt ?? new Date().toISOString()),
  };
}

function docToEmdRecord(data: Record<string, unknown>): EmdBgRecord {
  return {
    id: String(data.id ?? ''),
    tenderRefId: String(data.tenderRefId ?? ''),
    tenderId: String(data.tenderId ?? ''),
    department: String(data.department ?? ''),
    instrumentType: data.instrumentType as EmdBgRecord['instrumentType'],
    referenceNo: String(data.referenceNo ?? ''),
    bankName: String(data.bankName ?? ''),
    amount: Number(data.amount ?? 0),
    issueDate: String(data.issueDate ?? ''),
    expiryDate: String(data.expiryDate ?? ''),
    claimEndDate: String(data.claimEndDate ?? ''),
    status: data.status as EmdBgRecord['status'],
    refundDate: String(data.refundDate ?? ''),
    refundRef: String(data.refundRef ?? ''),
    remarks: String(data.remarks ?? ''),
    attachments: Array.isArray(data.attachments)
      ? (data.attachments as EmdBgRecord['attachments'])
      : [],
  };
}

function docToMafTracker(data: Record<string, unknown>): MafTrackerRecord {
  const rawItems = Array.isArray(data.itemsMAF)
    ? (data.itemsMAF as MafTrackerRecord['itemsMAF'])
    : [];
  return {
    id: String(data.id ?? ''),
    tenderRefId: String(data.tenderRefId ?? ''),
    tenderId: String(data.tenderId ?? ''),
    tenderTitle: String(data.tenderTitle ?? ''),
    department: String(data.department ?? ''),
    tenderDueDate: String(data.tenderDueDate ?? ''),
    itemsMAF: rawItems.map((item) => {
      const contact = getMafContactDetails(item);
      return {
        ...item,
        oemName: String(item.oemName ?? ''),
        companyName: String(item.companyName ?? ''),
        concernedPersonName: contact.concernedPersonName,
        contactNo: contact.contactNo,
        mailId: contact.mailId,
        mafRequestedDate: getMafRequestedDate(item),
      };
    }),
    createdAt: String(data.clientCreatedAt ?? new Date().toISOString()),
    updatedAt: String(data.clientUpdatedAt ?? new Date().toISOString()),
  };
}

function docToProfile(data: Record<string, unknown>): FirmProfile {
  return {
    firmName: String(data.firmName ?? 'Corporate Tender Desk'),
    gstin: String(data.gstin ?? ''),
    udyamNumber: String(data.udyamNumber ?? ''),
    adminName: String(data.adminName ?? 'Tender Desk User'),
    adminPhotoUrl: String(data.adminPhotoUrl ?? ''),
  };
}

function docToPreferences(data: Record<string, unknown>): UserPreferences {
  const pin = String(data.adminPin ?? '1234');
  return {
    adminPin: /^\d{4}$/.test(pin) ? pin : '1234',
    darkMode: Boolean(data.darkMode),
  };
}

function docToEmailConfig(data: Record<string, unknown>): EmailAlertSettings {
  return {
    enabled: data.enabled !== false,
    recipientName: String(data.recipientName ?? 'User'),
    recipientEmail: String(data.recipientEmail ?? ''),
  };
}

function docToSheetConfig(data: Record<string, unknown>): GoogleSheetSettings {
  return {
    enabled: data.enabled !== false,
    webhookUrl: String(data.webhookUrl ?? ''),
    sheetName: String(data.sheetName ?? 'MIS Monthly Report') || 'MIS Monthly Report',
    lastSyncedAt: String(data.lastSyncedAt ?? ''),
  };
}

function docToEmailAlertLog(data: Record<string, unknown>): EmailAlertLog {
  return {
    id: String(data.id ?? ''),
    slotKey: String(data.slotKey ?? data.id ?? ''),
    tenderRefId: String(data.tenderRefId ?? ''),
    tenderId: String(data.tenderId ?? ''),
    slot: (data.slot as EmailAlertLog['slot']) || 'slot_11am',
    recipientName: String(data.recipientName ?? 'User'),
    recipientEmail: String(data.recipientEmail ?? ''),
    dueDateIso: String(data.dueDateIso ?? ''),
    status: (data.status as EmailAlertLog['status']) || 'sent',
    provider: String(data.provider ?? 'smtp'),
    subject: String(data.subject ?? ''),
    message: String(data.message ?? ''),
    createdAt: String(data.clientCreatedAt ?? new Date().toISOString()),
  };
}

export async function ensureUserRootDocument(
  user: User,
  workspaceTenantId?: string | null,
  sessionMeta?: Pick<CrmUserSession, 'username' | 'email'> | null,
): Promise<void> {
  const safeTenant = normalizeTenantId(workspaceTenantId);
  const cacheKey = `${user.uid}::${safeTenant || 'admin'}`;
  if (ensuredWorkspaceKeys.has(cacheKey)) return;

  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  const safeEmail = (user.email ?? '').slice(0, 200);
  try {
    const snap = await getDoc(userRef);
    const now = serverTimestamp();
    if (!snap.exists()) {
      await setDoc(userRef, {
        ownerUid: user.uid,
        email: safeEmail,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      const data = snap.data();
      const needsRepair =
        data.ownerUid !== user.uid ||
        data.email !== safeEmail ||
        data.createdAt === undefined ||
        data.createdAt === null;
      if (needsRepair) {
        await setDoc(userRef, {
          ownerUid: user.uid,
          email: safeEmail,
          createdAt: data.createdAt ?? now,
          updatedAt: now,
        });
      }
    }

    if (safeTenant) {
      const wsPath = `users/${user.uid}/workspaces/${safeTenant}`;
      const wsRef = doc(db, 'users', user.uid, 'workspaces', safeTenant);
      const wsSnap = await getDoc(wsRef);
      const existingCreatedAt = wsSnap.exists() ? wsSnap.data().createdAt : undefined;
      const wsPayload = buildWorkspaceRootPayload(
        {
          ownerUid: user.uid,
          tenantId: safeTenant,
          username: sessionMeta?.username || safeTenant,
          email: sessionMeta?.email || safeEmail,
        },
        serverTimestamp(),
        existingCreatedAt,
      );
      if (!wsSnap.exists()) {
        await setDoc(wsRef, wsPayload);
      } else {
        const wsData = wsSnap.data();
        if (wsData.ownerUid !== user.uid || wsData.tenantId !== safeTenant || !wsData.createdAt) {
          await setDoc(wsRef, wsPayload);
        }
      }
      void wsPath;
    }

    ensuredWorkspaceKeys.add(cacheKey);
  } catch (error) {
    ensuredWorkspaceKeys.delete(cacheKey);
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function syncSecondaryUserToCloud(
  user: User,
  summary: SecondaryUserSummary,
): Promise<void> {
  const safeId = sanitizeDocId(summary.userId);
  const path = `secondaryUsers/${safeId}`;
  const ref = doc(db, 'secondaryUsers', safeId);
  try {
    const snap = await getDoc(ref);
    const existingCreatedAt = snap.exists() ? snap.data().createdAt : undefined;
    const ownerUid = snap.exists() && typeof snap.data().ownerUid === 'string'
      ? snap.data().ownerUid
      : user.uid;
    const payload = buildSecondaryUserCloudPayload(
      {
        ownerUid,
        userId: safeId,
        username: summary.username,
        email: summary.email,
        isActive: summary.isActive,
        createdAtIso: summary.createdAt,
        lastLoginAtIso: summary.lastLoginAt,
      },
      serverTimestamp(),
      existingCreatedAt,
    );
    await setDoc(ref, payload);
  } catch {
    // Non-fatal if directory write isn't permitted for current auth user
  }
  void path;
}

export async function fetchSecondaryUsersFromCloud(
  adminUser: User,
): Promise<SecondaryUserSummary[]> {
  if (!isBootstrappedAdminUser(adminUser)) return [];
  const path = 'secondaryUsers';
  try {
    const snap = await getDocs(collection(db, 'secondaryUsers'));
    return snap.docs
      .map((d) => {
        const data = d.data();
        return {
          userId: String(data.userId ?? d.id),
          username: String(data.username ?? ''),
          email: String(data.email ?? ''),
          role: 'secondary' as const,
          createdAt: String(data.clientCreatedAt ?? new Date().toISOString()),
          lastLoginAt:
            typeof data.clientLastLoginAt === 'string' && data.clientLastLoginAt
              ? data.clientLastLoginAt
              : undefined,
          isActive: data.isActive !== false,
        };
      })
      .filter((item) => item.username.length > 0 && item.email.length > 0);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function syncPreferencesToCloud(
  user: User,
  prefs: UserPreferences,
  workspaceTenantId?: string | null,
): Promise<void> {
  await ensureUserRootDocument(user, workspaceTenantId);
  const prefix = getTenantPathPrefix(user.uid, workspaceTenantId);
  const path = `${prefix}/settings/preferences`;
  const ref = getTenantDoc(user.uid, workspaceTenantId, 'settings', 'preferences');
  try {
    const snap = await getDoc(ref);
    const existingCreatedAt = snap.exists() ? snap.data().createdAt : undefined;
    const payload = buildCloudPreferencesPayload(
      prefs,
      user.uid,
      serverTimestamp(),
      existingCreatedAt,
    );
    await setDoc(ref, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncProfileToCloud(
  user: User,
  profile: FirmProfile,
  workspaceTenantId?: string | null,
): Promise<void> {
  await ensureUserRootDocument(user, workspaceTenantId);
  const prefix = getTenantPathPrefix(user.uid, workspaceTenantId);
  const path = `${prefix}/profile/firm`;
  const ref = getTenantDoc(user.uid, workspaceTenantId, 'profile', 'firm');
  try {
    const snap = await getDoc(ref);
    const existingCreatedAt = snap.exists() ? snap.data().createdAt : undefined;
    const payload = buildCloudProfilePayload(profile, user.uid, serverTimestamp(), existingCreatedAt);
    await setDoc(ref, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncEmailConfigToCloud(
  user: User,
  config: EmailAlertSettings,
  workspaceTenantId?: string | null,
): Promise<void> {
  await ensureUserRootDocument(user, workspaceTenantId);
  const prefix = getTenantPathPrefix(user.uid, workspaceTenantId);
  const path = `${prefix}/emailConfig/default`;
  const ref = getTenantDoc(user.uid, workspaceTenantId, 'emailConfig', 'default');
  try {
    const snap = await getDoc(ref);
    const existingCreatedAt = snap.exists() ? snap.data().createdAt : undefined;
    const payload = buildCloudEmailConfigPayload(
      config,
      user.uid,
      serverTimestamp(),
      existingCreatedAt,
    );
    await setDoc(ref, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncSheetConfigToCloud(
  user: User,
  config: GoogleSheetSettings,
  workspaceTenantId?: string | null,
): Promise<void> {
  await ensureUserRootDocument(user, workspaceTenantId);
  const prefix = getTenantPathPrefix(user.uid, workspaceTenantId);
  const path = `${prefix}/sheetConfig/default`;
  const ref = getTenantDoc(user.uid, workspaceTenantId, 'sheetConfig', 'default');
  try {
    const snap = await getDoc(ref);
    const existingCreatedAt = snap.exists() ? snap.data().createdAt : undefined;
    const payload = buildCloudSheetConfigPayload(
      config,
      user.uid,
      serverTimestamp(),
      existingCreatedAt,
    );
    await setDoc(ref, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncEmailAlertLogToCloud(
  user: User,
  log: EmailAlertLog,
  workspaceTenantId?: string | null,
): Promise<void> {
  await ensureUserRootDocument(user, workspaceTenantId);
  const safeId = sanitizeDocId(log.id);
  const prefix = getTenantPathPrefix(user.uid, workspaceTenantId);
  const path = `${prefix}/emailAlerts/${safeId}`;
  const ref = getTenantDoc(user.uid, workspaceTenantId, 'emailAlerts', safeId);
  try {
    const snap = await getDoc(ref);
    const existingCreatedAt = snap.exists() ? snap.data().createdAt : undefined;
    const payload = buildCloudEmailAlertLogPayload(
      { ...log, id: safeId },
      user.uid,
      serverTimestamp(),
      existingCreatedAt,
    );
    await setDoc(ref, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncAttachmentFilesToCloud(
  user: User,
  attachments: AttachmentItem[] | undefined,
  workspaceTenantId?: string | null,
): Promise<void> {
  const list = attachments ?? [];
  const safeTenant = normalizeTenantId(workspaceTenantId);
  const prefix = getTenantPathPrefix(user.uid, safeTenant);
  for (const att of list) {
    if (!att.dataUrl) continue;
    const safeId = sanitizeDocId(att.id);
    const cacheKey = `${user.uid}:${safeTenant || 'admin'}:${safeId}:${att.fileSize}:${att.uploadedAt}`;
    if (syncedAttachmentKeys.has(cacheKey)) continue;

    const path = `${prefix}/attachmentFiles/${safeId}`;
    const ref = getTenantDoc(user.uid, safeTenant, 'attachmentFiles', safeId);
    try {
      const snap = await getDoc(ref);
      const existingData = snap.exists() ? snap.data() : null;
      if (
        existingData &&
        existingData.ownerUid === user.uid &&
        existingData.fileSize === att.fileSize &&
        existingData.fileName === (att.fileName.trim() || 'attachment') &&
        existingData.createdAt
      ) {
        syncedAttachmentKeys.add(cacheKey);
        continue;
      }
      const existingCreatedAt = existingData?.createdAt;
      const payload = buildCloudAttachmentFilePayload(
        att,
        user.uid,
        serverTimestamp(),
        existingCreatedAt,
      );
      if (payload) {
        await setDoc(ref, payload);
        syncedAttachmentKeys.add(cacheKey);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }
}

export async function uploadMafDocumentFile(
  user: User | null,
  trackerId: string,
  itemId: string,
  file: File,
  workspaceTenantId?: string | null,
): Promise<{
  mafDocumentUrl: string;
  mafDocumentName: string;
  mafAttachmentId?: string;
}> {
  const validationErr = validateMafUploadFile(file);
  if (validationErr) {
    throw new Error(validationErr);
  }

  const safeTenant = normalizeTenantId(workspaceTenantId);
  const isCompressibleImage =
    file.type.startsWith('image/') && file.type !== 'image/svg+xml' && file.type !== 'image/gif';

  // Use Firebase Storage for large non-image PDFs (> 650 KB) when signed in
  if (!isCompressibleImage && file.size > MAX_ATTACHMENT_BYTES) {
    if (!user) {
      throw new Error(
        'PDF exceeds 650 KB. Sign in with Google for Firebase Storage upload, compress the PDF under 650 KB, or paste a Cloud Drive link.',
      );
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._\-]/g, '_');
    const path = safeTenant
      ? `users/${user.uid}/workspaces/${safeTenant}/maf_tracker/${sanitizeDocId(trackerId)}/${sanitizeDocId(itemId)}/${Date.now()}_${safeName}`
      : `users/${user.uid}/maf_tracker/${sanitizeDocId(trackerId)}/${sanitizeDocId(itemId)}/${Date.now()}_${safeName}`;
    try {
      const fileRef = storageRef(storage, path);
      await uploadBytes(fileRef, file, {
        contentType: file.type || 'application/pdf',
      });
      const url = await getDownloadURL(fileRef);
      return {
        mafDocumentUrl: url,
        mafDocumentName: file.name,
        mafAttachmentId: undefined,
      };
    } catch {
      throw new Error(
        'Could not upload large PDF to Firebase Storage. Please upload a PDF under 650 KB or paste a Google Drive link.',
      );
    }
  }

  // Images (auto-compressed) or PDFs <= 650 KB -> store cleanly in attachmentFiles subcollection
  const prepared = await readAttachmentForFirestore(file);
  const attId = sanitizeDocId(`maf_${itemId}_${Date.now()}`);
  const attachmentItem: AttachmentItem = {
    id: attId,
    slotLabel: 'MAF Document',
    fileName: file.name,
    fileType: prepared.fileType,
    fileSize: prepared.fileSize,
    uploadedAt: new Date().toISOString(),
    dataUrl: prepared.dataUrl,
  };

  if (user) {
    await ensureUserRootDocument(user, safeTenant);
    await syncAttachmentFilesToCloud(user, [attachmentItem], safeTenant);
  }

  return {
    mafDocumentUrl: prepared.dataUrl,
    mafDocumentName: file.name,
    mafAttachmentId: attId,
  };
}

export async function syncTenderToCloud(
  user: User,
  tender: Tender,
  workspaceTenantId?: string | null,
): Promise<void> {
  const safeTenant = normalizeTenantId(workspaceTenantId);
  await ensureUserRootDocument(user, safeTenant);
  await syncAttachmentFilesToCloud(user, tender.attachments, safeTenant);

  const safeId = sanitizeDocId(tender.id);
  const prefix = getTenantPathPrefix(user.uid, safeTenant);
  const path = `${prefix}/tenders/${safeId}`;
  const ref = getTenantDoc(user.uid, safeTenant, 'tenders', safeId);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const existingStage = snap.data().stage as Tender['stage'];
      if (TERMINAL_TENDER_STAGES.has(existingStage) && !isBootstrappedAdminUser(user)) {
        return;
      }
    }
    const existingCreatedAt = snap.exists() ? snap.data().createdAt : undefined;
    const payload = buildCloudTenderPayload(
      { ...tender, id: safeId },
      user.uid,
      serverTimestamp(),
      existingCreatedAt,
    );
    await setDoc(ref, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteTenderFromCloud(
  user: User,
  tenderId: string,
  workspaceTenantId?: string | null,
): Promise<void> {
  const safeId = sanitizeDocId(tenderId);
  const prefix = getTenantPathPrefix(user.uid, workspaceTenantId);
  const path = `${prefix}/tenders/${safeId}`;
  try {
    await deleteDoc(getTenantDoc(user.uid, workspaceTenantId, 'tenders', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function syncEmdRecordToCloud(
  user: User,
  record: EmdBgRecord,
  workspaceTenantId?: string | null,
): Promise<void> {
  const safeTenant = normalizeTenantId(workspaceTenantId);
  await ensureUserRootDocument(user, safeTenant);
  await syncAttachmentFilesToCloud(user, record.attachments, safeTenant);

  const safeId = sanitizeDocId(record.id);
  const prefix = getTenantPathPrefix(user.uid, safeTenant);
  const path = `${prefix}/emdRecords/${safeId}`;
  const ref = getTenantDoc(user.uid, safeTenant, 'emdRecords', safeId);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const existingStatus = snap.data().status as EmdBgRecord['status'];
      if (TERMINAL_FINANCIAL_STATUS.has(existingStatus) && !isBootstrappedAdminUser(user)) {
        return;
      }
    }
    const existingCreatedAt = snap.exists() ? snap.data().createdAt : undefined;
    const payload = buildCloudEmdPayload(
      { ...record, id: safeId },
      user.uid,
      serverTimestamp(),
      existingCreatedAt,
    );
    await setDoc(ref, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteEmdRecordFromCloud(
  user: User,
  recordId: string,
  workspaceTenantId?: string | null,
): Promise<void> {
  const safeId = sanitizeDocId(recordId);
  const prefix = getTenantPathPrefix(user.uid, workspaceTenantId);
  const path = `${prefix}/emdRecords/${safeId}`;
  try {
    await deleteDoc(getTenantDoc(user.uid, workspaceTenantId, 'emdRecords', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function syncMafTrackerToCloud(
  user: User,
  tracker: MafTrackerRecord,
  workspaceTenantId?: string | null,
): Promise<void> {
  const safeTenant = normalizeTenantId(workspaceTenantId);
  await ensureUserRootDocument(user, safeTenant);

  const inlineMafAttachments: AttachmentItem[] = [];
  for (const item of tracker.itemsMAF ?? []) {
    if (item.mafAttachmentId && item.mafDocumentUrl?.startsWith('data:')) {
      inlineMafAttachments.push({
        id: item.mafAttachmentId,
        slotLabel: 'MAF Document',
        fileName: item.mafDocumentName || `${item.oemName}_MAF`,
        fileType: item.mafDocumentUrl.startsWith('data:application/pdf')
          ? 'application/pdf'
          : 'image/jpeg',
        fileSize: Math.round((item.mafDocumentUrl.length * 3) / 4),
        uploadedAt: item.updatedAt || tracker.updatedAt,
        dataUrl: item.mafDocumentUrl,
      });
    }
  }
  if (inlineMafAttachments.length > 0) {
    await syncAttachmentFilesToCloud(user, inlineMafAttachments, safeTenant);
  }

  const safeId = sanitizeDocId(tracker.id);
  const prefix = getTenantPathPrefix(user.uid, safeTenant);
  const path = `${prefix}/maf_tracker/${safeId}`;
  const ref = getTenantDoc(user.uid, safeTenant, 'maf_tracker', safeId);
  try {
    const snap = await getDoc(ref);
    const existingCreatedAt = snap.exists() ? snap.data().createdAt : undefined;
    const payload = buildCloudMafTrackerPayload(
      { ...tracker, id: safeId },
      user.uid,
      serverTimestamp(),
      existingCreatedAt,
    );
    await setDoc(ref, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteMafTrackerFromCloud(
  user: User,
  trackerId: string,
  workspaceTenantId?: string | null,
): Promise<void> {
  const safeId = sanitizeDocId(trackerId);
  const prefix = getTenantPathPrefix(user.uid, workspaceTenantId);
  const path = `${prefix}/maf_tracker/${safeId}`;
  try {
    await deleteDoc(getTenantDoc(user.uid, workspaceTenantId, 'maf_tracker', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function fetchAttachmentFileDataUrl(
  uid: string,
  attachmentId: string,
  workspaceTenantId?: string | null,
): Promise<string | null> {
  const safeId = sanitizeDocId(attachmentId);
  const prefix = getTenantPathPrefix(uid, workspaceTenantId);
  const path = `${prefix}/attachmentFiles/${safeId}`;
  try {
    const snap = await getDoc(getTenantDoc(uid, workspaceTenantId, 'attachmentFiles', safeId));
    if (!snap.exists()) return null;
    const dataUrl = snap.data().dataUrl;
    return typeof dataUrl === 'string' && dataUrl.length > 0 ? dataUrl : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function fetchAllFromCloud(
  uid: string,
  workspaceTenantId?: string | null,
): Promise<{
  profile: FirmProfile | null;
  preferences: UserPreferences | null;
  emailConfig: EmailAlertSettings | null;
  sheetConfig: GoogleSheetSettings | null;
  emailAlerts: EmailAlertLog[];
  tenders: Tender[];
  emdRecords: EmdBgRecord[];
  mafTrackers: MafTrackerRecord[];
  attachmentFiles: Map<string, string>;
}> {
  const safeTenant = normalizeTenantId(workspaceTenantId);
  const prefix = getTenantPathPrefix(uid, safeTenant);
  const profilePath = `${prefix}/profile/firm`;
  const prefsPath = `${prefix}/settings/preferences`;
  const emailConfigPath = `${prefix}/emailConfig/default`;
  const sheetConfigPath = `${prefix}/sheetConfig/default`;
  const emailAlertsPath = `${prefix}/emailAlerts`;
  const tendersPath = `${prefix}/tenders`;
  const emdPath = `${prefix}/emdRecords`;
  const mafPath = `${prefix}/maf_tracker`;
  const filesPath = `${prefix}/attachmentFiles`;

  let profile: FirmProfile | null = null;
  let preferences: UserPreferences | null = null;
  let emailConfig: EmailAlertSettings | null = null;
  let sheetConfig: GoogleSheetSettings | null = null;
  let emailAlerts: EmailAlertLog[] = [];
  let tenders: Tender[] = [];
  let emdRecords: EmdBgRecord[] = [];
  let mafTrackers: MafTrackerRecord[] = [];
  const attachmentFiles = new Map<string, string>();

  try {
    const profileSnap = await getDoc(getTenantDoc(uid, safeTenant, 'profile', 'firm'));
    if (profileSnap.exists()) {
      profile = docToProfile(profileSnap.data());
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, profilePath);
  }

  try {
    const prefsSnap = await getDoc(getTenantDoc(uid, safeTenant, 'settings', 'preferences'));
    if (prefsSnap.exists()) {
      preferences = docToPreferences(prefsSnap.data());
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, prefsPath);
  }

  try {
    const tQuery = query(getTenantCollection(uid, safeTenant, 'tenders'), where('ownerUid', '==', uid));
    const tSnap = await getDocs(tQuery);
    tenders = tSnap.docs.map((d) => docToTender(d.data()));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, tendersPath);
  }

  try {
    const eQuery = query(getTenantCollection(uid, safeTenant, 'emdRecords'), where('ownerUid', '==', uid));
    const eSnap = await getDocs(eQuery);
    emdRecords = eSnap.docs.map((d) => docToEmdRecord(d.data()));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, emdPath);
  }

  try {
    const mQuery = query(getTenantCollection(uid, safeTenant, 'maf_tracker'), where('ownerUid', '==', uid));
    const mSnap = await getDocs(mQuery);
    mafTrackers = mSnap.docs.map((d) => docToMafTracker(d.data()));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, mafPath);
  }

  try {
    const fQuery = query(
      getTenantCollection(uid, safeTenant, 'attachmentFiles'),
      where('ownerUid', '==', uid),
    );
    const fSnap = await getDocs(fQuery);
    for (const d of fSnap.docs) {
      const data = d.data();
      if (typeof data.dataUrl === 'string' && data.dataUrl.length > 0) {
        attachmentFiles.set(String(data.id ?? d.id), data.dataUrl);
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, filesPath);
  }

  try {
    const emailConfigSnap = await getDoc(getTenantDoc(uid, safeTenant, 'emailConfig', 'default'));
    if (emailConfigSnap.exists()) {
      emailConfig = docToEmailConfig(emailConfigSnap.data());
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, emailConfigPath);
  }

  try {
    const sheetConfigSnap = await getDoc(getTenantDoc(uid, safeTenant, 'sheetConfig', 'default'));
    if (sheetConfigSnap.exists()) {
      sheetConfig = docToSheetConfig(sheetConfigSnap.data());
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, sheetConfigPath);
  }

  try {
    const emailAlertsQuery = query(
      getTenantCollection(uid, safeTenant, 'emailAlerts'),
      where('ownerUid', '==', uid),
    );
    const emailSnap = await getDocs(emailAlertsQuery);
    emailAlerts = emailSnap.docs
      .map((d) => docToEmailAlertLog(d.data()))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, emailAlertsPath);
  }

  return {
    profile,
    preferences,
    emailConfig,
    sheetConfig,
    emailAlerts,
    tenders,
    emdRecords,
    mafTrackers,
    attachmentFiles,
  };
}

export async function backupAllToCloud(
  user: User,
  profile: FirmProfile,
  preferences: UserPreferences,
  tenders: Tender[],
  emdRecords: EmdBgRecord[],
  mafTrackers: MafTrackerRecord[] = [],
  workspaceTenantId?: string | null,
): Promise<void> {
  const safeTenant = normalizeTenantId(workspaceTenantId);
  await ensureUserRootDocument(user, safeTenant);
  await syncProfileToCloud(user, profile, safeTenant);
  await syncPreferencesToCloud(user, preferences, safeTenant);

  for (const tender of tenders) {
    await syncTenderToCloud(user, tender, safeTenant);
  }

  for (const record of emdRecords) {
    await syncEmdRecordToCloud(user, record, safeTenant);
  }

  for (const tracker of mafTrackers) {
    await syncMafTrackerToCloud(user, tracker, safeTenant);
  }
}

export async function replaceCloudDataset(
  user: User,
  profile: FirmProfile,
  preferences: UserPreferences,
  tenders: Tender[],
  emdRecords: EmdBgRecord[],
  mafTrackers: MafTrackerRecord[] = [],
  workspaceTenantId?: string | null,
): Promise<void> {
  const safeTenant = normalizeTenantId(workspaceTenantId);
  await ensureUserRootDocument(user, safeTenant);
  const existing = await fetchAllFromCloud(user.uid, safeTenant);
  const nextTenderIds = new Set(tenders.map((t) => sanitizeDocId(t.id)));
  const nextEmdIds = new Set(emdRecords.map((r) => sanitizeDocId(r.id)));
  const nextMafIds = new Set(mafTrackers.map((m) => sanitizeDocId(m.id)));
  const nextAttachmentIds = new Set<string>();

  for (const t of tenders) {
    for (const a of t.attachments ?? []) nextAttachmentIds.add(sanitizeDocId(a.id));
  }
  for (const r of emdRecords) {
    for (const a of r.attachments ?? []) nextAttachmentIds.add(sanitizeDocId(a.id));
  }
  for (const m of mafTrackers) {
    for (const item of m.itemsMAF ?? []) {
      if (item.mafAttachmentId) {
        nextAttachmentIds.add(sanitizeDocId(item.mafAttachmentId));
      }
    }
  }

  for (const oldTender of existing.tenders) {
    if (!nextTenderIds.has(sanitizeDocId(oldTender.id))) {
      await deleteTenderFromCloud(user, oldTender.id, safeTenant);
    }
  }

  for (const oldEmd of existing.emdRecords) {
    if (!nextEmdIds.has(sanitizeDocId(oldEmd.id))) {
      await deleteEmdRecordFromCloud(user, oldEmd.id, safeTenant);
    }
  }

  for (const oldMaf of existing.mafTrackers) {
    if (!nextMafIds.has(sanitizeDocId(oldMaf.id))) {
      await deleteMafTrackerFromCloud(user, oldMaf.id, safeTenant);
    }
  }

  const prefix = getTenantPathPrefix(user.uid, safeTenant);
  for (const oldAttId of existing.attachmentFiles.keys()) {
    if (!nextAttachmentIds.has(sanitizeDocId(oldAttId))) {
      const safeId = sanitizeDocId(oldAttId);
      const path = `${prefix}/attachmentFiles/${safeId}`;
      try {
        await deleteDoc(getTenantDoc(user.uid, safeTenant, 'attachmentFiles', safeId));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
      }
    }
  }

  await backupAllToCloud(
    user,
    profile,
    preferences,
    tenders,
    emdRecords,
    mafTrackers,
    safeTenant,
  );
}

export function subscribeToUserCloudData(
  uid: string,
  callbacks: {
    onProfile: (profile: FirmProfile) => void;
    onPreferences: (prefs: UserPreferences) => void;
    onEmailConfig?: (config: EmailAlertSettings) => void;
    onSheetConfig?: (config: GoogleSheetSettings) => void;
    onEmailAlerts?: (logs: EmailAlertLog[]) => void;
    onTenders: (tenders: Tender[]) => void;
    onEmdRecords: (records: EmdBgRecord[]) => void;
    onMafTrackers: (trackers: MafTrackerRecord[]) => void;
    onAttachmentFiles: (fileMap: Map<string, string>) => void;
    onError: (err: Error) => void;
  },
  workspaceTenantId?: string | null,
): Unsubscribe {
  const safeTenant = normalizeTenantId(workspaceTenantId);
  const prefix = getTenantPathPrefix(uid, safeTenant);
  const profilePath = `${prefix}/profile/firm`;
  const prefsPath = `${prefix}/settings/preferences`;
  const emailConfigPath = `${prefix}/emailConfig/default`;
  const sheetConfigPath = `${prefix}/sheetConfig/default`;
  const emailAlertsPath = `${prefix}/emailAlerts`;
  const tendersPath = `${prefix}/tenders`;
  const emdPath = `${prefix}/emdRecords`;
  const mafPath = `${prefix}/maf_tracker`;
  const filesPath = `${prefix}/attachmentFiles`;

  const unsubProfile = onSnapshot(
    getTenantDoc(uid, safeTenant, 'profile', 'firm'),
    (snap) => {
      if (snap.exists()) {
        callbacks.onProfile(docToProfile(snap.data()));
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, profilePath);
      } catch (wrapped) {
        callbacks.onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );

  const unsubPrefs = onSnapshot(
    getTenantDoc(uid, safeTenant, 'settings', 'preferences'),
    (snap) => {
      if (snap.exists()) {
        callbacks.onPreferences(docToPreferences(snap.data()));
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, prefsPath);
      } catch (wrapped) {
        callbacks.onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );

  const unsubTenders = onSnapshot(
    query(getTenantCollection(uid, safeTenant, 'tenders'), where('ownerUid', '==', uid)),
    (snap) => {
      callbacks.onTenders(snap.docs.map((d) => docToTender(d.data())));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, tendersPath);
      } catch (wrapped) {
        callbacks.onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );

  const unsubEmd = onSnapshot(
    query(getTenantCollection(uid, safeTenant, 'emdRecords'), where('ownerUid', '==', uid)),
    (snap) => {
      callbacks.onEmdRecords(snap.docs.map((d) => docToEmdRecord(d.data())));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, emdPath);
      } catch (wrapped) {
        callbacks.onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );

  const unsubMaf = onSnapshot(
    query(getTenantCollection(uid, safeTenant, 'maf_tracker'), where('ownerUid', '==', uid)),
    (snap) => {
      callbacks.onMafTrackers(snap.docs.map((d) => docToMafTracker(d.data())));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, mafPath);
      } catch (wrapped) {
        callbacks.onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );

  const unsubFiles = onSnapshot(
    query(getTenantCollection(uid, safeTenant, 'attachmentFiles'), where('ownerUid', '==', uid)),
    (snap) => {
      const map = new Map<string, string>();
      for (const d of snap.docs) {
        const data = d.data();
        if (typeof data.dataUrl === 'string' && data.dataUrl.length > 0) {
          map.set(String(data.id ?? d.id), data.dataUrl);
        }
      }
      callbacks.onAttachmentFiles(map);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, filesPath);
      } catch (wrapped) {
        callbacks.onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );

  const unsubEmailConfig = onSnapshot(
    getTenantDoc(uid, safeTenant, 'emailConfig', 'default'),
    (snap) => {
      if (snap.exists() && callbacks.onEmailConfig) {
        callbacks.onEmailConfig(docToEmailConfig(snap.data()));
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, emailConfigPath);
      } catch (wrapped) {
        callbacks.onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );

  const unsubEmailAlerts = onSnapshot(
    query(getTenantCollection(uid, safeTenant, 'emailAlerts'), where('ownerUid', '==', uid)),
    (snap) => {
      if (callbacks.onEmailAlerts) {
        const sorted = snap.docs
          .map((d) => docToEmailAlertLog(d.data()))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        callbacks.onEmailAlerts(sorted);
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, emailAlertsPath);
      } catch (wrapped) {
        callbacks.onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );

  const unsubSheetConfig = onSnapshot(
    getTenantDoc(uid, safeTenant, 'sheetConfig', 'default'),
    (snap) => {
      if (snap.exists() && callbacks.onSheetConfig) {
        callbacks.onSheetConfig(docToSheetConfig(snap.data()));
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, sheetConfigPath);
      } catch (wrapped) {
        callbacks.onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );

  return () => {
    unsubProfile();
    unsubPrefs();
    unsubEmailConfig();
    unsubSheetConfig();
    unsubEmailAlerts();
    unsubTenders();
    unsubEmd();
    unsubMaf();
    unsubFiles();
  };
}
