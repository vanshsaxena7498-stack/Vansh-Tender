import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Building2,
  CheckCircle2,
  Cloud,
  CloudDownload,
  CloudUpload,
  Database,
  Download,
  KeyRound,
  LogOut,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
  User,
} from 'lucide-react';
import type { CrmBackupPayload, EmdBgRecord, FirmProfile, Tender } from '../types/crm';
import { readFileAsDataUrl, validateAttachmentFileSize } from '../utils/attachments';
import { buildCsvContent, downloadTextFile } from '../utils/formatters';
import type { CloudUserSummary } from './Header';

interface SettingsTabProps {
  profile: FirmProfile;
  currentPin: string;
  tenders: Tender[];
  emdRecords: EmdBgRecord[];
  onSaveProfile: (profile: FirmProfile) => void;
  onUpdatePin: (newPin: string) => void;
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
}

export function SettingsTab({
  profile,
  currentPin,
  tenders,
  emdRecords,
  onSaveProfile,
  onUpdatePin,
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

  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinFeedback, setPinFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(
    null,
  );

  const [backupMsg, setBackupMsg] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<'reset' | 'clear' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPhotoError('Please choose a valid image file (PNG, JPG, WEBP).');
      return;
    }
    const sizeErr = validateAttachmentFileSize(file.size);
    if (sizeErr) {
      setPhotoError(sizeErr);
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setPhotoError('');
      setAdminPhotoUrl(dataUrl);
      onSaveProfile({
        firmName: firmName.trim() || 'Corporate Tender Desk',
        gstin: gstin.trim(),
        udyamNumber: udyamNumber.trim(),
        adminName: adminName.trim() || 'Vansh Saxena',
        adminPhotoUrl: dataUrl,
      });
      setProfileSavedMsg('Admin photo updated on sidebar logo.');
      setTimeout(() => setProfileSavedMsg(''), 3000);
    } catch {
      setPhotoError('Could not read the selected image.');
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

  const handlePinSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (oldPin !== currentPin) {
      setPinFeedback({ type: 'err', msg: 'Current Admin PIN does not match.' });
      return;
    }
    if (!/^\d{4}$/.test(newPin)) {
      setPinFeedback({ type: 'err', msg: 'New PIN must be exactly 4 numeric digits.' });
      return;
    }
    if (newPin !== confirmPin) {
      setPinFeedback({ type: 'err', msg: 'New PIN and confirmation do not match.' });
      return;
    }
    onUpdatePin(newPin);
    setOldPin('');
    setNewPin('');
    setConfirmPin('');
    setPinFeedback({ type: 'ok', msg: 'Admin Lock Screen PIN updated successfully.' });
    setTimeout(() => setPinFeedback(null), 3500);
  };

  const handleDownloadJsonBackup = () => {
    const payload: CrmBackupPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      profile,
      tenders,
      emdRecords,
    };
    downloadTextFile(
      `BidLedger_Full_Backup_${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
      'application/json',
    );
    setBackupMsg({ type: 'ok', msg: 'Full JSON backup downloaded.' });
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
      onImportBackup(parsed);
      setFirmName(parsed.profile.firmName);
      setGstin(parsed.profile.gstin);
      setUdyamNumber(parsed.profile.udyamNumber);
      setAdminName(parsed.profile.adminName);
      setAdminPhotoUrl(parsed.profile.adminPhotoUrl ?? '');
      setBackupMsg({
        type: 'ok',
        msg: `Restored ${parsed.tenders.length} tenders and ${parsed.emdRecords.length} EMD/BG records.`,
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
                Sign in with Google once to back up all {tenders.length} tenders, {emdRecords.length} EMD/BG records, and firm settings to Google Cloud Firestore in real time across devices.
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

      {/* Security Settings */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-200 dark:border-slate-800">
          <KeyRound className="h-5 w-5 text-[#1E3A8A] dark:text-blue-400" aria-hidden="true" />
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Security Lock PIN
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Customize your 4-digit Lock Screen PIN (default is 1234)
            </p>
          </div>
        </div>

        <form onSubmit={handlePinSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="set-old-pin"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Current 4-Digit PIN
            </label>
            <input
              id="set-old-pin"
              type="password"
              inputMode="numeric"
              maxLength={4}
              required
              value={oldPin}
              onChange={(e) => setOldPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="set-new-pin"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                New 4-Digit PIN
              </label>
              <input
                id="set-new-pin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                required
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="set-confirm-pin"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Confirm New PIN
              </label>
              <input
                id="set-confirm-pin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                required
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          {pinFeedback && (
            <p
              role="alert"
              className={`text-xs font-medium ${
                pinFeedback.type === 'ok'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {pinFeedback.msg}
            </p>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium"
            >
              Update Admin PIN
            </button>
          </div>
        </form>
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
              Real-time browser persistence active · Export JSON before clearing cache or switching browsers
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
