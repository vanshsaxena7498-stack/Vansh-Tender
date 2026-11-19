import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmdBgRecord, FirmProfile, MafTrackerRecord, Tender } from '../types/crm';
import {
  buildCloudAttachmentFilePayload,
  buildCloudEmdPayload,
  buildCloudMafTrackerPayload,
  buildCloudPreferencesPayload,
  buildCloudProfilePayload,
  buildCloudTenderPayload,
  CLOUD_LIMITS,
  mergeCloudEmdWithFiles,
  mergeCloudMafTrackersWithFiles,
  mergeCloudProfileWithLocal,
  mergeCloudTendersWithFiles,
  sanitizeDocId,
} from './cloudSyncHelpers';

const TOKEN = { __serverTimestamp: true };

test('sanitizeDocId normalizes unsafe characters and enforces length bounds', () => {
  assert.equal(sanitizeDocId('t-123/abc.xyz$'), 't-123_abc_xyz_');
  assert.equal(sanitizeDocId('x'.repeat(300)).length, CLOUD_LIMITS.ID_MAX);
  assert.match(sanitizeDocId(''), /^doc_\d+$/);
});

test('buildCloudProfilePayload enforces blueprint keys and strips oversized photo', () => {
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

test('buildCloudPreferencesPayload validates 4-digit PIN and darkMode boolean', () => {
  const valid = buildCloudPreferencesPayload({ adminPin: '4321', darkMode: true }, 'uid-1', TOKEN);
  assert.equal(valid.adminPin, '4321');
  assert.equal(valid.darkMode, true);

  const fallback = buildCloudPreferencesPayload({ adminPin: 'abc', darkMode: false }, 'uid-1', TOKEN);
  assert.equal(fallback.adminPin, '1234');
  assert.equal(fallback.darkMode, false);
});

test('buildCloudTenderPayload strips inline dataUrl while buildCloudAttachmentFilePayload stores payload separately', () => {
  const validDataUrl = 'data:application/pdf;base64,' + 'B'.repeat(120000);
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
    stage: 'Tender Not Filled',
    resultInfo: '',
    checklist: [{ id: 'c1', label: 'GST', checked: true }],
    remarks: [{ id: 'r1', timestamp: '2026-04-02T10:00:00Z', text: 'Reviewed' }],
    attachments: [
      {
        id: 'att-1',
        slotLabel: 'NIT / Bid Document',
        fileName: 'nit.pdf',
        fileType: 'application/pdf',
        fileSize: 90000,
        uploadedAt: '2026-04-02T10:00:00Z',
        dataUrl: validDataUrl,
      },
    ],
    createdAt: '2026-04-01T09:00:00Z',
    updatedAt: '2026-04-02T10:00:00Z',
  };

  const payload = buildCloudTenderPayload(tender, 'uid-1', TOKEN);
  const cloudAtts = payload.attachments as Tender['attachments'];
  assert.equal(cloudAtts?.[0]?.dataUrl, '');
  assert.equal(cloudAtts?.[0]?.fileName, 'nit.pdf');
  assert.equal(payload.stage, 'Tender Not Filled');

  const attFilePayload = buildCloudAttachmentFilePayload(tender.attachments![0], 'uid-1', TOKEN);
  assert.ok(attFilePayload !== null);
  assert.equal(attFilePayload?.dataUrl, validDataUrl);

  const fileMap = new Map<string, string>([['att-1', validDataUrl]]);
  const merged = mergeCloudTendersWithFiles([{ ...tender, attachments: cloudAtts }], fileMap, []);
  assert.equal(merged[0]?.attachments?.[0]?.dataUrl, validDataUrl);
});

test('buildCloudEmdPayload and mergeCloudEmdWithFiles rehydrate attachment files from Firestore map', () => {
  const dataUrl = 'data:image/jpeg;base64,' + 'C'.repeat(60000);
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
        fileName: 'bg.jpg',
        fileType: 'image/jpeg',
        fileSize: 45000,
        uploadedAt: '2026-04-01T12:00:00Z',
        dataUrl,
      },
    ],
  };

  const payload = buildCloudEmdPayload(emd, 'uid-1', TOKEN);
  const cloudAtts = payload.attachments as EmdBgRecord['attachments'];
  assert.equal(cloudAtts?.[0]?.dataUrl, '');

  const fileMap = new Map<string, string>([['att-e1', dataUrl]]);
  const merged = mergeCloudEmdWithFiles([{ ...emd, attachments: cloudAtts }], fileMap, []);
  assert.equal(merged[0]?.attachments?.[0]?.dataUrl, dataUrl);

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
      adminPhotoUrl: 'data:image/jpeg;base64,PHOTO',
    },
  );
  assert.equal(mergedProfile.firmName, 'Saxena Corp');
  assert.equal(mergedProfile.adminPhotoUrl, 'data:image/jpeg;base64,PHOTO');
});

