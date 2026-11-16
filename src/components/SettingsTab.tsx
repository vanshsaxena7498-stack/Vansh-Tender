import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Building2,
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
  LogOut,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  User,
} from 'lucide-react';
import type {
  CrmBackupPayload,
  EmdBgRecord,
  FirmProfile,
  GoogleSheetSettings,
  MafTrackerRecord,
  SheetSyncStatus,
  Tender,
  WhatsAppAlertLog,
  WhatsAppSettings,
} from '../types/crm';
import { compressProfilePhotoDataUrl } from '../utils/attachments';
import { buildCsvContent, downloadTextFile, formatDateTime } from '../utils/formatters';
import {
  GOOGLE_APPS_SCRIPT_CODE_GS,
  isValidAppsScriptWebhookUrl,
} from '../utils/googleSheetSync';
import { buildWhatsAppWebUrl, normalizeIndianWhatsAppPhone } from '../utils/whatsappAlerts';
import type { CloudUserSummary } from './Header';

interface SettingsTabProps {
  profile: FirmProfile;
  tenders: Tender[];
  emdRecords: EmdBgRecord[];
  mafTrackers: MafTrackerRecord[];
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
  whatsappSettings: WhatsAppSettings;
  whatsappLogs: WhatsAppAlertLog[];
  whatsappGatewayInfo: { automatedConfigured: boolean; provider: string };
  onSaveWhatsAppSettings: (settings: WhatsAppSettings) => void;
  onTriggerTestWhatsApp: () => Promise<void> | void;
  sheetSettings: GoogleSheetSettings;
  sheetSyncStatus: SheetSyncStatus;
  sheetSyncError: string | null;
  onSaveSheetSettings: (settings: GoogleSheetSettings) => Promise<void> | void;
  onTestSheetWebhook: (settingsOverride?: GoogleSheetSettings) => Promise<void>;
  onFullSyncToSheet: (settingsOverride?: GoogleSheetSettings) => Promise<void>;
}

