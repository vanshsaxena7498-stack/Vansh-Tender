import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromCache,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
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
  defaultDb,
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
  OemRecord,
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
  buildCloudOemPayload,
  buildCloudPreferencesPayload,
  buildCloudProfilePayload,
  buildCloudSheetConfigPayload,
  buildCloudTenderPayload,
  buildSecondaryUserCloudPayload,
  buildWorkspaceRootPayload,
  isFirestoreTimestampObject,
  isLegacyDocExcludedFromAdmin,
  mergeAdminAttachmentMaps,
  mergeAdminRecordsById,
  normalizeAdminFirestoreTimestamp,
  pickValidExistingCreatedAt,
  sanitizeDocId,
  utf8ByteLength,
} from './cloudSyncHelpers.ts';
import {
  chunkOperations,
  collectDirtyAttachmentsFromEntities,
  computeCollectionDeltaDiff,
  loadDeltaSyncManifest,
  resolveQuerySinceTimestampMs,
  saveDeltaSyncManifest,
  shouldFallbackFromMissingIndex,
  signatureForAttachment,
  signatureForEmailConfig,
  signatureForEmd,
  signatureForMaf,
  signatureForOem,
  signatureForPreferences,
  signatureForProfile,
  signatureForSheetConfig,
  signatureForTender,
  yieldToMainThread,
  type DeltaSyncScopeDescriptor,
  type DirtySyncSnapshot,
} from './deltaSync.ts';
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

const TERMINAL_FINANCIAL_STATUS = new Set<EmdBgRecord['status']>([
  'Refunded / Released',
  'Forfeited',
]);

const USER_ROOT_ALLOWED_KEYS = new Set(['ownerUid', 'email', 'createdAt', 'updatedAt']);
const WORKSPACE_ROOT_ALLOWED_KEYS = new Set([
  'ownerUid',
  'tenantId',
  'username',
  'email',
  'createdAt',
  'updatedAt',
]);

// Session-scoped in-memory metadata caches keyed by isolated project/database/path
const ensuredWorkspaceKeys = new Set<string>();
const syncedAttachmentKeys = new Set<string>();
// Value = valid Firestore Timestamp to preserve on update, or null when doc is missing/legacy (use serverTimestamp)
const cloudCreatedAtCache = new Map<string, unknown>();
const cloudOwnerUidCache = new Map<string, string>();
const cloudTerminalTenderCache = new Set<string>();
const cloudTerminalEmdCache = new Set<string>();

export function clearCloudSessionCache(): void {
  ensuredWorkspaceKeys.clear();
  syncedAttachmentKeys.clear();
  cloudCreatedAtCache.clear();
  cloudOwnerUidCache.clear();
  cloudTerminalTenderCache.clear();
  cloudTerminalEmdCache.clear();
}

function buildDocCacheKey(ctx: CloudTargetContext, docPath: string): string {
  return `${ctx.projectId}::${ctx.databaseId || '(default)'}::${docPath}`;
}

function rememberDocMetadata(
  ctx: CloudTargetContext,
  docPath: string,
  data: Record<string, unknown> | null | undefined,
  kind?: 'tender' | 'emd',
  opts?: { fromPendingWrite?: boolean; fromCache?: boolean },
): void {
  const key = buildDocCacheKey(ctx, docPath);
  const isUnverifiedSnapshot = Boolean(opts?.fromPendingWrite || opts?.fromCache);

  if (!data) {
    // Never overwrite known metadata or assume server absence from cache/pending snapshots
    if (isUnverifiedSnapshot) {
      if (!isFirestoreTimestampObject(cloudCreatedAtCache.get(key))) {
        cloudCreatedAtCache.delete(key);
      }
      return;
    }
    cloudCreatedAtCache.set(key, null);
    cloudOwnerUidCache.delete(key);
    cloudTerminalTenderCache.delete(key);
    cloudTerminalEmdCache.delete(key);
    return;
  }

  const validCreated = pickValidExistingCreatedAt(data.createdAt);
  if (validCreated) {
    cloudCreatedAtCache.set(key, validCreated);
  } else if (isUnverifiedSnapshot) {
    // Pending writes using serverTimestamp() have createdAt === null locally; preserve any valid cached timestamp or leave uncached so next write checks server
    if (!isFirestoreTimestampObject(cloudCreatedAtCache.get(key))) {
      cloudCreatedAtCache.delete(key);
    }
  } else {
    cloudCreatedAtCache.set(key, null);
  }

  if (typeof data.ownerUid === 'string' && data.ownerUid.trim()) {
    cloudOwnerUidCache.set(key, data.ownerUid.trim());
  }

  if (kind === 'tender') {
    const stage = data.stage as Tender['stage'];
    if (TERMINAL_TENDER_STAGES.has(stage)) {
      cloudTerminalTenderCache.add(key);
    } else {
      cloudTerminalTenderCache.delete(key);
    }
  } else if (kind === 'emd') {
    const status = data.status as EmdBgRecord['status'];
    if (TERMINAL_FINANCIAL_STATUS.has(status)) {
      cloudTerminalEmdCache.add(key);
    } else {
      cloudTerminalEmdCache.delete(key);
    }
  }
}

function isOfflineOrUnavailableError(err: unknown): boolean {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code ?? '').toLowerCase()
      : '';
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  return (
    code.includes('unavailable') ||
    msg.includes('unavailable') ||
    msg.includes('offline') ||
    msg.includes('failed to get document because the client is offline') ||
    msg.includes('network')
  );
}

function isPermissionDeniedError(err: unknown): boolean {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code ?? '').toLowerCase()
      : '';
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  return (
    code.includes('permission-denied') ||
    msg.includes('permission-denied') ||
    msg.includes('missing or insufficient permissions')
  );
}

async function readDocPreferServer(docRef: ReturnType<typeof doc>) {
  try {
    return await getDocFromServer(docRef);
  } catch (err) {
    if (isOfflineOrUnavailableError(err)) {
      return await getDoc(docRef);
    }
    throw err;
  }
}

async function runInBatches<T>(
  items: readonly T[],
  batchSize: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const size = Math.max(1, batchSize);
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    await Promise.all(chunk.map((item) => worker(item)));
  }
}

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