test('buildCloudMafTrackerPayload bounds itemsMAF <= 50, strips dataUrl, and preserves external URLs', () => {
  const dataUri = 'data:application/pdf;base64,' + 'D'.repeat(20000);
  const tracker: MafTrackerRecord = {
    id: 'maf-tnd-2',
    tenderRefId: 'tnd-2',
    tenderId: 'CPPP/2026/NHAI/88341',
    tenderTitle: 'ANPR Camera Tender',
    department: 'NHAI',
    tenderDueDate: '2026-11-15T14:00',
    itemsMAF: [
      {
        itemId: 'item-1',
        itemName: 'Dome Cameras',
        requiredQuantity: '100 Nos',
        oemName: 'CP Plus',
        concernedPersonName: 'Ravi Singh',
        contactNo: '+91 98112 44019',
        mailId: 'ravi.singh@cpplusworld.com',
        mafStatus: 'Received / Approved',
        mafRequestedDate: '2026-11-02',
        mafDocumentUrl: dataUri,
        mafDocumentName: 'maf_signed.pdf',
        mafAttachmentId: 'maf-att-1',
        remarks: 'Signed copy uploaded',
      },
      {
        itemId: 'item-2',
        itemName: 'PTZ Cameras',
        requiredQuantity: '20 Nos',
        oemName: 'Hikvision',
        concernedPersonName: 'Amit Kumar',
        contactNo: '+91 98730 11842',
        mailId: 'amit.kumar@hikvision.in',
        mafStatus: 'Under Approval',
        mafRequestedDate: '2026-11-04',
        mafDocumentUrl: 'https://drive.google.com/file/d/abc/view',
        mafDocumentName: 'Cloud link',
        remarks: 'Cloud drive draft',
      },
      {
        itemId: 'item-3',
        itemName: 'Thermal Imaging Sight',
        requiredQuantity: '5 Nos',
        oemName: '',
        companyName: '',
        concernedPersonName: '',
        contactNo: '',
        mailId: '',
        mafStatus: 'Pending',
        mafRequestedDate: '',
        mafDocumentUrl: '',
        mafDocumentName: '',
        remarks: '',
      },
    ],
    createdAt: '2026-11-10T10:00:00Z',
    updatedAt: '2026-11-13T10:00:00Z',
  };

  const payload = buildCloudMafTrackerPayload(tracker, 'uid-1', TOKEN);
  const cloudItems = payload.itemsMAF as MafTrackerRecord['itemsMAF'];
  assert.equal(cloudItems.length, 3);
  assert.equal(cloudItems[0].mafDocumentUrl, '');
  assert.equal(cloudItems[0].mafAttachmentId, 'maf-att-1');
  assert.equal(cloudItems[0].concernedPersonName, 'Ravi Singh');
  assert.equal(cloudItems[0].contactNo, '+91 98112 44019');
  assert.equal(cloudItems[0].mailId, 'ravi.singh@cpplusworld.com');
  assert.equal(cloudItems[0].mafRequestedDate, '2026-11-02');
  assert.equal(cloudItems[1].mafDocumentUrl, 'https://drive.google.com/file/d/abc/view');
  assert.equal(cloudItems[2].oemName, '');
  assert.equal(cloudItems[2].companyName, '');
  assert.equal(cloudItems[2].mafStatus, 'Pending');

  const fileMap = new Map<string, string>([['maf-att-1', dataUri]]);
  const merged = mergeCloudMafTrackersWithFiles([{ ...tracker, itemsMAF: cloudItems }], fileMap, []);
  assert.equal(merged[0].itemsMAF[0].mafDocumentUrl, dataUri);
  assert.equal(merged[0].itemsMAF[1].mafDocumentUrl, 'https://drive.google.com/file/d/abc/view');
});

