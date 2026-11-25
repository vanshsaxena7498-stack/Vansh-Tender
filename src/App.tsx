import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudUpload,
  RefreshCw,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BidRaStatusTab } from './components/BidRaStatusTab';
import { BidSearchTab } from './components/BidSearchTab';
import { DashboardTab } from './components/DashboardTab';
import { EmdBgFormModal } from './components/EmdBgFormModal';
import { EmdBgTab } from './components/EmdBgTab';
import { Header, type CloudUserSummary } from './components/Header';
import { LoginPage } from './components/LoginPage';
import { MafItemModal } from './components/MafItemModal';
import { MafStatusTab } from './components/MafStatusTab';
import { MafTrackerFormModal } from './components/MafTrackerFormModal';
import { OemDetailsTab } from './components/OemDetailsTab';
import { OemFormModal } from './components/OemFormModal';
import { SettingsTab } from './components/SettingsTab';
import { Sidebar } from './components/Sidebar';
import { TenderDetailDrawer } from './components/TenderDetailDrawer';
import { TenderFormModal } from './components/TenderFormModal';
import { TendersTab } from './components/TendersTab';
import {
  DEFAULT_FIRM_PROFILE,
  SEED_EMD_RECORDS,
  SEED_MAF_TRACKERS,
  SEED_OEM_DETAILS,
  SEED_TENDERS,
} from './data/seedData';
import {
  clearByocConfig,
  disposeByocContext,
  getOrInitByocContext,
  loadByocConfig,
  saveByocConfig,
  signInWithByocGoogle,
  signOutByocGoogle,
  subscribeByocAuthState,
  testByocFirebaseConnection,
  validateByocFirebaseConfig,
  type ByocCloudContext,
} from './lib/byocFirebase';
import { auth, firebaseConfig, googleProvider } from './lib/firebase';
import type {
  ByocConnectionState,
  ByocFirebaseConfig,
  CrmBackupPayload,
  CrmUserSession,
  EmailAlertLog,
  EmailAlertSettings,
  EmailReminderSlot,
  EmdBgRecord,
  FirmProfile,
  GoogleSheetSettings,
  MafItemStatus,
  MafLineItem,
  MafTrackerRecord,
  NotificationItem,
  OemRecord,
  SecondaryUserSummary,
  SheetSyncAction,
  SheetSyncEntityType,
  SheetSyncStatus,
  TabKey,
  Tender,
  UserPreferences,
} from './types/crm';
import {
  ADMIN_RECOVERY_EMAIL,
  ADMIN_USER_ID,
  buildEmptySecondaryWorkspace,
  deduplicateSecondaryUsers,
  getAllStoredCredentialTokens,
  getStoredCredentialToken,
  listSecondaryUsers,
  loadSecondaryWorkspaceSnapshot,
  recordUserLoginActivity,
  saveResetPasswordCredential,
  saveSecondaryWorkspaceSnapshot,
  setSecondaryUserEnabled,
  type SecondaryWorkspaceSnapshot,
} from './utils/authCredentials';
import {
  isTenderDuePassed,
  partitionTendersByDueDate,
} from './utils/bidRaStatus';
import { computeNotifications } from './utils/calculations';
import {
  backupAllToCloud,
  clearCloudSessionCache,
  type CloudTargetContext,
  type CloudWorkspaceDataset,
  createEmptyCloudDataset,
  ensureUserRootDocument,
  fetchAdminCloudWorkspaceWithFallback,
  fetchAdminLegacyFallbackWorkspace,
  fetchAllFromCloud,
  fetchCoreCloudWorkspaceFast,
  fetchMissingAttachmentsBackground,
  fetchSecondaryUsersFromCloud,
  getCentralAdminCloudTarget,
  mergeCloudDatasets,
  replaceCloudDataset,
  subscribeToUserCloudData,
  syncAttachmentFilesToCloud,
  syncDeltaBatchToCloud,
  syncEmailAlertLogToCloud,
  syncSecondaryUserToCloud,
  uploadMafDocumentFile,
} from './utils/cloudSync';
import {
  mergeAdminAttachmentMaps,
  mergeAdminRecordsById,
  mergeCloudEmdWithFiles,
  mergeCloudMafTrackersWithFiles,
  mergeCloudProfileWithLocal,
  mergeCloudTendersWithFiles,
  sanitizeDocId,
} from './utils/cloudSyncHelpers';
import {
  buildDeltaSyncScopeKey,
  collectMissingAttachmentIds,
  createDebouncedDeltaScheduler,
  createEmptyDirtySnapshot,
  DEFAULT_SYNC_DEBOUNCE_MS,
  DEFAULT_SYNC_MAX_WAIT_MS,
  hasDirtyOperations,
  isLegacyFallbackScanDue,
  loadDeltaSyncManifest,
  mergeDirtySnapshots,
  reconcileRemoteRecordsWithPendingLocal,
  subtractDirtySnapshots,
  type DebouncedSyncScheduler,
  type DeltaEntityCollectionKey,
  type DeltaSingletonKey,
  type DirtySyncSnapshot,
} from './utils/deltaSync';
import {
  buildTenderEmailMessage,
  computePendingEmailAlerts,
  DEFAULT_EMAIL_ALERT_SETTINGS,
  formatSlotLabel,
  recordEmailDispatchFailure,
  shouldAttemptEmailDispatch,
  type EmailRetryRecord,
} from './utils/emailAlerts';
import {
  buildSheetSyncPayload,
  DEFAULT_GOOGLE_SHEET_SETTINGS,
  isValidAppsScriptWebhookUrl,
} from './utils/googleSheetSync';
import { safeReadJsonResponse } from './utils/httpHelpers';
import {
  buildTenderAttachmentExtractionSignature,
  evaluateTenderMafAttachmentGate,
  mergeAutoMafIntoTrackers,
  type ExtractedSpecItem,
} from './utils/mafAutoGenerate';
import { findMatchingDailyTender } from './utils/mafCalculations';
import {
  clearPerTabCrmSession,
  getRemainingCrmSessionMs,
  isCrmSessionExpired,
  loadValidPerTabCrmSession,
  savePerTabCrmSession,
  updatePerTabActiveTab,
} from './utils/sessionStorageAuth';
import { estimateCloudStorageUsage } from './utils/storageUsage';

interface ToastNotice {
  id: string;
  type: 'ok' | 'err';
  msg: string;
}

function formatCloudErrorMessage(
  err: unknown,
  projectIdOverride?: string,
  databaseIdOverride?: string,
): string {
  const raw = err instanceof Error ? err.message : String(err);
  let parsedErrorText = raw;
  let parsedOp = '';
  let parsedPath = '';
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as {
        error?: string;
        operationType?: string;
        path?: string;
      };
      if (typeof parsed.error === 'string') parsedErrorText = parsed.error;
      if (typeof parsed.operationType === 'string') parsedOp = parsed.operationType;
      if (typeof parsed.path === 'string') parsedPath = parsed.path;
    } catch {
      // Keep raw string
    }
  }

  if (
    parsedErrorText.includes('BYOC_NOT_CONFIGURED') ||
    parsedErrorText.includes('BYOC_PROJECT_CONFLICT')
  ) {
    return 'BYOC isolation active: Connect your own Firebase project in Workspace Settings to sync this secondary account to the cloud.';
  }

  if (parsedErrorText.includes("Quota exceeded for quota metric 'Free daily read units per project")) {
    const pid = projectIdOverride || firebaseConfig.projectId;
    const dbid = databaseIdOverride || firebaseConfig.firestoreDatabaseId || '(default)';
    return `Firestore daily read quota reached. Upgrade or check usage at https://console.firebase.google.com/project/${encodeURIComponent(pid)}/firestore/databases/${encodeURIComponent(dbid)}/data?openUpgradeDialog=true`;
  }
  if (parsedErrorText.includes('Quota exceeded')) {
    return 'Google Cloud Firestore daily free-tier quota exceeded. Quota resets tomorrow.';
  }
  if (parsedErrorText.includes('auth/unauthorized-domain')) {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
    return `Google Sign-In is blocked for "${host}". Add "${host}" in Firebase Console -> Authentication -> Settings -> Authorized domains.`;
  }
  if (parsedErrorText.includes('auth/popup-closed-by-user')) {
    return 'Google Sign-In popup was closed before completing authentication.';
  }
  if (parsedErrorText.includes('auth/popup-blocked')) {
    return 'Sign-In popup was blocked by your browser. Please allow popups for this site.';
  }
  if (parsedErrorText.includes('auth/operation-not-allowed')) {
    return 'Google Sign-In provider is not enabled in Firebase Authentication settings.';
  }
  if (
    parsedErrorText.includes('auth/network-request-failed') ||
    parsedErrorText.includes('unavailable') ||
    parsedErrorText.includes('the client is offline')
  ) {
    return 'Unable to reach Firebase Cloud right now. Please check your internet connection and retry.';
  }
  if (
    parsedErrorText.includes('permission-denied') ||
    parsedErrorText.includes('Missing or insufficient permissions')
  ) {
    const pathHint = parsedPath ? ` (${parsedPath})` : '';
    return `Cloud sync permission denied${parsedOp ? ` during ${parsedOp}` : ''}${pathHint}. Please sign out and sign in again with a verified Google account.`;
  }
  if (parsedErrorText.includes('failed-precondition')) {
    return 'Firestore database index or precondition is missing. Please retry sync in a moment.';
  }
  return 'Could not sync with Firebase Firestore. Please check your connection and try again.';
}

