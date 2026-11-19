import assert from 'node:assert/strict';
import test from 'node:test';
import type { AttachmentItem, Tender } from '../types/crm';
import {
  buildTenderFromBidDraft,
  DEFAULT_TENDER_ATTACHMENT_1_LABEL,
  detectMsmeEmdExemption,
  findDuplicateTender,
  normalizeEmdSecurity,
  normalizeExtractedBidDraft,
  normalizeToIsoDate,
  normalizeToIsoDateTime,
  sanitizeDistrictStateLocation,
} from './bidSearchParser';

test('normalizeToIsoDate converts GeM DD-MM-YYYY and DD MMM YYYY formats to YYYY-MM-DD', () => {
  assert.equal(normalizeToIsoDate('02-11-2026'), '2026-11-02');
  assert.equal(normalizeToIsoDate('02/11/2026'), '2026-11-02');
  assert.equal(normalizeToIsoDate('02 Nov 2026'), '2026-11-02');
  assert.equal(normalizeToIsoDate('2026-11-02T14:30:00Z'), '2026-11-02');
  assert.equal(normalizeToIsoDate(''), '');
});

test('normalizeToIsoDateTime converts GeM Bid End Date/Time formats to YYYY-MM-DDTHH:mm', () => {
  assert.equal(normalizeToIsoDateTime('24-11-2026 15:00:00'), '2026-11-24T15:00');
  assert.equal(normalizeToIsoDateTime('24/11/2026 03:30 PM'), '2026-11-24T15:30');
  assert.equal(normalizeToIsoDateTime('2026-11-24T18:45'), '2026-11-24T18:45');
  assert.equal(normalizeToIsoDateTime('', '2026-11-20'), '2026-11-20T17:00');
});

test('sanitizeDistrictStateLocation cleans Google Search and address outputs into District, State', () => {
  assert.equal(sanitizeDistrictStateLocation('**Panchkula, Haryana** [1]'), 'Panchkula, Haryana');
  assert.equal(
    sanitizeDistrictStateLocation('Chandimandir Cantt, Panchkula District, Haryana - 134107, India'),
    'Panchkula, Haryana',
  );
  assert.equal(sanitizeDistrictStateLocation('"Lucknow, Uttar Pradesh"\nExtra notes'), 'Lucknow, Uttar Pradesh');
  assert.equal(sanitizeDistrictStateLocation(''), '');
});

test('normalizeEmdSecurity maps Required/Exempted/Not Required into Firestore-valid EmdSecurityType', () => {
  assert.equal(normalizeEmdSecurity('Required', 150000), 'EMD Paid');
  assert.equal(normalizeEmdSecurity('Bank Guarantee Required', 250000), 'BG Submitted');
  assert.equal(normalizeEmdSecurity('Exempted - MSME/Startup', 0), 'Exempted - MSME/Startup');
  assert.equal(normalizeEmdSecurity('Not Required', 0), 'No EMD');
});

test('detectMsmeEmdExemption identifies MSME, Udyam, Startup, and MSE exemption cues without false positives', () => {
  assert.equal(detectMsmeEmdExemption('Supply of LED Displays (MSME Exemption: Yes)'), true);
  assert.equal(detectMsmeEmdExemption('Valid Udyam Registration Certificate required'), true);
  assert.equal(detectMsmeEmdExemption('DPIIT Startup Exemption applicable for EMD'), true);
  assert.equal(detectMsmeEmdExemption('MSE Bidder EMD Exemption: Yes'), true);
  assert.equal(detectMsmeEmdExemption('MSE Supply', { includeBareMse: true }), true);
  assert.equal(detectMsmeEmdExemption('Supply of Workstation and Monitor'), false);
  assert.equal(detectMsmeEmdExemption(''), false);
});

test('normalizeExtractedBidDraft overrides numeric emdAmount to 0 and Exempted when msmeExempt is detected', () => {
  const byFlag = normalizeExtractedBidDraft({
    tenderId: 'GEM/2026/B/900111',
    title: 'Supply of Servers',
    emdRequired: 'Required',
    emdAmount: 120000,
    msmeExempt: true,
  });
  assert.equal(byFlag.emdStatus, 'Exempted - MSME/Startup');
  assert.equal(byFlag.emdAmount, 0);

  const byText = normalizeExtractedBidDraft({
    tenderId: 'GEM/2026/B/900222',
    title: 'Supply of UPS with MSME EMD Exemption',
    emdRequired: 'Required',
    emdAmount: 85000,
    msmeExempt: false,
  });
  assert.equal(byText.emdStatus, 'Exempted - MSME/Startup');
  assert.equal(byText.emdAmount, 0);
});

