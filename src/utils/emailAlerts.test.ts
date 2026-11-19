import assert from 'node:assert/strict';
import test from 'node:test';
import type { Tender } from '../types/crm';
import {
  buildEmailSlotKey,
  buildTenderEmailMessage,
  computePendingEmailAlerts,
  EMAIL_RETRY_COOLDOWN_MS,
  type EmailRetryRecord,
  getActiveDailyEmailSlot,
  getIstDateTimeParts,
  isValidNotificationEmail,
  recordEmailDispatchFailure,
  shouldAttemptEmailDispatch,
} from './emailAlerts';

const SAMPLE_TENDER: Tender = {
  id: 'tnd-army-1',
  tenderId: 'GEM/2026/B/8153995',
  portal: 'GeM',
  department: 'Indian Army Department Of Military Affairs',
  location: 'Panchkula, Haryana',
  category: 'LED Display, UPS, Workstation, Monitor',
  title: 'LED Display',
  publishDate: '2026-11-02',
  submissionDueDate: '2026-11-15T13:00',
  estimatedValue: 0,
  quotedValue: 0,
  emdStatus: 'Exempted - MSME/Startup',
  emdAmount: 0,
  stage: 'Doc Preparation',
  resultInfo: '',
  checklist: Array.from({ length: 7 }, (_, i) => ({
    id: `chk-${i + 1}`,
    label: `Doc ${i + 1}`,
    checked: false,
  })),
  remarks: [
    {
      id: 'rem-1',
      timestamp: '2026-11-14 10:00',
      text: 'MAF has been received till Monday (16-11-2026)',
    },
  ],
  createdAt: '2026-11-02T10:00:00Z',
  updatedAt: '2026-11-14T10:00:00Z',
};

test('isValidNotificationEmail validates email addresses cleanly', () => {
  assert.equal(isValidNotificationEmail('vanshsaxena7498@gmail.com'), true);
  assert.equal(isValidNotificationEmail('invalid-email'), false);
});

test('getIstDateTimeParts & getActiveDailyEmailSlot activate at 11:00 AM IST and 4:00 PM IST', () => {
  // 10:59 AM IST = 05:29 UTC -> null
  const before11am = new Date('2026-11-11T05:29:00Z');
  assert.deepEqual(getIstDateTimeParts(before11am), {
    dateKey: '2026-11-11',
    hour: 10,
    minute: 59,
  });
  assert.equal(getActiveDailyEmailSlot(before11am), null);

  // 11:00 AM IST = 05:30 UTC -> slot_11am
  const at11am = new Date('2026-11-11T05:30:00Z');
  assert.equal(getActiveDailyEmailSlot(at11am), 'slot_11am');

  // 3:59 PM IST = 10:29 UTC -> still slot_11am
  const before4pm = new Date('2026-11-11T10:29:00Z');
  assert.equal(getActiveDailyEmailSlot(before4pm), 'slot_11am');

  // 4:00 PM IST = 10:30 UTC -> slot_4pm
  const at4pm = new Date('2026-11-11T10:30:00Z');
  assert.equal(getActiveDailyEmailSlot(at4pm), 'slot_4pm');
});

test('buildTenderEmailMessage renders exact plain-text alert fields without WhatsApp markdown', () => {
  const now = new Date('2026-11-14T16:56:00'); // 20h 4m before 2026-11-15T13:00
  const { subject, text } = buildTenderEmailMessage(SAMPLE_TENDER, 'slot_11am', 'Vansh', now);

  assert.ok(subject.includes('GEM/2026/B/8153995'));
  assert.ok(!text.includes('*Tender ID:*'), 'Must not contain WhatsApp asterisks');
  assert.ok(text.includes('NEW TENDER ALERT NOTIFICATION (DUE WITHIN 48 HOURS)'));
  assert.ok(text.includes('Dear Vansh,'));
  assert.ok(text.includes('Tender ID: GEM/2026/B/8153995'));
  assert.ok(text.includes('Portal: GeM'));
  assert.ok(text.includes('Department: Indian Army Department Of Military Affairs'));
  assert.ok(text.includes('Location: Panchkula, Haryana'));
  assert.ok(text.includes('Category: LED Display, UPS, Workstation, Monitor'));
  assert.ok(text.includes('Work / Title: LED Display'));
  assert.ok(text.includes('Current Stage: Doc Preparation'));
  assert.ok(text.includes('Pre-Bid Meeting: N/A'));
  assert.ok(text.includes('Estimated Value: ₹ 0'));
  assert.ok(text.includes('Quoted Value: Not Quoted Yet'));
  assert.ok(text.includes('EMD Status: Exempted - MSME/Startup (₹ 0)'));
  assert.ok(text.includes('Checklist Progress: 0/7 completed'));
  assert.ok(text.includes('Latest Remark: MAF has been received till Monday (16-11-2026)'));
  assert.ok(text.includes('— Vansh Tender Software CRM'));
});

