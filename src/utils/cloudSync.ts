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
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
  type FirebaseStorage,
} from 'firebase/storage';
import { assertIsolatedTargetDescriptor } from '../lib/byocConfigHelpers.ts';
import {
  db as centralDb,
  firebaseConfig as centralFirebaseConfig,
  handleFirestoreError,
  OperationType,
  storage as centralStorage,
} from '../lib/firebase.ts';
import type {
  AttachmentItem,
  CrmUserRole,
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

export interface CloudTargetContext {
  db: Firestore;
  storage: FirebaseStorage;
  projectId: string;
  databaseId?: string;
  isByoc: boolean;
  role: CrmUserRole;
}

export function getCentralAdminCloudTarget(): CloudTargetContext {
  return {
    db: centralDb,
    storage: centralStorage,
    projectId: centralFirebaseConfig.projectId,
    databaseId: centralFirebaseConfig.firestoreDatabaseId,
    isByoc: false,
    role: 'admin',
  };
}

export function assertCloudTargetIsolated(opts: {
  role?: CrmUserRole;
  workspaceTenantId?: string | null;
  target?: CloudTargetContext | null;
}): CloudTargetContext {
  return assertIsolatedTargetDescriptor({
    role: opts.role,
    workspaceTenantId: opts.workspaceTenantId,
    target: opts.target ?? null,
    adminFallback: getCentralAdminCloudTarget(),
  });
}

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

function resolveScope(
  uid: string,
  workspaceTenantId: string | null | undefined,
  target?: CloudTargetContext | null,
): { ctx: CloudTargetContext; scopedTenant: string | null; prefix: string } {
  const ctx = assertCloudTargetIsolated({
    workspaceTenantId,
    target,
  });
  // Inside a dedicated BYOC Firebase project, store directly under /users/{uid}/...
  const scopedTenant = ctx.isByoc ? null : normalizeTenantId(workspaceTenantId);
  const prefix = scopedTenant ? `users/${uid}/workspaces/${scopedTenant}` : `users/${uid}`;
  return { ctx, scopedTenant, prefix };
}

function getScopedDoc(
  ctx: CloudTargetContext,
  uid: string,
  scopedTenant: string | null,
  colName: string,
  docId: string,
) {
  if (scopedTenant) {
    return doc(ctx.db, 'users', uid, 'workspaces', scopedTenant, colName, docId);
  }
  return doc(ctx.db, 'users', uid, colName, docId);
}

function getScopedCollection(
  ctx: CloudTargetContext,
  uid: string,
  scopedTenant: string | null,
  colName: string,
) {
  if (scopedTenant) {
    return collection(ctx.db, 'users', uid, 'workspaces', scopedTenant, colName);
  }
  return collection(ctx.db, 'users', uid, colName);
}

function docToTender(data: Record<string, unknown>): Tender {
  const dept = String(data.department ?? '');
  return {
    id: String(data.id ?? ''),
    tenderId: String(data.tenderId ?? ''),
    portal: data.portal as Tender['portal'],
    clientName: typeof data.clientName === 'string' && data.clientName ? data.clientName : dept,
    department: dept,
    locationDepartment:
      typeof data.locationDepartment === 'string' && data.locationDepartment
        ? data.locationDepartment
        : dept,
    location: String(data.location ?? ''),
    category: String(data.category ?? ''),
    title: String(data.title ?? ''),
    publishDate: String(data.publishDate ?? ''),
    submissionDueDate: String(data.submissionDueDate ?? ''),
    preBidDate: String(data.preBidDate ?? ''),
    technicalOpeningDate: String(data.technicalOpeningDate ?? ''),
    financialOpeningDate: String(data.financialOpeningDate ?? ''),
    estimatedValue: Number(data.estimatedValue ?? 0),
    quotedValue: Number(data.quotedValue ?? 0),
    l1BidderName: String(data.l1BidderName ?? ''),
    l1QuotedValue: Number(data.l1QuotedValue ?? 0),
    ourPositionRank: String(data.ourPositionRank ?? ''),
    assignedOwner: String(data.assignedOwner ?? ''),
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
  target?: CloudTargetContext | null,
): Promise<void> {
  const { ctx, scopedTenant } = resolveScope(user.uid, workspaceTenantId, target);
  const cacheKey = `${ctx.projectId}::${user.uid}::${scopedTenant || 'root'}`;
  if (ensuredWorkspaceKeys.has(cacheKey)) return;

  const userPath = `users/${user.uid}`;
  const userRef = doc(ctx.db, 'users', user.uid);
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

    if (scopedTenant) {
      const wsRef = doc(ctx.db, 'users', user.uid, 'workspaces', scopedTenant);
      const wsSnap = await getDoc(wsRef);
      const existingCreatedAt = wsSnap.exists() ? wsSnap.data().createdAt : undefined;
      const wsPayload = buildWorkspaceRootPayload(
        {
          ownerUid: user.uid,
          tenantId: scopedTenant,
          username: sessionMeta?.username || scopedTenant,
          email: sessionMeta?.email || safeEmail,
        },
        serverTimestamp(),
        existingCreatedAt,
      );
      if (!wsSnap.exists()) {
        await setDoc(wsRef, wsPayload);
      } else {
        const wsData = wsSnap.data();
        if (wsData.ownerUid !== user.uid || wsData.tenantId !== scopedTenant || !wsData.createdAt) {
          await setDoc(wsRef, wsPayload);
        }
      }
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
  const ref = doc(centralDb, 'secondaryUsers', safeId);
  try {
    const snap = await getDoc(ref);
    const existingCreatedAt = snap.exists() ? snap.data().createdAt : undefined;
    const ownerUid =
      snap.exists() && typeof snap.data().ownerUid === 'string'
        ? snap.data().ownerUid
        : user.uid;
    const payload = buildSecondaryUserCloudPayload(
      {
        ownerUid,
        userId: safeId,
        username: summary.username,
        email: summary.email,
        isActive: summary.isActive,
        isEnabled: summary.isEnabled,
        presenceStatus: summary.presenceStatus,
        lastHeartbeatAt: summary.lastHeartbeatAt,
        lastLogoutAt: summary.lastLogoutAt,
        byocProjectId: summary.byocProjectId,
        createdAtIso: summary.createdAt,
        lastLoginAtIso: summary.lastLoginAt,
      },
      serverTimestamp(),
      existingCreatedAt,
    );
    await setDoc(ref, payload);
  } catch {
    // Non-fatal if central directory write isn't permitted for current auth user
  }
}

export async function fetchSecondaryUsersFromCloud(
  adminUser: User,
): Promise<SecondaryUserSummary[]> {
  if (!isBootstrappedAdminUser(adminUser)) return [];
  const path = 'secondaryUsers';
  try {
    const snap = await getDocs(collection(centralDb, 'secondaryUsers'));
    return snap.docs
      .map((d) => {
        const data = d.data();
        const isEnabled = data.isEnabled !== false && data.isActive !== false;
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
          isEnabled,
          presenceStatus:
            data.presenceStatus === 'active' || data.presenceStatus === 'not_active'
              ? (data.presenceStatus as 'active' | 'not_active')
              : 'not_active',
          lastHeartbeatAt:
            typeof data.lastHeartbeatAt === 'string' && data.lastHeartbeatAt
              ? data.lastHeartbeatAt
              : undefined,
          lastLogoutAt:
            typeof data.lastLogoutAt === 'string' && data.lastLogoutAt
              ? data.lastLogoutAt
              : undefined,
          byocProjectId:
            typeof data.byocProjectId === 'string' && data.byocProjectId
              ? data.byocProjectId
              : undefined,
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
  target?: CloudTargetContext | null,
): Promise<void> {
  const { ctx, scopedTenant, prefix } = resolveScope(user.uid, workspaceTenantId, target);
  await ensureUserRootDocument(user, workspaceTenantId, null, ctx);
  const path = `${prefix}/settings/preferences`;
  const ref = getScopedDoc(ctx, user.uid, scopedTenant, 'settings', 'preferences');
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
  target?: CloudTargetContext | null,
): Promise<void> {
  const { ctx, scopedTenant, prefix } = resolveScope(user.uid, workspaceTenantId, target);
  await ensureUserRootDocument(user, workspaceTenantId, null, ctx);
  const path = `${prefix}/profile/firm`;
  const ref = getScopedDoc(ctx, user.uid, scopedTenant, 'profile', 'firm');
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
  target?: CloudTargetContext | null,
): Promise<void> {
  const { ctx, scopedTenant, prefix } = resolveScope(user.uid, workspaceTenantId, target);
  await ensureUserRootDocument(user, workspaceTenantId, null, ctx);
  const path = `${prefix}/emailConfig/default`;
  const ref = getScopedDoc(ctx, user.uid, scopedTenant, 'emailConfig', 'default');
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
  target?: CloudTargetContext | null,
): Promise<void> {
  const { ctx, scopedTenant, prefix } = resolveScope(user.uid, workspaceTenantId, target);
  await ensureUserRootDocument(user, workspaceTenantId, null, ctx);
  const path = `${prefix}/sheetConfig/default`;
  const ref = getScopedDoc(ctx, user.uid, scopedTenant, 'sheetConfig', 'default');
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
  target?: CloudTargetContext | null,
): Promise<void> {
  const { ctx, scopedTenant, prefix } = resolveScope(user.uid, workspaceTenantId, target);
  await ensureUserRootDocument(user, workspaceTenantId, null, ctx);
  const safeId = sanitizeDocId(log.id);
  const path = `${prefix}/emailAlerts/${safeId}`;
  const ref = getScopedDoc(ctx, user.uid, scopedTenant, 'emailAlerts', safeId);
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
  target?: CloudTargetContext | null,
): Promise<void> {
  const list = attachments ?? [];
  const { ctx, scopedTenant, prefix } = resolveScope(user.uid, workspaceTenantId, target);
  for (const att of list) {
    if (!att.dataUrl) continue;
    const safeId = sanitizeDocId(att.id);
    const cacheKey = `${ctx.projectId}:${user.uid}:${scopedTenant || 'root'}:${safeId}:${att.fileSize}:${att.uploadedAt}`;
    if (syncedAttachmentKeys.has(cacheKey)) continue;

    const path = `${prefix}/attachmentFiles/${safeId}`;
    const ref = getScopedDoc(ctx, user.uid, scopedTenant, 'attachmentFiles', safeId);
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
  target?: CloudTargetContext | null,
): Promise<{
  mafDocumentUrl: string;
  mafDocumentName: string;
  mafAttachmentId?: string;
}> {
  const validationErr = validateMafUploadFile(file);
  if (validationErr) {
    throw new Error(validationErr);
  }

  const isCompressibleImage =
    file.type.startsWith('image/') && file.type !== 'image/svg+xml' && file.type !== 'image/gif';

  // Use scoped Firebase Storage ONLY when authenticated AND isolated target is valid
  if (!isCompressibleImage && file.size > MAX_ATTACHMENT_BYTES) {
    if (!user) {
      throw new Error(
        'PDF exceeds 650 KB. Connect your cloud account for Storage upload, compress the PDF under 650 KB, or paste a Cloud Drive link.',
      );
    }
    const { ctx, scopedTenant } = resolveScope(user.uid, workspaceTenantId, target);
    const safeName = file.name.replace(/[^a-zA-Z0-9._\-]/g, '_');
    const path = scopedTenant
      ? `users/${user.uid}/workspaces/${scopedTenant}/maf_tracker/${sanitizeDocId(trackerId)}/${sanitizeDocId(itemId)}/${Date.now()}_${safeName}`
      : `users/${user.uid}/maf_tracker/${sanitizeDocId(trackerId)}/${sanitizeDocId(itemId)}/${Date.now()}_${safeName}`;
    try {
      const fileRef = storageRef(ctx.storage, path);
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

  // Images (auto-compressed) or PDFs <= 650 KB -> store cleanly in attachmentFiles subcollection (or inline local if unconfigured)
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
    const canCloud =
      target?.isByoc || (!normalizeTenantId(workspaceTenantId) && target?.role !== 'secondary');
    if (canCloud) {
      await ensureUserRootDocument(user, workspaceTenantId, null, target);
      await syncAttachmentFilesToCloud(user, [attachmentItem], workspaceTenantId, target);
    }
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
  target?: CloudTargetContext | null,
): Promise<void> {
  const { ctx, scopedTenant, prefix } = resolveScope(user.uid, workspaceTenantId, target);
  await ensureUserRootDocument(user, workspaceTenantId, null, ctx);
  await syncAttachmentFilesToCloud(user, tender.attachments, workspaceTenantId, ctx);

  const safeId = sanitizeDocId(tender.id);
  const path = `${prefix}/tenders/${safeId}`;
  const ref = getScopedDoc(ctx, user.uid, scopedTenant, 'tenders', safeId);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const existingStage = snap.data().stage as Tender['stage'];
      if (TERMINAL_TENDER_STAGES.has(existingStage) && !isBootstrappedAdminUser(user) && !ctx.isByoc) {
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
  target?: CloudTargetContext | null,
): Promise<void> {
  const { ctx, scopedTenant, prefix } = resolveScope(user.uid, workspaceTenantId, target);
  const safeId = sanitizeDocId(tenderId);
  const path = `${prefix}/tenders/${safeId}`;
  const ref = getScopedDoc(ctx, user.uid, scopedTenant, 'tenders', safeId);
  try {
    const snap = await getDoc(ref);
    if (snap.exists() && snap.data().ownerUid !== user.uid) {
      throw new Error('PERMISSION_DENIED: Cannot delete record owned by another user.');
    }
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function syncEmdRecordToCloud(
  user: User,
  record: EmdBgRecord,
  workspaceTenantId?: string | null,
  target?: CloudTargetContext | null,
): Promise<void> {
  const { ctx, scopedTenant, prefix } = resolveScope(user.uid, workspaceTenantId, target);
  await ensureUserRootDocument(user, workspaceTenantId, null, ctx);
  await syncAttachmentFilesToCloud(user, record.attachments, workspaceTenantId, ctx);

  const safeId = sanitizeDocId(record.id);
  const path = `${prefix}/emdRecords/${safeId}`;
  const ref = getScopedDoc(ctx, user.uid, scopedTenant, 'emdRecords', safeId);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const existingStatus = snap.data().status as EmdBgRecord['status'];
      if (TERMINAL_FINANCIAL_STATUS.has(existingStatus) && !isBootstrappedAdminUser(user) && !ctx.isByoc) {
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
  target?: CloudTargetContext | null,
): Promise<void> {
  const { ctx, scopedTenant, prefix } = resolveScope(user.uid, workspaceTenantId, target);
  const safeId = sanitizeDocId(recordId);
  const path = `${prefix}/emdRecords/${safeId}`;
  const ref = getScopedDoc(ctx, user.uid, scopedTenant, 'emdRecords', safeId);
  try {
    const snap = await getDoc(ref);
    if (snap.exists() && snap.data().ownerUid !== user.uid) {
      throw new Error('PERMISSION_DENIED: Cannot delete record owned by another user.');
    }
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function syncMafTrackerToCloud(
  user: User,
  tracker: MafTrackerRecord,
  workspaceTenantId?: string | null,
  target?: CloudTargetContext | null,
): Promise<void> {
  const { ctx, scopedTenant, prefix } = resolveScope(user.uid, workspaceTenantId, target);
  await ensureUserRootDocument(user, workspaceTenantId, null, ctx);

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
    await syncAttachmentFilesToCloud(user, inlineMafAttachments, workspaceTenantId, ctx);
  }

  const safeId = sanitizeDocId(tracker.id);
  const path = `${prefix}/maf_tracker/${safeId}`;
  const ref = getScopedDoc(ctx, user.uid, scopedTenant, 'maf_tracker', safeId);
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
  target?: CloudTargetContext | null,
): Promise<void> {
  const { ctx, scopedTenant, prefix } = resolveScope(user.uid, workspaceTenantId, target);
  const safeId = sanitizeDocId(trackerId);
  const path = `${prefix}/maf_tracker/${safeId}`;
  const ref = getScopedDoc(ctx, user.uid, scopedTenant, 'maf_tracker', safeId);
  try {
    const snap = await getDoc(ref);
    if (snap.exists() && snap.data().ownerUid !== user.uid) {
      throw new Error('PERMISSION_DENIED: Cannot delete record owned by another user.');
    }
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function fetchAttachmentFileDataUrl(
  uid: string,
  attachmentId: string,
  workspaceTenantId?: string | null,
  target?: CloudTargetContext | null,
): Promise<string | null> {
  const { ctx, scopedTenant, prefix } = resolveScope(uid, workspaceTenantId, target);
  const safeId = sanitizeDocId(attachmentId);
  const path = `${prefix}/attachmentFiles/${safeId}`;
  try {
    const snap = await getDoc(getScopedDoc(ctx, uid, scopedTenant, 'attachmentFiles', safeId));
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
  target?: CloudTargetContext | null,
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
  const { ctx, scopedTenant, prefix } = resolveScope(uid, workspaceTenantId, target);
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
    const profileSnap = await getDoc(getScopedDoc(ctx, uid, scopedTenant, 'profile', 'firm'));
    if (profileSnap.exists()) {
      profile = docToProfile(profileSnap.data());
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, profilePath);
  }

  try {
    const prefsSnap = await getDoc(getScopedDoc(ctx, uid, scopedTenant, 'settings', 'preferences'));
    if (prefsSnap.exists()) {
      preferences = docToPreferences(prefsSnap.data());
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, prefsPath);
  }

  try {
    const tQuery = query(
      getScopedCollection(ctx, uid, scopedTenant, 'tenders'),
      where('ownerUid', '==', uid),
    );
    const tSnap = await getDocs(tQuery);
    tenders = tSnap.docs.map((d) => docToTender(d.data()));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, tendersPath);
  }

  try {
    const eQuery = query(
      getScopedCollection(ctx, uid, scopedTenant, 'emdRecords'),
      where('ownerUid', '==', uid),
    );
    const eSnap = await getDocs(eQuery);
    emdRecords = eSnap.docs.map((d) => docToEmdRecord(d.data()));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, emdPath);
  }

  try {
    const mQuery = query(
      getScopedCollection(ctx, uid, scopedTenant, 'maf_tracker'),
      where('ownerUid', '==', uid),
    );
    const mSnap = await getDocs(mQuery);
    mafTrackers = mSnap.docs.map((d) => docToMafTracker(d.data()));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, mafPath);
  }

  try {
    const fQuery = query(
      getScopedCollection(ctx, uid, scopedTenant, 'attachmentFiles'),
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
    const emailConfigSnap = await getDoc(
      getScopedDoc(ctx, uid, scopedTenant, 'emailConfig', 'default'),
    );
    if (emailConfigSnap.exists()) {
      emailConfig = docToEmailConfig(emailConfigSnap.data());
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, emailConfigPath);
  }

  try {
    const sheetConfigSnap = await getDoc(
      getScopedDoc(ctx, uid, scopedTenant, 'sheetConfig', 'default'),
    );
    if (sheetConfigSnap.exists()) {
      sheetConfig = docToSheetConfig(sheetConfigSnap.data());
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, sheetConfigPath);
  }

  try {
    const emailAlertsQuery = query(
      getScopedCollection(ctx, uid, scopedTenant, 'emailAlerts'),
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
  target?: CloudTargetContext | null,
): Promise<void> {
  const { ctx } = resolveScope(user.uid, workspaceTenantId, target);
  await ensureUserRootDocument(user, workspaceTenantId, null, ctx);
  await syncProfileToCloud(user, profile, workspaceTenantId, ctx);
  await syncPreferencesToCloud(user, preferences, workspaceTenantId, ctx);

  for (const tender of tenders) {
    await syncTenderToCloud(user, tender, workspaceTenantId, ctx);
  }

  for (const record of emdRecords) {
    await syncEmdRecordToCloud(user, record, workspaceTenantId, ctx);
  }

  for (const tracker of mafTrackers) {
    await syncMafTrackerToCloud(user, tracker, workspaceTenantId, ctx);
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
  target?: CloudTargetContext | null,
): Promise<void> {
  const { ctx, scopedTenant, prefix } = resolveScope(user.uid, workspaceTenantId, target);
  await ensureUserRootDocument(user, workspaceTenantId, null, ctx);
  const existing = await fetchAllFromCloud(user.uid, workspaceTenantId, ctx);
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
      await deleteTenderFromCloud(user, oldTender.id, workspaceTenantId, ctx);
    }
  }

  for (const oldEmd of existing.emdRecords) {
    if (!nextEmdIds.has(sanitizeDocId(oldEmd.id))) {
      await deleteEmdRecordFromCloud(user, oldEmd.id, workspaceTenantId, ctx);
    }
  }

  for (const oldMaf of existing.mafTrackers) {
    if (!nextMafIds.has(sanitizeDocId(oldMaf.id))) {
      await deleteMafTrackerFromCloud(user, oldMaf.id, workspaceTenantId, ctx);
    }
  }

  for (const oldAttId of existing.attachmentFiles.keys()) {
    if (!nextAttachmentIds.has(sanitizeDocId(oldAttId))) {
      const safeId = sanitizeDocId(oldAttId);
      const path = `${prefix}/attachmentFiles/${safeId}`;
      try {
        await deleteDoc(getScopedDoc(ctx, user.uid, scopedTenant, 'attachmentFiles', safeId));
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
    workspaceTenantId,
    ctx,
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
  target?: CloudTargetContext | null,
): Unsubscribe {
  const { ctx, scopedTenant, prefix } = resolveScope(uid, workspaceTenantId, target);
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
    getScopedDoc(ctx, uid, scopedTenant, 'profile', 'firm'),
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
    getScopedDoc(ctx, uid, scopedTenant, 'settings', 'preferences'),
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
    query(getScopedCollection(ctx, uid, scopedTenant, 'tenders'), where('ownerUid', '==', uid)),
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
    query(getScopedCollection(ctx, uid, scopedTenant, 'emdRecords'), where('ownerUid', '==', uid)),
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
    query(getScopedCollection(ctx, uid, scopedTenant, 'maf_tracker'), where('ownerUid', '==', uid)),
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
    query(
      getScopedCollection(ctx, uid, scopedTenant, 'attachmentFiles'),
      where('ownerUid', '==', uid),
    ),
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
    getScopedDoc(ctx, uid, scopedTenant, 'emailConfig', 'default'),
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
    query(getScopedCollection(ctx, uid, scopedTenant, 'emailAlerts'), where('ownerUid', '==', uid)),
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
    getScopedDoc(ctx, uid, scopedTenant, 'sheetConfig', 'default'),
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
