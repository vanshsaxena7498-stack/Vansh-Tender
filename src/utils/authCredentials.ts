import type {
  CrmUserRole,
  CrmUserSession,
  EmdBgRecord,
  EmailAlertLog,
  EmailAlertSettings,
  FirmProfile,
  GoogleSheetSettings,
  MafTrackerRecord,
  SecondaryUserSummary,
  Tender,
  UserPreferences,
} from '../types/crm';

export const ADMIN_USER_ID = 'admin_vanshsales';
export const VALID_LOGIN_USERNAME = 'VanshSales';
export const VALID_LOGIN_PASSWORD = 'Vansh@2027';
export const ADMIN_RECOVERY_EMAIL = 'vanshsaxena7498@gmail.com';

const PASSWORD_OVERRIDE_STORAGE_KEY = 'vansh_crm_auth_credential_v1';
const MULTI_USER_STORAGE_KEY = 'vansh_crm_auth_users_v2';
const SECONDARY_WORKSPACE_PREFIX = 'vansh_crm_sec_ws_v1_';

export interface StoredPasswordOverride {
  username: string;
  password?: string;
  passwordSalt?: string;
  passwordHash?: string;
  credentialToken?: string;
  updatedAt: string;
}

export interface StoredCrmUserAccount {
  userId: string;
  username: string;
  email: string;
  role: CrmUserRole;
  password?: string;
  passwordSalt?: string;
  passwordHash?: string;
  credentialToken?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  isActive: boolean;
  isEnabled?: boolean;
  disabledAt?: string;
  presenceStatus?: 'active' | 'not_active';
  lastHeartbeatAt?: string;
  lastLogoutAt?: string;
  byocProjectId?: string;
}

export const PRESENCE_HEARTBEAT_TTL_MS = 90_000;

export function computeEffectivePresenceStatus(
  user: Pick<
    StoredCrmUserAccount,
    'isEnabled' | 'isActive' | 'presenceStatus' | 'lastHeartbeatAt'
  >,
  nowMs = Date.now(),
): 'active' | 'not_active' {
  const enabled = user.isEnabled !== undefined ? user.isEnabled !== false : user.isActive !== false;
  if (!enabled) return 'not_active';
  if (user.presenceStatus !== 'active') return 'not_active';
  if (!user.lastHeartbeatAt) return 'not_active';
  const hbMs = Date.parse(user.lastHeartbeatAt);
  if (Number.isNaN(hbMs)) return 'not_active';
  return nowMs - hbMs <= PRESENCE_HEARTBEAT_TTL_MS ? 'active' : 'not_active';
}

export interface SecondaryWorkspaceSnapshot {
  firmProfile: FirmProfile;
  preferences: UserPreferences;
  tenders: Tender[];
  emdRecords: EmdBgRecord[];
  mafTrackers: MafTrackerRecord[];
  emailSettings: EmailAlertSettings;
  emailLogs: EmailAlertLog[];
  sheetSettings: GoogleSheetSettings;
  updatedAt: string;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (v: number, n: number) => (v >>> n) | (v << (32 - n));

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  return Array.from(h, (val) => val.toString(16).padStart(8, '0')).join('');
}

function generateSaltHex(): string {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const buf = new Uint8Array(16);
    globalThis.crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, 32);
}

function createPasswordHashRecord(password: string): { passwordSalt: string; passwordHash: string } {
  const passwordSalt = generateSaltHex();
  const passwordHash = sha256Hex(`${passwordSalt}:${password}`);
  return { passwordSalt, passwordHash };
}