export function SettingsTab({
  profile,
  tenders,
  emdRecords,
  mafTrackers,
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
  whatsappSettings,
  whatsappLogs,
  whatsappGatewayInfo,
  onSaveWhatsAppSettings,
  onTriggerTestWhatsApp,
  sheetSettings,
  sheetSyncStatus,
  sheetSyncError,
  onSaveSheetSettings,
  onTestSheetWebhook,
  onFullSyncToSheet,
}: SettingsTabProps) {
  const [firmName, setFirmName] = useState(profile.firmName);
  const [gstin, setGstin] = useState(profile.gstin);
  const [udyamNumber, setUdyamNumber] = useState(profile.udyamNumber);
  const [adminName, setAdminName] = useState(profile.adminName);
  const [adminPhotoUrl, setAdminPhotoUrl] = useState(profile.adminPhotoUrl ?? '');
  const [photoError, setPhotoError] = useState('');
  const [profileSavedMsg, setProfileSavedMsg] = useState('');

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

  const [waEnabled, setWaEnabled] = useState(whatsappSettings.enabled);
  const [waName, setWaName] = useState(whatsappSettings.recipientName);
  const [waPhone, setWaPhone] = useState(whatsappSettings.recipientPhone);
  const [waSavedMsg, setWaSavedMsg] = useState('');
  const [waErrorMsg, setWaErrorMsg] = useState('');
  const [waTesting, setWaTesting] = useState(false);
  const [copiedLogId, setCopiedLogId] = useState<string | null>(null);

  useEffect(() => {
    setWaEnabled(whatsappSettings.enabled);
    setWaName(whatsappSettings.recipientName);
    setWaPhone(whatsappSettings.recipientPhone);
  }, [whatsappSettings]);

  const handleSaveWhatsAppForm = (e: FormEvent) => {
    e.preventDefault();
    const digits = normalizeIndianWhatsAppPhone(waPhone);
    if (digits.length < 10) {
      setWaErrorMsg('Please enter a valid 10-digit WhatsApp mobile number.');
      return;
    }
    setWaErrorMsg('');
    onSaveWhatsAppSettings({
      enabled: waEnabled,
      recipientName: waName.trim() || 'Vansh',
      recipientPhone: waPhone.trim() || '9717690890',
    });
    setWaSavedMsg('WhatsApp alert settings saved & synced.');
    setTimeout(() => setWaSavedMsg(''), 3000);
  };

  const handleSendTestAlert = async () => {
    setWaErrorMsg('');
    setWaTesting(true);
    try {
      await onTriggerTestWhatsApp();
    } finally {
      setWaTesting(false);
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
        adminName: adminName.trim() || 'Vansh Saxena',
        adminPhotoUrl: dataUrl,
      });
      setProfileSavedMsg('Admin photo compressed and saved.');
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
      adminName: adminName.trim() || 'Vansh Saxena',
      adminPhotoUrl: '',
    });
    setProfileSavedMsg('Admin photo removed.');
    setTimeout(() => setProfileSavedMsg(''), 3000);
  };

  const handleProfileSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSaveProfile({
      firmName: firmName.trim() || 'Corporate Tender Desk',
      gstin: gstin.trim(),
      udyamNumber: udyamNumber.trim(),
      adminName: adminName.trim() || 'Vansh Saxena',
      adminPhotoUrl,
    });
    setProfileSavedMsg('Firm profile updated and persisted.');
    setTimeout(() => setProfileSavedMsg(''), 3000);
  };

  const handleDownloadJsonBackup = () => {
    const payload: CrmBackupPayload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      profile,
      tenders,
      emdRecords,
      mafTrackers,
    };
    downloadTextFile(
      `BidLedger_Full_Backup_${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
      'application/json',
    );
    setBackupMsg({ type: 'ok', msg: 'Full JSON backup downloaded (including MAF Trackers).' });
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
    setBackupMsg({ type: 'ok', msg: 'Both Tender & EMD/BG CSV reports downloaded.' });
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
      onImportBackup({
        ...parsed,
        mafTrackers: Array.isArray(parsed.mafTrackers) ? parsed.mafTrackers : [],
      });
      setFirmName(parsed.profile.firmName);
      setGstin(parsed.profile.gstin);
      setUdyamNumber(parsed.profile.udyamNumber);
      setAdminName(parsed.profile.adminName);
      setAdminPhotoUrl(parsed.profile.adminPhotoUrl ?? '');
      setBackupMsg({
        type: 'ok',
        msg: `Restored ${parsed.tenders.length} tenders, ${parsed.emdRecords.length} EMD/BG records, and ${(parsed.mafTrackers ?? []).length} MAF trackers.`,
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
            <Cloud className="h-5 w-5 text-[#1E3A8A] dark:text-blue-400" aria-hidden="true" />
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

        {!cloudUser ? (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 p-4">
            <div className="space-y-1 max-w-2xl">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Connect your Google Account for Automatic Cloud Backup
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Sign in with Google once to back up all {tenders.length} tenders, {mafTrackers.length} MAF trackers, {emdRecords.length} EMD/BG records, and firm settings to Google Cloud Firestore in real time across devices.
              </p>
            </div>
            <button
              type="button"
              onClick={onConnectCloud}
              disabled={cloudSyncing}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-medium shrink-0"
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
              <span className="text-slate-500 dark:text-slate-400">Authorized CRM Username</span>
              <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                VanshSales
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500 dark:text-slate-400">Tab Close / Reopen Policy</span>
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                Login Required Every Session
              </span>
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed pt-1">
              Session access is kept strictly in memory (zero browser storage). Closing the CRM tab or clicking Log Out immediately requires signing in again on the Vansh Tender Software login screen.
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

      {/* WhatsApp Tender Alert Dispatch (2-Milestone Notifications) */}
      <section className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <MessageCircle
              className="h-5 w-5 text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            />
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                WhatsApp Tender Alert Dispatch ({waName.trim() || 'Vansh'} · {waPhone.trim() || '9717690890'})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Sends complete tender details &amp; filing deadline twice per alert tender: (1) on Alerts entry (&le;48h), and (2) 4 hours before deadline
              </p>
            </div>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium ${
              whatsappGatewayInfo.automatedConfigured
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
            }`}
          >
            {whatsappGatewayInfo.automatedConfigured
              ? `Automated Gateway: ${whatsappGatewayInfo.provider.toUpperCase()}`
              : 'Manual WhatsApp Link Mode (Configure Meta/Twilio/Webhook in .env)'}
          </span>
        </div>

        <form onSubmit={handleSaveWhatsAppForm} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <label
                htmlFor="wa-recipient-name"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Recipient Name
              </label>
              <input
                id="wa-recipient-name"
                type="text"
                required
                value={waName}
                onChange={(e) => setWaName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="wa-recipient-phone"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                WhatsApp Mobile Number
              </label>
              <input
                id="wa-recipient-phone"
                type="tel"
                required
                value={waPhone}
                onChange={(e) => setWaPhone(e.target.value)}
                placeholder="9717690890"
                className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 px-3.5 py-2">
              <label
                htmlFor="wa-auto-dispatch"
                className="text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer select-none"
              >
                Auto-Dispatch on Milestones
              </label>
              <input
                id="wa-auto-dispatch"
                type="checkbox"
                checked={waEnabled}
                onChange={(e) => setWaEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600 cursor-pointer"
              />
            </div>
          </div>

          {waErrorMsg && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {waErrorMsg}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {waSavedMsg ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  {waSavedMsg}
                </span>
              ) : (
                <span>
                  Normalized WhatsApp Target: +{normalizeIndianWhatsAppPhone(waPhone || '9717690890')}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => void handleSendTestAlert()}
                disabled={waTesting}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 disabled:opacity-60 text-emerald-800 dark:text-emerald-300 text-xs font-medium cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{waTesting ? 'Sending Test...' : 'Send Test WhatsApp Alert'}</span>
              </button>

              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium cursor-pointer"
              >
                Save WhatsApp Settings
              </button>
            </div>
          </div>
        </form>

        {/* Milestone Dispatch History */}
        <div className="space-y-2.5 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Milestone Dispatch Log ({whatsappLogs.length})
            </h3>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Deduplicated by Tender + Due Date + Milestone (48h Entry &amp; 4h Urgent)
            </span>
          </div>

          {whatsappLogs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 px-4 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No WhatsApp tender alerts dispatched yet. Active pre-submission tenders due within 48 hours automatically generate 1st Alert Entry &amp; 2nd Final 4h Urgent dispatches here.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-72 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/90 text-[11px] uppercase tracking-wider text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold">Milestone</th>
                    <th className="py-2.5 px-3 font-semibold">Tender ID &amp; Filing Due</th>
                    <th className="py-2.5 px-3 font-semibold">Recipient</th>
                    <th className="py-2.5 px-3 font-semibold">Status</th>
                    <th className="py-2.5 px-3 font-semibold">Triggered At</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {whatsappLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded font-medium text-[11px] ${
                            log.milestone === 'urgent_4h'
                              ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                              : log.milestone === 'test'
                                ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                          }`}
                        >
                          {log.milestone === 'urgent_4h'
                            ? '2/2 · Final 4h Urgent'
                            : log.milestone === 'test'
                              ? 'Test Dispatch'
                              : '1/2 · Alert Entry (48h)'}
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
                        <p className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                          +{log.recipientPhone}
                        </p>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded font-medium text-[11px] ${
                            log.status === 'sent'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : log.status === 'failed'
                                ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                                : 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                          }`}
                        >
                          {log.status === 'sent'
                            ? 'Sent via Gateway'
                            : log.status === 'failed'
                              ? 'Gateway Failed'
                              : 'Ready for WhatsApp'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {new Date(log.createdAt).toLocaleString('en-IN')}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleCopyMessage(log.id, log.message)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-200"
                          >
                            <Copy className="h-3 w-3" aria-hidden="true" />
                            <span>{copiedLogId === log.id ? 'Copied' : 'Copy'}</span>
                          </button>
                          <a
                            href={buildWhatsAppWebUrl(log.recipientPhone, log.message)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-medium"
                          >
                            <span>Open WhatsApp</span>
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        </div>
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
              Data Backup, CSV Reports & Demo Reset
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
            <button
              type="button"
              onClick={() => setConfirmAction('reset')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-xs font-medium"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              <span>Reset Demo Data</span>
            </button>

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
                : 'Clear all tenders and EMD/BG records to start with an empty CRM sheet?'}
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
                    setBackupMsg({ type: 'ok', msg: 'All tenders and EMD/BG records cleared.' });
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
    </div>
  );
}
