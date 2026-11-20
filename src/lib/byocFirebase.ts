import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import type { ByocConnectionState, ByocFirebaseConfig } from '../types/crm';
import {
  buildByocConsoleUrl,
  CENTRAL_FIREBASE_PROJECT_ID,
  CENTRAL_FIRESTORE_DATABASE_ID,
  getByocStorageKey,
  normalizeByocConfig,
  parseFirebaseConfigSnippet,
  validateByocFirebaseConfig,
} from './byocConfigHelpers';

export {
  buildByocConsoleUrl,
  CENTRAL_FIREBASE_PROJECT_ID,
  CENTRAL_FIRESTORE_DATABASE_ID,
  getByocStorageKey,
  normalizeByocConfig,
  parseFirebaseConfigSnippet,
  validateByocFirebaseConfig,
};

export interface ByocCloudContext {
  userId: string;
  app: FirebaseApp;
  db: Firestore;
  auth: Auth;
  storage: FirebaseStorage;
  provider: GoogleAuthProvider;
  config: ByocFirebaseConfig;
  signature: string;
}

const byocInstances = new Map<string, ByocCloudContext>();

function isBrowserStorageAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

export function loadByocConfig(userId: string): ByocFirebaseConfig | null {
  if (!userId || !isBrowserStorageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(getByocStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ByocFirebaseConfig>;
    const check = validateByocFirebaseConfig(parsed);
    return check.valid ? check.normalized : null;
  } catch {
    return null;
  }
}

export function saveByocConfig(userId: string, config: ByocFirebaseConfig): void {
  if (!userId || !isBrowserStorageAvailable()) return;
  try {
    const normalized = normalizeByocConfig(config);
    window.localStorage.setItem(getByocStorageKey(userId), JSON.stringify(normalized));
  } catch {
    // Ignore storage quota issues safely
  }
}

export function clearByocConfig(userId: string): void {
  if (!userId || !isBrowserStorageAvailable()) return;
  try {
    window.localStorage.removeItem(getByocStorageKey(userId));
  } catch {
    // Ignore
  }
}

export function buildByocConfigSignature(userId: string, cfg: ByocFirebaseConfig): string {
  return [
    userId.trim(),
    cfg.apiKey.trim(),
    cfg.authDomain.trim(),
    cfg.projectId.trim(),
    cfg.appId.trim(),
    (cfg.storageBucket || '').trim(),
    (cfg.messagingSenderId || '').trim(),
    (cfg.firestoreDatabaseId || '').trim(),
  ].join('|');
}

export async function disposeByocContext(userId?: string): Promise<void> {
  if (userId) {
    const existing = byocInstances.get(userId);
    if (!existing) return;
    byocInstances.delete(userId);
    try {
      await signOut(existing.auth).catch(() => {});
      await deleteApp(existing.app);
    } catch {
      // Ignore teardown errors
    }
    return;
  }

  const all = Array.from(byocInstances.values());
  byocInstances.clear();
  for (const ctx of all) {
    try {
      await signOut(ctx.auth).catch(() => {});
      await deleteApp(ctx.app);
    } catch {
      // Ignore
    }
  }
}

export async function getOrInitByocContext(
  userId: string,
  config: ByocFirebaseConfig,
): Promise<ByocCloudContext> {
  const check = validateByocFirebaseConfig(config);
  if (!check.valid) {
    throw new Error(check.error || 'Invalid BYOC Firebase configuration.');
  }
  const normalized = check.normalized;
  const sig = buildByocConfigSignature(userId, normalized);
  const cached = byocInstances.get(userId);
  if (cached && cached.signature === sig) {
    return cached;
  }
  if (cached) {
    await disposeByocContext(userId);
  }

  const appName = `byoc_${userId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${normalized.projectId}_${Date.now()}`;
  const app = initializeApp(
    {
      apiKey: normalized.apiKey,
      authDomain: normalized.authDomain,
      projectId: normalized.projectId,
      storageBucket: normalized.storageBucket || undefined,
      messagingSenderId: normalized.messagingSenderId || undefined,
      appId: normalized.appId,
    },
    appName,
  );
  const db = normalized.firestoreDatabaseId
    ? getFirestore(app, normalized.firestoreDatabaseId)
    : getFirestore(app);
  const auth = getAuth(app);
  const storage = getStorage(app);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  const context: ByocCloudContext = {
    userId,
    app,
    db,
    auth,
    storage,
    provider,
    config: normalized,
    signature: sig,
  };
  byocInstances.set(userId, context);
  return context;
}

export function getCachedByocContext(userId: string): ByocCloudContext | null {
  return byocInstances.get(userId) ?? null;
}

export async function signInWithByocGoogle(
  userId: string,
  config: ByocFirebaseConfig,
): Promise<{ ctx: ByocCloudContext; user: User }> {
  const ctx = await getOrInitByocContext(userId, config);
  const cred = await signInWithPopup(ctx.auth, ctx.provider);
  return { ctx, user: cred.user };
}

export async function signOutByocGoogle(userId: string): Promise<void> {
  const cached = byocInstances.get(userId);
  if (!cached) return;
  await signOut(cached.auth).catch(() => {});
}

export function subscribeByocAuthState(
  ctx: ByocCloudContext,
  callback: (user: User | null) => void,
): () => void {
  return onAuthStateChanged(ctx.auth, callback);
}

export async function testByocFirebaseConnection(
  userId: string,
  config: ByocFirebaseConfig,
): Promise<ByocConnectionState> {
  const check = validateByocFirebaseConfig(config);
  if (!check.valid) {
    return {
      status: 'error',
      message: check.error || 'Incomplete Firebase configuration.',
      projectId: check.normalized.projectId,
      databaseId: check.normalized.firestoreDatabaseId || '(default)',
    };
  }

  try {
    const ctx = await getOrInitByocContext(userId, check.normalized);
    const dbLabel = check.normalized.firestoreDatabaseId || '(default)';
    const currentUser = ctx.auth.currentUser;

    try {
      await getDocFromServer(doc(ctx.db, 'test', 'connection'));
    } catch (probeErr) {
      const msg = probeErr instanceof Error ? probeErr.message : String(probeErr);
      if (
        msg.includes('the client is offline') ||
        msg.includes('unavailable') ||
        msg.includes('Could not reach Cloud Firestore')
      ) {
        return {
          status: 'error',
          message: `Cannot reach Firestore database "${dbLabel}" in project "${check.normalized.projectId}". Check that Firestore is created and internet is active.`,
          projectId: check.normalized.projectId,
          databaseId: dbLabel,
        };
      }
      if (!currentUser && (msg.includes('permission-denied') || msg.includes('Missing or insufficient permissions'))) {
        return {
          status: 'auth_required',
          message: `Firebase config for "${check.normalized.projectId}" is reachable. Now click "Sign in with Google" to authorize your BYOC workspace.`,
          projectId: check.normalized.projectId,
          databaseId: dbLabel,
        };
      }
      if (msg.includes('permission-denied') || msg.includes('Missing or insufficient permissions')) {
        return {
          status: 'error',
          message: `Signed in as ${currentUser?.email || 'user'}, but Firestore rules in "${check.normalized.projectId}" denied access. Paste the BYOC Firestore Rules from the Setup Guide and publish them.`,
          projectId: check.normalized.projectId,
          databaseId: dbLabel,
        };
      }
      if (msg.includes('NOT_FOUND') || msg.includes('does not exist')) {
        return {
          status: 'error',
          message: `Firestore database "${dbLabel}" does not exist in "${check.normalized.projectId}". Leave Database ID blank for "(default)" or enter the exact Database ID.`,
          projectId: check.normalized.projectId,
          databaseId: dbLabel,
        };
      }
    }

    if (!currentUser) {
      return {
        status: 'auth_required',
        message: `Config validated for "${check.normalized.projectId}" (${dbLabel}). Click "Sign in with Google" to connect your cloud workspace.`,
        projectId: check.normalized.projectId,
        databaseId: dbLabel,
      };
    }

    const verifiedAt = new Date().toISOString();
    return {
      status: 'connected',
      message: `Connected & verified: "${check.normalized.projectId}" (${dbLabel}) as ${currentUser.email || currentUser.uid}.`,
      projectId: check.normalized.projectId,
      databaseId: dbLabel,
      verifiedAt,
    };
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Unable to initialize BYOC Firebase app.',
      projectId: check.normalized.projectId,
      databaseId: check.normalized.firestoreDatabaseId || '(default)',
    };
  }
}

export const BYOC_FIRESTORE_RULES_TEMPLATE = `rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function isSignedIn() {
      return request.auth != null
        && request.auth.token.email_verified == true;
    }

    function isOwner(userId) {
      return isSignedIn() && request.auth.uid == userId;
    }

    function isTenantOwner() {
      return isSignedIn() && (
        (resource != null && resource.data.ownerUid == request.auth.uid) ||
        (request.resource != null && request.resource.data.ownerUid == request.auth.uid)
      );
    }

    match /test/connection {
      allow read: if isSignedIn();
      allow write: if false;
    }

    match /users/{userId} {
      allow read, write: if isOwner(userId);

      match /{subcollection}/{docId} {
        allow read, write: if isOwner(userId);
      }
    }

    match /workspaces/{tenantId} {
      allow read, write: if isTenantOwner();

      match /{subcollection}/{docId} {
        allow read, write: if isTenantOwner();
      }
    }
  }
}
`;
