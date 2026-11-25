import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmdBgRecord, MafTrackerRecord, OemRecord, Tender } from '../types/crm';
import {
  buildDeltaSyncScopeKey,
  chunkOperations,
  clearDeltaSyncManifest,
  collectDirtyAttachmentsFromEntities,
  collectMissingAttachmentIds,
  computeCollectionDeltaDiff,
  createDebouncedDeltaScheduler,
  createEmptyDeltaManifest,
  isLegacyFallbackScanDue,
  loadDeltaSyncManifest,
  resolveQuerySinceTimestampMs,
  saveDeltaSyncManifest,
  shouldFallbackFromMissingIndex,
  signatureForEmd,
  signatureForMaf,
  signatureForOem,
  signatureForTender,
  type DirtySyncSnapshot,
} from './deltaSync.ts';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function makeTender(id: string, title = 'CCTV Supply'): Tender {
  return {
    id,
    tenderId: `GEM/${id}`,
    portal: 'GeM',
    clientName: 'Client A',
    department: 'Dept A',
    locationDepartment: 'Jaipur / Dept A',
    location: 'Jaipur',
    category: 'CCTV',
    title,
    publishDate: '2026-11-01',
    submissionDueDate: '2026-12-01T16:00',
    preBidDate: '',
    technicalOpeningDate: '',
    financialOpeningDate: '',
    estimatedValue: 100000,
    quotedValue: 95000,
    l1BidderName: '',
    l1QuotedValue: 0,
    ourPositionRank: '',
    assignedOwner: 'Vansh',
    emdStatus: 'No EMD',
    emdAmount: 0,
    stage: 'Identified / Reviewing',
    resultInfo: '',
    completionDate: '',
    checklist: [],
    remarks: [],
    attachments: [],
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
  };
}

test('computeCollectionDeltaDiff skips unchanged records and flags only new, modified, and deleted IDs', () => {
  const t1 = makeTender('t1', 'First Tender');
  const t2 = makeTender('t2', 'Second Tender');
  const t3 = makeTender('t3', 'Third Tender');

  const initialDiff = computeCollectionDeltaDiff(
    [t1, t2],
    {},
    (t) => t.id,
    signatureForTender,
  );
  assert.equal(initialDiff.toUpsert.length, 2);
  assert.equal(initialDiff.toDeleteIds.length, 0);
  assert.equal(initialDiff.unchangedCount, 0);

  // Modify t2, keep t1 unchanged, remove nothing yet
  const t2Edited = { ...t2, title: 'Second Tender Updated', updatedAt: '2026-11-02T10:00:00.000Z' };
  const secondDiff = computeCollectionDeltaDiff(
    [t1, t2Edited, t3],
    initialDiff.nextSignatures,
    (t) => t.id,
    signatureForTender,
  );
  assert.deepEqual(
    secondDiff.toUpsert.map((t) => t.id),
    ['t2', 't3'],
  );
  assert.equal(secondDiff.unchangedCount, 1);
  assert.deepEqual(secondDiff.toDeleteIds, []);

  // Delete t1
  const deleteDiff = computeCollectionDeltaDiff(
    [t2Edited, t3],
    secondDiff.nextSignatures,
    (t) => t.id,
    signatureForTender,
  );
  assert.equal(deleteDiff.toUpsert.length, 0);
  assert.equal(deleteDiff.unchangedCount, 2);
  assert.deepEqual(deleteDiff.toDeleteIds, ['t1']);
});