function verifyPasswordHash(candidate: string, salt: string, expectedHash: string): boolean {
  const actual = sha256Hex(`${salt}:${candidate}`);
  if (actual.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return diff === 0;
}

let memoryOverride: StoredPasswordOverride | null = null;
let memoryUsers: Record<string, StoredCrmUserAccount> | null = null;

function buildDefaultAdminAccount(): StoredCrmUserAccount {
  const now = new Date().toISOString();
  return {
    userId: ADMIN_USER_ID,
    username: VALID_LOGIN_USERNAME,
    email: ADMIN_RECOVERY_EMAIL,
    role: 'admin',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: now,
    isActive: true,
  };
}

function readLegacyAdminOverride(): StoredPasswordOverride | null {
  if (memoryOverride) return memoryOverride;
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(PASSWORD_OVERRIDE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StoredPasswordOverride>;
        if (parsed.username === VALID_LOGIN_USERNAME) {
          memoryOverride = {
            username: parsed.username,
            password: typeof parsed.password === 'string' ? parsed.password : undefined,
            passwordSalt:
              typeof parsed.passwordSalt === 'string' ? parsed.passwordSalt : undefined,
            passwordHash:
              typeof parsed.passwordHash === 'string' ? parsed.passwordHash : undefined,
            credentialToken:
              typeof parsed.credentialToken === 'string' ? parsed.credentialToken : undefined,
            updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
          };
          return memoryOverride;
        }
      }
    } catch {
      // Ignore storage read restrictions without clearing any CRM data
    }
  }
  return null;
}

function readUserStore(): Record<string, StoredCrmUserAccount> {
  if (!memoryUsers) {
    const seeded: Record<string, StoredCrmUserAccount> = {
      [ADMIN_USER_ID]: buildDefaultAdminAccount(),
    };
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(MULTI_USER_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, Partial<StoredCrmUserAccount>>;
          if (parsed && typeof parsed === 'object') {
            for (const [id, entry] of Object.entries(parsed)) {
              if (!entry || typeof entry.username !== 'string' || typeof entry.email !== 'string') continue;
              const role: CrmUserRole =
                entry.role === 'admin' || id === ADMIN_USER_ID ? 'admin' : 'secondary';
              seeded[id] = {
                userId: typeof entry.userId === 'string' && entry.userId ? entry.userId : id,
                username: entry.username.trim(),
                email: entry.email.trim().toLowerCase(),
                role,
                password: typeof entry.password === 'string' ? entry.password : undefined,
                passwordSalt:
                  typeof entry.passwordSalt === 'string' ? entry.passwordSalt : undefined,
                passwordHash:
                  typeof entry.passwordHash === 'string' ? entry.passwordHash : undefined,
                credentialToken:
                  typeof entry.credentialToken === 'string' ? entry.credentialToken : undefined,
                createdAt:
                  typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString(),
                updatedAt:
                  typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString(),
                lastLoginAt:
                  typeof entry.lastLoginAt === 'string' ? entry.lastLoginAt : undefined,
                isActive: entry.isActive !== false,
                isEnabled:
                  typeof entry.isEnabled === 'boolean'
                    ? entry.isEnabled
                    : entry.isActive !== false,
                disabledAt:
                  typeof entry.disabledAt === 'string' ? entry.disabledAt : undefined,
                presenceStatus:
                  entry.presenceStatus === 'active' || entry.presenceStatus === 'not_active'
                    ? entry.presenceStatus
                    : 'not_active',
                lastHeartbeatAt:
                  typeof entry.lastHeartbeatAt === 'string' ? entry.lastHeartbeatAt : undefined,
                lastLogoutAt:
                  typeof entry.lastLogoutAt === 'string' ? entry.lastLogoutAt : undefined,
                byocProjectId:
                  typeof entry.byocProjectId === 'string' ? entry.byocProjectId : undefined,
              };
            }
          }
        }
      } catch {
        // Ignore storage read errors safely
      }
    }
    memoryUsers = seeded;
  }

  // Always preserve & merge legacy v1 admin override if newer or present
  const legacy = readLegacyAdminOverride();
  const admin = memoryUsers[ADMIN_USER_ID] || buildDefaultAdminAccount();
  if (legacy) {
    if (legacy.passwordSalt && legacy.passwordHash) {
      admin.passwordSalt = legacy.passwordSalt;
      admin.passwordHash = legacy.passwordHash;
      delete admin.password;
    } else if (typeof legacy.password === 'string' && legacy.password && !admin.passwordHash) {
      admin.password = legacy.password;
    }
    if (typeof legacy.credentialToken === 'string' && legacy.credentialToken) {
      admin.credentialToken = legacy.credentialToken;
    }
    if (legacy.updatedAt && legacy.updatedAt > admin.updatedAt) {
      admin.updatedAt = legacy.updatedAt;
    }
  }
  memoryUsers[ADMIN_USER_ID] = admin;
  return memoryUsers;
}

