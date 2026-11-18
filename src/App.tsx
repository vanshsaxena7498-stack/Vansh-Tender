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
import { BidSearchTab } from './components/BidSearchTab';
import { DashboardTab } from './components/DashboardTab';
import { EmdBgFormModal } from './components/EmdBgFormModal';
import { EmdBgTab } from './components/EmdBgTab';
import { Header, type CloudUserSummary } from './components/Header';
import { LoginPage } from './components/LoginPage';
import { MafItemModal } from './components/MafItemModal';
import { MafStatusTab } from './components/MafStatusTab';
import { MafTrackerFormModal } from './components/MafTrackerFormModal';
import { SettingsTab } from './components/SettingsTab';
import { Sidebar } from './components/Sidebar';
import { TenderDetailDrawer } from './components/TenderDetailDrawer';
import { TenderFormModal } from './components/TenderFormModal';
import { TendersTab } from './components/TendersTab';
import {
  DEFAULT_FIRM_PROFILE,
  SEED_EMD_RECORDS,
  SEED_MAF_TRACKERS,
  SEED_TENDERS,
} from './data/seedData';
import { auth, firebaseConfig, googleProvider } from './lib/firebase';
import type {
  CrmBackupPayload,
  EmdBgRecord,
  FirmProfile,
  GoogleSheetSettings,
  MafItemStatus,
  MafLineItem,
  MafTrackerRecord,
  NotificationItem,
  SheetSyncAction,
  SheetSyncEntityType,
  SheetSyncStatus,
  TabKey,
  Tender,
  UserPreferences,
  WhatsAppAlertLog,
  WhatsAppMilestone,
  WhatsAppSettings,
} from './types/crm';
import { computeNotifications } from './utils/calculations';
import {
  backupAllToCloud,
  clearCloudSessionCache,
  deleteEmdRecordFromCloud,
  deleteMafTrackerFromCloud,
  deleteTenderFromCloud,
  ensureUserRootDocument,
  fetchAllFromCloud,
  replaceCloudDataset,
  subscribeToUserCloudData,
  syncEmdRecordToCloud,
  syncMafTrackerToCloud,
  syncPreferencesToCloud,
  syncProfileToCloud,
  syncSheetConfigToCloud,
  syncTenderToCloud,
  syncWhatsAppAlertLogToCloud,
  syncWhatsAppConfigToCloud,
  uploadMafDocumentFile,
} from './utils/cloudSync';
import {
  mergeCloudEmdWithFiles,
  mergeCloudMafTrackersWithFiles,
  mergeCloudProfileWithLocal,
  mergeCloudTendersWithFiles,
} from './utils/cloudSyncHelpers';
import {
  buildSheetSyncPayload,
  DEFAULT_GOOGLE_SHEET_SETTINGS,
  isValidAppsScriptWebhookUrl,
} from './utils/googleSheetSync';
import {
  buildTenderAttachmentExtractionSignature,
  findTenderAttachmentSlot,
  mergeAutoMafIntoTrackers,
  type ExtractedSpecItem,
} from './utils/mafAutoGenerate';
import { findMatchingDailyTender } from './utils/mafCalculations';
import {
  buildTenderWhatsAppMessage,
  buildWhatsAppMilestoneKey,
  computePendingWhatsAppAlerts,
  DEFAULT_WHATSAPP_SETTINGS,
  normalizeIndianWhatsAppPhone,
} from './utils/whatsappAlerts';
import { estimateCloudStorageUsage } from './utils/storageUsage';

interface ToastNotice {
  id: string;
  type: 'ok' | 'err';
  msg: string;
}

function formatCloudErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  let parsedErrorText = raw;
  let parsedOp = '';
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as { error?: string; operationType?: string };
      if (typeof parsed.error === 'string') parsedErrorText = parsed.error;
      if (typeof parsed.operationType === 'string') parsedOp = parsed.operationType;
    } catch {
      // Keep raw string
    }
  }

  if (parsedErrorText.includes("Quota exceeded for quota metric 'Free daily read units per project")) {
    return `Firestore daily read quota reached. Upgrade or check usage at https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/databases/${firebaseConfig.firestoreDatabaseId}/data?openUpgradeDialog=true`;
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
    return `Cloud sync permission denied${parsedOp ? ` during ${parsedOp}` : ''}. Please sign out and sign in again with a verified Google account.`;
  }
  if (parsedErrorText.includes('failed-precondition')) {
    return 'Firestore database index or precondition is missing. Please retry sync in a moment.';
  }
  return 'Could not sync with Firebase Firestore. Please check your connection and try again.';
}

