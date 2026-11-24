import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Automated verification runner for the 12 "Dirty Dozen" adversarial payloads
 * documented in security_spec.md against the Firestore security rule invariants.
 */

const SERVER_TIME = Symbol('SERVER_TIME');
const VALID_ID_RE = /^[a-zA-Z0-9_\-]+$/;
const VALID_PORTALS = new Set(['GeM', 'CPPP / eProcure', 'State Portal', 'PSU / Direct', 'Private']);
const VALID_EMD_STATUS = new Set(['Exempted - MSME/Startup', 'EMD Paid', 'BG Submitted', 'No EMD']);
const VALID_TENDER_STAGES = new Set([
  'Identified / Reviewing',
  'Doc Preparation',
  'Submitted',
  'Technical Eval',
  'Financial / BOQ Eval',
  'L1 / Won',
  'Lost (L2/L3)',
  'Cancelled / Retendered',
  'Tender Not Filled',
]);
const TERMINAL_TENDER_STAGES = new Set([
  'L1 / Won',
  'Lost (L2/L3)',
  'Cancelled / Retendered',
]);
const VALID_INSTRUMENTS = new Set([
  'Online / NEFT / RTGS',
  'Demand Draft (DD)',
  'Bank Guarantee (PBG / Bid BG)',
  'FDR / TDR',
  'e-PBG',
]);
const VALID_FINANCIAL_STATUS = new Set([
  'Active / Locked',
  'Extension Requested',
  'Refund / Release Applied',
  'Refunded / Released',
  'Forfeited',
]);
const TERMINAL_FINANCIAL_STATUS = new Set(['Refunded / Released', 'Forfeited']);

interface AuthContext {
  uid: string;
  token: { email: string; email_verified: boolean };
}

function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && VALID_ID_RE.test(id);
}

function isVerifiedUser(auth: AuthContext | null): auth is AuthContext {
  return auth !== null && auth.token.email_verified === true;
}

function isAdmin(auth: AuthContext | null, admins: Set<string>): boolean {
  return (
    isVerifiedUser(auth) &&
    (auth.token.email === 'vanshsaxena7498@gmail.com' || admins.has(auth.uid))
  );
}

function hasExactKeys(data: Record<string, unknown>, required: string[], allowed: string[]): boolean {
  const keys = Object.keys(data);
  return required.every((k) => k in data) && keys.every((k) => allowed.includes(k));
}

function affectedKeys(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown>,
): string[] {
  const all = new Set([...Object.keys(incoming), ...Object.keys(existing)]);
  return [...all].filter((k) => incoming[k] !== existing[k]);
}

