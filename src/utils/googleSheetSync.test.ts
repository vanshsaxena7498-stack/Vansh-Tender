import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmdBgRecord, Tender } from '../types/crm';
import {
  buildSheetSyncPayload,
  computeMonthlySummaryForSheet,
  formatIndianDateForSheet,
  formatIndianDateTimeForSheet,
  GOOGLE_APPS_SCRIPT_CODE_GS,
  isValidAppsScriptWebhookUrl,
} from './googleSheetSync';

function makeTender(overrides: Partial<Tender>): Tender {
  return {
    id: 't1',
    tenderId: 'GEM/2026/B/1001',
    portal: 'GeM',
    department: 'Ministry of Defence',
    location: 'Panchkula, Haryana',
    category: 'IT Hardware',
    title: 'Supply of Rugged Workstations',
    publishDate: '2026-10-01',
    submissionDueDate: '2026-10-20T15:00',
    preBidDate: '2026-10-08',
    estimatedValue: 1000000,
    quotedValue: 950000,
    emdStatus: 'EMD Paid',
    emdAmount: 25000,
    stage: 'Identified / Reviewing',
    resultInfo: '',
    completionDate: '',
    checklist: [],
    remarks: [{ id: 'r1', timestamp: '2026-10-02T10:00:00Z', text: 'Reviewed BOQ' }],
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    ...overrides,
  };
}

function makeEmd(overrides: Partial<EmdBgRecord>): EmdBgRecord {
  return {
    id: 'e1',
    tenderRefId: 't1',
    tenderId: 'GEM/2026/B/1001',
    department: 'Ministry of Defence',
    instrumentType: 'Bank Guarantee (PBG / Bid BG)',
    referenceNo: 'BG-9901',
    bankName: 'SBI Bank',
    amount: 50000,
    issueDate: '2026-10-01',
    expiryDate: '2027-04-01',
    claimEndDate: '2027-06-01',
    status: 'Active / Locked',
    remarks: 'Issued',
    ...overrides,
  };
}

test('formatIndianDateForSheet and formatIndianDateTimeForSheet output DD/MM/YYYY and IST DD/MM/YYYY HH:MM', () => {
  assert.equal(formatIndianDateForSheet('2026-11-16'), '16/11/2026');
  assert.equal(formatIndianDateTimeForSheet('2026-11-16T17:05'), '16/11/2026 17:05');
  // UTC Z timestamp converts +05:30 to IST cleanly
  assert.equal(formatIndianDateTimeForSheet('2026-11-16T09:40:31.691Z'), '16/11/2026 15:10');
  assert.equal(formatIndianDateForSheet('2026-11-16T20:00:00.000Z'), '17/11/2026');
  assert.equal(formatIndianDateForSheet(''), '');
  assert.equal(formatIndianDateTimeForSheet(''), '');
});

test('isValidAppsScriptWebhookUrl validates HTTPS Google Apps Script URLs only', () => {
  assert.equal(
    isValidAppsScriptWebhookUrl(
      'https://script.google.com/macros/s/AKfycbDemoWebhookTest123/exec',
    ),
    true,
  );
  assert.equal(
    isValidAppsScriptWebhookUrl('https://script.googleusercontent.com/macros/echo?user_content_key=1'),
    true,
  );
  assert.equal(
    isValidAppsScriptWebhookUrl('http://script.google.com/macros/s/AKfycb123/exec'),
    false,
  );
  assert.equal(
    isValidAppsScriptWebhookUrl('https://evil.example.com/macros/s/abc/exec'),
    false,
  );
  assert.equal(isValidAppsScriptWebhookUrl('http://localhost:3000/api/auth/login'), false);
  assert.equal(isValidAppsScriptWebhookUrl(''), false);
});

test('computeMonthlySummaryForSheet computes executive summary buckets and EMD totals accurately', () => {
  const tenders: Tender[] = [
    makeTender({ id: 't1', stage: 'Identified / Reviewing', estimatedValue: 500000, quotedValue: 0, submissionDueDate: '2026-10-15T14:00' }),
    makeTender({ id: 't2', stage: 'Doc Preparation', estimatedValue: 300000, quotedValue: 0, submissionDueDate: '2026-10-18T14:00' }),
    makeTender({ id: 't3', stage: 'Submitted', estimatedValue: 1200000, quotedValue: 1150000, submissionDueDate: '2026-10-22T14:00' }),
    makeTender({ id: 't4', stage: 'Technical Eval', estimatedValue: 800000, quotedValue: 780000, submissionDueDate: '2026-11-05T14:00' }),
    makeTender({ id: 't5', stage: 'L1 / Won', estimatedValue: 2000000, quotedValue: 1900000, submissionDueDate: '2026-11-10T14:00' }),
    makeTender({ id: 't6', stage: 'Lost (L2/L3)', estimatedValue: 600000, quotedValue: 620000, submissionDueDate: '2026-11-12T14:00' }),
    makeTender({ id: 't7', stage: 'Tender Not Filled', estimatedValue: 400000, quotedValue: 0, submissionDueDate: '2026-11-15T14:00' }),
  ];
  const emds: EmdBgRecord[] = [
    makeEmd({ id: 'e1', amount: 100000, status: 'Active / Locked' }),
    makeEmd({ id: 'e2', amount: 40000, status: 'Refund / Release Applied' }),
    makeEmd({ id: 'e3', amount: 75000, status: 'Refunded / Released' }),
  ];

  const summary = computeMonthlySummaryForSheet(tenders, emds);
  assert.equal(summary.totalTenders, 7);
  assert.equal(summary.inPreparationCount, 2);
  assert.equal(summary.submittedCount, 2);
  assert.equal(summary.awardedCount, 1);
  assert.equal(summary.rejectedLostCount, 2);
  assert.equal(summary.totalEstimatedValue, 5800000);
  assert.equal(summary.totalQuotedValue, 4450000);
  assert.equal(summary.awardedValue, 1900000);
  assert.equal(summary.totalEmdRecords, 3);
  assert.equal(summary.activeEmdLockedAmount, 140000);
  assert.equal(summary.refundAppliedAmount, 40000);
  assert.equal(summary.releasedAmount, 75000);
  assert.equal(summary.monthlyBreakdown.length, 2);
});