function sanitizeStoreForLocalStorage(
  store: Record<string, StoredCrmUserAccount>,
): Record<string, StoredCrmUserAccount> {
  const sanitized: Record<string, StoredCrmUserAccount> = {};
  for (const [id, user] of Object.entries(store)) {
    const copy: StoredCrmUserAccount = { ...user };
    if (copy.password && (!copy.passwordHash || !copy.passwordSalt)) {
      const hashed = createPasswordHashRecord(copy.password);
      copy.passwordSalt = hashed.passwordSalt;
      copy.passwordHash = hashed.passwordHash;
    }
    delete copy.password;
    sanitized[id] = copy;
  }
  return sanitized;
}

function persistUserStore(store: Record<string, StoredCrmUserAccount>): void {
  const safeStore = sanitizeStoreForLocalStorage(store);
  memoryUsers = safeStore;
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      window.localStorage.setItem(MULTI_USER_STORAGE_KEY, JSON.stringify(safeStore));
    } catch {
      // Non-fatal in private browsing / restricted storage
    }
  }
}

export function sanitizeUserIdSlug(username: string): string {
  const cleaned = username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return cleaned || `user_${Date.now()}`;
}

export function findUserByIdentifier(identifier: string): StoredCrmUserAccount | null {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) return null;
  const store = readUserStore();
  for (const user of Object.values(store)) {
    if (
      user.userId.toLowerCase() === normalized ||
      user.username.toLowerCase() === normalized ||
      user.email.toLowerCase() === normalized
    ) {
      return { ...user };
    }
  }
  return null;
}

export function registerSecondaryUserAccount(params: {
  userId?: string;
  username: string;
  email: string;
  password?: string;
  credentialToken?: string;
  createdAt?: string;
}): StoredCrmUserAccount {
  const store = readUserStore();
  const cleanUsername = params.username.trim();
  const cleanEmail = params.email.trim().toLowerCase();
  const now = new Date().toISOString();

  if (
    cleanUsername.toLowerCase() === VALID_LOGIN_USERNAME.toLowerCase() ||
    cleanEmail === ADMIN_RECOVERY_EMAIL.toLowerCase()
  ) {
    throw new Error('This User ID or Gmail belongs to the primary Admin account.');
  }

  // Check duplicates across secondary accounts
  for (const existing of Object.values(store)) {
    if (existing.role === 'admin') continue;
    const sameUserId = params.userId && existing.userId === params.userId;
    if (!sameUserId) {
      if (existing.username.toLowerCase() === cleanUsername.toLowerCase()) {
        throw new Error(`User ID "${cleanUsername}" is already registered.`);
      }
      if (existing.email.toLowerCase() === cleanEmail) {
        throw new Error(`Gmail "${cleanEmail}" is already linked to another User ID.`);
      }
    }
  }

  const userId =
    (params.userId && params.userId.trim()) || `sec_${sanitizeUserIdSlug(cleanUsername)}`;
  const prev = store[userId];
  const hashed =
    typeof params.password === 'string' && params.password.length > 0
      ? createPasswordHashRecord(params.password)
      : prev?.passwordSalt && prev?.passwordHash
        ? { passwordSalt: prev.passwordSalt, passwordHash: prev.passwordHash }
        : undefined;

  const record: StoredCrmUserAccount = {
    userId,
    username: cleanUsername,
    email: cleanEmail,
    role: 'secondary',
    ...(hashed || {}),
    credentialToken: params.credentialToken ?? prev?.credentialToken,
    createdAt: params.createdAt || prev?.createdAt || now,
    updatedAt: now,
    lastLoginAt: prev?.lastLoginAt,
    isActive: true,
    isEnabled: prev?.isEnabled !== false,
    presenceStatus: prev?.presenceStatus ?? 'not_active',
    lastHeartbeatAt: prev?.lastHeartbeatAt,
    lastLogoutAt: prev?.lastLogoutAt,
    byocProjectId: prev?.byocProjectId,
  };
  store[userId] = record;
  persistUserStore(store);
  return { ...store[userId] };
}