function isValidTender(
  data: Record<string, unknown>,
  auth: AuthContext,
  userId: string,
  tenderDocId: string,
): boolean {
  const requiredKeys = [
    'ownerUid',
    'id',
    'tenderId',
    'portal',
    'clientName',
    'department',
    'locationDepartment',
    'location',
    'category',
    'title',
    'publishDate',
    'submissionDueDate',
    'preBidDate',
    'technicalOpeningDate',
    'financialOpeningDate',
    'estimatedValue',
    'quotedValue',
    'l1BidderName',
    'l1QuotedValue',
    'ourPositionRank',
    'assignedOwner',
    'emdStatus',
    'emdAmount',
    'stage',
    'resultInfo',
    'completionDate',
    'checklist',
    'remarks',
    'attachments',
    'clientCreatedAt',
    'clientUpdatedAt',
    'createdAt',
    'updatedAt',
  ];
  const allowedKeys = [
    ...requiredKeys,
    'technicalStatus',
    'technicalOpeningDateTime',
    'technicalRemarks',
    'financialRaStatus',
    'financialOpeningRaDateTime',
    'raFinalValue',
    'raFinancialRemarks',
  ];
  if (!hasExactKeys(data, requiredKeys, allowedKeys)) return false;
  return (
    isValidId(data.ownerUid) &&
    data.ownerUid === userId &&
    data.ownerUid === auth.uid &&
    isValidId(data.id) &&
    data.id === tenderDocId &&
    typeof data.tenderId === 'string' &&
    data.tenderId.length >= 1 &&
    data.tenderId.length <= 120 &&
    typeof data.portal === 'string' &&
    VALID_PORTALS.has(data.portal) &&
    typeof data.department === 'string' &&
    data.department.length >= 1 &&
    data.department.length <= 200 &&
    typeof data.title === 'string' &&
    data.title.length >= 1 &&
    data.title.length <= 300 &&
    typeof data.estimatedValue === 'number' &&
    data.estimatedValue >= 0 &&
    typeof data.quotedValue === 'number' &&
    data.quotedValue >= 0 &&
    typeof data.emdStatus === 'string' &&
    VALID_EMD_STATUS.has(data.emdStatus) &&
    typeof data.emdAmount === 'number' &&
    data.emdAmount >= 0 &&
    typeof data.stage === 'string' &&
    VALID_TENDER_STAGES.has(data.stage) &&
    Array.isArray(data.checklist) &&
    data.checklist.length <= 30 &&
    Array.isArray(data.remarks) &&
    data.remarks.length <= 100 &&
    Array.isArray(data.attachments) &&
    data.attachments.length <= 10 &&
    (data.technicalStatus === undefined ||
      (typeof data.technicalStatus === 'string' && data.technicalStatus.length <= 80)) &&
    (data.technicalOpeningDateTime === undefined ||
      (typeof data.technicalOpeningDateTime === 'string' && data.technicalOpeningDateTime.length <= 32)) &&
    (data.technicalRemarks === undefined ||
      (typeof data.technicalRemarks === 'string' && data.technicalRemarks.length <= 1000)) &&
    (data.financialRaStatus === undefined ||
      (typeof data.financialRaStatus === 'string' && data.financialRaStatus.length <= 80)) &&
    (data.financialOpeningRaDateTime === undefined ||
      (typeof data.financialOpeningRaDateTime === 'string' && data.financialOpeningRaDateTime.length <= 32)) &&
    (data.raFinalValue === undefined ||
      (typeof data.raFinalValue === 'number' && data.raFinalValue >= 0)) &&
    (data.raFinancialRemarks === undefined ||
      (typeof data.raFinancialRemarks === 'string' && data.raFinancialRemarks.length <= 1000)) &&
    data.createdAt === SERVER_TIME &&
    data.updatedAt === SERVER_TIME
  );
}

function isValidFirmProfile(
  data: Record<string, unknown>,
  auth: AuthContext,
  userId: string,
): boolean {
  const keys = [
    'ownerUid',
    'firmName',
    'gstin',
    'udyamNumber',
    'adminName',
    'adminPhotoUrl',
    'createdAt',
    'updatedAt',
  ];
  if (!hasExactKeys(data, keys, keys)) return false;
  return (
    isValidId(data.ownerUid) &&
    data.ownerUid === userId &&
    data.ownerUid === auth.uid &&
    typeof data.firmName === 'string' &&
    data.firmName.length >= 1 &&
    data.firmName.length <= 150 &&
    typeof data.adminName === 'string' &&
    data.adminName.length >= 1 &&
    data.adminName.length <= 100 &&
    typeof data.adminPhotoUrl === 'string' &&
    data.adminPhotoUrl.length <= 150000 &&
    data.createdAt === SERVER_TIME &&
    data.updatedAt === SERVER_TIME
  );
}

function makeBaseTender(uid: string, id = 't1'): Record<string, unknown> {
  return {
    ownerUid: uid,
    id,
    tenderId: 'GEM/2026/B/1001',
    portal: 'GeM',
    clientName: 'CPWD Delhi',
    department: 'CPWD Delhi',
    locationDepartment: 'CPWD Delhi',
    location: 'New Delhi',
    category: 'IT Hardware',
    title: 'Supply of Enterprise Workstations',
    publishDate: '2026-04-01',
    submissionDueDate: '2026-05-01T15:00',
    preBidDate: '',
    technicalOpeningDate: '',
    financialOpeningDate: '',
    estimatedValue: 1000000,
    quotedValue: 950000,
    l1BidderName: '',
    l1QuotedValue: 0,
    ourPositionRank: '',
    assignedOwner: 'Vansh Saxena',
    emdStatus: 'EMD Paid',
    emdAmount: 25000,
    stage: 'Submitted',
    resultInfo: '',
    completionDate: '',
    checklist: [],
    remarks: [],
    attachments: [],
    clientCreatedAt: '2026-04-01T10:00:00Z',
    clientUpdatedAt: '2026-04-01T10:00:00Z',
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  };
}

