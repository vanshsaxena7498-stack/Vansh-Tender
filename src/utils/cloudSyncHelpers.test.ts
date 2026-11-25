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
      isEnabled: true,
      presenceStatus: 'active',
      lastHeartbeatAt: '2026-11-20T05:30:00.000Z',
      lastLogoutAt: '',
      byocProjectId: 'rohan-byoc-cloud',
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
  assert.equal(secUserPayload.isEnabled, true);
  assert.equal(secUserPayload.presenceStatus, 'active');
  assert.equal(secUserPayload.lastHeartbeatAt, '2026-11-20T05:30:00.000Z');
  assert.equal(secUserPayload.lastLogoutAt, '');
  assert.equal(secUserPayload.byocProjectId, 'rohan-byoc-cloud');
  assert.equal(secUserPayload.clientCreatedAt, '2026-11-18T10:00:00.000Z');
  assert.equal(secUserPayload.clientLastLoginAt, '');
  assert.equal(Object.keys(secUserPayload).length, 15);
});

test('buildCloudTenderPayload includes all 40 blueprint keys with expanded MIS & BID/RA fields', () => {
  const tender: Tender = {
    id: 'mis-tnd-1',
    tenderId: 'GEM/2026/B/7788',
    portal: 'GeM',
    clientName: 'Indian Army Signals',
    department: 'Ministry of Defence',
    locationDepartment: 'Signals / Panchkula',
    location: 'Panchkula, Haryana',
    category: 'UPS',
    title: 'Supply of 10 KVA UPS',
    publishDate: '2026-11-01',
    submissionDueDate: '2026-11-15T15:00',
    preBidDate: '2026-11-05T11:00',
    technicalOpeningDate: '2026-11-18',
    financialOpeningDate: '2026-11-25',
    estimatedValue: 1200000,
    quotedValue: 1120000,
    l1BidderName: 'Saxena Corp',
    l1QuotedValue: 1120000,
    ourPositionRank: 'L1',
    assignedOwner: 'Vansh',
    emdStatus: 'EMD Paid',
    emdAmount: 30000,
    stage: 'L1 / Won',
    resultInfo: 'Awarded',
    completionDate: '2026-11-25',
    technicalStatus: 'Technically Qualified',
    technicalOpeningDateTime: '2026-11-18T11:30',
    technicalRemarks: 'Compliant OEM MAF & specs',
    financialRaStatus: 'L1 / Awarded',
    financialOpeningRaDateTime: '2026-11-25T15:00',
    raFinalValue: 1095000,
    raFinancialRemarks: 'Finalized via RA round 2',
    checklist: [],
    remarks: [],
    attachments: [],
    createdAt: '2026-11-01T08:00:00Z',
    updatedAt: '2026-11-25T10:00:00Z',
  };

  const payload = buildCloudTenderPayload(tender, 'uid-admin-1', TOKEN);
  assert.equal(Object.keys(payload).length, 40);
  assert.equal(payload.clientName, 'Indian Army Signals');
  assert.equal(payload.locationDepartment, 'Signals / Panchkula');
  assert.equal(payload.technicalOpeningDate, '2026-11-18');
  assert.equal(payload.financialOpeningDate, '2026-11-25');
  assert.equal(payload.l1BidderName, 'Saxena Corp');
  assert.equal(payload.l1QuotedValue, 1120000);
  assert.equal(payload.ourPositionRank, 'L1');
  assert.equal(payload.assignedOwner, 'Vansh');
  assert.equal(payload.technicalStatus, 'Technically Qualified');
  assert.equal(payload.technicalOpeningDateTime, '2026-11-18T11:30');
  assert.equal(payload.technicalRemarks, 'Compliant OEM MAF & specs');
  assert.equal(payload.financialRaStatus, 'L1 / Awarded');
  assert.equal(payload.financialOpeningRaDateTime, '2026-11-25T15:00');
  assert.equal(payload.raFinalValue, 1095000);
  assert.equal(payload.raFinancialRemarks, 'Finalized via RA round 2');
});

test('buildSecondaryUserCloudPayload preserves isEnabled=true when secondary user is offline', async () => {
  const { buildSecondaryUserCloudPayload } = await import('./cloudSyncHelpers');
  const offlineEnabled = buildSecondaryUserCloudPayload(
    {
      ownerUid: 'uid-niyan',
      userId: 'sec_niyan',
      username: 'Niyan',
      email: 'info.niyantrana@gmail.com',
      isActive: false,
      isEnabled: true,
      presenceStatus: 'not_active',
    },
    TOKEN,
  );
  assert.equal(offlineEnabled.isEnabled, true);
  assert.equal(offlineEnabled.isActive, false);
  assert.equal(offlineEnabled.presenceStatus, 'not_active');
});

