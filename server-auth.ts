import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import type { Request } from 'express';

export type TeamRole = 'owner' | 'admin' | 'manager' | 'executive' | 'finance' | 'viewer';
export type LegacyCompatibleRole = TeamRole | 'secondary';
export type CompanyPlanTier = 'starter' | 'professional' | 'business';

export type ServerPermission =
  | 'team.manage'
  | 'billing.manage'
  | 'tenders.write'
  | 'tenders.delete'
  | 'oem.write'
  | 'maf.write'
  | 'emd.write'
  | 'documents.write'
  | 'ai.scan'
  | 'sheets.sync'
  | 'alerts.send'
  | 'backup.export'
  | 'backup.restore'
  | 'audit.view';

const ROLE_PERMISSION_SET: Record<TeamRole, ReadonlySet<ServerPermission>> = {
  owner: new Set<ServerPermission>([
    'team.manage',
    'billing.manage',
    'tenders.write',
    'tenders.delete',
    'oem.write',
    'maf.write',
    'emd.write',
    'documents.write',
    'ai.scan',
    'sheets.sync',
    'alerts.send',
    'backup.export',
    'backup.restore',
    'audit.view',
  ]),
  admin: new Set<ServerPermission>([
    'team.manage',
    'billing.manage',
    'tenders.write',
    'tenders.delete',
    'oem.write',
    'maf.write',
    'emd.write',
    'documents.write',
    'ai.scan',
    'sheets.sync',
    'alerts.send',
    'backup.export',
    'backup.restore',
    'audit.view',
  ]),
  manager: new Set<ServerPermission>([
    'tenders.write',
    'tenders.delete',
    'oem.write',
    'maf.write',
    'emd.write',
    'documents.write',
    'ai.scan',
    'sheets.sync',
    'alerts.send',
    'backup.export',
    'audit.view',
  ]),
  executive: new Set<ServerPermission>([
    'tenders.write',
    'oem.write',
    'maf.write',
    'documents.write',
    'ai.scan',
    'alerts.send',
    'audit.view',
  ]),
  finance: new Set<ServerPermission>([
    'emd.write',
    'documents.write',
    'backup.export',
    'audit.view',
  ]),
  viewer: new Set<ServerPermission>(['audit.view']),
};

export function normalizeServerRole(role?: string | null): TeamRole {
  switch ((role || '').trim().toLowerCase()) {
    case 'owner':
      return 'owner';
    case 'admin':
      return 'admin';
    case 'manager':
      return 'manager';
    case 'finance':
      return 'finance';
    case 'viewer':
      return 'viewer';
    case 'executive':
    case 'secondary':
    default:
      return 'executive';
  }
}

export function isWorkspaceAdminRole(role?: string | null): boolean {
  const norm = normalizeServerRole(role);
  return norm === 'owner' || norm === 'admin';
}

export function hasServerPermission(role: string | null | undefined, perm: ServerPermission): boolean {
  const norm = normalizeServerRole(role);
  return ROLE_PERMISSION_SET[norm].has(perm);
}

export const BCRYPT_ROUNDS = 12;
export const SERVER_PRESENCE_TTL_MS = 90_000;
export const SESSION_TTL_MS = 15 * 60 * 1000;

export const IS_VERCEL = Boolean(process.env.VERCEL);
export const DATA_DIR = IS_VERCEL
  ? path.join(os.tmpdir(), 'vansh-crm-data')
  : path.resolve(process.cwd(), '.data');
export const STATE_FILE = path.join(DATA_DIR, 'crm-server-state.json');
const HMAC_KEY_FILE = path.join(DATA_DIR, 'crm-hmac.secret');

export interface CompanyPlanQuotas {
  maxUsers: number;
  maxAiScansPerMonth: number;
  maxTenders: number;
  label: string;
}

