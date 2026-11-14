import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
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
  syncProfileToCloud,
  syncTenderToCloud,
} from './utils/cloudSync';
import {
  mergeCloudEmdWithLocal,
  mergeCloudProfileWithLocal,
  mergeCloudTendersWithLocal,
} from './utils/cloudSyncHelpers';

const STORAGE_KEYS = {
  TENDERS: 'bidledger_tenders_v1',
  EMD: 'bidledger_emd_records_v1',
  PROFILE: 'bidledger_firm_profile_v1',
  PIN: 'bidledger_admin_pin_v1',
  DARK_MODE: 'bidledger_dark_mode_v1',
  LAST_CLOUD_SYNC: 'bidledger_last_cloud_sync_v1',
} as const;

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

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
  return 'Could not sync with Google Cloud. Your data remains safely saved locally.';
}

export default function App() {
  const [tenders, setTenders] = useState<Tender[]>(() =>
    readStorage(STORAGE_KEYS.TENDERS, SEED_TENDERS),
  );
  const [emdRecords, setEmdRecords] = useState<EmdBgRecord[]>(() =>
    readStorage(STORAGE_KEYS.EMD, SEED_EMD_RECORDS),
  );
  const [firmProfile, setFirmProfile] = useState<FirmProfile>(() =>
    readStorage(STORAGE_KEYS.PROFILE, DEFAULT_FIRM_PROFILE),
  );
  const [adminPin, setAdminPin] = useState<string>(() =>
    readStorage(STORAGE_KEYS.PIN, '1234'),
  );
  const [darkMode, setDarkMode] = useState<boolean>(() =>
    readStorage(STORAGE_KEYS.DARK_MODE, false),
  );

  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [isLocked, setIsLocked] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Firebase Cloud Backup state
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [lastCloudSyncAt, setLastCloudSyncAt] = useState<string | null>(() =>
    readStorage<string | null>(STORAGE_KEYS.LAST_CLOUD_SYNC, null),
  );
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

  // Keep fresh state refs for async cloud listeners & initial handshake
  const stateRef = useRef({ tenders, emdRecords, firmProfile });
  useEffect(() => {
    stateRef.current = { tenders, emdRecords, firmProfile };
  }, [tenders, emdRecords, firmProfile]);

  const markSyncedNow = () => {
    const iso = new Date().toISOString();
    setLastCloudSyncAt(iso);
    localStorage.setItem(STORAGE_KEYS.LAST_CLOUD_SYNC, JSON.stringify(iso));
  };

  // Persist to localStorage automatically
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.TENDERS, JSON.stringify(tenders));
  }, [tenders]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.EMD, JSON.stringify(emdRecords));
  }, [emdRecords]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(firmProfile));
  }, [firmProfile]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PIN, JSON.stringify(adminPin));
  }, [adminPin]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.DARK_MODE, JSON.stringify(darkMode));
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // Listen for Firebase Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Initial cloud handshake + real-time Firestore subscription when authenticated
  useEffect(() => {
    if (!authReady || !firebaseUser) return;

    let cancelled = false;
    let unsubCloud: (() => void) | null = null;

    const initializeCloudSync = async () => {
      setCloudSyncing(true);
      try {
        const cloud = await fetchAllFromCloud(firebaseUser.uid);
        if (cancelled) return;

        const cloudIsEmpty =
          !cloud.profile && cloud.tenders.length === 0 && cloud.emdRecords.length === 0;

        if (cloudIsEmpty) {
          const { firmProfile: curProfile, tenders: curTenders, emdRecords: curEmd } =
            stateRef.current;
          await backupAllToCloud(firebaseUser, curProfile, curTenders, curEmd);
          if (!cancelled) {
            markSyncedNow();
            setCloudFeedback({
              type: 'ok',
              msg: `Connected as ${firebaseUser.email} and backed up ${curTenders.length} tenders & ${curEmd.length} EMD/BG records to Google Cloud.`,
            });
          }
        } else {
          if (cloud.profile) {
            setFirmProfile((prev) => mergeCloudProfileWithLocal(cloud.profile!, prev));
          }
          if (cloud.tenders.length > 0) {
            setTenders((prev) => mergeCloudTendersWithLocal(cloud.tenders, prev));
          }
          if (cloud.emdRecords.length > 0) {
            setEmdRecords((prev) => mergeCloudEmdWithLocal(cloud.emdRecords, prev));
          }
          markSyncedNow();
        }

        if (cancelled) return;

        unsubCloud = subscribeToUserCloudData(firebaseUser.uid, {
          onProfile: (remoteProfile) => {
            setFirmProfile((prev) => mergeCloudProfileWithLocal(remoteProfile, prev));
            markSyncedNow();
          },
          onTenders: (remoteTenders) => {
            setTenders((prev) => mergeCloudTendersWithLocal(remoteTenders, prev));
            markSyncedNow();
          },
          onEmdRecords: (remoteEmd) => {
            setEmdRecords((prev) => mergeCloudEmdWithLocal(remoteEmd, prev));
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

    void initializeCloudSync();

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
        msg: 'Google Cloud disconnected. Local browser saving remains active.',
      });
    } catch (err) {
      setCloudFeedback({ type: 'err', msg: formatCloudErrorMessage(err) });
    } finally {
      setCloudSyncing(false);
    }
  };

  const handleBackupToCloudNow = () => {
    const { firmProfile: curProfile, tenders: curTenders, emdRecords: curEmd } =
      stateRef.current;
    void runCloudTask(
      (user) => replaceCloudDataset(user, curProfile, curTenders, curEmd),
      `Backed up ${curTenders.length} tenders, ${curEmd.length} EMD/BG records & firm profile to Google Cloud.`,
    );
  };

  const handleRestoreFromCloud = () => {
    void runCloudTask(async (user) => {
      const cloud = await fetchAllFromCloud(user.uid);
      if (cloud.profile) {
        setFirmProfile((prev) => mergeCloudProfileWithLocal(cloud.profile!, prev));
      }
      setTenders((prev) => mergeCloudTendersWithLocal(cloud.tenders, prev));
      setEmdRecords((prev) => mergeCloudEmdWithLocal(cloud.emdRecords, prev));
    }, 'Restored latest data from Google Cloud.');
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

  const handleSaveTender = (saved: Tender, syncToEmd: boolean) => {
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

  const handleNavigateFromNotification = (item: NotificationItem) => {
    setActiveTab(item.targetTab);
    if (item.targetTab === 'tenders') {
      setSelectedTenderId(item.targetId);
    }
  };

  const handleImportBackup = (payload: CrmBackupPayload) => {
    setFirmProfile(payload.profile);
    setTenders(payload.tenders);
    setEmdRecords(payload.emdRecords);
    void runCloudTask((user) =>
      replaceCloudDataset(user, payload.profile, payload.tenders, payload.emdRecords),
    );
  };

  const handleResetDemoData = () => {
    setFirmProfile(DEFAULT_FIRM_PROFILE);
    setTenders(SEED_TENDERS);
    setEmdRecords(SEED_EMD_RECORDS);
    setSelectedTenderId(null);
    void runCloudTask((user) =>
      replaceCloudDataset(user, DEFAULT_FIRM_PROFILE, SEED_TENDERS, SEED_EMD_RECORDS),
    );
  };

  const handleClearAllData = () => {
    setTenders([]);
    setEmdRecords([]);
    setSelectedTenderId(null);
    void runCloudTask((user) =>
      replaceCloudDataset(user, stateRef.current.firmProfile, [], []),
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
          onToggleDarkMode={() => setDarkMode((prev) => !prev)}
          onLockScreen={() => setIsLocked(true)}
          notifications={notifications}
          onNavigateFromNotification={handleNavigateFromNotification}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          cloudUser={cloudUserSummary}
          cloudSyncing={cloudSyncing}
          onConnectCloud={handleConnectCloud}
          onOpenCloudSettings={() => setActiveTab('settings')}
        />

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
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
              onUpdatePin={setAdminPin}
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
