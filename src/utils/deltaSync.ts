import type {
  AttachmentItem,
  EmailAlertSettings,
  EmdBgRecord,
  FirmProfile,
  GoogleSheetSettings,
  MafTrackerRecord,
  OemRecord,
  Tender,
  UserPreferences,
} from '../types/crm';
import { sanitizeDocId } from './cloudSyncHelpers.ts';

export const DELTA_SYNC_STORAGE_PREFIX = 'vanshtender_delta_sync_v1::';
export const DEFAULT_FIRESTORE_BATCH_CHUNK_SIZE = 400;
export const DEFAULT_SYNC_DEBOUNCE_MS = 650;
export const DEFAULT_SYNC_MAX_WAIT_MS = 2500;
export const DEFAULT_LEGACY_SCAN_TTL_MS = 12 * 60 * 60 * 1000;

export type DeltaCollectionKey =
  | 'tenders'
  | 'emdRecords'
  | 'mafTrackers'
  | 'oemRecords'
  | 'attachments'
  | 'singletons';

export type DeltaEntityCollectionKey =
  | 'tenders'
  | 'emdRecords'
  | 'mafTrackers'
  | 'oemRecords';

export type DeltaSingletonKey =
  | 'profile'
  | 'preferences'
  | 'emailConfig'
  | 'sheetConfig';

export interface DeltaSyncScopeDescriptor {
  projectId: string;
  databaseId?: string | null;
  uid: string;
  tenantId?: string | null;
}

export interface DeltaSyncManifest {
  version: 1;
  scopeKey: string;
  lastSyncedAtMs: number;
  lastSyncedIso: string;
  legacyScanDoneAtMs?: number;
  signatures: Record<DeltaCollectionKey, Record<string, string>>;
}

export interface DeltaDiffResult<T> {
  toUpsert: T[];
  toDeleteIds: string[];
  nextSignatures: Record<string, string>;
  unchangedCount: number;
}

export interface DirtySyncSnapshot {
  tenders: { upserts: string[]; deletes: string[] };
  emdRecords: { upserts: string[]; deletes: string[] };
  mafTrackers: { upserts: string[]; deletes: string[] };
  oemRecords: { upserts: string[]; deletes: string[] };
  singletons: DeltaSingletonKey[];
}

export function buildDeltaSyncScopeKey(scope: DeltaSyncScopeDescriptor): string {
  const project = (scope.projectId || 'default').trim() || 'default';
  const db = (scope.databaseId || '(default)').trim() || '(default)';
  const uid = (scope.uid || 'anon').trim() || 'anon';
  const tenant = scope.tenantId && scope.tenantId.trim() ? scope.tenantId.trim() : 'root';
  return `${project}::${db}::${uid}::${tenant}`;
}

export function createEmptyDeltaManifest(scopeKey: string): DeltaSyncManifest {
  return {
    version: 1,
    scopeKey,
    lastSyncedAtMs: 0,
    lastSyncedIso: '',
    signatures: {
      tenders: {},
      emdRecords: {},
      mafTrackers: {},
      oemRecords: {},
      attachments: {},
      singletons: {},
    },
  };
}

function getBrowserLocalStorage(storageOverride?: Storage | null): Storage | null {
  if (storageOverride !== undefined) return storageOverride;
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
      ? window.localStorage
      : null;
  } catch {
    return null;
  }
}

