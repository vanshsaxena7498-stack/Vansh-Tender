import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  BookOpen,
  Building2,
  Check,
  CheckCircle2,
  Cloud,
  CloudDownload,
  CloudUpload,
  Code2,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileSpreadsheet,
  HardDrive,
  Lock,
  LogOut,
  Mail,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Trash2,
  Unlock,
  Upload,
  User,
  Users,
  X,
} from 'lucide-react';
import {
  BYOC_FIRESTORE_RULES_TEMPLATE,
  buildByocConsoleUrl,
  parseFirebaseConfigSnippet,
  validateByocFirebaseConfig,
} from '../lib/byocFirebase';
import { firebaseConfig } from '../lib/firebase';
import type {
  ByocConnectionState,
  ByocFirebaseConfig,
  CrmBackupPayload,
  CrmUserSession,
  EmailAlertLog,
  EmailAlertSettings,
  EmdBgRecord,
  FirmProfile,
  GoogleSheetSettings,
  MafTrackerRecord,
  OemRecord,
  SecondaryUserSummary,
  SheetSyncStatus,
  Tender,
} from '../types/crm';
import { compressProfilePhotoDataUrl } from '../utils/attachments';
import { computeEffectivePresenceStatus } from '../utils/authCredentials';
import { formatSlotLabel, isValidNotificationEmail } from '../utils/emailAlerts';
import { buildCsvContent, downloadTextFile, formatDateTime } from '../utils/formatters';
import {
  GOOGLE_APPS_SCRIPT_CODE_GS,
  isValidAppsScriptWebhookUrl,
} from '../utils/googleSheetSync';
import { formatStorageSize, type CloudStorageSummary } from '../utils/storageUsage';
import type { CloudUserSummary } from './Header';

interface SettingsTabProps {
  profile: FirmProfile;
  tenders: Tender[];
  emdRecords: EmdBgRecord[];
  mafTrackers: MafTrackerRecord[];
  oemRecords: OemRecord[];
  onSaveProfile: (profile: FirmProfile) => void;
  onLogout: () => void;
  onImportBackup: (payload: CrmBackupPayload) => void;
  onResetDemoData: () => void;
  onClearAllData: () => void;
  cloudUser: CloudUserSummary | null;
  cloudSyncing: boolean;
  lastCloudSyncAt: string | null;
  cloudFeedback: { type: 'ok' | 'err'; msg: string } | null;
  onConnectCloud: () => void;
  onDisconnectCloud: () => void;
  onBackupToCloudNow: () => void;
  onRestoreFromCloud: () => void;
  emailSettings: EmailAlertSettings;
  emailLogs: EmailAlertLog[];
  emailGatewayInfo: { automatedConfigured: boolean; provider: string };
  onSaveEmailSettings: (settings: EmailAlertSettings) => void;
  onTriggerTestEmail: () => Promise<void> | void;
  sheetSettings: GoogleSheetSettings;
  sheetSyncStatus: SheetSyncStatus;
  sheetSyncError: string | null;
  onSaveSheetSettings: (settings: GoogleSheetSettings) => Promise<void> | void;
  onTestSheetWebhook: (settingsOverride?: GoogleSheetSettings) => Promise<void>;
  onFullSyncToSheet: (settingsOverride?: GoogleSheetSettings) => Promise<void>;
  storageUsage: CloudStorageSummary;
  currentUser?: CrmUserSession | null;
  secondaryUsers?: SecondaryUserSummary[];
  onRefreshSecondaryUsers?: () => void;
  byocConfig?: ByocFirebaseConfig | null;
  byocConnection?: ByocConnectionState;
  onSaveByocConfig?: (config: ByocFirebaseConfig) => Promise<void> | void;
  onTestByocConnection?: (config: ByocFirebaseConfig) => Promise<ByocConnectionState>;
  onClearByocConfig?: () => Promise<void> | void;
  onToggleSecondaryUserStatus?: (userId: string, enable: boolean) => Promise<void> | void;
  togglingUserId?: string | null;
}