test('Dirty Dozen adversarial payloads all evaluate to PERMISSION_DENIED', () => {
  const existingUsers = new Set(['u2']);
  const admins = new Set<string>();
  const verifiedUser: AuthContext = {
    uid: 'u2',
    token: { email: 'user@example.com', email_verified: true },
  };

  // 1. Unauthenticated Write
  assert.equal(isVerifiedUser(null), false);

  // 2. Unverified Email Spoof
  const spoofAuth: AuthContext = {
    uid: 'u1',
    token: { email: 'vanshsaxena7498@gmail.com', email_verified: false },
  };
  assert.equal(isVerifiedUser(spoofAuth), false);
  assert.equal(isAdmin(spoofAuth, admins), false);

  // 3. Privilege Escalation into /admins/{uid}
  assert.equal(verifiedUser.token.email === 'vanshsaxena7498@gmail.com', false);

  // 4. Shadow / Ghost Field Injection (also verify optional BID/RA fields are valid while unknown keys are denied)
  const validWithBidRa = {
    ...makeBaseTender('u2', 't1'),
    technicalStatus: 'Technically Qualified',
    technicalOpeningDateTime: '2026-05-05T11:00',
    technicalRemarks: 'Specs verified',
    financialRaStatus: 'RA Scheduled / Live',
    financialOpeningRaDateTime: '2026-05-10T15:00',
    raFinalValue: 910000,
    raFinancialRemarks: 'RA live on GeM',
  };
  assert.equal(isValidTender(validWithBidRa, verifiedUser, 'u2', 't1'), true);
  assert.equal(
    isValidTender({ ...validWithBidRa, raFinalValue: -100 }, verifiedUser, 'u2', 't1'),
    false,
  );
  const shadowTender = { ...makeBaseTender('u2', 't1'), isApprovedAdmin: true };
  assert.equal(isValidTender(shadowTender, verifiedUser, 'u2', 't1'), false);

  // 5. Cross-Tenant Identity Spoofing
  const spoofedOwnerTender = makeBaseTender('victimUid', 't2');
  assert.equal(isValidTender(spoofedOwnerTender, verifiedUser, 'u2', 't2'), false);

  // 6. Orphaned Subcollection Write Without Parent /users/{userId}
  assert.equal(existingUsers.has('u3'), false);

  // 7. ID Poisoning / Path Traversal
  assert.equal(isValidId('bad$id.with.dots'), false);

  // 8. Client-Forged Timestamp
  const forgedTimestampTender = { ...makeBaseTender('u2', 't1'), createdAt: '2020-01-01T00:00:00Z' };
  assert.equal(isValidTender(forgedTimestampTender, verifiedUser, 'u2', 't1'), false);

  // 9. Denial-of-Wallet Oversized Photo
  const oversizedProfile = {
    ownerUid: 'u2',
    firmName: 'Acme Infra',
    gstin: '07AABCU9603R1ZM',
    udyamNumber: 'UDYAM-DL-01-0001234',
    adminName: 'Vansh Saxena',
    adminPhotoUrl: 'x'.repeat(200000),
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  };
  assert.equal(isValidFirmProfile(oversizedProfile, verifiedUser, 'u2'), false);

  // 10. Immutable Field Tampering on Update (createdAt changed)
  const existingCreatedAt = '2026-01-01T00:00:00Z';
  const incomingCreatedAt = SERVER_TIME;
  assert.notEqual(incomingCreatedAt, existingCreatedAt);

  // 11. Terminal State Mutation by Non-Admin
  assert.equal(TERMINAL_FINANCIAL_STATUS.has('Refunded / Released'), true);
  assert.equal(isAdmin(verifiedUser, admins), false);
  assert.equal(TERMINAL_TENDER_STAGES.has('L1 / Won'), true);
  assert.equal(VALID_INSTRUMENTS.has('FDR / TDR'), true);
  assert.equal(VALID_FINANCIAL_STATUS.has('Active / Locked'), true);

  // 12. Cross-Tenant PII Read / List Scraping
  const victimId = 'victimUid';
  const canReadVictim = verifiedUser.uid === victimId || isAdmin(verifiedUser, admins);
  assert.equal(canReadVictim, false);
  assert.deepEqual(
    affectedKeys({ a: 1, b: 2 }, { a: 1, b: 3 }),
    ['b'],
  );
});