function buildScopeDescriptor(
  ctx: CloudTargetContext,
  uid: string,
  scopedTenant: string | null,
): DeltaSyncScopeDescriptor {
  return {
    projectId: ctx.projectId,
    databaseId: ctx.databaseId || '(default)',
    uid,
    tenantId: scopedTenant,
  };
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

function docToTender(data: Record<string, unknown>, fallbackDocId = ''): Tender {
  const dept = String(data.department ?? data.organization ?? data.clientName ?? '');
  const nowIso = new Date().toISOString();
  const resolvedId = String(data.id || fallbackDocId || '');
  return {
    id: resolvedId,
    tenderId: String(data.tenderId ?? data.tenderNo ?? data.bidNo ?? resolvedId),
    portal: (data.portal as Tender['portal']) || 'GeM',
    clientName: typeof data.clientName === 'string' && data.clientName ? data.clientName : dept,
    department: dept,
    locationDepartment:
      typeof data.locationDepartment === 'string' && data.locationDepartment
        ? data.locationDepartment
        : dept,
    location: String(data.location ?? ''),
    category: String(data.category ?? ''),
    title: String(data.title ?? data.workTitle ?? ''),
    publishDate: String(data.publishDate ?? ''),
    submissionDueDate: String(data.submissionDueDate ?? data.dueDate ?? ''),
    preBidDate: String(data.preBidDate ?? ''),
    technicalOpeningDate: String(data.technicalOpeningDate ?? ''),
    financialOpeningDate: String(data.financialOpeningDate ?? ''),
    estimatedValue: Number(data.estimatedValue ?? 0),
    quotedValue: Number(data.quotedValue ?? 0),
    l1BidderName: String(data.l1BidderName ?? ''),
    l1QuotedValue: Number(data.l1QuotedValue ?? 0),
    ourPositionRank: String(data.ourPositionRank ?? ''),
    assignedOwner: String(data.assignedOwner ?? ''),
    emdStatus: (data.emdStatus as Tender['emdStatus']) || 'No EMD',
    emdAmount: Number(data.emdAmount ?? 0),
    stage: (data.stage as Tender['stage']) || 'Identified / Reviewing',
    resultInfo: String(data.resultInfo ?? ''),
    completionDate: String(data.completionDate ?? ''),
    technicalStatus:
      typeof data.technicalStatus === 'string' && data.technicalStatus
        ? (data.technicalStatus as Tender['technicalStatus'])
        : undefined,
    technicalOpeningDateTime:
      typeof data.technicalOpeningDateTime === 'string' && data.technicalOpeningDateTime
        ? data.technicalOpeningDateTime
        : undefined,
    technicalRemarks:
      typeof data.technicalRemarks === 'string' && data.technicalRemarks
        ? data.technicalRemarks
        : undefined,
    financialRaStatus:
      typeof data.financialRaStatus === 'string' && data.financialRaStatus
        ? (data.financialRaStatus as Tender['financialRaStatus'])
        : undefined,
    financialOpeningRaDateTime:
      typeof data.financialOpeningRaDateTime === 'string' && data.financialOpeningRaDateTime
        ? data.financialOpeningRaDateTime
        : undefined,
    raFinalValue:
      typeof data.raFinalValue === 'number' && Number.isFinite(data.raFinalValue) && data.raFinalValue > 0
        ? data.raFinalValue
        : undefined,
    raFinancialRemarks:
      typeof data.raFinancialRemarks === 'string' && data.raFinancialRemarks
        ? data.raFinancialRemarks
        : undefined,
    checklist: Array.isArray(data.checklist) ? (data.checklist as Tender['checklist']) : [],
    remarks: Array.isArray(data.remarks) ? (data.remarks as Tender['remarks']) : [],
    attachments: Array.isArray(data.attachments)
      ? (data.attachments as Tender['attachments'])
      : [],
    createdAt: normalizeAdminFirestoreTimestamp(data.clientCreatedAt ?? data.createdAt, nowIso),
    updatedAt: normalizeAdminFirestoreTimestamp(data.clientUpdatedAt ?? data.updatedAt, nowIso),
  };
}

function docToEmdRecord(data: Record<string, unknown>, fallbackDocId = ''): EmdBgRecord {
  const resolvedId = String(data.id || fallbackDocId || '');
  return {
    id: resolvedId,
    tenderRefId: String(data.tenderRefId ?? ''),
    tenderId: String(data.tenderId ?? resolvedId),
    department: String(data.department ?? ''),
    instrumentType:
      (data.instrumentType as EmdBgRecord['instrumentType']) || 'Online / NEFT / RTGS',
    referenceNo: String(data.referenceNo ?? ''),
    bankName: String(data.bankName ?? ''),
    amount: Number(data.amount ?? 0),
    issueDate: String(data.issueDate ?? ''),
    expiryDate: String(data.expiryDate ?? ''),
    claimEndDate: String(data.claimEndDate ?? ''),
    status: (data.status as EmdBgRecord['status']) || 'Active / Locked',
    refundDate: String(data.refundDate ?? ''),
    refundRef: String(data.refundRef ?? ''),
    remarks: String(data.remarks ?? ''),
    attachments: Array.isArray(data.attachments)
      ? (data.attachments as EmdBgRecord['attachments'])
      : [],
  };
}

function docToMafTracker(data: Record<string, unknown>, fallbackDocId = ''): MafTrackerRecord {
  const nowIso = new Date().toISOString();
  const resolvedId = String(data.id || fallbackDocId || '');
  const rawItems = Array.isArray(data.itemsMAF)
    ? (data.itemsMAF as MafTrackerRecord['itemsMAF'])
    : [];
  return {
    id: resolvedId,
    tenderRefId: String(data.tenderRefId ?? ''),
    tenderId: String(data.tenderId ?? resolvedId),
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
    createdAt: normalizeAdminFirestoreTimestamp(data.clientCreatedAt ?? data.createdAt, nowIso),
    updatedAt: normalizeAdminFirestoreTimestamp(data.clientUpdatedAt ?? data.updatedAt, nowIso),
  };
}

function docToOemRecord(data: Record<string, unknown>, fallbackDocId = ''): OemRecord {
  const nowIso = new Date().toISOString();
  const resolvedId = String(data.id || fallbackDocId || '');
  return {
    id: resolvedId,
    oemName: String(data.oemName ?? ''),
    companyName: String(data.companyName ?? ''),
    concernedPersonName: String(data.concernedPersonName ?? ''),
    email: String(data.email ?? ''),
    phone: String(data.phone ?? ''),
    remarks: String(data.remarks ?? ''),
    createdAt: normalizeAdminFirestoreTimestamp(data.clientCreatedAt ?? data.createdAt, nowIso),
    updatedAt: normalizeAdminFirestoreTimestamp(data.clientUpdatedAt ?? data.updatedAt, nowIso),
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

function docToEmailAlertLog(data: Record<string, unknown>, fallbackDocId = ''): EmailAlertLog {
  const nowIso = new Date().toISOString();
  return {
    id: String(data.id ?? fallbackDocId ?? ''),
    slotKey: String(data.slotKey ?? data.id ?? fallbackDocId ?? ''),
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
    createdAt: normalizeAdminFirestoreTimestamp(data.clientCreatedAt ?? data.createdAt, nowIso),
  };
}

/**
 * Ensures doc `createdAt` metadata & terminal guards are known from server before a write.
 * Skips Firestore reads only for documents already known to have a valid Firestore Timestamp
 * (unless `forceServer` is explicitly requested).
 */
async function primeDocMetadataForPaths(
  ctx: CloudTargetContext,
  entries: Array<{
    docRef: ReturnType<typeof doc>;
    path: string;
    kind?: 'tender' | 'emd';
  }>,
  options?: { forceServer?: boolean },
): Promise<void> {
  const forceServer = Boolean(options?.forceServer);
  const seenPaths = new Set<string>();
  const toFetch = entries.filter((e) => {
    if (seenPaths.has(e.path)) return false;
    seenPaths.add(e.path);
    const key = buildDocCacheKey(ctx, e.path);
    if (forceServer) {
      cloudCreatedAtCache.delete(key);
      return true;
    }
    return !isFirestoreTimestampObject(cloudCreatedAtCache.get(key));
  });
  if (toFetch.length === 0) return;

  await runInBatches(toFetch, 10, async (entry) => {
    try {
      const snap = await readDocPreferServer(entry.docRef);
      rememberDocMetadata(ctx, entry.path, snap.exists() ? snap.data() : null, entry.kind, {
        fromPendingWrite: snap.metadata.hasPendingWrites,
        fromCache: snap.metadata.fromCache,
      });
    } catch {
      try {
        const snap = await getDoc(entry.docRef);
        rememberDocMetadata(ctx, entry.path, snap.exists() ? snap.data() : null, entry.kind, {
          fromPendingWrite: snap.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache,
        });
      } catch {
        // Leave uncached if read failed transiently; caller handles error cleanly on write
      }
    }
  });
}

interface BatchWriteOp {
  type: 'set' | 'delete';
  ref: ReturnType<typeof doc>;
  path: string;
  data?: Record<string, unknown>;
  approxBytes?: number;
  usedServerCreatedAt?: boolean;
}

/**
 * Commits mixed Firestore set/delete operations using writeBatch in safe <=400-op chunks
 * (or byte-budgeted chunks for heavy attachments), yielding cleanly between chunks.
 */
async function commitWriteBatchOps(
  ctx: CloudTargetContext,
  ops: readonly BatchWriteOp[],
  options?: { maxOpsPerBatch?: number; maxBytesPerBatch?: number; suppressErrorWrap?: boolean },
): Promise<void> {
  if (ops.length === 0) return;
  const maxOps = options?.maxOpsPerBatch ?? 400;
  const maxBytes = options?.maxBytesPerBatch ?? 0;

  let chunks: BatchWriteOp[][];
  if (maxBytes > 0) {
    chunks = [];
    let currentChunk: BatchWriteOp[] = [];
    let currentBytes = 0;
    for (const op of ops) {
      const opBytes = op.approxBytes ?? 2048;
      if (
        currentChunk.length > 0 &&
        (currentChunk.length >= maxOps || currentBytes + opBytes > maxBytes)
      ) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentBytes = 0;
      }
      currentChunk.push(op);
      currentBytes += opBytes;
    }
    if (currentChunk.length > 0) chunks.push(currentChunk);
  } else {
    chunks = chunkOperations(ops, maxOps);
  }

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const batch = writeBatch(ctx.db);
    for (const op of chunk) {
      if (op.type === 'set' && op.data) {
        batch.set(op.ref, op.data);
      } else if (op.type === 'delete') {
        batch.delete(op.ref);
      }
    }
    try {
      await batch.commit();
      for (const op of chunk) {
        if (op.type === 'delete') {
          rememberDocMetadata(ctx, op.path, null);
        } else if (op.type === 'set' && op.usedServerCreatedAt) {
          // Force next write to read the assigned server Timestamp instead of keeping null cached
          cloudCreatedAtCache.delete(buildDocCacheKey(ctx, op.path));
        }
      }
    } catch (error) {
      if (options?.suppressErrorWrap) {
        throw error;
      }
      const firstOp = chunk[0];
      handleFirestoreError(
        error,
        firstOp?.type === 'delete' ? OperationType.DELETE : OperationType.WRITE,
        firstOp?.path ?? null,
      );
    }
    if (i < chunks.length - 1) {
      await yieldToMainThread();
    }
  }
}

/**
 * Delta query helper:
 * 1) Reads persistent local IndexedDB cache first (if available) in ~2-5ms.
 * 2) When sinceMs > 0 and local cache has docs and !forceFull, queries server for ONLY
 *    `updatedAt > sinceMs` and merges changed docs cleanly.
 * 3) Automatically falls back to full ownerUid query if composite index is absent.
 */
async function queryCollectionDeltaOrFull(
  ctx: CloudTargetContext,
  uid: string,
  scopedTenant: string | null,
  colName: string,
  prefix: string,
  options?: { sinceMs?: number; forceFull?: boolean; kind?: 'tender' | 'emd' },
): Promise<QueryDocumentSnapshot[]> {
  const colRef = getScopedCollection(ctx, uid, scopedTenant, colName);
  const baseQuery: Query = query(colRef, where('ownerUid', '==', uid));
  const sinceMs = options?.forceFull ? 0 : resolveQuerySinceTimestampMs(options?.sinceMs);

  let cachedDocs: QueryDocumentSnapshot[] = [];
  if (!options?.forceFull && sinceMs > 0) {
    try {
      const cacheSnap = await getDocsFromCache(baseQuery);
      cachedDocs = cacheSnap.docs;
    } catch {
      cachedDocs = [];
    }
  }

  if (!options?.forceFull && sinceMs > 0 && cachedDocs.length > 0) {
    try {
      const deltaQuery = query(
        colRef,
        where('ownerUid', '==', uid),
        where('updatedAt', '>', Timestamp.fromMillis(sinceMs)),
      );
      const deltaSnap = await getDocs(deltaQuery);
      const byId = new Map<string, QueryDocumentSnapshot>();
      for (const d of cachedDocs) {
        rememberDocMetadata(ctx, `${prefix}/${colName}/${d.id}`, d.data(), options?.kind, {
          fromCache: true,
          fromPendingWrite: d.metadata.hasPendingWrites,
        });
        byId.set(d.id, d);
      }
      for (const d of deltaSnap.docs) {
        rememberDocMetadata(ctx, `${prefix}/${colName}/${d.id}`, d.data(), options?.kind, {
          fromCache: d.metadata.fromCache,
          fromPendingWrite: d.metadata.hasPendingWrites,
        });
        byId.set(d.id, d);
      }
      return Array.from(byId.values());
    } catch (err) {
      if (!shouldFallbackFromMissingIndex(err)) {
        // Still try standard base query below on transient error before throwing
      }
    }
  }

  const fullSnap = await getDocs(baseQuery);
  for (const d of fullSnap.docs) {
    rememberDocMetadata(ctx, `${prefix}/${colName}/${d.id}`, d.data(), options?.kind, {
      fromCache: d.metadata.fromCache,
      fromPendingWrite: d.metadata.hasPendingWrites,
    });
  }
  return fullSnap.docs;
}

export async function ensureUserRootDocument(
  user: User,
  workspaceTenantId?: string | null,
  sessionMeta?: Pick<CrmUserSession, 'username' | 'email'> | null,
  target?: CloudTargetContext | null,
  options?: { forceServerCheck?: boolean },
): Promise<void> {
  const { ctx, scopedTenant } = resolveScope(user.uid, workspaceTenantId, target);
  const cacheKey = `${ctx.projectId}::${ctx.databaseId || '(default)'}::${user.uid}::${scopedTenant || 'root'}`;
  if (options?.forceServerCheck) {
    ensuredWorkspaceKeys.delete(cacheKey);
  }
  if (ensuredWorkspaceKeys.has(cacheKey)) return;

  const userPath = `users/${user.uid}`;
  const userRef = doc(ctx.db, 'users', user.uid);
  const safeEmail = (user.email ?? '').slice(0, 200);
  try {
    const snap = await readDocPreferServer(userRef);
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
      const hasUnexpectedKeys = Object.keys(data).some((k) => !USER_ROOT_ALLOWED_KEYS.has(k));
      const validCreatedAt = pickValidExistingCreatedAt(data.createdAt);
      const needsRepair =
        data.ownerUid !== user.uid ||
        data.email !== safeEmail ||
        !validCreatedAt ||
        hasUnexpectedKeys;
      if (needsRepair) {
        await setDoc(userRef, {
          ownerUid: user.uid,
          email: safeEmail,
          createdAt: validCreatedAt ?? now,
          updatedAt: now,
        });
      }
    }

    if (scopedTenant) {
      const wsRef = doc(ctx.db, 'users', user.uid, 'workspaces', scopedTenant);
      const wsSnap = await readDocPreferServer(wsRef);
      const existingCreatedAt = pickValidExistingCreatedAt(
        wsSnap.exists() ? wsSnap.data().createdAt : undefined,
      );
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
        const hasUnexpectedWsKeys = Object.keys(wsData).some(
          (k) => !WORKSPACE_ROOT_ALLOWED_KEYS.has(k),
        );
        if (
          wsData.ownerUid !== user.uid ||
          wsData.tenantId !== scopedTenant ||
          !isFirestoreTimestampObject(wsData.createdAt) ||
          hasUnexpectedWsKeys
        ) {
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

async function setDocWithPermissionRecovery(params: {
  user: User;
  ctx: CloudTargetContext;
  workspaceTenantId?: string | null;
  docRef: ReturnType<typeof doc>;
  path: string;
  kind?: 'tender' | 'emd';
  buildPayload: (existingCreatedAt: unknown) => Record<string, unknown>;
}): Promise<void> {
  const { user, ctx, workspaceTenantId, docRef, path, kind, buildPayload } = params;
  const cacheKey = buildDocCacheKey(ctx, path);
  await ensureUserRootDocument(user, workspaceTenantId, null, ctx);
  await primeDocMetadataForPaths(ctx, [{ docRef, path, kind }]);

  const writeAttempt = async () => {
    const existingCreatedAt = pickValidExistingCreatedAt(cloudCreatedAtCache.get(cacheKey));
    const payload = buildPayload(existingCreatedAt);
    await setDoc(docRef, payload);
    if (!existingCreatedAt) {
      cloudCreatedAtCache.delete(cacheKey);
    }
  };

  try {
    await writeAttempt();
  } catch (err) {
    if (!isPermissionDeniedError(err)) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
    try {
      await user.getIdToken(true).catch(() => '');
      await ensureUserRootDocument(user, workspaceTenantId, null, ctx, {
        forceServerCheck: true,
      });
      await primeDocMetadataForPaths(ctx, [{ docRef, path, kind }], { forceServer: true });
      await writeAttempt();
    } catch (retryErr) {
      handleFirestoreError(retryErr, OperationType.WRITE, path);
    }
  }
}

export async function syncSecondaryUserToCloud(
  user: User,
  summary: SecondaryUserSummary,
): Promise<void> {
  const candidateIds = Array.from(
    new Set([summary.userId, ...(summary.aliasUserIds ?? [])].map((id) => sanitizeDocId(id))),
  );
  const primarySafeId = sanitizeDocId(summary.userId);
  await runInBatches(candidateIds, 6, async (safeId) => {
    const ref = doc(centralDb, 'secondaryUsers', safeId);
    try {
      const snap = await getDoc(ref);
      // Update canonical doc always; only update alias docs that already exist
      if (safeId !== primarySafeId && !snap.exists()) return;
      const existingData = snap.exists() ? snap.data() : null;
      const existingCreatedAt = pickValidExistingCreatedAt(existingData?.createdAt);
      const ownerUid =
        existingData && typeof existingData.ownerUid === 'string' && existingData.ownerUid.trim()
          ? existingData.ownerUid
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
  });
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
        const isEnabled =
          typeof data.isEnabled === 'boolean' ? data.isEnabled : data.isActive !== false;
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
          isActive: isEnabled && data.isActive !== false,
          isEnabled,
          presenceStatus:
            isEnabled && (data.presenceStatus === 'active' || data.presenceStatus === 'not_active')
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
  const path = `${prefix}/settings/preferences`;
  const ref = getScopedDoc(ctx, user.uid, scopedTenant, 'settings', 'preferences');
  await setDocWithPermissionRecovery({
    user,
    ctx,
    workspaceTenantId,
    docRef: ref,
    path,
    buildPayload: (existingCreatedAt) =>
      buildCloudPreferencesPayload(prefs, user.uid, serverTimestamp(), existingCreatedAt),
  });
}

export async function syncProfileToCloud(
  user: User,
  profile: FirmProfile,
  workspaceTenantId?: string | null,
  target?: CloudTargetContext | null,
): Promise<void> {
  const { ctx, scopedTenant, prefix } = resolveScope(user.uid, workspaceTenantId, target);
  const path = `${prefix}/profile/firm`;
  const ref = getScopedDoc(ctx, user.uid, scopedTenant, 'profile', 'firm');
  await setDocWithPermissionRecovery({
    user,
    ctx,
    workspaceTenantId,
    docRef: ref,
    path,
    buildPayload: (existingCreatedAt) =>
      buildCloudProfilePayload(profile, user.uid, serverTimestamp(), existingCreatedAt),
  });
}

export async function syncEmailConfigToCloud(
  user: User,
  config: EmailAlertSettings,
  workspaceTenantId?: string | null,
  target?: CloudTargetContext | null,
): Promise<void> {
  const { ctx, scopedTenant, prefix } = resolveScope(user.uid, workspaceTenantId, target);
  const path = `${prefix}/emailConfig/default`;
  const ref = getScopedDoc(ctx, user.uid, scopedTenant, 'emailConfig', 'default');
  await setDocWithPermissionRecovery({
    user,
    ctx,
    workspaceTenantId,
    docRef: ref,
    path,
    buildPayload: (existingCreatedAt) =>
      buildCloudEmailConfigPayload(config, user.uid, serverTimestamp(), existingCreatedAt),
  });
}

export async function syncSheetConfigToCloud(
  user: User,
  config: GoogleSheetSettings,
  workspaceTenantId?: string | null,
  target?: CloudTargetContext | null,
): Promise<void> {
  const { ctx, scopedTenant, prefix } = resolveScope(user.uid, workspaceTenantId, target);
  const path = `${prefix}/sheetConfig/default`;
  const ref = getScopedDoc(ctx, user.uid, scopedTenant, 'sheetConfig', 'default');
  await setDocWithPermissionRecovery({
    user,
    ctx,
    workspaceTenantId,
    docRef: ref,
    path,
    buildPayload: (existingCreatedAt) =>
      buildCloudSheetConfigPayload(config, user.uid, serverTimestamp(), existingCreatedAt),
  });
}

export async function syncEmailAlertLogToCloud(
  user: User,
  log: EmailAlertLog,
  workspaceTenantId?: string | null,
  target?: CloudTargetContext | null,
): Promise<void> {
  const { ctx, scopedTenant, prefix } = resolveScope(user.uid, workspaceTenantId, target);
  const safeId = sanitizeDocId(log.id);
  const path = `${prefix}/emailAlerts/${safeId}`;
  const ref = getScopedDoc(ctx, user.uid, scopedTenant, 'emailAlerts', safeId);
  await setDocWithPermissionRecovery({
    user,
    ctx,
    workspaceTenantId,
    docRef: ref,
    path,
    buildPayload: (existingCreatedAt) =>
      buildCloudEmailAlertLogPayload(
        { ...log, id: safeId },
        user.uid,
        serverTimestamp(),
        existingCreatedAt,
      ),
  });
}

/**
 * Batch-uploads attachments in byte-budgeted Firestore writeBatch chunks (<= 8 docs & <= 3.5 MB/commit)
 * skipping attachments already matched in the delta manifest or in-memory cache.
 */
export async function syncAttachmentFilesToCloud(
  user: User,
  attachments: AttachmentItem[] | undefined,
  workspaceTenantId?: string | null,
  target?: CloudTargetContext | null,
): Promise<void> {
  const list = (attachments ?? []).filter((a) => Boolean(a.dataUrl));
  if (list.length === 0) return;

  const { ctx, scopedTenant, prefix } = resolveScope(user.uid, workspaceTenantId, target);
  const scope = buildScopeDescriptor(ctx, user.uid, scopedTenant);
  const manifest = loadDeltaSyncManifest(scope);

  const candidates: Array<{ att: AttachmentItem; safeId: string; path: string; sig: string; cacheKey: string }> = [];
  for (const att of list) {
    const safeId = sanitizeDocId(att.id);
    const sig = signatureForAttachment(att);
    const cacheKey = `${ctx.projectId}:${ctx.databaseId || '(default)'}:${user.uid}:${scopedTenant || 'root'}:${safeId}:${sig}`;
    if (syncedAttachmentKeys.has(cacheKey) || manifest.signatures.attachments[safeId] === sig) {
      syncedAttachmentKeys.add(cacheKey);
      continue;
    }
    candidates.push({
      att,
      safeId,
      path: `${prefix}/attachmentFiles/${safeId}`,
      sig,
      cacheKey,
    });
  }

  if (candidates.length === 0) return;

  const primeEntries = candidates.map((c) => ({
    docRef: getScopedDoc(ctx, user.uid, scopedTenant, 'attachmentFiles', c.safeId),
    path: c.path,
  }));

  const buildAttOps = (nextSignatures: Record<string, string>): BatchWriteOp[] => {
    const ops: BatchWriteOp[] = [];
    for (const c of candidates) {
      const existingCreatedAt = pickValidExistingCreatedAt(
        cloudCreatedAtCache.get(buildDocCacheKey(ctx, c.path)),
      );
      const payload = buildCloudAttachmentFilePayload(
        c.att,
        user.uid,
        serverTimestamp(),
        existingCreatedAt,
      );
      if (!payload) continue;
      const approxBytes = utf8ByteLength(String(payload.dataUrl || '')) + 1024;
      ops.push({
        type: 'set',
        ref: getScopedDoc(ctx, user.uid, scopedTenant, 'attachmentFiles', c.safeId),
        path: c.path,
        data: payload,
        approxBytes,
        usedServerCreatedAt: !existingCreatedAt,
      });
      nextSignatures[c.safeId] = c.sig;
    }
    return ops;
  };

  await ensureUserRootDocument(user, workspaceTenantId, null, ctx);
  await primeDocMetadataForPaths(ctx, primeEntries);

  const nextSignatures = { ...manifest.signatures.attachments };
  const batchOps = buildAttOps(nextSignatures);
  if (batchOps.length === 0) return;

  try {
    await commitWriteBatchOps(ctx, batchOps, {
      maxOpsPerBatch: 8,
      maxBytesPerBatch: 3_500_000,
      suppressErrorWrap: true,
    });
  } catch (err) {
    if (!isPermissionDeniedError(err)) {
      const firstOp = batchOps[0];
      handleFirestoreError(err, OperationType.WRITE, firstOp?.path ?? null);
    }
    await user.getIdToken(true).catch(() => '');
    await ensureUserRootDocument(user, workspaceTenantId, null, ctx, { forceServerCheck: true });
    await primeDocMetadataForPaths(ctx, primeEntries, { forceServer: true });
    const retrySignatures = { ...manifest.signatures.attachments };
    const retryOps = buildAttOps(retrySignatures);
    await commitWriteBatchOps(ctx, retryOps, {
      maxOpsPerBatch: 8,
      maxBytesPerBatch: 3_500_000,
    });
    Object.assign(nextSignatures, retrySignatures);
  }

  for (const c of candidates) {
    syncedAttachmentKeys.add(c.cacheKey);
  }
  manifest.signatures.attachments = nextSignatures;
  saveDeltaSyncManifest(manifest);
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
  const safeId = sanitizeDocId(tender.id);
  const path = `${prefix}/tenders/${safeId}`;
  const ref = getScopedDoc(ctx, user.uid, scopedTenant, 'tenders', safeId);
  const docKey = buildDocCacheKey(ctx, path);
  if (cloudTerminalTenderCache.has(docKey) && !isBootstrappedAdminUser(user) && !ctx.isByoc) {
    return;
  }
  await setDocWithPermissionRecovery({
    user,
    ctx,
    workspaceTenantId,
    docRef: ref,
    path,
    kind: 'tender',
    buildPayload: (existingCreatedAt) =>
      buildCloudTenderPayload(
        { ...tender, id: safeId },
        user.uid,
        serverTimestamp(),
        existingCreatedAt,
      ),
  });
  await syncAttachmentFilesToCloud(user, tender.attachments, workspaceTenantId, ctx);
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
    await primeDocMetadataForPaths(ctx, [{ docRef: ref, path, kind: 'tender' }]);
    const docOwner = cloudOwnerUidCache.get(buildDocCacheKey(ctx, path));
    if (docOwner && docOwner !== user.uid) {
      throw new Error('PERMISSION_DENIED: Cannot delete record owned by another user.');
    }
    await deleteDoc(ref);
    rememberDocMetadata(ctx, path, null);
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
  const safeId = sanitizeDocId(record.id);
  const path = `${prefix}/emdRecords/${safeId}`;
  const ref = getScopedDoc(ctx, user.uid, scopedTenant, 'emdRecords', safeId);
  const docKey = buildDocCacheKey(ctx, path);
  if (cloudTerminalEmdCache.has(docKey) && !isBootstrappedAdminUser(user) && !ctx.isByoc) {
    return;
  }
  await setDocWithPermissionRecovery({
    user,
    ctx,
    workspaceTenantId,
    docRef: ref,
    path,
    kind: 'emd',
    buildPayload: (existingCreatedAt) =>
      buildCloudEmdPayload(
        { ...record, id: safeId },
        user.uid,
        serverTimestamp(),
        existingCreatedAt,
      ),
  });
  await syncAttachmentFilesToCloud(user, record.attachments, workspaceTenantId, ctx);
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
    await primeDocMetadataForPaths(ctx, [{ docRef: ref, path, kind: 'emd' }]);
    const docOwner = cloudOwnerUidCache.get(buildDocCacheKey(ctx, path));
    if (docOwner && docOwner !== user.uid) {
      throw new Error('PERMISSION_DENIED: Cannot delete record owned by another user.');
    }
    await deleteDoc(ref);
    rememberDocMetadata(ctx, path, null);
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
  const safeId = sanitizeDocId(tracker.id);
  const path = `${prefix}/maf_tracker/${safeId}`;
  const ref = getScopedDoc(ctx, user.uid, scopedTenant, 'maf_tracker', safeId);
  await setDocWithPermissionRecovery({
    user,
    ctx,
    workspaceTenantId,
    docRef: ref,
    path,
    buildPayload: (existingCreatedAt) =>
      buildCloudMafTrackerPayload(
        { ...tracker, id: safeId },
        user.uid,
        serverTimestamp(),
        existingCreatedAt,
      ),
  });
  const inlineMafAttachments = collectDirtyAttachmentsFromEntities({ mafTrackers: [tracker] });
  if (inlineMafAttachments.length > 0) {
    await syncAttachmentFilesToCloud(user, inlineMafAttachments, workspaceTenantId, ctx);
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
    await primeDocMetadataForPaths(ctx, [{ docRef: ref, path }]);
    const docOwner = cloudOwnerUidCache.get(buildDocCacheKey(ctx, path));
    if (docOwner && docOwner !== user.uid) {
      throw new Error('PERMISSION_DENIED: Cannot delete record owned by another user.');
    }
    await deleteDoc(ref);
    rememberDocMetadata(ctx, path, null);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function syncOemRecordToCloud(
  user: User,
  oem: OemRecord,
  workspaceTenantId?: string | null,
  target?: CloudTargetContext | null,
): Promise<void> {
  const { ctx, scopedTenant, prefix } = resolveScope(user.uid, workspaceTenantId, target);
  const safeId = sanitizeDocId(oem.id);
  const path = `${prefix}/oemDetails/${safeId}`;
  const ref = getScopedDoc(ctx, user.uid, scopedTenant, 'oemDetails', safeId);
  await setDocWithPermissionRecovery({
    user,
    ctx,
    workspaceTenantId,
    docRef: ref,
    path,
    buildPayload: (existingCreatedAt) =>
      buildCloudOemPayload(
        { ...oem, id: safeId },
        user.uid,
        serverTimestamp(),
        existingCreatedAt,
      ),
  });
}

export async function deleteOemRecordFromCloud(
  user: User,
  oemId: string,
  workspaceTenantId?: string | null,
  target?: CloudTargetContext | null,
): Promise<void> {
  const { ctx, scopedTenant, prefix } = resolveScope(user.uid, workspaceTenantId, target);
  const safeId = sanitizeDocId(oemId);
  const path = `${prefix}/oemDetails/${safeId}`;
  const ref = getScopedDoc(ctx, user.uid, scopedTenant, 'oemDetails', safeId);
  try {
    await primeDocMetadataForPaths(ctx, [{ docRef: ref, path }]);
    const docOwner = cloudOwnerUidCache.get(buildDocCacheKey(ctx, path));
    if (docOwner && docOwner !== user.uid) {
      throw new Error('PERMISSION_DENIED: Cannot delete record owned by another user.');
    }
    await deleteDoc(ref);
    rememberDocMetadata(ctx, path, null);
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
    rememberDocMetadata(ctx, path, snap.data());
    const dataUrl = snap.data().dataUrl;
    return typeof dataUrl === 'string' && dataUrl.length > 0 ? dataUrl : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

/**
 * Fetches core metadata collections in parallel (profile, preferences, configs, alerts, tenders,
 * emdRecords, maf_tracker, oemDetails) using local persistent cache + `updatedAt > lastSynced` delta queries.
 * Heavy `attachmentFiles` blobs can be skipped here and hydrated non-blockingly in the background.
 */
export async function fetchAllFromCloud(
  uid: string,
  workspaceTenantId?: string | null,
  target?: CloudTargetContext | null,
  options?: { includeAttachments?: boolean; sinceMs?: number; forceFull?: boolean },
): Promise<CloudWorkspaceDataset> {
  const { ctx, scopedTenant, prefix } = resolveScope(uid, workspaceTenantId, target);
  const scope = buildScopeDescriptor(ctx, uid, scopedTenant);
  const manifest = loadDeltaSyncManifest(scope);
  const effectiveSinceMs = options?.forceFull
    ? 0
    : options?.sinceMs !== undefined
      ? options.sinceMs
      : manifest.lastSyncedAtMs;
  const includeAttachments = options?.includeAttachments !== false;

  const profilePath = `${prefix}/profile/firm`;
  const prefsPath = `${prefix}/settings/preferences`;
  const emailConfigPath = `${prefix}/emailConfig/default`;
  const sheetConfigPath = `${prefix}/sheetConfig/default`;
  const emailAlertsPath = `${prefix}/emailAlerts`;
  const tendersPath = `${prefix}/tenders`;
  const emdPath = `${prefix}/emdRecords`;
  const mafPath = `${prefix}/maf_tracker`;
  const oemPath = `${prefix}/oemDetails`;
  const filesPath = `${prefix}/attachmentFiles`;

  const [
    profileSnap,
    prefsSnap,
    emailConfigSnap,
    sheetConfigSnap,
    tenderDocs,
    emdDocs,
    mafDocs,
    oemDocs,
    emailAlertDocs,
    fileDocs,
  ] = await Promise.all([
    getDoc(getScopedDoc(ctx, uid, scopedTenant, 'profile', 'firm')).catch((error) =>
      handleFirestoreError(error, OperationType.GET, profilePath),
    ),
    getDoc(getScopedDoc(ctx, uid, scopedTenant, 'settings', 'preferences')).catch((error) =>
      handleFirestoreError(error, OperationType.GET, prefsPath),
    ),
    getDoc(getScopedDoc(ctx, uid, scopedTenant, 'emailConfig', 'default')).catch((error) =>
      handleFirestoreError(error, OperationType.GET, emailConfigPath),
    ),
    getDoc(getScopedDoc(ctx, uid, scopedTenant, 'sheetConfig', 'default')).catch((error) =>
      handleFirestoreError(error, OperationType.GET, sheetConfigPath),
    ),
    queryCollectionDeltaOrFull(ctx, uid, scopedTenant, 'tenders', prefix, {
      sinceMs: effectiveSinceMs,
      forceFull: options?.forceFull,
      kind: 'tender',
    }).catch((error) => handleFirestoreError(error, OperationType.LIST, tendersPath)),
    queryCollectionDeltaOrFull(ctx, uid, scopedTenant, 'emdRecords', prefix, {
      sinceMs: effectiveSinceMs,
      forceFull: options?.forceFull,
      kind: 'emd',
    }).catch((error) => handleFirestoreError(error, OperationType.LIST, emdPath)),
    queryCollectionDeltaOrFull(ctx, uid, scopedTenant, 'maf_tracker', prefix, {
      sinceMs: effectiveSinceMs,
      forceFull: options?.forceFull,
    }).catch((error) => handleFirestoreError(error, OperationType.LIST, mafPath)),
    queryCollectionDeltaOrFull(ctx, uid, scopedTenant, 'oemDetails', prefix, {
      sinceMs: effectiveSinceMs,
      forceFull: options?.forceFull,
    }).catch((error) => handleFirestoreError(error, OperationType.LIST, oemPath)),
    queryCollectionDeltaOrFull(ctx, uid, scopedTenant, 'emailAlerts', prefix, {
      sinceMs: effectiveSinceMs,
      forceFull: options?.forceFull,
    }).catch((error) => handleFirestoreError(error, OperationType.LIST, emailAlertsPath)),
    includeAttachments
      ? queryCollectionDeltaOrFull(ctx, uid, scopedTenant, 'attachmentFiles', prefix, {
          sinceMs: effectiveSinceMs,
          forceFull: options?.forceFull,
        }).catch((error) => handleFirestoreError(error, OperationType.LIST, filesPath))
      : Promise.resolve([] as QueryDocumentSnapshot[]),
  ]);

  let profile: FirmProfile | null = null;
  if (profileSnap.exists()) {
    rememberDocMetadata(ctx, profilePath, profileSnap.data(), undefined, {
      fromPendingWrite: profileSnap.metadata.hasPendingWrites,
      fromCache: profileSnap.metadata.fromCache,
    });
    profile = docToProfile(profileSnap.data());
  } else {
    rememberDocMetadata(ctx, profilePath, null, undefined, {
      fromPendingWrite: profileSnap.metadata.hasPendingWrites,
      fromCache: profileSnap.metadata.fromCache,
    });
  }

  let preferences: UserPreferences | null = null;
  if (prefsSnap.exists()) {
    rememberDocMetadata(ctx, prefsPath, prefsSnap.data(), undefined, {
      fromPendingWrite: prefsSnap.metadata.hasPendingWrites,
      fromCache: prefsSnap.metadata.fromCache,
    });
    preferences = docToPreferences(prefsSnap.data());
  } else {
    rememberDocMetadata(ctx, prefsPath, null, undefined, {
      fromPendingWrite: prefsSnap.metadata.hasPendingWrites,
      fromCache: prefsSnap.metadata.fromCache,
    });
  }

  let emailConfig: EmailAlertSettings | null = null;
  if (emailConfigSnap.exists()) {
    rememberDocMetadata(ctx, emailConfigPath, emailConfigSnap.data(), undefined, {
      fromPendingWrite: emailConfigSnap.metadata.hasPendingWrites,
      fromCache: emailConfigSnap.metadata.fromCache,
    });
    emailConfig = docToEmailConfig(emailConfigSnap.data());
  } else {
    rememberDocMetadata(ctx, emailConfigPath, null, undefined, {
      fromPendingWrite: emailConfigSnap.metadata.hasPendingWrites,
      fromCache: emailConfigSnap.metadata.fromCache,
    });
  }

  let sheetConfig: GoogleSheetSettings | null = null;
  if (sheetConfigSnap.exists()) {
    rememberDocMetadata(ctx, sheetConfigPath, sheetConfigSnap.data(), undefined, {
      fromPendingWrite: sheetConfigSnap.metadata.hasPendingWrites,
      fromCache: sheetConfigSnap.metadata.fromCache,
    });
    sheetConfig = docToSheetConfig(sheetConfigSnap.data());
  } else {
    rememberDocMetadata(ctx, sheetConfigPath, null, undefined, {
      fromPendingWrite: sheetConfigSnap.metadata.hasPendingWrites,
      fromCache: sheetConfigSnap.metadata.fromCache,
    });
  }

  const tenders = tenderDocs.map((d) => docToTender(d.data(), d.id));
  const emdRecords = emdDocs.map((d) => docToEmdRecord(d.data(), d.id));
  const mafTrackers = mafDocs.map((d) => docToMafTracker(d.data(), d.id));
  const oemRecords = oemDocs
    .map((d) => docToOemRecord(d.data(), d.id))
    .filter((item) => item.oemName.trim().length > 0);
  const emailAlerts = emailAlertDocs
    .map((d) => docToEmailAlertLog(d.data(), d.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const attachmentFiles = new Map<string, string>();
  for (const d of fileDocs) {
    const data = d.data();
    if (typeof data.dataUrl === 'string' && data.dataUrl.length > 0) {
      attachmentFiles.set(String(data.id ?? d.id), data.dataUrl);
    }
  }

  // Record latest signatures & watermark for loaded core records
  const nowMs = Date.now();
  const nextManifest = loadDeltaSyncManifest(scope);
  nextManifest.lastSyncedAtMs = nowMs;
  nextManifest.lastSyncedIso = new Date(nowMs).toISOString();
  nextManifest.signatures.tenders = computeCollectionDeltaDiff(
    tenders,
    nextManifest.signatures.tenders,
    (t) => sanitizeDocId(t.id),
    signatureForTender,
  ).nextSignatures;
  nextManifest.signatures.emdRecords = computeCollectionDeltaDiff(
    emdRecords,
    nextManifest.signatures.emdRecords,
    (r) => sanitizeDocId(r.id),
    signatureForEmd,
  ).nextSignatures;
  nextManifest.signatures.mafTrackers = computeCollectionDeltaDiff(
    mafTrackers,
    nextManifest.signatures.mafTrackers,
    (m) => sanitizeDocId(m.id),
    signatureForMaf,
  ).nextSignatures;
  nextManifest.signatures.oemRecords = computeCollectionDeltaDiff(
    oemRecords,
    nextManifest.signatures.oemRecords,
    (o) => sanitizeDocId(o.id),
    signatureForOem,
  ).nextSignatures;
  if (profile) nextManifest.signatures.singletons.profile = signatureForProfile(profile);
  if (preferences) nextManifest.signatures.singletons.preferences = signatureForPreferences(preferences);
  if (emailConfig) nextManifest.signatures.singletons.emailConfig = signatureForEmailConfig(emailConfig);
  if (sheetConfig) nextManifest.signatures.singletons.sheetConfig = signatureForSheetConfig(sheetConfig);
  saveDeltaSyncManifest(nextManifest);

  return {
    profile,
    preferences,
    emailConfig,
    sheetConfig,
    emailAlerts,
    tenders,
    emdRecords,
    mafTrackers,
    oemRecords,
    attachmentFiles,
  };
}

/**
 * Fast startup hydration: fetches only core records in parallel (excluding heavy base64 attachments)
 * so the dashboard, tender list, OEM directory, MAF tracker, and BID/RA view render immediately.
 */
export async function fetchCoreCloudWorkspaceFast(
  uid: string,
  workspaceTenantId?: string | null,
  target?: CloudTargetContext | null,
  options?: { forceFull?: boolean },
): Promise<CloudWorkspaceDataset> {
  return fetchAllFromCloud(uid, workspaceTenantId, target, {
    includeAttachments: false,
    forceFull: options?.forceFull,
  });
}

/**
 * Non-blocking background attachment hydrator: fetches only missing attachment IDs referenced
 * by active tenders, EMD/BG records, and MAF items in small batches, yielding between batches
 * so scrolling and interactions remain completely responsive.
 */
export async function fetchMissingAttachmentsBackground(params: {
  uid: string;
  attachmentIds: string[];
  workspaceTenantId?: string | null;
  target?: CloudTargetContext | null;
  shouldCancel?: () => boolean;
  onBatchLoaded?: (batchMap: Map<string, string>) => void;
}): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const uniqueIds = Array.from(new Set(params.attachmentIds.map((id) => sanitizeDocId(id))));
  if (uniqueIds.length === 0) return result;

  const { ctx, scopedTenant, prefix } = resolveScope(
    params.uid,
    params.workspaceTenantId,
    params.target,
  );

  // For larger missing sets (>12), 1 collection query is faster than N individual getDocs
  if (uniqueIds.length > 12) {
    try {
      const fSnap = await getDocs(
        query(getScopedCollection(ctx, params.uid, scopedTenant, 'attachmentFiles'), where('ownerUid', '==', params.uid)),
      );
      if (params.shouldCancel?.()) return result;
      for (const d of fSnap.docs) {
        rememberDocMetadata(ctx, `${prefix}/attachmentFiles/${d.id}`, d.data());
        const data = d.data();
        if (typeof data.dataUrl === 'string' && data.dataUrl.length > 0) {
          result.set(String(data.id ?? d.id), data.dataUrl);
        }
      }
      if (result.size > 0) {
        params.onBatchLoaded?.(result);
      }
      return result;
    } catch {
      // Fall back to incremental per-ID loading below
    }
  }

  const chunks = chunkOperations(uniqueIds, 4);
  for (const chunk of chunks) {
    if (params.shouldCancel?.()) break;
    const batchMap = new Map<string, string>();
    await Promise.all(
      chunk.map(async (safeId) => {
        try {
          const path = `${prefix}/attachmentFiles/${safeId}`;
          const snap = await getDoc(
            getScopedDoc(ctx, params.uid, scopedTenant, 'attachmentFiles', safeId),
          );
          if (!snap.exists()) {
            rememberDocMetadata(ctx, path, null);
            return;
          }
          const data = snap.data();
          rememberDocMetadata(ctx, path, data);
          if (typeof data.dataUrl === 'string' && data.dataUrl.length > 0) {
            const key = String(data.id ?? safeId);
            batchMap.set(key, data.dataUrl);
            result.set(key, data.dataUrl);
          }
        } catch {
          // Non-fatal; subsequent manual download or restore can retry
        }
      }),
    );
    if (params.shouldCancel?.()) break;
    if (batchMap.size > 0) {
      params.onBatchLoaded?.(batchMap);
    }
    await yieldToMainThread();
  }

  return result;
}

export const KNOWN_ADMIN_UIDS = [
  '4uQty7KjogbYUmjY1ZxnJMtn7rj1',
  'JdizphoE56bNDu7OPtS4WZxrb0H2',
] as const;

export interface CloudWorkspaceDataset {
  profile: FirmProfile | null;
  preferences: UserPreferences | null;
  emailConfig: EmailAlertSettings | null;
  sheetConfig: GoogleSheetSettings | null;
  emailAlerts: EmailAlertLog[];
  tenders: Tender[];
  emdRecords: EmdBgRecord[];
  mafTrackers: MafTrackerRecord[];
  oemRecords: OemRecord[];
  attachmentFiles: Map<string, string>;
}

export function createEmptyCloudDataset(): CloudWorkspaceDataset {
  return {
    profile: null,
    preferences: null,
    emailConfig: null,
    sheetConfig: null,
    emailAlerts: [],
    tenders: [],
    emdRecords: [],
    mafTrackers: [],
    oemRecords: [],
    attachmentFiles: new Map<string, string>(),
  };
}

async function safeGetDocs(colRef: ReturnType<typeof collection>) {
  try {
    return await getDocs(colRef);
  } catch {
    return null;
  }
}

async function safeGetDoc(docRef: ReturnType<typeof doc>) {
  try {
    return await getDoc(docRef);
  } catch {
    return null;
  }
}

/**
 * Strictly for Bootstrapped Primary Admin (vanshsaxena7498@gmail.com).
 * Parallel read-only scan across sibling Admin UIDs, legacy root collections, and the (default) DB.
 * Designed so it can execute in a non-blocking background pass after fast core UI hydration.
 */
export async function fetchAdminLegacyFallbackWorkspace(
  adminUser: User,
  options?: { includeAttachments?: boolean },
): Promise<CloudWorkspaceDataset> {
  const supplemental = createEmptyCloudDataset();
  if (!isBootstrappedAdminUser(adminUser)) {
    return supplemental;
  }

  const includeAttachments = options?.includeAttachments !== false;
  const knownAdminUidSet = new Set<string>([adminUser.uid, ...KNOWN_ADMIN_UIDS]);
  const excludedSecondaryOwnerUids = new Set<string>();

  try {
    const secSnap = await safeGetDocs(collection(centralDb, 'secondaryUsers'));
    if (secSnap) {
      for (const d of secSnap.docs) {
        const data = d.data();
        const ownerUid = typeof data.ownerUid === 'string' ? data.ownerUid.trim() : '';
        const secId = typeof data.userId === 'string' ? data.userId.trim() : '';
        if (ownerUid && !knownAdminUidSet.has(ownerUid)) {
          excludedSecondaryOwnerUids.add(ownerUid);
        }
        if (secId && !knownAdminUidSet.has(secId)) {
          excludedSecondaryOwnerUids.add(secId);
        }
      }
    }
  } catch {
    // Non-fatal
  }

  const dbsToInspect: Firestore[] = defaultDb ? [centralDb, defaultDb] : [centralDb];
  const uidsToInspect = Array.from(knownAdminUidSet);

  const absorbCollectionDocs = (
    docs: Array<{ id: string; data: () => Record<string, unknown> }>,
    kind:
      | 'tenders'
      | 'emdRecords'
      | 'maf_tracker'
      | 'oemDetails'
      | 'attachmentFiles'
      | 'emailAlerts'
      | 'profile'
      | 'settings'
      | 'emailConfig'
      | 'sheetConfig',
  ) => {
    for (const d of docs) {
      const raw = d.data();
      if (isLegacyDocExcludedFromAdmin(raw, knownAdminUidSet, excludedSecondaryOwnerUids)) {
        continue;
      }
      if (kind === 'tenders') {
        const item = docToTender(raw, d.id);
        if (item.id && (item.title || item.tenderId)) {
          supplemental.tenders = mergeAdminRecordsById(supplemental.tenders, [item]);
        }
      } else if (kind === 'emdRecords') {
        const item = docToEmdRecord(raw, d.id);
        if (item.id && (item.tenderId || item.referenceNo)) {
          supplemental.emdRecords = mergeAdminRecordsById(supplemental.emdRecords, [item]);
        }
      } else if (kind === 'maf_tracker') {
        const item = docToMafTracker(raw, d.id);
        if (item.id && (item.tenderId || item.itemsMAF.length > 0)) {
          supplemental.mafTrackers = mergeAdminRecordsById(supplemental.mafTrackers, [item]);
        }
      } else if (kind === 'oemDetails') {
        const item = docToOemRecord(raw, d.id);
        if (item.id && item.oemName.trim().length > 0) {
          supplemental.oemRecords = mergeAdminRecordsById(supplemental.oemRecords, [item]);
        }
      } else if (kind === 'attachmentFiles') {
        if (typeof raw.dataUrl === 'string' && raw.dataUrl.length > 0) {
          const attId = String(raw.id ?? d.id);
          if (!supplemental.attachmentFiles.has(attId)) {
            supplemental.attachmentFiles.set(attId, raw.dataUrl);
          }
        }
      } else if (kind === 'emailAlerts') {
        const item = docToEmailAlertLog(raw, d.id);
        if (item.id) {
          supplemental.emailAlerts = mergeAdminRecordsById(supplemental.emailAlerts, [item]);
        }
      } else if (kind === 'profile') {
        if (!supplemental.profile && (typeof raw.firmName === 'string' || typeof raw.adminName === 'string')) {
          supplemental.profile = docToProfile(raw);
        }
      } else if (kind === 'settings') {
        if (!supplemental.preferences && (raw.adminPin !== undefined || raw.darkMode !== undefined)) {
          supplemental.preferences = docToPreferences(raw);
        }
      } else if (kind === 'emailConfig') {
        if (!supplemental.emailConfig && typeof raw.recipientEmail === 'string') {
          supplemental.emailConfig = docToEmailConfig(raw);
        }
      } else if (kind === 'sheetConfig') {
        if (!supplemental.sheetConfig && typeof raw.webhookUrl === 'string') {
          supplemental.sheetConfig = docToSheetConfig(raw);
        }
      }
    }
  };

  await Promise.all(
    dbsToInspect.map(async (targetDb) => {
      const isCentralPrimaryDb = targetDb === centralDb;

      const uidInspectTasks = uidsToInspect.map(async (candidateUid) => {
        const skipStrictCurrentMatches = isCentralPrimaryDb && candidateUid === adminUser.uid;
        const rootDocSnap = await safeGetDoc(doc(targetDb, 'users', candidateUid));
        if (rootDocSnap?.exists()) {
          const rootEmail = String(rootDocSnap.data().email ?? '')
            .trim()
            .toLowerCase();
          if (rootEmail && rootEmail !== 'vanshsaxena7498@gmail.com') {
            excludedSecondaryOwnerUids.add(candidateUid);
            return;
          }
        }

        const singletonPromise = skipStrictCurrentMatches
          ? Promise.resolve([null, null, null, null] as const)
          : Promise.all([
              safeGetDoc(doc(targetDb, 'users', candidateUid, 'profile', 'firm')),
              safeGetDoc(doc(targetDb, 'users', candidateUid, 'settings', 'preferences')),
              safeGetDoc(doc(targetDb, 'users', candidateUid, 'emailConfig', 'default')),
              safeGetDoc(doc(targetDb, 'users', candidateUid, 'sheetConfig', 'default')),
            ]);

        const [
          [pSnap, sSnap, ecSnap, scSnap],
          [tSnap, eSnap, eLegacySnap, mSnap, oSnap, fSnap, eaSnap],
        ] = await Promise.all([
          singletonPromise,
          Promise.all([
            safeGetDocs(collection(targetDb, 'users', candidateUid, 'tenders')),
            safeGetDocs(collection(targetDb, 'users', candidateUid, 'emdRecords')),
            safeGetDocs(collection(targetDb, 'users', candidateUid, 'emd_bg_tracker')),
            safeGetDocs(collection(targetDb, 'users', candidateUid, 'maf_tracker')),
            safeGetDocs(collection(targetDb, 'users', candidateUid, 'oemDetails')),
            includeAttachments
              ? safeGetDocs(collection(targetDb, 'users', candidateUid, 'attachmentFiles'))
              : Promise.resolve(null),
            safeGetDocs(collection(targetDb, 'users', candidateUid, 'emailAlerts')),
          ]),
        ]);

        if (pSnap?.exists()) absorbCollectionDocs([{ id: pSnap.id, data: () => pSnap.data() }], 'profile');
        if (sSnap?.exists()) absorbCollectionDocs([{ id: sSnap.id, data: () => sSnap.data() }], 'settings');
        if (ecSnap?.exists()) absorbCollectionDocs([{ id: ecSnap.id, data: () => ecSnap.data() }], 'emailConfig');
        if (scSnap?.exists()) absorbCollectionDocs([{ id: scSnap.id, data: () => scSnap.data() }], 'sheetConfig');
        if (tSnap) absorbCollectionDocs(tSnap.docs, 'tenders');
        if (eSnap) absorbCollectionDocs(eSnap.docs, 'emdRecords');
        if (eLegacySnap) absorbCollectionDocs(eLegacySnap.docs, 'emdRecords');
        if (mSnap) absorbCollectionDocs(mSnap.docs, 'maf_tracker');
        if (oSnap) absorbCollectionDocs(oSnap.docs, 'oemDetails');
        if (fSnap) absorbCollectionDocs(fSnap.docs, 'attachmentFiles');
        if (eaSnap) absorbCollectionDocs(eaSnap.docs, 'emailAlerts');
      });

      const rootInspectTask = Promise.all([
        safeGetDocs(collection(targetDb, 'tenders')),
        safeGetDocs(collection(targetDb, 'emdRecords')),
        safeGetDocs(collection(targetDb, 'emd_bg_tracker')),
        safeGetDocs(collection(targetDb, 'maf_tracker')),
        safeGetDocs(collection(targetDb, 'oemDetails')),
        includeAttachments ? safeGetDocs(collection(targetDb, 'attachmentFiles')) : Promise.resolve(null),
        safeGetDocs(collection(targetDb, 'emailAlerts')),
        safeGetDocs(collection(targetDb, 'profile')),
        safeGetDocs(collection(targetDb, 'settings')),
        safeGetDocs(collection(targetDb, 'emailConfig')),
        safeGetDocs(collection(targetDb, 'sheetConfig')),
      ]).then(
        ([
          rootTenders,
          rootEmd,
          rootEmdLegacy,
          rootMaf,
          rootOems,
          rootFiles,
          rootEmailAlerts,
          rootProfile,
          rootSettings,
          rootEmailConfig,
          rootSheetConfig,
        ]) => {
          if (rootTenders) absorbCollectionDocs(rootTenders.docs, 'tenders');
          if (rootEmd) absorbCollectionDocs(rootEmd.docs, 'emdRecords');
          if (rootEmdLegacy) absorbCollectionDocs(rootEmdLegacy.docs, 'emdRecords');
          if (rootMaf) absorbCollectionDocs(rootMaf.docs, 'maf_tracker');
          if (rootOems) absorbCollectionDocs(rootOems.docs, 'oemDetails');
          if (rootFiles) absorbCollectionDocs(rootFiles.docs, 'attachmentFiles');
          if (rootEmailAlerts) absorbCollectionDocs(rootEmailAlerts.docs, 'emailAlerts');
          if (rootProfile) absorbCollectionDocs(rootProfile.docs, 'profile');
          if (rootSettings) absorbCollectionDocs(rootSettings.docs, 'settings');
          if (rootEmailConfig) absorbCollectionDocs(rootEmailConfig.docs, 'emailConfig');
          if (rootSheetConfig) absorbCollectionDocs(rootSheetConfig.docs, 'sheetConfig');
        },
      );

      await Promise.all([...uidInspectTasks, rootInspectTask]);
    }),
  );

  // Persist legacy scan completion timestamp in Admin's delta manifest
  const centralTarget = getCentralAdminCloudTarget();
  const scope = buildScopeDescriptor(centralTarget, adminUser.uid, null);
  const manifest = loadDeltaSyncManifest(scope);
  manifest.legacyScanDoneAtMs = Date.now();
  saveDeltaSyncManifest(manifest);

  return supplemental;
}

export function mergeCloudDatasets(
  primary: CloudWorkspaceDataset,
  supplemental: CloudWorkspaceDataset,
): CloudWorkspaceDataset {
  return {
    profile: primary.profile || supplemental.profile,
    preferences: primary.preferences || supplemental.preferences,
    emailConfig: primary.emailConfig || supplemental.emailConfig,
    sheetConfig: primary.sheetConfig || supplemental.sheetConfig,
    emailAlerts: mergeAdminRecordsById(primary.emailAlerts, supplemental.emailAlerts).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
    tenders: mergeAdminRecordsById(primary.tenders, supplemental.tenders),
    emdRecords: mergeAdminRecordsById(primary.emdRecords, supplemental.emdRecords),
    mafTrackers: mergeAdminRecordsById(primary.mafTrackers, supplemental.mafTrackers),
    oemRecords: mergeAdminRecordsById(primary.oemRecords, supplemental.oemRecords),
    attachmentFiles: mergeAdminAttachmentMaps(
      primary.attachmentFiles,
      supplemental.attachmentFiles,
    ),
  };
}

export async function fetchAdminCloudWorkspaceWithFallback(
  adminUser: User,
): Promise<{
  primary: CloudWorkspaceDataset;
  supplemental: CloudWorkspaceDataset;
  merged: CloudWorkspaceDataset;
}> {
  const centralTarget = getCentralAdminCloudTarget();
  const [primary, supplemental] = await Promise.all([
    fetchAllFromCloud(adminUser.uid, null, centralTarget, { includeAttachments: true, forceFull: true }),
    isBootstrappedAdminUser(adminUser)
      ? fetchAdminLegacyFallbackWorkspace(adminUser, { includeAttachments: true })
      : Promise.resolve(createEmptyCloudDataset()),
  ]);

  return {
    primary,
    supplemental,
    merged: mergeCloudDatasets(primary, supplemental),
  };
}

/**
 * Batch + Delta Cloud Sync:
 * Commits ONLY modified/added/removed records (or dirty snapshot keys) via Firestore `writeBatch`
 * chunks, preserving existing `createdAt` timestamps cleanly and optionally syncing heavy attachments
 * in the background after metadata commit completes.
 */
export async function syncDeltaBatchToCloud(params: {
  user: User;
  dirty: DirtySyncSnapshot;
  tenders: Tender[];
  emdRecords: EmdBgRecord[];
  mafTrackers: MafTrackerRecord[];
  oemRecords: OemRecord[];
  profile: FirmProfile;
  preferences: UserPreferences;
  emailConfig?: EmailAlertSettings;
  sheetConfig?: GoogleSheetSettings;
  workspaceTenantId?: string | null;
  target?: CloudTargetContext | null;
  deferAttachmentsToBackground?: boolean;
}): Promise<{ syncedOps: number; deferredAttachments: AttachmentItem[] }> {
  const {
    user,
    dirty,
    tenders,
    emdRecords,
    mafTrackers,
    oemRecords,
    profile,
    preferences,
    emailConfig,
    sheetConfig,
    workspaceTenantId,
    target,
    deferAttachmentsToBackground = true,
  } = params;

  const { ctx, scopedTenant, prefix } = resolveScope(user.uid, workspaceTenantId, target);
  await ensureUserRootDocument(user, workspaceTenantId, null, ctx);

  const scope = buildScopeDescriptor(ctx, user.uid, scopedTenant);
  const manifest = loadDeltaSyncManifest(scope);

  const tenderById = new Map(tenders.map((t) => [sanitizeDocId(t.id), t]));
  const emdById = new Map(emdRecords.map((r) => [sanitizeDocId(r.id), r]));
  const mafById = new Map(mafTrackers.map((m) => [sanitizeDocId(m.id), m]));
  const oemById = new Map(oemRecords.map((o) => [sanitizeDocId(o.id), o]));

  const metadataPrimeEntries: Array<{
    docRef: ReturnType<typeof doc>;
    path: string;
    kind?: 'tender' | 'emd';
  }> = [];

  for (const id of [...dirty.tenders.upserts, ...dirty.tenders.deletes]) {
    const safeId = sanitizeDocId(id);
    metadataPrimeEntries.push({
      docRef: getScopedDoc(ctx, user.uid, scopedTenant, 'tenders', safeId),
      path: `${prefix}/tenders/${safeId}`,
      kind: 'tender',
    });
  }
  for (const id of [...dirty.emdRecords.upserts, ...dirty.emdRecords.deletes]) {
    const safeId = sanitizeDocId(id);
    metadataPrimeEntries.push({
      docRef: getScopedDoc(ctx, user.uid, scopedTenant, 'emdRecords', safeId),
      path: `${prefix}/emdRecords/${safeId}`,
      kind: 'emd',
    });
  }
  for (const id of [...dirty.mafTrackers.upserts, ...dirty.mafTrackers.deletes]) {
    const safeId = sanitizeDocId(id);
    metadataPrimeEntries.push({
      docRef: getScopedDoc(ctx, user.uid, scopedTenant, 'maf_tracker', safeId),
      path: `${prefix}/maf_tracker/${safeId}`,
    });
  }
  for (const id of [...dirty.oemRecords.upserts, ...dirty.oemRecords.deletes]) {
    const safeId = sanitizeDocId(id);
    metadataPrimeEntries.push({
      docRef: getScopedDoc(ctx, user.uid, scopedTenant, 'oemDetails', safeId),
      path: `${prefix}/oemDetails/${safeId}`,
    });
  }
  for (const singleton of dirty.singletons) {
    if (singleton === 'profile') {
      metadataPrimeEntries.push({
        docRef: getScopedDoc(ctx, user.uid, scopedTenant, 'profile', 'firm'),
        path: `${prefix}/profile/firm`,
      });
    } else if (singleton === 'preferences') {
      metadataPrimeEntries.push({
        docRef: getScopedDoc(ctx, user.uid, scopedTenant, 'settings', 'preferences'),
        path: `${prefix}/settings/preferences`,
      });
    } else if (singleton === 'emailConfig' && emailConfig) {
      metadataPrimeEntries.push({
        docRef: getScopedDoc(ctx, user.uid, scopedTenant, 'emailConfig', 'default'),
        path: `${prefix}/emailConfig/default`,
      });
    } else if (singleton === 'sheetConfig' && sheetConfig) {
      metadataPrimeEntries.push({
        docRef: getScopedDoc(ctx, user.uid, scopedTenant, 'sheetConfig', 'default'),
        path: `${prefix}/sheetConfig/default`,
      });
    }
  }

  const buildDeltaOpsFromCache = () => {
    const ops: BatchWriteOp[] = [];
    const upsertedTenders: Tender[] = [];
    const upsertedEmd: EmdBgRecord[] = [];
    const upsertedMaf: MafTrackerRecord[] = [];
    const nextManifest = loadDeltaSyncManifest(scope);
    const isAdminUser = isBootstrappedAdminUser(user);

    // Singletons
    for (const singleton of dirty.singletons) {
      if (singleton === 'profile') {
        const path = `${prefix}/profile/firm`;
        const existingCreatedAt = pickValidExistingCreatedAt(
          cloudCreatedAtCache.get(buildDocCacheKey(ctx, path)),
        );
        ops.push({
          type: 'set',
          ref: getScopedDoc(ctx, user.uid, scopedTenant, 'profile', 'firm'),
          path,
          data: buildCloudProfilePayload(profile, user.uid, serverTimestamp(), existingCreatedAt),
          usedServerCreatedAt: !existingCreatedAt,
        });
        nextManifest.signatures.singletons.profile = signatureForProfile(profile);
      } else if (singleton === 'preferences') {
        const path = `${prefix}/settings/preferences`;
        const existingCreatedAt = pickValidExistingCreatedAt(
          cloudCreatedAtCache.get(buildDocCacheKey(ctx, path)),
        );
        ops.push({
          type: 'set',
          ref: getScopedDoc(ctx, user.uid, scopedTenant, 'settings', 'preferences'),
          path,
          data: buildCloudPreferencesPayload(
            preferences,
            user.uid,
            serverTimestamp(),
            existingCreatedAt,
          ),
          usedServerCreatedAt: !existingCreatedAt,
        });
        nextManifest.signatures.singletons.preferences = signatureForPreferences(preferences);
      } else if (singleton === 'emailConfig' && emailConfig) {
        const path = `${prefix}/emailConfig/default`;
        const existingCreatedAt = pickValidExistingCreatedAt(
          cloudCreatedAtCache.get(buildDocCacheKey(ctx, path)),
        );
        ops.push({
          type: 'set',
          ref: getScopedDoc(ctx, user.uid, scopedTenant, 'emailConfig', 'default'),
          path,
          data: buildCloudEmailConfigPayload(
            emailConfig,
            user.uid,
            serverTimestamp(),
            existingCreatedAt,
          ),
          usedServerCreatedAt: !existingCreatedAt,
        });
        nextManifest.signatures.singletons.emailConfig = signatureForEmailConfig(emailConfig);
      } else if (singleton === 'sheetConfig' && sheetConfig) {
        const path = `${prefix}/sheetConfig/default`;
        const existingCreatedAt = pickValidExistingCreatedAt(
          cloudCreatedAtCache.get(buildDocCacheKey(ctx, path)),
        );
        ops.push({
          type: 'set',
          ref: getScopedDoc(ctx, user.uid, scopedTenant, 'sheetConfig', 'default'),
          path,
          data: buildCloudSheetConfigPayload(
            sheetConfig,
            user.uid,
            serverTimestamp(),
            existingCreatedAt,
          ),
          usedServerCreatedAt: !existingCreatedAt,
        });
        nextManifest.signatures.singletons.sheetConfig = signatureForSheetConfig(sheetConfig);
      }
    }

    // Tenders upserts + deletes
    for (const id of dirty.tenders.upserts) {
      const safeId = sanitizeDocId(id);
      const tender = tenderById.get(safeId);
      if (!tender) continue;
      const path = `${prefix}/tenders/${safeId}`;
      const docKey = buildDocCacheKey(ctx, path);
      if (cloudTerminalTenderCache.has(docKey) && !isAdminUser && !ctx.isByoc) {
        continue;
      }
      const existingCreatedAt = pickValidExistingCreatedAt(cloudCreatedAtCache.get(docKey));
      ops.push({
        type: 'set',
        ref: getScopedDoc(ctx, user.uid, scopedTenant, 'tenders', safeId),
        path,
        data: buildCloudTenderPayload(
          { ...tender, id: safeId },
          user.uid,
          serverTimestamp(),
          existingCreatedAt,
        ),
        usedServerCreatedAt: !existingCreatedAt,
      });
      nextManifest.signatures.tenders[safeId] = signatureForTender(tender);
      upsertedTenders.push(tender);
    }
    for (const id of dirty.tenders.deletes) {
      const safeId = sanitizeDocId(id);
      const path = `${prefix}/tenders/${safeId}`;
      const docOwner = cloudOwnerUidCache.get(buildDocCacheKey(ctx, path));
      if (docOwner && docOwner !== user.uid) continue;
      ops.push({
        type: 'delete',
        ref: getScopedDoc(ctx, user.uid, scopedTenant, 'tenders', safeId),
        path,
      });
      delete nextManifest.signatures.tenders[safeId];
    }

    // EMD/BG upserts + deletes
    for (const id of dirty.emdRecords.upserts) {
      const safeId = sanitizeDocId(id);
      const record = emdById.get(safeId);
      if (!record) continue;
      const path = `${prefix}/emdRecords/${safeId}`;
      const docKey = buildDocCacheKey(ctx, path);
      if (cloudTerminalEmdCache.has(docKey) && !isAdminUser && !ctx.isByoc) {
        continue;
      }
      const existingCreatedAt = pickValidExistingCreatedAt(cloudCreatedAtCache.get(docKey));
      ops.push({
        type: 'set',
        ref: getScopedDoc(ctx, user.uid, scopedTenant, 'emdRecords', safeId),
        path,
        data: buildCloudEmdPayload(
          { ...record, id: safeId },
          user.uid,
          serverTimestamp(),
          existingCreatedAt,
        ),
        usedServerCreatedAt: !existingCreatedAt,
      });
      nextManifest.signatures.emdRecords[safeId] = signatureForEmd(record);
      upsertedEmd.push(record);
    }
    for (const id of dirty.emdRecords.deletes) {
      const safeId = sanitizeDocId(id);
      const path = `${prefix}/emdRecords/${safeId}`;
      const docOwner = cloudOwnerUidCache.get(buildDocCacheKey(ctx, path));
      if (docOwner && docOwner !== user.uid) continue;
      ops.push({
        type: 'delete',
        ref: getScopedDoc(ctx, user.uid, scopedTenant, 'emdRecords', safeId),
        path,
      });
      delete nextManifest.signatures.emdRecords[safeId];
    }

    // MAF upserts + deletes
    for (const id of dirty.mafTrackers.upserts) {
      const safeId = sanitizeDocId(id);
      const tracker = mafById.get(safeId);
      if (!tracker) continue;
      const path = `${prefix}/maf_tracker/${safeId}`;
      const existingCreatedAt = pickValidExistingCreatedAt(
        cloudCreatedAtCache.get(buildDocCacheKey(ctx, path)),
      );
      ops.push({
        type: 'set',
        ref: getScopedDoc(ctx, user.uid, scopedTenant, 'maf_tracker', safeId),
        path,
        data: buildCloudMafTrackerPayload(
          { ...tracker, id: safeId },
          user.uid,
          serverTimestamp(),
          existingCreatedAt,
        ),
        usedServerCreatedAt: !existingCreatedAt,
      });
      nextManifest.signatures.mafTrackers[safeId] = signatureForMaf(tracker);
      upsertedMaf.push(tracker);
    }
    for (const id of dirty.mafTrackers.deletes) {
      const safeId = sanitizeDocId(id);
      const path = `${prefix}/maf_tracker/${safeId}`;
      const docOwner = cloudOwnerUidCache.get(buildDocCacheKey(ctx, path));
      if (docOwner && docOwner !== user.uid) continue;
      ops.push({
        type: 'delete',
        ref: getScopedDoc(ctx, user.uid, scopedTenant, 'maf_tracker', safeId),
        path,
      });
      delete nextManifest.signatures.mafTrackers[safeId];
    }

    // OEM upserts + deletes
    for (const id of dirty.oemRecords.upserts) {
      const safeId = sanitizeDocId(id);
      const oem = oemById.get(safeId);
      if (!oem) continue;
      const path = `${prefix}/oemDetails/${safeId}`;
      const existingCreatedAt = pickValidExistingCreatedAt(
        cloudCreatedAtCache.get(buildDocCacheKey(ctx, path)),
      );
      ops.push({
        type: 'set',
        ref: getScopedDoc(ctx, user.uid, scopedTenant, 'oemDetails', safeId),
        path,
        data: buildCloudOemPayload(
          { ...oem, id: safeId },
          user.uid,
          serverTimestamp(),
          existingCreatedAt,
        ),
        usedServerCreatedAt: !existingCreatedAt,
      });
      nextManifest.signatures.oemRecords[safeId] = signatureForOem(oem);
    }
    for (const id of dirty.oemRecords.deletes) {
      const safeId = sanitizeDocId(id);
      const path = `${prefix}/oemDetails/${safeId}`;
      const docOwner = cloudOwnerUidCache.get(buildDocCacheKey(ctx, path));
      if (docOwner && docOwner !== user.uid) continue;
      ops.push({
        type: 'delete',
        ref: getScopedDoc(ctx, user.uid, scopedTenant, 'oemDetails', safeId),
        path,
      });
      delete nextManifest.signatures.oemRecords[safeId];
    }

    return { ops, upsertedTenders, upsertedEmd, upsertedMaf, nextManifest };
  };

  await primeDocMetadataForPaths(ctx, metadataPrimeEntries);
  let built = buildDeltaOpsFromCache();

  try {
    await commitWriteBatchOps(ctx, built.ops, { suppressErrorWrap: true });
  } catch (err) {
    if (!isPermissionDeniedError(err)) {
      const firstOp = built.ops[0];
      handleFirestoreError(
        err,
        firstOp?.type === 'delete' ? OperationType.DELETE : OperationType.WRITE,
        firstOp?.path ?? null,
      );
    }
    // Recover from stale parent user doc or stale createdAt cache by refreshing server metadata & retrying once
    await user.getIdToken(true).catch(() => '');
    await ensureUserRootDocument(user, workspaceTenantId, null, ctx, { forceServerCheck: true });
    await primeDocMetadataForPaths(ctx, metadataPrimeEntries, { forceServer: true });
    built = buildDeltaOpsFromCache();

    try {
      await commitWriteBatchOps(ctx, built.ops, { suppressErrorWrap: true });
    } catch (retryErr) {
      if (built.ops.length > 1 && isPermissionDeniedError(retryErr)) {
        // Isolate valid ops from any single unpermitted doc so unrelated edits still save cleanly
        let firstFailure: unknown = null;
        let firstFailedOp: BatchWriteOp | null = null;
        for (const singleOp of built.ops) {
          try {
            await commitWriteBatchOps(ctx, [singleOp], { suppressErrorWrap: true });
          } catch (singleErr) {
            if (!firstFailure) {
              firstFailure = singleErr;
              firstFailedOp = singleOp;
            }
          }
        }
        if (firstFailure) {
          handleFirestoreError(
            firstFailure,
            firstFailedOp?.type === 'delete' ? OperationType.DELETE : OperationType.WRITE,
            firstFailedOp?.path ?? null,
          );
        }
      } else {
        const firstOp = built.ops[0];
        handleFirestoreError(
          retryErr,
          firstOp?.type === 'delete' ? OperationType.DELETE : OperationType.WRITE,
          firstOp?.path ?? null,
        );
      }
    }
  }

  const dirtyAttachments = collectDirtyAttachmentsFromEntities({
    tenders: built.upsertedTenders,
    emdRecords: built.upsertedEmd,
    mafTrackers: built.upsertedMaf,
  });

  if (!deferAttachmentsToBackground && dirtyAttachments.length > 0) {
    await syncAttachmentFilesToCloud(user, dirtyAttachments, workspaceTenantId, ctx);
  }

  const nowMs = Date.now();
  built.nextManifest.lastSyncedAtMs = nowMs;
  built.nextManifest.lastSyncedIso = new Date(nowMs).toISOString();
  saveDeltaSyncManifest(built.nextManifest);

  return {
    syncedOps: built.ops.length,
    deferredAttachments: deferAttachmentsToBackground ? dirtyAttachments : [],
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
  oemRecords: OemRecord[] = [],
  options?: { forceFull?: boolean; deferAttachmentsToBackground?: boolean },
): Promise<void> {
  const { ctx, scopedTenant } = resolveScope(user.uid, workspaceTenantId, target);
  await ensureUserRootDocument(user, workspaceTenantId, null, ctx);
  const scope = buildScopeDescriptor(ctx, user.uid, scopedTenant);
  const manifest = loadDeltaSyncManifest(scope);
  const forceAll = Boolean(options?.forceFull) || manifest.lastSyncedAtMs === 0;

  const tenderDiff = computeCollectionDeltaDiff(
    tenders,
    manifest.signatures.tenders,
    (t) => sanitizeDocId(t.id),
    signatureForTender,
    { forceAll, allowDeletes: false },
  );
  const emdDiff = computeCollectionDeltaDiff(
    emdRecords,
    manifest.signatures.emdRecords,
    (r) => sanitizeDocId(r.id),
    signatureForEmd,
    { forceAll, allowDeletes: false },
  );
  const mafDiff = computeCollectionDeltaDiff(
    mafTrackers,
    manifest.signatures.mafTrackers,
    (m) => sanitizeDocId(m.id),
    signatureForMaf,
    { forceAll, allowDeletes: false },
  );
  const oemDiff = computeCollectionDeltaDiff(
    oemRecords,
    manifest.signatures.oemRecords,
    (o) => sanitizeDocId(o.id),
    signatureForOem,
    { forceAll, allowDeletes: false },
  );

  const singletons: DirtySyncSnapshot['singletons'] = [];
  if (forceAll || manifest.signatures.singletons.profile !== signatureForProfile(profile)) {
    singletons.push('profile');
  }
  if (forceAll || manifest.signatures.singletons.preferences !== signatureForPreferences(preferences)) {
    singletons.push('preferences');
  }

  const dirty: DirtySyncSnapshot = {
    tenders: { upserts: tenderDiff.toUpsert.map((t) => sanitizeDocId(t.id)), deletes: [] },
    emdRecords: { upserts: emdDiff.toUpsert.map((r) => sanitizeDocId(r.id)), deletes: [] },
    mafTrackers: { upserts: mafDiff.toUpsert.map((m) => sanitizeDocId(m.id)), deletes: [] },
    oemRecords: { upserts: oemDiff.toUpsert.map((o) => sanitizeDocId(o.id)), deletes: [] },
    singletons,
  };

  const result = await syncDeltaBatchToCloud({
    user,
    dirty,
    tenders,
    emdRecords,
    mafTrackers,
    oemRecords,
    profile,
    preferences,
    workspaceTenantId,
    target: ctx,
    deferAttachmentsToBackground: options?.deferAttachmentsToBackground ?? false,
  });

  if (options?.deferAttachmentsToBackground && result.deferredAttachments.length > 0) {
    void syncAttachmentFilesToCloud(
      user,
      result.deferredAttachments,
      workspaceTenantId,
      ctx,
    ).catch(() => {
      // Attachment background retry happens cleanly on next sync
    });
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
  oemRecords: OemRecord[] = [],
  options?: { forceFull?: boolean },
): Promise<void> {
  const { ctx, scopedTenant, prefix } = resolveScope(user.uid, workspaceTenantId, target);
  await ensureUserRootDocument(user, workspaceTenantId, null, ctx);
  const scope = buildScopeDescriptor(ctx, user.uid, scopedTenant);
  const manifest = loadDeltaSyncManifest(scope);

  // If manifest already tracks cloud IDs cleanly and !forceFull, compute delta deletes directly
  // without re-downloading every attachment/record from Firestore!
  const canUseManifestDiff =
    !options?.forceFull &&
    manifest.lastSyncedAtMs > 0 &&
    (Object.keys(manifest.signatures.tenders).length > 0 ||
      Object.keys(manifest.signatures.emdRecords).length > 0 ||
      Object.keys(manifest.signatures.mafTrackers).length > 0 ||
      Object.keys(manifest.signatures.oemRecords).length > 0);

  let deleteTenderIds: string[];
  let deleteEmdIds: string[];
  let deleteMafIds: string[];
  let deleteOemIds: string[];
  let obsoleteAttIds: string[] = [];

  const nextTenderIds = new Set(tenders.map((t) => sanitizeDocId(t.id)));
  const nextEmdIds = new Set(emdRecords.map((r) => sanitizeDocId(r.id)));
  const nextMafIds = new Set(mafTrackers.map((m) => sanitizeDocId(m.id)));
  const nextOemIds = new Set(oemRecords.map((o) => sanitizeDocId(o.id)));
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

  if (canUseManifestDiff) {
    deleteTenderIds = computeCollectionDeltaDiff(
      tenders,
      manifest.signatures.tenders,
      (t) => sanitizeDocId(t.id),
      signatureForTender,
    ).toDeleteIds;
    deleteEmdIds = computeCollectionDeltaDiff(
      emdRecords,
      manifest.signatures.emdRecords,
      (r) => sanitizeDocId(r.id),
      signatureForEmd,
    ).toDeleteIds;
    deleteMafIds = computeCollectionDeltaDiff(
      mafTrackers,
      manifest.signatures.mafTrackers,
      (m) => sanitizeDocId(m.id),
      signatureForMaf,
    ).toDeleteIds;
    deleteOemIds = computeCollectionDeltaDiff(
      oemRecords,
      manifest.signatures.oemRecords,
      (o) => sanitizeDocId(o.id),
      signatureForOem,
    ).toDeleteIds;
    obsoleteAttIds = Object.keys(manifest.signatures.attachments).filter(
      (attId) => !nextAttachmentIds.has(sanitizeDocId(attId)),
    );
  } else {
    const existing = await fetchAllFromCloud(user.uid, workspaceTenantId, ctx, {
      includeAttachments: true,
      forceFull: true,
    });
    deleteTenderIds = existing.tenders
      .map((t) => sanitizeDocId(t.id))
      .filter((id) => !nextTenderIds.has(id));
    deleteEmdIds = existing.emdRecords
      .map((r) => sanitizeDocId(r.id))
      .filter((id) => !nextEmdIds.has(id));
    deleteMafIds = existing.mafTrackers
      .map((m) => sanitizeDocId(m.id))
      .filter((id) => !nextMafIds.has(id));
    deleteOemIds = existing.oemRecords
      .map((o) => sanitizeDocId(o.id))
      .filter((id) => !nextOemIds.has(id));
    obsoleteAttIds = Array.from(existing.attachmentFiles.keys())
      .map((id) => sanitizeDocId(id))
      .filter((id) => !nextAttachmentIds.has(id));
  }

  const tenderDiff = computeCollectionDeltaDiff(
    tenders,
    manifest.signatures.tenders,
    (t) => sanitizeDocId(t.id),
    signatureForTender,
    { forceAll: Boolean(options?.forceFull) || !canUseManifestDiff },
  );
  const emdDiff = computeCollectionDeltaDiff(
    emdRecords,
    manifest.signatures.emdRecords,
    (r) => sanitizeDocId(r.id),
    signatureForEmd,
    { forceAll: Boolean(options?.forceFull) || !canUseManifestDiff },
  );
  const mafDiff = computeCollectionDeltaDiff(
    mafTrackers,
    manifest.signatures.mafTrackers,
    (m) => sanitizeDocId(m.id),
    signatureForMaf,
    { forceAll: Boolean(options?.forceFull) || !canUseManifestDiff },
  );
  const oemDiff = computeCollectionDeltaDiff(
    oemRecords,
    manifest.signatures.oemRecords,
    (o) => sanitizeDocId(o.id),
    signatureForOem,
    { forceAll: Boolean(options?.forceFull) || !canUseManifestDiff },
  );

  const singletons: DirtySyncSnapshot['singletons'] = [];
  if (
    options?.forceFull ||
    !canUseManifestDiff ||
    manifest.signatures.singletons.profile !== signatureForProfile(profile)
  ) {
    singletons.push('profile');
  }
  if (
    options?.forceFull ||
    !canUseManifestDiff ||
    manifest.signatures.singletons.preferences !== signatureForPreferences(preferences)
  ) {
    singletons.push('preferences');
  }

  const dirty: DirtySyncSnapshot = {
    tenders: {
      upserts: tenderDiff.toUpsert.map((t) => sanitizeDocId(t.id)),
      deletes: deleteTenderIds,
    },
    emdRecords: {
      upserts: emdDiff.toUpsert.map((r) => sanitizeDocId(r.id)),
      deletes: deleteEmdIds,
    },
    mafTrackers: {
      upserts: mafDiff.toUpsert.map((m) => sanitizeDocId(m.id)),
      deletes: deleteMafIds,
    },
    oemRecords: {
      upserts: oemDiff.toUpsert.map((o) => sanitizeDocId(o.id)),
      deletes: deleteOemIds,
    },
    singletons,
  };

  await syncDeltaBatchToCloud({
    user,
    dirty,
    tenders,
    emdRecords,
    mafTrackers,
    oemRecords,
    profile,
    preferences,
    workspaceTenantId,
    target: ctx,
    deferAttachmentsToBackground: false,
  });

  if (obsoleteAttIds.length > 0) {
    const attDeleteOps: BatchWriteOp[] = obsoleteAttIds.map((attId) => {
      const safeId = sanitizeDocId(attId);
      return {
        type: 'delete',
        ref: getScopedDoc(ctx, user.uid, scopedTenant, 'attachmentFiles', safeId),
        path: `${prefix}/attachmentFiles/${safeId}`,
      };
    });
    await commitWriteBatchOps(ctx, attDeleteOps);
    const updatedManifest = loadDeltaSyncManifest(scope);
    for (const attId of obsoleteAttIds) {
      delete updatedManifest.signatures.attachments[sanitizeDocId(attId)];
    }
    saveDeltaSyncManifest(updatedManifest);
  }
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
    onOemRecords?: (oems: OemRecord[]) => void;
    onAttachmentFiles?: (fileMap: Map<string, string>) => void;
    onError: (err: Error) => void;
  },
  workspaceTenantId?: string | null,
  target?: CloudTargetContext | null,
  options?: { includeAttachments?: boolean },
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
  const oemPath = `${prefix}/oemDetails`;
  const filesPath = `${prefix}/attachmentFiles`;

  const unsubProfile = onSnapshot(
    getScopedDoc(ctx, uid, scopedTenant, 'profile', 'firm'),
    (snap) => {
      if (snap.exists()) {
        rememberDocMetadata(ctx, profilePath, snap.data(), undefined, {
          fromPendingWrite: snap.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache,
        });
        callbacks.onProfile(docToProfile(snap.data()));
      } else {
        rememberDocMetadata(ctx, profilePath, null, undefined, {
          fromPendingWrite: snap.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache,
        });
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
        rememberDocMetadata(ctx, prefsPath, snap.data(), undefined, {
          fromPendingWrite: snap.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache,
        });
        callbacks.onPreferences(docToPreferences(snap.data()));
      } else {
        rememberDocMetadata(ctx, prefsPath, null, undefined, {
          fromPendingWrite: snap.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache,
        });
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
      for (const d of snap.docs) {
        rememberDocMetadata(ctx, `${tendersPath}/${d.id}`, d.data(), 'tender', {
          fromPendingWrite: snap.metadata.hasPendingWrites || d.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache || d.metadata.fromCache,
        });
      }
      callbacks.onTenders(snap.docs.map((d) => docToTender(d.data(), d.id)));
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
      for (const d of snap.docs) {
        rememberDocMetadata(ctx, `${emdPath}/${d.id}`, d.data(), 'emd', {
          fromPendingWrite: snap.metadata.hasPendingWrites || d.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache || d.metadata.fromCache,
        });
      }
      callbacks.onEmdRecords(snap.docs.map((d) => docToEmdRecord(d.data(), d.id)));
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
      for (const d of snap.docs) {
        rememberDocMetadata(ctx, `${mafPath}/${d.id}`, d.data(), undefined, {
          fromPendingWrite: snap.metadata.hasPendingWrites || d.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache || d.metadata.fromCache,
        });
      }
      callbacks.onMafTrackers(snap.docs.map((d) => docToMafTracker(d.data(), d.id)));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, mafPath);
      } catch (wrapped) {
        callbacks.onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );

  const unsubOems = onSnapshot(
    query(getScopedCollection(ctx, uid, scopedTenant, 'oemDetails'), where('ownerUid', '==', uid)),
    (snap) => {
      for (const d of snap.docs) {
        rememberDocMetadata(ctx, `${oemPath}/${d.id}`, d.data(), undefined, {
          fromPendingWrite: snap.metadata.hasPendingWrites || d.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache || d.metadata.fromCache,
        });
      }
      if (callbacks.onOemRecords) {
        const list = snap.docs
          .map((d) => docToOemRecord(d.data(), d.id))
          .filter((item) => item.oemName.trim().length > 0);
        callbacks.onOemRecords(list);
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, oemPath);
      } catch (wrapped) {
        callbacks.onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );

  // Heavy attachmentFiles subscription is disabled by default during live sessions because
  // missing/new blobs are loaded lazily & incrementally in the background without blocking UI.
  const unsubFiles: Unsubscribe | null =
    options?.includeAttachments && callbacks.onAttachmentFiles
      ? onSnapshot(
          query(
            getScopedCollection(ctx, uid, scopedTenant, 'attachmentFiles'),
            where('ownerUid', '==', uid),
          ),
          (snap) => {
            const map = new Map<string, string>();
            for (const d of snap.docs) {
              rememberDocMetadata(ctx, `${filesPath}/${d.id}`, d.data(), undefined, {
                fromPendingWrite: snap.metadata.hasPendingWrites || d.metadata.hasPendingWrites,
                fromCache: snap.metadata.fromCache || d.metadata.fromCache,
              });
              const data = d.data();
              if (typeof data.dataUrl === 'string' && data.dataUrl.length > 0) {
                map.set(String(data.id ?? d.id), data.dataUrl);
              }
            }
            callbacks.onAttachmentFiles?.(map);
          },
          (error) => {
            try {
              handleFirestoreError(error, OperationType.LIST, filesPath);
            } catch (wrapped) {
              callbacks.onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
            }
          },
        )
      : null;

  const unsubEmailConfig = onSnapshot(
    getScopedDoc(ctx, uid, scopedTenant, 'emailConfig', 'default'),
    (snap) => {
      if (snap.exists() && callbacks.onEmailConfig) {
        rememberDocMetadata(ctx, emailConfigPath, snap.data(), undefined, {
          fromPendingWrite: snap.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache,
        });
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
      for (const d of snap.docs) {
        rememberDocMetadata(ctx, `${emailAlertsPath}/${d.id}`, d.data(), undefined, {
          fromPendingWrite: snap.metadata.hasPendingWrites || d.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache || d.metadata.fromCache,
        });
      }
      if (callbacks.onEmailAlerts) {
        const sorted = snap.docs
          .map((d) => docToEmailAlertLog(d.data(), d.id))
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
        rememberDocMetadata(ctx, sheetConfigPath, snap.data(), undefined, {
          fromPendingWrite: snap.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache,
        });
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
    unsubOems();
    if (unsubFiles) unsubFiles();
  };
}
