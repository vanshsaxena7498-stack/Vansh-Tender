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
import type { EmdBgRecord, FirmProfile, Tender } from '../types/crm';
import {
  buildCloudEmdPayload,
  buildCloudProfilePayload,
  buildCloudTenderPayload,
  sanitizeDocId,
} from './cloudSyncHelpers';

const TERMINAL_TENDER_STAGES = new Set<Tender['stage']>([
  'L1 / Won',
  'Lost (L2/L3)',
  'Cancelled / Retendered',
]);

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

export async function ensureUserRootDocument(user: User): Promise<void> {
  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(userRef);
    const now = serverTimestamp();
    if (!snap.exists()) {
      await setDoc(userRef, {
        ownerUid: user.uid,
        email: (user.email ?? '').slice(0, 200),
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await setDoc(userRef, {
        ownerUid: snap.data().ownerUid ?? user.uid,
        email: (user.email ?? '').slice(0, 200),
        createdAt: snap.data().createdAt ?? now,
        updatedAt: now,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
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

export async function syncTenderToCloud(user: User, tender: Tender): Promise<void> {
  await ensureUserRootDocument(user);
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

export async function fetchAllFromCloud(uid: string): Promise<{
  profile: FirmProfile | null;
  tenders: Tender[];
  emdRecords: EmdBgRecord[];
}> {
  const profilePath = `users/${uid}/profile/firm`;
  const tendersPath = `users/${uid}/tenders`;
  const emdPath = `users/${uid}/emdRecords`;

  let profile: FirmProfile | null = null;
  let tenders: Tender[] = [];
  let emdRecords: EmdBgRecord[] = [];

  try {
    const profileSnap = await getDoc(doc(db, 'users', uid, 'profile', 'firm'));
    if (profileSnap.exists()) {
      profile = docToProfile(profileSnap.data());
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, profilePath);
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

  return { profile, tenders, emdRecords };
}

export async function backupAllToCloud(
  user: User,
  profile: FirmProfile,
  tenders: Tender[],
  emdRecords: EmdBgRecord[],
): Promise<void> {
  await ensureUserRootDocument(user);
  await syncProfileToCloud(user, profile);

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
  tenders: Tender[],
  emdRecords: EmdBgRecord[],
): Promise<void> {
  const existing = await fetchAllFromCloud(user.uid);
  const nextTenderIds = new Set(tenders.map((t) => sanitizeDocId(t.id)));
  const nextEmdIds = new Set(emdRecords.map((r) => sanitizeDocId(r.id)));

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

  await backupAllToCloud(user, profile, tenders, emdRecords);
}

export function subscribeToUserCloudData(
  uid: string,
  callbacks: {
    onProfile: (profile: FirmProfile) => void;
    onTenders: (tenders: Tender[]) => void;
    onEmdRecords: (records: EmdBgRecord[]) => void;
    onError: (err: Error) => void;
  },
): Unsubscribe {
  const profilePath = `users/${uid}/profile/firm`;
  const tendersPath = `users/${uid}/tenders`;
  const emdPath = `users/${uid}/emdRecords`;

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

  return () => {
    unsubProfile();
    unsubTenders();
    unsubEmd();
  };
}
