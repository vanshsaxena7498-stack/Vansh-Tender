import assert from 'node:assert/strict';
import test from 'node:test';
import { SEED_TENDERS } from '../data/seedData';
import type { MafLineItem, MafTrackerRecord } from '../types/crm';
import {
  calculateOverallMafStatus,
  computeMafSummaryMetrics,
  findDailyTenderByCode,
  findMatchingDailyTender,
  resolveAndFilterMafTrackers,
  validateMafItemDraft,
  validateMafUploadFile,
} from './mafCalculations';

function makeItem(partial: Partial<MafLineItem> = {}): MafLineItem {
  return {
    itemId: 'item-1',
    itemName: 'Dome Cameras',
    requiredQuantity: '20 Nos',
    oemName: 'CP Plus',
    mafStatus: 'Not Requested',
    validityDate: '2026-12-22',
    mafDocumentUrl: '',
    remarks: '',
    ...partial,
  };
}

test('calculateOverallMafStatus rolls up item statuses accurately', () => {
  assert.equal(calculateOverallMafStatus([]), 'Not Requested');
  assert.equal(
    calculateOverallMafStatus([
      makeItem({ mafStatus: 'Received / Approved' }),
      makeItem({ itemId: 'item-2', mafStatus: 'Received / Approved' }),
    ]),
    'Received / Approved',
  );
  assert.equal(
    calculateOverallMafStatus([
      makeItem({ mafStatus: 'Received / Approved' }),
      makeItem({ itemId: 'item-2', mafStatus: 'Rejected' }),
    ]),
    'Rejected',
  );
  assert.equal(
    calculateOverallMafStatus([
      makeItem({ mafStatus: 'Under Approval' }),
      makeItem({ itemId: 'item-2', mafStatus: 'Requested / Follow-up' }),
    ]),
    'Under Approval',
  );
  assert.equal(
    calculateOverallMafStatus([
      makeItem({ mafStatus: 'Received / Approved' }),
      makeItem({ itemId: 'item-2', mafStatus: 'Not Requested' }),
    ]),
    'Under Approval',
  );
  assert.equal(
    calculateOverallMafStatus([
      makeItem({ mafStatus: 'Requested / Follow-up' }),
      makeItem({ itemId: 'item-2', mafStatus: 'Not Requested' }),
    ]),
    'Requested / Follow-up',
  );
});

test('computeMafSummaryMetrics aggregates active tenders, items, pending, and received counts', () => {
  const trackers: MafTrackerRecord[] = [
    {
      id: 'maf-1',
      tenderRefId: SEED_TENDERS[0].id,
      tenderId: SEED_TENDERS[0].tenderId,
      itemsMAF: [
        makeItem({ itemId: 'a', mafStatus: 'Received / Approved' }),
        makeItem({ itemId: 'b', mafStatus: 'Under Approval' }),
        makeItem({ itemId: 'c', mafStatus: 'Rejected' }),
      ],
      createdAt: '2026-11-01T10:00:00Z',
      updatedAt: '2026-11-10T10:00:00Z',
    },
    {
      id: 'maf-2',
      tenderRefId: SEED_TENDERS[1].id,
      tenderId: SEED_TENDERS[1].tenderId,
      itemsMAF: [makeItem({ itemId: 'd', mafStatus: 'Not Requested' })],
      createdAt: '2026-11-02T10:00:00Z',
      updatedAt: '2026-11-11T10:00:00Z',
    },
  ];

  const metrics = computeMafSummaryMetrics(trackers, SEED_TENDERS);
  assert.equal(metrics.totalActiveTenders, 2);
  assert.equal(metrics.totalItemsTracked, 4);
  assert.equal(metrics.mafReceived, 1);
  assert.equal(metrics.mafPending, 3);
});

test('resolveAndFilterMafTrackers joins tender data and filters by Tender ID, Item/OEM, and Overall Status', () => {
  const trackers: MafTrackerRecord[] = [
    {
      id: 'maf-1',
      tenderRefId: SEED_TENDERS[0].id,
      tenderId: SEED_TENDERS[0].tenderId,
      itemsMAF: [
        makeItem({ itemId: 'a', itemName: 'Layer-3 Switches', oemName: 'Cisco', mafStatus: 'Received / Approved' }),
        makeItem({ itemId: 'b', itemName: 'Next-Gen Firewall', oemName: 'Fortinet', mafStatus: 'Under Approval' }),
      ],
      createdAt: '2026-11-01T10:00:00Z',
      updatedAt: '2026-11-12T10:00:00Z',
    },
    {
      id: 'maf-2',
      tenderRefId: SEED_TENDERS[1].id,
      tenderId: SEED_TENDERS[1].tenderId,
      itemsMAF: [
        makeItem({ itemId: 'c', itemName: 'ANPR Cameras', oemName: 'Hikvision', mafStatus: 'Requested / Follow-up' }),
      ],
      createdAt: '2026-11-01T10:00:00Z',
      updatedAt: '2026-11-11T10:00:00Z',
    },
  ];

  const byItem = resolveAndFilterMafTrackers(trackers, SEED_TENDERS, {
    tenderQuery: '',
    itemOrOemQuery: 'fortinet',
    statusFilter: 'ALL',
  });
  assert.equal(byItem.length, 1);
  assert.equal(byItem[0].matchedItems.length, 1);
  assert.equal(byItem[0].resolvedDepartment, SEED_TENDERS[0].department);

  const byStatus = resolveAndFilterMafTrackers(trackers, SEED_TENDERS, {
    tenderQuery: '',
    itemOrOemQuery: '',
    statusFilter: 'Requested / Follow-up',
  });
  assert.equal(byStatus.length, 1);
  assert.equal(byStatus[0].tenderId, SEED_TENDERS[1].tenderId);
});

test('findDailyTenderByCode and findMatchingDailyTender match registered Daily Tenders case-insensitively and reject unknown codes', () => {
  const target = SEED_TENDERS[0];
  const foundExact = findDailyTenderByCode(SEED_TENDERS, `  ${target.tenderId.toLowerCase()}  `);
  assert.equal(foundExact?.id, target.id);
  assert.equal(foundExact?.department, target.department);

  const notFound = findDailyTenderByCode(SEED_TENDERS, 'UNKNOWN/9999/XYZ');
  assert.equal(notFound, undefined);

  const mismatchedCodeWithOldRef = findMatchingDailyTender(
    SEED_TENDERS,
    'UNREGISTERED-NEW-TENDER',
    target.id,
  );
  assert.equal(mismatchedCodeWithOldRef, undefined);
});

test('validateMafItemDraft and validateMafUploadFile enforce required fields and 5MB PDF/image bounds', () => {
  assert.ok(validateMafItemDraft({ itemName: '', oemName: 'Cisco' }));
  assert.ok(validateMafItemDraft({ itemName: 'Switches', oemName: '  ' }));
  assert.equal(validateMafItemDraft({ itemName: 'Switches', oemName: 'Cisco' }), null);

  assert.equal(
    validateMafUploadFile({ name: 'maf_signed.pdf', type: 'application/pdf', size: 1024 * 1024 }),
    null,
  );
  assert.ok(
    validateMafUploadFile({ name: 'huge.pdf', type: 'application/pdf', size: 6 * 1024 * 1024 }),
  );
  assert.ok(
    validateMafUploadFile({ name: 'script.exe', type: 'application/x-msdownload', size: 5000 }),
  );
});
