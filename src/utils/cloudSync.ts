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
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type {
  AttachmentItem,
  EmdBgRecord,
  FirmProfile,
  Tender,
  UserPreferences,
} from '../types/crm';
import {
  buildCloudAttachmentFilePayload,
  buildCloudEmdPayload,
  buildCloudPreferencesPayload,
  buildCloudProfilePayload,
  buildCloudTenderPayload,
  sanitizeDocId,
} from './cloudSyncHelpers';

const TERMINAL_TENDER_STAGES = new Set<Tender['stage']>([
  'L1 / Won',
  'Lost (L2/L3)',
  'Cancelled / Retendered',
]);

const ensuredUserUids = new Set<string>();
const syncedAttachmentKeys = new Set<string>();

export function clearCloudSessionCache(): void {
  ensuredUserUids.clear();
  syncedAttachmentKeys.clear();
}

const TERMINAL_FINANCIAL_STATUS = new Set<EmdBgRecord['status']>([
  'Refunded / Released',
  'Forfeited',
]);

function isBootstrappedAdminUser(user: User | null): boolean {
  return Boolean(user?.emailVerified && user.email === 'vanshsaxena7498@gmail.com');
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

function docToProfile(data: Record<string, unknown>): FirmProfile {
  return {
    firmName: String(data.firmName ?? 'Corporate Tender Desk'),
    gstin: String(data.gstin ?? ''),
    udyamNumber: String(data.udyamNumber ?? ''),
    adminName: String(data.adminName ?? 'Vansh Saxena'),
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

export async function ensureUserRootDocument(user: User): Promise<void> {
  if (ensuredUserUids.has(user.uid)) return;
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
    ensuredUserUids.add(user.uid);
  } catch (error) {
    ensuredUserUids.delete(user.uid);
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function syncPreferencesToCloud(user: User, prefs: UserPreferences): Promise<void> {
  await ensureUserRootDocument(user);
  const path = `users/${user.uid}/settings/preferences`;
  const ref = doc(db, 'users', user.uid, 'settings', 'preferences');
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

export async function syncProfileToCloud(user: User, profile: FirmProfile): Promise<void> {
  await ensureUserRootDocument(user);
  const path = `users/${user.uid}/profile/firm`;
  const ref = doc(db, 'users', user.uid, 'profile', 'firm');
  try {
    const snap = await getDoc(ref);
    const existingCreatedAt = snap.exists() ? snap.data().createdAt : undefined;
    const payload = buildCloudProfilePayload(profile, user.uid, serverTimestamp(), existingCreatedAt);
    await setDoc(ref, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncAttachmentFilesToCloud(
  user: User,
  attachments: AttachmentItem[] | undefined,
): Promise<void> {
  const list = attachments ?? [];
  for (const att of list) {
    if (!att.dataUrl) continue;
    const safeId = sanitizeDocId(att.id);
    const cacheKey = `${user.uid}:${safeId}:${att.fileSize}:${att.uploadedAt}`;
    if (syncedAttachmentKeys.has(cacheKey)) continue;

    const path = `users/${user.uid}/attachmentFiles/${safeId}`;
    const ref = doc(db, 'users', user.uid, 'attachmentFiles', safeId);
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

export async function syncTenderToCloud(user: User, tender: Tender): Promise<void> {
  await ensureUserRootDocument(user);
  await syncAttachmentFilesToCloud(user, tender.attachments);

  const safeId = sanitizeDocId(tender.id);
  const path = `users/${user.uid}/tenders/${safeId}`;
  const ref = doc(db, 'users', user.uid, 'tenders', safeId);
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

export async function deleteTenderFromCloud(user: User, tenderId: string): Promise<void> {
  const safeId = sanitizeDocId(tenderId);
  const path = `users/${user.uid}/tenders/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', user.uid, 'tenders', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function syncEmdRecordToCloud(user: User, record: EmdBgRecord): Promise<void> {
  await ensureUserRootDocument(user);
  await syncAttachmentFilesToCloud(user, record.attachments);

  const safeId = sanitizeDocId(record.id);
  const path = `users/${user.uid}/emdRecords/${safeId}`;
  const ref = doc(db, 'users', user.uid, 'emdRecords', safeId);
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

export async function deleteEmdRecordFromCloud(user: User, recordId: string): Promise<void> {
  const safeId = sanitizeDocId(recordId);
  const path = `users/${user.uid}/emdRecords/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', user.uid, 'emdRecords', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function fetchAttachmentFileDataUrl(
  uid: string,
  attachmentId: string,
): Promise<string | null> {
  const safeId = sanitizeDocId(attachmentId);
  const path = `users/${uid}/attachmentFiles/${safeId}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'attachmentFiles', safeId));
    if (!snap.exists()) return null;
    const dataUrl = snap.data().dataUrl;
    return typeof dataUrl === 'string' && dataUrl.length > 0 ? dataUrl : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function fetchAllFromCloud(uid: string): Promise<{
  profile: FirmProfile | null;
  preferences: UserPreferences | null;
  tenders: Tender[];
  emdRecords: EmdBgRecord[];
  attachmentFiles: Map<string, string>;
}> {
  const profilePath = `users/${uid}/profile/firm`;
  const prefsPath = `users/${uid}/settings/preferences`;
  const tendersPath = `users/${uid}/tenders`;
  const emdPath = `users/${uid}/emdRecords`;
  const filesPath = `users/${uid}/attachmentFiles`;

  let profile: FirmProfile | null = null;
  let preferences: UserPreferences | null = null;
  let tenders: Tender[] = [];
  let emdRecords: EmdBgRecord[] = [];
  const attachmentFiles = new Map<string, string>();

  try {
    const profileSnap = await getDoc(doc(db, 'users', uid, 'profile', 'firm'));
    if (profileSnap.exists()) {
      profile = docToProfile(profileSnap.data());
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, profilePath);
  }

  try {
    const prefsSnap = await getDoc(doc(db, 'users', uid, 'settings', 'preferences'));
    if (prefsSnap.exists()) {
      preferences = docToPreferences(prefsSnap.data());
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, prefsPath);
  }

  try {
    const tQuery = query(collection(db, 'users', uid, 'tenders'), where('ownerUid', '==', uid));
    const tSnap = await getDocs(tQuery);
    tenders = tSnap.docs.map((d) => docToTender(d.data()));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, tendersPath);
  }

  try {
    const eQuery = query(collection(db, 'users', uid, 'emdRecords'), where('ownerUid', '==', uid));
    const eSnap = await getDocs(eQuery);
    emdRecords = eSnap.docs.map((d) => docToEmdRecord(d.data()));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, emdPath);
  }

  try {
    const fQuery = query(
      collection(db, 'users', uid, 'attachmentFiles'),
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

  return { profile, preferences, tenders, emdRecords, attachmentFiles };
}

export async function backupAllToCloud(
  user: User,
  profile: FirmProfile,
  preferences: UserPreferences,
  tenders: Tender[],
  emdRecords: EmdBgRecord[],
): Promise<void> {
  await ensureUserRootDocument(user);
  await syncProfileToCloud(user, profile);
  await syncPreferencesToCloud(user, preferences);

  for (const tender of tenders) {
    await syncTenderToCloud(user, tender);
  }

  for (const record of emdRecords) {
    await syncEmdRecordToCloud(user, record);
  }
}

export async function replaceCloudDataset(
  user: User,
  profile: FirmProfile,
  preferences: UserPreferences,
  tenders: Tender[],
  emdRecords: EmdBgRecord[],
): Promise<void> {
  await ensureUserRootDocument(user);
  const existing = await fetchAllFromCloud(user.uid);
  const nextTenderIds = new Set(tenders.map((t) => sanitizeDocId(t.id)));
  const nextEmdIds = new Set(emdRecords.map((r) => sanitizeDocId(r.id)));
  const nextAttachmentIds = new Set<string>();

  for (const t of tenders) {
    for (const a of t.attachments ?? []) nextAttachmentIds.add(sanitizeDocId(a.id));
  }
  for (const r of emdRecords) {
    for (const a of r.attachments ?? []) nextAttachmentIds.add(sanitizeDocId(a.id));
  }

  for (const oldTender of existing.tenders) {
    if (!nextTenderIds.has(sanitizeDocId(oldTender.id))) {
      await deleteTenderFromCloud(user, oldTender.id);
    }
  }

  for (const oldEmd of existing.emdRecords) {
    if (!nextEmdIds.has(sanitizeDocId(oldEmd.id))) {
      await deleteEmdRecordFromCloud(user, oldEmd.id);
    }
  }

  for (const oldAttId of existing.attachmentFiles.keys()) {
    if (!nextAttachmentIds.has(sanitizeDocId(oldAttId))) {
      const safeId = sanitizeDocId(oldAttId);
      const path = `users/${user.uid}/attachmentFiles/${safeId}`;
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'attachmentFiles', safeId));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
      }
    }
  }

  await backupAllToCloud(user, profile, preferences, tenders, emdRecords);
}

export function subscribeToUserCloudData(
  uid: string,
  callbacks: {
    onProfile: (profile: FirmProfile) => void;
    onPreferences: (prefs: UserPreferences) => void;
    onTenders: (tenders: Tender[]) => void;
    onEmdRecords: (records: EmdBgRecord[]) => void;
    onAttachmentFiles: (fileMap: Map<string, string>) => void;
    onError: (err: Error) => void;
  },
): Unsubscribe {
  const profilePath = `users/${uid}/profile/firm`;
  const prefsPath = `users/${uid}/settings/preferences`;
  const tendersPath = `users/${uid}/tenders`;
  const emdPath = `users/${uid}/emdRecords`;
  const filesPath = `users/${uid}/attachmentFiles`;

  const unsubProfile = onSnapshot(
    doc(db, 'users', uid, 'profile', 'firm'),
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
    doc(db, 'users', uid, 'settings', 'preferences'),
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
    query(collection(db, 'users', uid, 'tenders'), where('ownerUid', '==', uid)),
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
    query(collection(db, 'users', uid, 'emdRecords'), where('ownerUid', '==', uid)),
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

  const unsubFiles = onSnapshot(
    query(collection(db, 'users', uid, 'attachmentFiles'), where('ownerUid', '==', uid)),
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

  return () => {
    unsubProfile();
    unsubPrefs();
    unsubTenders();
    unsubEmd();
    unsubFiles();
  };
}