/**
 * Persists a newly reset password or server credential for a specific CRM user cleanly
 * without clearing localStorage or touching any existing CRM data.
 */
export function saveResetPasswordCredential(
  usernameOrIdentifier: string,
  newPassword: string,
  credentialToken?: string,
  extra?: {
    userId?: string;
    email?: string;
    role?: CrmUserRole;
    createdAt?: string;
    lastLoginAt?: string;
    isEnabled?: boolean;
    disabledAt?: string;
    presenceStatus?: 'active' | 'not_active';
    lastHeartbeatAt?: string;
    lastLogoutAt?: string;
    byocProjectId?: string;
  },
): StoredCrmUserAccount {
  const store = readUserStore();
  const existing =
    (extra?.userId ? store[extra.userId] : null) ||
    findUserByIdentifier(usernameOrIdentifier) ||
    (extra?.email ? findUserByIdentifier(extra.email) : null);

  const isAdminTarget =
    existing?.role === 'admin' ||
    extra?.role === 'admin' ||
    usernameOrIdentifier.trim().toLowerCase() === VALID_LOGIN_USERNAME.toLowerCase() ||
    usernameOrIdentifier.trim().toLowerCase() === ADMIN_RECOVERY_EMAIL.toLowerCase() ||
    extra?.userId === ADMIN_USER_ID;

  const now = new Date().toISOString();

  if (isAdminTarget) {
    const admin = store[ADMIN_USER_ID] || buildDefaultAdminAccount();
    if (newPassword) {
      const hashed = createPasswordHashRecord(newPassword);
      admin.passwordSalt = hashed.passwordSalt;
      admin.passwordHash = hashed.passwordHash;
      delete admin.password;
    } else if (admin.password && !admin.passwordHash) {
      const hashed = createPasswordHashRecord(admin.password);
      admin.passwordSalt = hashed.passwordSalt;
      admin.passwordHash = hashed.passwordHash;
      delete admin.password;
    }
    if (credentialToken) admin.credentialToken = credentialToken;
    admin.updatedAt = now;
    if (extra?.lastLoginAt) admin.lastLoginAt = extra.lastLoginAt;
    store[ADMIN_USER_ID] = admin;
    persistUserStore(store);

    const legacyEntry: StoredPasswordOverride = {
      username: VALID_LOGIN_USERNAME,
      passwordSalt: admin.passwordSalt,
      passwordHash: admin.passwordHash,
      credentialToken: admin.credentialToken,
      updatedAt: now,
    };
    memoryOverride = legacyEntry;
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      try {
        window.localStorage.setItem(PASSWORD_OVERRIDE_STORAGE_KEY, JSON.stringify(legacyEntry));
      } catch {
        // Non-fatal in private browsing / restricted storage
      }
    }
    return { ...store[ADMIN_USER_ID] };
  }

  const targetUserId =
    existing?.userId ||
    extra?.userId ||
    `sec_${sanitizeUserIdSlug(usernameOrIdentifier || 'user')}`;
  const cleanUsername = existing?.username || usernameOrIdentifier.trim();
  const cleanEmail = (existing?.email || extra?.email || '').trim().toLowerCase();

  const hashed = newPassword
    ? createPasswordHashRecord(newPassword)
    : existing?.passwordSalt && existing?.passwordHash
      ? { passwordSalt: existing.passwordSalt, passwordHash: existing.passwordHash }
      : existing?.password
        ? createPasswordHashRecord(existing.password)
        : undefined;

  const nextEnabled =
    extra?.isEnabled !== undefined
      ? extra.isEnabled
      : existing?.isEnabled !== undefined
        ? existing.isEnabled
        : true;

  const updated: StoredCrmUserAccount = {
    userId: targetUserId,
    username: cleanUsername,
    email: cleanEmail,
    role: 'secondary',
    ...(hashed || {}),
    credentialToken: credentialToken || existing?.credentialToken,
    createdAt: existing?.createdAt || extra?.createdAt || now,
    updatedAt: now,
    lastLoginAt: extra?.lastLoginAt || existing?.lastLoginAt,
    isActive: nextEnabled,
    isEnabled: nextEnabled,
    disabledAt: extra?.disabledAt ?? existing?.disabledAt,
    presenceStatus: extra?.presenceStatus ?? existing?.presenceStatus ?? 'not_active',
    lastHeartbeatAt: extra?.lastHeartbeatAt ?? existing?.lastHeartbeatAt,
    lastLogoutAt: extra?.lastLogoutAt ?? existing?.lastLogoutAt,
    byocProjectId: extra?.byocProjectId ?? existing?.byocProjectId,
  };
  store[targetUserId] = updated;
  persistUserStore(store);
  return { ...store[targetUserId] };
}

