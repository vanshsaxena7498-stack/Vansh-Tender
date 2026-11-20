import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };
import type { ByocFirebaseConfig } from '../types/crm';

export const CENTRAL_FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const CENTRAL_FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId;

const BYOC_STORAGE_KEY_PREFIX = 'vansh_crm_byoc_v1_';

export function getByocStorageKey(userId: string): string {
  const safe = (userId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${BYOC_STORAGE_KEY_PREFIX}${safe}`;
}

export function normalizeByocConfig(input: Partial<ByocFirebaseConfig>): ByocFirebaseConfig {
  const projectId = (input.projectId || '').trim();
  const dbIdRaw = (input.firestoreDatabaseId || '').trim();
  return {
    apiKey: (input.apiKey || '').trim(),
    authDomain: (input.authDomain || '').trim() || (projectId ? `${projectId}.firebaseapp.com` : ''),
    projectId,
    storageBucket:
      (input.storageBucket || '').trim() || (projectId ? `${projectId}.firebasestorage.app` : ''),
    messagingSenderId: (input.messagingSenderId || '').trim(),
    appId: (input.appId || '').trim(),
    firestoreDatabaseId: dbIdRaw === '(default)' ? '' : dbIdRaw,
    updatedAt: input.updatedAt,
    verifiedAt: input.verifiedAt,
  };
}

export function validateByocFirebaseConfig(input: Partial<ByocFirebaseConfig> | null | undefined): {
  valid: boolean;
  error?: string;
  missingFields: string[];
  normalized: ByocFirebaseConfig;
} {
  const normalized = normalizeByocConfig(input || {});
  const missingFields: string[] = [];

  if (!normalized.apiKey) missingFields.push('apiKey');
  if (!normalized.authDomain) missingFields.push('authDomain');
  if (!normalized.projectId) missingFields.push('projectId');
  if (!normalized.appId) missingFields.push('appId');

  if (missingFields.length > 0) {
    return {
      valid: false,
      error: `Missing required Firebase config field(s): ${missingFields.join(', ')}.`,
      missingFields,
      normalized,
    };
  }

  if (normalized.projectId.toLowerCase() === CENTRAL_FIREBASE_PROJECT_ID.toLowerCase()) {
    return {
      valid: false,
      error: `Project ID "${CENTRAL_FIREBASE_PROJECT_ID}" belongs to the primary Admin cloud. Secondary users must connect their own Firebase project ID.`,
      missingFields: [],
      normalized,
    };
  }

  if (!/^[a-z0-9-]+$/i.test(normalized.projectId)) {
    return {
      valid: false,
      error: 'Firebase Project ID should contain only letters, numbers, and hyphens.',
      missingFields: [],
      normalized,
    };
  }

  return {
    valid: true,
    missingFields: [],
    normalized,
  };
}

function extractConfigFields(raw: Record<string, unknown>): Partial<ByocFirebaseConfig> {
  const pick = (key: string) => (typeof raw[key] === 'string' ? raw[key].trim() : undefined);
  return {
    apiKey: pick('apiKey'),
    authDomain: pick('authDomain'),
    projectId: pick('projectId'),
    storageBucket: pick('storageBucket'),
    messagingSenderId: pick('messagingSenderId'),
    appId: pick('appId'),
    firestoreDatabaseId: pick('firestoreDatabaseId') || pick('databaseId'),
  };
}

export function parseFirebaseConfigSnippet(rawInput: string): Partial<ByocFirebaseConfig> | null {
  const text = (rawInput || '').trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') {
      return extractConfigFields(parsed);
    }
  } catch {
    // Fall back to JS snippet key extraction (safe regex parser, zero eval)
  }

  const keys: (keyof ByocFirebaseConfig)[] = [
    'apiKey',
    'authDomain',
    'projectId',
    'storageBucket',
    'messagingSenderId',
    'appId',
    'firestoreDatabaseId',
    'databaseId' as keyof ByocFirebaseConfig,
  ];

  const extracted: Partial<ByocFirebaseConfig> = {};
  let foundCount = 0;

  for (const key of keys) {
    const pattern = new RegExp(
      `["']?${String(key)}["']?\\s*:\\s*["'\`]([^"'\`\\r\\n]+)["'\`]`,
      'i',
    );
    const match = text.match(pattern);
    if (match && match[1]) {
      if (String(key) === 'databaseId') {
        if (!extracted.firestoreDatabaseId) {
          extracted.firestoreDatabaseId = match[1].trim();
        }
      } else {
        extracted[key] = match[1].trim() as never;
      }
      foundCount++;
    }
  }

  return foundCount >= 2 ? extracted : null;
}

export function buildByocConsoleUrl(
  projectId: string | undefined,
  databaseId?: string,
): string | null {
  const safeProject = (projectId || '').trim();
  if (!safeProject) return null;
  const dbSegment = (databaseId || '').trim() || '(default)';
  return `https://console.firebase.google.com/project/${encodeURIComponent(safeProject)}/firestore/databases/${encodeURIComponent(dbSegment)}/data`;
}

export function assertIsolatedTargetDescriptor<
  T extends { projectId: string; isByoc: boolean; role: 'admin' | 'secondary' },
>(opts: {
  role?: 'admin' | 'secondary';
  workspaceTenantId?: string | null;
  target?: T | null;
  adminFallback: T;
}): T {
  const safeTenant =
    typeof opts.workspaceTenantId === 'string' &&
    opts.workspaceTenantId.trim() !== '' &&
    opts.workspaceTenantId.trim() !== 'admin_vanshsales'
      ? opts.workspaceTenantId.trim()
      : null;
  const inferredRole = opts.role ?? opts.target?.role ?? (safeTenant ? 'secondary' : 'admin');

  if (inferredRole === 'secondary' || safeTenant) {
    if (!opts.target || !opts.target.isByoc) {
      throw new Error(
        'BYOC_NOT_CONFIGURED: Secondary user cloud storage requires your own verified Firebase project. Admin primary cloud is strictly isolated.',
      );
    }
    if (opts.target.projectId.toLowerCase() === CENTRAL_FIREBASE_PROJECT_ID.toLowerCase()) {
      throw new Error(
        'BYOC_PROJECT_CONFLICT: Secondary users cannot read or write to the primary Admin Firebase project.',
      );
    }
    return opts.target;
  }

  return opts.target ?? opts.adminFallback;
}
