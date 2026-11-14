import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { Cloud, CloudUpload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DashboardTab } from './components/DashboardTab';
import { EmdBgFormModal } from './components/EmdBgFormModal';
import { EmdBgTab } from './components/EmdBgTab';
import { Header, type CloudUserSummary } from './components/Header';
import { LockScreen } from './components/LockScreen';
import { SettingsTab } from './components/SettingsTab';
import { Sidebar } from './components/Sidebar';
import { TenderDetailDrawer } from './components/TenderDetailDrawer';
import { TenderFormModal } from './components/TenderFormModal';
import { TendersTab } from './components/TendersTab';
import {
  DEFAULT_FIRM_PROFILE,
  SEED_EMD_RECORDS,
  SEED_TENDERS,
} from './data/seedData';
import { auth, firebaseConfig, googleProvider } from './lib/firebase';
import type {
  CrmBackupPayload,
  EmdBgRecord,
  FirmProfile,
  NotificationItem,
  TabKey,
  Tender,
  UserPreferences,
} from './types/crm';
import { computeNotifications } from './utils/calculations';
import {
  backupAllToCloud,
  deleteEmdRecordFromCloud,
  deleteTenderFromCloud,
  fetchAllFromCloud,
  replaceCloudDataset,
  subscribeToUserCloudData,
  syncEmdRecordToCloud,
  syncPreferencesToCloud,
  syncProfileToCloud,
  syncTenderToCloud,
} from './utils/cloudSync';
import {
  mergeCloudEmdWithFiles,
  mergeCloudProfileWithLocal,
  mergeCloudTendersWithFiles,
} from './utils/cloudSyncHelpers';

function formatCloudErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes("Quota exceeded for quota metric 'Free daily read units per project")) {
    return `Firestore daily read quota reached. Upgrade or check usage at https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/databases/${firebaseConfig.firestoreDatabaseId}/data?openUpgradeDialog=true`;
  }
  if (raw.includes('Quota exceeded')) {
    return 'Google Cloud Firestore daily free-tier quota exceeded. Quota resets tomorrow.';
  }
  if (raw.includes('auth/popup-closed-by-user')) {
    return 'Google Sign-In popup was closed before completing authentication.';
  }
  if (raw.includes('auth/popup-blocked')) {
    return 'Sign-In popup was blocked by your browser. Please allow popups for this site.';
  }
  return 'Could not sync with Firebase Firestore. Please check your connection and try again.';
}