export function syncAuthenticatedUserFromServer(params: {
  userId: string;
  username: string;
  email: string;
  role: CrmUserRole;
  password?: string;
  credentialToken?: string;
  createdAt?: string;
  lastLoginAt?: string;
  isEnabled?: boolean;
  disabledAt?: string;
  presenceStatus?: 'active' | 'not_active';
  lastHeartbeatAt?: string;
  lastLogoutAt?: string;
  byocProjectId?: string;
}): StoredCrmUserAccount {
  return saveResetPasswordCredential(
    params.username,
    params.password || '',
    params.credentialToken,
    {
      userId: params.userId,
      email: params.email,
      role: params.role,
      createdAt: params.createdAt,
      lastLoginAt: params.lastLoginAt || new Date().toISOString(),
      isEnabled: params.isEnabled,
      disabledAt: params.disabledAt,
      presenceStatus: params.presenceStatus ?? 'active',
      lastHeartbeatAt: params.lastHeartbeatAt,
      lastLogoutAt: params.lastLogoutAt,
      byocProjectId: params.byocProjectId,
    },
  );
}

export function setSecondaryUserEnabled(
  identifierOrUserId: string,
  isEnabled: boolean,
  nowIso = new Date().toISOString(),
): SecondaryUserSummary | null {
  const store = readUserStore();
  const match = store[identifierOrUserId] || findUserByIdentifier(identifierOrUserId);
  if (!match || match.role === 'admin') return null;
  const current = store[match.userId];
  if (!current) return null;
  current.isEnabled = isEnabled;
  current.isActive = isEnabled;
  current.disabledAt = isEnabled ? undefined : nowIso;
  if (!isEnabled) {
    current.presenceStatus = 'not_active';
  }
  current.updatedAt = nowIso;
  store[match.userId] = current;
  persistUserStore(store);
  const livePresence = computeEffectivePresenceStatus(current);
  return {
    userId: current.userId,
    username: current.username,
    email: current.email,
    role: 'secondary',
    createdAt: current.createdAt,
    lastLoginAt: current.lastLoginAt,
    isActive: current.isEnabled !== false && livePresence === 'active',
    isEnabled: current.isEnabled !== false,
    disabledAt: current.disabledAt,
    presenceStatus: livePresence,
    lastHeartbeatAt: current.lastHeartbeatAt,
    lastLogoutAt: current.lastLogoutAt,
    byocProjectId: current.byocProjectId,
  };
}