test('computeCollectionDeltaDiff respects forceAll and allowDeletes=false', () => {
  const o1: OemRecord = {
    id: 'oem-1',
    oemName: 'NVS',
    companyName: 'Newtech',
    concernedPersonName: 'Sandeep',
    email: 's@nvs.com',
    phone: '9999',
    remarks: '',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
  const first = computeCollectionDeltaDiff([o1], {}, (o) => o.id, signatureForOem);
  const nonDestructive = computeCollectionDeltaDiff(
    [],
    first.nextSignatures,
    (o: OemRecord) => o.id,
    signatureForOem,
    { allowDeletes: false },
  );
  assert.deepEqual(nonDestructive.toDeleteIds, []);

  const forced = computeCollectionDeltaDiff(
    [o1],
    first.nextSignatures,
    (o) => o.id,
    signatureForOem,
    { forceAll: true },
  );
  assert.equal(forced.toUpsert.length, 1);
  assert.equal(forced.unchangedCount, 0);
});

test('scoped delta manifest strictly isolates Primary Admin and Secondary BYOC scopes', () => {
  const mem = createMemoryStorage();
  const adminScope = {
    projectId: 'radiant-subset-3kx2q',
    databaseId: 'ai-studio-bidledgertenderb-db',
    uid: 'admin-uid-1',
    tenantId: null,
  };
  const byocScope = {
    projectId: 'niyan-byoc-project',
    databaseId: '(default)',
    uid: 'niyan-uid-1',
    tenantId: 'sec_niyan',
  };

  assert.notEqual(buildDeltaSyncScopeKey(adminScope), buildDeltaSyncScopeKey(byocScope));

  const adminManifest = createEmptyDeltaManifest(buildDeltaSyncScopeKey(adminScope));
  adminManifest.lastSyncedAtMs = 1_760_000_000_000;
  adminManifest.lastSyncedIso = '2026-10-15T00:00:00.000Z';
  adminManifest.signatures.tenders['t-admin'] = 'sig_1';
  saveDeltaSyncManifest(adminManifest, mem);

  const loadedAdmin = loadDeltaSyncManifest(adminScope, mem);
  const loadedByoc = loadDeltaSyncManifest(byocScope, mem);

  assert.equal(loadedAdmin.lastSyncedAtMs, 1_760_000_000_000);
  assert.equal(loadedAdmin.signatures.tenders['t-admin'], 'sig_1');
  assert.equal(loadedByoc.lastSyncedAtMs, 0);
  assert.deepEqual(loadedByoc.signatures.tenders, {});

  clearDeltaSyncManifest(adminScope, mem);
  assert.equal(loadDeltaSyncManifest(adminScope, mem).lastSyncedAtMs, 0);
});

test('chunkOperations splits large batch arrays at 400 ops boundary', () => {
  const items = Array.from({ length: 850 }, (_, idx) => idx + 1);
  const chunks = chunkOperations(items, 400);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 400);
  assert.equal(chunks[1].length, 400);
  assert.equal(chunks[2].length, 50);
  assert.deepEqual(chunkOperations([], 400), []);
});

test('createDebouncedDeltaScheduler coalesces rapid repeated edits into a single flush and supports upsert/delete cancellation', async () => {
  const flushes: DirtySyncSnapshot[] = [];
  const scheduler = createDebouncedDeltaScheduler({
    debounceMs: 35,
    maxWaitMs: 120,
    onFlush: (snap) => {
      flushes.push(snap);
    },
  });

  // Rapid repeated edits to t1 + another edit to t2 + darkMode toggle x3
  scheduler.markUpsert('tenders', 't1');
  scheduler.markUpsert('tenders', 't1');
  scheduler.markUpsert('tenders', 't2');
  scheduler.markSingleton('preferences');
  scheduler.markSingleton('preferences');
  // Create then immediately delete t3 before debounce fires -> only delete should flush
  scheduler.markUpsert('tenders', 't3');
  scheduler.markDelete('tenders', 't3');

  assert.equal(scheduler.hasPending(), true);
  await new Promise((r) => setTimeout(r, 90));

  assert.equal(flushes.length, 1);
  assert.deepEqual(flushes[0].tenders.upserts.sort(), ['t1', 't2']);
  assert.deepEqual(flushes[0].tenders.deletes, ['t3']);
  assert.deepEqual(flushes[0].singletons, ['preferences']);
  assert.equal(scheduler.hasPending(), false);

  // Explicit flush drains immediately
  scheduler.markUpsert('oemRecords', 'oem-9');
  await scheduler.flush();
  assert.equal(flushes.length, 2);
  assert.deepEqual(flushes[1].oemRecords.upserts, ['oem-9']);
  scheduler.dispose();
});