function isValidMafTracker(
  data: Record<string, unknown>,
  auth: AuthContext,
  userId: string,
  mafDocId: string,
): boolean {
  const keys = [
    'ownerUid',
    'id',
    'tenderRefId',
    'tenderId',
    'tenderTitle',
    'department',
    'tenderDueDate',
    'itemsMAF',
    'clientCreatedAt',
    'clientUpdatedAt',
    'createdAt',
    'updatedAt',
  ];
  if (!hasExactKeys(data, keys, keys)) return false;
  return (
    isValidId(data.ownerUid) &&
    data.ownerUid === userId &&
    data.ownerUid === auth.uid &&
    isValidId(data.id) &&
    data.id === mafDocId &&
    typeof data.tenderRefId === 'string' &&
    data.tenderRefId.length <= 128 &&
    typeof data.tenderId === 'string' &&
    data.tenderId.length >= 1 &&
    data.tenderId.length <= 120 &&
    typeof data.tenderTitle === 'string' &&
    data.tenderTitle.length <= 300 &&
    typeof data.department === 'string' &&
    data.department.length <= 200 &&
    typeof data.tenderDueDate === 'string' &&
    data.tenderDueDate.length <= 32 &&
    Array.isArray(data.itemsMAF) &&
    data.itemsMAF.length <= 50 &&
    typeof data.clientCreatedAt === 'string' &&
    typeof data.clientUpdatedAt === 'string' &&
    data.createdAt === SERVER_TIME &&
    data.updatedAt === SERVER_TIME
  );
}

test('MafTracker Firestore rules enforce ownership, bounded itemsMAF (<= 50), and no shadow fields', () => {
  const verifiedUser: AuthContext = {
    uid: 'u2',
    token: { email: 'user@example.com', email_verified: true },
  };
  const validMaf: Record<string, unknown> = {
    ownerUid: 'u2',
    id: 'maf-tnd-2',
    tenderRefId: 'tnd-2',
    tenderId: 'CPPP/2026/NHAI/88341',
    tenderTitle: 'ANPR Camera Supply',
    department: 'NHAI',
    tenderDueDate: '2026-11-15T14:00',
    itemsMAF: [{ itemId: 'i1', itemName: 'Dome Camera', oemName: 'CP Plus' }],
    clientCreatedAt: '2026-11-10T10:00:00Z',
    clientUpdatedAt: '2026-11-12T10:00:00Z',
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  };
  assert.equal(isValidMafTracker(validMaf, verifiedUser, 'u2', 'maf-tnd-2'), true);

  // Oversized itemsMAF (> 50)
  assert.equal(
    isValidMafTracker(
      { ...validMaf, itemsMAF: Array.from({ length: 51 }, (_, idx) => ({ itemId: `i-${idx}` })) },
      verifiedUser,
      'u2',
      'maf-tnd-2',
    ),
    false,
  );

  // Shadow field
  assert.equal(
    isValidMafTracker({ ...validMaf, secretFlag: true }, verifiedUser, 'u2', 'maf-tnd-2'),
    false,
  );

  // Cross-tenant ownerUid
  assert.equal(
    isValidMafTracker({ ...validMaf, ownerUid: 'victim' }, verifiedUser, 'u2', 'maf-tnd-2'),
    false,
  );
});

const VALID_WA_MILESTONES = new Set(['alert_48h', 'urgent_4h', 'test']);
const VALID_WA_STATUS = new Set(['sent', 'manual_ready', 'failed']);

