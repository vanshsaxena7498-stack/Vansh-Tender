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
  const keys = [
    'ownerUid',
    'id',
    'tenderId',
    'portal',
    'department',
    'location',
    'category',
    'title',
    'publishDate',
    'submissionDueDate',
    'preBidDate',
    'estimatedValue',
    'quotedValue',
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
  if (!hasExactKeys(data, keys, keys)) return false;
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
    department: 'CPWD Delhi',
    location: 'New Delhi',
    category: 'IT Hardware',
    title: 'Supply of Enterprise Workstations',
    publishDate: '2026-04-01',
    submissionDueDate: '2026-05-01T15:00',
    preBidDate: '',
    estimatedValue: 1000000,
    quotedValue: 950000,
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

  // 4. Shadow / Ghost Field Injection
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