test('computePendingEmailAlerts targets tenders due within 5 days and deduplicates 11 AM & 4 PM IST slots daily', () => {
  const sentKeys = new Set<string>();
  const fiveDayTender: Tender = {
    ...SAMPLE_TENDER,
    id: 'tnd-within-5d',
    submissionDueDate: '2026-11-15T13:00',
  };
  const sixDayTender: Tender = {
    ...SAMPLE_TENDER,
    id: 'tnd-outside-5d',
    tenderId: 'GEM/2026/B/7777777',
    submissionDueDate: '2026-11-18T13:00',
  };
  const submittedTender: Tender = {
    ...SAMPLE_TENDER,
    id: 'tnd-submitted',
    stage: 'Submitted',
    submissionDueDate: '2026-11-12T13:00',
  };

  // Nov 11, 10:30 AM IST (05:00 UTC) -> before 11:00 AM -> 0 pending
  const before11am = new Date('2026-11-11T05:00:00Z');
  assert.equal(computePendingEmailAlerts([fiveDayTender, sixDayTender], sentKeys, before11am).length, 0);

  // Nov 11, 11:05 AM IST (05:35 UTC) -> fiveDayTender qualifies (~4 days away), sixDayTender & submitted excluded
  const at11am = new Date('2026-11-11T05:35:00Z');
  const morningRun = computePendingEmailAlerts(
    [fiveDayTender, sixDayTender, submittedTender],
    sentKeys,
    at11am,
  );
  assert.equal(morningRun.length, 1);
  assert.equal(morningRun[0].slot, 'slot_11am');
  assert.equal(morningRun[0].istDateKey, '2026-11-11');

  // Mark 11am sent -> 1:00 PM IST does not re-send
  sentKeys.add(morningRun[0].slotKey);
  const at1pm = new Date('2026-11-11T07:30:00Z');
  assert.equal(computePendingEmailAlerts([fiveDayTender], sentKeys, at1pm).length, 0);

  // Nov 11, 4:02 PM IST (10:32 UTC) -> triggers 4pm slot once
  const at4pm = new Date('2026-11-11T10:32:00Z');
  const eveningRun = computePendingEmailAlerts([fiveDayTender], sentKeys, at4pm);
  assert.equal(eveningRun.length, 1);
  assert.equal(eveningRun[0].slot, 'slot_4pm');
  sentKeys.add(eveningRun[0].slotKey);

  // Already sent 4pm -> 6:00 PM IST does not re-send
  assert.equal(
    computePendingEmailAlerts([fiveDayTender], sentKeys, new Date('2026-11-11T12:30:00Z')).length,
    0,
  );

  // Next day Nov 12, 11:00 AM IST -> sends fresh morning slot again
  const nextMorning = new Date('2026-11-12T05:30:00Z');
  const day2Morning = computePendingEmailAlerts([fiveDayTender], sentKeys, nextMorning);
  assert.equal(day2Morning.length, 1);
  assert.equal(day2Morning[0].slotKey, buildEmailSlotKey(fiveDayTender, '2026-11-12', 'slot_11am'));
});

test('buildTenderEmailMessage selects newest remark regardless of array order and throttles failed retries', () => {
  const multiRemarkTender: Tender = {
    ...SAMPLE_TENDER,
    remarks: [
      { id: 'rem-new', timestamp: '2026-11-14 16:30', text: 'Latest price sheet approved' },
      { id: 'rem-old', timestamp: '2026-11-10 09:00', text: 'Initial BOQ review' },
    ],
  };
  const { text } = buildTenderEmailMessage(
    multiRemarkTender,
    'slot_11am',
    'Vansh',
    new Date('2026-11-14T16:56:00'),
  );
  assert.ok(text.includes('Latest Remark: Latest price sheet approved'));
  assert.ok(!text.includes('Initial BOQ review'));

  const retryMap = new Map<string, EmailRetryRecord>();
  const slotKey = 'email_tnd_1_slot_11am';
  const t0 = 1_700_000_000_000;
  assert.equal(shouldAttemptEmailDispatch(retryMap, slotKey, t0), true);

  recordEmailDispatchFailure(retryMap, slotKey, t0);
  assert.equal(shouldAttemptEmailDispatch(retryMap, slotKey, t0 + 30_000), false);
  assert.equal(shouldAttemptEmailDispatch(retryMap, slotKey, t0 + EMAIL_RETRY_COOLDOWN_MS), true);

  recordEmailDispatchFailure(retryMap, slotKey, t0 + EMAIL_RETRY_COOLDOWN_MS);
  recordEmailDispatchFailure(retryMap, slotKey, t0 + EMAIL_RETRY_COOLDOWN_MS * 2);
  assert.equal(shouldAttemptEmailDispatch(retryMap, slotKey, t0 + EMAIL_RETRY_COOLDOWN_MS * 10), false);
});