test('buildCloudEmailConfigPayload and buildCloudEmailAlertLogPayload validate blueprint fields', async () => {
  const { buildCloudEmailConfigPayload, buildCloudEmailAlertLogPayload } = await import(
    './cloudSyncHelpers'
  );
  const cfgPayload = buildCloudEmailConfigPayload(
    { enabled: true, recipientName: 'Vansh', recipientEmail: 'vanshsaxena7498@gmail.com' },
    'uid-1',
    TOKEN,
  );
  assert.equal(cfgPayload.ownerUid, 'uid-1');
  assert.equal(cfgPayload.enabled, true);
  assert.equal(cfgPayload.recipientName, 'Vansh');
  assert.equal(cfgPayload.recipientEmail, 'vanshsaxena7498@gmail.com');

  const logPayload = buildCloudEmailAlertLogPayload(
    {
      id: 'email_tnd1_2026-11-14_slot_11am',
      slotKey: 'email_tnd1_2026-11-14_slot_11am',
      tenderRefId: 'tnd-1',
      tenderId: 'GEM/2026/B/123',
      slot: 'slot_11am',
      recipientName: 'Vansh',
      recipientEmail: 'vanshsaxena7498@gmail.com',
      dueDateIso: '2026-11-15T14:00',
      status: 'sent',
      provider: 'smtp',
      subject: 'NEW TENDER ALERT NOTIFICATION (DUE WITHIN 5 DAYS)',
      message: 'Tender ID: GEM/2026/B/123',
      createdAt: '2026-11-14T05:30:00.000Z',
    },
    'uid-1',
    TOKEN,
  );
  assert.equal(logPayload.ownerUid, 'uid-1');
  assert.equal(logPayload.slot, 'slot_11am');
  assert.equal(logPayload.recipientEmail, 'vanshsaxena7498@gmail.com');
});

test('buildCloudSheetConfigPayload enforces blueprint keys and HTTPS webhook URL constraint', async () => {
  const { buildCloudSheetConfigPayload } = await import('./cloudSyncHelpers');
  const valid = buildCloudSheetConfigPayload(
    {
      enabled: true,
      webhookUrl: 'https://script.google.com/macros/s/AKfycbTest123/exec',
      sheetName: 'MIS Monthly Report',
      lastSyncedAt: '2026-11-16T08:30:00.000Z',
    },
    'uid-1',
    TOKEN,
  );
  assert.equal(valid.ownerUid, 'uid-1');
  assert.equal(valid.enabled, true);
  assert.equal(valid.webhookUrl, 'https://script.google.com/macros/s/AKfycbTest123/exec');
  assert.equal(valid.sheetName, 'MIS Monthly Report');
  assert.equal(valid.lastSyncedAt, '2026-11-16T08:30:00.000Z');

  const strippedHttp = buildCloudSheetConfigPayload(
    {
      enabled: false,
      webhookUrl: 'http://insecure.example.com/hook',
      sheetName: '',
    },
    'uid-1',
    TOKEN,
  );
  assert.equal(strippedHttp.webhookUrl, '');
  assert.equal(strippedHttp.sheetName, 'MIS Monthly Report');
});

test('buildWorkspaceRootPayload and buildSecondaryUserCloudPayload enforce bounds, lowercase emails, and secondary role', async () => {
  const { buildWorkspaceRootPayload, buildSecondaryUserCloudPayload } = await import(
    './cloudSyncHelpers'
  );

  const rootPayload = buildWorkspaceRootPayload(
    {
      ownerUid: 'uid-admin-1',
      tenantId: 'sec_rohan/1',
      username: 'RohanDesk',
      email: 'Rohan.Desk@GMAIL.COM',
    },
    TOKEN,
  );
  assert.equal(rootPayload.ownerUid, 'uid-admin-1');
  assert.equal(rootPayload.tenantId, 'sec_rohan_1');
  assert.equal(rootPayload.username, 'RohanDesk');
  assert.equal(rootPayload.email, 'rohan.desk@gmail.com');
  assert.equal(rootPayload.createdAt, TOKEN);
  assert.equal(rootPayload.updatedAt, TOKEN);

  const secUserPayload = buildSecondaryUserCloudPayload(
    {
      ownerUid: 'uid-admin-1',
      userId: 'sec_rohan_1',
      username: '  RohanDesk  ',
      email: '  Rohan.Desk@GMAIL.COM ',
      isActive: true,
      createdAtIso: '2026-11-18T10:00:00.000Z',
    },
    TOKEN,
  );
  assert.equal(secUserPayload.ownerUid, 'uid-admin-1');
  assert.equal(secUserPayload.userId, 'sec_rohan_1');
  assert.equal(secUserPayload.username, 'RohanDesk');
  assert.equal(secUserPayload.email, 'rohan.desk@gmail.com');
  assert.equal(secUserPayload.role, 'secondary');
  assert.equal(secUserPayload.isActive, true);
  assert.equal(secUserPayload.clientCreatedAt, '2026-11-18T10:00:00.000Z');
  assert.equal(secUserPayload.clientLastLoginAt, '');
});