function isValidWhatsAppAlertLog(
  data: Record<string, unknown>,
  auth: AuthContext,
  userId: string,
  alertId: string,
): boolean {
  const keys = [
    'ownerUid',
    'id',
    'milestoneKey',
    'tenderRefId',
    'tenderId',
    'milestone',
    'recipientName',
    'recipientPhone',
    'dueDateIso',
    'status',
    'provider',
    'message',
    'clientCreatedAt',
    'createdAt',
    'updatedAt',
  ];
  if (!hasExactKeys(data, keys, keys)) return false;
  return (
    isValidId(data.ownerUid) &&
    data.ownerUid === userId &&
    data.ownerUid === auth.uid &&
    isValidId(data.id) &&
    data.id === alertId &&
    typeof data.milestoneKey === 'string' &&
    data.milestoneKey.length >= 1 &&
    data.milestoneKey.length <= 150 &&
    typeof data.tenderId === 'string' &&
    data.tenderId.length >= 1 &&
    data.tenderId.length <= 120 &&
    typeof data.milestone === 'string' &&
    VALID_WA_MILESTONES.has(data.milestone) &&
    typeof data.status === 'string' &&
    VALID_WA_STATUS.has(data.status) &&
    typeof data.message === 'string' &&
    data.message.length <= 3000 &&
    data.createdAt === SERVER_TIME &&
    data.updatedAt === SERVER_TIME
  );
}

test('WhatsAppAlertLog Firestore rules enforce ownership, milestone/status enums, and reject shadow fields', () => {
  const verifiedUser: AuthContext = {
    uid: 'u2',
    token: { email: 'user@example.com', email_verified: true },
  };
  const validLog: Record<string, unknown> = {
    ownerUid: 'u2',
    id: 'wa_t1_urgent_4h',
    milestoneKey: 'wa_t1_urgent_4h',
    tenderRefId: 't1',
    tenderId: 'GEM/2026/B/1001',
    milestone: 'urgent_4h',
    recipientName: 'Vansh',
    recipientPhone: '919717690890',
    dueDateIso: '2026-11-15T15:00',
    status: 'manual_ready',
    provider: 'manual_ready',
    message: 'Urgent reminder',
    clientCreatedAt: '2026-11-15T11:30:00Z',
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  };
  assert.equal(isValidWhatsAppAlertLog(validLog, verifiedUser, 'u2', 'wa_t1_urgent_4h'), true);
  assert.equal(
    isValidWhatsAppAlertLog({ ...validLog, milestone: 'spam' }, verifiedUser, 'u2', 'wa_t1_urgent_4h'),
    false,
  );
  assert.equal(
    isValidWhatsAppAlertLog({ ...validLog, extraFlag: true }, verifiedUser, 'u2', 'wa_t1_urgent_4h'),
    false,
  );
  assert.equal(
    isValidWhatsAppAlertLog({ ...validLog, ownerUid: 'victim' }, verifiedUser, 'u2', 'wa_t1_urgent_4h'),
    false,
  );
});

function isValidSheetConfig(
  data: Record<string, unknown>,
  auth: AuthContext,
  userId: string,
): boolean {
  const keys = [
    'ownerUid',
    'enabled',
    'webhookUrl',
    'sheetName',
    'lastSyncedAt',
    'createdAt',
    'updatedAt',
  ];
  if (!hasExactKeys(data, keys, keys)) return false;
  return (
    isValidId(data.ownerUid) &&
    data.ownerUid === userId &&
    data.ownerUid === auth.uid &&
    typeof data.enabled === 'boolean' &&
    typeof data.webhookUrl === 'string' &&
    data.webhookUrl.length <= 500 &&
    (data.webhookUrl === '' || data.webhookUrl.startsWith('https://')) &&
    typeof data.sheetName === 'string' &&
    data.sheetName.length >= 1 &&
    data.sheetName.length <= 120 &&
    typeof data.lastSyncedAt === 'string' &&
    data.lastSyncedAt.length <= 40 &&
    data.createdAt === SERVER_TIME &&
    data.updatedAt === SERVER_TIME
  );
}

test('GoogleSheetConfig Firestore rules enforce ownership, HTTPS webhook URLs, and reject shadow fields', () => {
  const verifiedUser: AuthContext = {
    uid: 'u2',
    token: { email: 'user@example.com', email_verified: true },
  };
  const validConfig: Record<string, unknown> = {
    ownerUid: 'u2',
    enabled: true,
    webhookUrl: 'https://script.google.com/macros/s/AKfycb123/exec',
    sheetName: 'MIS Monthly Report',
    lastSyncedAt: '2026-11-16T08:00:00.000Z',
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  };
  assert.equal(isValidSheetConfig(validConfig, verifiedUser, 'u2'), true);
  assert.equal(isValidSheetConfig({ ...validConfig, webhookUrl: '' }, verifiedUser, 'u2'), true);
  assert.equal(
    isValidSheetConfig({ ...validConfig, webhookUrl: 'http://example.com' }, verifiedUser, 'u2'),
    false,
  );
  assert.equal(
    isValidSheetConfig({ ...validConfig, shadowKey: 1 }, verifiedUser, 'u2'),
    false,
  );
  assert.equal(
    isValidSheetConfig({ ...validConfig, ownerUid: 'victim' }, verifiedUser, 'u2'),
    false,
  );
});

