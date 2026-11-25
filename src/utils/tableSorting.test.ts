import assert from 'node:assert/strict';
import test from 'node:test';
import type { MafTrackerRecord, OemRecord, Tender } from '../types/crm';
import {
  parseSortableDateMs,
  resolveOemLinkedContexts,
  sortRecordsByDate,
} from './tableSorting';

test('parseSortableDateMs parses ISO, datetime-local, date-only, and DD/MM/YYYY formats', () => {
  const d1 = parseSortableDateMs('2026-10-15T10:00:00Z');
  const d2 = parseSortableDateMs('2026-11-26T17:00');
  const d3 = parseSortableDateMs('2026-12-01');
  const d4 = parseSortableDateMs('15/11/2026');

  assert.ok(d1 !== null && d2 !== null && d3 !== null && d4 !== null);
  assert.ok(d1 < d4);
  assert.ok(d4 < d2);
  assert.ok(d2 < d3);
  assert.equal(parseSortableDateMs(''), null);
  assert.equal(parseSortableDateMs(undefined), null);
});

test('sortRecordsByDate toggles oldest-first (asc) and newest-first (desc) cleanly', () => {
  const rows = [
    { id: 'mid', date: '2026-11-15T14:00' },
    { id: 'oldest', date: '2026-07-02T10:00' },
    { id: 'newest', date: '2026-12-05T17:00' },
    { id: 'blank', date: '' },
  ];

  const asc = sortRecordsByDate(rows, (r) => r.date, 'asc');
  assert.deepEqual(
    asc.map((r) => r.id),
    ['oldest', 'mid', 'newest', 'blank'],
  );

  const desc = sortRecordsByDate(rows, (r) => r.date, 'desc');
  assert.deepEqual(
    desc.map((r) => r.id),
    ['newest', 'mid', 'oldest', 'blank'],
  );
});

test('resolveOemLinkedContexts resolves tender numbers and locations for linked OEMs', () => {
  const oems: OemRecord[] = [
    {
      id: 'oem-cisco',
      oemName: 'Cisco',
      companyName: 'Cisco Systems India Pvt. Ltd.',
      concernedPersonName: 'Neha Verma',
      email: 'neha.verma@cisco.com',
      phone: '+91 98201 33490',
      remarks: 'Networking switches',
      createdAt: '2026-10-15T10:00:00Z',
      updatedAt: '2026-11-13T12:30:00Z',
    },
    {
      id: 'oem-nvs',
      oemName: 'NVS',
      companyName: 'Newtech',
      concernedPersonName: 'Sandeep Tyagi',
      email: 'sandeep.tyagi@nvsledwall.com',
      phone: '+91 8800686947',
      remarks: 'LED Video Wall',
      createdAt: '2026-10-15T10:00:00Z',
      updatedAt: '2026-11-15T10:00:00Z',
    },
  ];

  const tenders: Tender[] = [
    {
      id: 'tnd-1',
      tenderId: 'GEM/2026/B/5489210',
      portal: 'GeM',
      department: 'Ministry of Defence (MES)',
      location: 'Pune, Maharashtra',
      category: 'IT Hardware',
      title: 'Core Switches',
      publishDate: '2026-10-28',
      submissionDueDate: '2026-11-14T16:00',
      estimatedValue: 100000,
      quotedValue: 95000,
      emdStatus: 'No EMD',
      emdAmount: 0,
      stage: 'Submitted',
      resultInfo: '',
      checklist: [],
      remarks: [],
      createdAt: '2026-10-28T10:00:00Z',
      updatedAt: '2026-11-12T17:30:00Z',
    },
  ];

  const trackers: MafTrackerRecord[] = [
    {
      id: 'maf-1',
      tenderRefId: 'tnd-1',
      tenderId: 'GEM/2026/B/5489210',
      itemsMAF: [
        {
          itemId: 'i-1',
          itemName: 'Core Switch',
          requiredQuantity: '12 Nos',
          oemName: 'Cisco',
          mafStatus: 'Received / Approved',
          mafRequestedDate: '2026-11-01',
          mafDocumentUrl: '',
          remarks: '',
        },
      ],
      createdAt: '2026-10-30T10:00:00Z',
      updatedAt: '2026-11-12T17:30:00Z',
    },
  ];

  const ctx = resolveOemLinkedContexts(oems, trackers, tenders);
  assert.equal(ctx.get('oem-cisco')?.tenderNosLabel, 'GEM/2026/B/5489210');
  assert.equal(ctx.get('oem-cisco')?.locationLabel, 'Pune, Maharashtra');
  assert.equal(ctx.get('oem-cisco')?.linkedItems.length, 1);

  assert.equal(ctx.get('oem-nvs')?.tenderNosLabel, '—');
  assert.equal(ctx.get('oem-nvs')?.locationLabel, '—');
  assert.equal(ctx.get('oem-nvs')?.linkedItems.length, 0);
});