export const PLAN_QUOTAS: Record<CompanyPlanTier, CompanyPlanQuotas> = {
  starter: {
    maxUsers: 3,
    maxAiScansPerMonth: 25,
    maxTenders: 150,
    label: 'Starter MSME',
  },
  professional: {
    maxUsers: 15,
    maxAiScansPerMonth: 250,
    maxTenders: 2500,
    label: 'Professional GeM Desk',
  },
  business: {
    maxUsers: 100,
    maxAiScansPerMonth: 2500,
    maxTenders: 25000,
    label: 'Business Enterprise',
  },
};

export interface CompanyServerRecord {
  companyId: string;
  companyName: string;
  gstin?: string;
  udyamNumber?: string;
  plan: CompanyPlanTier;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
  usage: {
    monthKey: string; // YYYY-MM
    aiScansUsed: number;
  };
}

export interface CompanyInviteRecord {
  inviteCode: string;
  companyId: string;
  companyName: string;
  email: string;
  role: TeamRole;
  invitedByUserId: string;
  createdAt: string;
  expiresAt: number;
  usedAt?: string;
  usedByUserId?: string;
}

export interface CrmServerUserRecord {
  userId: string;
  username: string;
  email: string;
  role: TeamRole;
  companyId: string;
  companyName?: string;
  passwordHash?: string; // bcrypt hash
  // Read-only legacy fields for graceful rehash on existing disk state ONLY (never minted for new accounts)
  salt?: string;
  hash?: string;
  passwordChangedAt?: string;
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
  byocConfig?: Record<string, unknown> | null;
}

export interface PendingOtpRecord {
  purpose?: 'signup' | 'reset';
  userId?: string;
  username?: string;
  email?: string;
  otpHash: string;
  salt?: string;
  expiresAt: number;
  attempts: number;
  requestedAt: string;
}

export interface ServerEmailAlertLogEntry {
  id: string;
  tenantId?: string;
  companyId?: string;
  slotKey: string;
  tenderRefId: string;
  tenderId: string;
  slot: 'slot_11am' | 'slot_4pm' | 'manual' | 'test';
  recipientName: string;
  recipientEmail: string;
  dueDateIso: string;
  status: 'sent' | 'failed';
  provider: string;
  subject: string;
  message: string;
  errorDetail?: string;
  createdAt: string;
}

export interface PersistedServerState {
  users: Record<string, CrmServerUserRecord>;
  companies: Record<string, CompanyServerRecord>;
  invites: Record<string, CompanyInviteRecord>;
  pendingOtps: Record<string, PendingOtpRecord>;
  revokedSessions: Record<string, number>; // sid -> expMs
  emailLogs: ServerEmailAlertLogEntry[];
}

export interface SessionTokenPayload {
  kind: 'crm_session';
  sid: string;
  userId: string;
  username: string;
  email: string;
  companyId: string;
  companyName: string;
  role: TeamRole;
  iat: number;
  exp: number;
}

let cachedRuntimeHmacSecret: string | null = null;

export function getHmacSecret(): string {
  const envSecret = process.env.CRM_TOKEN_SECRET?.trim();
  if (envSecret && envSecret.length >= 16) {
    return envSecret;
  }
  if (cachedRuntimeHmacSecret) {
    return cachedRuntimeHmacSecret;
  }
  try {
    if (fs.existsSync(HMAC_KEY_FILE)) {
      const diskSecret = fs.readFileSync(HMAC_KEY_FILE, 'utf8').trim();
      if (diskSecret.length >= 32) {
        cachedRuntimeHmacSecret = diskSecret;
        return diskSecret;
      }
    }
    const generated = crypto.randomBytes(32).toString('base64url');
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(HMAC_KEY_FILE, generated, { encoding: 'utf8', mode: 0o600 });
    cachedRuntimeHmacSecret = generated;
    return generated;
  } catch {
    cachedRuntimeHmacSecret = crypto.randomBytes(32).toString('base64url');
    return cachedRuntimeHmacSecret;
  }
}