test('collectDirtyAttachmentsFromEntities & collectMissingAttachmentIds identify incremental attachment needs accurately', () => {
  const tWithFile: Tender = {
    ...makeTender('t1'),
    attachments: [
      {
        id: 'att-1',
        slotLabel: 'Bid Document',
        fileName: 'bid.pdf',
        fileType: 'application/pdf',
        fileSize: 1024,
        uploadedAt: '2026-11-01T10:00:00.000Z',
        dataUrl: 'data:application/pdf;base64,AAAA',
      },
      {
        id: 'att-missing',
        slotLabel: 'Spec Document',
        fileName: 'spec.pdf',
        fileType: 'application/pdf',
        fileSize: 2048,
        uploadedAt: '2026-11-01T10:00:00.000Z',
        dataUrl: '',
      },
    ],
  };

  const emd: EmdBgRecord = {
    id: 'emd-1',
    tenderRefId: 't1',
    tenderId: 'GEM/t1',
    department: 'Dept A',
    instrumentType: 'e-PBG',
    referenceNo: 'REF1',
    bankName: 'SBI',
    amount: 5000,
    issueDate: '2026-11-01',
    expiryDate: '2027-01-01',
    claimEndDate: '2027-02-01',
    status: 'Active / Locked',
    remarks: '',
    attachments: [
      {
        id: 'att-emd-1',
        slotLabel: 'EMD Receipt',
        fileName: 'emd.pdf',
        fileType: 'application/pdf',
        fileSize: 512,
        uploadedAt: '2026-11-01',
        dataUrl: '',
      },
    ],
  };

  const maf: MafTrackerRecord = {
    id: 'maf-1',
    tenderRefId: 't1',
    tenderId: 'GEM/t1',
    tenderTitle: 'CCTV',
    department: 'Dept A',
    tenderDueDate: '2026-12-01T16:00',
    itemsMAF: [
      {
        itemId: 'item-1',
        itemName: 'Camera',
        requiredQuantity: '10',
        oemName: 'NVS',
        mafStatus: 'Received / Approved',
        mafRequestedDate: '2026-11-01',
        mafAttachmentId: 'maf-att-1',
        mafDocumentUrl: '',
        remarks: '',
      },
    ],
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
  };

  const dirtyAttachments = collectDirtyAttachmentsFromEntities({
    tenders: [tWithFile],
    emdRecords: [emd],
    mafTrackers: [maf],
  });
  assert.deepEqual(
    dirtyAttachments.map((a) => a.id),
    ['att-1'],
  );

  const missingIds = collectMissingAttachmentIds({
    tenders: [tWithFile],
    emdRecords: [emd],
    mafTrackers: [maf],
    loadedAttachmentFiles: new Map([['att-emd-1', 'data:application/pdf;base64,BBBB']]),
  });
  assert.deepEqual(missingIds.sort(), ['att-missing', 'maf-att-1']);

  assert.ok(signatureForEmd(emd).length > 0);
  assert.ok(signatureForMaf(maf).length > 0);
});

test('timestamp skew buffer, legacy scan TTL, and missing-index fallback helpers behave accurately', () => {
  assert.equal(resolveQuerySinceTimestampMs(0), 0);
  assert.equal(resolveQuerySinceTimestampMs(10_000, 5000), 5000);
  assert.equal(resolveQuerySinceTimestampMs(2000, 5000), 0);

  assert.equal(isLegacyFallbackScanDue(undefined, 1_000_000), true);
  assert.equal(isLegacyFallbackScanDue(999_000, 1_000_000, 60_000), false);
  assert.equal(isLegacyFallbackScanDue(900_000, 1_000_000, 60_000), true);

  assert.equal(
    shouldFallbackFromMissingIndex(new Error('The query requires an index (failed-precondition)')),
    true,
  );
  assert.equal(shouldFallbackFromMissingIndex(new Error('permission-denied')), false);
});