export function updateUserPresence(
  identifierOrUserId: string,
  status: 'active' | 'not_active',
  extra?: { nowIso?: string; byocProjectId?: string },
): void {
  const store = readUserStore();
  const match = store[identifierOrUserId] || findUserByIdentifier(identifierOrUserId);
  if (!match) return;
  const current = store[match.userId];
  if (!current) return;
  const nowIso = extra?.nowIso || new Date().toISOString();
  if (current.isEnabled === false) {
    current.presenceStatus = 'not_active';
    current.isActive = false;
  } else {
    current.presenceStatus = status;
    current.isActive = status === 'active';
    if (status === 'active') {
      current.lastHeartbeatAt = nowIso;
    } else {
      current.lastLogoutAt = nowIso;
    }
  }
  if (extra?.byocProjectId !== undefined) {
    current.byocProjectId = extra.byocProjectId;
  }
  current.updatedAt = nowIso;
  store[match.userId] = current;
  persistUserStore(store);
}

export function recordUserLoginActivity(identifier: string, lastLoginAt = new Date().toISOString()): void {
  const store = readUserStore();
  const match = findUserByIdentifier(identifier);
  if (!match) return;
  const current = store[match.userId];
  if (!current) return;
  current.lastLoginAt = lastLoginAt;
  current.presenceStatus = current.isEnabled === false ? 'not_active' : 'active';
  current.lastHeartbeatAt = lastLoginAt;
  store[match.userId] = current;
  persistUserStore(store);
}

export function getStoredCredentialToken(identifier?: string): string {
  if (identifier) {
    const user = findUserByIdentifier(identifier);
    if (user?.credentialToken) return user.credentialToken;
  }
  const store = readUserStore();
  return store[ADMIN_USER_ID]?.credentialToken || readLegacyAdminOverride()?.credentialToken || '';
}

export function getAllStoredCredentialTokens(): string[] {
  const store = readUserStore();
  const tokens = new Set<string>();
  const legacyToken = readLegacyAdminOverride()?.credentialToken;
  if (legacyToken) tokens.add(legacyToken);
  for (const user of Object.values(store)) {
    if (user.credentialToken) tokens.add(user.credentialToken);
  }
  return Array.from(tokens);
}

export function listSecondaryUsers(nowMs = Date.now()): SecondaryUserSummary[] {
  const store = readUserStore();
  return Object.values(store)
    .filter((u) => u.role === 'secondary')
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .map((u) => {
      const enabled = u.isEnabled !== undefined ? u.isEnabled !== false : u.isActive !== false;
      const presence = computeEffectivePresenceStatus(u, nowMs);
      return {
        userId: u.userId,
        username: u.username,
        email: u.email,
        role: 'secondary',
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        isActive: enabled && presence === 'active',
        isEnabled: enabled,
        disabledAt: u.disabledAt,
        presenceStatus: presence,
        lastHeartbeatAt: u.lastHeartbeatAt,
        lastLogoutAt: u.lastLogoutAt,
        byocProjectId: u.byocProjectId,
      };
    });
}

export function clearInMemoryPasswordOverrideForTests(): void {
  memoryOverride = null;
  memoryUsers = null;
}

export interface LoginValidationResult {
  ok: boolean;
  code?: 'ACCOUNT_DISABLED' | 'INVALID_CREDENTIALS';
  user?: CrmUserSession;
  error?: string;
}