test('Admin multi-source helpers normalize timestamps, exclude secondary workspaces, and merge without duplicates', async () => {
  const {
    normalizeAdminFirestoreTimestamp,
    isLegacyDocExcludedFromAdmin,
    mergeAdminRecordsById,
    mergeAdminAttachmentMaps,
  } = await import('./cloudSyncHelpers');

  assert.equal(
    normalizeAdminFirestoreTimestamp({ seconds: 1700000000 }),
    new Date(1700000000 * 1000).toISOString(),
  );
  assert.equal(
    normalizeAdminFirestoreTimestamp({ toDate: () => new Date('2026-11-10T00:00:00.000Z') }),
    '2026-11-10T00:00:00.000Z',
  );
  assert.equal(normalizeAdminFirestoreTimestamp('2026-11-10'), '2026-11-10');

  const knownAdminUids = new Set(['4uQty7KjogbYUmjY1ZxnJMtn7rj1', 'JdizphoE56bNDu7OPtS4WZxrb0H2']);
  const excludedSecondaryUids = new Set(['sec_uid_niyan']);

  assert.equal(
    isLegacyDocExcludedFromAdmin({ ownerUid: '4uQty7KjogbYUmjY1ZxnJMtn7rj1' }, knownAdminUids, excludedSecondaryUids),
    false,
  );
  assert.equal(
    isLegacyDocExcludedFromAdmin({}, knownAdminUids, excludedSecondaryUids),
    false,
  );
  assert.equal(
    isLegacyDocExcludedFromAdmin({ ownerUid: 'sec_uid_niyan' }, knownAdminUids, excludedSecondaryUids),
    true,
  );
  assert.equal(
    isLegacyDocExcludedFromAdmin({ tenantId: 'sec_niyan' }, knownAdminUids, excludedSecondaryUids),
    true,
  );
  assert.equal(
    isLegacyDocExcludedFromAdmin({ ownerEmail: 'info.niyantrana@gmail.com' }, knownAdminUids, excludedSecondaryUids),
    true,
  );

  const merged = mergeAdminRecordsById(
    [{ id: 't-1', title: 'Primary Title' }],
    [
      { id: 't-1', title: 'Legacy Stale Title' },
      { id: 't-2', title: 'Legacy Recovered Tender' },
    ],
  );
  assert.deepEqual(merged, [
    { id: 't-1', title: 'Primary Title' },
    { id: 't-2', title: 'Legacy Recovered Tender' },
  ]);

  const mergedFiles = mergeAdminAttachmentMaps(
    new Map([['att-1', 'primary-data']]),
    new Map([
      ['att-1', 'legacy-data'],
      ['att-2', 'legacy-recovered'],
    ]),
  );
  assert.equal(mergedFiles.get('att-1'), 'primary-data');
  assert.equal(mergedFiles.get('att-2'), 'legacy-recovered');
});

test('buildCloudOemPayload validates all 12 blueprint fields and enforces field bounds', async () => {
  const { buildCloudOemPayload } = await import('./cloudSyncHelpers');
  const payload = buildCloudOemPayload(
    {
      id: 'oem/nvs',
      oemName: '  NVS  ',
      companyName: '  Newtech ',
      concernedPersonName: ' Sandeep Tyagi ',
      email: ' sandeep.tyagi@nvsledwall.com ',
      phone: ' +91 8800686947 ',
      remarks: ' Indoor LED Video Wall ',
      createdAt: '2026-11-20T10:00:00Z',
      updatedAt: '2026-11-22T10:00:00Z',
    },
    'uid-admin-1',
    TOKEN,
  );
  assert.equal(Object.keys(payload).length, 12);
  assert.equal(payload.ownerUid, 'uid-admin-1');
  assert.equal(payload.id, 'oem_nvs');
  assert.equal(payload.oemName, 'NVS');
  assert.equal(payload.companyName, 'Newtech');
  assert.equal(payload.concernedPersonName, 'Sandeep Tyagi');
  assert.equal(payload.email, 'sandeep.tyagi@nvsledwall.com');
  assert.equal(payload.phone, '+91 8800686947');
  assert.equal(payload.remarks, 'Indoor LED Video Wall');
  assert.equal(payload.createdAt, TOKEN);
  assert.equal(payload.updatedAt, TOKEN);
});

test('pickValidExistingCreatedAt keeps Firestore Timestamp objects and drops legacy string/number timestamps', async () => {
  const { pickValidExistingCreatedAt, isFirestoreTimestampObject } = await import(
    './cloudSyncHelpers'
  );

  const sdkTimestamp = { toDate: () => new Date('2026-11-01T00:00:00Z'), seconds: 1793491200, nanoseconds: 0 };
  const serializedTimestamp = { seconds: 1793491200, nanoseconds: 0 };

  assert.equal(isFirestoreTimestampObject(sdkTimestamp), true);
  assert.equal(isFirestoreTimestampObject(serializedTimestamp), true);
  assert.equal(pickValidExistingCreatedAt(sdkTimestamp), sdkTimestamp);
  assert.equal(pickValidExistingCreatedAt(serializedTimestamp), serializedTimestamp);

  assert.equal(pickValidExistingCreatedAt('2026-11-01T00:00:00.000Z'), undefined);
  assert.equal(pickValidExistingCreatedAt(1793491200000), undefined);
  assert.equal(pickValidExistingCreatedAt(null), undefined);
  assert.equal(pickValidExistingCreatedAt(undefined), undefined);
});