export function loadDeltaSyncManifest(
  scope: DeltaSyncScopeDescriptor,
  storageOverride?: Storage | null,
): DeltaSyncManifest {
  const scopeKey = buildDeltaSyncScopeKey(scope);
  const storage = getBrowserLocalStorage(storageOverride);
  if (!storage) return createEmptyDeltaManifest(scopeKey);
  try {
    const raw = storage.getItem(`${DELTA_SYNC_STORAGE_PREFIX}${scopeKey}`);
    if (!raw) return createEmptyDeltaManifest(scopeKey);
    const parsed = JSON.parse(raw) as Partial<DeltaSyncManifest>;
    if (!parsed || parsed.version !== 1 || parsed.scopeKey !== scopeKey) {
      return createEmptyDeltaManifest(scopeKey);
    }
    const base = createEmptyDeltaManifest(scopeKey);
    const sigs = parsed.signatures ?? ({} as Partial<DeltaSyncManifest['signatures']>);
    return {
      version: 1,
      scopeKey,
      lastSyncedAtMs:
        typeof parsed.lastSyncedAtMs === 'number' && Number.isFinite(parsed.lastSyncedAtMs)
          ? Math.max(0, parsed.lastSyncedAtMs)
          : 0,
      lastSyncedIso: typeof parsed.lastSyncedIso === 'string' ? parsed.lastSyncedIso : '',
      legacyScanDoneAtMs:
        typeof parsed.legacyScanDoneAtMs === 'number' && Number.isFinite(parsed.legacyScanDoneAtMs)
          ? Math.max(0, parsed.legacyScanDoneAtMs)
          : undefined,
      signatures: {
        tenders: sanitizeSignatureRecord(sigs.tenders),
        emdRecords: sanitizeSignatureRecord(sigs.emdRecords),
        mafTrackers: sanitizeSignatureRecord(sigs.mafTrackers),
        oemRecords: sanitizeSignatureRecord(sigs.oemRecords),
        attachments: sanitizeSignatureRecord(sigs.attachments),
        singletons: sanitizeSignatureRecord(sigs.singletons),
      },
    };
  } catch {
    return createEmptyDeltaManifest(scopeKey);
  }
}

function sanitizeSignatureRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key === 'string' && key && typeof val === 'string' && val) {
      result[key] = val;
    }
  }
  return result;
}

export function saveDeltaSyncManifest(
  manifest: DeltaSyncManifest,
  storageOverride?: Storage | null,
): void {
  const storage = getBrowserLocalStorage(storageOverride);
  if (!storage) return;
  try {
    storage.setItem(
      `${DELTA_SYNC_STORAGE_PREFIX}${manifest.scopeKey}`,
      JSON.stringify(manifest),
    );
  } catch {
    // Ignore storage quota issues cleanly
  }
}

export function clearDeltaSyncManifest(
  scope: DeltaSyncScopeDescriptor,
  storageOverride?: Storage | null,
): void {
  const storage = getBrowserLocalStorage(storageOverride);
  if (!storage) return;
  try {
    storage.removeItem(`${DELTA_SYNC_STORAGE_PREFIX}${buildDeltaSyncScopeKey(scope)}`);
  } catch {
    // Ignore
  }
}