export function validateLoginCredentials(
  usernameOrEmailInput: string,
  passwordInput: string,
): LoginValidationResult {
  const trimmedUser = usernameOrEmailInput.trim();
  if (!trimmedUser) {
    return { ok: false, code: 'INVALID_CREDENTIALS', error: 'Please enter your User ID or Email ID.' };
  }
  if (!passwordInput) {
    return { ok: false, code: 'INVALID_CREDENTIALS', error: 'Please enter your Password.' };
  }

  const account = findUserByIdentifier(trimmedUser);
  if (!account) {
    return {
      ok: false,
      code: 'INVALID_CREDENTIALS',
      error: 'Invalid User ID or password. Please check your credentials and try again.',
    };
  }

  // Case-sensitive User ID check when logging in with username (email login is case-insensitive)
  const isEmailInput = trimmedUser.includes('@');
  if (!isEmailInput && trimmedUser !== account.username && trimmedUser !== account.userId) {
    return {
      ok: false,
      code: 'INVALID_CREDENTIALS',
      error: 'Invalid User ID or password. Please check your credentials and try again.',
    };
  }

  let passwordValid = false;
  if (account.passwordSalt && account.passwordHash) {
    passwordValid = verifyPasswordHash(passwordInput, account.passwordSalt, account.passwordHash);
  } else if (account.password) {
    passwordValid = passwordInput === account.password;
  } else if (account.role === 'admin') {
    passwordValid = passwordInput === VALID_LOGIN_PASSWORD;
  }

  if (!passwordValid) {
    return {
      ok: false,
      code: 'INVALID_CREDENTIALS',
      error: 'Invalid User ID or password. Please check your credentials and try again.',
    };
  }

  const isEnabled =
    account.isEnabled !== undefined ? account.isEnabled !== false : account.isActive !== false;
  if (!isEnabled && account.role !== 'admin') {
    return {
      ok: false,
      code: 'ACCOUNT_DISABLED',
      error:
        'Your CRM ID has been disabled by the Primary Administrator (VanshSales). Please contact the administrator to re-enable access.',
    };
  }

  return {
    ok: true,
    user: {
      userId: account.userId,
      username: account.username,
      email: account.email,
      role: account.role,
      createdAt: account.createdAt,
      lastLoginAt: account.lastLoginAt,
      isEnabled: true,
      presenceStatus: 'active',
      byocProjectId: account.byocProjectId,
    },
  };
}

export function buildEmptySecondaryWorkspace(session: Pick<CrmUserSession, 'userId' | 'username' | 'email'>): SecondaryWorkspaceSnapshot {
  return {
    firmProfile: {
      firmName: `${session.username} Tender Desk`,
      gstin: '',
      udyamNumber: '',
      adminName: session.username,
      adminPhotoUrl: '',
    },
    preferences: {
      adminPin: '0000',
      darkMode: false,
    },
    tenders: [],
    emdRecords: [],
    mafTrackers: [],
    emailSettings: {
      enabled: true,
      recipientName: session.username,
      recipientEmail: session.email,
    },
    emailLogs: [],
    sheetSettings: {
      enabled: false,
      webhookUrl: '',
      sheetName: 'MIS Monthly Report',
    },
    updatedAt: new Date().toISOString(),
  };
}

export function loadSecondaryWorkspaceSnapshot(userId: string): SecondaryWorkspaceSnapshot | null {
  if (!userId || userId === ADMIN_USER_ID) return null;
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${SECONDARY_WORKSPACE_PREFIX}${userId}`);
    if (!raw) return null;
    return JSON.parse(raw) as SecondaryWorkspaceSnapshot;
  } catch {
    return null;
  }
}

export function saveSecondaryWorkspaceSnapshot(
  userId: string,
  snapshot: SecondaryWorkspaceSnapshot,
): void {
  if (!userId || userId === ADMIN_USER_ID) return;
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${SECONDARY_WORKSPACE_PREFIX}${userId}`,
      JSON.stringify(snapshot),
    );
  } catch {
    // Non-fatal if browser storage quota is tight
  }
}

export function clearSecondaryWorkspaceSnapshot(userId: string): void {
  if (!userId || userId === ADMIN_USER_ID) return;
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    window.localStorage.removeItem(`${SECONDARY_WORKSPACE_PREFIX}${userId}`);
  } catch {
    // Ignore storage removal errors
  }
}
