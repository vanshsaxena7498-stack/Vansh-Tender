import assert from 'node:assert/strict';
import test from 'node:test';
import type { Tender } from '../types/crm';
import {
  buildTenderWhatsAppMessage,
  buildWhatsAppMilestoneKey,
  buildWhatsAppWebUrl,
  computePendingWhatsAppAlerts,
  normalizeIndianWhatsAppPhone,
} from './whatsappAlerts';

function makeTender(overrides: Partial<Tender> = {}): Tender {
  return {
    id: 'tnd-100',
    tenderId: 'GEM/2026/B/900123',
    portal: 'GeM',
    department: 'Ministry of Railways',
    location: 'New Delhi',
    category: 'IT Hardware',
    title: 'Supply and Installation of Enterprise Servers',
    publishDate: '2026-11-10',
    submissionDueDate: '2026-11-15T15:00',
    preBidDate: '2026-11-12T11:00',
    estimatedValue: 4500000,
    quotedValue: 4200000,
    emdStatus: 'EMD Paid',
    emdAmount: 90000,
    stage: 'Doc Preparation',
    resultInfo: '',
    checklist: [
      { id: 'c1', label: 'PAN / GST', checked: true },
      { id: 'c2', label: 'MAF Signed', checked: false },
    ],
    remarks: [{ id: 'r1', timestamp: '2026-11-12T09:00:00Z', text: 'OEM quotes awaited' }],
    createdAt: '2026-11-10T09:00:00Z',
    updatedAt: '2026-11-12T09:00:00Z',
    ...overrides,
  };
}

test('normalizeIndianWhatsAppPhone normalizes 10-digit Indian mobile numbers to 91 prefix', () => {
  assert.equal(normalizeIndianWhatsAppPhone('9717690890'), '919717690890');
  assert.equal(normalizeIndianWhatsAppPhone('+91 97176-90890'), '919717690890');
  assert.equal(normalizeIndianWhatsAppPhone('09717690890'), '919717690890');
});

test('buildTenderWhatsAppMessage includes full tender details and last date of filing', () => {
  const tender = makeTender();
  const now = new Date('2026-11-15T11:30:00');
  const msg = buildTenderWhatsAppMessage(tender, 'urgent_4h', 'Vansh', now);

  assert.match(msg, /ONLY <= 4 HOURS LEFT TO FILE/);
  assert.match(msg, /Dear Vansh/);
  assert.match(msg, /GEM\/2026\/B\/900123/);
  assert.match(msg, /Ministry of Railways/);
  assert.match(msg, /Supply and Installation of Enterprise Servers/);
  assert.match(msg, /Last Date & Time of Filing/);
  assert.match(msg, /3h 30m left/);
  assert.match(msg, /1\/2 completed/);
  assert.match(msg, /OEM quotes awaited/);

  const url = buildWhatsAppWebUrl('9717690890', msg);
  assert.ok(url.startsWith('https://wa.me/919717690890?text='));
});

test('computePendingWhatsAppAlerts fires 1st message on 48h alert entry and 2nd message at <=4h remaining without duplicates', () => {
  const tender = makeTender({ submissionDueDate: '2026-11-15T15:00' });
  const sent = new Set<string>();

  // 30 hours before due date -> 1st message (alert_48h)
  const at30h = new Date('2026-11-14T09:00:00');
  const firstRun = computePendingWhatsAppAlerts([tender], sent, at30h);
  assert.equal(firstRun.length, 1);
  assert.equal(firstRun[0].milestone, 'alert_48h');
  sent.add(firstRun[0].milestoneKey);

  // Still 20 hours left -> no duplicate alert_48h
  const at20h = new Date('2026-11-14T19:00:00');
  assert.equal(computePendingWhatsAppAlerts([tender], sent, at20h).length, 0);

  // 3.5 hours left -> 2nd message (urgent_4h) triggers automatically
  const at3h30m = new Date('2026-11-15T11:30:00');
  const secondRun = computePendingWhatsAppAlerts([tender], sent, at3h30m);
  assert.equal(secondRun.length, 1);
  assert.equal(secondRun[0].milestone, 'urgent_4h');
  sent.add(secondRun[0].milestoneKey);

  // Still 1 hour left -> no 3rd message
  const at1h = new Date('2026-11-15T14:00:00');
  assert.equal(computePendingWhatsAppAlerts([tender], sent, at1h).length, 0);

  // Submitted or non-alertable stages never trigger
  const submitted = makeTender({ id: 't2', stage: 'Submitted', submissionDueDate: '2026-11-15T13:00' });
  assert.equal(computePendingWhatsAppAlerts([submitted], sent, at1h).length, 0);

  // Milestone key stays valid Firestore ID format
  const key = buildWhatsAppMilestoneKey(tender, 'urgent_4h');
  assert.match(key, /^[a-zA-Z0-9_\-]+$/);
});