test('cloud builders normalize legacy enums, guard blank strings, and clamp multibyte UTF-8 text within byte budgets', async () => {
  const {
    buildCloudEmailConfigPayload,
    buildCloudTenderPayload,
    buildCloudEmdPayload,
    utf8ByteLength,
  } = await import('./cloudSyncHelpers');

  // Multibyte Rupee symbol (3 UTF-8 bytes each) repeated 150 times = 450 UTF-8 bytes
  const multibyteTitle = '₹'.repeat(150);
  const tenderPayload = buildCloudTenderPayload(
    {
      id: 'legacy-1',
      tenderId: '   ',
      portal: 'GeM Portal' as Tender['portal'],
      department: '   ',
      location: '≤ 5 km zone',
      category: 'LED',
      title: multibyteTitle,
      publishDate: '2026-11-01',
      submissionDueDate: '   ',
      estimatedValue: -500,
      quotedValue: NaN,
      emdStatus: 'MSME Exempted' as Tender['emdStatus'],
      emdAmount: 0,
      stage: 'Awarded' as Tender['stage'],
      resultInfo: '',
      checklist: [],
      remarks: [],
      createdAt: '',
      updatedAt: '',
    },
    'uid-1',
    TOKEN,
  );

  assert.equal(tenderPayload.portal, 'GeM');
  assert.equal(tenderPayload.department, 'Department');
  assert.equal(tenderPayload.tenderId, 'legacy-1');
  assert.equal(tenderPayload.emdStatus, 'Exempted - MSME/Startup');
  assert.equal(tenderPayload.stage, 'L1 / Won');
  assert.equal(tenderPayload.estimatedValue, 0);
  assert.equal(tenderPayload.quotedValue, 0);
  assert.ok(String(tenderPayload.submissionDueDate).length >= 8);
  assert.ok(utf8ByteLength(String(tenderPayload.title)) <= CLOUD_LIMITS.TITLE_MAX);

  const emdPayload = buildCloudEmdPayload(
    {
      id: 'emd-blank',
      tenderId: '  ',
      department: '  ',
      instrumentType: 'BG Guarantee' as EmdBgRecord['instrumentType'],
      referenceNo: ' ',
      bankName: '  ',
      amount: -10,
      issueDate: '',
      expiryDate: '',
      claimEndDate: '',
      status: 'Released' as EmdBgRecord['status'],
      remarks: '',
    },
    'uid-1',
    TOKEN,
  );
  assert.equal(emdPayload.instrumentType, 'Bank Guarantee (PBG / Bid BG)');
  assert.equal(emdPayload.status, 'Refunded / Released');
  assert.equal(emdPayload.department, 'Department');
  assert.equal(emdPayload.bankName, 'Bank');
  assert.equal(emdPayload.amount, 0);

  const emailCfgPayload = buildCloudEmailConfigPayload(
    { enabled: true, recipientName: '   ', recipientEmail: ' a@b ' },
    'uid-1',
    TOKEN,
  );
  assert.equal(emailCfgPayload.recipientName, 'Alert Recipient');
  assert.equal(emailCfgPayload.recipientEmail, 'alerts@example.com');
});

test('tnd-11-23 tender payload preserves valid Timestamp createdAt and passes all 40 firestore.rules key invariants', () => {
  const serverCreatedTimestamp = { seconds: 1795400000, nanoseconds: 123000000 };
  const tender: Tender = {
    id: 'tnd-11-23',
    tenderId: 'GEM/2026/B/8270880',
    portal: 'GeM',
    clientName: 'Defence Unit',
    department: 'Ministry of Defence',
    locationDepartment: 'Jaipur / Defence',
    location: 'Jaipur',
    category: 'Access Control',
    title: 'Access Control System',
    publishDate: '2026-11-12',
    submissionDueDate: '2026-11-23T14:00',
    preBidDate: '',
    technicalOpeningDate: '',
    financialOpeningDate: '',
    estimatedValue: 500000,
    quotedValue: 480000,
    l1BidderName: '',
    l1QuotedValue: 0,
    ourPositionRank: '',
    assignedOwner: 'Vansh Saxena',
    emdStatus: 'Exempted - MSME/Startup',
    emdAmount: 0,
    stage: 'Identified / Reviewing',
    resultInfo: 'Ongoing',
    completionDate: '',
    checklist: [],
    remarks: [],
    attachments: [],
    createdAt: '2026-11-23T08:00:00.000Z',
    updatedAt: '2026-11-24T10:33:00.000Z',
  };

  const payload = buildCloudTenderPayload(
    tender,
    'JdizphoE56bNDu7OPtS4WZxrb0H2',
    TOKEN,
    serverCreatedTimestamp,
  );
  assert.equal(payload.id, 'tnd-11-23');
  assert.equal(payload.ownerUid, 'JdizphoE56bNDu7OPtS4WZxrb0H2');
  assert.equal(payload.createdAt, serverCreatedTimestamp);
  assert.equal(payload.updatedAt, TOKEN);
  assert.equal(Object.keys(payload).length, 40);
});