export function signSignedToken<T extends object>(payload: T): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getHmacSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySignedToken<T>(token: string): T | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, providedSig] = parts;
  if (!encoded || !providedSig) return null;
  const expectedSig = crypto
    .createHmac('sha256', getHmacSecret())
    .update(encoded)
    .digest('base64url');
  const providedBuf = Buffer.from(providedSig);
  const expectedBuf = Buffer.from(expectedSig);
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) return null;
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

export async function hashPasswordBcrypt(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyUserPassword(
  password: string,
  user: Pick<CrmServerUserRecord, 'passwordHash' | 'salt' | 'hash'>,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (user.passwordHash && user.passwordHash.startsWith('$2')) {
    const valid = await bcrypt.compare(password, user.passwordHash);
    return { valid, needsRehash: false };
  }
  if (user.salt && user.hash) {
    try {
      const derived = crypto.scryptSync(password, user.salt, 64);
      const expectedBuf = Buffer.from(user.hash, 'hex');
      if (derived.length === expectedBuf.length && crypto.timingSafeEqual(derived, expectedBuf)) {
        return { valid: true, needsRehash: true };
      }
    } catch {
      return { valid: false, needsRehash: false };
    }
  }
  return { valid: false, needsRehash: false };
}

export function hashOtpSecret(otp: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(otp, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyOtpSecret(otp: string, encoded: string, legacySalt?: string): boolean {
  if (!encoded) return false;
  if (encoded.includes(':')) {
    const [salt, expectedHex] = encoded.split(':');
    if (!salt || !expectedHex) return false;
    const derived = crypto.scryptSync(otp, salt, 32);
    const expected = Buffer.from(expectedHex, 'hex');
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  }
  if (legacySalt) {
    const derived = crypto.scryptSync(otp, legacySalt, 64);
    const expected = Buffer.from(encoded, 'hex');
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  }
  return false;
}

export function signSessionToken(
  user: CrmServerUserRecord,
  companyName: string,
  ttlMs = SESSION_TTL_MS,
): string {
  const now = Date.now();
  const payload: SessionTokenPayload = {
    kind: 'crm_session',
    sid: crypto.randomBytes(16).toString('hex'),
    userId: user.userId,
    username: user.username,
    email: user.email,
    companyId: user.companyId,
    companyName: companyName || user.companyName || 'Workspace',
    role: normalizeServerRole(user.role),
    iat: now,
    exp: now + ttlMs,
  };
  return signSignedToken(payload);
}

export function extractBearerTokenFromRequest(req: Request, bodyToken?: unknown): string {
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization.trim() : '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  const sessionHeader =
    typeof req.headers['x-crm-session-token'] === 'string'
      ? req.headers['x-crm-session-token'].trim()
      : '';
  if (sessionHeader) return sessionHeader;
  const legacyAdminHeader =
    typeof req.headers['x-crm-admin-token'] === 'string'
      ? req.headers['x-crm-admin-token'].trim()
      : '';
  if (legacyAdminHeader) return legacyAdminHeader;
  if (typeof bodyToken === 'string' && bodyToken.trim()) {
    return bodyToken.trim();
  }
  return '';
}

export function authenticateSessionToken(
  token: string,
  state: PersistedServerState,
): SessionTokenPayload | null {
  const parsed = verifySignedToken<Partial<SessionTokenPayload>>(token);
  if (
    !parsed ||
    parsed.kind !== 'crm_session' ||
    typeof parsed.sid !== 'string' ||
    typeof parsed.userId !== 'string' ||
    typeof parsed.username !== 'string' ||
    typeof parsed.email !== 'string' ||
    typeof parsed.companyId !== 'string' ||
    typeof parsed.iat !== 'number' ||
    typeof parsed.exp !== 'number'
  ) {
    return null;
  }
  if (Date.now() >= parsed.exp) {
    return null;
  }
  if (state.revokedSessions[parsed.sid]) {
    return null;
  }

  const userRecord = state.users[parsed.userId];
  if (userRecord) {
    const enabled =
      userRecord.isEnabled !== undefined
        ? userRecord.isEnabled !== false
        : userRecord.isActive !== false;
    if (!enabled) {
      return null;
    }
    if (userRecord.passwordChangedAt) {
      const changedMs = Date.parse(userRecord.passwordChangedAt);
      if (!Number.isNaN(changedMs) && parsed.iat < changedMs) {
        return null;
      }
    }
    return {
      kind: 'crm_session',
      sid: parsed.sid,
      userId: userRecord.userId,
      username: userRecord.username,
      email: userRecord.email,
      companyId: userRecord.companyId || parsed.companyId,
      companyName:
        state.companies[userRecord.companyId]?.companyName ||
        userRecord.companyName ||
        parsed.companyName ||
        'Workspace',
      role: normalizeServerRole(userRecord.role),
      iat: parsed.iat,
      exp: parsed.exp,
    };
  }

  return {
    kind: 'crm_session',
    sid: parsed.sid,
    userId: parsed.userId,
    username: parsed.username,
    email: parsed.email,
    companyId: parsed.companyId,
    companyName: parsed.companyName || 'Workspace',
    role: normalizeServerRole(parsed.role),
    iat: parsed.iat,
    exp: parsed.exp,
  };
}

export function slugifyCompanyId(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return `comp_${base || 'workspace'}_${crypto.randomBytes(3).toString('hex')}`;
}

export function slugifyUserId(prefix: string, username: string): string {
  const base = username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `${prefix}_${base || 'user'}_${crypto.randomBytes(3).toString('hex')}`;
}

export function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

export function loadServerState(): PersistedServerState {
  const empty: PersistedServerState = {
    users: {},
    companies: {},
    invites: {},
    pendingOtps: {},
    revokedSessions: {},
    emailLogs: [],
  };

  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedServerState>;
      const users: Record<string, CrmServerUserRecord> =
        parsed.users && typeof parsed.users === 'object' ? { ...parsed.users } : {};
      const companies: Record<string, CompanyServerRecord> =
        parsed.companies && typeof parsed.companies === 'object' ? { ...parsed.companies } : {};
      const invites: Record<string, CompanyInviteRecord> =
        parsed.invites && typeof parsed.invites === 'object' ? { ...parsed.invites } : {};
      const pendingOtps: Record<string, PendingOtpRecord> =
        parsed.pendingOtps && typeof parsed.pendingOtps === 'object' ? { ...parsed.pendingOtps } : {};

      // Purge expired revocations on load
      const now = Date.now();
      const revokedSessions: Record<string, number> = {};
      if (parsed.revokedSessions && typeof parsed.revokedSessions === 'object') {
        for (const [sid, exp] of Object.entries(parsed.revokedSessions)) {
          if (typeof exp === 'number' && exp > now) {
            revokedSessions[sid] = exp;
          }
        }
      }

      // Normalize legacy user records so every user has a companyId and TeamRole
      let defaultCompanyId = Object.keys(companies)[0] || '';
      for (const [uid, u] of Object.entries(users)) {
        if (!u || typeof u !== 'object') {
          delete users[uid];
          continue;
        }
        const role = normalizeServerRole(u.role);
        let companyId = typeof u.companyId === 'string' && u.companyId.trim() ? u.companyId.trim() : '';
        if (!companyId) {
          if (isWorkspaceAdminRole(role)) {
            companyId = defaultCompanyId || slugifyCompanyId('Primary Workspace');
            defaultCompanyId = companyId;
          } else {
            companyId = slugifyCompanyId(u.username || 'Workspace');
          }
        }
        if (!companies[companyId]) {
          companies[companyId] = {
            companyId,
            companyName: u.companyName || `${u.username}'s Workspace`,
            plan: 'starter',
            ownerUserId: u.userId,
            createdAt: u.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            usage: { monthKey: currentMonthKey(), aiScansUsed: 0 },
          };
        }
        users[uid] = {
          ...u,
          role,
          companyId,
          companyName: companies[companyId].companyName,
        };
      }

      const loaded: PersistedServerState = {
        users,
        companies,
        invites,
        pendingOtps,
        revokedSessions,
        emailLogs: Array.isArray(parsed.emailLogs) ? parsed.emailLogs.slice(0, 300) : [],
      };
      return loaded;
    }
  } catch {
    // Reinitialize cleanly if corrupted
  }

  return empty;
}

export function bootstrapEnvAdminIfConfigured(state: PersistedServerState): PersistedServerState {
  const hasAdmin = Object.values(state.users).some((u) => isWorkspaceAdminRole(u.role));
  if (hasAdmin) return state;

  const envUser = process.env.CRM_INITIAL_ADMIN_USERNAME?.trim();
  const envEmail = process.env.CRM_INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const envPassword = process.env.CRM_INITIAL_ADMIN_PASSWORD?.trim();
  const envCompanyName = process.env.CRM_INITIAL_COMPANY_NAME?.trim() || 'Primary Workspace';

  if (!envUser || !envEmail || !envPassword || envPassword.length < 8) {
    return state;
  }

  const nowIso = new Date().toISOString();
  const companyId = slugifyCompanyId(envCompanyName);
  const userId = slugifyUserId('own', envUser);
  const passwordHash = bcrypt.hashSync(envPassword, BCRYPT_ROUNDS);

  const company: CompanyServerRecord = {
    companyId,
    companyName: envCompanyName,
    plan: 'professional',
    ownerUserId: userId,
    createdAt: nowIso,
    updatedAt: nowIso,
    usage: { monthKey: currentMonthKey(), aiScansUsed: 0 },
  };
  const ownerUser: CrmServerUserRecord = {
    userId,
    username: envUser,
    email: envEmail,
    role: 'owner',
    companyId,
    companyName: envCompanyName,
    passwordHash,
    createdAt: nowIso,
    updatedAt: nowIso,
    isActive: true,
    isEnabled: true,
    presenceStatus: 'not_active',
  };

  const nextState: PersistedServerState = {
    ...state,
    users: { ...state.users, [userId]: ownerUser },
    companies: { ...state.companies, [companyId]: company },
  };
  saveServerState(nextState);
  return nextState;
}

export function saveServerState(state: PersistedServerState): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist server auth state:', err);
  }
}