export function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'number' || t === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableSerialize(v)).join(',')}]`;
  }
  if (t === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableSerialize(v)}`).join(',')}}`;
  }
  return JSON.stringify(String(value));
}

export function computeCompactSignature(value: unknown): string {
  const serialized = typeof value === 'string' ? value : stableSerialize(value);
  let hash1 = 2166136261;
  let hash2 = 5381;
  for (let i = 0; i < serialized.length; i += 1) {
    const code = serialized.charCodeAt(i);
    hash1 ^= code;
    hash1 = Math.imul(hash1, 16777619);
    hash2 = Math.imul(hash2, 33) ^ code;
  }
  return `${(hash1 >>> 0).toString(36)}_${(hash2 >>> 0).toString(36)}_${serialized.length.toString(36)}`;
}

function normalizeAttachmentsForSignature(items?: AttachmentItem[]): unknown[] {
  return (items ?? []).map((att) => ({
    id: sanitizeDocId(att.id),
    slotLabel: att.slotLabel || '',
    fileName: att.fileName || '',
    fileType: att.fileType || '',
    fileSize: Number(att.fileSize || 0),
    uploadedAt: att.uploadedAt || '',
    dataLen: typeof att.dataUrl === 'string' ? att.dataUrl.length : 0,
  }));
}

export function signatureForTender(tender: Tender): string {
  return computeCompactSignature({
    ...tender,
    id: sanitizeDocId(tender.id),
    attachments: normalizeAttachmentsForSignature(tender.attachments),
  });
}

export function signatureForEmd(record: EmdBgRecord): string {
  return computeCompactSignature({
    ...record,
    id: sanitizeDocId(record.id),
    attachments: normalizeAttachmentsForSignature(record.attachments),
  });
}

export function signatureForMaf(tracker: MafTrackerRecord): string {
  return computeCompactSignature({
    ...tracker,
    id: sanitizeDocId(tracker.id),
    itemsMAF: (tracker.itemsMAF ?? []).map((item) => ({
      ...item,
      itemId: sanitizeDocId(item.itemId),
      mafDocumentUrl:
        item.mafDocumentUrl?.startsWith('data:')
          ? `data_len_${item.mafDocumentUrl.length}`
          : item.mafDocumentUrl || '',
    })),
  });
}

export function signatureForOem(oem: OemRecord): string {
  return computeCompactSignature({
    ...oem,
    id: sanitizeDocId(oem.id),
  });
}

export function signatureForAttachment(att: AttachmentItem): string {
  return computeCompactSignature({
    id: sanitizeDocId(att.id),
    fileName: (att.fileName || '').trim() || 'attachment',
    fileType: (att.fileType || '').trim() || 'application/octet-stream',
    fileSize: Number(att.fileSize || 0),
    uploadedAt: att.uploadedAt || '',
    dataLen: typeof att.dataUrl === 'string' ? att.dataUrl.length : 0,
  });
}

export function signatureForProfile(profile: FirmProfile): string {
  return computeCompactSignature(profile);
}

export function signatureForPreferences(prefs: UserPreferences): string {
  return computeCompactSignature(prefs);
}

export function signatureForEmailConfig(cfg: EmailAlertSettings): string {
  return computeCompactSignature(cfg);
}

export function signatureForSheetConfig(cfg: GoogleSheetSettings): string {
  return computeCompactSignature(cfg);
}

export function computeCollectionDeltaDiff<T>(
  items: readonly T[],
  prevSignatures: Readonly<Record<string, string>>,
  getId: (item: T) => string,
  getSignature: (item: T) => string,
  options?: { forceAll?: boolean; allowDeletes?: boolean },
): DeltaDiffResult<T> {
  const forceAll = Boolean(options?.forceAll);
  const allowDeletes = options?.allowDeletes !== false;
  const nextSignatures: Record<string, string> = {};
  const toUpsert: T[] = [];
  const seenIds = new Set<string>();
  let unchangedCount = 0;

  for (const item of items) {
    const id = getId(item);
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    const sig = getSignature(item);
    nextSignatures[id] = sig;
    if (forceAll || prevSignatures[id] !== sig) {
      toUpsert.push(item);
    } else {
      unchangedCount += 1;
    }
  }

  const toDeleteIds: string[] = [];
  if (allowDeletes) {
    for (const prevId of Object.keys(prevSignatures)) {
      if (!seenIds.has(prevId)) {
        toDeleteIds.push(prevId);
      }
    }
  }

  return {
    toUpsert,
    toDeleteIds,
    nextSignatures,
    unchangedCount,
  };
}

export function collectDirtyAttachmentsFromEntities(params: {
  tenders?: readonly Tender[];
  emdRecords?: readonly EmdBgRecord[];
  mafTrackers?: readonly MafTrackerRecord[];
}): AttachmentItem[] {
  const byId = new Map<string, AttachmentItem>();

  for (const tender of params.tenders ?? []) {
    for (const att of tender.attachments ?? []) {
      if (!att.dataUrl) continue;
      const safeId = sanitizeDocId(att.id);
      if (!byId.has(safeId)) {
        byId.set(safeId, { ...att, id: safeId });
      }
    }
  }

  for (const emd of params.emdRecords ?? []) {
    for (const att of emd.attachments ?? []) {
      if (!att.dataUrl) continue;
      const safeId = sanitizeDocId(att.id);
      if (!byId.has(safeId)) {
        byId.set(safeId, { ...att, id: safeId });
      }
    }
  }

  for (const tracker of params.mafTrackers ?? []) {
    for (const item of tracker.itemsMAF ?? []) {
      if (item.mafAttachmentId && item.mafDocumentUrl?.startsWith('data:')) {
        const safeId = sanitizeDocId(item.mafAttachmentId);
        if (!byId.has(safeId)) {
          byId.set(safeId, {
            id: safeId,
            slotLabel: 'MAF Document',
            fileName: item.mafDocumentName || `${item.oemName || 'OEM'}_MAF`,
            fileType: item.mafDocumentUrl.startsWith('data:application/pdf')
              ? 'application/pdf'
              : 'image/jpeg',
            fileSize: Math.round((item.mafDocumentUrl.length * 3) / 4),
            uploadedAt: item.updatedAt || tracker.updatedAt,
            dataUrl: item.mafDocumentUrl,
          });
        }
      }
    }
  }

  return Array.from(byId.values());
}

export function collectMissingAttachmentIds(params: {
  tenders: readonly Tender[];
  emdRecords: readonly EmdBgRecord[];
  mafTrackers: readonly MafTrackerRecord[];
  loadedAttachmentFiles: ReadonlyMap<string, string>;
}): string[] {
  const missing = new Set<string>();

  for (const tender of params.tenders) {
    for (const att of tender.attachments ?? []) {
      if (att.dataUrl) continue;
      const safeId = sanitizeDocId(att.id);
      if (!params.loadedAttachmentFiles.has(att.id) && !params.loadedAttachmentFiles.has(safeId)) {
        missing.add(safeId);
      }
    }
  }

  for (const emd of params.emdRecords) {
    for (const att of emd.attachments ?? []) {
      if (att.dataUrl) continue;
      const safeId = sanitizeDocId(att.id);
      if (!params.loadedAttachmentFiles.has(att.id) && !params.loadedAttachmentFiles.has(safeId)) {
        missing.add(safeId);
      }
    }
  }

  for (const tracker of params.mafTrackers) {
    for (const item of tracker.itemsMAF ?? []) {
      if (item.mafDocumentUrl || !item.mafAttachmentId) continue;
      const safeId = sanitizeDocId(item.mafAttachmentId);
      if (
        !params.loadedAttachmentFiles.has(item.mafAttachmentId) &&
        !params.loadedAttachmentFiles.has(safeId)
      ) {
        missing.add(safeId);
      }
    }
  }

  return Array.from(missing);
}

export function chunkOperations<T>(
  items: readonly T[],
  maxChunkSize = DEFAULT_FIRESTORE_BATCH_CHUNK_SIZE,
): T[][] {
  if (items.length === 0) return [];
  const size = Math.max(1, Math.floor(maxChunkSize));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function resolveQuerySinceTimestampMs(
  lastSyncedAtMs: number | null | undefined,
  skewBufferMs = 5000,
): number {
  if (typeof lastSyncedAtMs !== 'number' || !Number.isFinite(lastSyncedAtMs) || lastSyncedAtMs <= 0) {
    return 0;
  }
  return Math.max(0, lastSyncedAtMs - Math.max(0, skewBufferMs));
}

export function isLegacyFallbackScanDue(
  legacyScanDoneAtMs: number | undefined,
  nowMs = Date.now(),
  ttlMs = DEFAULT_LEGACY_SCAN_TTL_MS,
): boolean {
  if (
    typeof legacyScanDoneAtMs !== 'number' ||
    !Number.isFinite(legacyScanDoneAtMs) ||
    legacyScanDoneAtMs <= 0
  ) {
    return true;
  }
  return nowMs - legacyScanDoneAtMs > ttlMs;
}

export function shouldFallbackFromMissingIndex(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err ?? '');
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : '';
  const combined = `${code} ${text}`.toLowerCase();
  return (
    combined.includes('failed-precondition') ||
    combined.includes('requires an index') ||
    combined.includes('create_composite')
  );
}

export function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export interface DebouncedSyncScheduler {
  markUpsert: (collection: DeltaEntityCollectionKey, id: string) => void;
  markDelete: (collection: DeltaEntityCollectionKey, id: string) => void;
  markSingleton: (singleton: DeltaSingletonKey) => void;
  hasPending: () => boolean;
  peekSnapshot: () => DirtySyncSnapshot;
  flush: () => Promise<void>;
  clear: () => void;
  dispose: () => void;
}

export function createDebouncedDeltaScheduler(params: {
  debounceMs?: number;
  maxWaitMs?: number;
  onFlush: (snapshot: DirtySyncSnapshot) => Promise<void> | void;
}): DebouncedSyncScheduler {
  const debounceMs = Math.max(25, params.debounceMs ?? DEFAULT_SYNC_DEBOUNCE_MS);
  const maxWaitMs = Math.max(debounceMs, params.maxWaitMs ?? DEFAULT_SYNC_MAX_WAIT_MS);

  const buffers: Record<DeltaEntityCollectionKey, { upserts: Set<string>; deletes: Set<string> }> = {
    tenders: { upserts: new Set(), deletes: new Set() },
    emdRecords: { upserts: new Set(), deletes: new Set() },
    mafTrackers: { upserts: new Set(), deletes: new Set() },
    oemRecords: { upserts: new Set(), deletes: new Set() },
  };
  const singletons = new Set<DeltaSingletonKey>();

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let activeFlushPromise: Promise<void> | null = null;

  const hasPending = (): boolean => {
    if (singletons.size > 0) return true;
    return (
      buffers.tenders.upserts.size > 0 ||
      buffers.tenders.deletes.size > 0 ||
      buffers.emdRecords.upserts.size > 0 ||
      buffers.emdRecords.deletes.size > 0 ||
      buffers.mafTrackers.upserts.size > 0 ||
      buffers.mafTrackers.deletes.size > 0 ||
      buffers.oemRecords.upserts.size > 0 ||
      buffers.oemRecords.deletes.size > 0
    );
  };

  const peekSnapshot = (): DirtySyncSnapshot => ({
    tenders: {
      upserts: Array.from(buffers.tenders.upserts),
      deletes: Array.from(buffers.tenders.deletes),
    },
    emdRecords: {
      upserts: Array.from(buffers.emdRecords.upserts),
      deletes: Array.from(buffers.emdRecords.deletes),
    },
    mafTrackers: {
      upserts: Array.from(buffers.mafTrackers.upserts),
      deletes: Array.from(buffers.mafTrackers.deletes),
    },
    oemRecords: {
      upserts: Array.from(buffers.oemRecords.upserts),
      deletes: Array.from(buffers.oemRecords.deletes),
    },
    singletons: Array.from(singletons),
  });

  const clearTimers = () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (maxWaitTimer !== null) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
  };

  const drainSnapshot = (): DirtySyncSnapshot | null => {
    if (!hasPending()) return null;
    const snap = peekSnapshot();
    for (const key of Object.keys(buffers) as DeltaEntityCollectionKey[]) {
      buffers[key].upserts.clear();
      buffers[key].deletes.clear();
    }
    singletons.clear();
    clearTimers();
    return snap;
  };

  const runFlushLoop = async (): Promise<void> => {
    while (!disposed) {
      const snap = drainSnapshot();
      if (!snap) break;
      await params.onFlush(snap);
    }
  };

  const flush = (): Promise<void> => {
    clearTimers();
    if (disposed || !hasPending()) {
      return activeFlushPromise ?? Promise.resolve();
    }
    if (!activeFlushPromise) {
      activeFlushPromise = runFlushLoop().finally(() => {
        activeFlushPromise = null;
      });
    }
    return activeFlushPromise;
  };

  const schedule = () => {
    if (disposed) return;
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      void flush();
    }, debounceMs);

    if (maxWaitTimer === null) {
      maxWaitTimer = setTimeout(() => {
        void flush();
      }, maxWaitMs);
    }
  };

  return {
    markUpsert(collection, id) {
      if (disposed || !id) return;
      const safeId = sanitizeDocId(id);
      buffers[collection].deletes.delete(safeId);
      buffers[collection].upserts.add(safeId);
      schedule();
    },
    markDelete(collection, id) {
      if (disposed || !id) return;
      const safeId = sanitizeDocId(id);
      buffers[collection].upserts.delete(safeId);
      buffers[collection].deletes.add(safeId);
      schedule();
    },
    markSingleton(singleton) {
      if (disposed) return;
      singletons.add(singleton);
      schedule();
    },
    hasPending,
    peekSnapshot,
    flush,
    clear() {
      clearTimers();
      for (const key of Object.keys(buffers) as DeltaEntityCollectionKey[]) {
        buffers[key].upserts.clear();
        buffers[key].deletes.clear();
      }
      singletons.clear();
    },
    dispose() {
      disposed = true;
      clearTimers();
      for (const key of Object.keys(buffers) as DeltaEntityCollectionKey[]) {
        buffers[key].upserts.clear();
        buffers[key].deletes.clear();
      }
      singletons.clear();
    },
  };
}