export default function App() {
  const [tenders, setTenders] = useState<Tender[]>(SEED_TENDERS);
  const [emdRecords, setEmdRecords] = useState<EmdBgRecord[]>(SEED_EMD_RECORDS);
  const [firmProfile, setFirmProfile] = useState<FirmProfile>(DEFAULT_FIRM_PROFILE);
  const [adminPin, setAdminPin] = useState<string>('1234');
  const [darkMode, setDarkMode] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [isLocked, setIsLocked] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Firebase Firestore State
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [lastCloudSyncAt, setLastCloudSyncAt] = useState<string | null>(null);
  const [cloudFeedback, setCloudFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(
    null,
  );

  // Modal & Drawer states
  const [tenderModalTarget, setTenderModalTarget] = useState<Tender | null | undefined>(
    undefined, // undefined = closed, null = new, Tender = edit
  );
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
  const [emdModalTarget, setEmdModalTarget] = useState<EmdBgRecord | null | undefined>(
    undefined,
  );

  // In-memory refs for async Firestore listeners and attachment payloads
  const attachmentFilesRef = useRef<Map<string, string>>(new Map());
  const stateRef = useRef({ tenders, emdRecords, firmProfile, adminPin, darkMode });
  useEffect(() => {
    stateRef.current = { tenders, emdRecords, firmProfile, adminPin, darkMode };
  }, [tenders, emdRecords, firmProfile, adminPin, darkMode]);

  // Apply Dark Mode class on root element (no localStorage)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

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
        const cloud = await fetchAllFromCloud(firebaseUser.uid);
        if (cancelled) return;

        attachmentFilesRef.current = cloud.attachmentFiles;

        const cloudIsEmpty =
          !cloud.profile &&
          !cloud.preferences &&
          cloud.tenders.length === 0 &&
          cloud.emdRecords.length === 0;

        if (cloudIsEmpty) {
          const {
            firmProfile: curProfile,
            tenders: curTenders,
            emdRecords: curEmd,
            adminPin: curPin,
            darkMode: curDark,
          } = stateRef.current;
          const prefs: UserPreferences = { adminPin: curPin, darkMode: curDark };
          await backupAllToCloud(firebaseUser, curProfile, prefs, curTenders, curEmd);
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
          setTenders((prev) =>
            mergeCloudTendersWithFiles(cloud.tenders, cloud.attachmentFiles, prev),
          );
          setEmdRecords((prev) =>
            mergeCloudEmdWithFiles(cloud.emdRecords, cloud.attachmentFiles, prev),
          );
          markSyncedNow();
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
          onAttachmentFiles: (remoteFiles) => {
            attachmentFilesRef.current = remoteFiles;
            setTenders((prev) => mergeCloudTendersWithFiles(prev, remoteFiles, prev));
            setEmdRecords((prev) => mergeCloudEmdWithFiles(prev, remoteFiles, prev));
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
      adminPin: curPin,
      darkMode: curDark,
    } = stateRef.current;
    const prefs: UserPreferences = { adminPin: curPin, darkMode: curDark };
    void runCloudTask(
      (user) => replaceCloudDataset(user, curProfile, prefs, curTenders, curEmd),
      `Synced ${curTenders.length} tenders, ${curEmd.length} EMD/BG records & firm settings to Firebase Firestore.`,
    );
  };

  const handleRestoreFromCloud = () => {
    void runCloudTask(async (user) => {
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

  const notifications = useMemo(
    () => computeNotifications(tenders, emdRecords),
    [tenders, emdRecords],
  );

  const selectedTender = useMemo(
    () => tenders.find((t) => t.id === selectedTenderId) ?? null,
    [tenders, selectedTenderId],
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

  const handleSaveTender = (saved: Tender, syncToEmd: boolean) => {
    cacheAttachmentPayloads(saved.attachments);
    setTenders((prev) => {
      const exists = prev.some((t) => t.id === saved.id);
      if (exists) {
        return prev.map((t) => (t.id === saved.id ? saved : t));
      }
      return [saved, ...prev];
    });

    let linkedRecordToSync: EmdBgRecord | null = null;
    if (syncToEmd && saved.emdAmount > 0) {
      const alreadyLinked = emdRecords.some(
        (r) => r.tenderId.toLowerCase() === saved.tenderId.toLowerCase(),
      );
      if (!alreadyLinked) {
        linkedRecordToSync = createLinkedEmdRecord(saved);
        setEmdRecords((prev) => [linkedRecordToSync!, ...prev]);
      }
    }

    setTenderModalTarget(undefined);

    void runCloudTask(async (user) => {
      await syncTenderToCloud(user, saved);
      if (linkedRecordToSync) {
        await syncEmdRecordToCloud(user, linkedRecordToSync);
      }
    });
  };

  const handleUpdateTenderInline = (updated: Tender) => {
    cacheAttachmentPayloads(updated.attachments);
    setTenders((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    void runCloudTask((user) => syncTenderToCloud(user, updated));
  };

  const handleDeleteTender = (id: string) => {
    setTenders((prev) => prev.filter((t) => t.id !== id));
    if (selectedTenderId === id) {
      setSelectedTenderId(null);
    }
    void runCloudTask((user) => deleteTenderFromCloud(user, id));
  };

  const handleSyncTenderToEmd = (tender: Tender) => {
    const alreadyExists = emdRecords.some(
      (r) => r.tenderId.toLowerCase() === tender.tenderId.toLowerCase(),
    );
    if (!alreadyExists && tender.emdAmount > 0) {
      const linked = createLinkedEmdRecord(tender);
      setEmdRecords((prev) => [linked, ...prev]);
      void runCloudTask((user) => syncEmdRecordToCloud(user, linked));
    }
  };

  const handleSaveEmdRecord = (saved: EmdBgRecord) => {
    cacheAttachmentPayloads(saved.attachments);
    setEmdRecords((prev) => {
      const exists = prev.some((r) => r.id === saved.id);
      if (exists) {
        return prev.map((r) => (r.id === saved.id ? saved : r));
      }
      return [saved, ...prev];
    });
    setEmdModalTarget(undefined);
    void runCloudTask((user) => syncEmdRecordToCloud(user, saved));
  };

  const handleDeleteEmdRecord = (id: string) => {
    setEmdRecords((prev) => prev.filter((r) => r.id !== id));
    void runCloudTask((user) => deleteEmdRecordFromCloud(user, id));
  };

  const handleSaveProfile = (nextProfile: FirmProfile) => {
    setFirmProfile(nextProfile);
    void runCloudTask((user) => syncProfileToCloud(user, nextProfile));
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

  const handleUpdatePin = (newPin: string) => {
    setAdminPin(newPin);
    void runCloudTask((user) =>
      syncPreferencesToCloud(user, { adminPin: newPin, darkMode: stateRef.current.darkMode }),
    );
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
    setFirmProfile(payload.profile);
    setTenders(payload.tenders);
    setEmdRecords(payload.emdRecords);
    const prefs: UserPreferences = {
      adminPin: stateRef.current.adminPin,
      darkMode: stateRef.current.darkMode,
    };
    void runCloudTask((user) =>
      replaceCloudDataset(user, payload.profile, prefs, payload.tenders, payload.emdRecords),
    );
  };

  const handleResetDemoData = () => {
    setFirmProfile(DEFAULT_FIRM_PROFILE);
    setTenders(SEED_TENDERS);
    setEmdRecords(SEED_EMD_RECORDS);
    setSelectedTenderId(null);
    const prefs: UserPreferences = {
      adminPin: stateRef.current.adminPin,
      darkMode: stateRef.current.darkMode,
    };
    void runCloudTask((user) =>
      replaceCloudDataset(user, DEFAULT_FIRM_PROFILE, prefs, SEED_TENDERS, SEED_EMD_RECORDS),
    );
  };

  const handleClearAllData = () => {
    attachmentFilesRef.current.clear();
    setTenders([]);
    setEmdRecords([]);
    setSelectedTenderId(null);
    const prefs: UserPreferences = {
      adminPin: stateRef.current.adminPin,
      darkMode: stateRef.current.darkMode,
    };
    void runCloudTask((user) =>
      replaceCloudDataset(user, stateRef.current.firmProfile, prefs, [], []),
    );
  };

  return (
    <div className="min-h-screen flex bg-[#F8FAFC] dark:bg-[#0B1120] text-slate-900 dark:text-slate-100">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        firmProfile={firmProfile}
        tenderCount={tenders.length}
        emdCount={emdRecords.length}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Header
          activeTab={activeTab}
          firmProfile={firmProfile}
          darkMode={darkMode}
          onToggleDarkMode={handleToggleDarkMode}
          onLockScreen={() => setIsLocked(true)}
          notifications={notifications}
          onNavigateFromNotification={handleNavigateFromNotification}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          cloudUser={cloudUserSummary}
          cloudSyncing={cloudSyncing}
          onConnectCloud={handleConnectCloud}
          onOpenCloudSettings={() => setActiveTab('settings')}
        />

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto space-y-4">
          {authReady && !firebaseUser && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 dark:border-blue-900/70 bg-blue-50/80 dark:bg-blue-950/30 px-4 py-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Cloud className="h-4 w-4 text-[#1E3A8A] dark:text-blue-400 shrink-0" aria-hidden="true" />
                <p className="text-xs text-slate-800 dark:text-slate-200">
                  <span className="font-semibold">Firestore Cloud Mode:</span> Browser storage is disabled. Sign in with Google to save and load all tenders, EMD/BG records, and attachments in Firebase Firestore.
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

          {activeTab === 'tenders' && (
            <TendersTab
              tenders={tenders}
              emdRecords={emdRecords}
              onAddTender={() => setTenderModalTarget(null)}
              onEditTender={(tender) => setTenderModalTarget(tender)}
              onOpenTender={(tender) => setSelectedTenderId(tender.id)}
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
              currentPin={adminPin}
              tenders={tenders}
              emdRecords={emdRecords}
              onSaveProfile={handleSaveProfile}
              onUpdatePin={handleUpdatePin}
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
            />
          )}
        </main>
      </div>

      {/* Modals & Slide-over Drawers */}
      {tenderModalTarget !== undefined && (
        <TenderFormModal
          initialTender={tenderModalTarget}
          onClose={() => setTenderModalTarget(undefined)}
          onSave={handleSaveTender}
        />
      )}

      {selectedTender && (
        <TenderDetailDrawer
          tender={selectedTender}
          linkedEmdRecord={emdRecords.find(
            (r) => r.tenderId.toLowerCase() === selectedTender.tenderId.toLowerCase(),
          )}
          onClose={() => setSelectedTenderId(null)}
          onEdit={(t) => setTenderModalTarget(t)}
          onDelete={handleDeleteTender}
          onUpdateTender={handleUpdateTenderInline}
          onSyncToEmdTracker={handleSyncTenderToEmd}
          onGoToEmdTab={() => {
            setSelectedTenderId(null);
            setActiveTab('emdbg');
          }}
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

      {isLocked && (
        <LockScreen
          expectedPin={adminPin}
          firmProfile={firmProfile}
          onUnlock={() => setIsLocked(false)}
        />
      )}
    </div>
  );
}
