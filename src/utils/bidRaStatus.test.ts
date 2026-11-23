import assert from 'node:assert/strict';
import test from 'node:test';
import type { Tender } from '../types/crm';
import {
  BID_RA_RANK_OPTIONS,
  FINANCIAL_RA_STATUS_OPTIONS,
  isTenderDuePassed,
  parseDueDateTimeMs,
  partitionTendersByDueDate,
  TECHNICAL_STATUS_OPTIONS,
  toDateTimeLocalInput,
} from './bidRaStatus';

function makeTender(id: string, submissionDueDate: string): Tender {
  return {
    id,
    tenderId: `GEM/2026/B/${id}`,
    portal: 'GeM',
    department: 'Ministry of Defence',
    location: 'New Delhi',
    category: 'IT Hardware',
    title: 'Sample Tender',
    publishDate: '2026-11-01',
    submissionDueDate,
    estimatedValue: 100000,
    quotedValue: 95000,
    emdStatus: 'No EMD',
    emdAmount: 0,
    stage: 'Submitted',
    resultInfo: '',
    checklist: [],
    remarks: [],
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  };
}

test('parseDueDateTimeMs interprets naive datetime-local and DD/MM/YYYY HH:mm in IST (+05:30)', () => {
  const isoLocalMs = parseDueDateTimeMs('2026-11-23T16:00');
  const indianMs = parseDueDateTimeMs('23/11/2026 16:00');
  const explicitIstMs = Date.parse('2026-11-23T16:00:00+05:30');

  assert.equal(isoLocalMs, explicitIstMs);
  assert.equal(indianMs, explicitIstMs);
  assert.equal(parseDueDateTimeMs(''), null);
  assert.equal(parseDueDateTimeMs('not-a-date'), null);
});

test('tenders on 23 Nov 2026 at 16:00 move out of Daily Tender Data once 16:00 IST passes', () => {
  const refAfter4PmIst = new Date('2026-11-23T16:52:00+05:30');
  const refBefore4PmIst = new Date('2026-11-23T15:59:00+05:30');

  const dueAt4Pm = makeTender('past-4pm', '2026-11-23T16:00');
  const dueAt4PmIndian = makeTender('past-4pm-dmy', '23/11/2026 16:00');
  const dueLaterToday = makeTender('later-1800', '2026-11-23T18:00');
  const dueFutureDay = makeTender('future-26', '2026-11-26T17:00');

  assert.equal(isTenderDuePassed(dueAt4Pm, refAfter4PmIst), true);
  assert.equal(isTenderDuePassed(dueAt4PmIndian, refAfter4PmIst), true);
  assert.equal(isTenderDuePassed(dueLaterToday, refAfter4PmIst), false);
  assert.equal(isTenderDuePassed(dueFutureDay, refAfter4PmIst), false);

  assert.equal(isTenderDuePassed(dueAt4Pm, refBefore4PmIst), false);

  const partitioned = partitionTendersByDueDate(
    [dueAt4Pm, dueAt4PmIndian, dueLaterToday, dueFutureDay],
    refAfter4PmIst,
  );
  assert.deepEqual(
    partitioned.bidRaTenders.map((t) => t.id),
    ['past-4pm', 'past-4pm-dmy'],
  );
  assert.deepEqual(
    partitioned.dailyTenders.map((t) => t.id),
    ['later-1800', 'future-26'],
  );
});

test('editing a tender due date back to the future moves it back into Daily Tender Data', () => {
  const now = new Date('2026-11-23T16:52:00+05:30');
  const initial = makeTender('t1', '2026-11-23T16:00');
  assert.equal(partitionTendersByDueDate([initial], now).bidRaTenders.length, 1);

  const extended = { ...initial, submissionDueDate: '2026-11-29T16:00' };
  const afterEdit = partitionTendersByDueDate([extended], now);
  assert.equal(afterEdit.dailyTenders.length, 1);
  assert.equal(afterEdit.bidRaTenders.length, 0);
});

test('toDateTimeLocalInput and dropdown option lists expose expected values', () => {
  assert.equal(toDateTimeLocalInput('2026-11-23T16:00'), '2026-11-23T16:00');
  assert.equal(toDateTimeLocalInput('23/11/2026 16:00'), '2026-11-23T16:00');
  assert.equal(toDateTimeLocalInput('2026-11-23'), '2026-11-23T00:00');
  assert.equal(toDateTimeLocalInput(''), '');
  assert.ok(TECHNICAL_STATUS_OPTIONS.includes('Technically Qualified'));
  assert.ok(FINANCIAL_RA_STATUS_OPTIONS.includes('RA Scheduled / Live'));
  assert.ok(BID_RA_RANK_OPTIONS.includes('L1'));
});
