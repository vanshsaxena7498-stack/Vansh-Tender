import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmdBgRecord, FirmProfile, Tender } from '../types/crm';
import {
  buildCloudEmdPayload,
  buildCloudProfilePayload,
  buildCloudTenderPayload,
  CLOUD_LIMITS,
  mergeCloudEmdWithLocal,
  mergeCloudProfileWithLocal,
  mergeCloudTendersWithLocal,
  sanitizeDocId,
} from './cloudSyncHelpers';

const TOKEN = { __serverTimestamp: true };

test('sanitizeDocId normalizes unsafe characters and enforces length bounds', () => {
  assert.equal(sanitizeDocId('t-123/abc.xyz$'), 't-123_abc_xyz_');
  assert.equal(sanitizeDocId('x'.repeat(300)).length, CLOUD_LIMITS.ID_MAX);
  assert.match(sanitizeDocId(''), /^doc_\d+$/);
});

test('buildCloudProfilePayload strips oversized adminPhotoUrl while enforcing blueprint keys', () => {
  const profile: FirmProfile = {
    firmName: 'Saxena Infra & Tech Pvt Ltd',
    gstin: '07AABCU9603R1ZM',
    udyamNumber: 'UDYAM-DL-01-0001234',
    adminName: 'Vansh Saxena',
    adminPhotoUrl: 'data:image/png;base64,' + 'A'.repeat(250000),
  };

  const payload = buildCloudProfilePayload(profile, 'uid-1', TOKEN);
  assert.equal(payload.ownerUid, 'uid-1');
  assert.equal(payload.adminPhotoUrl, '');
  assert.equal(payload.createdAt, TOKEN);
  assert.equal(payload.updatedAt, TOKEN);
  assert.deepEqual(Object.keys(payload).sort(), [
    'adminName',
    'adminPhotoUrl',
    'createdAt',
    'firmName',
    'gstin',
    'ownerUid',
    'udyamNumber',
    'updatedAt',
  ]);
});

test('buildCloudTenderPayload strips oversized attachment dataUrl and preserves local dataUrl on merge', () => {
  const largeDataUrl = 'data:application/pdf;base64,' + 'B'.repeat(180000);
  const tender: Tender = {
    id: 'tender-1',
    tenderId: 'GEM/2026/B/999',
    portal: 'GeM',
    department: 'NIC New Delhi',
    location: 'Delhi',
    category: 'Cloud & IT',
    title: 'Enterprise Server Procurement',
    publishDate: '2026-04-01',
    submissionDueDate: '2026-05-15T15:00',
    estimatedValue: 5000000,
    quotedValue: 4850000,
    emdStatus: 'EMD Paid',
    emdAmount: 100000,
    stage: 'Submitted',
    resultInfo: '',
    checklist: [{ id: 'c1', label: 'GST', checked: true }],
    remarks: [{ id: 'r1', timestamp: '2026-04-02T10:00:00Z', text: 'Uploaded' }],
    attachments: [
      {
        id: 'att-1',
        slotLabel: 'NIT / Bid Document',
        fileName: 'nit.pdf',
        fileType: 'application/pdf',
        fileSize: 180000,
        uploadedAt: '2026-04-02T10:00:00Z',
        dataUrl: largeDataUrl,
      },
    ],
    createdAt: '2026-04-01T09:00:00Z',
    updatedAt: '2026-04-02T10:00:00Z',
  };

  const payload = buildCloudTenderPayload(tender, 'uid-1', TOKEN);
  const cloudAtts = payload.attachments as Tender['attachments'];
  assert.equal(cloudAtts?.[0]?.dataUrl, '');
  assert.equal(cloudAtts?.[0]?.fileName, 'nit.pdf');

  const cloudDocAsTender: Tender = {
    ...tender,
    attachments: cloudAtts,
  };
  const merged = mergeCloudTendersWithLocal([cloudDocAsTender], [tender]);
  assert.equal(merged[0]?.attachments?.[0]?.dataUrl, largeDataUrl);
});

test('buildCloudEmdPayload and mergeCloudEmdWithLocal enforce schema and preserve local files', () => {
  const largeDataUrl = 'data:image/png;base64,' + 'C'.repeat(160000);
  const emd: EmdBgRecord = {
    id: 'emd-1',
    tenderRefId: 'tender-1',
    tenderId: 'GEM/2026/B/999',
    department: 'NIC New Delhi',
    instrumentType: 'Bank Guarantee (PBG / Bid BG)',
    referenceNo: 'BG-1001',
    bankName: 'SBI Corporate Branch',
    amount: 100000,
    issueDate: '2026-04-01',
    expiryDate: '2026-10-01',
    claimEndDate: '2026-12-01',
    status: 'Active / Locked',
    remarks: 'Issued',
    attachments: [
      {
        id: 'att-e1',
        slotLabel: 'BG Copy',
        fileName: 'bg.png',
        fileType: 'image/png',
        fileSize: 160000,
        uploadedAt: '2026-04-01T12:00:00Z',
        dataUrl: largeDataUrl,
      },
    ],
  };

  const payload = buildCloudEmdPayload(emd, 'uid-1', TOKEN);
  const cloudAtts = payload.attachments as EmdBgRecord['attachments'];
  assert.equal(cloudAtts?.[0]?.dataUrl, '');

  const merged = mergeCloudEmdWithLocal([{ ...emd, attachments: cloudAtts }], [emd]);
  assert.equal(merged[0]?.attachments?.[0]?.dataUrl, largeDataUrl);

  const mergedProfile = mergeCloudProfileWithLocal(
    {
      firmName: 'Saxena Corp',
      gstin: '',
      udyamNumber: '',
      adminName: 'Vansh Saxena',
      adminPhotoUrl: '',
    },
    {
      firmName: 'Old Corp',
      gstin: '',
      udyamNumber: '',
      adminName: 'Vansh Saxena',
      adminPhotoUrl: 'data:image/png;base64,LOCALPHOTO',
    },
  );
  assert.equal(mergedProfile.firmName, 'Saxena Corp');
  assert.equal(mergedProfile.adminPhotoUrl, 'data:image/png;base64,LOCALPHOTO');
});