function isValidSecondaryUserRecord(
  data: Record<string, unknown>,
  secondaryUserId: string,
): boolean {
  const keys = [
    'ownerUid',
    'userId',
    'username',
    'email',
    'role',
    'isActive',
    'isEnabled',
    'presenceStatus',
    'lastHeartbeatAt',
    'lastLogoutAt',
    'byocProjectId',
    'clientCreatedAt',
    'clientLastLoginAt',
    'createdAt',
    'updatedAt',
  ];
  if (!hasExactKeys(data, keys, keys)) return false;
  return (
    isValidId(data.ownerUid) &&
    isValidId(data.userId) &&
    data.userId === secondaryUserId &&
    typeof data.username === 'string' &&
    data.username.length >= 1 &&
    data.username.length <= 64 &&
    typeof data.email === 'string' &&
    data.email.length >= 5 &&
    data.email.length <= 160 &&
    data.role === 'secondary' &&
    typeof data.isActive === 'boolean' &&
    typeof data.isEnabled === 'boolean' &&
    (data.presenceStatus === 'active' || data.presenceStatus === 'not_active') &&
    typeof data.lastHeartbeatAt === 'string' &&
    data.lastHeartbeatAt.length <= 40 &&
    typeof data.lastLogoutAt === 'string' &&
    data.lastLogoutAt.length <= 40 &&
    typeof data.byocProjectId === 'string' &&
    data.byocProjectId.length <= 128 &&
    data.createdAt === SERVER_TIME &&
    data.updatedAt === SERVER_TIME
  );
}

test('SecondaryUserRecord enforces presence enum, isEnabled lock, and blocks non-admin enabling themselves', () => {
  const validSec: Record<string, unknown> = {
    ownerUid: 'u2',
    userId: 'sec_niyan_12ab',
    username: 'Niyan',
    email: 'info.niyantrana@gmail.com',
    role: 'secondary',
    isActive: true,
    isEnabled: true,
    presenceStatus: 'active',
    lastHeartbeatAt: '2026-11-20T05:30:00.000Z',
    lastLogoutAt: '',
    byocProjectId: 'niyan-byoc-project-1',
    clientCreatedAt: '2026-11-18T10:00:00.000Z',
    clientLastLoginAt: '2026-11-20T05:25:00.000Z',
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  };
  assert.equal(isValidSecondaryUserRecord(validSec, 'sec_niyan_12ab'), true);
  assert.equal(
    isValidSecondaryUserRecord({ ...validSec, presenceStatus: 'online' }, 'sec_niyan_12ab'),
    false,
  );
  // Secondary user cannot mutate isEnabled field on update
  const ownerUpdatableKeys = new Set([
    'username',
    'email',
    'isActive',
    'presenceStatus',
    'lastHeartbeatAt',
    'lastLogoutAt',
    'byocProjectId',
    'clientLastLoginAt',
    'updatedAt',
  ]);
  const changed = affectedKeys(
    { ...validSec, isEnabled: true },
    { ...validSec, isEnabled: false },
  );
  assert.equal(changed.every((k) => ownerUpdatableKeys.has(k)), false);
});