export default function App() {
  const [tenders, setTenders] = useState<Tender[]>(SEED_TENDERS);
  const [emdRecords, setEmdRecords] = useState<EmdBgRecord[]>(SEED_EMD_RECORDS);
  const [mafTrackers, setMafTrackers] = useState<MafTrackerRecord[]>(SEED_MAF_TRACKERS);
  const [firmProfile, setFirmProfile] = useState<FirmProfile>(DEFAULT_FIRM_PROFILE);
  const [adminPin, setAdminPin] = useState<string>('1234');
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [whatsappSettings, setWhatsappSettings] = useState<WhatsAppSettings>(
    DEFAULT_WHATSAPP_SETTINGS,
  );
  const [whatsappLogs, setWhatsappLogs] = useState<WhatsAppAlertLog[]>([]);
  const [whatsappGatewayInfo, setWhatsappGatewayInfo] = useState<{
    automatedConfigured: boolean;
    provider: string;
  }>({ automatedConfigured: false, provider: 'none' });
  const [sheetSettings, setSheetSettings] = useState<GoogleSheetSettings>(
    DEFAULT_GOOGLE_SHEET_SETTINGS,
  );
  const [sheetSyncStatus, setSheetSyncStatus] = useState<SheetSyncStatus>('unconfigured');
  const [sheetSyncError, setSheetSyncError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Firebase Firestore State
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [lastCloudSyncAt, setLastCloudSyncAt] = useState<string | null>(null);
  const [cloudFeedback, setCloudFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(
    null,
  );
  const [toasts, setToasts] = useState<ToastNotice[]>([]);

  // Modal & Drawer states
  const [tenderModalTarget, setTenderModalTarget] = useState<Tender | null | undefined>(
    undefined, // undefined = closed, null = new, Tender = edit
  );
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
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

  // In-memory refs for async Firestore listeners and attachment payloads
  const attachmentFilesRef = useRef<Map<string, string>>(new Map());
  const dispatchedWaKeysRef = useRef<Set<string>>(new Set());
  const mafExtractionSignatureRef = useRef<Map<string, string>>(new Map());
  const stateRef = useRef({
    tenders,
    emdRecords,
    mafTrackers,
    firmProfile,
    adminPin,
    darkMode,
    whatsappSettings,
    sheetSettings,
    firebaseUser,
  });
  useEffect(() => {
    stateRef.current = {
      tenders,
      emdRecords,
      mafTrackers,
      firmProfile,
      adminPin,
      darkMode,
      whatsappSettings,
      sheetSettings,
      firebaseUser,
    };
  }, [
    tenders,
    emdRecords,
    mafTrackers,
    firmProfile,
    adminPin,
    darkMode,
    whatsappSettings,
    sheetSettings,
    firebaseUser,
  ]);

  const mergeWhatsappLogs = (
    incoming: WhatsAppAlertLog[],
    existing: WhatsAppAlertLog[],
  ): WhatsAppAlertLog[] => {
    const byKey = new Map<string, WhatsAppAlertLog>();
    for (const item of [...incoming, ...existing]) {
      if (item.milestone !== 'test' && item.milestoneKey) {
        dispatchedWaKeysRef.current.add(item.milestoneKey);
      }
      const dedupeKey =
        item.milestone === 'test' ? `id:${item.id}` : `mk:${item.milestoneKey || item.id}`;
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

  // Require fresh login if browser restores page from bfcache (tab reopen/back-forward cache)
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setIsAuthenticated(false);
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

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

  // Listen for Firebase Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Initial Firestore load/seed + real-time Firestore subscription when authenticated
  useEffect(() => {
    if (!authReady || !firebaseUser) return;

    let cancelled = false;
    let unsubCloud: (() => void) | null = null;

    const initializeFirestoreSession = async () => {
      setCloudSyncing(true);
      try {
        await ensureUserRootDocument(firebaseUser);
        if (cancelled) return;

        const cloud = await fetchAllFromCloud(firebaseUser.uid);
        if (cancelled) return;

        attachmentFilesRef.current = cloud.attachmentFiles;

        const cloudIsEmpty =
          !cloud.profile &&
          !cloud.preferences &&
          cloud.tenders.length === 0 &&
          cloud.emdRecords.length === 0 &&
          cloud.mafTrackers.length === 0;

        if (cloudIsEmpty) {
          const {
            firmProfile: curProfile,
            tenders: curTenders,
            emdRecords: curEmd,
            mafTrackers: curMaf,
            adminPin: curPin,
            darkMode: curDark,
            whatsappSettings: curWaSettings,
            sheetSettings: curSheetSettings,
          } = stateRef.current;
          const prefs: UserPreferences = { adminPin: curPin, darkMode: curDark };
          await backupAllToCloud(firebaseUser, curProfile, prefs, curTenders, curEmd, curMaf);
          await syncWhatsAppConfigToCloud(firebaseUser, curWaSettings);
          await syncSheetConfigToCloud(firebaseUser, curSheetSettings);
          if (!cancelled) {
            markSyncedNow();
            setCloudFeedback({
              type: 'ok',
              msg: `Connected as ${firebaseUser.email}. All data is now stored exclusively in Firebase Firestore.`,
            });
          }
        } else {
          if (cloud.profile) {
            setFirmProfile((prev) => mergeCloudProfileWithLocal(cloud.profile!, prev));
          }
          if (cloud.preferences) {
            setAdminPin(cloud.preferences.adminPin);
            setDarkMode(cloud.preferences.darkMode);
          }
          if (cloud.whatsappConfig) {
            setWhatsappSettings(cloud.whatsappConfig);
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
          if (cloud.whatsappAlerts.length > 0) {
            setWhatsappLogs((prev) => mergeWhatsappLogs(cloud.whatsappAlerts, prev));
          }
          setTenders((prev) =>
            mergeCloudTendersWithFiles(cloud.tenders, cloud.attachmentFiles, prev),
          );
          setEmdRecords((prev) =>
            mergeCloudEmdWithFiles(cloud.emdRecords, cloud.attachmentFiles, prev),
          );
          if (cloud.mafTrackers.length > 0) {
            setMafTrackers((prev) =>
              mergeCloudMafTrackersWithFiles(cloud.mafTrackers, cloud.attachmentFiles, prev),
            );
          }
          markSyncedNow();
          setCloudFeedback((prev) => (prev?.type === 'err' ? null : prev));
        }

        if (cancelled) return;

        unsubCloud = subscribeToUserCloudData(firebaseUser.uid, {
          onProfile: (remoteProfile) => {
            setFirmProfile((prev) => mergeCloudProfileWithLocal(remoteProfile, prev));
            markSyncedNow();
          },
          onPreferences: (remotePrefs) => {
            setAdminPin(remotePrefs.adminPin);
            setDarkMode(remotePrefs.darkMode);
            markSyncedNow();
          },
          onWhatsAppConfig: (remoteConfig) => {
            setWhatsappSettings(remoteConfig);
            markSyncedNow();
          },
          onSheetConfig: (remoteSheetConfig) => {
            setSheetSettings(remoteSheetConfig);
            setSheetSyncStatus((prev) => {
              if (prev === 'syncing') return prev;
              if (!remoteSheetConfig.webhookUrl) return 'unconfigured';
              return remoteSheetConfig.lastSyncedAt ? 'synced' : 'idle';
            });
            markSyncedNow();
          },
          onWhatsAppAlerts: (remoteLogs) => {
            setWhatsappLogs((prev) => mergeWhatsappLogs(remoteLogs, prev));
            markSyncedNow();
          },
          onTenders: (remoteTenders) => {
            setTenders((prev) =>
              mergeCloudTendersWithFiles(remoteTenders, attachmentFilesRef.current, prev),
            );
            markSyncedNow();
          },
          onEmdRecords: (remoteEmd) => {
            setEmdRecords((prev) =>
              mergeCloudEmdWithFiles(remoteEmd, attachmentFilesRef.current, prev),
            );
            markSyncedNow();
          },
          onMafTrackers: (remoteMaf) => {
            setMafTrackers((prev) =>
              mergeCloudMafTrackersWithFiles(remoteMaf, attachmentFilesRef.current, prev),
            );
            markSyncedNow();
          },
          onAttachmentFiles: (remoteFiles) => {
            attachmentFilesRef.current = remoteFiles;
            setTenders((prev) => mergeCloudTendersWithFiles(prev, remoteFiles, prev));
            setEmdRecords((prev) => mergeCloudEmdWithFiles(prev, remoteFiles, prev));
            setMafTrackers((prev) => mergeCloudMafTrackersWithFiles(prev, remoteFiles, prev));
            markSyncedNow();
          },
          onError: (err) => {
            setCloudFeedback({ type: 'err', msg: formatCloudErrorMessage(err) });
          },
        });
      } catch (err) {
        if (!cancelled) {
          setCloudFeedback({ type: 'err', msg: formatCloudErrorMessage(err) });
        }
      } finally {
        if (!cancelled) {
          setCloudSyncing(false);
        }
      }
    };

    void initializeFirestoreSession();

    return () => {
      cancelled = true;
      if (unsubCloud) unsubCloud();
    };
  }, [authReady, firebaseUser]);

  const runCloudTask = async (task: (user: User) => Promise<void>, successMessage?: string) => {
    if (!firebaseUser) return;
    setCloudSyncing(true);
    try {
      await task(firebaseUser);
      markSyncedNow();
      if (successMessage) {
        setCloudFeedback({ type: 'ok', msg: successMessage });
      } else {
        setCloudFeedback((prev) => (prev?.type === 'err' ? null : prev));
      }
    } catch (err) {
      setCloudFeedback({ type: 'err', msg: formatCloudErrorMessage(err) });
    } finally {
      setCloudSyncing(false);
    }
  };

  const handleConnectCloud = async () => {
    setCloudFeedback(null);
    setCloudSyncing(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setCloudFeedback({ type: 'err', msg: formatCloudErrorMessage(err) });
    } finally {
      setCloudSyncing(false);
    }
  };

  const handleDisconnectCloud = async () => {
    setCloudSyncing(true);
    try {
      await signOut(auth);
      clearCloudSessionCache();
      setCloudFeedback({
        type: 'ok',
        msg: 'Signed out of Google Cloud. Sign back in anytime to read & save data in Firestore.',
      });
    } catch (err) {
      setCloudFeedback({ type: 'err', msg: formatCloudErrorMessage(err) });
    } finally {
      setCloudSyncing(false);
    }
  };

  const handleBackupToCloudNow = () => {
    const {
      firmProfile: curProfile,
      tenders: curTenders,
      emdRecords: curEmd,
      mafTrackers: curMaf,
      adminPin: curPin,
      darkMode: curDark,
    } = stateRef.current;
    const prefs: UserPreferences = { adminPin: curPin, darkMode: curDark };
    void runCloudTask(
      (user) => replaceCloudDataset(user, curProfile, prefs, curTenders, curEmd, curMaf),
      `Synced ${curTenders.length} tenders, ${curMaf.length} MAF trackers, ${curEmd.length} EMD/BG records & settings to Firestore.`,
    );
  };

  const handleRestoreFromCloud = () => {
    void runCloudTask(async (user) => {
      await ensureUserRootDocument(user);
      const cloud = await fetchAllFromCloud(user.uid);
      attachmentFilesRef.current = cloud.attachmentFiles;
      if (cloud.profile) {
        setFirmProfile((prev) => mergeCloudProfileWithLocal(cloud.profile!, prev));
      }
      if (cloud.preferences) {
        setAdminPin(cloud.preferences.adminPin);
        setDarkMode(cloud.preferences.darkMode);
      }
      setTenders((prev) =>
        mergeCloudTendersWithFiles(cloud.tenders, cloud.attachmentFiles, prev),
      );
      setEmdRecords((prev) =>
        mergeCloudEmdWithFiles(cloud.emdRecords, cloud.attachmentFiles, prev),
      );
      setMafTrackers((prev) =>
        mergeCloudMafTrackersWithFiles(cloud.mafTrackers, cloud.attachmentFiles, prev),
      );
    }, 'Reloaded latest data from Firebase Firestore.');
  };

  const cloudUserSummary: CloudUserSummary | null = firebaseUser
    ? {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.displayName,
        photoURL: firebaseUser.photoURL,
      }
    : null;

  const dispatchWhatsAppMilestone = async (
    tender: Tender,
    milestone: WhatsAppMilestone | 'test',
    explicitMilestoneKey?: string,
  ): Promise<void> => {
    const { whatsappSettings: curSettings, firebaseUser: curUser } = stateRef.current;
    const milestoneKey =
      explicitMilestoneKey ||
      (milestone === 'test'
        ? `wa_test_${Date.now()}`
        : buildWhatsAppMilestoneKey(tender, milestone));

    if (milestone !== 'test') {
      dispatchedWaKeysRef.current.add(milestoneKey);
    }

    const message = buildTenderWhatsAppMessage(tender, milestone, curSettings.recipientName);
    const normalizedPhone = normalizeIndianWhatsAppPhone(curSettings.recipientPhone);

    let logEntry: WhatsAppAlertLog = {
      id: milestone === 'test' ? milestoneKey : milestoneKey,
      milestoneKey,
      tenderRefId: tender.id,
      tenderId: tender.tenderId,
      milestone,
      recipientName: curSettings.recipientName,
      recipientPhone: normalizedPhone,
      dueDateIso: tender.submissionDueDate,
      status: 'manual_ready',
      provider: 'manual_ready',
      message,
      createdAt: new Date().toISOString(),
    };

    try {
      const res = await fetch('/api/notifications/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          milestoneKey,
          tenderRefId: tender.id,
          tenderId: tender.tenderId,
          milestone,
          recipientName: curSettings.recipientName,
          recipientPhone: curSettings.recipientPhone,
          dueDateIso: tender.submissionDueDate,
          message,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          ok?: boolean;
          deduplicated?: boolean;
          delivered?: boolean;
          logEntry?: WhatsAppAlertLog;
        };
        if (data.logEntry) {
          logEntry = data.logEntry;
        }
        if (!data.deduplicated) {
          const milestoneLabel =
            milestone === 'urgent_4h'
              ? '4h Urgent Reminder'
              : milestone === 'test'
                ? 'Test WhatsApp Alert'
                : 'Alerts Entry (48h)';
          showToast(
            'ok',
            data.delivered
              ? `WhatsApp ${milestoneLabel} sent to ${curSettings.recipientName} (+${normalizedPhone}) for ${tender.tenderId}.`
              : `WhatsApp ${milestoneLabel} prepared for ${curSettings.recipientName} (${tender.tenderId}). Open Alerts or Admin Settings to launch WhatsApp.`,
          );
        }
      }
    } catch {
      // Keep local logEntry fallback if network temporarily interrupted
    }

    setWhatsappLogs((prev) => mergeWhatsappLogs([logEntry], prev));
    if (curUser) {
      void syncWhatsAppAlertLogToCloud(curUser, logEntry).catch(() => {
        // Handled cleanly via subsequent cloud sync
      });
    }
  };

  // Load initial server WhatsApp gateway capabilities & persisted logs on authentication
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    const loadWhatsappStatus = async () => {
      try {
        const res = await fetch('/api/notifications/whatsapp/status');
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          provider?: string;
          automatedConfigured?: boolean;
          logs?: WhatsAppAlertLog[];
        };
        if (cancelled) return;
        setWhatsappGatewayInfo({
          automatedConfigured: Boolean(data.automatedConfigured),
          provider: data.provider || 'none',
        });
        if (Array.isArray(data.logs) && data.logs.length > 0) {
          setWhatsappLogs((prev) => mergeWhatsappLogs(data.logs!, prev));
        }
      } catch {
        // Ignore transient network errors
      }
    };
    void loadWhatsappStatus();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  // 2-Milestone WhatsApp Tender Alert Scheduler (checks immediately and every 30 seconds)
  useEffect(() => {
    if (!isAuthenticated || !whatsappSettings.enabled) return;

    const evaluateAndDispatch = () => {
      const pending = computePendingWhatsAppAlerts(
        stateRef.current.tenders,
        dispatchedWaKeysRef.current,
        new Date(),
      );
      for (const item of pending) {
        void dispatchWhatsAppMilestone(item.tender, item.milestone, item.milestoneKey);
      }
    };

    evaluateAndDispatch();
    const timer = window.setInterval(evaluateAndDispatch, 30_000);
    return () => window.clearInterval(timer);
  }, [isAuthenticated, whatsappSettings.enabled, tenders]);

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
        ownerUid: firebaseUser?.uid,
        profile: firmProfile,
        preferences: { adminPin, darkMode },
        tenders,
        emdRecords,
        mafTrackers,
        whatsappSettings,
        whatsappLogs,
        sheetSettings,
        attachmentFiles: attachmentFilesRef.current,
      }),
    [
      firebaseUser?.uid,
      firmProfile,
      adminPin,
      darkMode,
      tenders,
      emdRecords,
      mafTrackers,
      whatsappSettings,
      whatsappLogs,
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
    const att1 = findTenderAttachmentSlot(tender.attachments, 1);
    const att2 = findTenderAttachmentSlot(tender.attachments, 2);

    const resolveDataUrl = (att?: { id: string; dataUrl: string }) => {
      if (!att) return '';
      return att.dataUrl || attachmentFilesRef.current.get(att.id) || '';
    };

    const att1DataUrl = resolveDataUrl(att1);
    const att2DataUrl = resolveDataUrl(att2);

    // Attachment 2 (Specification / BOQ document) drives per-item breakdown
    if (!att2 || !att2DataUrl) return;

    const sig = buildTenderAttachmentExtractionSignature(tender);
    const prevSig = mafExtractionSignatureRef.current.get(tender.id);
    const normalizedTenderCode = tender.tenderId.trim().toLowerCase();
    const hasExistingTracker = stateRef.current.mafTrackers.some(
      (t) =>
        (t.tenderRefId && t.tenderRefId === tender.id) ||
        (normalizedTenderCode && t.tenderId.trim().toLowerCase() === normalizedTenderCode),
    );

    if (prevSig === sig && hasExistingTracker) {
      return;
    }

    try {
      const res = await fetch('/api/maf/extract-from-attachments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attachment1:
            att1 && att1DataUrl
              ? {
                  fileName: att1.fileName,
                  mimeType: att1.fileType,
                  dataUrl: att1DataUrl,
                }
              : null,
          attachment2: {
            fileName: att2.fileName,
            mimeType: att2.fileType,
            dataUrl: att2DataUrl,
          },
          fallbackDepartment: tender.department,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        department?: string;
        items?: ExtractedSpecItem[];
        error?: string;
      };

      if (!res.ok || !data.ok) {
        if (data.error) {
          showToast('err', `MAF auto-extraction: ${data.error}`);
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

      if (merged.targetTracker && stateRef.current.firebaseUser) {
        void runCloudTask((user) => syncMafTrackerToCloud(user, merged.targetTracker!));
      }

      if (merged.addedCount > 0) {
        showToast(
          'ok',
          `Auto-generated ${merged.addedCount} MAF item(s) for ${latestTender.tenderId} (Status: Pending).`,
        );
      }
    } catch {
      // Non-fatal: tender save itself already succeeded
    }
  };

  const pushToGoogleSheet = async (opts: {
    action: SheetSyncAction;
    entityType: SheetSyncEntityType;
    tender?: Tender | null;
    emdRecord?: EmdBgRecord | null;
    tendersSnapshot?: Tender[];
    emdSnapshot?: EmdBgRecord[];
    settingsOverride?: GoogleSheetSettings;
    force?: boolean;
  }): Promise<boolean> => {
    const cfg = opts.settingsOverride ?? stateRef.current.sheetSettings;
    const webhookUrl = (cfg.webhookUrl || '').trim();

    if (!webhookUrl || !isValidAppsScriptWebhookUrl(webhookUrl)) {
      if (opts.force) {
        const msg = 'Configure a valid Google Apps Script Webhook URL in Admin Settings first.';
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
      assignedOwner: stateRef.current.firmProfile.adminName,
      tender: opts.tender ?? null,
      emdRecord: opts.emdRecord ?? null,
      tenders: opts.tendersSnapshot ?? stateRef.current.tenders,
      emdRecords: opts.emdSnapshot ?? stateRef.current.emdRecords,
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
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        syncedAt?: string;
        scriptResponse?: { message?: string; spreadsheetName?: string };
      };

      if (!res.ok || data.ok === false) {
        const errMsg = data.error || `Google Sheet webhook returned HTTP ${res.status}.`;
        setSheetSyncStatus('error');
        setSheetSyncError(errMsg);
        showToast('err', errMsg);
        return false;
      }

      const syncedAt = data.syncedAt || new Date().toISOString();
      const updatedCfg: GoogleSheetSettings = {
        ...cfg,
        webhookUrl,
        lastSyncedAt: syncedAt,
      };
      stateRef.current.sheetSettings = updatedCfg;
      setSheetSettings(updatedCfg);
      setSheetSyncStatus('synced');
      setSheetSyncError(null);

      if (stateRef.current.firebaseUser) {
        void syncSheetConfigToCloud(stateRef.current.firebaseUser, updatedCfg).catch(() => {
          // Non-fatal: already updated in-memory
        });
      }

      if (opts.force) {
        const label =
          opts.action === 'PING'
            ? data.scriptResponse?.message ||
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
            return manual ? { ...item, oemName: manual.oemName, mafStatus: manual.mafStatus } : item;
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

    setTenderModalTarget(undefined);

    void runCloudTask(async (user) => {
      await syncTenderToCloud(user, saved);
      if (linkedRecordToSync) {
        await syncEmdRecordToCloud(user, linkedRecordToSync);
      }
      if (linkedMafToSync) {
        await syncMafTrackerToCloud(user, linkedMafToSync);
      }
      for (const updatedMaf of changedTrackers) {
        await syncMafTrackerToCloud(user, updatedMaf);
      }
    });

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
    const updated: Tender = {
      ...rawUpdated,
      updatedAt: new Date().toISOString(),
    };
    cacheAttachmentPayloads(updated.attachments);
    const nextTenders = stateRef.current.tenders.map((t) =>
      t.id === updated.id ? updated : t,
    );
    stateRef.current.tenders = nextTenders;
    setTenders(nextTenders);

    const syncedResult = buildSyncedMafTrackersForTender(
      updated,
      stateRef.current.mafTrackers,
    );
    const changedTrackers = syncedResult.changedTrackers;
    if (changedTrackers.length > 0) {
      stateRef.current.mafTrackers = syncedResult.nextTrackers;
      setMafTrackers(syncedResult.nextTrackers);
    }
    void runCloudTask(async (user) => {
      await syncTenderToCloud(user, updated);
      for (const updatedMaf of changedTrackers) {
        await syncMafTrackerToCloud(user, updatedMaf);
      }
    });

    void pushToGoogleSheet({
      action: 'UPDATE',
      entityType: 'TENDER',
      tender: updated,
      tendersSnapshot: nextTenders,
      emdSnapshot: stateRef.current.emdRecords,
    });

    void triggerAutoMafFromTender(updated);
  };

  const handleDeleteTender = (id: string) => {
    const deletedTender = stateRef.current.tenders.find((t) => t.id === id) ?? null;
    const nextTenders = stateRef.current.tenders.filter((t) => t.id !== id);
    stateRef.current.tenders = nextTenders;
    setTenders(nextTenders);

    if (selectedTenderId === id) {
      setSelectedTenderId(null);
    }
    void runCloudTask((user) => deleteTenderFromCloud(user, id));

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
      void runCloudTask((user) => syncEmdRecordToCloud(user, linked));
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
    void runCloudTask((user) => syncEmdRecordToCloud(user, saved));

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
    const nextEmdRecords = stateRef.current.emdRecords.filter((r) => r.id !== id);
    stateRef.current.emdRecords = nextEmdRecords;
    setEmdRecords(nextEmdRecords);
    void runCloudTask((user) => deleteEmdRecordFromCloud(user, id));

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

  // MAF Tracker Optimistic Handlers
  const syncMafOptimistic = async (
    prevSnapshot: MafTrackerRecord[],
    nextList: MafTrackerRecord[],
    cloudOp: (user: User) => Promise<void>,
    toastMsg: string,
  ) => {
    setMafTrackers(nextList);
    showToast('ok', toastMsg);
    if (!firebaseUser) return;
    setCloudSyncing(true);
    try {
      await cloudOp(firebaseUser);
      markSyncedNow();
      setCloudFeedback((prev) => (prev?.type === 'err' ? null : prev));
    } catch (err) {
      setMafTrackers(prevSnapshot);
      const formatted = formatCloudErrorMessage(err);
      showToast('err', formatted);
      setCloudFeedback({ type: 'err', msg: formatted });
    } finally {
      setCloudSyncing(false);
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
    void syncMafOptimistic(
      prevSnapshot,
      nextList,
      (user) => syncMafTrackerToCloud(user, canonicalTracker),
      exists
        ? `Updated MAF tracker for ${canonicalTracker.tenderId}.`
        : `Created MAF tracker for ${canonicalTracker.tenderId} (${canonicalTracker.itemsMAF.length} item(s)).`,
    );
  };

  const handleDeleteMafTracker = (trackerId: string) => {
    const prevSnapshot = stateRef.current.mafTrackers;
    const target = prevSnapshot.find((t) => t.id === trackerId);
    const nextList = prevSnapshot.filter((t) => t.id !== trackerId);
    void syncMafOptimistic(
      prevSnapshot,
      nextList,
      (user) => deleteMafTrackerFromCloud(user, trackerId),
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

    void syncMafOptimistic(
      prevSnapshot,
      nextList,
      (user) => syncMafTrackerToCloud(user, updatedTracker),
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

    void syncMafOptimistic(
      prevSnapshot,
      nextList,
      (user) => syncMafTrackerToCloud(user, updatedTracker),
      `${item?.oemName ?? 'OEM'} MAF status set to "${nextStatus}".`,
    );
  };

  const handleUploadMafFile = async (trackerId: string, itemId: string, file: File) => {
    const result = await uploadMafDocumentFile(firebaseUser, trackerId, itemId, file);
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
      await syncMafOptimistic(
        prevSnapshot,
        nextList,
        (user) => syncMafTrackerToCloud(user, updatedTracker),
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

    void syncMafOptimistic(
      prevSnapshot,
      nextList,
      (user) => syncMafTrackerToCloud(user, updatedTracker),
      `Removed "${removed?.itemName ?? 'item'}" from ${target.tenderId}.`,
    );
  };

  const handleSaveProfile = (nextProfile: FirmProfile) => {
    setFirmProfile(nextProfile);
    void runCloudTask((user) => syncProfileToCloud(user, nextProfile));
  };

  const handleSaveWhatsAppSettings = (nextSettings: WhatsAppSettings) => {
    setWhatsappSettings(nextSettings);
    void runCloudTask((user) => syncWhatsAppConfigToCloud(user, nextSettings));
  };

  const handleSaveSheetSettings = async (nextSettings: GoogleSheetSettings) => {
    stateRef.current.sheetSettings = nextSettings;
    setSheetSettings(nextSettings);
    setSheetSyncError(null);
    if (stateRef.current.firebaseUser) {
      void runCloudTask((user) => syncSheetConfigToCloud(user, nextSettings));
    }
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

  const handleTriggerTestWhatsApp = async () => {
    const sampleTender =
      stateRef.current.tenders.find(
        (t) => t.stage === 'Identified / Reviewing' || t.stage === 'Doc Preparation',
      ) ?? stateRef.current.tenders[0];
    if (!sampleTender) {
      showToast('err', 'Add at least one tender first to generate a WhatsApp tender alert.');
      return;
    }
    await dispatchWhatsAppMilestone(sampleTender, 'test');
  };

  const handleToggleDarkMode = () => {
    setDarkMode((prev) => {
      const next = !prev;
      void runCloudTask((user) =>
        syncPreferencesToCloud(user, { adminPin: stateRef.current.adminPin, darkMode: next }),
      );
      return next;
    });
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setMobileMenuOpen(false);
    setTenderModalTarget(undefined);
    setSelectedTenderId(null);
    setEmdModalTarget(undefined);
    setMafTrackerModalTarget(undefined);
    setMafItemModalTarget(null);
  };

  const handleNavigateFromNotification = (item: NotificationItem) => {
    setActiveTab(item.targetTab);
    if (item.targetTab === 'tenders') {
      setSelectedTenderId(item.targetId);
    }
  };

  const handleImportBackup = (payload: CrmBackupPayload) => {
    for (const t of payload.tenders) cacheAttachmentPayloads(t.attachments);
    for (const r of payload.emdRecords) cacheAttachmentPayloads(r.attachments);
    for (const m of payload.mafTrackers ?? []) cacheMafPayloads(m.itemsMAF);

    const nextMaf = payload.mafTrackers ?? [];
    stateRef.current.tenders = payload.tenders;
    stateRef.current.emdRecords = payload.emdRecords;
    stateRef.current.firmProfile = payload.profile;
    setFirmProfile(payload.profile);
    setTenders(payload.tenders);
    setEmdRecords(payload.emdRecords);
    setMafTrackers(nextMaf);

    const prefs: UserPreferences = {
      adminPin: stateRef.current.adminPin,
      darkMode: stateRef.current.darkMode,
    };
    void runCloudTask((user) =>
      replaceCloudDataset(
        user,
        payload.profile,
        prefs,
        payload.tenders,
        payload.emdRecords,
        nextMaf,
      ),
    );
    void pushToGoogleSheet({
      action: 'FULL_SYNC',
      entityType: 'BULK',
      tendersSnapshot: payload.tenders,
      emdSnapshot: payload.emdRecords,
    });
  };

  const handleResetDemoData = () => {
    stateRef.current.firmProfile = DEFAULT_FIRM_PROFILE;
    stateRef.current.tenders = SEED_TENDERS;
    stateRef.current.emdRecords = SEED_EMD_RECORDS;
    setFirmProfile(DEFAULT_FIRM_PROFILE);
    setTenders(SEED_TENDERS);
    setEmdRecords(SEED_EMD_RECORDS);
    setMafTrackers(SEED_MAF_TRACKERS);
    setSelectedTenderId(null);
    const prefs: UserPreferences = {
      adminPin: stateRef.current.adminPin,
      darkMode: stateRef.current.darkMode,
    };
    void runCloudTask((user) =>
      replaceCloudDataset(
        user,
        DEFAULT_FIRM_PROFILE,
        prefs,
        SEED_TENDERS,
        SEED_EMD_RECORDS,
        SEED_MAF_TRACKERS,
      ),
    );
    void pushToGoogleSheet({
      action: 'FULL_SYNC',
      entityType: 'BULK',
      tendersSnapshot: SEED_TENDERS,
      emdSnapshot: SEED_EMD_RECORDS,
    });
  };

  const handleClearAllData = () => {
    attachmentFilesRef.current.clear();
    stateRef.current.tenders = [];
    stateRef.current.emdRecords = [];
    setTenders([]);
    setEmdRecords([]);
    setMafTrackers([]);
    setSelectedTenderId(null);
    const prefs: UserPreferences = {
      adminPin: stateRef.current.adminPin,
      darkMode: stateRef.current.darkMode,
    };
    void runCloudTask((user) =>
      replaceCloudDataset(user, stateRef.current.firmProfile, prefs, [], [], []),
    );
    void pushToGoogleSheet({
      action: 'FULL_SYNC',
      entityType: 'BULK',
      tendersSnapshot: [],
      emdSnapshot: [],
    });
  };

  if (!isAuthenticated) {
    return (
      <LoginPage
        onLoginSuccess={() => {
          setIsAuthenticated(true);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen flex bg-[#F8FAFC] dark:bg-[#0B1120] text-slate-900 dark:text-slate-100">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        firmProfile={firmProfile}
        tenderCount={tenders.length}
        mafCount={mafTrackers.length}
        emdCount={emdRecords.length}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        onLogout={handleLogout}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Header
          activeTab={activeTab}
          firmProfile={firmProfile}
          darkMode={darkMode}
          onToggleDarkMode={handleToggleDarkMode}
          onLogout={handleLogout}
          notifications={notifications}
          tenders={tenders}
          whatsappSettings={whatsappSettings}
          whatsappLogs={whatsappLogs}
          onNavigateFromNotification={handleNavigateFromNotification}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          cloudUser={cloudUserSummary}
          cloudSyncing={cloudSyncing}
          cloudError={cloudFeedback?.type === 'err'}
          onConnectCloud={handleConnectCloud}
          onOpenCloudSettings={() => setActiveTab('settings')}
          sheetSyncStatus={sheetSyncStatus}
          sheetSyncError={sheetSyncError}
          onOpenSheetSettings={() => setActiveTab('settings')}
        />

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto space-y-4">
          {authReady && !firebaseUser && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 dark:border-blue-900/70 bg-blue-50/80 dark:bg-blue-950/30 px-4 py-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Cloud className="h-4 w-4 text-[#1E3A8A] dark:text-blue-400 shrink-0" aria-hidden="true" />
                <p className="text-xs text-slate-800 dark:text-slate-200">
                  <span className="font-semibold">Firestore Cloud Mode:</span> Browser storage is disabled. Sign in with Google to save and load all tenders, MAF statuses, EMD/BG records, and attachments in Firebase Firestore.
                </p>
              </div>
              <button
                type="button"
                onClick={handleConnectCloud}
                disabled={cloudSyncing}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap shrink-0"
              >
                <CloudUpload className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{cloudSyncing ? 'Connecting...' : 'Sign in with Google'}</span>
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
                {cloudFeedback.type === 'err' && firebaseUser && (
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
                setActiveTab('tenders');
                setSelectedTenderId(tender.id);
              }}
              onGoToEmdBg={() => setActiveTab('emdbg')}
            />
          )}

          {activeTab === 'bidsearch' && (
            <BidSearchTab
              tenders={tenders}
              onSaveScannedTender={(saved, syncToEmd) => handleSaveTender(saved, syncToEmd)}
              onOpenExistingTender={(tender) => {
                setActiveTab('tenders');
                setSelectedTenderId(tender.id);
              }}
              onAddManualTender={() => setTenderModalTarget(null)}
              onGoToDailyTenders={() => setActiveTab('tenders')}
              onNotify={showToast}
            />
          )}

          {activeTab === 'tenders' && (
            <TendersTab
              tenders={tenders}
              emdRecords={emdRecords}
              onAddTender={() => setTenderModalTarget(null)}
              onEditTender={(tender) => setTenderModalTarget(tender)}
              onOpenTender={(tender) => setSelectedTenderId(tender.id)}
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

          {activeTab === 'settings' && (
            <SettingsTab
              profile={firmProfile}
              tenders={tenders}
              emdRecords={emdRecords}
              mafTrackers={mafTrackers}
              onSaveProfile={handleSaveProfile}
              onLogout={handleLogout}
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
              whatsappSettings={whatsappSettings}
              whatsappLogs={whatsappLogs}
              whatsappGatewayInfo={whatsappGatewayInfo}
              onSaveWhatsAppSettings={handleSaveWhatsAppSettings}
              onTriggerTestWhatsApp={handleTriggerTestWhatsApp}
              sheetSettings={sheetSettings}
              sheetSyncStatus={sheetSyncStatus}
              sheetSyncError={sheetSyncError}
              onSaveSheetSettings={handleSaveSheetSettings}
              onTestSheetWebhook={handleTestSheetWebhook}
              onFullSyncToSheet={handleFullSyncToSheet}
              storageUsage={cloudStorageSummary}
            />
          )}
        </main>
      </div>

      {/* Modals & Slide-over Drawers */}
      {selectedTender && (
        <TenderDetailDrawer
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
          onClose={() => setTenderModalTarget(undefined)}
          onSave={handleSaveTender}
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
