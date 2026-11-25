import type { CrmUserSession, TabKey } from '../types/crm';

export const CRM_SESSION_STORAGE_KEY = 'vansh_crm_tab_session_v1';
export const CRM_SESSION_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

const VALID_TABS: ReadonlySet<TabKey> = new Set([
  'dashboard',
  'bidsearch',
  'tenders',
  'oems',
  'maf',
  'emdbg',
  'bidra',
  'settings',
]);

export interface PerTabCrmSessionEnvelope {
  session: CrmUserSession;
  sessionToken: string;
  loginAtMs: number;
  activeTab: TabKey;
}

export type LoadPerTabSessionResult =
  | { status: 'valid'; data: PerTabCrmSessionEnvelope }
  | { status: 'expired'; expiredSession: CrmUserSession; loginAtMs: number }
  | { status: 'none' };

function getDefaultSessionStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch {
    // Ignore storage access errors
  }
  return null;
}

function normalizeTabKey(tab: unknown): TabKey {
  if (typeof tab === 'string' && VALID_TABS.has(tab as TabKey)) {
    return tab as TabKey;
  }
  return 'dashboard';
}

function isValidCrmSession(val: unknown): val is CrmUserSession {
  if (!val || typeof val !== 'object') return false;
  const s = val as Record<string, unknown>;
  return (
    typeof s.userId === 'string' &&
    s.userId.trim().length > 0 &&
    typeof s.username === 'string' &&
    s.username.trim().length > 0 &&
    typeof s.email === 'string' &&
    typeof s.role === 'string' &&
    s.role.trim().length > 0
  );
}

export function getRemainingCrmSessionMs(loginAtMs: number, nowMs = Date.now()): number {
  if (!Number.isFinite(loginAtMs) || loginAtMs <= 0) return 0;
  const elapsed = Math.max(0, nowMs - loginAtMs);
  return Math.max(0, CRM_SESSION_MAX_AGE_MS - elapsed);
}

export function isCrmSessionExpired(loginAtMs: number, nowMs = Date.now()): boolean {
  if (!Number.isFinite(loginAtMs) || loginAtMs <= 0) return true;
  return nowMs - loginAtMs > CRM_SESSION_MAX_AGE_MS;
}

export function clearPerTabCrmSession(storage: Storage | null = getDefaultSessionStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(CRM_SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function savePerTabCrmSession(
  params: {
    session: CrmUserSession;
    sessionToken?: string;
    loginAtMs: number;
    activeTab?: TabKey;
  },
  storage: Storage | null = getDefaultSessionStorage(),
): void {
  if (!storage) return;
  const envelope: PerTabCrmSessionEnvelope = {
    session: params.session,
    sessionToken: params.sessionToken || '',
    loginAtMs: params.loginAtMs,
    activeTab: normalizeTabKey(params.activeTab),
  };
  try {
    storage.setItem(CRM_SESSION_STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // Ignore quota/storage errors
  }
}

export function updatePerTabActiveTab(
  activeTab: TabKey,
  storage: Storage | null = getDefaultSessionStorage(),
): void {
  if (!storage) return;
  try {
    const raw = storage.getItem(CRM_SESSION_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<PerTabCrmSessionEnvelope> & {
      adminSessionToken?: string;
    };
    if (!isValidCrmSession(parsed.session) || typeof parsed.loginAtMs !== 'number') {
      return;
    }
    const token =
      typeof parsed.sessionToken === 'string' && parsed.sessionToken
        ? parsed.sessionToken
        : typeof parsed.adminSessionToken === 'string'
          ? parsed.adminSessionToken
          : '';
    const nextEnvelope: PerTabCrmSessionEnvelope = {
      session: parsed.session,
      sessionToken: token,
      loginAtMs: parsed.loginAtMs,
      activeTab: normalizeTabKey(activeTab),
    };
    storage.setItem(CRM_SESSION_STORAGE_KEY, JSON.stringify(nextEnvelope));
  } catch {
    // Ignore parse/storage errors
  }
}

export function getActivePerTabSessionToken(
  storage: Storage | null = getDefaultSessionStorage(),
): string {
  const loaded = loadValidPerTabCrmSession(Date.now(), storage);
  if (loaded.status === 'valid') {
    return loaded.data.sessionToken;
  }
  return '';
}

export function loadValidPerTabCrmSession(
  nowMs = Date.now(),
  storage: Storage | null = getDefaultSessionStorage(),
): LoadPerTabSessionResult {
  if (!storage) return { status: 'none' };
  let raw: string | null = null;
  try {
    raw = storage.getItem(CRM_SESSION_STORAGE_KEY);
  } catch {
    return { status: 'none' };
  }
  if (!raw) return { status: 'none' };

  try {
    const parsed = JSON.parse(raw) as Partial<PerTabCrmSessionEnvelope> & {
      adminSessionToken?: string;
    };
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !isValidCrmSession(parsed.session) ||
      typeof parsed.loginAtMs !== 'number' ||
      !Number.isFinite(parsed.loginAtMs) ||
      parsed.loginAtMs <= 0
    ) {
      clearPerTabCrmSession(storage);
      return { status: 'none' };
    }

    if (isCrmSessionExpired(parsed.loginAtMs, nowMs)) {
      clearPerTabCrmSession(storage);
      return {
        status: 'expired',
        expiredSession: parsed.session,
        loginAtMs: parsed.loginAtMs,
      };
    }

    const token =
      typeof parsed.sessionToken === 'string' && parsed.sessionToken
        ? parsed.sessionToken
        : typeof parsed.adminSessionToken === 'string'
          ? parsed.adminSessionToken
          : '';

    return {
      status: 'valid',
      data: {
        session: {
          ...parsed.session,
          companyId:
            typeof parsed.session.companyId === 'string' && parsed.session.companyId.trim()
              ? parsed.session.companyId.trim()
              : parsed.session.userId,
        },
        sessionToken: token,
        loginAtMs: parsed.loginAtMs,
        activeTab: normalizeTabKey(parsed.activeTab),
      },
    };
  } catch {
    clearPerTabCrmSession(storage);
    return { status: 'none' };
  }
}