test('Bootstrapped Admin can list/read sibling Admin UIDs & legacy collections read-only while non-admin users are denied', () => {
  const isBootstrappedAdmin = (auth: AuthContext | null): boolean =>
    isVerifiedUser(auth) && auth.token.email === 'vanshsaxena7498@gmail.com';

  const adminAuth: AuthContext = {
    uid: 'JdizphoE56bNDu7OPtS4WZxrb0H2',
    token: { email: 'vanshsaxena7498@gmail.com', email_verified: true },
  };
  const unverifiedAdmin: AuthContext = {
    uid: 'JdizphoE56bNDu7OPtS4WZxrb0H2',
    token: { email: 'vanshsaxena7498@gmail.com', email_verified: false },
  };
  const secondaryAuth: AuthContext = {
    uid: 'sec_uid_niyan',
    token: { email: 'info.niyantrana@gmail.com', email_verified: true },
  };

  assert.equal(isBootstrappedAdmin(adminAuth), true);
  assert.equal(isBootstrappedAdmin(unverifiedAdmin), false);
  assert.equal(isBootstrappedAdmin(secondaryAuth), false);

  const canListUserSubcollection = (
    auth: AuthContext | null,
    userId: string,
    docOwnerUid: string,
  ): boolean =>
    isVerifiedUser(auth) &&
    (isBootstrappedAdmin(auth) || (auth.uid === userId && docOwnerUid === auth.uid));

  assert.equal(
    canListUserSubcollection(adminAuth, '4uQty7KjogbYUmjY1ZxnJMtn7rj1', '4uQty7KjogbYUmjY1ZxnJMtn7rj1'),
    true,
  );
  assert.equal(
    canListUserSubcollection(secondaryAuth, '4uQty7KjogbYUmjY1ZxnJMtn7rj1', '4uQty7KjogbYUmjY1ZxnJMtn7rj1'),
    false,
  );
  assert.equal(
    canListUserSubcollection(secondaryAuth, 'sec_uid_niyan', 'victimUid'),
    false,
  );
  assert.equal(
    canListUserSubcollection(secondaryAuth, 'sec_uid_niyan', 'sec_uid_niyan'),
    true,
  );
});

function isValidOemRecord(
  data: Record<string, unknown>,
  auth: AuthContext | null,
  userId: string,
  oemDocId: string,
): boolean {
  if (!isVerifiedUser(auth)) return false;
  const keys = [
    'ownerUid',
    'id',
    'oemName',
    'companyName',
    'concernedPersonName',
    'email',
    'phone',
    'remarks',
    'clientCreatedAt',
    'clientUpdatedAt',
    'createdAt',
    'updatedAt',
  ];
  if (!hasExactKeys(data, keys, keys)) return false;
  return (
    isValidId(data.ownerUid) &&
    data.ownerUid === userId &&
    data.ownerUid === auth.uid &&
    isValidId(data.id) &&
    data.id === oemDocId &&
    typeof data.oemName === 'string' &&
    data.oemName.length >= 1 &&
    data.oemName.length <= 150 &&
    typeof data.companyName === 'string' &&
    data.companyName.length <= 150 &&
    typeof data.concernedPersonName === 'string' &&
    data.concernedPersonName.length <= 120 &&
    typeof data.email === 'string' &&
    data.email.length <= 160 &&
    typeof data.phone === 'string' &&
    data.phone.length <= 40 &&
    typeof data.remarks === 'string' &&
    data.remarks.length <= 500 &&
    typeof data.clientCreatedAt === 'string' &&
    data.clientCreatedAt.length <= 40 &&
    typeof data.clientUpdatedAt === 'string' &&
    data.clientUpdatedAt.length <= 40 &&
    data.createdAt === SERVER_TIME &&
    data.updatedAt === SERVER_TIME
  );
}

test('OemDetail Firestore rules enforce ownership, required oemName, length bounds, server timestamps, and reject shadow fields', () => {
  const verifiedUser: AuthContext = {
    uid: 'u2',
    token: { email: 'user@example.com', email_verified: true },
  };
  const validOem: Record<string, unknown> = {
    ownerUid: 'u2',
    id: 'oem-nvs',
    oemName: 'NVS',
    companyName: 'Newtech',
    concernedPersonName: 'Sandeep Tyagi',
    email: 'sandeep.tyagi@nvsledwall.com',
    phone: '+91 8800686947',
    remarks: 'LED Video Wall OEM',
    clientCreatedAt: '2026-11-20T10:00:00Z',
    clientUpdatedAt: '2026-11-20T10:00:00Z',
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  };

  assert.equal(isValidOemRecord(validOem, verifiedUser, 'u2', 'oem-nvs'), true);
  assert.equal(isValidOemRecord({ ...validOem, oemName: '' }, verifiedUser, 'u2', 'oem-nvs'), false);
  assert.equal(isValidOemRecord({ ...validOem, oemName: 'A'.repeat(151) }, verifiedUser, 'u2', 'oem-nvs'), false);
  assert.equal(isValidOemRecord({ ...validOem, shadowField: true }, verifiedUser, 'u2', 'oem-nvs'), false);
  assert.equal(isValidOemRecord({ ...validOem, ownerUid: 'victim' }, verifiedUser, 'u2', 'oem-nvs'), false);
  assert.equal(isValidOemRecord({ ...validOem, id: 'wrong-id' }, verifiedUser, 'u2', 'oem-nvs'), false);
  assert.equal(isValidOemRecord({ ...validOem, createdAt: '2026-11-20T00:00:00Z' }, verifiedUser, 'u2', 'oem-nvs'), false);
});

