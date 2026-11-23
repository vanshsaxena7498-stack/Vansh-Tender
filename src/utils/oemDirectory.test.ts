import assert from 'node:assert/strict';
import test from 'node:test';
import type { MafTrackerRecord, OemRecord } from '../types/crm';
import {
  buildMafContactPatchFromOem,
  computeOemUsageMap,
  filterOemRecords,
  findOemById,
  findOemByName,
  normalizeOemNameKey,
  sanitizeOemDraft,
  validateOemDraft,
} from './oemDirectory';

function makeOem(partial: Partial<OemRecord> = {}): OemRecord {
  return {
    id: 'oem-nvs',
    oemName: 'NVS',
    companyName: 'Newtech',
    concernedPersonName: 'Sandeep Tyagi',
    email: 'sandeep.tyagi@nvsledwall.com',
    phone: '+91 8800686947',
    remarks: 'LED Video Wall OEM',
    createdAt: '2026-11-20T10:00:00Z',
    updatedAt: '2026-11-20T10:00:00Z',
    ...partial,
  };
}

test('normalizeOemNameKey normalizes case and internal whitespace', () => {
  assert.equal(normalizeOemNameKey('  APC  /  Schneider Electric '), 'apc / schneider electric');
  assert.equal(normalizeOemNameKey('NVS'), 'nvs');
});

test('validateOemDraft enforces required oemName, uniqueness, email syntax, and field limits', () => {
  const existing: OemRecord[] = [
    makeOem({ id: 'oem-1', oemName: 'NVS' }),
    makeOem({ id: 'oem-2', oemName: 'CP Plus' }),
  ];

  // Missing OEM name
  assert.ok(
    validateOemDraft(
      {
        oemName: '   ',
        companyName: 'Newtech',
        concernedPersonName: 'Sandeep',
        email: '',
        phone: '',
        remarks: '',
      },
      existing,
    ),
  );

  // Duplicate OEM name (case + whitespace insensitive)
  assert.ok(
    validateOemDraft(
      {
        oemName: '  cp   plus ',
        companyName: 'Aditya Infotech',
        concernedPersonName: 'Ravi',
        email: 'ravi@cpplus.com',
        phone: '',
        remarks: '',
      },
      existing,
    ),
  );

  // Editing same OEM record allows keeping its own name
  assert.equal(
    validateOemDraft(
      {
        oemName: 'CP Plus',
        companyName: 'Aditya Infotech',
        concernedPersonName: 'Ravi Singh',
        email: 'ravi.singh@cpplusworld.com',
        phone: '+91 98112 44019',
        remarks: 'Authorized partner',
      },
      existing,
      'oem-2',
    ),
    null,
  );

  // Invalid email format rejected when non-empty
  assert.ok(
    validateOemDraft(
      {
        oemName: 'Bosch',
        companyName: 'Bosch Security',
        concernedPersonName: 'Arjun',
        email: 'not-an-email',
        phone: '',
        remarks: '',
      },
      existing,
    ),
  );

  // Valid new OEM with optional blank fields passes
  assert.equal(
    validateOemDraft(
      {
        oemName: 'Bosch',
        companyName: '',
        concernedPersonName: '',
        email: '',
        phone: '',
        remarks: '',
      },
      existing,
    ),
    null,
  );
});

test('findOemById, findOemByName, and buildMafContactPatchFromOem map all MAF contact fields cleanly', () => {
  const oems = [makeOem({ id: 'oem-nvs', oemName: 'NVS' })];
  assert.equal(findOemById(oems, 'oem-nvs')?.companyName, 'Newtech');
  assert.equal(findOemByName(oems, '  nvs ')?.concernedPersonName, 'Sandeep Tyagi');
  assert.equal(findOemByName(oems, 'Unlisted OEM'), undefined);

  const patch = buildMafContactPatchFromOem(oems[0]);
  assert.deepEqual(patch, {
    oemName: 'NVS',
    companyName: 'Newtech',
    concernedPersonName: 'Sandeep Tyagi',
    contactNo: '+91 8800686947',
    mailId: 'sandeep.tyagi@nvsledwall.com',
    oemContact: 'Sandeep Tyagi · +91 8800686947',
  });
});