test('normalizeExtractedBidDraft maps all 16 schema fields cleanly with safe defaults', () => {
  const draft = normalizeExtractedBidDraft({
    tenderId: 'GEM/2026/B/8153995',
    portal: 'GeM',
    stage: 'Submitted', // should default to Identified / Reviewing
    department: 'Ministry Of Defence / Department Of Military Affairs (Indian Army)',
    location: 'Command HQ, Panchkula, Haryana - 134107',
    title: 'Supply of Ruggedized Networking Switches',
    category: 'Layer-3 Managed Switch',
    publishDate: '02-11-2026',
    submissionDueDate: '25-11-2026 16:00:00',
    preBidDate: '12-11-2026 11:00:00',
    completionDate: '2026-12-01',
    estimatedValue: '₹ 45,00,000',
    quotedValue: '4200000',
    emdRequired: 'Required',
    emdAmount: '1,50,000',
    resultInfo: 'Should stay blank',
  });

  assert.equal(draft.tenderId, 'GEM/2026/B/8153995');
  assert.equal(draft.portal, 'GeM');
  assert.equal(draft.stage, 'Identified / Reviewing');
  assert.equal(draft.department, 'Ministry Of Defence / Department Of Military Affairs (Indian Army)');
  assert.equal(draft.location, 'Panchkula, Haryana');
  assert.equal(draft.title, 'Supply of Ruggedized Networking Switches');
  assert.equal(draft.category, 'Layer-3 Managed Switch');
  assert.equal(draft.publishDate, '2026-11-02');
  assert.equal(draft.submissionDueDate, '2026-11-25T16:00');
  assert.equal(draft.preBidDate, '2026-11-12');
  assert.equal(draft.completionDate, '');
  assert.equal(draft.estimatedValue, 4500000);
  assert.equal(draft.quotedValue, 0);
  assert.equal(draft.emdStatus, 'EMD Paid');
  assert.equal(draft.emdAmount, 150000);
  assert.equal(draft.resultInfo, '');
});

test('findDuplicateTender performs case-insensitive Tender ID match', () => {
  const existing = [
    { id: 'tnd-1', tenderId: 'GEM/2026/B/8153995' } as Tender,
  ];
  assert.equal(findDuplicateTender(existing, 'gem/2026/b/8153995')?.id, 'tnd-1');
  assert.equal(findDuplicateTender(existing, '  GEM/2026/B/8153995  ')?.id, 'tnd-1');
  assert.equal(findDuplicateTender(existing, 'GEM/2026/B/9999999'), undefined);
});

test('buildTenderFromBidDraft attaches PDF into Attachment 1 only and leaves Slots 2 & 3 empty', () => {
  const draft = normalizeExtractedBidDraft({
    tenderId: 'GEM/2026/B/8153995',
    department: 'Indian Army',
    location: 'Panchkula, Haryana',
    title: 'IT Networking Supply',
    category: 'Switches',
    publishDate: '2026-11-02',
    submissionDueDate: '2026-11-25T16:00',
    emdRequired: 'Not Required',
    emdAmount: 0,
  });

  const att: AttachmentItem = {
    id: 'att-gem-1',
    slotLabel: 'Ignored label',
    fileName: 'GeM-Bidding-8153995.pdf',
    fileType: 'application/pdf',
    fileSize: 124500,
    uploadedAt: '2026-11-16',
    dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK',
  };

  const tender = buildTenderFromBidDraft(draft, att);
  assert.equal(tender.tenderId, 'GEM/2026/B/8153995');
  assert.equal(tender.attachments?.length, 1);
  assert.equal(tender.attachments?.[0]?.slotLabel, DEFAULT_TENDER_ATTACHMENT_1_LABEL);
  assert.equal(tender.attachments?.[0]?.fileName, 'GeM-Bidding-8153995.pdf');
  assert.equal(tender.emdAmount, 0);
  assert.equal(tender.emdStatus, 'No EMD');
});