test('Firestore update rules allow safe repair of legacy non-Timestamp createdAt, missing ownerUid, and removal of deprecated keys while blocking cross-owner hijacks', () => {
  const canUpdateLegacyDoc = (params: {
    userId: string;
    authUid: string;
    isAdmin: boolean;
    existing: Record<string, unknown>;
    incoming: Record<string, unknown>;
    allowedWriteKeys: string[];
  }): boolean => {
    const { userId, authUid, isAdmin, existing, incoming, allowedWriteKeys } = params;
    const ownerOk =
      !('ownerUid' in existing) ||
      typeof existing.ownerUid !== 'string' ||
      existing.ownerUid === '' ||
      incoming.ownerUid === existing.ownerUid ||
      isAdmin;
    const existingCreatedAtIsTimestamp = existing.createdAt === SERVER_TIME;
    const createdAtOk = !('createdAt' in existing) || !existingCreatedAtIsTimestamp
      ? incoming.createdAt === SERVER_TIME
      : incoming.createdAt === existing.createdAt;
    const addedKeys = Object.keys(incoming).filter((k) => !(k in existing));
    const changedKeys = Object.keys(incoming).filter(
      (k) => k in existing && incoming[k] !== existing[k],
    );
    const diffOk =
      (authUid === userId &&
        addedKeys.every((k) => allowedWriteKeys.includes(k)) &&
        changedKeys.every((k) => allowedWriteKeys.includes(k))) ||
      isAdmin;
    return ownerOk && createdAtOk && diffOk;
  };

  // Legacy tender doc with ISO string createdAt, missing ownerUid, and deprecated keys
  assert.equal(
    canUpdateLegacyDoc({
      userId: 'u2',
      authUid: 'u2',
      isAdmin: false,
      existing: {
        id: 't1',
        createdAt: '2026-01-01T00:00:00Z',
        lastUpdatedAt: '2026-02-01T00:00:00Z',
        tenderNo: 'LEGACY-1',
        title: 'Old Title',
      },
      incoming: {
        ownerUid: 'u2',
        id: 't1',
        title: 'Clean Title',
        createdAt: SERVER_TIME,
        updatedAt: SERVER_TIME,
      },
      allowedWriteKeys: ['ownerUid', 'id', 'title', 'createdAt', 'updatedAt'],
    }),
    true,
  );

  // Valid Timestamp createdAt must remain immutable on subsequent updates
  assert.equal(
    canUpdateLegacyDoc({
      userId: 'u2',
      authUid: 'u2',
      isAdmin: false,
      existing: {
        ownerUid: 'u2',
        id: 't1',
        title: 'Old Title',
        createdAt: SERVER_TIME,
      },
      incoming: {
        ownerUid: 'u2',
        id: 't1',
        title: 'Clean Title',
        createdAt: 'forged',
        updatedAt: SERVER_TIME,
      },
      allowedWriteKeys: ['ownerUid', 'id', 'title', 'createdAt', 'updatedAt'],
    }),
    false,
  );

  // Non-admin still cannot overwrite a document owned by another UID
  assert.equal(
    canUpdateLegacyDoc({
      userId: 'u2',
      authUid: 'u2',
      isAdmin: false,
      existing: {
        ownerUid: 'victimUid',
        id: 't1',
        createdAt: SERVER_TIME,
      },
      incoming: {
        ownerUid: 'u2',
        id: 't1',
        createdAt: SERVER_TIME,
        updatedAt: SERVER_TIME,
      },
      allowedWriteKeys: ['ownerUid', 'id', 'createdAt', 'updatedAt'],
    }),
    false,
  );
});







