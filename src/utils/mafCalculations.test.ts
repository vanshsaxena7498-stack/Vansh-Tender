import assert from 'node:assert/strict';
import test from 'node:test';
import { SEED_TENDERS } from '../data/seedData';
import type { MafLineItem, MafTrackerRecord } from '../types/crm';
import {
  calculateOverallMafStatus,
  computeMafSummaryMetrics,
  findDailyTenderByCode,
  findMatchingDailyTender,
  getMafContactDetails,
  getMafRequestedDate,
  isSafeHttpUrl,
  isSafeMafDataUrl,
  resolveAndFilterMafTrackers,
  sanitizeMafDocumentUrl,
  validateMafItemDraft,
  validateMafUploadFile,
} from './mafCalculations';

function makeItem(partial: Partial<MafLineItem> = {}): MafLineItem {
  return {
    itemId: 'item-1',
    itemName: 'Dome Cameras',
    requiredQuantity: '20 Nos',
    oemName: 'CP Plus',
    concernedPersonName: 'Ravi Singh',
    contactNo: '+91 98112 44019',
    mailId: 'ravi.singh@cpplusworld.com',
    mafStatus: 'Not Requested',
    mafRequestedDate: '2026-11-05',
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
  assert.equal(
    calculateOverallMafStatus([
      makeItem({ mafStatus: 'Pending', oemName: '' }),
      makeItem({ itemId: 'item-2', mafStatus: 'Pending', oemName: '' }),
    ]),
    'Pending',
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

test('resolveAndFilterMafTrackers joins tender data, prefers Attachment 1 tracker department, and filters by Tender ID, Item/OEM, and Overall Status', () => {
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
      department: 'Attachment 1 Inviting Authority Dept',
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
  assert.equal(byStatus[0].resolvedDepartment, 'Attachment 1 Inviting Authority Dept');
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

test('validateMafItemDraft and validateMafUploadFile enforce required fields, allow blank OEM for Pending items, restrict OEMs to directory when provided, and enforce 5MB PDF/image bounds', () => {
  assert.ok(validateMafItemDraft({ itemName: '', oemName: 'Cisco' }));
  assert.ok(validateMafItemDraft({ itemName: 'Switches', oemName: '  ' }));
  assert.equal(validateMafItemDraft({ itemName: 'Switches', oemName: '', mafStatus: 'Pending' }), null);
  assert.equal(validateMafItemDraft({ itemName: 'Switches', oemName: '', allowBlankOem: true }), null);
  assert.equal(validateMafItemDraft({ itemName: 'Switches', oemName: 'Cisco' }), null);
  assert.equal(
    validateMafItemDraft({
      itemName: 'LED Wall',
      oemName: 'NVS',
      allowedOemNames: ['NVS', 'Cisco'],
    }),
    null,
  );
  assert.ok(
    validateMafItemDraft({
      itemName: 'LED Wall',
      oemName: 'UnlistedBrand',
      allowedOemNames: ['NVS', 'Cisco'],
    }),
  );
  assert.equal(
    validateMafItemDraft({
      itemName: 'LED Wall',
      oemName: '',
      mafStatus: 'Pending',
      allowedOemNames: ['NVS', 'Cisco'],
    }),
    null,
  );

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

test('getMafRequestedDate and getMafContactDetails resolve structured fields and legacy fallbacks', () => {
  assert.equal(
    getMafRequestedDate({ mafRequestedDate: '2026-11-10', validityDate: '2026-12-22' }),
    '2026-11-10',
  );
  assert.equal(
    getMafRequestedDate({ mafRequestedDate: '', validityDate: '2026-12-22' } as MafLineItem),
    '2026-12-22',
  );

  const legacyContact = getMafContactDetails({
    oemContact: 'Amit Kumar · +91 98730 11842',
  });
  assert.deepEqual(legacyContact, {
    concernedPersonName: 'Amit Kumar',
    contactNo: '+91 98730 11842',
    mailId: '',
  });

  const structuredContact = getMafContactDetails({
    concernedPersonName: 'Neha Verma',
    contactNo: '+91 98201 33490',
    mailId: 'neha.verma@cisco.com',
  });
  assert.deepEqual(structuredContact, {
    concernedPersonName: 'Neha Verma',
    contactNo: '+91 98201 33490',
    mailId: 'neha.verma@cisco.com',
  });
});

test('resolveAndFilterMafTrackers matches Concerned Person Name, Contact No., and Mail ID', () => {
  const trackers: MafTrackerRecord[] = [
    {
      id: 'maf-contact-1',
      tenderRefId: SEED_TENDERS[0].id,
      tenderId: SEED_TENDERS[0].tenderId,
      itemsMAF: [
        makeItem({
          itemId: 'a',
          itemName: 'Core Switches',
          oemName: 'Cisco',
          concernedPersonName: 'Neha Verma',
          contactNo: '+91 98201 33490',
          mailId: 'neha.verma@cisco.com',
        }),
      ],
      createdAt: '2026-11-01T10:00:00Z',
      updatedAt: '2026-11-12T10:00:00Z',
    },
  ];

  assert.equal(
    resolveAndFilterMafTrackers(trackers, SEED_TENDERS, {
      tenderQuery: '',
      itemOrOemQuery: 'neha.verma@cisco.com',
      statusFilter: 'ALL',
    }).length,
    1,
  );
  assert.equal(
    resolveAndFilterMafTrackers(trackers, SEED_TENDERS, {
      tenderQuery: '',
      itemOrOemQuery: '98201 33490',
      statusFilter: 'ALL',
    }).length,
    1,
  );
});

test('URL safety helpers allow https/http and safe PDF/image data URIs while blocking XSS schemes', () => {
  assert.equal(isSafeHttpUrl('https://drive.google.com/file/d/123'), true);
  assert.equal(isSafeHttpUrl('http://intranet.local/maf.pdf'), true);
  assert.equal(isSafeHttpUrl('javascript:alert(1)'), false);
  assert.equal(isSafeHttpUrl('vbscript:msgbox(1)'), false);

  assert.equal(isSafeMafDataUrl('data:application/pdf;base64,JVBERi0xLjQ='), true);
  assert.equal(isSafeMafDataUrl('data:image/png;base64,iVBORw0KGgo='), true);
  assert.equal(isSafeMafDataUrl('data:text/html;base64,PHNjcmlwdD4='), false);

  assert.equal(sanitizeMafDocumentUrl('javascript:alert(document.cookie)'), '');
  assert.equal(sanitizeMafDocumentUrl('data:text/html;base64,PHNjcmlwdD4='), '');
  assert.equal(
    sanitizeMafDocumentUrl(' https://example.com/signed-maf.pdf '),
    'https://example.com/signed-maf.pdf',
  );
});