export function SettingsTab({
  profile,
  tenders,
  emdRecords,
  mafTrackers,
  oemRecords,
  onSaveProfile,
  onLogout,
  onImportBackup,
  onResetDemoData,
  onClearAllData,
  cloudUser,
  cloudSyncing,
  lastCloudSyncAt,
  cloudFeedback,
  onConnectCloud,
  onDisconnectCloud,
  onBackupToCloudNow,
  onRestoreFromCloud,
  emailSettings,
  emailLogs,
  emailGatewayInfo,
  onSaveEmailSettings,
  onTriggerTestEmail,
  sheetSettings,
  sheetSyncStatus,
  sheetSyncError,
  onSaveSheetSettings,
  onTestSheetWebhook,
  onFullSyncToSheet,
  storageUsage,
  currentUser,
  secondaryUsers = [],
  onRefreshSecondaryUsers,
  byocConfig = null,
  byocConnection = { status: 'pending' },
  onSaveByocConfig,
  onTestByocConnection,
  onClearByocConfig,
  onToggleSecondaryUserStatus,
  togglingUserId = null,
}: SettingsTabProps) {
  const isSecondary = currentUser?.role === 'secondary';
  const [firmName, setFirmName] = useState(profile.firmName);
  const [gstin, setGstin] = useState(profile.gstin);
  const [udyamNumber, setUdyamNumber] = useState(profile.udyamNumber);
  const [adminName, setAdminName] = useState(profile.adminName);
  const [adminPhotoUrl, setAdminPhotoUrl] = useState(profile.adminPhotoUrl ?? '');
  const [photoError, setPhotoError] = useState('');
  const [profileSavedMsg, setProfileSavedMsg] = useState('');

  // BYOC Firebase configuration states for secondary users
  const [byocApiKey, setByocApiKey] = useState(byocConfig?.apiKey ?? '');
  const [byocAuthDomain, setByocAuthDomain] = useState(byocConfig?.authDomain ?? '');
  const [byocProjectId, setByocProjectId] = useState(byocConfig?.projectId ?? '');
  const [byocStorageBucket, setByocStorageBucket] = useState(byocConfig?.storageBucket ?? '');
  const [byocMessagingSenderId, setByocMessagingSenderId] = useState(
    byocConfig?.messagingSenderId ?? '',
  );
  const [byocAppId, setByocAppId] = useState(byocConfig?.appId ?? '');
  const [byocDatabaseId, setByocDatabaseId] = useState(byocConfig?.firestoreDatabaseId ?? '');
  const [byocSnippetText, setByocSnippetText] = useState('');
  const [byocFormMsg, setByocFormMsg] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [byocBusy, setByocBusy] = useState(false);
  const [showByocGuideModal, setShowByocGuideModal] = useState(false);
  const [copiedByocRules, setCopiedByocRules] = useState(false);

  useEffect(() => {
    setByocApiKey(byocConfig?.apiKey ?? '');
    setByocAuthDomain(byocConfig?.authDomain ?? '');
    setByocProjectId(byocConfig?.projectId ?? '');
    setByocStorageBucket(byocConfig?.storageBucket ?? '');
    setByocMessagingSenderId(byocConfig?.messagingSenderId ?? '');
    setByocAppId(byocConfig?.appId ?? '');
    setByocDatabaseId(byocConfig?.firestoreDatabaseId ?? '');
  }, [byocConfig]);

  const savedByocValidation = validateByocFirebaseConfig(byocConfig);
  const isSavedByocReady = !isSecondary || savedByocValidation.valid;

  const currentCandidateByoc: ByocFirebaseConfig = {
    apiKey: byocApiKey.trim(),
    authDomain: byocAuthDomain.trim(),
    projectId: byocProjectId.trim(),
    storageBucket: byocStorageBucket.trim(),
    messagingSenderId: byocMessagingSenderId.trim(),
    appId: byocAppId.trim(),
    firestoreDatabaseId: byocDatabaseId.trim(),
  };

  const usageConsoleUrl = isSecondary
    ? savedByocValidation.valid
      ? buildByocConsoleUrl(
          savedByocValidation.normalized.projectId,
          savedByocValidation.normalized.firestoreDatabaseId,
        )
      : null
    : `https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/databases/${firebaseConfig.firestoreDatabaseId}/usage`;

  const handleParseByocSnippet = () => {
    const parsed = parseFirebaseConfigSnippet(byocSnippetText);
    if (!parsed) {
      setByocFormMsg({
        type: 'err',
        msg: 'Could not extract firebaseConfig keys. Paste your JSON or const firebaseConfig = { apiKey: "...", projectId: "...", appId: "..." } snippet.',
      });
      return;
    }
    if (parsed.apiKey) setByocApiKey(parsed.apiKey);
    if (parsed.authDomain) setByocAuthDomain(parsed.authDomain);
    if (parsed.projectId) setByocProjectId(parsed.projectId);
    if (parsed.storageBucket) setByocStorageBucket(parsed.storageBucket);
    if (parsed.messagingSenderId) setByocMessagingSenderId(parsed.messagingSenderId);
    if (parsed.appId) setByocAppId(parsed.appId);
    if (parsed.firestoreDatabaseId !== undefined) setByocDatabaseId(parsed.firestoreDatabaseId);
    setByocFormMsg({
      type: 'ok',
      msg: `Parsed configuration for project "${parsed.projectId || 'detected'}". Review fields below and click Save BYOC Config.`,
    });
  };

  const handleSaveByocSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const check = validateByocFirebaseConfig(currentCandidateByoc);
    if (!check.valid) {
      setByocFormMsg({ type: 'err', msg: check.error || 'Please fill in all required Firebase config fields.' });
      return;
    }
    setByocBusy(true);
    setByocFormMsg(null);
    try {
      await onSaveByocConfig?.(check.normalized);
      setByocFormMsg({
        type: 'ok',
        msg: `Saved BYOC Firebase project "${check.normalized.projectId}". Now sign in with your Google account below to verify and sync.`,
      });
    } catch (err) {
      setByocFormMsg({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Unable to save BYOC Firebase configuration.',
      });
    } finally {
      setByocBusy(false);
    }
  };

  const handleTestByocClick = async () => {
    const check = validateByocFirebaseConfig(currentCandidateByoc);
    if (!check.valid) {
      setByocFormMsg({ type: 'err', msg: check.error || 'Complete your BYOC config fields before testing.' });
      return;
    }
    setByocBusy(true);
    setByocFormMsg(null);
    try {
      await onSaveByocConfig?.(check.normalized);
      if (onTestByocConnection) {
        const result = await onTestByocConnection(check.normalized);
        setByocFormMsg({
          type: result.status === 'error' ? 'err' : 'ok',
          msg: result.message || `BYOC check completed (${result.status}).`,
        });
      }
    } catch (err) {
      setByocFormMsg({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Connection verification failed.',
      });
    } finally {
      setByocBusy(false);
    }
  };

  const handleClearByocClick = async () => {
    setByocBusy(true);
    setByocFormMsg(null);
    try {
      await onClearByocConfig?.();
      setByocSnippetText('');
      setByocFormMsg({
        type: 'ok',
        msg: 'BYOC Firebase configuration cleared. Workspace remains strictly isolated locally until reconfigured.',
      });
    } finally {
      setByocBusy(false);
    }
  };

  const handleCopyByocRules = async () => {
    try {
      await navigator.clipboard.writeText(BYOC_FIRESTORE_RULES_TEMPLATE);
      setCopiedByocRules(true);
      setTimeout(() => setCopiedByocRules(false), 2400);
    } catch {
      // Clipboard blocked in restricted iframe
    }
  };

  useEffect(() => {
    setFirmName(profile.firmName);
    setGstin(profile.gstin);
    setUdyamNumber(profile.udyamNumber);
    setAdminName(profile.adminName);
    setAdminPhotoUrl(profile.adminPhotoUrl ?? '');
  }, [profile]);

  const [backupMsg, setBackupMsg] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<'reset' | 'clear' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [emailEnabled, setEmailEnabled] = useState(emailSettings.enabled);
  const [emailRecipientName, setEmailRecipientName] = useState(emailSettings.recipientName);
  const [emailAddress, setEmailAddress] = useState(emailSettings.recipientEmail);
  const [emailSavedMsg, setEmailSavedMsg] = useState('');
  const [emailErrorMsg, setEmailErrorMsg] = useState('');
  const [emailTesting, setEmailTesting] = useState(false);
  const [copiedLogId, setCopiedLogId] = useState<string | null>(null);

  useEffect(() => {
    setEmailEnabled(emailSettings.enabled);
    setEmailRecipientName(emailSettings.recipientName);
    setEmailAddress(emailSettings.recipientEmail);
  }, [emailSettings]);

  const handleSaveEmailForm = (e: FormEvent) => {
    e.preventDefault();
    const trimmedEmail = emailAddress.trim();
    if (!isValidNotificationEmail(trimmedEmail)) {
      setEmailErrorMsg('Please enter a valid notification email address.');
      return;
    }
    setEmailErrorMsg('');
    onSaveEmailSettings({
      enabled: emailEnabled,
      recipientName: emailRecipientName.trim() || currentUser?.username || 'User',
      recipientEmail: trimmedEmail,
    });
    setEmailSavedMsg('Daily email alert settings saved & synced.');
    setTimeout(() => setEmailSavedMsg(''), 3000);
  };

  const handleSendTestAlert = async () => {
    setEmailErrorMsg('');
    setEmailTesting(true);
    try {
      await onTriggerTestEmail();
    } finally {
      setEmailTesting(false);
    }
  };

  const handleCopyMessage = async (logId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedLogId(logId);
      setTimeout(() => setCopiedLogId((prev) => (prev === logId ? null : prev)), 2200);
    } catch {
      // Clipboard blocked in restricted context
    }
  };

  const [sheetEnabled, setSheetEnabled] = useState(sheetSettings.enabled);
  const [sheetUrl, setSheetUrl] = useState(sheetSettings.webhookUrl);
  const [sheetNameInput, setSheetNameInput] = useState(
    sheetSettings.sheetName || 'MIS Monthly Report',
  );
  const [sheetSavedMsg, setSheetSavedMsg] = useState('');
  const [sheetFormError, setSheetFormError] = useState('');
  const [showCodeGs, setShowCodeGs] = useState(false);
  const [copiedCodeGs, setCopiedCodeGs] = useState(false);

  useEffect(() => {
    setSheetEnabled(sheetSettings.enabled);
    setSheetUrl(sheetSettings.webhookUrl);
    setSheetNameInput(sheetSettings.sheetName || 'MIS Monthly Report');
  }, [sheetSettings]);

  const handleSaveSheetForm = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedUrl = sheetUrl.trim();
    if (trimmedUrl && !isValidAppsScriptWebhookUrl(trimmedUrl)) {
      setSheetFormError(
        'Enter a valid Google Apps Script Web App URL (https://script.google.com/macros/s/.../exec).',
      );
      return;
    }
    setSheetFormError('');
    const nextConfig: GoogleSheetSettings = {
      enabled: sheetEnabled,
      webhookUrl: trimmedUrl,
      sheetName: sheetNameInput.trim() || 'MIS Monthly Report',
      lastSyncedAt: sheetSettings.lastSyncedAt || '',
    };
    await onSaveSheetSettings(nextConfig);
    setSheetSavedMsg(
      trimmedUrl
        ? 'Webhook saved! Triggering initial sync check...'
        : 'Google Sheet webhook cleared.',
    );
    setTimeout(() => setSheetSavedMsg(''), 3500);
  };

  const handleCopyCodeGs = async () => {
    try {
      await navigator.clipboard.writeText(GOOGLE_APPS_SCRIPT_CODE_GS);
      setCopiedCodeGs(true);
      setTimeout(() => setCopiedCodeGs(false), 2400);
    } catch {
      // Clipboard blocked in restricted context
    }
  };

  const handlePhotoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await compressProfilePhotoDataUrl(file);
      setPhotoError('');
      setAdminPhotoUrl(dataUrl);
      onSaveProfile({
        firmName: firmName.trim() || 'Corporate Tender Desk',
        gstin: gstin.trim(),
        udyamNumber: udyamNumber.trim(),
        adminName: adminName.trim() || currentUser?.username || 'Tender Desk User',
        adminPhotoUrl: dataUrl,
      });
      setProfileSavedMsg('Profile photo compressed and saved.');
      setTimeout(() => setProfileSavedMsg(''), 3000);
    } catch (err) {
      setPhotoError(
        err instanceof Error ? err.message : 'Could not read the selected image.',
      );
    }
  };

  const handleRemovePhoto = () => {
    setPhotoError('');
    setAdminPhotoUrl('');
    onSaveProfile({
      firmName: firmName.trim() || 'Corporate Tender Desk',
      gstin: gstin.trim(),
      udyamNumber: udyamNumber.trim(),
      adminName: adminName.trim() || currentUser?.username || 'Tender Desk User',
      adminPhotoUrl: '',
    });
    setProfileSavedMsg('Profile photo removed.');
    setTimeout(() => setProfileSavedMsg(''), 3000);
  };

  const handleProfileSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSaveProfile({
      firmName: firmName.trim() || 'Corporate Tender Desk',
      gstin: gstin.trim(),
      udyamNumber: udyamNumber.trim(),
      adminName: adminName.trim() || currentUser?.username || 'Tender Desk User',
      adminPhotoUrl,
    });
    setProfileSavedMsg('Firm profile updated and persisted.');
    setTimeout(() => setProfileSavedMsg(''), 3000);
  };

  const handleDownloadJsonBackup = () => {
    const payload: CrmBackupPayload = {
      version: 3,
      exportedAt: new Date().toISOString(),
      profile,
      tenders,
      emdRecords,
      mafTrackers,
      oemDetails: oemRecords,
    };
    downloadTextFile(
      `BidLedger_Full_Backup_${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
      'application/json',
    );
    setBackupMsg({
      type: 'ok',
      msg: 'Full JSON backup downloaded (including OEM Details & MAF Trackers).',
    });
  };

  const handleExportAllCsv = () => {
    const tHeaders = [
      'Tender ID',
      'Portal',
      'Department',
      'Location',
      'Title',
      'Due Date',
      'Estimated Value',
      'Quoted Value',
      'EMD Status',
      'EMD Amount',
      'Stage',
    ];
    const tRows = tenders.map((t) => [
      t.tenderId,
      t.portal,
      t.department,
      t.location,
      t.title,
      t.submissionDueDate,
      t.estimatedValue,
      t.quotedValue,
      t.emdStatus,
      t.emdAmount,
      t.stage,
    ]);
    downloadTextFile(
      `BidLedger_Tenders_${new Date().toISOString().slice(0, 10)}.csv`,
      buildCsvContent(tHeaders, tRows),
      'text/csv;charset=utf-8;',
    );

    const oHeaders = [
      'OEM / Manufacturer Name',
      'Company Name',
      'Concerned Person Name',
      'Email ID',
      'Phone No.',
      'Remarks',
    ];
    const oRows = oemRecords.map((o) => [
      o.oemName,
      o.companyName,
      o.concernedPersonName,
      o.email,
      o.phone,
      o.remarks,
    ]);
    downloadTextFile(
      `BidLedger_OEM_Details_${new Date().toISOString().slice(0, 10)}.csv`,
      buildCsvContent(oHeaders, oRows),
      'text/csv;charset=utf-8;',
    );

    const eHeaders = [
      'Tender ID',
      'Department',
      'Instrument Type',
      'Reference No',
      'Bank Name',
      'Amount',
      'Issue Date',
      'Expiry Date',
      'Claim End Date',
      'Status',
      'Refund Date',
    ];
    const eRows = emdRecords.map((r) => [
      r.tenderId,
      r.department,
      r.instrumentType,
      r.referenceNo,
      r.bankName,
      r.amount,
      r.issueDate,
      r.expiryDate,
      r.claimEndDate,
      r.status,
      r.refundDate ?? '',
    ]);
    downloadTextFile(
      `BidLedger_EMD_BG_${new Date().toISOString().slice(0, 10)}.csv`,
      buildCsvContent(eHeaders, eRows),
      'text/csv;charset=utf-8;',
    );
    setBackupMsg({
      type: 'ok',
      msg: 'Tender, OEM Details & EMD/BG CSV reports downloaded.',
    });
  };

  const handleImportJson = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as CrmBackupPayload;
      if (!Array.isArray(parsed.tenders) || !Array.isArray(parsed.emdRecords) || !parsed.profile) {
        setBackupMsg({ type: 'err', msg: 'Invalid backup JSON structure.' });
        return;
      }
      const importedOems = Array.isArray(parsed.oemDetails) ? parsed.oemDetails : [];
      onImportBackup({
        ...parsed,
        mafTrackers: Array.isArray(parsed.mafTrackers) ? parsed.mafTrackers : [],
        oemDetails: importedOems,
      });
      setFirmName(parsed.profile.firmName);
      setGstin(parsed.profile.gstin);
      setUdyamNumber(parsed.profile.udyamNumber);
      setAdminName(parsed.profile.adminName);
      setAdminPhotoUrl(parsed.profile.adminPhotoUrl ?? '');
      setBackupMsg({
        type: 'ok',
        msg: `Restored ${parsed.tenders.length} tenders, ${importedOems.length} OEMs, ${parsed.emdRecords.length} EMD/BG records, and ${(parsed.mafTrackers ?? []).length} MAF trackers.`,
      });
    } catch {
      setBackupMsg({ type: 'err', msg: 'Could not parse JSON backup file.' });
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Google Cloud Auto-Backup & Sync */}
      <section className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <Cloud className="h-5 w-5 text-[#1E3A8A] dark:text-blue-400 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Google Cloud Auto-Backup & Sync
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Every saved tender, EMD/BG entry, and firm profile automatically backs up to your private Google Cloud database
              </p>
            </div>
          </div>

          {cloudUser && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Auto-Backup Active
            </span>
          )}
        </div>

        {cloudFeedback && (
          <div
            role="status"
            className={`rounded-lg px-4 py-2.5 text-xs font-medium border ${
              cloudFeedback.type === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
            }`}
          >
            {cloudFeedback.msg}
          </div>
        )}

        {isSecondary && (
          <div
            data-testid="byoc-config-panel"
            className="rounded-xl border border-blue-200 dark:border-blue-900/70 bg-blue-50/40 dark:bg-blue-950/20 p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-blue-200/70 dark:border-blue-900/60">
              <div className="space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Bring-Your-Own-Cloud (BYOC) Firebase Storage
                  </h3>
                  <span
                    data-testid="byoc-status-badge"
                    className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold ${
                      byocConnection.status === 'connected'
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                        : byocConnection.status === 'auth_required'
                          ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                          : byocConnection.status === 'error'
                            ? 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                            : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {byocConnection.status === 'connected'
                      ? 'Connected'
                      : byocConnection.status === 'auth_required'
                        ? 'Auth Required'
                        : byocConnection.status === 'error'
                          ? 'Connection Error'
                          : 'Pending Setup'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Your tenders, documents, and backups store directly inside your own Google Cloud / Firebase project — completely isolated from Primary Admin storage.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowByocGuideModal(true)}
                data-testid="open-byoc-guide-btn"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-blue-950/50 text-xs font-semibold text-[#1E3A8A] dark:text-blue-300 cursor-pointer shrink-0"
              >
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                <span>2-Minute Setup Guide &amp; Rules</span>
              </button>
            </div>

            {byocConnection.message && (
              <p className="text-xs text-slate-700 dark:text-slate-300">{byocConnection.message}</p>
            )}

            {byocFormMsg && (
              <div
                role={byocFormMsg.type === 'err' ? 'alert' : 'status'}
                className={`rounded-lg px-3.5 py-2 text-xs font-medium border ${
                  byocFormMsg.type === 'ok'
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                    : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                }`}
              >
                {byocFormMsg.msg}
              </div>
            )}

            {/* Quick-paste firebaseConfig JSON / JS Snippet */}
            <div className="space-y-2">
              <label
                htmlFor="byoc-snippet-paste"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Quick Import: Paste Firebase Web SDK Config Snippet (JSON or JS)
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <textarea
                  id="byoc-snippet-paste"
                  rows={2}
                  value={byocSnippetText}
                  onChange={(e) => setByocSnippetText(e.target.value)}
                  placeholder='Paste { apiKey: "...", authDomain: "...", projectId: "...", appId: "..." }'
                  className="font-mono-num flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <button
                  type="button"
                  onClick={handleParseByocSnippet}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Parse Snippet</span>
                </button>
              </div>
            </div>

            <form onSubmit={(e) => void handleSaveByocSubmit(e)} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="byoc-project-id"
                    className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Firebase Project ID *
                  </label>
                  <input
                    id="byoc-project-id"
                    type="text"
                    required
                    value={byocProjectId}
                    onChange={(e) => setByocProjectId(e.target.value)}
                    placeholder="my-tender-cloud-123"
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="byoc-api-key"
                    className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Web API Key (apiKey) *
                  </label>
                  <input
                    id="byoc-api-key"
                    type="text"
                    required
                    value={byocApiKey}
                    onChange={(e) => setByocApiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="byoc-auth-domain"
                    className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Auth Domain (authDomain) *
                  </label>
                  <input
                    id="byoc-auth-domain"
                    type="text"
                    required
                    value={byocAuthDomain}
                    onChange={(e) => setByocAuthDomain(e.target.value)}
                    placeholder="my-tender-cloud-123.firebaseapp.com"
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="byoc-app-id"
                    className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Firebase App ID (appId) *
                  </label>
                  <input
                    id="byoc-app-id"
                    type="text"
                    required
                    value={byocAppId}
                    onChange={(e) => setByocAppId(e.target.value)}
                    placeholder="1:1234567890:web:abcdef..."
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="byoc-storage-bucket"
                    className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Storage Bucket
                  </label>
                  <input
                    id="byoc-storage-bucket"
                    type="text"
                    value={byocStorageBucket}
                    onChange={(e) => setByocStorageBucket(e.target.value)}
                    placeholder="my-tender-cloud-123.firebasestorage.app"
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="byoc-database-id"
                    className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Firestore Database ID (blank for default)
                  </label>
                  <input
                    id="byoc-database-id"
                    type="text"
                    value={byocDatabaseId}
                    onChange={(e) => setByocDatabaseId(e.target.value)}
                    placeholder="(default)"
                    className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={byocBusy}
                    data-testid="save-byoc-config-btn"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-medium cursor-pointer"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Save BYOC Config</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleTestByocClick()}
                    disabled={byocBusy}
                    data-testid="test-byoc-connection-btn"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-blue-950/40 disabled:opacity-60 text-xs font-medium text-[#1E3A8A] dark:text-blue-300 cursor-pointer"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${byocBusy ? 'animate-spin' : ''}`} aria-hidden="true" />
                    <span>Test &amp; Verify Cloud Connection</span>
                  </button>
                </div>

                {byocConfig && (
                  <button
                    type="button"
                    onClick={() => void handleClearByocClick()}
                    disabled={byocBusy}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-xs font-medium cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Clear BYOC Config</span>
                  </button>
                )}
              </div>
            </form>
          </div>
        )}

        {!cloudUser ? (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 p-4">
            <div className="space-y-1 max-w-2xl">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {isSecondary && !isSavedByocReady
                  ? 'Configure Your Personal BYOC Firebase Project First'
                  : 'Connect your Google Account for Automatic Cloud Backup'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isSecondary && !isSavedByocReady
                  ? 'To keep your records strictly isolated from Admin storage, paste and save your own Firebase Web Config above first. Until configured, your workspace runs locally without touching Admin cloud storage.'
                  : `Sign in with Google once to back up all ${tenders.length} tenders, ${mafTrackers.length} MAF trackers, ${emdRecords.length} EMD/BG records, and firm settings to ${isSecondary ? `your isolated Firebase project (${savedByocValidation.normalized.projectId})` : 'Google Cloud Firestore'} in real time.`}
              </p>
            </div>
            <button
              type="button"
              onClick={onConnectCloud}
              disabled={cloudSyncing || (isSecondary && !isSavedByocReady)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium shrink-0"
            >
              {cloudSyncing ? (
                <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <CloudUpload className="h-4 w-4" aria-hidden="true" />
              )}
              <span>{cloudSyncing ? 'Connecting...' : 'Connect Google Account'}</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 p-4">
            <div className="flex items-center gap-3 min-w-0">
              {cloudUser.photoURL ? (
                <img
                  src={cloudUser.photoURL}
                  alt={cloudUser.displayName ?? 'Google account'}
                  referrerPolicy="no-referrer"
                  className="h-10 w-10 rounded-full object-cover border border-slate-300 dark:border-slate-700 shrink-0"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1E3A8A] text-white text-sm font-semibold shrink-0">
                  {(cloudUser.displayName ?? cloudUser.email ?? 'U').slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                  {cloudUser.displayName || 'Connected Google Account'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {cloudUser.email}
                  {isSecondary && savedByocValidation.valid
                    ? ` · BYOC Project: ${savedByocValidation.normalized.projectId}`
                    : ''}
                  {lastCloudSyncAt ? ` · Last backed up ${new Date(lastCloudSyncAt).toLocaleString('en-IN')}` : ''}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={onBackupToCloudNow}
                disabled={cloudSyncing}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-medium"
              >
                <CloudUpload className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{cloudSyncing ? 'Syncing...' : 'Backup Local Data Now'}</span>
              </button>

              <button
                type="button"
                onClick={onRestoreFromCloud}
                disabled={cloudSyncing}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60 text-slate-800 dark:text-slate-200 text-xs font-medium"
              >
                <CloudDownload className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Restore from Cloud</span>
              </button>

              <button
                type="button"
                onClick={onDisconnectCloud}
                disabled={cloudSyncing}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-60 text-xs font-medium"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Disconnect</span>
              </button>
            </div>
          </div>
        )}

        {/* Live Cloud Storage Meter (1 GB Free Tier Quota) */}
        <div
          data-testid="cloud-storage-meter"
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-4 space-y-3.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <HardDrive
                className="h-4 w-4 text-[#1E3A8A] dark:text-blue-400 shrink-0"
                aria-hidden="true"
              />
              <div>
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Cloud Storage Usage (1 GB Firestore Quota)
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {cloudUser
                    ? `Live footprint across ${storageUsage.totalDocs} synced documents (${storageUsage.firestoreAttachmentCount} attachments in Firestore)`
                    : `Current workspace estimate across ${storageUsage.totalDocs} records (sign in with Google for live cloud totals)`}
                </p>
              </div>
            </div>

            <div className="w-full sm:w-auto flex flex-wrap items-center justify-between sm:justify-end gap-2.5 sm:gap-3 pt-1 sm:pt-0">
              <div className="text-left sm:text-right min-w-0">
                <p
                  data-testid="cloud-storage-used-text"
                  className="font-mono-num text-xs font-bold text-slate-900 dark:text-white"
                >
                  {formatStorageSize(storageUsage.totalBytes)} / 1.00 GB
                </p>
                <p className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                  {storageUsage.usagePercent.toFixed(2)}% used ·{' '}
                  {formatStorageSize(storageUsage.remainingBytes)} free
                </p>
              </div>

              {usageConsoleUrl && (
                <a
                  href={usageConsoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="firebase-usage-link"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0"
                >
                  <span>Firebase Usage</span>
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </div>
          </div>

          <div
            role="progressbar"
            aria-label="Firestore 1 GB storage usage"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Number(storageUsage.usagePercent.toFixed(2))}
            className="h-2.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden"
          >
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                storageUsage.statusLevel === 'critical'
                  ? 'bg-red-600'
                  : storageUsage.statusLevel === 'warning'
                    ? 'bg-amber-500'
                    : 'bg-[#1E3A8A] dark:bg-blue-500'
              }`}
              style={{
                width: `${
                  storageUsage.totalBytes > 0 ? Math.max(1.5, storageUsage.usagePercent) : 0
                }%`,
              }}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {storageUsage.categories.map((cat) => (
              <div
                key={cat.key}
                className="rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2"
              >
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {cat.label}
                </p>
                <div className="flex items-baseline justify-between gap-1.5 mt-0.5">
                  <span className="font-mono-num text-xs font-bold text-slate-900 dark:text-slate-100">
                    {formatStorageSize(cat.bytes)}
                  </span>
                  <span className="font-mono-num text-[10px] text-slate-500 dark:text-slate-400">
                    {cat.docCount} {cat.docCount === 1 ? 'doc' : 'docs'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {storageUsage.externalStorageFileCount > 0 && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Note: {storageUsage.externalStorageFileCount} external / Firebase Storage MAF document link(s) are hosted outside the 1 GB Firestore database quota.
            </p>
          )}
        </div>
      </section>

      {/* Company / Firm Profile */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-200 dark:border-slate-800">
          <Building2 className="h-5 w-5 text-[#1E3A8A] dark:text-blue-400" aria-hidden="true" />
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Company / Firm Profile
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Displayed in CRM headers and printed executive summaries
            </p>
          </div>
        </div>

        <form onSubmit={handleProfileSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="set-firm-name"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Company / Firm Legal Name
            </label>
            <input
              id="set-firm-name"
              type="text"
              required
              value={firmName}
              onChange={(e) => setFirmName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="set-gstin"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                GSTIN
              </label>
              <input
                id="set-gstin"
                type="text"
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
                className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="set-udyam"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                MSME / Udyam Registration No.
              </label>
              <input
                id="set-udyam"
                type="text"
                value={udyamNumber}
                onChange={(e) => setUdyamNumber(e.target.value.toUpperCase())}
                className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="set-admin-name"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Tender Desk Admin Name
            </label>
            <input
              id="set-admin-name"
              type="text"
              required
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="pt-1">
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
              Admin Profile Photo (Shown as Sidebar Logo)
            </span>
            <div className="flex flex-wrap items-center gap-3">
              {adminPhotoUrl ? (
                <img
                  src={adminPhotoUrl}
                  alt="Admin photo preview"
                  referrerPolicy="no-referrer"
                  className="h-12 w-12 rounded-lg object-cover border border-slate-300 dark:border-slate-700"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                  <User className="h-5 w-5" aria-hidden="true" />
                </div>
              )}

              <input
                ref={photoInputRef}
                id="set-admin-photo"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={handlePhotoUpload}
                className="sr-only"
                aria-label="Upload Admin Profile Photo"
              />
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{adminPhotoUrl ? 'Change Photo' : 'Upload Admin Photo'}</span>
              </button>

              {adminPhotoUrl && (
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Remove</span>
                </button>
              )}
            </div>
            {photoError && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1.5">
                {photoError}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            {profileSavedMsg ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                {profileSavedMsg}
              </span>
            ) : (
              <span />
            )}
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium"
            >
              Save Firm Profile
            </button>
          </div>
        </form>
      </section>

      {/* Session Access & Auto-Logout Security */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col justify-between space-y-5">
        <div className="space-y-5">
          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-200 dark:border-slate-800">
            <ShieldCheck className="h-5 w-5 text-[#1E3A8A] dark:text-blue-400" aria-hidden="true" />
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                CRM Login &amp; Session Security
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Strict per-tab authentication for Vansh Tender Software
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500 dark:text-slate-400">Authorized CRM User ID</span>
              <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                {currentUser?.username || 'User'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500 dark:text-slate-400">Account Role &amp; Workspace</span>
              <span
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                  currentUser?.role === 'secondary'
                    ? 'bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
                    : 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {currentUser?.role === 'secondary'
                  ? 'Secondary User (Isolated)'
                  : 'Primary Admin'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500 dark:text-slate-400">Registered Gmail</span>
              <span className="font-mono-num text-slate-700 dark:text-slate-300 truncate max-w-[200px]">
                {currentUser?.email || '—'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500 dark:text-slate-400">Session Timeout &amp; Tab Policy</span>
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                15 Min Limit · Tab Close Logout
              </span>
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed pt-1">
              {currentUser?.role === 'secondary'
                ? 'Your secondary CRM workspace is isolated from Primary Admin data. Page refreshes stay signed in for up to 15 minutes, while closing the tab or exceeding 15 minutes logs out automatically.'
                : 'Page refreshes stay signed in within the current tab for up to 15 minutes. After 15 minutes of login time, closing the tab, or clicking Log Out, you will be signed out automatically.'}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end pt-2">
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Log Out to Login Screen</span>
          </button>
        </div>
      </section>

      {/* Admin-Only Secondary Users Directory */}
      {currentUser?.role === 'admin' && (
        <section
          data-testid="admin-secondary-users-section"
          className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <Users
                className="h-5 w-5 text-[#1E3A8A] dark:text-blue-400"
                aria-hidden="true"
              />
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Secondary Users ({secondaryUsers.length})
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Self-registered secondary CRM accounts. Each user operates in an isolated workspace with their own tenders, email alerts, and Google Sheet.
                </p>
              </div>
            </div>

            {onRefreshSecondaryUsers && (
              <button
                type="button"
                onClick={onRefreshSecondaryUsers}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Refresh List</span>
              </button>
            )}
          </div>

          {secondaryUsers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 px-4 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No secondary users have registered yet. New users can self-register via &ldquo;Create New User&rdquo; on the Login screen using Gmail OTP verification.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/90 text-[11px] uppercase tracking-wider text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold">User ID</th>
                    <th className="py-2.5 px-3 font-semibold">Attached Gmail</th>
                    <th className="py-2.5 px-3 font-semibold">Live Presence</th>
                    <th className="py-2.5 px-3 font-semibold">BYOC Cloud</th>
                    <th className="py-2.5 px-3 font-semibold">Registered / Last Login</th>
                    <th className="py-2.5 px-3 font-semibold">Account Access</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {secondaryUsers.map((sec) => {
                    const isEnabled = sec.isEnabled !== false;
                    const effectivePresence = computeEffectivePresenceStatus({
                      isEnabled,
                      isActive: sec.isActive,
                      presenceStatus: sec.presenceStatus,
                      lastHeartbeatAt: sec.lastHeartbeatAt,
                    });
                    const isOnline = isEnabled && effectivePresence === 'active';
                    const isToggling = togglingUserId === sec.userId;

                    return (
                      <tr
                        key={sec.userId}
                        data-testid={`secondary-user-row-${sec.username}`}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                      >
                        <td className="py-2.5 px-3 font-mono-num font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {sec.username}
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {sec.email}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            data-testid={`secondary-presence-${sec.username}`}
                            className={`inline-flex items-center px-2 py-0.5 rounded border font-medium text-[11px] ${
                              isOnline
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-300'
                                : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {isOnline ? 'Active' : 'Not Active'}
                          </span>
                          {sec.lastHeartbeatAt && (
                            <p className="font-mono-num text-[10px] text-slate-400 mt-0.5">
                              HB: {new Date(sec.lastHeartbeatAt).toLocaleTimeString('en-IN')}
                            </p>
                          )}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {sec.byocProjectId ? (
                            <span className="font-mono-num inline-flex items-center px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-300 font-medium text-[11px]">
                              Connected ({sec.byocProjectId})
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:border-amber-800 dark:text-amber-300 font-medium text-[11px]">
                              Pending Setup
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono-num text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          <p>{sec.createdAt ? new Date(sec.createdAt).toLocaleDateString('en-IN') : '—'}</p>
                          <p className="text-[10px] text-slate-400">
                            {sec.lastLoginAt
                              ? `Last: ${new Date(sec.lastLoginAt).toLocaleString('en-IN')}`
                              : 'Never logged in'}
                          </p>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            data-testid={`secondary-access-${sec.username}`}
                            className={`inline-flex items-center px-2 py-0.5 rounded border font-semibold text-[11px] ${
                              isEnabled
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-300'
                                : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/60 dark:border-red-800 dark:text-red-300'
                            }`}
                          >
                            {isEnabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap text-right">
                          {onToggleSecondaryUserStatus && (
                            <button
                              type="button"
                              onClick={() =>
                                void onToggleSecondaryUserStatus(sec.userId, !isEnabled)
                              }
                              disabled={isToggling}
                              data-testid={`toggle-user-access-${sec.username}`}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-[11px] font-semibold disabled:opacity-50 cursor-pointer ${
                                isEnabled
                                  ? 'border-red-200 dark:border-red-800 bg-red-50/80 dark:bg-red-950/40 hover:bg-red-100 text-red-700 dark:text-red-300'
                                  : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/80 dark:bg-emerald-950/40 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300'
                              }`}
                            >
                              {isEnabled ? (
                                <>
                                  <Lock className="h-3 w-3" aria-hidden="true" />
                                  <span>{isToggling ? 'Updating...' : 'Disable'}</span>
                                </>
                              ) : (
                                <>
                                  <Unlock className="h-3 w-3" aria-hidden="true" />
                                  <span>{isToggling ? 'Updating...' : 'Enable'}</span>
                                </>
                              )}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Daily Email Tender Alerts (5-Day Window · 11:00 AM & 4:00 PM IST) */}
      <section className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <Mail
              className="h-5 w-5 text-[#1E3A8A] dark:text-blue-400"
              aria-hidden="true"
            />
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Daily Email Tender Alerts ({emailRecipientName.trim() || currentUser?.username || 'Recipient'} · {emailAddress.trim() || currentUser?.email || 'No email configured'})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Automatically emails tenders due within 5 days twice daily at 11:00 AM IST &amp; 4:00 PM IST
              </p>
            </div>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium ${
              emailGatewayInfo.automatedConfigured
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
            }`}
          >
            {emailGatewayInfo.automatedConfigured
              ? `Automated Email Gateway: ${emailGatewayInfo.provider.toUpperCase()}`
              : 'SMTP / Resend Gateway Not Configured in .env'}
          </span>
        </div>

        <form onSubmit={handleSaveEmailForm} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <label
                htmlFor="email-recipient-name"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Recipient Name
              </label>
              <input
                id="email-recipient-name"
                type="text"
                required
                value={emailRecipientName}
                onChange={(e) => setEmailRecipientName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="email-recipient-address"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Notification Email Address
              </label>
              <input
                id="email-recipient-address"
                type="email"
                required
                value={emailAddress}
                onChange={(e) => setEmailAddress(e.target.value)}
                placeholder={currentUser?.email || 'yourname@gmail.com'}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 px-3.5 py-2">
              <label
                htmlFor="email-auto-dispatch"
                className="text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer select-none"
              >
                Auto-Send at 11 AM &amp; 4 PM IST
              </label>
              <input
                id="email-auto-dispatch"
                type="checkbox"
                checked={emailEnabled}
                onChange={(e) => setEmailEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
              />
            </div>
          </div>

          {emailErrorMsg && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {emailErrorMsg}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {emailSavedMsg ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  {emailSavedMsg}
                </span>
              ) : (
                <span>
                  Daily Schedule: 11:00 AM IST &amp; 4:00 PM IST &rarr; {emailAddress.trim() || currentUser?.email || 'Configure notification email above'}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => void handleSendTestAlert()}
                disabled={emailTesting}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-60 text-blue-800 dark:text-blue-300 text-xs font-medium cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{emailTesting ? 'Sending Test...' : 'Send Test Email Alert'}</span>
              </button>

              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium cursor-pointer"
              >
                Save Email Alert Settings
              </button>
            </div>
          </div>
        </form>

        {/* Email Reminder Dispatch Log */}
        <div className="space-y-2.5 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Email Reminder Dispatch Log ({emailLogs.length})
            </h3>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Deduplicated by Tender + IST Date + Slot (11 AM / 4 PM IST · &le;5 Days Window)
            </span>
          </div>

          {emailLogs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 px-4 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No email tender alerts dispatched yet. Active pre-submission tenders due within 5 days automatically send email reminders at 11:00 AM IST &amp; 4:00 PM IST.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-72 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/90 text-[11px] uppercase tracking-wider text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold">Schedule Slot</th>
                    <th className="py-2.5 px-3 font-semibold">Tender ID &amp; Filing Due</th>
                    <th className="py-2.5 px-3 font-semibold">Recipient</th>
                    <th className="py-2.5 px-3 font-semibold">Status</th>
                    <th className="py-2.5 px-3 font-semibold">Triggered At</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {emailLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded font-medium text-[11px] ${
                            log.slot === 'slot_4pm'
                              ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300'
                              : log.slot === 'slot_11am'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {formatSlotLabel(log.slot)}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <p className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                          {log.tenderId}
                        </p>
                        {log.dueDateIso && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Due: {formatDateTime(log.dueDateIso)}
                          </p>
                        )}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <p className="font-medium text-slate-800 dark:text-slate-200">
                          {log.recipientName}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {log.recipientEmail}
                        </p>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded font-medium text-[11px] ${
                            log.status === 'sent'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                          }`}
                        >
                          {log.status === 'sent'
                            ? `Sent (${log.provider.toUpperCase()})`
                            : 'Delivery Failed'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {new Date(log.createdAt).toLocaleString('en-IN')}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap text-right">
                        <button
                          type="button"
                          onClick={() => void handleCopyMessage(log.id, log.message)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-200"
                        >
                          <Copy className="h-3 w-3" aria-hidden="true" />
                          <span>{copiedLogId === log.id ? 'Copied' : 'Copy Body'}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Google Sheet ("MIS Monthly Report") Real-Time Webhook Sync */}
      <section
        id="google-sheet-sync-section"
        className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet
              className="h-5 w-5 text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            />
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Google Sheet Real-Time Sync (&ldquo;{sheetNameInput.trim() || 'MIS Monthly Report'}&rdquo;)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pushes CREATE, UPDATE &amp; DELETE events for Daily Tenders, Executive MIS Summary counts, and EMD/BG Tracker rows to your Google Apps Script Web App
              </p>
            </div>
          </div>

          <span
            data-testid="settings-sheet-status-pill"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium ${
              sheetSyncStatus === 'error'
                ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                : sheetSyncStatus === 'synced' || sheetSyncStatus === 'idle'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                  : sheetSyncStatus === 'syncing'
                    ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
                    : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
            }`}
          >
            {sheetSyncStatus === 'syncing'
              ? 'Syncing to Google Sheet...'
              : sheetSyncStatus === 'synced'
                ? `Sheet Synced${sheetSettings.lastSyncedAt ? ` · ${new Date(sheetSettings.lastSyncedAt).toLocaleTimeString('en-IN')}` : ''}`
                : sheetSyncStatus === 'idle'
                  ? 'Webhook Ready (Auto-Sync On)'
                  : sheetSyncStatus === 'error'
                    ? 'Sheet Webhook Issue'
                    : 'Not Connected Yet'}
          </span>
        </div>

        <form onSubmit={(e) => void handleSaveSheetForm(e)} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="md:col-span-2">
              <label
                htmlFor="sheet-webhook-url"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Google Apps Script Webhook URL
              </label>
              <input
                id="sheet-webhook-url"
                type="url"
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                placeholder="https://script.google.com/macros/s/AKfycb.../exec"
                className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            <div>
              <label
                htmlFor="sheet-name-label"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Connected Sheet Name
              </label>
              <input
                id="sheet-name-label"
                type="text"
                value={sheetNameInput}
                onChange={(e) => setSheetNameInput(e.target.value)}
                placeholder="MIS Monthly Report"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 px-3.5 py-2.5">
              <label
                htmlFor="sheet-auto-sync"
                className="text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer select-none"
              >
                Auto-Sync CRM Changes
              </label>
              <input
                id="sheet-auto-sync"
                type="checkbox"
                checked={sheetEnabled}
                onChange={(e) => setSheetEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600 cursor-pointer"
              />
            </div>
          </div>

          {(sheetFormError || sheetSyncError) && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300"
            >
              {sheetFormError || sheetSyncError}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {sheetSavedMsg ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  {sheetSavedMsg}
                </span>
              ) : sheetSettings.lastSyncedAt ? (
                <span>
                  Last successful Sheet push: {formatDateTime(sheetSettings.lastSyncedAt)}
                </span>
              ) : (
                <span>
                  Deploy <code className="font-mono-num">Code.gs</code> as Web App (Access: Anyone) and paste the URL above.
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const candidate: GoogleSheetSettings = {
                    enabled: sheetEnabled,
                    webhookUrl: sheetUrl.trim(),
                    sheetName: sheetNameInput.trim() || 'MIS Monthly Report',
                    lastSyncedAt: sheetSettings.lastSyncedAt || '',
                  };
                  if (!isValidAppsScriptWebhookUrl(candidate.webhookUrl)) {
                    setSheetFormError(
                      'Enter a valid Google Apps Script URL (https://script.google.com/macros/s/.../exec) before testing.',
                    );
                    return;
                  }
                  setSheetFormError('');
                  void onTestSheetWebhook(candidate);
                }}
                disabled={sheetSyncStatus === 'syncing'}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Test Webhook</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const candidate: GoogleSheetSettings = {
                    enabled: sheetEnabled,
                    webhookUrl: sheetUrl.trim(),
                    sheetName: sheetNameInput.trim() || 'MIS Monthly Report',
                    lastSyncedAt: sheetSettings.lastSyncedAt || '',
                  };
                  if (!isValidAppsScriptWebhookUrl(candidate.webhookUrl)) {
                    setSheetFormError(
                      'Enter a valid Google Apps Script URL (https://script.google.com/macros/s/.../exec) before syncing.',
                    );
                    return;
                  }
                  setSheetFormError('');
                  void onFullSyncToSheet(candidate);
                }}
                disabled={sheetSyncStatus === 'syncing'}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 disabled:opacity-60 text-xs font-medium text-emerald-800 dark:text-emerald-300 cursor-pointer"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${sheetSyncStatus === 'syncing' ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>Sync All to Sheet Now</span>
              </button>

              <button
                type="submit"
                disabled={sheetSyncStatus === 'syncing'}
                className="px-4 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-medium cursor-pointer"
              >
                Save Webhook Settings
              </button>
            </div>
          </div>
        </form>

        {/* Apps Script Code.gs Snippet Panel */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setShowCodeGs((prev) => !prev)}
              className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
            >
              <Code2 className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <span>
                {showCodeGs
                  ? 'Hide Google Apps Script (Code.gs) Snippet'
                  : 'View Google Apps Script (Code.gs) Setup Snippet'}
              </span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopyCodeGs()}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                <Copy className="h-3 w-3" aria-hidden="true" />
                <span>{copiedCodeGs ? 'Copied Code.gs' : 'Copy Code.gs'}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  downloadTextFile('Code.gs', GOOGLE_APPS_SCRIPT_CODE_GS, 'text/plain;charset=utf-8')
                }
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                <Download className="h-3 w-3" aria-hidden="true" />
                <span>Download Code.gs</span>
              </button>
            </div>
          </div>

          <div className="px-4 py-2.5 text-[11px] text-slate-600 dark:text-slate-400 flex flex-wrap gap-x-4 gap-y-1 border-b border-slate-200/70 dark:border-slate-800/70">
            <span>1. Open your Google Sheet (&ldquo;MIS Monthly Report&rdquo;)</span>
            <span>2. Extensions &rarr; Apps Script &rarr; Paste Code.gs</span>
            <span>3. Deploy &rarr; New deployment &rarr; Web app (Execute as: Me, Access: Anyone)</span>
            <span>4. Paste the /exec URL above &amp; click Save</span>
          </div>

          {showCodeGs && (
            <pre className="p-4 max-h-80 overflow-auto text-[11px] leading-relaxed font-mono-num text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950">
              <code>{GOOGLE_APPS_SCRIPT_CODE_GS}</code>
            </pre>
          )}
        </div>
      </section>

      {/* Data Management, Backup & Restore */}
      <section className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-200 dark:border-slate-800">
          <Database className="h-5 w-5 text-[#1E3A8A] dark:text-blue-400" aria-hidden="true" />
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              {currentUser?.role === 'admin'
                ? 'Data Backup, CSV Reports & Demo Reset'
                : 'Data Backup & CSV Reports'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              All data, preferences, and attachments persist exclusively via Firebase Firestore · Export CSV or JSON snapshots anytime
            </p>
          </div>
        </div>

        {backupMsg && (
          <div
            role="status"
            className={`rounded-lg px-4 py-2.5 text-xs font-medium border ${
              backupMsg.type === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
            }`}
          >
            {backupMsg.msg}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleExportAllCsv}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span>Export Full CSV Reports</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadJsonBackup}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span>Download JSON Backup</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportJson}
            className="hidden"
            aria-label="Upload JSON backup file"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span>Import JSON Backup</span>
          </button>

          <div className="ml-auto flex flex-wrap items-center gap-3">
            {currentUser?.role === 'admin' && (
              <button
                type="button"
                onClick={() => setConfirmAction('reset')}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-xs font-medium"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                <span>Reset Demo Data</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setConfirmAction('clear')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-xs font-medium"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              <span>Clear All Data</span>
            </button>
          </div>
        </div>

        {confirmAction && (
          <div className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
              {confirmAction === 'reset'
                ? 'Restore all 8 pre-loaded Indian Government/GeM demo tenders and 7 EMD/BG records? Existing edits will be overwritten.'
                : 'Clear local tenders, MAF trackers, and EMD/BG records from this CRM workspace? Your Google Cloud / BYOC and Google Sheet backups remain untouched and can be restored anytime via "Restore from Cloud".'}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirmAction === 'reset') {
                    onResetDemoData();
                    setBackupMsg({ type: 'ok', msg: 'Sample Indian tender & EMD/BG demo data restored.' });
                  } else {
                    onClearAllData();
                    setBackupMsg({
                      type: 'ok',
                      msg: 'Local CRM workspace cleared. Google Cloud / BYOC & Google Sheet backups remain preserved (use "Restore from Cloud" to reload).',
                    });
                  }
                  setConfirmAction(null);
                }}
                className={`px-3.5 py-1.5 rounded-md text-white text-xs font-medium ${
                  confirmAction === 'reset'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {confirmAction === 'reset' ? 'Confirm Reset Demo' : 'Confirm Clear All'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 2-Minute BYOC Setup Guide & Firestore Rules Modal */}
      {showByocGuideModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="byoc-guide-title"
          data-testid="byoc-guide-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <BookOpen className="h-5 w-5 text-[#1E3A8A] dark:text-blue-400" aria-hidden="true" />
                <div>
                  <h3
                    id="byoc-guide-title"
                    className="font-display text-base font-bold text-slate-900 dark:text-white"
                  >
                    2-Minute Personal Firebase (BYOC) Setup Guide
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Keep 100% of your tender records, attachments &amp; backups inside your own Firebase project
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowByocGuideModal(false)}
                aria-label="Close setup guide"
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs text-slate-700 dark:text-slate-300">
              <ol className="list-decimal list-inside space-y-2 leading-relaxed">
                <li>
                  Open{' '}
                  <a
                    href="https://console.firebase.google.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-[#1E3A8A] dark:text-blue-400 underline"
                  >
                    console.firebase.google.com
                  </a>{' '}
                  and create a free Spark project (e.g. <code className="font-mono-num">my-tender-cloud</code>).
                </li>
                <li>
                  Click the Web icon (<code className="font-mono-num">&lt;/&gt;</code>) to register a Web App and copy the <code className="font-mono-num">firebaseConfig</code> object.
                </li>
                <li>
                  Go to <strong>Authentication &rarr; Sign-in method</strong>, enable <strong>Google</strong>, and under <strong>Settings &rarr; Authorized domains</strong> add{' '}
                  <code className="font-mono-num px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                    {typeof window !== 'undefined' ? window.location.hostname : 'www.vanshtender.in'}
                  </code>.
                </li>
                <li>
                  Go to <strong>Firestore Database &rarr; Create database</strong> (Standard/Production mode) and publish the security rules below under the <strong>Rules</strong> tab.
                </li>
                <li>
                  Paste your <code className="font-mono-num">firebaseConfig</code> snippet into the BYOC Quick Import box in Settings, click <strong>Save BYOC Config</strong>, then click <strong>Connect Google Account</strong>.
                </li>
              </ol>

              <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="flex items-center justify-between px-3.5 py-2 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    Recommended BYOC <code className="font-mono-num">firestore.rules</code>
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopyByocRules()}
                    data-testid="copy-byoc-rules-btn"
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 hover:bg-slate-50 text-[11px] font-medium cursor-pointer"
                  >
                    {copiedByocRules ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                        <span>Copied Rules</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" aria-hidden="true" />
                        <span>Copy Firestore Rules</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-3.5 max-h-60 overflow-auto text-[11px] font-mono-num bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200">
                  <code>{BYOC_FIRESTORE_RULES_TEMPLATE}</code>
                </pre>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex justify-end">
              <button
                type="button"
                onClick={() => setShowByocGuideModal(false)}
                className="px-4 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium cursor-pointer"
              >
                Close Guide
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