export default function App() {
  const initialTabBoot = useMemo(() => {
    const loaded = loadValidPerTabCrmSession();
    if (loaded.status !== 'valid') {
      return {
        valid: null,
        expiredSession: loaded.status === 'expired' ? loaded.expiredSession : null,
        secondarySnapshot: null as SecondaryWorkspaceSnapshot | null,
        byocConfig: null as ByocFirebaseConfig | null,
      };
    }

    const { session } = loaded.data;
    let secondarySnapshot: SecondaryWorkspaceSnapshot | null = null;
    let initialByoc: ByocFirebaseConfig | null = null;
    if (session.role === 'secondary') {
      secondarySnapshot =
        loadSecondaryWorkspaceSnapshot(session.userId) ?? buildEmptySecondaryWorkspace(session);
      initialByoc =
        (session.byocConfig && validateByocFirebaseConfig(session.byocConfig).valid
          ? session.byocConfig
          : null) || loadByocConfig(session.userId);
    }
    return {
      valid: loaded.data,
      expiredSession: null as CrmUserSession | null,
      secondarySnapshot,
      byocConfig: initialByoc,
    };
  }, []);

  const initialSecSnap = initialTabBoot.secondarySnapshot;
  const initialSheetCfg = initialSecSnap?.sheetSettings ?? DEFAULT_GOOGLE_SHEET_SETTINGS;

  const [tenders, setTenders] = useState<Tender[]>(
    initialSecSnap ? initialSecSnap.tenders : SEED_TENDERS,
  );
  const [emdRecords, setEmdRecords] = useState<EmdBgRecord[]>(
    initialSecSnap ? initialSecSnap.emdRecords : SEED_EMD_RECORDS,
  );
  const [mafTrackers, setMafTrackers] = useState<MafTrackerRecord[]>(
    initialSecSnap ? initialSecSnap.mafTrackers : SEED_MAF_TRACKERS,
  );
  const [oemRecords, setOemRecords] = useState<OemRecord[]>(
    initialSecSnap ? (initialSecSnap.oemRecords ?? []) : SEED_OEM_DETAILS,
  );
  const [firmProfile, setFirmProfile] = useState<FirmProfile>(
    initialSecSnap ? initialSecSnap.firmProfile : DEFAULT_FIRM_PROFILE,
  );
  const [adminPin, setAdminPin] = useState<string>(
    initialSecSnap ? initialSecSnap.preferences.adminPin : '1234',
  );
  const [darkMode, setDarkMode] = useState<boolean>(
    initialSecSnap ? initialSecSnap.preferences.darkMode : false,
  );
  const [emailSettings, setEmailSettings] = useState<EmailAlertSettings>(
    initialSecSnap ? initialSecSnap.emailSettings : DEFAULT_EMAIL_ALERT_SETTINGS,
  );
  const [emailLogs, setEmailLogs] = useState<EmailAlertLog[]>(
    initialSecSnap ? initialSecSnap.emailLogs : [],
  );
  const [emailGatewayInfo, setEmailGatewayInfo] = useState<{
    automatedConfigured: boolean;
    provider: string;
  }>({ automatedConfigured: false, provider: 'none' });
  const [sheetSettings, setSheetSettings] = useState<GoogleSheetSettings>(initialSheetCfg);
  const [sheetSyncStatus, setSheetSyncStatus] = useState<SheetSyncStatus>(
    initialSheetCfg.webhookUrl ? (initialSheetCfg.lastSyncedAt ? 'synced' : 'idle') : 'unconfigured',
  );
  const [sheetSyncError, setSheetSyncError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>(
    initialTabBoot.valid?.activeTab ?? 'dashboard',
  );
  const [isAuthenticated, setIsAuthenticated] = useState(Boolean(initialTabBoot.valid));
  const [currentUser, setCurrentUser] = useState<CrmUserSession | null>(
    initialTabBoot.valid?.session ?? null,
  );
  const [adminSessionToken, setAdminSessionToken] = useState(
    initialTabBoot.valid?.adminSessionToken ?? '',
  );
  const [sessionLoginAtMs, setSessionLoginAtMs] = useState<number | null>(
    initialTabBoot.valid?.loginAtMs ?? null,
  );
  const [secondaryUsers, setSecondaryUsers] = useState<SecondaryUserSummary[]>([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const workspaceTenantId = currentUser?.role === 'secondary' ? currentUser.userId : null;
  const isSecondarySession = currentUser?.role === 'secondary';

  // Firebase Firestore State (Central Admin + Isolated BYOC Secondary)
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [byocConfig, setByocConfig] = useState<ByocFirebaseConfig | null>(
    initialTabBoot.byocConfig,
  );
  const [byocConnection, setByocConnection] = useState<ByocConnectionState>({
    status: initialTabBoot.byocConfig ? 'auth_required' : 'pending',
    message: initialTabBoot.byocConfig
      ? `BYOC config loaded for "${initialTabBoot.byocConfig.projectId}". Click "Connect Google Account" in Settings if prompted.`
      : 'Save your personal Firebase config to enable isolated BYOC cloud sync.',
    ...(initialTabBoot.byocConfig
      ? {
          projectId: initialTabBoot.byocConfig.projectId,
          databaseId: initialTabBoot.byocConfig.firestoreDatabaseId || '(default)',
        }
      : {}),
  });
  const [byocContextState, setByocContextState] = useState<ByocCloudContext | null>(null);
  const [byocAuthUser, setByocAuthUser] = useState<User | null>(null);
  const [byocAuthReady, setByocAuthReady] = useState(false);
  const [disabledNotice, setDisabledNotice] = useState<string | null>(
    initialTabBoot.expiredSession
      ? 'Your 15-minute CRM session has expired. Please sign in again.'
      : null,
  );
  const [togglingSecondaryUserId, setTogglingSecondaryUserId] = useState<string | null>(null);

  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [lastCloudSyncAt, setLastCloudSyncAt] = useState<string | null>(null);
  const [cloudFeedback, setCloudFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(
    null,
  );
  const [toasts, setToasts] = useState<ToastNotice[]>([]);

  const savedByocValid = validateByocFirebaseConfig(byocConfig).valid;
  const activeCloudUser: User | null = isSecondarySession
    ? byocContextState && savedByocValid
      ? byocAuthUser
      : null
    : firebaseUser;
  const activeAuthReady: boolean = isSecondarySession
    ? byocContextState
      ? byocAuthReady
      : true
    : authReady;
  const activeCloudTarget: CloudTargetContext | null = isSecondarySession
    ? byocContextState && savedByocValid
      ? {
          db: byocContextState.db,
          storage: byocContextState.storage,
          projectId: byocContextState.config.projectId,
          databaseId: byocContextState.config.firestoreDatabaseId,
          isByoc: true,
          role: 'secondary',
        }
      : null
    : getCentralAdminCloudTarget();

  // Modal & Drawer states
  const [tenderModalTarget, setTenderModalTarget] = useState<Tender | null | undefined>(
    undefined, // undefined = closed, null = new, Tender = edit
  );
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
  const [selectedBidRaTenderId, setSelectedBidRaTenderId] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [emdModalTarget, setEmdModalTarget] = useState<EmdBgRecord | null | undefined>(
    undefined,
  );
  const [mafTrackerModalTarget, setMafTrackerModalTarget] = useState<
    MafTrackerRecord | null | undefined
  >(undefined);
  const [mafItemModalTarget, setMafItemModalTarget] = useState<{
    tracker: MafTrackerRecord;
    item: MafLineItem | null;
  } | null>(null);
  const [oemModalTarget, setOemModalTarget] = useState<OemRecord | null | undefined>(undefined);

  // In-memory refs for async Firestore listeners, admin offline snapshot, and attachment payloads
  const attachmentFilesRef = useRef<Map<string, string>>(new Map());
  const dispatchedEmailKeysRef = useRef<Set<string>>(new Set());
  const emailRetryStateRef = useRef<Map<string, EmailRetryRecord>>(new Map());
  const mafExtractionSignatureRef = useRef<Map<string, string>>(new Map());
  const mafExtractionInFlightRef = useRef<Set<string>>(new Set());
  const localWorkspaceClearedRef = useRef<boolean>(false);
  const adminOfflineSnapshotRef = useRef<SecondaryWorkspaceSnapshot | null>(null);
  const adminSupplementalRef = useRef<CloudWorkspaceDataset>(createEmptyCloudDataset());
  const activeRoleRef = useRef<'admin' | 'secondary' | null>(
    initialTabBoot.valid?.session.role ?? null,
  );
  const activeCrmUserIdRef = useRef<string | null>(
    initialTabBoot.valid?.session.userId ?? null,
  );
  const activeCloudSyncCountRef = useRef<number>(0);
  const cloudWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const backgroundAttachmentTaskSeqRef = useRef<number>(0);
  const deltaSchedulerRef = useRef<DebouncedSyncScheduler | null>(null);
  const failedDirtyRef = useRef<DirtySyncSnapshot>(createEmptyDirtySnapshot());

  const getPendingEntityIds = (
    collection: DeltaEntityCollectionKey,
  ): { upsertIds: Set<string>; deleteIds: Set<string> } => {
    const active = deltaSchedulerRef.current?.getProtectedSnapshot() ?? createEmptyDirtySnapshot();
    const combined = mergeDirtySnapshots(failedDirtyRef.current, active);
    return {
      upsertIds: new Set(combined[collection].upserts.map((id) => sanitizeDocId(id))),
      deleteIds: new Set(combined[collection].deletes.map((id) => sanitizeDocId(id))),
    };
  };

  const isSingletonPending = (singleton: DeltaSingletonKey): boolean => {
    const active = deltaSchedulerRef.current?.getProtectedSnapshot() ?? createEmptyDirtySnapshot();
    return (
      failedDirtyRef.current.singletons.includes(singleton) ||
      active.singletons.includes(singleton)
    );
  };

  const beginCloudSync = () => {
    activeCloudSyncCountRef.current += 1;
    setCloudSyncing(true);
  };

  const endCloudSync = () => {
    activeCloudSyncCountRef.current = Math.max(0, activeCloudSyncCountRef.current - 1);
    setCloudSyncing(activeCloudSyncCountRef.current > 0);
  };

  const enqueueCloudOperation = <T,>(operation: () => Promise<T>): Promise<T> => {
    const next = cloudWriteQueueRef.current.then(operation, operation);
    cloudWriteQueueRef.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const stateRef = useRef({
    tenders,
    emdRecords,
    mafTrackers,
    oemRecords,
    firmProfile,
    adminPin,
    darkMode,
    emailSettings,
    emailLogs,
    sheetSettings,
    firebaseUser,
    activeCloudUser,
    activeCloudTarget,
    byocConfig,
    currentUser,
    workspaceTenantId,
  });
  useEffect(() => {
    stateRef.current = {
      tenders,
      emdRecords,
      mafTrackers,
      oemRecords,
      firmProfile,
      adminPin,
      darkMode,
      emailSettings,
      emailLogs,
      sheetSettings,
      firebaseUser,
      activeCloudUser,
      activeCloudTarget,
      byocConfig,
      currentUser,
      workspaceTenantId,
    };
  }, [
    tenders,
    emdRecords,
    mafTrackers,
    oemRecords,
    firmProfile,
    adminPin,
    darkMode,
    emailSettings,
    emailLogs,
    sheetSettings,
    firebaseUser,
    activeCloudUser,
    activeCloudTarget,
    byocConfig,
    currentUser,
    workspaceTenantId,
  ]);

  const mergeEmailLogs = (
    incoming: EmailAlertLog[],
    existing: EmailAlertLog[],
  ): EmailAlertLog[] => {
    const byKey = new Map<string, EmailAlertLog>();
    for (const item of [...incoming, ...existing]) {
      if (item.slot !== 'test' && item.slot !== 'manual' && item.slotKey && item.status === 'sent') {
        dispatchedEmailKeysRef.current.add(item.slotKey);
      }
      const dedupeKey =
        item.slot === 'test' || item.slot === 'manual'
          ? `id:${item.id}`
          : `sk:${item.slotKey || item.id}`;
      if (!byKey.has(dedupeKey)) {
        byKey.set(dedupeKey, item);
      }
    }
    return Array.from(byKey.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 200);
  };

  // Apply Dark Mode class on root element (no localStorage)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // Notify backend once if a restored tab session already passed its 15-minute ceiling
  useEffect(() => {
    if (!initialTabBoot.expiredSession) return;
    void fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: initialTabBoot.expiredSession.userId,
        identifier: initialTabBoot.expiredSession.username,
      }),
    }).catch(() => {});
  }, [initialTabBoot.expiredSession]);

  // Persist active tab across page refreshes within the same tab without extending loginAtMs
  useEffect(() => {
    if (!isAuthenticated) return;
    updatePerTabActiveTab(activeTab);
  }, [isAuthenticated, activeTab]);

  // Validate per-tab session when browser restores from bfcache or reloads
  useEffect(() => {
    const handlePageShow = () => {
      const check = loadValidPerTabCrmSession();
      if (check.status !== 'valid') {
        if (stateRef.current.currentUser) {
          handleLogout(
            check.status === 'expired'
              ? 'Your 15-minute CRM session has expired. Please sign in again.'
              : undefined,
          );
        } else {
          setIsAuthenticated(false);
          setSessionLoginAtMs(null);
        }
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  // Enforce strict 15-minute max session duration from initial login timestamp
  useEffect(() => {
    if (!isAuthenticated || !currentUser || sessionLoginAtMs === null) return;

    const enforceTimeout = () => {
      if (isCrmSessionExpired(sessionLoginAtMs, Date.now())) {
        handleLogout('Your 15-minute CRM session has expired. Please sign in again.');
        return true;
      }
      return false;
    };

    if (enforceTimeout()) return;

    const remainingMs = getRemainingCrmSessionMs(sessionLoginAtMs, Date.now());
    const exactTimer = window.setTimeout(() => {
      enforceTimeout();
    }, remainingMs + 50);

    const pollTimer = window.setInterval(() => {
      enforceTimeout();
    }, 5_000);

    const onFocusOrVisible = () => {
      if (document.visibilityState === 'visible') {
        enforceTimeout();
      }
    };

    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    return () => {
      window.clearTimeout(exactTimer);
      window.clearInterval(pollTimer);
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
  }, [isAuthenticated, currentUser?.userId, sessionLoginAtMs]);

  const showToast = (type: 'ok' | 'err', msg: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-3), { id, type, msg }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3800);
  };

  const markSyncedNow = () => {
    setLastCloudSyncAt(new Date().toISOString());
  };

  // Listen for central Firebase Auth state (used exclusively by Primary Admin)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Dynamically initialize and listen to per-user BYOC Firebase Auth state (Secondary Users only)
  useEffect(() => {
    if (!isAuthenticated || currentUser?.role !== 'secondary') {
      setByocContextState(null);
      setByocAuthUser(null);
      setByocAuthReady(true);
      return;
    }
    const validation = validateByocFirebaseConfig(byocConfig);
    if (!validation.valid) {
      setByocContextState(null);
      setByocAuthUser(null);
      setByocAuthReady(true);
      setByocConnection({
        status: 'pending',
        message: 'Save your personal Firebase config to enable isolated BYOC cloud sync.',
      });
      return;
    }

    let cancelled = false;
    let unsubByocAuth: (() => void) | null = null;
    setByocAuthReady(false);

    void (async () => {
      try {
        const ctx = await getOrInitByocContext(currentUser.userId, validation.normalized);
        if (cancelled) return;
        setByocContextState(ctx);
        unsubByocAuth = subscribeByocAuthState(ctx, (u) => {
          if (cancelled) return;
          setByocAuthUser(u);
          setByocAuthReady(true);
          if (u) {
            setByocConnection({
              status: 'connected',
              message: `Connected & isolated: "${ctx.config.projectId}" (${ctx.config.firestoreDatabaseId || '(default)'}) as ${u.email || u.uid}.`,
              projectId: ctx.config.projectId,
              databaseId: ctx.config.firestoreDatabaseId || '(default)',
              verifiedAt: ctx.config.verifiedAt || new Date().toISOString(),
            });
          } else {
            setByocConnection({
              status: 'auth_required',
              message: `BYOC config saved for "${ctx.config.projectId}". Click "Connect Google Account" to sign in.`,
              projectId: ctx.config.projectId,
              databaseId: ctx.config.firestoreDatabaseId || '(default)',
            });
          }
        });
      } catch (err) {
        if (!cancelled) {
          setByocContextState(null);
          setByocAuthUser(null);
          setByocAuthReady(true);
          setByocConnection({
            status: 'error',
            message: err instanceof Error ? err.message : 'Unable to initialize BYOC Firebase app.',
            projectId: validation.normalized.projectId,
            databaseId: validation.normalized.firestoreDatabaseId || '(default)',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      if (unsubByocAuth) unsubByocAuth();
    };
  }, [isAuthenticated, currentUser?.userId, currentUser?.role, byocConfig]);

  // Debounced dirty-entity delta batch sync scheduler (coalesces rapid edits into 1 writeBatch commit)
  useEffect(() => {
    const scheduler = createDebouncedDeltaScheduler({
      debounceMs: DEFAULT_SYNC_DEBOUNCE_MS,
      maxWaitMs: DEFAULT_SYNC_MAX_WAIT_MS,
      onFlush: async (dirty) => {
        const curState = stateRef.current;
        const user = curState.activeCloudUser;
        const target = curState.activeCloudTarget;
        if (!user || !target) return;
        if (curState.currentUser?.role === 'secondary' && !target.isByoc) return;
        if (localWorkspaceClearedRef.current) return;

        const effectiveDirty = mergeDirtySnapshots(failedDirtyRef.current, dirty);
        if (!hasDirtyOperations(effectiveDirty)) return;

        // Capture snapshot synchronously so rapid logout/account-switch flushes preserve exact user/target/data
        const snapshot = {
          user,
          target,
          tenders: curState.tenders,
          emdRecords: curState.emdRecords,
          mafTrackers: curState.mafTrackers,
          oemRecords: curState.oemRecords,
          profile: curState.firmProfile,
          preferences: { adminPin: curState.adminPin, darkMode: curState.darkMode },
          emailConfig: curState.emailSettings,
          sheetConfig: curState.sheetSettings,
          workspaceTenantId: curState.workspaceTenantId,
        };

        beginCloudSync();
        try {
          const result = await enqueueCloudOperation(() =>
            syncDeltaBatchToCloud({
              user: snapshot.user,
              dirty: effectiveDirty,
              tenders: snapshot.tenders,
              emdRecords: snapshot.emdRecords,
              mafTrackers: snapshot.mafTrackers,
              oemRecords: snapshot.oemRecords,
              profile: snapshot.profile,
              preferences: snapshot.preferences,
              emailConfig: snapshot.emailConfig,
              sheetConfig: snapshot.sheetConfig,
              workspaceTenantId: snapshot.workspaceTenantId,
              target: snapshot.target,
              deferAttachmentsToBackground: true,
            }),
          );
          failedDirtyRef.current = subtractDirtySnapshots(
            failedDirtyRef.current,
            effectiveDirty,
          );
          markSyncedNow();
          if (!hasDirtyOperations(failedDirtyRef.current)) {
            setCloudFeedback((prev) => (prev?.type === 'err' ? null : prev));
          }

          // Upload heavy base64 attachment payloads asynchronously in background without blocking UI
          if (result.deferredAttachments.length > 0) {
            window.setTimeout(() => {
              void enqueueCloudOperation(() =>
                syncAttachmentFilesToCloud(
                  snapshot.user,
                  result.deferredAttachments,
                  snapshot.workspaceTenantId,
                  snapshot.target,
                ),
              )
                .then(() => {
                  markSyncedNow();
                })
                .catch((err) => {
                  setCloudFeedback({
                    type: 'err',
                    msg: formatCloudErrorMessage(
                      err,
                      snapshot.target.projectId,
                      snapshot.target.databaseId,
                    ),
                  });
                });
            }, 40);
          }
        } catch (err) {
          failedDirtyRef.current = mergeDirtySnapshots(failedDirtyRef.current, effectiveDirty);
          setCloudFeedback({
            type: 'err',
            msg: formatCloudErrorMessage(err, snapshot.target.projectId, snapshot.target.databaseId),
          });
        } finally {
          endCloudSync();
        }
      },
    });
    deltaSchedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      if (deltaSchedulerRef.current === scheduler) {
        deltaSchedulerRef.current = null;
      }
    };
  }, []);

  const queueEntityUpsert = (collection: DeltaEntityCollectionKey, id: string) => {
    if (!stateRef.current.activeCloudUser || !stateRef.current.activeCloudTarget) return;
    localWorkspaceClearedRef.current = false;
    deltaSchedulerRef.current?.markUpsert(collection, id);
  };

  const queueEntityDelete = (collection: DeltaEntityCollectionKey, id: string) => {
    if (!stateRef.current.activeCloudUser || !stateRef.current.activeCloudTarget) return;
    if (localWorkspaceClearedRef.current) return;
    deltaSchedulerRef.current?.markDelete(collection, id);
  };

  const queueSingletonDeltaSync = (singleton: DeltaSingletonKey) => {
    if (!stateRef.current.activeCloudUser || !stateRef.current.activeCloudTarget) return;
    deltaSchedulerRef.current?.markSingleton(singleton);
  };

  const scheduleBackgroundAttachmentHydration = (params: {
    cloudUid: string;
    tenantId: string | null;
    target: CloudTargetContext;
    tendersList: Tender[];
    emdList: EmdBgRecord[];
    mafList: MafTrackerRecord[];
    shouldCancel?: () => boolean;
  }) => {
    const missingIds = collectMissingAttachmentIds({
      tenders: params.tendersList,
      emdRecords: params.emdList,
      mafTrackers: params.mafList,
      loadedAttachmentFiles: attachmentFilesRef.current,
    });
    if (missingIds.length === 0) return;

    const seq = ++backgroundAttachmentTaskSeqRef.current;
    window.setTimeout(() => {
      if (params.shouldCancel?.() || backgroundAttachmentTaskSeqRef.current !== seq) return;
      void fetchMissingAttachmentsBackground({
        uid: params.cloudUid,
        attachmentIds: missingIds,
        workspaceTenantId: params.tenantId,
        target: params.target,
        shouldCancel: () =>
          Boolean(params.shouldCancel?.()) ||
          backgroundAttachmentTaskSeqRef.current !== seq ||
          localWorkspaceClearedRef.current,
        onBatchLoaded: (batchMap) => {
          if (batchMap.size === 0) return;
          for (const [k, v] of batchMap.entries()) {
            attachmentFilesRef.current.set(k, v);
          }
          const filesSnapshot = attachmentFilesRef.current;
          setTenders((prev) => mergeCloudTendersWithFiles(prev, filesSnapshot, prev));
          setEmdRecords((prev) => mergeCloudEmdWithFiles(prev, filesSnapshot, prev));
          setMafTrackers((prev) => mergeCloudMafTrackersWithFiles(prev, filesSnapshot, prev));
          markSyncedNow();
        },
      });
    }, 60);
  };

  // Persist isolated secondary user workspace offline without affecting Admin or clearing localStorage
  useEffect(() => {
    if (!isAuthenticated || currentUser?.role !== 'secondary') return;
    saveSecondaryWorkspaceSnapshot(currentUser.userId, {
      firmProfile,
      preferences: { adminPin, darkMode },
      tenders,
      emdRecords,
      mafTrackers,
      oemRecords,
      emailSettings,
      emailLogs,
      sheetSettings,
      updatedAt: new Date().toISOString(),
    });
  }, [
    isAuthenticated,
    currentUser?.userId,
    currentUser?.role,
    firmProfile,
    adminPin,
    darkMode,
    tenders,
    emdRecords,
    mafTrackers,
    oemRecords,
    emailSettings,
    emailLogs,
    sheetSettings,
  ]);

  // Initial Firestore load/seed + real-time Firestore subscription when authenticated
  useEffect(() => {
    if (
      !isAuthenticated ||
      !currentUser ||
      !activeAuthReady ||
      !activeCloudUser ||
      !activeCloudTarget
    ) {
      return;
    }

    const activeTenantId = currentUser.role === 'secondary' ? currentUser.userId : null;
    const targetRef = activeCloudTarget;
    const cloudUid = activeCloudUser.uid;
    let cancelled = false;
    let unsubCloud: (() => void) | null = null;

    const initializeFirestoreSession = async () => {
      // Secondary users MUST ONLY use BYOC (never central Admin Firebase project or Admin Google account)
      if (currentUser.role === 'secondary') {
        if (!targetRef.isByoc || targetRef.projectId.toLowerCase() === firebaseConfig.projectId.toLowerCase()) {
          return;
        }
        if ((activeCloudUser.email || '').trim().toLowerCase() === ADMIN_RECOVERY_EMAIL.toLowerCase()) {
          await signOutByocGoogle(currentUser.userId).catch(() => {});
          clearCloudSessionCache();
          if (!cancelled) {
            setCloudFeedback({
              type: 'err',
              msg: 'Admin Google account cannot be linked to a secondary user workspace. Please sign in with your own Google account.',
            });
          }
          return;
        }
      }

      localWorkspaceClearedRef.current = false;
      let didBeginSync = false;
      beginCloudSync();
      didBeginSync = true;
      try {
        const loadedCoreCloud: CloudWorkspaceDataset | null = await enqueueCloudOperation(async () => {
          await ensureUserRootDocument(activeCloudUser, activeTenantId, currentUser, targetRef);
          if (cancelled) return null;

          adminSupplementalRef.current = createEmptyCloudDataset();
          // Fast foreground load: read core collections in parallel via persistent cache + delta query
          // without blocking initial UI rendering on heavy attachment blobs or Admin's legacy scan.
          const cloud = await fetchCoreCloudWorkspaceFast(cloudUid, activeTenantId, targetRef);
          if (cancelled) return null;

          const cloudIsEmpty =
            !cloud.profile &&
            !cloud.preferences &&
            cloud.tenders.length === 0 &&
            cloud.emdRecords.length === 0 &&
            cloud.mafTrackers.length === 0 &&
            cloud.oemRecords.length === 0;

          if (cloudIsEmpty) {
            if (currentUser.role === 'admin') {
              // On an empty primary UID doc, check legacy Admin fallback once before seeding
              const adminWorkspace = await fetchAdminCloudWorkspaceWithFallback(activeCloudUser);
              if (cancelled) return null;
              adminSupplementalRef.current = adminWorkspace.supplemental;
              const combined = adminWorkspace.merged;
              const fallbackHasData =
                Boolean(combined.profile) ||
                Boolean(combined.preferences) ||
                combined.tenders.length > 0 ||
                combined.emdRecords.length > 0 ||
                combined.mafTrackers.length > 0 ||
                combined.oemRecords.length > 0;
              if (fallbackHasData) {
                attachmentFilesRef.current = combined.attachmentFiles;
                if (combined.profile && !isSingletonPending('profile')) {
                  setFirmProfile((prev) => mergeCloudProfileWithLocal(combined.profile!, prev));
                }
                if (combined.preferences && !isSingletonPending('preferences')) {
                  setAdminPin(combined.preferences.adminPin);
                  setDarkMode(combined.preferences.darkMode);
                }
                if (combined.emailConfig && !isSingletonPending('emailConfig')) {
                  setEmailSettings(combined.emailConfig);
                }
                if (combined.sheetConfig && !isSingletonPending('sheetConfig')) {
                  setSheetSettings(combined.sheetConfig);
                  setSheetSyncStatus(
                    combined.sheetConfig.webhookUrl
                      ? combined.sheetConfig.lastSyncedAt
                        ? 'synced'
                        : 'idle'
                      : 'unconfigured',
                  );
                }
                if (combined.emailAlerts.length > 0) {
                  setEmailLogs((prev) => mergeEmailLogs(combined.emailAlerts, prev));
                }
                setTenders((prev) => {
                  const { upsertIds, deleteIds } = getPendingEntityIds('tenders');
                  const merged = mergeCloudTendersWithFiles(
                    combined.tenders,
                    combined.attachmentFiles,
                    prev,
                  );
                  return reconcileRemoteRecordsWithPendingLocal({
                    remoteRecords: merged,
                    currentLocalRecords: prev,
                    pendingUpsertIds: upsertIds,
                    pendingDeleteIds: deleteIds,
                  });
                });
                setEmdRecords((prev) => {
                  const { upsertIds, deleteIds } = getPendingEntityIds('emdRecords');
                  const merged = mergeCloudEmdWithFiles(
                    combined.emdRecords,
                    combined.attachmentFiles,
                    prev,
                  );
                  return reconcileRemoteRecordsWithPendingLocal({
                    remoteRecords: merged,
                    currentLocalRecords: prev,
                    pendingUpsertIds: upsertIds,
                    pendingDeleteIds: deleteIds,
                  });
                });
                if (combined.mafTrackers.length > 0) {
                  setMafTrackers((prev) => {
                    const { upsertIds, deleteIds } = getPendingEntityIds('mafTrackers');
                    const merged = mergeCloudMafTrackersWithFiles(
                      combined.mafTrackers,
                      combined.attachmentFiles,
                      prev,
                    );
                    return reconcileRemoteRecordsWithPendingLocal({
                      remoteRecords: merged,
                      currentLocalRecords: prev,
                      pendingUpsertIds: upsertIds,
                      pendingDeleteIds: deleteIds,
                    });
                  });
                }
                if (combined.oemRecords.length > 0) {
                  setOemRecords((prev) => {
                    const { upsertIds, deleteIds } = getPendingEntityIds('oemRecords');
                    return reconcileRemoteRecordsWithPendingLocal({
                      remoteRecords: combined.oemRecords,
                      currentLocalRecords: prev,
                      pendingUpsertIds: upsertIds,
                      pendingDeleteIds: deleteIds,
                    });
                  });
                }
                markSyncedNow();
                if (!hasDirtyOperations(failedDirtyRef.current)) {
                  setCloudFeedback((prev) => (prev?.type === 'err' ? null : prev));
                }
                return combined;
              }
            }

            const {
              firmProfile: curProfile,
              tenders: curTenders,
              emdRecords: curEmd,
              mafTrackers: curMaf,
              oemRecords: curOems,
              adminPin: curPin,
              darkMode: curDark,
              emailSettings: curEmailSettings,
              sheetSettings: curSheetSettings,
            } = stateRef.current;
            const prefs: UserPreferences = { adminPin: curPin, darkMode: curDark };
            await backupAllToCloud(
              activeCloudUser,
              curProfile,
              prefs,
              curTenders,
              curEmd,
              curMaf,
              activeTenantId,
              targetRef,
              curOems,
              { forceFull: true, deferAttachmentsToBackground: true },
            );
            deltaSchedulerRef.current?.markSingleton('emailConfig');
            deltaSchedulerRef.current?.markSingleton('sheetConfig');
            void curEmailSettings;
            void curSheetSettings;
            if (!cancelled) {
              markSyncedNow();
              setCloudFeedback({
                type: 'ok',
                msg: `Connected as ${activeCloudUser.email} on "${targetRef.projectId}". All data is stored in your isolated Firebase workspace.`,
              });
            }
            return null;
          }

          if (cloud.profile && !isSingletonPending('profile')) {
            setFirmProfile((prev) => mergeCloudProfileWithLocal(cloud.profile!, prev));
          }
          if (cloud.preferences && !isSingletonPending('preferences')) {
            setAdminPin(cloud.preferences.adminPin);
            setDarkMode(cloud.preferences.darkMode);
          }
          if (cloud.emailConfig && !isSingletonPending('emailConfig')) {
            setEmailSettings(cloud.emailConfig);
          }
          if (cloud.sheetConfig && !isSingletonPending('sheetConfig')) {
            setSheetSettings(cloud.sheetConfig);
            setSheetSyncStatus(
              cloud.sheetConfig.webhookUrl
                ? cloud.sheetConfig.lastSyncedAt
                  ? 'synced'
                  : 'idle'
                : 'unconfigured',
            );
          }
          if (cloud.emailAlerts.length > 0) {
            setEmailLogs((prev) => mergeEmailLogs(cloud.emailAlerts, prev));
          }
          setTenders((prev) => {
            const { upsertIds, deleteIds } = getPendingEntityIds('tenders');
            const merged = mergeCloudTendersWithFiles(
              cloud.tenders,
              attachmentFilesRef.current,
              prev,
            );
            return reconcileRemoteRecordsWithPendingLocal({
              remoteRecords: merged,
              currentLocalRecords: prev,
              pendingUpsertIds: upsertIds,
              pendingDeleteIds: deleteIds,
            });
          });
          setEmdRecords((prev) => {
            const { upsertIds, deleteIds } = getPendingEntityIds('emdRecords');
            const merged = mergeCloudEmdWithFiles(
              cloud.emdRecords,
              attachmentFilesRef.current,
              prev,
            );
            return reconcileRemoteRecordsWithPendingLocal({
              remoteRecords: merged,
              currentLocalRecords: prev,
              pendingUpsertIds: upsertIds,
              pendingDeleteIds: deleteIds,
            });
          });
          if (cloud.mafTrackers.length > 0) {
            setMafTrackers((prev) => {
              const { upsertIds, deleteIds } = getPendingEntityIds('mafTrackers');
              const merged = mergeCloudMafTrackersWithFiles(
                cloud.mafTrackers,
                attachmentFilesRef.current,
                prev,
              );
              return reconcileRemoteRecordsWithPendingLocal({
                remoteRecords: merged,
                currentLocalRecords: prev,
                pendingUpsertIds: upsertIds,
                pendingDeleteIds: deleteIds,
              });
            });
          }
          if (cloud.oemRecords.length > 0) {
            setOemRecords((prev) => {
              const { upsertIds, deleteIds } = getPendingEntityIds('oemRecords');
              return reconcileRemoteRecordsWithPendingLocal({
                remoteRecords: cloud.oemRecords,
                currentLocalRecords: prev,
                pendingUpsertIds: upsertIds,
                pendingDeleteIds: deleteIds,
              });
            });
          }
          markSyncedNow();
          if (!hasDirtyOperations(failedDirtyRef.current)) {
            setCloudFeedback((prev) => (prev?.type === 'err' ? null : prev));
          }
          return cloud;
        });
        if (cancelled) return;

        // Release UI sync indicator immediately after fast core load; heavy blobs & legacy scan run in background
        if (didBeginSync) {
          endCloudSync();
          didBeginSync = false;
        }

        if (loadedCoreCloud) {
          scheduleBackgroundAttachmentHydration({
            cloudUid,
            tenantId: activeTenantId,
            target: targetRef,
            tendersList: loadedCoreCloud.tenders,
            emdList: loadedCoreCloud.emdRecords,
            mafList: loadedCoreCloud.mafTrackers,
            shouldCancel: () => cancelled,
          });
        }

        // Non-blocking background Admin legacy fallback scan (throttled via delta manifest TTL)
        const isAdminSession = currentUser.role === 'admin';
        if (isAdminSession) {
          const scopeKey = buildDeltaSyncScopeKey({
            projectId: targetRef.projectId,
            databaseId: targetRef.databaseId,
            uid: cloudUid,
            tenantId: null,
          });
          const adminManifest = loadDeltaSyncManifest({
            projectId: targetRef.projectId,
            databaseId: targetRef.databaseId,
            uid: cloudUid,
            tenantId: null,
          });
          void scopeKey;
          if (isLegacyFallbackScanDue(adminManifest.legacyScanDoneAtMs)) {
            window.setTimeout(() => {
              if (cancelled || localWorkspaceClearedRef.current) return;
              void fetchAdminLegacyFallbackWorkspace(activeCloudUser, {
                includeAttachments: false,
              })
                .then((supplemental) => {
                  if (cancelled || localWorkspaceClearedRef.current) return;
                  adminSupplementalRef.current = supplemental;
                  const hasSupplemental =
                    supplemental.tenders.length > 0 ||
                    supplemental.emdRecords.length > 0 ||
                    supplemental.mafTrackers.length > 0 ||
                    supplemental.oemRecords.length > 0 ||
                    supplemental.emailAlerts.length > 0;
                  if (!hasSupplemental) return;

                  if (supplemental.tenders.length > 0) {
                    setTenders((prev) =>
                      mergeCloudTendersWithFiles(
                        mergeAdminRecordsById(prev, supplemental.tenders),
                        attachmentFilesRef.current,
                        prev,
                      ),
                    );
                  }
                  if (supplemental.emdRecords.length > 0) {
                    setEmdRecords((prev) =>
                      mergeCloudEmdWithFiles(
                        mergeAdminRecordsById(prev, supplemental.emdRecords),
                        attachmentFilesRef.current,
                        prev,
                      ),
                    );
                  }
                  if (supplemental.mafTrackers.length > 0) {
                    setMafTrackers((prev) =>
                      mergeCloudMafTrackersWithFiles(
                        mergeAdminRecordsById(prev, supplemental.mafTrackers),
                        attachmentFilesRef.current,
                        prev,
                      ),
                    );
                  }
                  if (supplemental.oemRecords.length > 0) {
                    setOemRecords((prev) => mergeAdminRecordsById(prev, supplemental.oemRecords));
                  }
                  if (supplemental.emailAlerts.length > 0) {
                    setEmailLogs((prev) => mergeEmailLogs(supplemental.emailAlerts, prev));
                  }

                  scheduleBackgroundAttachmentHydration({
                    cloudUid,
                    tenantId: null,
                    target: targetRef,
                    tendersList: supplemental.tenders,
                    emdList: supplemental.emdRecords,
                    mafList: supplemental.mafTrackers,
                    shouldCancel: () => cancelled,
                  });
                })
                .catch(() => {
                  // Non-fatal background legacy scan failure
                });
            }, 150);
          }
        }

        unsubCloud = subscribeToUserCloudData(
          cloudUid,
          {
            onProfile: (remoteProfile) => {
              if (!isSingletonPending('profile')) {
                setFirmProfile((prev) => mergeCloudProfileWithLocal(remoteProfile, prev));
              }
              markSyncedNow();
            },
            onPreferences: (remotePrefs) => {
              if (!isSingletonPending('preferences')) {
                setAdminPin(remotePrefs.adminPin);
                setDarkMode(remotePrefs.darkMode);
              }
              markSyncedNow();
            },
            onEmailConfig: (remoteConfig) => {
              if (!isSingletonPending('emailConfig')) {
                setEmailSettings(remoteConfig);
              }
              markSyncedNow();
            },
            onSheetConfig: (remoteSheetConfig) => {
              if (!isSingletonPending('sheetConfig')) {
                setSheetSettings(remoteSheetConfig);
                setSheetSyncStatus((prev) => {
                  if (prev === 'syncing') return prev;
                  if (!remoteSheetConfig.webhookUrl) return 'unconfigured';
                  return remoteSheetConfig.lastSyncedAt ? 'synced' : 'idle';
                });
              }
              markSyncedNow();
            },
            onEmailAlerts: (remoteLogs) => {
              const combinedLogs = isAdminSession
                ? mergeAdminRecordsById(remoteLogs, adminSupplementalRef.current.emailAlerts)
                : remoteLogs;
              setEmailLogs((prev) => mergeEmailLogs(combinedLogs, prev));
              markSyncedNow();
            },
            onTenders: (remoteTenders) => {
              if (localWorkspaceClearedRef.current) return;
              const combinedTenders = isAdminSession
                ? mergeAdminRecordsById(remoteTenders, adminSupplementalRef.current.tenders)
                : remoteTenders;
              setTenders((prev) => {
                const { upsertIds, deleteIds } = getPendingEntityIds('tenders');
                const merged = mergeCloudTendersWithFiles(
                  combinedTenders,
                  attachmentFilesRef.current,
                  prev,
                );
                return reconcileRemoteRecordsWithPendingLocal({
                  remoteRecords: merged,
                  currentLocalRecords: prev,
                  pendingUpsertIds: upsertIds,
                  pendingDeleteIds: deleteIds,
                });
              });
              scheduleBackgroundAttachmentHydration({
                cloudUid,
                tenantId: activeTenantId,
                target: targetRef,
                tendersList: combinedTenders,
                emdList: stateRef.current.emdRecords,
                mafList: stateRef.current.mafTrackers,
                shouldCancel: () => cancelled,
              });
              markSyncedNow();
            },
            onEmdRecords: (remoteEmd) => {
              if (localWorkspaceClearedRef.current) return;
              const combinedEmd = isAdminSession
                ? mergeAdminRecordsById(remoteEmd, adminSupplementalRef.current.emdRecords)
                : remoteEmd;
              setEmdRecords((prev) => {
                const { upsertIds, deleteIds } = getPendingEntityIds('emdRecords');
                const merged = mergeCloudEmdWithFiles(
                  combinedEmd,
                  attachmentFilesRef.current,
                  prev,
                );
                return reconcileRemoteRecordsWithPendingLocal({
                  remoteRecords: merged,
                  currentLocalRecords: prev,
                  pendingUpsertIds: upsertIds,
                  pendingDeleteIds: deleteIds,
                });
              });
              scheduleBackgroundAttachmentHydration({
                cloudUid,
                tenantId: activeTenantId,
                target: targetRef,
                tendersList: stateRef.current.tenders,
                emdList: combinedEmd,
                mafList: stateRef.current.mafTrackers,
                shouldCancel: () => cancelled,
              });
              markSyncedNow();
            },
            onMafTrackers: (remoteMaf) => {
              if (localWorkspaceClearedRef.current) return;
              const combinedMaf = isAdminSession
                ? mergeAdminRecordsById(remoteMaf, adminSupplementalRef.current.mafTrackers)
                : remoteMaf;
              setMafTrackers((prev) => {
                const { upsertIds, deleteIds } = getPendingEntityIds('mafTrackers');
                const merged = mergeCloudMafTrackersWithFiles(
                  combinedMaf,
                  attachmentFilesRef.current,
                  prev,
                );
                return reconcileRemoteRecordsWithPendingLocal({
                  remoteRecords: merged,
                  currentLocalRecords: prev,
                  pendingUpsertIds: upsertIds,
                  pendingDeleteIds: deleteIds,
                });
              });
              scheduleBackgroundAttachmentHydration({
                cloudUid,
                tenantId: activeTenantId,
                target: targetRef,
                tendersList: stateRef.current.tenders,
                emdList: stateRef.current.emdRecords,
                mafList: combinedMaf,
                shouldCancel: () => cancelled,
              });
              markSyncedNow();
            },
            onOemRecords: (remoteOems) => {
              if (localWorkspaceClearedRef.current) return;
              const combinedOems = isAdminSession
                ? mergeAdminRecordsById(remoteOems, adminSupplementalRef.current.oemRecords)
                : remoteOems;
              if (combinedOems.length > 0 || !isAdminSession) {
                setOemRecords((prev) => {
                  const { upsertIds, deleteIds } = getPendingEntityIds('oemRecords');
                  return reconcileRemoteRecordsWithPendingLocal({
                    remoteRecords: combinedOems,
                    currentLocalRecords: prev,
                    pendingUpsertIds: upsertIds,
                    pendingDeleteIds: deleteIds,
                  });
                });
              }
              markSyncedNow();
            },
            onAttachmentFiles: (remoteFiles) => {
              if (localWorkspaceClearedRef.current) return;
              const combinedFiles = isAdminSession
                ? mergeAdminAttachmentMaps(remoteFiles, adminSupplementalRef.current.attachmentFiles)
                : remoteFiles;
              attachmentFilesRef.current = combinedFiles;
              setTenders((prev) => mergeCloudTendersWithFiles(prev, combinedFiles, prev));
              setEmdRecords((prev) => mergeCloudEmdWithFiles(prev, combinedFiles, prev));
              setMafTrackers((prev) => mergeCloudMafTrackersWithFiles(prev, combinedFiles, prev));
              markSyncedNow();
            },
            onError: (err) => {
              setCloudFeedback({
                type: 'err',
                msg: formatCloudErrorMessage(err, targetRef.projectId, targetRef.databaseId),
              });
            },
          },
          activeTenantId,
          targetRef,
          { includeAttachments: false },
        );
      } catch (err) {
        if (!cancelled) {
          setCloudFeedback({
            type: 'err',
            msg: formatCloudErrorMessage(err, targetRef.projectId, targetRef.databaseId),
          });
        }
      } finally {
        if (didBeginSync) {
          endCloudSync();
        }
      }
    };

    void initializeFirestoreSession();

    return () => {
      cancelled = true;
      backgroundAttachmentTaskSeqRef.current += 1;
      if (unsubCloud) unsubCloud();
    };
  }, [
    activeAuthReady,
    activeCloudUser?.uid,
    activeCloudTarget?.projectId,
    activeCloudTarget?.databaseId,
    activeCloudTarget?.isByoc,
    isAuthenticated,
    currentUser?.userId,
    currentUser?.role,
  ]);

  const runCloudTask = async (
    task: (user: User, target: CloudTargetContext) => Promise<void>,
    successMessage?: string,
  ) => {
    const user = stateRef.current.activeCloudUser;
    const target = stateRef.current.activeCloudTarget;
    if (!user || !target) return;
    beginCloudSync();
    try {
      await enqueueCloudOperation(async () => {
        const latestUser = stateRef.current.activeCloudUser || user;
        const latestTarget = stateRef.current.activeCloudTarget || target;
        await task(latestUser, latestTarget);
      });
      markSyncedNow();
      if (successMessage) {
        setCloudFeedback({ type: 'ok', msg: successMessage });
      } else {
        setCloudFeedback((prev) => (prev?.type === 'err' ? null : prev));
      }
    } catch (err) {
      setCloudFeedback({
        type: 'err',
        msg: formatCloudErrorMessage(err, target.projectId, target.databaseId),
      });
    } finally {
      endCloudSync();
    }
  };

  const handleConnectCloud = async () => {
    localWorkspaceClearedRef.current = false;
    setCloudFeedback(null);
    const session = stateRef.current.currentUser;
    if (session?.role === 'secondary') {
      const cfg = stateRef.current.byocConfig;
      const check = validateByocFirebaseConfig(cfg);
      if (!check.valid) {
        setCloudFeedback({
          type: 'err',
          msg: check.error || 'Please save your personal BYOC Firebase config first.',
        });
        return;
      }
      beginCloudSync();
      try {
        const { ctx } = await signInWithByocGoogle(session.userId, check.normalized);
        setByocContextState(ctx);
        const verifiedCfg: ByocFirebaseConfig = {
          ...check.normalized,
          verifiedAt: new Date().toISOString(),
        };
        saveByocConfig(session.userId, verifiedCfg);
        setByocConfig(verifiedCfg);
      } catch (err) {
        setCloudFeedback({
          type: 'err',
          msg: formatCloudErrorMessage(
            err,
            check.normalized.projectId,
            check.normalized.firestoreDatabaseId,
          ),
        });
      } finally {
        endCloudSync();
      }
      return;
    }

    beginCloudSync();
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setCloudFeedback({ type: 'err', msg: formatCloudErrorMessage(err) });
    } finally {
      endCloudSync();
    }
  };

  const handleDisconnectCloud = async () => {
    await deltaSchedulerRef.current?.flush();
    beginCloudSync();
    const session = stateRef.current.currentUser;
    const target = stateRef.current.activeCloudTarget;
    try {
      if (session?.role === 'secondary') {
        await signOutByocGoogle(session.userId);
      } else {
        await signOut(auth);
      }
      clearCloudSessionCache();
      setCloudFeedback({
        type: 'ok',
        msg: 'Signed out of Google Cloud. Sign back in anytime to read & save data in Firestore.',
      });
    } catch (err) {
      setCloudFeedback({
        type: 'err',
        msg: formatCloudErrorMessage(err, target?.projectId, target?.databaseId),
      });
    } finally {
      endCloudSync();
    }
  };

  const handleBackupToCloudNow = () => {
    const {
      firmProfile: curProfile,
      tenders: curTenders,
      emdRecords: curEmd,
      mafTrackers: curMaf,
      oemRecords: curOems,
      adminPin: curPin,
      darkMode: curDark,
      workspaceTenantId: tenantId,
    } = stateRef.current;
    const prefs: UserPreferences = { adminPin: curPin, darkMode: curDark };
    const preserveExistingCloud = localWorkspaceClearedRef.current;
    const queuedSnapshot =
      deltaSchedulerRef.current?.getProtectedSnapshot() ?? createEmptyDirtySnapshot();
    const pendingSnapshot = mergeDirtySnapshots(failedDirtyRef.current, queuedSnapshot);
    const shouldForceFull = hasDirtyOperations(pendingSnapshot);
    localWorkspaceClearedRef.current = false;
    failedDirtyRef.current = pendingSnapshot;
    deltaSchedulerRef.current?.clear();
    void runCloudTask(
      async (user, target) => {
        if (preserveExistingCloud) {
          await backupAllToCloud(
            user,
            curProfile,
            prefs,
            curTenders,
            curEmd,
            curMaf,
            tenantId,
            target,
            curOems,
            { forceFull: shouldForceFull },
          );
        } else {
          await replaceCloudDataset(
            user,
            curProfile,
            prefs,
            curTenders,
            curEmd,
            curMaf,
            tenantId,
            target,
            curOems,
            { forceFull: shouldForceFull },
          );
        }
        failedDirtyRef.current = createEmptyDirtySnapshot();
      },
      preserveExistingCloud
        ? `Delta synced ${curTenders.length} local tenders, ${curOems.length} OEMs, ${curMaf.length} MAF trackers & ${curEmd.length} EMD/BG records non-destructively to Firestore.`
        : `Delta synced ${curTenders.length} tenders, ${curOems.length} OEMs, ${curMaf.length} MAF trackers, ${curEmd.length} EMD/BG records & settings to Firestore.`,
    );
  };

  const handleRestoreFromCloud = () => {
    localWorkspaceClearedRef.current = false;
    deltaSchedulerRef.current?.clear();
    const tenantId = stateRef.current.workspaceTenantId;
    const userSession = stateRef.current.currentUser;
    void runCloudTask(async (user, target) => {
      await ensureUserRootDocument(user, tenantId, userSession, target, { forceServerCheck: true });
      let cloud: CloudWorkspaceDataset;
      if (userSession?.role === 'admin') {
        const primary = await fetchAllFromCloud(user.uid, null, target, {
          includeAttachments: false,
          forceFull: true,
        });
        const supplemental = await fetchAdminLegacyFallbackWorkspace(user, {
          includeAttachments: false,
        });
        adminSupplementalRef.current = supplemental;
        cloud = mergeCloudDatasets(primary, supplemental);
      } else {
        adminSupplementalRef.current = createEmptyCloudDataset();
        cloud = await fetchAllFromCloud(user.uid, tenantId, target, {
          includeAttachments: false,
          forceFull: true,
        });
      }
      failedDirtyRef.current = createEmptyDirtySnapshot();
      if (cloud.profile) {
        setFirmProfile((prev) => mergeCloudProfileWithLocal(cloud.profile!, prev));
      }
      if (cloud.preferences) {
        setAdminPin(cloud.preferences.adminPin);
        setDarkMode(cloud.preferences.darkMode);
      }
      if (cloud.emailConfig) {
        setEmailSettings(cloud.emailConfig);
      }
      if (cloud.sheetConfig) {
        setSheetSettings(cloud.sheetConfig);
        setSheetSyncStatus(
          cloud.sheetConfig.webhookUrl
            ? cloud.sheetConfig.lastSyncedAt
              ? 'synced'
              : 'idle'
            : 'unconfigured',
        );
      }
      if (cloud.emailAlerts.length > 0) {
        setEmailLogs((prev) => mergeEmailLogs(cloud.emailAlerts, prev));
      }
      setTenders((prev) =>
        mergeCloudTendersWithFiles(cloud.tenders, attachmentFilesRef.current, prev),
      );
      setEmdRecords((prev) =>
        mergeCloudEmdWithFiles(cloud.emdRecords, attachmentFilesRef.current, prev),
      );
      setMafTrackers((prev) =>
        mergeCloudMafTrackersWithFiles(cloud.mafTrackers, attachmentFilesRef.current, prev),
      );
      if (cloud.oemRecords.length > 0 || userSession?.role === 'secondary') {
        setOemRecords(cloud.oemRecords);
      }
      scheduleBackgroundAttachmentHydration({
        cloudUid: user.uid,
        tenantId,
        target,
        tendersList: cloud.tenders,
        emdList: cloud.emdRecords,
        mafList: cloud.mafTrackers,
      });
    }, 'Reloaded latest data from Firebase Firestore.');
  };

  const cloudUserSummary: CloudUserSummary | null = activeCloudUser
    ? {
        uid: activeCloudUser.uid,
        email: activeCloudUser.email,
        displayName: activeCloudUser.displayName,
        photoURL: activeCloudUser.photoURL,
      }
    : null;

  const refreshSecondaryUsers = async () => {
    if (stateRef.current.currentUser?.role !== 'admin') {
      setSecondaryUsers([]);
      return;
    }

    const collected: SecondaryUserSummary[] = [...listSecondaryUsers()];
    const fbUser = stateRef.current.firebaseUser;
    const isAdminGoogle =
      Boolean(fbUser) &&
      (fbUser?.email || '').toLowerCase() === ADMIN_RECOVERY_EMAIL.toLowerCase();
    const firebaseIdToken = isAdminGoogle && fbUser ? await fbUser.getIdToken().catch(() => '') : '';

    if (adminSessionToken || firebaseIdToken) {
      try {
        const res = await fetch('/api/auth/secondary-users', {
          headers: {
            ...(adminSessionToken ? { 'x-crm-admin-token': adminSessionToken } : {}),
            ...(firebaseIdToken ? { 'x-firebase-id-token': firebaseIdToken } : {}),
          },
        });
        const parsed = await safeReadJsonResponse<{
          ok?: boolean;
          users?: SecondaryUserSummary[];
        }>(res);
        if (parsed.ok && Array.isArray(parsed.data?.users)) {
          collected.push(...parsed.data.users);
        }
      } catch {
        // Non-fatal fallback to local + cloud lists
      }
    }

    if (isAdminGoogle && fbUser) {
      try {
        const cloudUsers = await fetchSecondaryUsersFromCloud(fbUser);
        collected.push(...cloudUsers);
      } catch {
        // Non-fatal if rules/network delay occurs
      }
    }

    setSecondaryUsers(deduplicateSecondaryUsers(collected));
  };

  useEffect(() => {
    if (!isAuthenticated || currentUser?.role !== 'admin') {
      setSecondaryUsers([]);
      return;
    }
    void refreshSecondaryUsers();
  }, [isAuthenticated, currentUser?.role, adminSessionToken, firebaseUser?.uid]);

  // Live 25s presence refresh for Admin when inspecting Secondary Users directory
  useEffect(() => {
    if (!isAuthenticated || currentUser?.role !== 'admin' || activeTab !== 'settings') {
      return;
    }
    void refreshSecondaryUsers();
    const timer = window.setInterval(() => {
      void refreshSecondaryUsers();
    }, 25_000);
    return () => window.clearInterval(timer);
  }, [isAuthenticated, currentUser?.role, activeTab, adminSessionToken, firebaseUser?.uid]);

  const sendPresenceHeartbeat = async (explicitByocConfig?: ByocFirebaseConfig | null) => {
    const session = stateRef.current.currentUser;
    if (!session) return;
    const effectiveCfg =
      explicitByocConfig !== undefined ? explicitByocConfig : stateRef.current.byocConfig;
    try {
      const res = await fetch('/api/auth/presence/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: session.userId,
          identifier: session.username,
          credentialToken: getStoredCredentialToken(session.username),
          clientCredentialTokens: getAllStoredCredentialTokens(),
          byocProjectId: effectiveCfg?.projectId || session.byocProjectId || '',
          ...(effectiveCfg ? { byocConfig: effectiveCfg } : {}),
        }),
      });
      const parsed = await safeReadJsonResponse<{
        ok?: boolean;
        code?: string;
        disabled?: boolean;
        error?: string;
      }>(res);
      if (
        session.role === 'secondary' &&
        (res.status === 403 || parsed.data?.code === 'ACCOUNT_DISABLED' || parsed.data?.disabled)
      ) {
        handleLogout(
          parsed.data?.error ||
            'Your CRM ID has been disabled by the Primary Administrator (VanshSales). Please contact the administrator to regain access.',
        );
      }
    } catch {
      // Non-fatal network hiccup; next 25s interval will retry
    }
  };

  // 25s active presence heartbeat + sendBeacon unload logout signal
  useEffect(() => {
    if (!isAuthenticated || !currentUser) return;

    void sendPresenceHeartbeat();
    const intervalId = window.setInterval(() => {
      void sendPresenceHeartbeat();
    }, 25_000);

    const dispatchUnloadBeacon = () => {
      if (deltaSchedulerRef.current?.hasPending()) {
        void deltaSchedulerRef.current.flush();
      }
      try {
        const payload = JSON.stringify({
          userId: currentUser.userId,
          identifier: currentUser.username,
        });
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          navigator.sendBeacon(
            '/api/auth/logout',
            new Blob([payload], { type: 'application/json' }),
          );
        }
      } catch {
        // Ignore beacon failure during page unload
      }
    };

    const handleVisibilityFlush = () => {
      if (document.visibilityState === 'hidden' && deltaSchedulerRef.current?.hasPending()) {
        void deltaSchedulerRef.current.flush();
      }
    };

    window.addEventListener('pagehide', dispatchUnloadBeacon);
    window.addEventListener('beforeunload', dispatchUnloadBeacon);
    document.addEventListener('visibilitychange', handleVisibilityFlush);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('pagehide', dispatchUnloadBeacon);
      window.removeEventListener('beforeunload', dispatchUnloadBeacon);
      document.removeEventListener('visibilitychange', handleVisibilityFlush);
    };
  }, [isAuthenticated, currentUser?.userId]);

  const handleSaveByocConfig = async (nextConfig: ByocFirebaseConfig) => {
    const session = stateRef.current.currentUser;
    if (!session || session.role !== 'secondary') return;
    const validation = validateByocFirebaseConfig(nextConfig);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid BYOC Firebase configuration.');
    }
    const normalized: ByocFirebaseConfig = {
      ...validation.normalized,
      updatedAt: new Date().toISOString(),
    };
    saveByocConfig(session.userId, normalized);
    setByocConfig(normalized);
    await getOrInitByocContext(session.userId, normalized);
    void sendPresenceHeartbeat(normalized);
    showToast('ok', `Saved BYOC project "${normalized.projectId}".`);
  };

  const handleTestByocConnection = async (
    candidateConfig: ByocFirebaseConfig,
  ): Promise<ByocConnectionState> => {
    const session = stateRef.current.currentUser;
    if (!session || session.role !== 'secondary') {
      return { status: 'error', message: 'BYOC mode applies to secondary user accounts only.' };
    }
    const result = await testByocFirebaseConnection(session.userId, candidateConfig);
    setByocConnection(result);
    if (result.status === 'connected' && result.verifiedAt) {
      const updatedCfg: ByocFirebaseConfig = {
        ...candidateConfig,
        verifiedAt: result.verifiedAt,
      };
      saveByocConfig(session.userId, updatedCfg);
      setByocConfig(updatedCfg);
      void sendPresenceHeartbeat(updatedCfg);
    }
    return result;
  };

  const handleClearByocConfig = async () => {
    const session = stateRef.current.currentUser;
    if (!session || session.role !== 'secondary') return;
    await disposeByocContext(session.userId);
    clearByocConfig(session.userId);
    clearCloudSessionCache();
    setByocConfig(null);
    setByocContextState(null);
    setByocAuthUser(null);
    setByocAuthReady(true);
    setByocConnection({
      status: 'pending',
      message: 'BYOC configuration cleared. Workspace remains isolated locally.',
    });
    void sendPresenceHeartbeat(null);
  };

  const handleToggleSecondaryUserStatus = async (targetUserId: string, enable: boolean) => {
    if (stateRef.current.currentUser?.role !== 'admin') return;
    const targetSummary = secondaryUsers.find(
      (u) => u.userId === targetUserId || (u.aliasUserIds ?? []).includes(targetUserId),
    );
    setTogglingSecondaryUserId(targetUserId);
    try {
      const fbUser = stateRef.current.firebaseUser;
      const isAdminGoogle =
        Boolean(fbUser) &&
        (fbUser?.email || '').toLowerCase() === ADMIN_RECOVERY_EMAIL.toLowerCase();
      const firebaseIdToken =
        isAdminGoogle && fbUser ? await fbUser.getIdToken().catch(() => '') : '';

      const res = await fetch('/api/auth/secondary-users/status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminSessionToken ? { 'x-crm-admin-token': adminSessionToken } : {}),
          ...(firebaseIdToken ? { 'x-firebase-id-token': firebaseIdToken } : {}),
        },
        body: JSON.stringify({
          userId: targetUserId,
          username: targetSummary?.username,
          email: targetSummary?.email,
          aliasUserIds: targetSummary?.aliasUserIds,
          byocProjectId: targetSummary?.byocProjectId,
          isEnabled: enable,
          ...(firebaseIdToken ? { firebaseIdToken } : {}),
          clientCredentialTokens: getAllStoredCredentialTokens(),
        }),
      });
      const parsed = await safeReadJsonResponse<{
        ok?: boolean;
        user?: SecondaryUserSummary;
        credentialToken?: string;
        message?: string;
        error?: string;
      }>(res);

      if (!res.ok || !parsed.data?.ok) {
        showToast(
          'err',
          parsed.data?.error || parsed.errorMessage || 'Could not update secondary user access.',
        );
        return;
      }

      const nowIso = new Date().toISOString();
      const updatedLocal = setSecondaryUserEnabled(targetUserId, enable, nowIso, {
        username: targetSummary?.username,
        email: targetSummary?.email,
        aliasUserIds: targetSummary?.aliasUserIds,
        byocProjectId: targetSummary?.byocProjectId,
        createdAt: targetSummary?.createdAt,
      });
      if (parsed.data.credentialToken && (parsed.data.user || targetSummary)) {
        const refUser = parsed.data.user || targetSummary!;
        saveResetPasswordCredential(refUser.username, '', parsed.data.credentialToken, {
          userId: refUser.userId,
          email: refUser.email,
          role: 'secondary',
          isEnabled: enable,
          disabledAt: enable ? undefined : nowIso,
          presenceStatus: enable ? refUser.presenceStatus ?? 'not_active' : 'not_active',
          byocProjectId: refUser.byocProjectId,
        });
      }

      const nextRecord: SecondaryUserSummary | null =
        parsed.data.user ||
        updatedLocal ||
        (targetSummary
          ? {
              ...targetSummary,
              isEnabled: enable,
              isActive: false,
              presenceStatus: enable ? targetSummary.presenceStatus ?? 'not_active' : 'not_active',
              disabledAt: enable ? undefined : nowIso,
            }
          : null);

      if (nextRecord) {
        const targetNormEmail = (nextRecord.email || targetSummary?.email || '').trim().toLowerCase();
        setSecondaryUsers((prev) =>
          deduplicateSecondaryUsers(
            prev.map((u) =>
              u.userId === targetUserId ||
              (targetNormEmail && u.email.trim().toLowerCase() === targetNormEmail) ||
              (u.aliasUserIds ?? []).includes(targetUserId)
                ? {
                    ...u,
                    ...nextRecord,
                    isEnabled: enable,
                    disabledAt: enable ? undefined : nextRecord.disabledAt || nowIso,
                  }
                : u,
            ),
          ),
        );
        if (isAdminGoogle && fbUser) {
          void syncSecondaryUserToCloud(fbUser, nextRecord).catch(() => {
            // Non-fatal if central Firestore sync fails
          });
        }
      }

      showToast(
        'ok',
        parsed.data.message ||
          (enable
            ? `Enabled access for ${targetSummary?.username || targetUserId}.`
            : `Disabled access for ${targetSummary?.username || targetUserId}.`),
      );
    } catch {
      showToast('err', 'Network error while updating secondary user access.');
    } finally {
      setTogglingSecondaryUserId(null);
    }
  };

  const dispatchEmailReminder = async (
    tender: Tender,
    slot: EmailReminderSlot | 'manual' | 'test',
    explicitSlotKey?: string,
  ): Promise<void> => {
    const {
      emailSettings: curSettings,
      activeCloudUser: curUser,
      activeCloudTarget: curTarget,
      currentUser: curSession,
      workspaceTenantId: tenantId,
    } = stateRef.current;
    const activeTenantKey = curSession?.userId || ADMIN_USER_ID;
    const slotKey =
      explicitSlotKey ||
      (slot === 'test' || slot === 'manual'
        ? `email_${slot}_${tender.id}_${Date.now()}`
        : `email_${tender.id}_${slot}`);

    if (slot !== 'test' && slot !== 'manual') {
      dispatchedEmailKeysRef.current.add(slotKey);
    }

    const { subject, text, html } = buildTenderEmailMessage(
      tender,
      slot,
      curSettings.recipientName,
    );

    let logEntry: EmailAlertLog = {
      id: slotKey,
      slotKey,
      tenderRefId: tender.id,
      tenderId: tender.tenderId,
      slot,
      recipientName: curSettings.recipientName,
      recipientEmail: curSettings.recipientEmail,
      dueDateIso: tender.submissionDueDate,
      status: 'failed',
      provider: 'none',
      subject,
      message: text,
      createdAt: new Date().toISOString(),
    };

    try {
      const res = await fetch('/api/notifications/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: activeTenantKey,
          slotKey,
          tenderRefId: tender.id,
          tenderId: tender.tenderId,
          slot,
          recipientName: curSettings.recipientName,
          recipientEmail: curSettings.recipientEmail,
          dueDateIso: tender.submissionDueDate,
          subject,
          message: text,
          html,
        }),
      });
      const parsed = await safeReadJsonResponse<{
        ok?: boolean;
        deduplicated?: boolean;
        delivered?: boolean;
        errorDetail?: string;
        error?: string;
        logEntry?: EmailAlertLog;
      }>(res);
      if (parsed.ok && parsed.data) {
        const data = parsed.data;
        if (data.logEntry) {
          logEntry = data.logEntry;
        }
        if (data.delivered) {
          emailRetryStateRef.current.delete(slotKey);
        } else if (slot !== 'test' && slot !== 'manual') {
          recordEmailDispatchFailure(emailRetryStateRef.current, slotKey);
          dispatchedEmailKeysRef.current.delete(slotKey);
        }
        if (!data.deduplicated) {
          const slotLabel = formatSlotLabel(slot);
          if (data.delivered) {
            showToast(
              'ok',
              `Email ${slotLabel} sent to ${curSettings.recipientEmail} for ${tender.tenderId}.`,
            );
          } else {
            showToast(
              'err',
              data.errorDetail ||
                data.error ||
                `Could not send email reminder to ${curSettings.recipientEmail}. Check SMTP settings.`,
            );
          }
        }
      } else if (slot !== 'test' && slot !== 'manual') {
        recordEmailDispatchFailure(emailRetryStateRef.current, slotKey);
        dispatchedEmailKeysRef.current.delete(slotKey);
      }
    } catch {
      if (slot !== 'test' && slot !== 'manual') {
        recordEmailDispatchFailure(emailRetryStateRef.current, slotKey);
        dispatchedEmailKeysRef.current.delete(slotKey);
      }
    }

    setEmailLogs((prev) => mergeEmailLogs([logEntry], prev));
    if (curUser && curTarget) {
      void enqueueCloudOperation(() =>
        syncEmailAlertLogToCloud(curUser, logEntry, tenantId, curTarget),
      ).catch(() => {
        // Handled cleanly via subsequent cloud sync
      });
    }
  };

  // Load initial server Email gateway capabilities & persisted logs on authentication
  useEffect(() => {
    if (!isAuthenticated || !currentUser) return;
    let cancelled = false;
    const loadEmailStatus = async () => {
      try {
        const res = await fetch(
          `/api/notifications/email/status?tenantId=${encodeURIComponent(currentUser.userId || ADMIN_USER_ID)}`,
        );
        const parsed = await safeReadJsonResponse<{
          provider?: string;
          automatedConfigured?: boolean;
          logs?: EmailAlertLog[];
        }>(res);
        if (!parsed.ok || !parsed.data || cancelled) return;
        const data = parsed.data;
        setEmailGatewayInfo({
          automatedConfigured: Boolean(data.automatedConfigured),
          provider: data.provider || 'none',
        });
        if (Array.isArray(data.logs) && data.logs.length > 0) {
          setEmailLogs((prev) => mergeEmailLogs(data.logs!, prev));
        }
      } catch {
        // Ignore transient network errors
      }
    };
    void loadEmailStatus();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, currentUser?.userId]);

  // Twice-Daily Email Tender Alert Scheduler (11:00 AM IST & 4:00 PM IST for tenders due within 5 days)
  useEffect(() => {
    if (!isAuthenticated || !emailSettings.enabled) return;

    const evaluateAndDispatch = () => {
      const now = new Date();
      const nowMs = now.getTime();
      const pending = computePendingEmailAlerts(
        stateRef.current.tenders,
        dispatchedEmailKeysRef.current,
        now,
      );
      for (const item of pending) {
        if (!shouldAttemptEmailDispatch(emailRetryStateRef.current, item.slotKey, nowMs)) {
          continue;
        }
        void dispatchEmailReminder(item.tender, item.slot, item.slotKey);
      }
    };

    evaluateAndDispatch();
    const timer = window.setInterval(evaluateAndDispatch, 30_000);
    return () => window.clearInterval(timer);
  }, [isAuthenticated, emailSettings.enabled]);

  // Automatic Due-Date & Time watcher so tenders move from Daily Tender Data -> BID/RA Status immediately when due time passes
  useEffect(() => {
    if (!isAuthenticated) return;
    const refreshNow = () => setNowTick(Date.now());
    refreshNow();
    const timer = window.setInterval(refreshNow, 15_000);
    window.addEventListener('focus', refreshNow);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshNow);
    };
  }, [isAuthenticated]);

  const { dailyTenders, bidRaTenders } = useMemo(
    () => partitionTendersByDueDate(tenders, nowTick),
    [tenders, nowTick],
  );

  const notifications = useMemo(
    () => computeNotifications(tenders, emdRecords),
    [tenders, emdRecords],
  );

  const selectedTender = useMemo(
    () => tenders.find((t) => t.id === selectedTenderId) ?? null,
    [tenders, selectedTenderId],
  );

  const cloudStorageSummary = useMemo(
    () =>
      estimateCloudStorageUsage({
        ownerUid: activeCloudUser?.uid,
        profile: firmProfile,
        preferences: { adminPin, darkMode },
        tenders,
        emdRecords,
        mafTrackers,
        oemRecords,
        emailSettings,
        emailLogs,
        sheetSettings,
        attachmentFiles: attachmentFilesRef.current,
      }),
    [
      activeCloudUser?.uid,
      firmProfile,
      adminPin,
      darkMode,
      tenders,
      emdRecords,
      mafTrackers,
      oemRecords,
      emailSettings,
      emailLogs,
      sheetSettings,
      lastCloudSyncAt,
    ],
  );

  const createLinkedEmdRecord = (tender: Tender): EmdBgRecord => {
    const today = new Date().toISOString().slice(0, 10);
    const sixMonthsLater = new Date();
    sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
    const expiryIso = sixMonthsLater.toISOString().slice(0, 10);

    return {
      id: `emd-${Date.now()}`,
      tenderRefId: tender.id,
      tenderId: tender.tenderId,
      department: tender.department,
      instrumentType:
        tender.emdStatus === 'BG Submitted'
          ? 'Bank Guarantee (PBG / Bid BG)'
          : 'Online / NEFT / RTGS',
      referenceNo: `SYNC-${tender.tenderId.slice(-6)}`,
      bankName: 'Primary Corporate Bank Account',
      amount: tender.emdAmount,
      issueDate: today,
      expiryDate: expiryIso,
      claimEndDate: expiryIso,
      status: 'Active / Locked',
      remarks: `Auto-synced from Tender ${tender.tenderId}`,
    };
  };

  const cacheAttachmentPayloads = (items?: { id: string; dataUrl: string }[]) => {
    for (const att of items ?? []) {
      if (att.dataUrl) {
        attachmentFilesRef.current.set(att.id, att.dataUrl);
      }
    }
  };

  const cacheMafPayloads = (items?: MafLineItem[]) => {
    for (const item of items ?? []) {
      if (item.mafAttachmentId && item.mafDocumentUrl?.startsWith('data:')) {
        attachmentFilesRef.current.set(item.mafAttachmentId, item.mafDocumentUrl);
      }
    }
  };

  const buildSyncedMafTrackersForTender = (
    saved: Tender,
    currentTrackers: MafTrackerRecord[],
  ): { nextTrackers: MafTrackerRecord[]; changedTrackers: MafTrackerRecord[] } => {
    const changedTrackers: MafTrackerRecord[] = [];
    const normalizedSavedCode = saved.tenderId.trim().toLowerCase();
    const nowIso = new Date().toISOString();

    const nextTrackers = currentTrackers.map((tracker) => {
      const isMatch =
        (tracker.tenderRefId && tracker.tenderRefId === saved.id) ||
        tracker.tenderId.trim().toLowerCase() === normalizedSavedCode;
      if (!isMatch) return tracker;

      // Preserve Attachment 1 extracted department on existing tracker unless blank
      const nextDept = tracker.department?.trim() ? tracker.department : saved.department;
      const needsUpdate =
        tracker.tenderRefId !== saved.id ||
        tracker.tenderId !== saved.tenderId ||
        tracker.tenderTitle !== saved.title ||
        tracker.department !== nextDept ||
        tracker.tenderDueDate !== saved.submissionDueDate;
      if (!needsUpdate) return tracker;

      const updatedTracker: MafTrackerRecord = {
        ...tracker,
        tenderRefId: saved.id,
        tenderId: saved.tenderId,
        tenderTitle: saved.title,
        department: nextDept,
        tenderDueDate: saved.submissionDueDate,
        updatedAt: nowIso,
      };
      changedTrackers.push(updatedTracker);
      return updatedTracker;
    });

    return { nextTrackers, changedTrackers };
  };

  const triggerAutoMafFromTender = async (tender: Tender): Promise<void> => {
    const gate = evaluateTenderMafAttachmentGate(
      tender,
      (att) => att.dataUrl || attachmentFilesRef.current.get(att.id) || '',
    );

    // Strict Gate: Do NOT start/create MAF Status entries until BOTH Attachment 1 (Bid Document)
    // AND Attachment 2 (Specification Document) are present on the tender.
    if (!gate.ready || !gate.attachment1 || !gate.attachment2) {
      return;
    }

    const att1 = gate.attachment1;
    const att2 = gate.attachment2;
    const att1DataUrl = gate.attachment1DataUrl;
    const att2DataUrl = gate.attachment2DataUrl;

    const sig = buildTenderAttachmentExtractionSignature(tender);
    const prevSig = mafExtractionSignatureRef.current.get(tender.id);
    const normalizedTenderCode = tender.tenderId.trim().toLowerCase();
    const hasExistingTracker = stateRef.current.mafTrackers.some(
      (t) =>
        (t.tenderRefId && t.tenderRefId === tender.id) ||
        (normalizedTenderCode && t.tenderId.trim().toLowerCase() === normalizedTenderCode),
    );

    if ((prevSig === sig && hasExistingTracker) || mafExtractionInFlightRef.current.has(sig)) {
      return;
    }

    mafExtractionInFlightRef.current.add(sig);
    try {
      const res = await fetch('/api/maf/extract-from-attachments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attachment1: {
            fileName: att1.fileName,
            mimeType: att1.fileType,
            dataUrl: att1DataUrl,
          },
          attachment2: {
            fileName: att2.fileName,
            mimeType: att2.fileType,
            dataUrl: att2DataUrl,
          },
          fallbackDepartment: tender.department,
        }),
      });

      const parsed = await safeReadJsonResponse<{
        ok?: boolean;
        department?: string;
        items?: ExtractedSpecItem[];
        error?: string;
      }>(res);
      const data = parsed.data;

      if (!parsed.ok || !data?.ok) {
        if (data?.error || parsed.errorMessage) {
          showToast('err', `MAF auto-extraction: ${data?.error || parsed.errorMessage}`);
        }
        return;
      }

      mafExtractionSignatureRef.current.set(tender.id, sig);
      const extractedItems = Array.isArray(data.items) ? data.items : [];
      if (extractedItems.length === 0) return;

      const latestTender =
        stateRef.current.tenders.find((t) => t.id === tender.id) ?? tender;

      const merged = mergeAutoMafIntoTrackers({
        tender: latestTender,
        extractedDepartment: typeof data.department === 'string' ? data.department : '',
        extractedItems,
        existingTrackers: stateRef.current.mafTrackers,
      });

      if (merged.addedCount === 0 && !merged.departmentUpdated) {
        return;
      }

      stateRef.current.mafTrackers = merged.nextTrackers;
      setMafTrackers(merged.nextTrackers);

      if (merged.targetTracker) {
        queueEntityUpsert('mafTrackers', merged.targetTracker.id);
      }

      if (merged.addedCount > 0) {
        showToast(
          'ok',
          `Auto-generated ${merged.addedCount} MAF item(s) for ${latestTender.tenderId} (Status: Pending).`,
        );
      }
    } catch {
      // Non-fatal: tender save itself already succeeded
    } finally {
      mafExtractionInFlightRef.current.delete(sig);
    }
  };

  const pushToGoogleSheet = async (opts: {
    action: SheetSyncAction;
    entityType: SheetSyncEntityType;
    tender?: Tender | null;
    emdRecord?: EmdBgRecord | null;
    tendersSnapshot?: Tender[];
    emdSnapshot?: EmdBgRecord[];
    oemSnapshot?: OemRecord[];
    settingsOverride?: GoogleSheetSettings;
    force?: boolean;
  }): Promise<boolean> => {
    const cfg = opts.settingsOverride ?? stateRef.current.sheetSettings;
    const webhookUrl = (cfg.webhookUrl || '').trim();

    if (!webhookUrl || !isValidAppsScriptWebhookUrl(webhookUrl)) {
      if (opts.force) {
        const msg = 'Configure a valid Google Apps Script Webhook URL in Settings first.';
        setSheetSyncStatus('error');
        setSheetSyncError(msg);
        showToast('err', msg);
      }
      return false;
    }

    if (!opts.force && !cfg.enabled) {
      return false;
    }

    setSheetSyncStatus('syncing');
    setSheetSyncError(null);

    const payload = buildSheetSyncPayload({
      action: opts.action,
      entityType: opts.entityType,
      sheetName: cfg.sheetName,
      firmName: stateRef.current.firmProfile.firmName,
      assignedOwner:
        stateRef.current.firmProfile.adminName ||
        stateRef.current.currentUser?.username ||
        'Tender Owner',
      tender: opts.tender ?? null,
      emdRecord: opts.emdRecord ?? null,
      tenders: opts.tendersSnapshot ?? stateRef.current.tenders,
      emdRecords: opts.emdSnapshot ?? stateRef.current.emdRecords,
      oemDetails: opts.oemSnapshot ?? stateRef.current.oemRecords,
    });

    try {
      const res = await fetch('/api/sheet-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookUrl,
          payload,
        }),
      });
      const parsed = await safeReadJsonResponse<{
        ok?: boolean;
        error?: string;
        syncedAt?: string;
        scriptResponse?: { message?: string; spreadsheetName?: string };
      }>(res);
      const data = parsed.data;

      if (!parsed.ok || data?.ok === false) {
        const errMsg =
          data?.error ||
          parsed.errorMessage ||
          `Google Sheet webhook returned HTTP ${res.status}.`;
        setSheetSyncStatus('error');
        setSheetSyncError(errMsg);
        showToast('err', errMsg);
        return false;
      }

      const syncedAt = data?.syncedAt || new Date().toISOString();
      const updatedCfg: GoogleSheetSettings = {
        ...cfg,
        webhookUrl,
        lastSyncedAt: syncedAt,
      };
      stateRef.current.sheetSettings = updatedCfg;
      setSheetSettings(updatedCfg);
      setSheetSyncStatus('synced');
      setSheetSyncError(null);

      queueSingletonDeltaSync('sheetConfig');

      if (opts.force) {
        const label =
          opts.action === 'PING'
            ? data?.scriptResponse?.message ||
              `Connected to Google Sheet "${updatedCfg.sheetName}" successfully.`
            : `Synced ${payload.tenders.length} tenders & ${payload.emdRecords.length} EMD/BG records to "${updatedCfg.sheetName}".`;
        showToast('ok', label);
      }
      return true;
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : 'Unable to reach /api/sheet-sync endpoint.';
      setSheetSyncStatus('error');
      setSheetSyncError(errMsg);
      showToast('err', errMsg);
      return false;
    }
  };

  const handleSaveTender = (
    rawSaved: Tender,
    syncToEmd: boolean,
    initialMafItems?: MafLineItem[],
  ) => {
    const interactionIso = new Date().toISOString();
    const saved: Tender = {
      ...rawSaved,
      updatedAt: interactionIso,
    };
    cacheAttachmentPayloads(saved.attachments);
    const prevTenders = stateRef.current.tenders;
    const isExisting = prevTenders.some((t) => t.id === saved.id);
    const nextTenders = isExisting
      ? prevTenders.map((t) => (t.id === saved.id ? saved : t))
      : [saved, ...prevTenders];
    stateRef.current.tenders = nextTenders;
    setTenders(nextTenders);

    let linkedRecordToSync: EmdBgRecord | null = null;
    let nextEmdRecords = stateRef.current.emdRecords;
    if (syncToEmd && saved.emdAmount > 0) {
      const alreadyLinked = nextEmdRecords.some(
        (r) => r.tenderId.toLowerCase() === saved.tenderId.toLowerCase(),
      );
      if (!alreadyLinked) {
        linkedRecordToSync = createLinkedEmdRecord(saved);
        nextEmdRecords = [linkedRecordToSync, ...nextEmdRecords];
        stateRef.current.emdRecords = nextEmdRecords;
        setEmdRecords(nextEmdRecords);
      }
    }

    const syncedResult = buildSyncedMafTrackersForTender(
      saved,
      stateRef.current.mafTrackers,
    );
    const changedTrackers = syncedResult.changedTrackers;

    let linkedMafToSync: MafTrackerRecord | null = null;
    if (initialMafItems && initialMafItems.length > 0) {
      const mergedManual = mergeAutoMafIntoTrackers({
        tender: saved,
        extractedDepartment: saved.department,
        extractedItems: initialMafItems.map((it) => ({
          itemName: it.itemName,
          requiredQuantity: it.requiredQuantity,
        })),
        existingTrackers: syncedResult.nextTrackers,
      });
      if (mergedManual.targetTracker) {
        // Apply user's explicit OEM/status choices on manually initialized rows
        const manualByKey = new Map(
          initialMafItems.map((it) => [it.itemName.trim().toLowerCase(), it]),
        );
        const updatedTarget: MafTrackerRecord = {
          ...mergedManual.targetTracker,
          itemsMAF: mergedManual.targetTracker.itemsMAF.map((item) => {
            const manual = manualByKey.get(item.itemName.trim().toLowerCase());
            return manual
              ? {
                  ...item,
                  oemName: manual.oemName,
                  companyName: manual.companyName,
                  concernedPersonName: manual.concernedPersonName,
                  contactNo: manual.contactNo,
                  mailId: manual.mailId,
                  oemContact: manual.oemContact,
                  mafStatus: manual.mafStatus,
                }
              : item;
          }),
        };
        linkedMafToSync = updatedTarget;
        const nextMaf = mergedManual.nextTrackers.map((t) =>
          t.id === updatedTarget.id ? updatedTarget : t,
        );
        stateRef.current.mafTrackers = nextMaf;
        setMafTrackers(nextMaf);
      }
      showToast(
        'ok',
        `Tender saved & initialized ${initialMafItems.length} MAF tracker item(s).`,
      );
    } else if (changedTrackers.length > 0) {
      stateRef.current.mafTrackers = syncedResult.nextTrackers;
      setMafTrackers(syncedResult.nextTrackers);
    }

    const nowMs = Date.now();
    setNowTick(nowMs);
    if (!initialMafItems || initialMafItems.length === 0) {
      if (isTenderDuePassed(saved, nowMs)) {
        showToast(
          'ok',
          `Tender ${saved.tenderId} due date has passed — placed in BID/RA Status.`,
        );
      }
    }

    setTenderModalTarget(undefined);

    queueEntityUpsert('tenders', saved.id);
    if (linkedRecordToSync) {
      queueEntityUpsert('emdRecords', linkedRecordToSync.id);
    }
    if (linkedMafToSync) {
      queueEntityUpsert('mafTrackers', linkedMafToSync.id);
    }
    for (const updatedMaf of changedTrackers) {
      queueEntityUpsert('mafTrackers', updatedMaf.id);
    }

    void pushToGoogleSheet({
      action: isExisting ? 'UPDATE' : 'CREATE',
      entityType: 'TENDER',
      tender: saved,
      emdRecord: linkedRecordToSync,
      tendersSnapshot: nextTenders,
      emdSnapshot: nextEmdRecords,
    });

    void triggerAutoMafFromTender(saved);
  };

  const handleUpdateTenderInline = (rawUpdated: Tender) => {
    const nowIso = new Date().toISOString();
    const updated: Tender = {
      ...rawUpdated,
      updatedAt: nowIso,
      lastUpdatedAt: nowIso,
    };
    cacheAttachmentPayloads(updated.attachments);
    const nextTenders = stateRef.current.tenders.map((t) =>
      t.id === updated.id ? updated : t,
    );
    stateRef.current.tenders = nextTenders;
    setTenders(nextTenders);
    setNowTick(Date.now());

    const syncedResult = buildSyncedMafTrackersForTender(
      updated,
      stateRef.current.mafTrackers,
    );
    const changedTrackers = syncedResult.changedTrackers;
    if (changedTrackers.length > 0) {
      stateRef.current.mafTrackers = syncedResult.nextTrackers;
      setMafTrackers(syncedResult.nextTrackers);
    }
    queueEntityUpsert('tenders', updated.id);
    for (const updatedMaf of changedTrackers) {
      queueEntityUpsert('mafTrackers', updatedMaf.id);
    }

    void pushToGoogleSheet({
      action: 'UPDATE',
      entityType: 'TENDER',
      tender: updated,
      tendersSnapshot: nextTenders,
      emdSnapshot: stateRef.current.emdRecords,
    });

    void triggerAutoMafFromTender(updated);
  };

  const handleSaveBidRaTender = (rawUpdated: Tender) => {
    const nowMs = Date.now();
    const stillDuePassed = isTenderDuePassed(rawUpdated, nowMs);
    handleUpdateTenderInline(rawUpdated);
    if (!stillDuePassed) {
      setSelectedBidRaTenderId(null);
      showToast(
        'ok',
        `Updated ${rawUpdated.tenderId} — future due date moved it back to Daily Tender Data.`,
      );
    } else {
      showToast(
        'ok',
        `Saved Tender & Technical/Financial/RA update for ${rawUpdated.tenderId}.`,
      );
    }
  };

  const handleDeleteTender = (id: string) => {
    const deletedTender = stateRef.current.tenders.find((t) => t.id === id) ?? null;
    adminSupplementalRef.current.tenders = adminSupplementalRef.current.tenders.filter(
      (t) => t.id !== id,
    );
    const nextTenders = stateRef.current.tenders.filter((t) => t.id !== id);
    stateRef.current.tenders = nextTenders;
    setTenders(nextTenders);

    if (selectedTenderId === id) {
      setSelectedTenderId(null);
    }
    queueEntityDelete('tenders', id);

    if (deletedTender) {
      void pushToGoogleSheet({
        action: 'DELETE',
        entityType: 'TENDER',
        tender: deletedTender,
        tendersSnapshot: nextTenders,
        emdSnapshot: stateRef.current.emdRecords,
      });
    }
  };

  const handleSyncTenderToEmd = (tender: Tender) => {
    const alreadyExists = stateRef.current.emdRecords.some(
      (r) => r.tenderId.toLowerCase() === tender.tenderId.toLowerCase(),
    );
    if (!alreadyExists && tender.emdAmount > 0) {
      const linked = createLinkedEmdRecord(tender);
      const nextEmdRecords = [linked, ...stateRef.current.emdRecords];
      stateRef.current.emdRecords = nextEmdRecords;
      setEmdRecords(nextEmdRecords);
      queueEntityUpsert('emdRecords', linked.id);
      void pushToGoogleSheet({
        action: 'CREATE',
        entityType: 'EMD_BG',
        emdRecord: linked,
        tendersSnapshot: stateRef.current.tenders,
        emdSnapshot: nextEmdRecords,
      });
    }
  };

  const handleSaveEmdRecord = (saved: EmdBgRecord) => {
    cacheAttachmentPayloads(saved.attachments);
    const prevEmd = stateRef.current.emdRecords;
    const isExisting = prevEmd.some((r) => r.id === saved.id);
    const nextEmdRecords = isExisting
      ? prevEmd.map((r) => (r.id === saved.id ? saved : r))
      : [saved, ...prevEmd];
    stateRef.current.emdRecords = nextEmdRecords;
    setEmdRecords(nextEmdRecords);
    setEmdModalTarget(undefined);
    queueEntityUpsert('emdRecords', saved.id);

    void pushToGoogleSheet({
      action: isExisting ? 'UPDATE' : 'CREATE',
      entityType: 'EMD_BG',
      emdRecord: saved,
      tendersSnapshot: stateRef.current.tenders,
      emdSnapshot: nextEmdRecords,
    });
  };

  const handleDeleteEmdRecord = (id: string) => {
    const deletedRecord = stateRef.current.emdRecords.find((r) => r.id === id) ?? null;
    adminSupplementalRef.current.emdRecords = adminSupplementalRef.current.emdRecords.filter(
      (r) => r.id !== id,
    );
    const nextEmdRecords = stateRef.current.emdRecords.filter((r) => r.id !== id);
    stateRef.current.emdRecords = nextEmdRecords;
    setEmdRecords(nextEmdRecords);
    queueEntityDelete('emdRecords', id);

    if (deletedRecord) {
      void pushToGoogleSheet({
        action: 'DELETE',
        entityType: 'EMD_BG',
        emdRecord: deletedRecord,
        tendersSnapshot: stateRef.current.tenders,
        emdSnapshot: nextEmdRecords,
      });
    }
  };

  // MAF Tracker Optimistic Handlers (batched via debounced delta scheduler)
  const queueMafOptimisticChange = (
    nextList: MafTrackerRecord[],
    mutation: { type: 'upsert' | 'delete'; trackerId: string },
    toastMsg: string,
  ) => {
    stateRef.current.mafTrackers = nextList;
    setMafTrackers(nextList);
    showToast('ok', toastMsg);
    if (mutation.type === 'delete') {
      queueEntityDelete('mafTrackers', mutation.trackerId);
    } else {
      queueEntityUpsert('mafTrackers', mutation.trackerId);
    }
  };

  const handleSaveMafTracker = (saved: MafTrackerRecord) => {
    const matchedTender = findMatchingDailyTender(
      stateRef.current.tenders,
      saved.tenderId,
      saved.tenderRefId,
    );
    if (!matchedTender) {
      showToast(
        'err',
        `Tender "${saved.tenderId}" is not in Daily Tender Data. Please add it there first.`,
      );
      return;
    }

    const canonicalTracker: MafTrackerRecord = {
      ...saved,
      tenderRefId: matchedTender.id,
      tenderId: matchedTender.tenderId,
      tenderTitle: matchedTender.title,
      department: matchedTender.department,
      tenderDueDate: matchedTender.submissionDueDate,
    };

    cacheMafPayloads(canonicalTracker.itemsMAF);
    const prevSnapshot = stateRef.current.mafTrackers;
    const exists = prevSnapshot.some((t) => t.id === canonicalTracker.id);
    const nextList = exists
      ? prevSnapshot.map((t) => (t.id === canonicalTracker.id ? canonicalTracker : t))
      : [canonicalTracker, ...prevSnapshot];
    setMafTrackerModalTarget(undefined);
    queueMafOptimisticChange(
      nextList,
      { type: 'upsert', trackerId: canonicalTracker.id },
      exists
        ? `Updated MAF tracker for ${canonicalTracker.tenderId}.`
        : `Created MAF tracker for ${canonicalTracker.tenderId} (${canonicalTracker.itemsMAF.length} item(s)).`,
    );
  };

  const handleDeleteMafTracker = (trackerId: string) => {
    const prevSnapshot = stateRef.current.mafTrackers;
    const target = prevSnapshot.find((t) => t.id === trackerId);
    adminSupplementalRef.current.mafTrackers = adminSupplementalRef.current.mafTrackers.filter(
      (t) => t.id !== trackerId,
    );
    const nextList = prevSnapshot.filter((t) => t.id !== trackerId);
    queueMafOptimisticChange(
      nextList,
      { type: 'delete', trackerId },
      `Removed MAF tracker ${target?.tenderId ?? ''}.`,
    );
  };

  const handleSaveMafItem = (trackerId: string, savedItem: MafLineItem) => {
    cacheMafPayloads([savedItem]);
    const prevSnapshot = stateRef.current.mafTrackers;
    const target = prevSnapshot.find((t) => t.id === trackerId);
    if (!target) return;

    const nowIso = new Date().toISOString();
    const itemExists = target.itemsMAF.some((i) => i.itemId === savedItem.itemId);
    const updatedTracker: MafTrackerRecord = {
      ...target,
      itemsMAF: itemExists
        ? target.itemsMAF.map((i) => (i.itemId === savedItem.itemId ? savedItem : i))
        : [...target.itemsMAF, savedItem],
      updatedAt: nowIso,
    };
    const nextList = prevSnapshot.map((t) => (t.id === trackerId ? updatedTracker : t));
    setMafItemModalTarget(null);

    queueMafOptimisticChange(
      nextList,
      { type: 'upsert', trackerId },
      itemExists
        ? `Updated "${savedItem.itemName}" (${savedItem.oemName}).`
        : `Added "${savedItem.itemName}" (${savedItem.oemName}) to ${target.tenderId}.`,
    );
  };

  const handleInlineMafStatusChange = (
    trackerId: string,
    itemId: string,
    nextStatus: MafItemStatus,
  ) => {
    const prevSnapshot = stateRef.current.mafTrackers;
    const target = prevSnapshot.find((t) => t.id === trackerId);
    if (!target) return;
    const nowIso = new Date().toISOString();
    const item = target.itemsMAF.find((i) => i.itemId === itemId);
    const updatedTracker: MafTrackerRecord = {
      ...target,
      itemsMAF: target.itemsMAF.map((i) =>
        i.itemId === itemId ? { ...i, mafStatus: nextStatus, updatedAt: nowIso } : i,
      ),
      updatedAt: nowIso,
    };
    const nextList = prevSnapshot.map((t) => (t.id === trackerId ? updatedTracker : t));

    queueMafOptimisticChange(
      nextList,
      { type: 'upsert', trackerId },
      `${item?.oemName ?? 'OEM'} MAF status set to "${nextStatus}".`,
    );
  };

  const handleUploadMafFile = async (trackerId: string, itemId: string, file: File) => {
    const activeTenant = stateRef.current.workspaceTenantId;
    const result = await uploadMafDocumentFile(
      stateRef.current.activeCloudUser,
      trackerId,
      itemId,
      file,
      activeTenant,
      stateRef.current.activeCloudTarget,
    );
    if (result.mafAttachmentId && result.mafDocumentUrl.startsWith('data:')) {
      attachmentFilesRef.current.set(result.mafAttachmentId, result.mafDocumentUrl);
    }
    return result;
  };

  const handleInlineMafFileUpload = async (trackerId: string, itemId: string, file: File) => {
    try {
      const uploaded = await handleUploadMafFile(trackerId, itemId, file);
      const prevSnapshot = stateRef.current.mafTrackers;
      const target = prevSnapshot.find((t) => t.id === trackerId);
      if (!target) return;
      const nowIso = new Date().toISOString();
      const updatedTracker: MafTrackerRecord = {
        ...target,
        itemsMAF: target.itemsMAF.map((i) =>
          i.itemId === itemId
            ? {
                ...i,
                mafDocumentUrl: uploaded.mafDocumentUrl,
                mafDocumentName: uploaded.mafDocumentName,
                mafAttachmentId: uploaded.mafAttachmentId,
                updatedAt: nowIso,
              }
            : i,
        ),
        updatedAt: nowIso,
      };
      const nextList = prevSnapshot.map((t) => (t.id === trackerId ? updatedTracker : t));
      queueMafOptimisticChange(
        nextList,
        { type: 'upsert', trackerId },
        `Uploaded "${uploaded.mafDocumentName}" successfully.`,
      );
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Failed to upload MAF document.');
    }
  };

  const handleDeleteMafItem = (trackerId: string, itemId: string) => {
    const prevSnapshot = stateRef.current.mafTrackers;
    const target = prevSnapshot.find((t) => t.id === trackerId);
    if (!target) return;
    const removed = target.itemsMAF.find((i) => i.itemId === itemId);
    const nowIso = new Date().toISOString();
    const updatedTracker: MafTrackerRecord = {
      ...target,
      itemsMAF: target.itemsMAF.filter((i) => i.itemId !== itemId),
      updatedAt: nowIso,
    };
    const nextList = prevSnapshot.map((t) => (t.id === trackerId ? updatedTracker : t));

    queueMafOptimisticChange(
      nextList,
      { type: 'upsert', trackerId },
      `Removed "${removed?.itemName ?? 'item'}" from ${target.tenderId}.`,
    );
  };

  // OEM Master Directory Handlers
  const handleSaveOemRecord = (saved: OemRecord) => {
    const prevOems = stateRef.current.oemRecords;
    const isExisting = prevOems.some((o) => o.id === saved.id);
    const nextOems = isExisting
      ? prevOems.map((o) => (o.id === saved.id ? saved : o))
      : [saved, ...prevOems];
    stateRef.current.oemRecords = nextOems;
    setOemRecords(nextOems);
    setOemModalTarget(undefined);
    showToast(
      'ok',
      isExisting ? `Updated OEM "${saved.oemName}".` : `Added OEM "${saved.oemName}" to directory.`,
    );

    queueEntityUpsert('oemRecords', saved.id);
    void pushToGoogleSheet({
      action: 'FULL_SYNC',
      entityType: 'BULK',
      oemSnapshot: nextOems,
    });
  };

  const handleDeleteOemRecord = (id: string) => {
    const removed = stateRef.current.oemRecords.find((o) => o.id === id);
    adminSupplementalRef.current.oemRecords = adminSupplementalRef.current.oemRecords.filter(
      (o) => o.id !== id,
    );
    const nextOems = stateRef.current.oemRecords.filter((o) => o.id !== id);
    stateRef.current.oemRecords = nextOems;
    setOemRecords(nextOems);
    showToast('ok', `Removed OEM "${removed?.oemName ?? 'record'}" from directory.`);

    queueEntityDelete('oemRecords', id);
    void pushToGoogleSheet({
      action: 'FULL_SYNC',
      entityType: 'BULK',
      oemSnapshot: nextOems,
    });
  };

  const handleSaveProfile = (nextProfile: FirmProfile) => {
    stateRef.current.firmProfile = nextProfile;
    setFirmProfile(nextProfile);
    queueSingletonDeltaSync('profile');
  };

  const handleSaveEmailSettings = (nextSettings: EmailAlertSettings) => {
    stateRef.current.emailSettings = nextSettings;
    setEmailSettings(nextSettings);
    queueSingletonDeltaSync('emailConfig');
  };

  const handleSaveSheetSettings = async (nextSettings: GoogleSheetSettings) => {
    stateRef.current.sheetSettings = nextSettings;
    setSheetSettings(nextSettings);
    setSheetSyncError(null);
    queueSingletonDeltaSync('sheetConfig');
    if (!nextSettings.webhookUrl.trim()) {
      setSheetSyncStatus('unconfigured');
      return;
    }
    setSheetSyncStatus('idle');
    await pushToGoogleSheet({
      action: 'FULL_SYNC',
      entityType: 'BULK',
      settingsOverride: nextSettings,
      force: true,
    });
  };

  const handleTestSheetWebhook = async (settingsOverride?: GoogleSheetSettings) => {
    await pushToGoogleSheet({
      action: 'PING',
      entityType: 'SYSTEM',
      settingsOverride,
      force: true,
    });
  };

  const handleFullSyncToSheet = async (settingsOverride?: GoogleSheetSettings) => {
    await pushToGoogleSheet({
      action: 'FULL_SYNC',
      entityType: 'BULK',
      settingsOverride,
      force: true,
    });
  };

  const handleTriggerTestEmail = async () => {
    const sampleTender =
      stateRef.current.tenders.find(
        (t) => t.stage === 'Identified / Reviewing' || t.stage === 'Doc Preparation',
      ) ?? stateRef.current.tenders[0];
    if (!sampleTender) {
      showToast('err', 'Add at least one tender first to send a test tender reminder email.');
      return;
    }
    await dispatchEmailReminder(sampleTender, 'test');
  };

  const handleToggleDarkMode = () => {
    setDarkMode((prev) => {
      const next = !prev;
      stateRef.current.darkMode = next;
      queueSingletonDeltaSync('preferences');
      return next;
    });
  };

  const handleLoginSuccess = async (
    session: CrmUserSession,
    _rememberMe: boolean,
    serverMeta?: { credentialToken?: string; adminSessionToken?: string },
  ) => {
    setDisabledNotice(null);
    recordUserLoginActivity(session.username);

    // Snapshot Admin offline workspace before switching to secondary workspace if needed
    if (activeRoleRef.current === 'admin' || (!activeRoleRef.current && session.role === 'secondary')) {
      adminOfflineSnapshotRef.current = {
        firmProfile: stateRef.current.firmProfile,
        preferences: {
          adminPin: stateRef.current.adminPin,
          darkMode: stateRef.current.darkMode,
        },
        tenders: stateRef.current.tenders,
        emdRecords: stateRef.current.emdRecords,
        mafTrackers: stateRef.current.mafTrackers,
        oemRecords: stateRef.current.oemRecords,
        emailSettings: stateRef.current.emailSettings,
        emailLogs: stateRef.current.emailLogs,
        sheetSettings: stateRef.current.sheetSettings,
        updatedAt: new Date().toISOString(),
      };
    }

    const prevUserId = activeCrmUserIdRef.current;
    const isSwitchingCrmAccount = Boolean(prevUserId && prevUserId !== session.userId);
    const activeCentralFbUser = stateRef.current.firebaseUser;

    deltaSchedulerRef.current?.clear();
    failedDirtyRef.current = createEmptyDirtySnapshot();
    backgroundAttachmentTaskSeqRef.current += 1;
    clearCloudSessionCache();
    localWorkspaceClearedRef.current = false;
    adminSupplementalRef.current = createEmptyCloudDataset();
    attachmentFilesRef.current.clear();
    dispatchedEmailKeysRef.current.clear();
    emailRetryStateRef.current.clear();
    mafExtractionSignatureRef.current.clear();
    mafExtractionInFlightRef.current.clear();
    setSelectedTenderId(null);
    setActiveTab('dashboard');
    setCloudFeedback(null);

    // Always ensure secondary sessions do NOT hold central Admin Firebase auth
    if ((isSwitchingCrmAccount || session.role === 'secondary') && activeCentralFbUser) {
      await signOut(auth).catch(() => {});
    }

    if (session.role === 'secondary') {
      // Dispose any prior secondary BYOC app instance before loading the new user
      if (isSwitchingCrmAccount && prevUserId) {
        await disposeByocContext(prevUserId).catch(() => {});
      }
      const resolvedByocConfig =
        (session.byocConfig && validateByocFirebaseConfig(session.byocConfig).valid
          ? session.byocConfig
          : null) || loadByocConfig(session.userId);
      if (resolvedByocConfig) {
        saveByocConfig(session.userId, resolvedByocConfig);
      }
      setByocConfig(resolvedByocConfig);
      setByocAuthUser(null);
      setByocContextState(null);
      setByocAuthReady(false);
      setByocConnection(
        resolvedByocConfig
          ? {
              status: 'auth_required',
              message: `BYOC config loaded for "${resolvedByocConfig.projectId}". Click "Connect Google Account" in Settings if prompted.`,
              projectId: resolvedByocConfig.projectId,
              databaseId: resolvedByocConfig.firestoreDatabaseId || '(default)',
            }
          : {
              status: 'pending',
              message: 'Save your personal Firebase config to enable isolated BYOC cloud sync.',
            },
      );

      const emptyOrSaved =
        loadSecondaryWorkspaceSnapshot(session.userId) ?? buildEmptySecondaryWorkspace(session);

      setFirmProfile(emptyOrSaved.firmProfile);
      setAdminPin(emptyOrSaved.preferences.adminPin);
      setDarkMode(emptyOrSaved.preferences.darkMode);
      setTenders(emptyOrSaved.tenders);
      setEmdRecords(emptyOrSaved.emdRecords);
      setMafTrackers(emptyOrSaved.mafTrackers);
      setOemRecords(emptyOrSaved.oemRecords ?? []);
      setEmailSettings(emptyOrSaved.emailSettings);
      setEmailLogs(emptyOrSaved.emailLogs);
      setSheetSettings(emptyOrSaved.sheetSettings);
      setSheetSyncStatus(
        emptyOrSaved.sheetSettings.webhookUrl
          ? emptyOrSaved.sheetSettings.lastSyncedAt
            ? 'synced'
            : 'idle'
          : 'unconfigured',
      );
      setSheetSyncError(null);
      stateRef.current = {
        ...stateRef.current,
        firmProfile: emptyOrSaved.firmProfile,
        adminPin: emptyOrSaved.preferences.adminPin,
        darkMode: emptyOrSaved.preferences.darkMode,
        tenders: emptyOrSaved.tenders,
        emdRecords: emptyOrSaved.emdRecords,
        mafTrackers: emptyOrSaved.mafTrackers,
        oemRecords: emptyOrSaved.oemRecords ?? [],
        emailSettings: emptyOrSaved.emailSettings,
        emailLogs: emptyOrSaved.emailLogs,
        sheetSettings: emptyOrSaved.sheetSettings,
        byocConfig: resolvedByocConfig,
        activeCloudUser: null,
        activeCloudTarget: null,
        currentUser: session,
        workspaceTenantId: session.userId,
      };
      setAdminSessionToken('');
    } else {
      await disposeByocContext().catch(() => {});
      setByocConfig(null);
      setByocContextState(null);
      setByocAuthUser(null);
      setByocAuthReady(true);

      if (activeRoleRef.current === 'secondary' && adminOfflineSnapshotRef.current) {
        const snap = adminOfflineSnapshotRef.current;
        setFirmProfile(snap.firmProfile);
        setAdminPin(snap.preferences.adminPin);
        setDarkMode(snap.preferences.darkMode);
        setTenders(snap.tenders);
        setEmdRecords(snap.emdRecords);
        setMafTrackers(snap.mafTrackers);
        setOemRecords(snap.oemRecords ?? SEED_OEM_DETAILS);
        setEmailSettings(snap.emailSettings);
        setEmailLogs(snap.emailLogs);
        setSheetSettings(snap.sheetSettings);
        setSheetSyncStatus(
          snap.sheetSettings.webhookUrl
            ? snap.sheetSettings.lastSyncedAt
              ? 'synced'
              : 'idle'
            : 'unconfigured',
        );
        setSheetSyncError(null);
        stateRef.current = {
          ...stateRef.current,
          firmProfile: snap.firmProfile,
          adminPin: snap.preferences.adminPin,
          darkMode: snap.preferences.darkMode,
          tenders: snap.tenders,
          emdRecords: snap.emdRecords,
          mafTrackers: snap.mafTrackers,
          oemRecords: snap.oemRecords ?? SEED_OEM_DETAILS,
          emailSettings: snap.emailSettings,
          emailLogs: snap.emailLogs,
          sheetSettings: snap.sheetSettings,
          byocConfig: null,
          currentUser: session,
          workspaceTenantId: null,
        };
      }
      setAdminSessionToken(serverMeta?.adminSessionToken || '');
    }

    const resolvedAdminToken =
      session.role === 'admin' ? serverMeta?.adminSessionToken || '' : '';
    const loginAtMs = Date.now();
    savePerTabCrmSession({
      session,
      adminSessionToken: resolvedAdminToken,
      loginAtMs,
      activeTab: 'dashboard',
    });

    activeRoleRef.current = session.role;
    activeCrmUserIdRef.current = session.userId;
    setSessionLoginAtMs(loginAtMs);
    setCurrentUser(session);
    setIsAuthenticated(true);
    window.scrollTo({ top: 0, left: 0 });
  };

  const handleLogout = (forceDisabledMessage?: string) => {
    const exitingSession = stateRef.current.currentUser;
    if (deltaSchedulerRef.current?.hasPending()) {
      void deltaSchedulerRef.current.flush();
    } else {
      deltaSchedulerRef.current?.clear();
    }
    failedDirtyRef.current = createEmptyDirtySnapshot();
    backgroundAttachmentTaskSeqRef.current += 1;
    clearPerTabCrmSession();
    if (exitingSession) {
      void fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: exitingSession.userId,
          identifier: exitingSession.username,
        }),
      }).catch(() => {});
      if (exitingSession.role === 'secondary') {
        void disposeByocContext(exitingSession.userId).catch(() => {});
      }
    }

    clearCloudSessionCache();
    localWorkspaceClearedRef.current = false;
    adminSupplementalRef.current = createEmptyCloudDataset();
    attachmentFilesRef.current.clear();
    dispatchedEmailKeysRef.current.clear();
    emailRetryStateRef.current.clear();
    mafExtractionSignatureRef.current.clear();
    mafExtractionInFlightRef.current.clear();
    activeRoleRef.current = null;
    activeCrmUserIdRef.current = null;
    activeCloudSyncCountRef.current = 0;
    setCloudSyncing(false);
    setSessionLoginAtMs(null);
    setCurrentUser(null);
    setByocConfig(null);
    setByocContextState(null);
    setByocAuthUser(null);
    setAdminSessionToken('');
    setCloudFeedback(null);
    setIsAuthenticated(false);
    setMobileMenuOpen(false);
    setTenderModalTarget(undefined);
    setSelectedTenderId(null);
    setSelectedBidRaTenderId(null);
    setEmdModalTarget(undefined);
    setMafTrackerModalTarget(undefined);
    setMafItemModalTarget(null);
    setOemModalTarget(undefined);
    if (typeof forceDisabledMessage === 'string' && forceDisabledMessage.trim()) {
      setDisabledNotice(forceDisabledMessage);
    }
    window.scrollTo({ top: 0, left: 0 });
  };

  const handleNavigateFromNotification = (item: NotificationItem) => {
    if (item.targetTab === 'tenders') {
      const target = stateRef.current.tenders.find((t) => t.id === item.targetId);
      if (target && isTenderDuePassed(target, Date.now())) {
        setActiveTab('bidra');
        setSelectedBidRaTenderId(target.id);
        setSelectedTenderId(null);
        window.scrollTo({ top: 0, left: 0 });
        return;
      }
      setActiveTab('tenders');
      setSelectedTenderId(item.targetId);
      window.scrollTo({ top: 0, left: 0 });
      return;
    }
    setActiveTab(item.targetTab);
    window.scrollTo({ top: 0, left: 0 });
  };

  const handleImportBackup = (payload: CrmBackupPayload) => {
    localWorkspaceClearedRef.current = false;
    for (const t of payload.tenders) cacheAttachmentPayloads(t.attachments);
    for (const r of payload.emdRecords) cacheAttachmentPayloads(r.attachments);
    for (const m of payload.mafTrackers ?? []) cacheMafPayloads(m.itemsMAF);

    const nextMaf = payload.mafTrackers ?? [];
    const nextOems = Array.isArray(payload.oemDetails)
      ? payload.oemDetails
      : stateRef.current.oemRecords;
    stateRef.current.tenders = payload.tenders;
    stateRef.current.emdRecords = payload.emdRecords;
    stateRef.current.mafTrackers = nextMaf;
    stateRef.current.oemRecords = nextOems;
    stateRef.current.firmProfile = payload.profile;
    setFirmProfile(payload.profile);
    setTenders(payload.tenders);
    setEmdRecords(payload.emdRecords);
    setMafTrackers(nextMaf);
    if (Array.isArray(payload.oemDetails)) {
      setOemRecords(nextOems);
    }

    const prefs: UserPreferences = {
      adminPin: stateRef.current.adminPin,
      darkMode: stateRef.current.darkMode,
    };
    const activeTenant = stateRef.current.workspaceTenantId;
    void runCloudTask((user, target) =>
      replaceCloudDataset(
        user,
        payload.profile,
        prefs,
        payload.tenders,
        payload.emdRecords,
        nextMaf,
        activeTenant,
        target,
        nextOems,
      ),
    );
    void pushToGoogleSheet({
      action: 'FULL_SYNC',
      entityType: 'BULK',
      tendersSnapshot: payload.tenders,
      emdSnapshot: payload.emdRecords,
      oemSnapshot: nextOems,
    });
  };

  const handleResetDemoData = () => {
    if (stateRef.current.currentUser?.role !== 'admin') return;
    localWorkspaceClearedRef.current = false;
    adminSupplementalRef.current = createEmptyCloudDataset();
    stateRef.current.firmProfile = DEFAULT_FIRM_PROFILE;
    stateRef.current.tenders = SEED_TENDERS;
    stateRef.current.emdRecords = SEED_EMD_RECORDS;
    stateRef.current.mafTrackers = SEED_MAF_TRACKERS;
    stateRef.current.oemRecords = SEED_OEM_DETAILS;
    setFirmProfile(DEFAULT_FIRM_PROFILE);
    setTenders(SEED_TENDERS);
    setEmdRecords(SEED_EMD_RECORDS);
    setMafTrackers(SEED_MAF_TRACKERS);
    setOemRecords(SEED_OEM_DETAILS);
    setSelectedTenderId(null);
    const prefs: UserPreferences = {
      adminPin: stateRef.current.adminPin,
      darkMode: stateRef.current.darkMode,
    };
    void runCloudTask((user, target) =>
      replaceCloudDataset(
        user,
        DEFAULT_FIRM_PROFILE,
        prefs,
        SEED_TENDERS,
        SEED_EMD_RECORDS,
        SEED_MAF_TRACKERS,
        null,
        target,
        SEED_OEM_DETAILS,
      ),
    );
    void pushToGoogleSheet({
      action: 'FULL_SYNC',
      entityType: 'BULK',
      tendersSnapshot: SEED_TENDERS,
      emdSnapshot: SEED_EMD_RECORDS,
      oemSnapshot: SEED_OEM_DETAILS,
    });
  };

  const handleClearAllData = () => {
    // Strictly clear local/CRM workspace state only.
    // NEVER send delete/replace commands to Google Cloud Firestore, BYOC storage, or Google Drive Sheet.
    localWorkspaceClearedRef.current = true;
    deltaSchedulerRef.current?.clear();
    failedDirtyRef.current = createEmptyDirtySnapshot();
    backgroundAttachmentTaskSeqRef.current += 1;
    adminSupplementalRef.current = createEmptyCloudDataset();
    attachmentFilesRef.current.clear();
    mafExtractionSignatureRef.current.clear();
    mafExtractionInFlightRef.current.clear();
    dispatchedEmailKeysRef.current.clear();
    emailRetryStateRef.current.clear();
    stateRef.current.tenders = [];
    stateRef.current.emdRecords = [];
    stateRef.current.mafTrackers = [];
    stateRef.current.oemRecords = [];
    setTenders([]);
    setEmdRecords([]);
    setMafTrackers([]);
    setOemRecords([]);
    setSelectedTenderId(null);
    setSelectedBidRaTenderId(null);
    showToast(
      'ok',
      'Local CRM data cleared. Google Cloud / BYOC & Google Sheet records remain intact — use "Restore from Cloud" anytime to reload.',
    );
  };

  if (!isAuthenticated) {
    return (
      <LoginPage
        onLoginSuccess={(session, rememberMe, meta) => {
          void handleLoginSuccess(session, rememberMe, meta);
        }}
        disabledNotice={disabledNotice}
        onDismissDisabledNotice={() => setDisabledNotice(null)}
      />
    );
  }

  return (
    <div className="min-h-screen flex bg-[#F8FAFC] dark:bg-[#0B1120] text-slate-900 dark:text-slate-100">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          window.scrollTo({ top: 0, left: 0 });
        }}
        firmProfile={firmProfile}
        currentUser={currentUser}
        tenderCount={dailyTenders.length}
        oemCount={oemRecords.length}
        mafCount={mafTrackers.length}
        emdCount={emdRecords.length}
        bidRaCount={bidRaTenders.length}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        onLogout={handleLogout}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Header
          activeTab={activeTab}
          firmProfile={firmProfile}
          currentUser={currentUser}
          darkMode={darkMode}
          onToggleDarkMode={handleToggleDarkMode}
          onLogout={handleLogout}
          notifications={notifications}
          tenders={tenders}
          emailSettings={emailSettings}
          emailLogs={emailLogs}
          onSendReminderEmailNow={(tender) => void dispatchEmailReminder(tender, 'manual')}
          onNavigateFromNotification={handleNavigateFromNotification}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          cloudUser={cloudUserSummary}
          cloudSyncing={cloudSyncing}
          cloudError={cloudFeedback?.type === 'err'}
          onConnectCloud={
            isSecondarySession && !savedByocValid
              ? () => setActiveTab('settings')
              : handleConnectCloud
          }
          onOpenCloudSettings={() => setActiveTab('settings')}
          sheetSyncStatus={sheetSyncStatus}
          sheetSyncError={sheetSyncError}
          onOpenSheetSettings={() => setActiveTab('settings')}
        />

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto space-y-4">
          {activeAuthReady && !activeCloudUser && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 dark:border-blue-900/70 bg-blue-50/80 dark:bg-blue-950/30 px-4 py-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Cloud className="h-4 w-4 text-[#1E3A8A] dark:text-blue-400 shrink-0" aria-hidden="true" />
                <p className="text-xs text-slate-800 dark:text-slate-200">
                  {isSecondarySession && !savedByocValid ? (
                    <>
                      <span className="font-semibold">Personal BYOC Cloud Mode:</span> Your secondary workspace is strictly isolated. Configure your own Firebase project in Workspace Settings to enable cloud sync.
                    </>
                  ) : (
                    <>
                      <span className="font-semibold">Firestore Cloud Mode:</span>{' '}
                      {isSecondarySession
                        ? `Sign in with your Google account to sync with your isolated BYOC project (${byocConfig?.projectId}).`
                        : 'Browser storage is disabled. Sign in with Google to save and load all tenders, MAF statuses, EMD/BG records, and attachments in Firebase Firestore.'}
                    </>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={
                  isSecondarySession && !savedByocValid
                    ? () => setActiveTab('settings')
                    : handleConnectCloud
                }
                disabled={cloudSyncing}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap shrink-0"
              >
                <CloudUpload className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {cloudSyncing
                    ? 'Connecting...'
                    : isSecondarySession && !savedByocValid
                      ? 'Configure Personal Cloud'
                      : 'Sign in with Google'}
                </span>
              </button>
            </div>
          )}

          {cloudFeedback && activeTab !== 'settings' && (
            <div
              role={cloudFeedback.type === 'err' ? 'alert' : 'status'}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs font-medium ${
                cloudFeedback.type === 'err'
                  ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200'
                  : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {cloudFeedback.type === 'err' && (
                  <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" aria-hidden="true" />
                )}
                <span className="break-words">{cloudFeedback.msg}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {cloudFeedback.type === 'err' && activeCloudUser && (
                  <button
                    type="button"
                    onClick={handleBackupToCloudNow}
                    disabled={cloudSyncing}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white text-[11px] font-medium"
                  >
                    <RefreshCw className={`h-3 w-3 ${cloudSyncing ? 'animate-spin' : ''}`} aria-hidden="true" />
                    <span>Retry Sync</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setCloudFeedback(null)}
                  aria-label="Dismiss cloud notification"
                  className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {activeTab === 'dashboard' && (
            <DashboardTab
              tenders={tenders}
              emdRecords={emdRecords}
              firmProfile={firmProfile}
              darkMode={darkMode}
              onOpenTender={(tender) => {
                if (isTenderDuePassed(tender, nowTick)) {
                  setActiveTab('bidra');
                  setSelectedBidRaTenderId(tender.id);
                  setSelectedTenderId(null);
                } else {
                  setActiveTab('tenders');
                  setSelectedTenderId(tender.id);
                }
              }}
              onGoToEmdBg={() => setActiveTab('emdbg')}
            />
          )}

          {activeTab === 'bidsearch' && (
            <BidSearchTab
              tenders={tenders}
              onSaveScannedTender={(saved, syncToEmd) => handleSaveTender(saved, syncToEmd)}
              onOpenExistingTender={(tender) => {
                if (isTenderDuePassed(tender, nowTick)) {
                  setActiveTab('bidra');
                  setSelectedBidRaTenderId(tender.id);
                  setSelectedTenderId(null);
                } else {
                  setActiveTab('tenders');
                  setSelectedTenderId(tender.id);
                }
              }}
              onAddManualTender={() => setTenderModalTarget(null)}
              onGoToDailyTenders={() => setActiveTab('tenders')}
              onNotify={showToast}
            />
          )}

          {activeTab === 'tenders' && (
            <TendersTab
              tenders={dailyTenders}
              emdRecords={emdRecords}
              defaultOwner={firmProfile.adminName || currentUser?.username}
              onAddTender={() => setTenderModalTarget(null)}
              onEditTender={(tender) => setTenderModalTarget(tender)}
              onOpenTender={(tender) => setSelectedTenderId(tender.id)}
              onDeleteTender={handleDeleteTender}
            />
          )}

          {activeTab === 'oems' && (
            <OemDetailsTab
              oemRecords={oemRecords}
              mafTrackers={mafTrackers}
              tenders={tenders}
              onAddOem={() => setOemModalTarget(null)}
              onEditOem={(oem) => setOemModalTarget(oem)}
              onDeleteOem={handleDeleteOemRecord}
            />
          )}

          {activeTab === 'maf' && (
            <MafStatusTab
              trackers={mafTrackers}
              tenders={tenders}
              onAddTracker={() => setMafTrackerModalTarget(null)}
              onEditTracker={(tracker) => setMafTrackerModalTarget(tracker)}
              onDeleteTracker={handleDeleteMafTracker}
              onOpenNewItemModal={(tracker) => setMafItemModalTarget({ tracker, item: null })}
              onOpenEditItemModal={(tracker, item) => setMafItemModalTarget({ tracker, item })}
              onInlineStatusChange={handleInlineMafStatusChange}
              onInlineFileUpload={handleInlineMafFileUpload}
              onDeleteItem={handleDeleteMafItem}
              onValidationError={(msg) => showToast('err', msg)}
            />
          )}

          {activeTab === 'emdbg' && (
            <EmdBgTab
              records={emdRecords}
              tenders={tenders}
              onAddRecord={() => setEmdModalTarget(null)}
              onEditRecord={(rec) => setEmdModalTarget(rec)}
              onDeleteRecord={handleDeleteEmdRecord}
            />
          )}

          {activeTab === 'bidra' && (
            <BidRaStatusTab
              tenders={bidRaTenders}
              allTenders={tenders}
              selectedTenderId={selectedBidRaTenderId}
              onSelectTenderId={setSelectedBidRaTenderId}
              onSaveTenderUpdate={handleSaveBidRaTender}
              onDeleteTender={handleDeleteTender}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsTab
              profile={firmProfile}
              tenders={tenders}
              emdRecords={emdRecords}
              mafTrackers={mafTrackers}
              oemRecords={oemRecords}
              onSaveProfile={handleSaveProfile}
              onLogout={() => handleLogout()}
              onImportBackup={handleImportBackup}
              onResetDemoData={handleResetDemoData}
              onClearAllData={handleClearAllData}
              cloudUser={cloudUserSummary}
              cloudSyncing={cloudSyncing}
              lastCloudSyncAt={lastCloudSyncAt}
              cloudFeedback={cloudFeedback}
              onConnectCloud={handleConnectCloud}
              onDisconnectCloud={handleDisconnectCloud}
              onBackupToCloudNow={handleBackupToCloudNow}
              onRestoreFromCloud={handleRestoreFromCloud}
              emailSettings={emailSettings}
              emailLogs={emailLogs}
              emailGatewayInfo={emailGatewayInfo}
              onSaveEmailSettings={handleSaveEmailSettings}
              onTriggerTestEmail={handleTriggerTestEmail}
              sheetSettings={sheetSettings}
              sheetSyncStatus={sheetSyncStatus}
              sheetSyncError={sheetSyncError}
              onSaveSheetSettings={handleSaveSheetSettings}
              onTestSheetWebhook={handleTestSheetWebhook}
              onFullSyncToSheet={handleFullSyncToSheet}
              storageUsage={cloudStorageSummary}
              currentUser={currentUser}
              secondaryUsers={secondaryUsers}
              onRefreshSecondaryUsers={() => void refreshSecondaryUsers()}
              byocConfig={byocConfig}
              byocConnection={byocConnection}
              onSaveByocConfig={handleSaveByocConfig}
              onTestByocConnection={handleTestByocConnection}
              onClearByocConfig={handleClearByocConfig}
              onToggleSecondaryUserStatus={handleToggleSecondaryUserStatus}
              togglingUserId={togglingSecondaryUserId}
            />
          )}
        </main>
      </div>

      {/* Modals & Slide-over Drawers */}
      {selectedTender && (
        <TenderDetailDrawer
          key={selectedTender.id}
          tender={selectedTender}
          linkedEmdRecord={emdRecords.find(
            (r) => r.tenderId.toLowerCase() === selectedTender.tenderId.toLowerCase(),
          )}
          onClose={() => setSelectedTenderId(null)}
          onEdit={(t) => {
            setSelectedTenderId(null);
            setTenderModalTarget(t);
          }}
          onDelete={handleDeleteTender}
          onUpdateTender={handleUpdateTenderInline}
          onSyncToEmdTracker={handleSyncTenderToEmd}
          onGoToEmdTab={() => {
            setSelectedTenderId(null);
            setActiveTab('emdbg');
          }}
        />
      )}

      {tenderModalTarget !== undefined && (
        <TenderFormModal
          initialTender={tenderModalTarget}
          existingTenders={tenders}
          oemRecords={oemRecords}
          onGoToOemDetails={() => setActiveTab('oems')}
          onClose={() => setTenderModalTarget(undefined)}
          onSave={handleSaveTender}
        />
      )}

      {oemModalTarget !== undefined && (
        <OemFormModal
          initialOem={oemModalTarget}
          existingOems={oemRecords}
          onClose={() => setOemModalTarget(undefined)}
          onSave={handleSaveOemRecord}
        />
      )}

      {emdModalTarget !== undefined && (
        <EmdBgFormModal
          initialRecord={emdModalTarget}
          tenders={tenders}
          onClose={() => setEmdModalTarget(undefined)}
          onSave={handleSaveEmdRecord}
        />
      )}

      {mafTrackerModalTarget !== undefined && (
        <MafTrackerFormModal
          initialTracker={mafTrackerModalTarget}
          tenders={tenders}
          existingTrackers={mafTrackers}
          oemRecords={oemRecords}
          onGoToOemDetails={() => setActiveTab('oems')}
          onClose={() => setMafTrackerModalTarget(undefined)}
          onSave={handleSaveMafTracker}
          onUploadFile={handleUploadMafFile}
        />
      )}

      {mafItemModalTarget && (
        <MafItemModal
          trackerId={mafItemModalTarget.tracker.id}
          tenderId={mafItemModalTarget.tracker.tenderId}
          tenderTitle={mafItemModalTarget.tracker.tenderTitle || 'Linked Tender'}
          initialItem={mafItemModalTarget.item}
          oemRecords={oemRecords}
          onGoToOemDetails={() => setActiveTab('oems')}
          onClose={() => setMafItemModalTarget(null)}
          onSave={(savedItem) => handleSaveMafItem(mafItemModalTarget.tracker.id, savedItem)}
          onUploadFile={handleUploadMafFile}
        />
      )}

      {/* Toast Notification Stack */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0"
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              role={toast.type === 'err' ? 'alert' : 'status'}
              className={`pointer-events-auto flex items-center justify-between gap-2.5 rounded-xl border px-3.5 py-2.5 shadow-lg text-xs font-medium ${
                toast.type === 'err'
                  ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200'
                  : 'border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {toast.type === 'err' ? (
                  <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                )}
                <span className="truncate">{toast.msg}</span>
              </div>
              <button
                type="button"
                onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                aria-label="Close toast"
                className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