test('filterOemRecords searches across OEM Name, Company, Concerned Person, Email, Phone, and Remarks', () => {
  const oems = [
    makeOem({ id: 'oem-1', oemName: 'NVS', companyName: 'Newtech', email: 'sandeep.tyagi@nvsledwall.com' }),
    makeOem({
      id: 'oem-2',
      oemName: 'Cisco',
      companyName: 'Cisco Systems India',
      concernedPersonName: 'Neha Verma',
      email: 'neha.verma@cisco.com',
      phone: '+91 98201 33490',
      remarks: 'Enterprise networking',
    }),
  ];

  assert.deepEqual(
    filterOemRecords(oems, '').map((o) => o.oemName),
    ['Cisco', 'NVS'],
  );
  assert.deepEqual(
    filterOemRecords(oems, 'newtech').map((o) => o.id),
    ['oem-1'],
  );
  assert.deepEqual(
    filterOemRecords(oems, '98201').map((o) => o.id),
    ['oem-2'],
  );
  assert.deepEqual(
    filterOemRecords(oems, 'neha.verma').map((o) => o.id),
    ['oem-2'],
  );
});

test('computeOemUsageMap counts distinct tenders and BOQ items per registered OEM', () => {
  const oems = [
    makeOem({ id: 'oem-cisco', oemName: 'Cisco' }),
    makeOem({ id: 'oem-nvs', oemName: 'NVS' }),
  ];
  const trackers: MafTrackerRecord[] = [
    {
      id: 'maf-1',
      tenderRefId: 'tnd-1',
      tenderId: 'GEM/2026/1',
      itemsMAF: [
        {
          itemId: 'i1',
          itemName: 'Core Switch',
          requiredQuantity: '4',
          oemName: 'Cisco',
          mafStatus: 'Received / Approved',
          mafRequestedDate: '2026-11-01',
          mafDocumentUrl: '',
          remarks: '',
        },
        {
          itemId: 'i2',
          itemName: 'Access Switch',
          requiredQuantity: '10',
          oemName: 'cisco',
          mafStatus: 'Under Approval',
          mafRequestedDate: '2026-11-02',
          mafDocumentUrl: '',
          remarks: '',
        },
      ],
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-02T00:00:00Z',
    },
    {
      id: 'maf-2',
      tenderRefId: 'tnd-2',
      tenderId: 'GEM/2026/2',
      itemsMAF: [
        {
          itemId: 'i3',
          itemName: 'Firewall',
          requiredQuantity: '2',
          oemName: 'Cisco',
          mafStatus: 'Not Requested',
          mafRequestedDate: '',
          mafDocumentUrl: '',
          remarks: '',
        },
      ],
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-02T00:00:00Z',
    },
  ];

  const usage = computeOemUsageMap(oems, trackers);
  assert.deepEqual(usage.get('oem-cisco'), { tenderCount: 2, itemCount: 3 });
  assert.deepEqual(usage.get('oem-nvs'), { tenderCount: 0, itemCount: 0 });
});

test('sanitizeOemDraft trims whitespace cleanly', () => {
  const cleaned = sanitizeOemDraft({
    oemName: '  NVS  ',
    companyName: '  Newtech ',
    concernedPersonName: ' Sandeep Tyagi ',
    email: ' sandeep.tyagi@nvsledwall.com ',
    phone: ' +91 8800686947 ',
    remarks: ' LED Display  ',
  });
  assert.equal(cleaned.oemName, 'NVS');
  assert.equal(cleaned.companyName, 'Newtech');
  assert.equal(cleaned.concernedPersonName, 'Sandeep Tyagi');
  assert.equal(cleaned.email, 'sandeep.tyagi@nvsledwall.com');
  assert.equal(cleaned.phone, '+91 8800686947');
  assert.equal(cleaned.remarks, 'LED Display');
});