export function computeServerPresenceStatus(
  user: CrmServerUserRecord,
  nowMs = Date.now(),
): 'active' | 'not_active' {
  const enabled =
    user.isEnabled !== undefined ? user.isEnabled !== false : user.isActive !== false;
  if (!enabled) return 'not_active';
  if (user.presenceStatus !== 'active') return 'not_active';
  if (!user.lastHeartbeatAt) return 'not_active';
  const hbMs = Date.parse(user.lastHeartbeatAt);
  if (Number.isNaN(hbMs)) return 'not_active';
  return nowMs - hbMs <= SERVER_PRESENCE_TTL_MS ? 'active' : 'not_active';
}

export function sanitizeServerUserForClient(user: CrmServerUserRecord, companyName?: string) {
  const isEnabled =
    user.isEnabled !== undefined ? user.isEnabled !== false : user.isActive !== false;
  const presenceStatus = computeServerPresenceStatus(user);
  return {
    userId: user.userId,
    username: user.username,
    email: user.email,
    role: normalizeServerRole(user.role),
    companyId: user.companyId,
    companyName: companyName || user.companyName || 'Workspace',
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    isActive: isEnabled && presenceStatus === 'active',
    isEnabled,
    disabledAt: user.disabledAt,
    presenceStatus,
    lastHeartbeatAt: user.lastHeartbeatAt,
    lastLogoutAt: user.lastLogoutAt,
    byocProjectId: user.byocProjectId,
    byocConfig: user.byocConfig ?? null,
  };
}