test('buildSheetSyncPayload maps all 21 columns cleanly with IST DD/MM/YYYY dates & times', () => {
  const t1 = makeTender({
    id: 'tnd-100',
    tenderId: 'GEM/2026/B/8153995',
    stage: 'L1 / Won',
    publishDate: '2026-10-01',
    submissionDueDate: '2026-11-16T17:00',
    preBidDate: '2026-10-08',
    completionDate: '2026-11-25',
  });
  const e1 = makeEmd({ id: 'emd-100', tenderId: 'GEM/2026/B/8153995', bankName: 'HDFC Bank' });

  const createPayload = buildSheetSyncPayload({
    action: 'CREATE',
    entityType: 'TENDER',
    sheetName: 'MIS Monthly Report',
    firmName: 'Sonal Enterprises Pvt Ltd',
    assignedOwner: 'Vansh Saxena',
    tender: t1,
    emdRecord: e1,
    tenders: [t1],
    emdRecords: [e1],
    triggeredAt: '2026-11-16T09:40:31.691Z',
  });

  assert.equal(createPayload.triggeredAt, '16/11/2026 15:10');
  assert.equal(createPayload.tender?.tenderId, 'GEM/2026/B/8153995');
  assert.equal(createPayload.tender?.clientName, 'Ministry of Defence');
  assert.equal(createPayload.tender?.locationDepartment, 'Panchkula, Haryana / Ministry of Defence');
  assert.equal(createPayload.tender?.publishDate, '01/10/2026');
  assert.equal(createPayload.tender?.submissionDueDate, '16/11/2026 17:00');
  assert.equal(createPayload.tender?.preBidDate, '08/10/2026');
  assert.equal(createPayload.tender?.financialOpeningDate, '25/11/2026');
  assert.equal(createPayload.tender?.l1BidderName, 'Sonal Enterprises Pvt Ltd');
  assert.equal(createPayload.tender?.ourPositionRank, 'L1');
  assert.equal(createPayload.tender?.assignedOwner, 'Vansh Saxena');
  assert.equal(createPayload.tender?.remarksNextAction, 'Reviewed BOQ');
  assert.equal(createPayload.tenders[0]?.serialNo, 1);
  assert.equal(createPayload.emdRecord?.issueDate, '01/10/2026');
  assert.equal(createPayload.emdRecord?.expiryDate, '01/04/2027');
});

test('GOOGLE_APPS_SCRIPT_CODE_GS uses exact 21 headings and removes Last Synced At / Last Event from Monthly MIS Summary', () => {
  const expectedHeaders = [
    'S.No.',
    'Tender Ref / ID',
    'Client / Organization Name',
    'Location / Department',
    'Location',
    'Brief Description & Scope of Work',
    'Portal / Platform',
    'Publish / Tender Date',
    'Due Date & Time',
    'Pre-Bid Meeting Date',
    'Estimated Tender Value (INR)',
    'EMD Amount (INR)',
    'EMD Mode / Form',
    'Current Status',
    'Technical Opening Date',
    'Financial Opening Date',
    'L1 Bidder Name',
    'L1 Quoted Value (INR)',
    'Our Position / Rank',
    'Assigned Person / Owner',
    'Remarks / Next Action',
  ];
  for (const h of expectedHeaders) {
    assert.ok(GOOGLE_APPS_SCRIPT_CODE_GS.includes(`'${h}'`), `Missing header ${h}`);
  }
  assert.ok(!GOOGLE_APPS_SCRIPT_CODE_GS.includes('Last Synced At (UTC)'));
  assert.ok(!GOOGLE_APPS_SCRIPT_CODE_GS.includes('Last Event'));
  assert.ok(GOOGLE_APPS_SCRIPT_CODE_GS.includes("Utilities.formatDate(d, 'Asia/Kolkata', 'dd/MM/yyyy HH:mm')"));
});