export function isValidAppsScriptUrl(rawUrl: string): boolean {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed || trimmed.length > 500) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'script.google.com' || host === 'script.googleusercontent.com') {
      return parsed.pathname.startsWith('/macros/');
    }
    return false;
  } catch {
    return false;
  }
}

export async function safeFetchAppsScript(
  rawUrl: string,
  options: { method: 'GET' | 'POST'; body?: string; timeoutMs?: number },
): Promise<globalThis.Response> {
  if (!isValidAppsScriptUrl(rawUrl)) {
    throw new Error('Blocked unsafe Apps Script webhook URL.');
  }

  let currentUrl = rawUrl;
  let currentMethod: 'GET' | 'POST' = options.method;
  let currentBody = options.body;
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);

  for (let hop = 0; hop < 5; hop++) {
    const remaining = Math.max(2000, deadline - Date.now());
    const resp = await fetch(currentUrl, {
      method: currentMethod,
      redirect: 'manual',
      headers: currentMethod === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: currentMethod === 'POST' ? currentBody : undefined,
      signal: AbortSignal.timeout(remaining),
    });

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location');
      if (!location) {
        throw new Error('Apps Script redirect missing Location header.');
      }
      const nextUrl = new URL(location, currentUrl).toString();
      if (!isValidAppsScriptUrl(nextUrl)) {
        throw new Error(`Blocked unsafe redirect target from webhook: ${new URL(nextUrl).hostname}`);
      }
      if (resp.status === 301 || resp.status === 302 || resp.status === 303) {
        currentMethod = 'GET';
        currentBody = undefined;
      }
      currentUrl = nextUrl;
      continue;
    }

    return resp;
  }

  throw new Error('Too many redirects returned by Google Apps Script.');
}

export function readFirebaseApiKey(): string {
  if (process.env.VITE_FIREBASE_API_KEY) {
    return process.env.VITE_FIREBASE_API_KEY;
  }
  const candidatePaths = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(process.cwd(), '..', 'firebase-applet-config.json'),
  ];
  for (const configPath of candidatePaths) {
    try {
      if (fs.existsSync(configPath)) {
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { apiKey?: string };
        if (parsed.apiKey) return parsed.apiKey;
      }
    } catch {
      // Try next path
    }
  }
  return '';
}

export async function verifyFirebaseIdToken(
  idToken: string,
  expectedEmail?: string,
): Promise<{
  ok: boolean;
  uid?: string;
  email?: string;
  displayName?: string;
  error?: string;
}> {
  const apiKey = readFirebaseApiKey();
  if (!apiKey) {
    return { ok: false, error: 'Firebase Web API key not found on server.' };
  }
  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  const rawBody = await resp.text();
  if (!resp.ok) {
    return { ok: false, error: 'Google token verification failed.' };
  }
  let data: {
    users?: Array<{
      localId?: string;
      email?: string;
      emailVerified?: boolean;
      displayName?: string;
    }>;
  } = {};
  try {
    data = JSON.parse(rawBody) as typeof data;
  } catch {
    return { ok: false, error: 'Invalid JSON received from Google identity service.' };
  }
  const user = data.users?.[0];
  if (!user || !user.emailVerified || !user.email) {
    return { ok: false, error: 'Google account email is not verified.' };
  }
  if (expectedEmail && user.email.toLowerCase() !== expectedEmail.toLowerCase()) {
    return {
      ok: false,
      error: `Verified email (${user.email}) does not match expected account (${expectedEmail}).`,
    };
  }
  return {
    ok: true,
    uid: user.localId,
    email: user.email.toLowerCase(),
    displayName: user.displayName,
  };
}
